/**
 * 像素化显示 (docs/像素动画设计.md §11.3): a clip drawn small (so many pixels
 * high) on a canvas the page shows with square edges, so a pixel-art look
 * stays clean and even whatever the video tool made of it. Draws only when a
 * new frame arrives.
 */

export class PixelView {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D

  constructor(private readonly video: HTMLVideoElement, private readonly cells: number) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.imageRendering = 'pixelated'
    this.ctx = this.canvas.getContext('2d')!
    const draw = () => {
      this.draw()
      video.requestVideoFrameCallback(draw)
    }
    video.requestVideoFrameCallback(draw)
  }

  /** Draw the frame the video is on now (a preloaded clip shows its first frame before it plays). */
  drawNow(): void {
    this.draw()
  }

  private draw(): void {
    const { video, canvas, ctx } = this
    if (video.videoWidth === 0) return
    const height = Math.min(video.videoHeight, this.cells)
    const width = Math.max(1, Math.round(video.videoWidth * height / video.videoHeight))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    ctx.clearRect(0, 0, width, height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(video, 0, 0, width, height)
  }
}
