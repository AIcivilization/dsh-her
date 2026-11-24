/**
 * The project page's sea: our own built-in 像素动画 (src/core/pixel-builtins.ts),
 * drawn by the same grid and painter the plugin uses. Only our own code runs
 * here, so it runs on the page itself, not in a worker. Stops when the page is
 * hidden or the visitor asks for less motion.
 */

import { BUILTIN_PIXELS } from '../src/core/pixel-builtins.ts'
import { makeGrid, type PixelGrid } from '../src/core/pixel-grid.ts'
import { cleanPixelInfo, wrapPixelCode, type PixelInfo, type PixelStyle } from '../src/core/pixel.ts'
import { Painter, type Rgb } from '../src/client/pixel/paint.ts'

type Anim = { info: PixelInfo; setup?: (g: PixelGrid) => void; frame: (g: PixelGrid, t: number, n: number) => void }

function load(code: string): Anim | undefined {
  const { script } = wrapPixelCode(code)
  if (script === undefined) return undefined
  const raw = new Function(`${script}\nreturn __anim`)() as { info?: unknown; setup?: Anim['setup']; frame?: Anim['frame'] }
  const { info } = cleanPixelInfo(raw.info)
  return info === undefined || raw.frame === undefined ? undefined : { info, setup: raw.setup, frame: raw.frame }
}

const canvas = document.getElementById('sea') as HTMLCanvasElement | null
if (canvas !== null) {
  const painter = new Painter(canvas)
  const still = window.matchMedia('(prefers-reduced-motion: reduce)')
  const inkOf = (): Rgb => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
    const m = /^#?([0-9a-f]{6})$/i.exec(raw)
    const n = m ? parseInt(m[1]!, 16) : 0x9fd8ff
    return [n >> 16, (n >> 8) & 255, n & 255]
  }

  let id = BUILTIN_PIXELS[0]!.id
  let style: PixelStyle = 'dots'
  let anim: Anim | undefined
  let grid: PixelGrid | undefined
  let started = 0
  let lastN = -1
  let raf = 0

  const start = () => {
    anim = load(BUILTIN_PIXELS.find(p => p.id === id)!.code)
    if (anim === undefined) return
    grid = makeGrid(anim.info.grid[0], anim.info.grid[1], anim.info.color)
    painter.set(anim.info, { style, color: 'theme', size: 1, fit: 'contain' }, inkOf())
    anim.setup?.(grid)
    started = performance.now()
    lastN = -1
    if (!still.matches) loop()
    else draw(Math.min(2, anim.info.seconds || 2))
  }

  /** One frame at `t` seconds; the alpha fades a run in and out. */
  const draw = (t: number) => {
    if (anim === undefined || grid === undefined) return
    const n = Math.floor(t * anim.info.fps)
    if (n === lastN) return
    lastN = n
    anim.frame(grid, n / anim.info.fps, n)
    const len = anim.info.seconds
    const alpha = Math.min(1, t / 0.35, len > 0 ? (len - t) / 0.5 : 1)
    painter.paint(grid.data, Math.max(0, alpha))
  }

  const loop = () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(function tick(now) {
      if (anim === undefined) return
      const t = (now - started) / 1000
      const len = anim.info.seconds
      // A clip with an end plays again after a breath; a background goes on.
      if (len > 0 && t > len + 1.2) { start(); return }
      if (len === 0 || t <= len) draw(t)
      raf = requestAnimationFrame(tick)
    })
  }

  const buttons = (name: string, apply: (value: string) => void) => {
    document.querySelectorAll<HTMLButtonElement>(`[data-${name}]`).forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll(`[data-${name}]`).forEach(o => o.setAttribute('aria-pressed', String(o === b)))
        apply(b.dataset[name]!)
        start()
      })
    })
  }
  buttons('anim', v => { id = v })
  buttons('style', v => { style = v as PixelStyle })
  canvas.addEventListener('click', start)

  new ResizeObserver(() => { painter.resize(); lastN = -1 }).observe(canvas)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { painter.setInk(inkOf()); lastN = -1 })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf)
    else start()
  })
  still.addEventListener('change', start)
  start()
}
