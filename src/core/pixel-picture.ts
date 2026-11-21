/**
 * 图片转精灵 (docs/像素工坊设计.md §5): a picture, in the page, becomes a
 * pixel picture for `g.sprite`: its plain background taken away, cut to what
 * is in it, shrunk to so many cells high, and written as characters (mono:
 * '1'–'9' by how light; colour: up to 32 letters and their colours, with a
 * dark outline if wanted). Only
 * the characters go into the file: the picture is not kept or sent. Pure: it
 * works on RGBA pixels, so it runs in the page and in tests.
 */

export interface Rgba {
  data: Uint8ClampedArray
  w: number
  h: number
}

export interface PictureOptions {
  /** How many cells high (8–128). */
  height: number
  color: boolean
  /** Take away a plain background that reaches the edges. */
  cutBackground: boolean
  /** Colour only: a ring of cells round it, each a darker shade of what it touches (a cell more each way). */
  outline?: boolean
}

export interface Picture {
  rows: string[]
  /** For colour: a letter's colour. */
  palette?: Record<string, string>
  w: number
  h: number
  /** What was done about the background: it was already see-through, it was taken away, or there was none plain enough. */
  background: 'clear' | 'cut' | 'kept'
}

/** The widest a picture may be, in cells. */
export const PICTURE_MAX_W = 192
/** The tallest, in cells. */
export const PICTURE_MAX_H = 128
/** The most colours, a letter each. */
export const PICTURE_COLORS = 32
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEF'

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/** The pixels round the edge: how many are see-through already. */
function edges(w: number, h: number): number[] {
  const out: number[] = []
  for (let x = 0; x < w; x++) out.push(x, (h - 1) * w + x)
  for (let y = 1; y < h - 1; y++) out.push(y * w, y * w + w - 1)
  return out
}

/**
 * Take away the background: the colour most of the edge has, and everything
 * of that colour joined to the edge. Whether there was one.
 */
export function cutBackground(img: Rgba, tolerance = 48): boolean {
  const { data, w, h } = img
  const border = edges(w, h)
  // The commonest edge colour, roughly.
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (const p of border) {
    const i = p * 4
    if (data[i + 3]! < 128) continue
    const key = ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4)
    const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    c.n++
    c.r += data[i]!
    c.g += data[i + 1]!
    c.b += data[i + 2]!
    counts.set(key, c)
  }
  let top: { n: number; r: number; g: number; b: number } | undefined
  for (const c of counts.values()) if (top === undefined || c.n > top.n) top = c
  if (top === undefined) return false
  const [br, bg, bb] = [top.r / top.n, top.g / top.n, top.b / top.n]
  const near = (p: number) => {
    const i = p * 4
    if (data[i + 3]! < 128) return true
    const dr = data[i]! - br, dg = data[i + 1]! - bg, db = data[i + 2]! - bb
    return dr * dr + dg * dg + db * db <= tolerance * tolerance
  }
  // Not plain enough round the edge: leave it.
  if (border.filter(near).length < border.length * 0.6) return false
  const seen = new Uint8Array(w * h)
  const stack = border.filter(near)
  for (const p of stack) seen[p] = 1
  while (stack.length > 0) {
    const p = stack.pop()!
    data[p * 4 + 3] = 0
    const x = p % w, y = (p - x) / w
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || seen[q] === 1 || !near(q)) continue
      seen[q] = 1
      stack.push(q)
    }
  }
  // A green or blue screen: a bright, strong colour no one wears by chance.
  // Then the patches it leaves shut in (between an arm and the body) go too,
  // and the screen's colour that has spilt onto the edge is taken out.
  const channels = [br, bg, bb]
  const key = channels.indexOf(Math.max(br, bg, bb))
  if (Math.max(br, bg, bb) - Math.min(br, bg, bb) < 90) return true
  for (let p = 0; p < w * h; p++) if (near(p)) data[p * 4 + 3] = 0
  const gone = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! < 128
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (data[i + 3]! < 128) continue
      let edge = false
      for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2 && !edge; dx++) edge = gone(x + dx, y + dy)
      if (!edge) continue
      const others = [0, 1, 2].filter(c => c !== key).map(c => data[i + c]!)
      data[i + key] = Math.min(data[i + key]!, Math.max(...others))
    }
  }
  return true
}

/** Where the picture is (alpha ≥ 128); all of it when nothing is. */
export function cropBox(img: Rgba): { x: number; y: number; w: number; h: number } {
  const { data, w, h } = img
  let left = w, right = -1, top = h, bottom = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! < 128) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? { x: 0, y: 0, w, h } : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }
}

/** Part of a picture shrunk to `tw` × `th` cells: each the average of what it covers; mostly see-through, see-through. */
export function shrink(img: Rgba, box: { x: number; y: number; w: number; h: number }, tw: number, th: number): Rgba {
  const out = new Uint8ClampedArray(tw * th * 4)
  for (let cy = 0; cy < th; cy++) {
    for (let cx = 0; cx < tw; cx++) {
      const x0 = box.x + Math.floor(cx * box.w / tw), x1 = Math.max(x0 + 1, box.x + Math.floor((cx + 1) * box.w / tw))
      const y0 = box.y + Math.floor(cy * box.h / th), y1 = Math.max(y0 + 1, box.y + Math.floor((cy + 1) * box.h / th))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.w + x) * 4
          const al = img.data[i + 3]! / 255
          r += img.data[i]! * al
          g += img.data[i + 1]! * al
          b += img.data[i + 2]! * al
          a += al
          n++
        }
      }
      const o = (cy * tw + cx) * 4
      if (a / n < 0.5) continue
      out[o] = r / a
      out[o + 1] = g / a
      out[o + 2] = b / a
      out[o + 3] = 255
    }
  }
  return { data: out, w: tw, h: th }
}

/** Mono: '1'–'9' by how light, stretched so the darkest part is 1 and the lightest 9. */
export function monoRows(img: Rgba): string[] {
  const { data, w, h } = img
  let lo = 255, hi = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const l = lum(data[i]!, data[i + 1]!, data[i + 2]!)
    lo = Math.min(lo, l)
    hi = Math.max(hi, l)
  }
  const rows: string[] = []
  for (let y = 0; y < h; y++) {
    let row = ''
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (data[i + 3] === 0) row += '.'
      else row += String(hi - lo < 1 ? 9 : 1 + Math.round((lum(data[i]!, data[i + 1]!, data[i + 2]!) - lo) / (hi - lo) * 8))
    }
    rows.push(row)
  }
  return rows
}

/** Colour: up to `most` colours (median cut), a letter each. */
export function colorRows(img: Rgba, most = PICTURE_COLORS): { rows: string[]; palette: Record<string, string> } {
  const { data, w, h } = img
  const pixels: number[] = []
  for (let p = 0; p < w * h; p++) if (data[p * 4 + 3] !== 0) pixels.push(p)
  let boxes: number[][] = pixels.length > 0 ? [pixels] : []
  const range = (box: number[], c: number) => {
    let lo = 255, hi = 0
    for (const p of box) {
      const v = data[p * 4 + c]!
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return hi - lo
  }
  while (boxes.length < Math.min(most, LETTERS.length)) {
    // Split the box with the widest spread, at its middle, along that colour.
    let best = -1, bestC = 0, bestR = 0
    boxes.forEach((box, k) => {
      if (box.length < 2) return
      for (let c = 0; c < 3; c++) {
        const r = range(box, c)
        if (r > bestR) { best = k; bestC = c; bestR = r }
      }
    })
    if (best < 0 || bestR < 8) break
    const box = boxes[best]!.sort((a, b) => data[a * 4 + bestC]! - data[b * 4 + bestC]!)
    const half = Math.floor(box.length / 2)
    boxes = [...boxes.slice(0, best), box.slice(0, half), box.slice(half), ...boxes.slice(best + 1)]
  }
  const colors = boxes.map(box => {
    let r = 0, g = 0, b = 0
    for (const p of box) { r += data[p * 4]!; g += data[p * 4 + 1]!; b += data[p * 4 + 2]! }
    return [r / box.length, g / box.length, b / box.length] as [number, number, number]
  })
  const palette: Record<string, string> = {}
  colors.forEach((c, k) => { palette[LETTERS[k]!] = hex(...c) })
  const nearest = (i: number) => {
    let best = 0, bestD = Infinity
    colors.forEach(([r, g, b], k) => {
      const d = (data[i]! - r) ** 2 + (data[i + 1]! - g) ** 2 + (data[i + 2]! - b) ** 2
      if (d < bestD) { bestD = d; best = k }
    })
    return LETTERS[best]!
  }
  const rows: string[] = []
  for (let y = 0; y < h; y++) {
    let row = ''
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      row += data[i + 3] === 0 ? '.' : nearest(i)
    }
    rows.push(row)
  }
  return { rows, palette }
}

/**
 * A dark outline, as pixel art has: the picture with a cell of room each
 * way, and each empty cell beside it (up, down, left, right) filled with
 * a third of the colour it touches, so a red coat gets a dark red edge.
 */
export function outline(img: Rgba): Rgba {
  const w = img.w + 2, h = img.h + 2
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < img.h; y++) out.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((y + 1) * w + 1) * 4)
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && out[(y * w + x) * 4 + 3] !== 0
  const ring: Array<[number, number, number, number]> = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue
      let r = 0, g = 0, b = 0, n = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!solid(x + dx, y + dy)) continue
        const i = ((y + dy) * w + x + dx) * 4
        r += out[i]!; g += out[i + 1]!; b += out[i + 2]!; n++
      }
      if (n > 0) ring.push([(y * w + x) * 4, r / n / 3, g / n / 3, b / n / 3])
    }
  }
  for (const [i, r, g, b] of ring) {
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255
  }
  return { data: out, w, h }
}

/** The whole way: a picture's pixels (changed in place) to a pixel picture. */
export function makePicture(img: Rgba, options: PictureOptions): Picture {
  const border = edges(img.w, img.h)
  const clear = border.filter(p => img.data[p * 4 + 3]! < 128).length >= border.length * 0.5
  const background: Picture['background'] = clear ? 'clear' : options.cutBackground && cutBackground(img) ? 'cut' : 'kept'
  const box = cropBox(img)
  let th = Math.max(8, Math.min(PICTURE_MAX_H, Math.round(options.height)))
  let tw = Math.max(1, Math.round(box.w / box.h * th))
  if (tw > PICTURE_MAX_W) {
    tw = PICTURE_MAX_W
    th = Math.max(1, Math.round(box.h / box.w * tw))
  }
  const small = shrink(img, box, tw, th)
  if (!options.color) return { rows: monoRows(small), w: tw, h: th, background }
  const edged = options.outline === true ? outline(small) : small
  const { rows, palette } = colorRows(edged)
  return { rows, palette, w: edged.w, h: edged.h, background }
}

/** The grids a picture's file may start on, coarsest first (as the workshop offers them, from 默认 up). */
const PICTURE_GRIDS: Array<[number, number]> = [[192, 108], [256, 144], [320, 180], [384, 216]]

/**
 * A 像素动画 file with the picture in it, floating gently, to start from:
 * the AI makes it move after (its prompt says to keep PICTURE as it is).
 */
export function pictureCode(picture: Picture, name: string): string {
  const color = picture.palette !== undefined
  // The coarsest grid it fits in at eight tenths, so a tall picture is not cut off.
  const grid = PICTURE_GRIDS.find(([gw, gh]) => picture.w <= gw * 0.8 && picture.h <= gh * 0.8) ?? PICTURE_GRIDS[PICTURE_GRIDS.length - 1]!
  const rows = picture.rows.map(r => `  '${r}',`).join('\n')
  const palette = color ? `\nconst PALETTE = ${JSON.stringify(picture.palette).replace(/"(\w)":/g, '$1: ').replace(/,/g, ', ')}\n` : ''
  return `// 🖼 用图片转的像素图（${picture.w} × ${picture.h} 格）。
// PICTURE 就是那张图：要它动，就移动、翻转、缩放它，或者复制一份改几格（眨眼、张嘴、抬手）轮着换；不要整个重画。
export const info = { name: ${JSON.stringify(name)}, author: '', grid: [${grid[0]}, ${grid[1]}], fps: 24, seconds: 0, color: '${color ? 'color' : 'mono'}' }

const PICTURE = [
${rows}
]
${palette}
export function frame(g, t) {
  g.clear()
  // 放大到占画面八成，放在中间，轻轻上下浮动
  const s = Math.max(1, Math.floor(Math.min(g.h * 0.8 / PICTURE.length, g.w * 0.8 / PICTURE[0].length)))
  g.sprite(g.w / 2, g.h / 2 + Math.sin(t * 2) * 2, PICTURE, { scale: s, center: true${color ? ', palette: PALETTE' : ''} })
}
`
}
