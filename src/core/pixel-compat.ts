/**
 * Older players (docs/像素工坊设计.md, 第 ③ 步): the desktop program builds
 * its own 像素动画 player, and one built before `g.sprite` has none. A file
 * that draws with it is sent to the desktop wrapped: the file's own code runs
 * inside, and `g.sprite` is put on the grid first when the grid lacks it. A
 * player that has it is not touched. Pure.
 */

import { wrapPixelCode } from './pixel.ts'

/** g.sprite drawn with g.rect, as pixel-grid.ts draws it. */
const SHIM = `function __herSprite(g) {
  if (typeof g.sprite === 'function') return
  g.sprite = function (x, y, rows, o) {
    o = o || {}
    const lines = (typeof rows === 'string' ? rows.split('\\n') : Array.isArray(rows) ? rows : []).slice(0, 400).map(r => String(r).slice(0, 400))
    let width = 0
    for (const r of lines) width = Math.max(width, r.length)
    const height = lines.length
    const scale = Math.min(16, Math.max(0.25, Number.isFinite(o.scale) ? o.scale : 1))
    const a = o.a === undefined ? 1 : Math.min(1, Math.max(0, o.a))
    const left = o.center === true ? x - (width * scale) / 2 : x
    const top = o.center === true ? y - (height * scale) / 2 : y
    for (let row = 0; row < height; row++) {
      const line = lines[row]
      const sy = o.flipY === true ? height - 1 - row : row
      for (let col = 0; col < line.length; col++) {
        const ch = line[col]
        if (ch === '.' || ch === ' ') continue
        const own = o.palette ? o.palette[ch] : undefined
        const c = own !== undefined ? own : ch >= '0' && ch <= '9' ? Number(ch) / 9 : 1
        const sx = o.flip === true ? width - 1 - col : col
        const x0 = Math.floor(left + sx * scale), y0 = Math.floor(top + sy * scale)
        const x1 = Math.max(x0 + 1, Math.floor(left + (sx + 1) * scale)), y1 = Math.max(y0 + 1, Math.floor(top + (sy + 1) * scale))
        g.rect(x0, y0, x1 - x0, y1 - y0, c, a)
      }
    }
    return Math.round(width * scale)
  }
}`

/** The file as it can be sent to any player: unchanged unless it uses g.sprite. */
export function forOlderPlayers(code: string): string {
  if (!/\.sprite\s*\(/.test(code)) return code
  const { script } = wrapPixelCode(code)
  if (script === undefined) return code
  // Ours are vars given their values after the file's own code has run: while it runs they are still
  // undefined, so a file without a setup does not find ours instead.
  return `${script.replace(/^var __anim = /, 'const __herInner = ')}
export var info = __herInner.info
export var setup = function (g) { __herSprite(g); if (__herInner.setup) __herInner.setup(g) }
export var frame = function (g, t, n) { __herSprite(g); __herInner.frame(g, t, n) }
${SHIM}
`
}
