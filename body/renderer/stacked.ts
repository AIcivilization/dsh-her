/**
 * WebGL view for "stacked" clips: an H.264 frame holding the colour on top and
 * the alpha mask below. The video decodes in hardware; this draws each new
 * frame (requestVideoFrameCallback, so only when one arrives) as premultiplied
 * colour × mask into a transparent canvas.
 */

const VERTEX = `
attribute vec2 p;
varying vec2 uv;
void main() {
  uv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`

const FRAGMENT = `
precision mediump float;
uniform sampler2D frame;
uniform float halfTexel;
varying vec2 uv;
void main() {
  float y = clamp(uv.y * 0.5, 0.0, 0.5 - halfTexel);
  vec3 color = texture2D(frame, vec2(uv.x, y)).rgb;
  float alpha = texture2D(frame, vec2(uv.x, y + 0.5)).r;
  gl_FragColor = vec4(color * alpha, alpha);
}`

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed')
  return shader
}

export class StackedView {
  readonly canvas: HTMLCanvasElement
  private readonly gl: WebGLRenderingContext
  private readonly halfTexel: WebGLUniformLocation | null

  constructor(private readonly video: HTMLVideoElement) {
    this.canvas = document.createElement('canvas')
    const gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false })
    if (gl === null) throw new Error('WebGL unavailable')
    this.gl = gl
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const p = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(p)
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) {
      gl.texParameteri(gl.TEXTURE_2D, key, value)
    }
    this.halfTexel = gl.getUniformLocation(program, 'halfTexel')
    gl.clearColor(0, 0, 0, 0)
    const draw = () => {
      this.draw()
      video.requestVideoFrameCallback(draw)
    }
    video.requestVideoFrameCallback(draw)
  }

  private draw(): void {
    const { gl, video } = this
    if (video.videoWidth === 0) return
    const width = video.videoWidth
    const height = video.videoHeight / 2
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      gl.viewport(0, 0, width, height)
      gl.uniform1f(this.halfTexel, 0.5 / video.videoHeight)
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}
