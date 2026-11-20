/**
 * Hosting the 像素动画 player in dsh's page (docs/像素动画设计.md §4): an
 * iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, so the
 * code in it has an opaque origin (no dsh, no cookies) and the page's own CSP
 * allows it no network. The page comes inline (srcdoc), so nothing is fetched.
 */

import type { PixelInfo, PixelLook } from '../../core/pixel.ts'
import { parseHex } from '../../core/pixel-grid.ts'

declare const __PIXEL_PLAYER_HTML__: string

export type Rgb = [number, number, number]

export type PixelEvent =
  | { t: 'ready' }
  | { t: 'playing'; info: PixelInfo }
  | { t: 'ended' }
  | { t: 'problem'; problems: string[] }
  | { t: 'probe'; ok: boolean; info?: PixelInfo; problems: string[]; warnings: string[]; thumb?: string; frameMs?: number }

export interface PlayOptions {
  mode: 'once' | 'loop'
  /** The longest a once may last (s). */
  cap?: number
  fade?: boolean
}

export class PixelFrame {
  readonly el: HTMLIFrameElement
  private readonly ready: Promise<boolean>
  private readonly listeners = new Set<(event: PixelEvent) => void>()
  private gone = false

  constructor() {
    const el = document.createElement('iframe')
    el.setAttribute('sandbox', 'allow-scripts')
    el.setAttribute('aria-hidden', 'true')
    el.tabIndex = -1
    // The same colour scheme inside and out, or the browser paints the frame opaque.
    el.style.cssText = 'border:0;background:transparent;color-scheme:light;pointer-events:none;width:100%;height:100%;display:block'
    el.srcdoc = __PIXEL_PLAYER_HTML__
    this.el = el
    window.addEventListener('message', this.onMessage)
    this.ready = new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 6000)
      const off = this.on(event => {
        if (event.t !== 'ready') return
        clearTimeout(timer)
        off()
        resolve(true)
      })
    })
  }

  private readonly onMessage = (event: MessageEvent) => {
    if (event.source !== this.el.contentWindow) return
    const data = event.data as (PixelEvent & { pixel?: boolean }) | undefined
    if (data?.pixel !== true) return
    for (const listener of [...this.listeners]) listener(data)
  }

  on(listener: (event: PixelEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async send(command: Record<string, unknown>): Promise<void> {
    if (!(await this.ready)) {
      if (!this.gone) for (const listener of [...this.listeners]) listener({ t: 'problem', problems: ['像素动画的播放页没能打开（这个页面不让它运行）'] })
      return
    }
    this.el.contentWindow?.postMessage(command, '*')
  }

  play(code: string, look: PixelLook, ink: Rgb, options: PlayOptions): void {
    void this.send({ t: 'play', code, look, ink, ...options })
  }

  probe(code: string, ink: Rgb): void {
    void this.send({ t: 'probe', code, ink })
  }

  setInk(ink: Rgb): void {
    void this.send({ t: 'ink', ink })
  }

  stop(): void {
    void this.send({ t: 'stop' })
  }

  destroy(): void {
    this.gone = true
    window.removeEventListener('message', this.onMessage)
    this.listeners.clear()
    this.el.remove()
  }
}

/** A colour as the page shows it ('rgb(…)', 'color(srgb …)') as [r, g, b]. */
function parseCssColor(value: string): Rgb | undefined {
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value)
  if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value)
  if (srgb !== null) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255].map(Math.round) as Rgb
  return undefined
}

/**
 * The ink for a look's colour: its own (#rrggbb), or 'theme': one of dsh's
 * colours as this page shows it now (light or dark, its skin).
 */
export function inkOf(color: string, themeVar = '--dsw-alias-label-secondary'): Rgb {
  if (color !== 'theme') return parseHex(color)
  const probe = document.createElement('span')
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:var(${themeVar}, #7f8a99)`
  document.body.append(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return parseCssColor(value) ?? [127, 138, 153]
}

/** Try a file in a sandbox of its own: what is wrong, or its info and a still. */
export function probePixel(code: string, ink: Rgb): Promise<Extract<PixelEvent, { t: 'probe' }>> {
  const frame = new PixelFrame()
  frame.el.style.cssText += ';position:fixed;left:-10000px;top:0;width:320px;height:180px'
  document.body.append(frame.el)
  return new Promise(resolve => {
    const done = (result: Extract<PixelEvent, { t: 'probe' }>) => {
      clearTimeout(timer)
      frame.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => done({ t: 'probe', ok: false, problems: ['试跑超过 15 秒没有结果'], warnings: [] }), 15_000)
    frame.on(event => {
      if (event.t === 'probe') done(event)
      else if (event.t === 'problem') done({ t: 'probe', ok: false, problems: event.problems, warnings: [] })
    })
    frame.probe(code, ink)
  })
}
