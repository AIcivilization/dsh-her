/**
 * 像素工坊 (docs/像素工坊设计.md §3.4): the AI cannot see the picture, so a
 * frame is shrunk to characters (" .:+#", darker to brighter) for it to read,
 * with where the drawing is and how much of the grid it fills. Pure.
 */

export const SKETCH_LEVELS = ' .:+#'

export interface SketchStats {
  /** Cells drawn, out of all (0–1). */
  filled: number
  /** Where the drawing is, as fractions of the grid (undefined: nothing drawn). */
  box?: { left: number; right: number; top: number; bottom: number }
}

/** How bright a cell shows (0–1): mono, its brightness times alpha; colour, its lightness times alpha. */
function cell(data: Uint8ClampedArray, i: number, mono: boolean): number {
  const a = data[i + 3]! / 255
  if (a === 0) return 0
  const v = mono ? data[i]! : 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
  // A colour cell is seen even when dark: it is drawn.
  return Math.max(mono ? 0 : 0.25, v / 255) * a
}

/** A frame as `cols` columns of characters (rows keep the grid's shape, a character being about twice as tall as wide). */
export function sketchFrame(data: Uint8ClampedArray, w: number, h: number, mono: boolean, cols = 48): string {
  const cw = Math.max(1, w / cols)
  const rows = Math.max(1, Math.round(h / (cw * 2)))
  const ch = h / rows
  const out: string[] = []
  for (let r = 0; r < rows; r++) {
    let line = ''
    for (let c = 0; c < Math.min(cols, w); c++) {
      let best = 0
      for (let y = Math.floor(r * ch); y < Math.min(h, Math.ceil((r + 1) * ch)); y++) {
        for (let x = Math.floor(c * cw); x < Math.min(w, Math.ceil((c + 1) * cw)); x++) best = Math.max(best, cell(data, (y * w + x) * 4, mono))
      }
      line += best <= 0.02 ? ' ' : SKETCH_LEVELS[Math.min(4, 1 + Math.floor(best * 4))]
    }
    out.push(line.replace(/\s+$/, ''))
  }
  return out.join('\n')
}

export function sketchStats(data: Uint8ClampedArray, w: number, h: number, mono: boolean): SketchStats {
  let filled = 0
  let left = w, right = -1, top = h, bottom = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cell(data, (y * w + x) * 4, mono) <= 0.02) continue
      filled++
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  const round = (v: number) => Math.round(v * 100) / 100
  return {
    filled: round(filled / (w * h)),
    ...(right < 0 ? {} : { box: { left: round(left / w), right: round((right + 1) / w), top: round(top / h), bottom: round((bottom + 1) / h) } }),
  }
}

export interface Sketch {
  /** Seconds into the animation. */
  t: number
  text: string
  stats: SketchStats
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** What a try shows the AI: each frame's place and fill, and the frame in characters. */
export function sketchReport(sketches: Sketch[]): string {
  return sketches.map(s => {
    const where = s.stats.box === undefined
      ? '什么都没画'
      : `画到的格子占 ${pct(s.stats.filled)}；左右 ${pct(s.stats.box.left)}–${pct(s.stats.box.right)}，上下 ${pct(s.stats.box.top)}–${pct(s.stats.box.bottom)}`
    return `第 ${s.t} 秒（${where}）：\n\`\`\`\n${s.text || '（空）'}\n\`\`\``
  }).join('\n')
}
