/**
 * The project page's sticker: a little pixel whale (drawn here, ours) made
 * into a 像素动画 the way a picture is in the workshop (pictureCode), hopping
 * in a mock WeChat chat. The same grid and painter the plugin uses; only our
 * own code runs, so on the page itself. Still when the visitor asks for less
 * motion, paused while the page is hidden.
 */

import { pictureCode } from '../src/core/pixel-motion.ts'
import type { Picture } from '../src/core/pixel-picture.ts'
import { makeGrid, type PixelGrid } from '../src/core/pixel-grid.ts'
import { cleanPixelInfo, wrapPixelCode, type PixelInfo } from '../src/core/pixel.ts'
import { Painter } from '../src/client/pixel/paint.ts'

const WHALE = [
  '..........h..h...........',
  '...........hh............',
  '......aaaaaaaa...........',
  '....aabbbbbbbbaa.........',
  '...abbbbbbbbbbbba.....aa.',
  '..abbcbbbbbbbbbbba...abba',
  '.abccbbbbbbbbbbbbba.abba.',
  '.abcbbbbfbbbbbbbbbbabba..',
  'abbbbbbffbbbbbbbbbbbba...',
  'abbbbbbbbbbgbbbbbbbbba...',
  'abddddbbbbbbbbbbbbbba....',
  '.addddddbbbbbbbbbbba.....',
  '..adddddddddddddaaa......',
  '...aaaaaaaaaaaaa.........',
]
const PALETTE = { a: '#16325c', b: '#3b82f6', c: '#93c5fd', d: '#e0f2fe', f: '#0b1220', g: '#f9a8d4', h: '#7dd3fc' }

const picture: Picture = { rows: WHALE, frames: [WHALE], w: WHALE[0]!.length, h: WHALE.length, palette: PALETTE, background: 'clear' }

type Anim = { info: PixelInfo; frame: (g: PixelGrid, t: number, n: number) => void }

function load(): Anim | undefined {
  const { script } = wrapPixelCode(pictureCode(picture, '小鲸鱼', 'hop'))
  if (script === undefined) return undefined
  const raw = new Function(`${script}\nreturn __anim`)() as { info?: unknown; frame?: Anim['frame'] }
  const { info } = cleanPixelInfo(raw.info)
  return info === undefined || raw.frame === undefined ? undefined : { info, frame: raw.frame }
}

const canvas = document.getElementById('sticker') as HTMLCanvasElement | null
const anim = canvas === null ? undefined : load()
if (canvas !== null && anim !== undefined) {
  const painter = new Painter(canvas)
  // The whale fills the sticker: the grid cut to where it hops.
  const info: PixelInfo = { ...anim.info }
  const grid = makeGrid(info.grid[0], info.grid[1], info.color)
  painter.set(info, { style: 'blocks', color: 'theme', size: 1, fit: 'contain' }, [255, 255, 255])
  const still = window.matchMedia('(prefers-reduced-motion: reduce)')
  let raf = 0
  let lastN = -1
  const draw = (t: number) => {
    const n = Math.floor(t * info.fps)
    if (n === lastN) return
    lastN = n
    anim.frame(grid, n / info.fps, n)
    painter.paint(grid.data, 1)
  }
  const run = () => {
    cancelAnimationFrame(raf)
    if (still.matches || document.hidden) {
      lastN = -1
      draw(0)
      return
    }
    const started = performance.now()
    raf = requestAnimationFrame(function tick(now) {
      draw((now - started) / 1000)
      raf = requestAnimationFrame(tick)
    })
  }
  new ResizeObserver(() => { painter.resize(); lastN = -1 }).observe(canvas)
  document.addEventListener('visibilitychange', run)
  still.addEventListener('change', run)
  run()
}
