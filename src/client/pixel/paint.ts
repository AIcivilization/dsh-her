/**
 * Drawing a 像素动画's grid on a canvas (docs/像素动画设计.md §2): blocks
 * (crisp squares), dots (a circle a cell, its size the brightness) or code
 * lettering seen through the grid. A colour grid is drawn as blocks.
 */

import type { PixelInfo, PixelLook } from '../../core/pixel.ts'

/** The words of the code fill: our own. */
const PHRASES = [
  'const her = new Body()', 'await her.speak()', 'her.listen()', 'whale.breach()', '// 你好', 'ctx.plugin(Her)',
  'while (alive) swim()', 'return home', 'her.remember(you)', 'sea.wave(t)', '// dsh-her', 'tail.splash()',
  'await dsh.reply()', 'g.set(x, y, 1)', 'const sea = blue', 'her.smile()', 'yield bubble', 'if (you) wave()',
]

export type Rgb = [number, number, number]

export class Painter {
  private readonly ctx: CanvasRenderingContext2D
  private readonly small = document.createElement('canvas')
  private readonly smallCtx: CanvasRenderingContext2D
  private image: ImageData | undefined
  private lettering: HTMLCanvasElement | undefined
  private letteringKey = ''
  private info: PixelInfo | undefined
  private look: PixelLook | undefined
  private ink: Rgb = [255, 255, 255]
  private width = 0
  private height = 0
  private dpr = 1

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
    this.smallCtx = this.small.getContext('2d')!
  }

  set(info: PixelInfo, look: PixelLook, ink: Rgb): void {
    this.info = info
    this.look = look
    this.ink = ink
    this.small.width = info.grid[0]
    this.small.height = info.grid[1]
    this.image = this.smallCtx.createImageData(info.grid[0], info.grid[1])
    this.letteringKey = ''
    this.resize()
  }

  setInk(ink: Rgb): void {
    this.ink = ink
    this.letteringKey = ''
  }

  resize(): void {
    this.width = this.canvas.clientWidth
    this.height = this.canvas.clientHeight
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.max(1, Math.round(this.width * this.dpr))
    this.canvas.height = Math.max(1, Math.round(this.height * this.dpr))
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.letteringKey = ''
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height)
  }

  /** Where the grid goes: contained in the area (times `size`) or covering it, centred. */
  scene(): { left: number; top: number; w: number; h: number } {
    const [gw, gh] = this.info?.grid ?? [1, 1]
    const look = this.look
    const scale = look?.fit === 'cover'
      ? Math.max(this.width / gw, this.height / gh)
      : Math.min(this.width / gw, this.height / gh) * (look?.size ?? 1)
    const w = gw * scale, h = gh * scale
    return { left: (this.width - w) / 2, top: (this.height - h) / 2, w, h }
  }

  paint(data: Uint8ClampedArray, alpha: number): void {
    this.clear()
    const info = this.info, look = this.look
    if (info === undefined || look === undefined || alpha <= 0) return
    const style = info.color === 'color' ? 'blocks' : look.style
    if (style === 'dots') this.dots(data, alpha)
    else if (style === 'code') this.code(data, alpha)
    else this.blocks(data, alpha)
  }

  private blocks(data: Uint8ClampedArray, alpha: number): void {
    const image = this.image!
    const out = image.data
    if (this.info!.color === 'color') out.set(data)
    else {
      const [r, g, b] = this.ink
      for (let i = 0; i < data.length; i += 4) {
        out[i] = r
        out[i + 1] = g
        out[i + 2] = b
        out[i + 3] = (data[i]! * data[i + 3]!) / 255
      }
    }
    this.smallCtx.putImageData(image, 0, 0)
    const { left, top, w, h } = this.scene()
    this.ctx.imageSmoothingEnabled = false
    this.ctx.globalAlpha = alpha
    this.ctx.drawImage(this.small, left, top, w, h)
    this.ctx.globalAlpha = 1
  }

  private dots(data: Uint8ClampedArray, alpha: number): void {
    const [gw, gh] = this.info!.grid
    const { left, top, w } = this.scene()
    const cell = w / gw
    const ctx = this.ctx
    const LEVELS = 8
    const paths: Path2D[] = Array.from({ length: LEVELS }, () => new Path2D())
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = (y * gw + x) * 4
        const a = data[i + 3]!
        const v = data[i]!
        if (a < 4 || v < 4) continue
        const radius = (v / 255) * cell * 0.62
        if (radius < 0.25) continue
        const level = Math.min(LEVELS - 1, Math.floor((a / 256) * LEVELS))
        const cx = left + (x + 0.5) * cell, cy = top + (y + 0.5) * cell
        const path = paths[level]!
        if (radius < 1.2) path.rect(cx - radius, cy - radius, radius * 2, radius * 2)
        else {
          path.moveTo(cx + radius, cy)
          path.arc(cx, cy, radius, 0, Math.PI * 2)
        }
      }
    }
    ctx.fillStyle = `rgb(${this.ink.join(',')})`
    paths.forEach((path, level) => {
      ctx.globalAlpha = alpha * (level + 1) / LEVELS
      ctx.fill(path)
    })
    ctx.globalAlpha = 1
  }

  private code(data: Uint8ClampedArray, alpha: number): void {
    const scene = this.scene()
    const key = `${Math.round(scene.w)}x${Math.round(scene.h)}:${this.ink.join(',')}:${this.dpr}`
    if (this.lettering === undefined || this.letteringKey !== key) this.makeLettering(scene.w, scene.h, key)
    const image = this.image!
    const out = image.data
    for (let i = 0; i < data.length; i += 4) {
      out[i] = 0
      out[i + 1] = 0
      out[i + 2] = 0
      out[i + 3] = (data[i]! * data[i + 3]!) / 255
    }
    this.smallCtx.putImageData(image, 0, 0)
    const ctx = this.ctx
    ctx.globalAlpha = Math.min(1, alpha * 1.3)
    ctx.drawImage(this.lettering!, scene.left, scene.top, scene.w, scene.h)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'destination-in'
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this.small, scene.left, scene.top, scene.w, scene.h)
    ctx.globalCompositeOperation = 'source-over'
  }

  private makeLettering(w: number, h: number, key: string): void {
    const canvas = this.lettering ?? document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(w * this.dpr))
    canvas.height = Math.max(1, Math.ceil(h * this.dpr))
    const ink = canvas.getContext('2d')!
    ink.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    const cell = w / this.info!.grid[0]
    const size = Math.max(6, Math.min(12, cell * 1.5))
    ink.font = `500 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
    ink.textBaseline = 'middle'
    ink.fillStyle = `rgb(${this.ink.join(',')})`
    let seed = 0x2545f491
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0x1_0000_0000
    }
    for (let y = size; y < h; y += size * 1.2) {
      for (let x = -random() * size * 10; x < w;) {
        const text = PHRASES[Math.floor(random() * PHRASES.length)]!
        ink.globalAlpha = 0.65 + random() * 0.35
        ink.fillText(text, x, y)
        x += ink.measureText(text).width + size * (0.35 + random() * 0.65)
      }
    }
    this.lettering = canvas
    this.letteringKey = key
  }

  /** A still picture of a frame (blocks, `ink`), for the list. */
  static thumb(info: PixelInfo, data: Uint8ClampedArray, ink: Rgb, width = 192): string {
    const [gw, gh] = info.grid
    const scale = Math.max(1, Math.floor(width / gw))
    const small = document.createElement('canvas')
    small.width = gw
    small.height = gh
    const sctx = small.getContext('2d')!
    const image = sctx.createImageData(gw, gh)
    for (let i = 0; i < data.length; i += 4) {
      if (info.color === 'color') {
        image.data[i] = data[i]!
        image.data[i + 1] = data[i + 1]!
        image.data[i + 2] = data[i + 2]!
        image.data[i + 3] = data[i + 3]!
      } else {
        image.data[i] = ink[0]
        image.data[i + 1] = ink[1]
        image.data[i + 2] = ink[2]
        image.data[i + 3] = (data[i]! * data[i + 3]!) / 255
      }
    }
    sctx.putImageData(image, 0, 0)
    const out = document.createElement('canvas')
    out.width = gw * scale
    out.height = gh * scale
    const octx = out.getContext('2d')!
    octx.imageSmoothingEnabled = false
    octx.drawImage(small, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  }
}
