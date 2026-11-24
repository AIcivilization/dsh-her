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
  /** The first frame (the only one of a still picture). */
  rows: string[]
  /** Every frame, the same size, the same palette; one for a still picture. */
  frames: string[][]
  /** Seconds each frame shows, when there are more than one. */
  each?: number
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
 * A green or blue screen keyed softly (docs/像素导出设计.md §9): how much
 * the screen's channel beats the other two, as a share of how much it does
 * on the screen itself, is how see-through a pixel is — so shadows and
 * uneven light on the screen go too, and what is half see-through in front
 * of it (bubbles, a water ribbon, hair) goes as far as the screen shows
 * through. Then the screen's tint is taken out of what is left: its channel
 * no higher than the other two's average. Whether it was a screen.
 */
export function keyScreen(img: Rgba, screen: [number, number, number], lo = 0.18, hi = 0.5): boolean {
  const { data, w, h } = img
  const k = screen.indexOf(Math.max(...screen))
  const [o1, o2] = [0, 1, 2].filter(c => c !== k) as [number, number]
  const strength = screen[k]! - Math.max(screen[o1]!, screen[o2]!)
  if ((k !== 1 && k !== 2) || strength < 50) return false
  const spillAt = (i: number) => (data[i + k]! - Math.max(data[i + o1]!, data[i + o2]!)) / strength
  // Most of the edge has to be the screen.
  const border = edges(w, h)
  if (border.filter(p => spillAt(p * 4) >= hi).length < border.length * 0.5) return false
  for (let i = 0; i < data.length; i += 4) {
    const t = Math.min(1, Math.max(0, (spillAt(i) - lo) / (hi - lo)))
    data[i + 3] = Math.round(data[i + 3]! * (1 - t * t * (3 - 2 * t)))
    const avg = (data[i + o1]! + data[i + o2]!) / 2
    if (data[i + k]! > avg) data[i + k] = avg
  }
  return true
}

/**
 * Take away the background: the colour most of the edge has, and everything
 * of that colour joined to the edge. A green or blue screen is keyed softly
 * instead (keyScreen). Whether there was one.
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
  // A bright, strong colour no one wears by chance: a green or blue screen is keyed softly.
  const vivid = Math.max(br, bg, bb) - Math.min(br, bg, bb) >= 90
  if (vivid && keyScreen(img, [br, bg, bb])) return true
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
  // Another strong colour (red, orange): the patches it leaves shut in go too,
  // and the colour that has spilt onto the edge is taken out.
  if (!vivid) return true
  const key = [br, bg, bb].indexOf(Math.max(br, bg, bb))
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
  return makeFrames([img], options)
}

/** Stacked one under another, to be shrunk to one palette (or one range of lightness) together. */
function stack(frames: Rgba[]): Rgba {
  const w = frames[0]!.w
  const data = new Uint8ClampedArray(frames.reduce((n, f) => n + f.data.length, 0))
  let at = 0
  for (const f of frames) {
    data.set(f.data, at)
    at += f.data.length
  }
  return { data, w, h: data.length / 4 / w }
}

/**
 * Several pictures of one thing moving (frames of a GIF or a video, or
 * pictures chosen together), all the same size, to frames of one pixel
 * picture: each its background taken away, all cut to one box so it does
 * not jump about, one height, one palette. `each`: seconds a frame shows.
 */
export function makeFrames(imgs: Rgba[], options: PictureOptions, each?: number): Picture {
  const backgrounds = imgs.map(img => {
    const border = edges(img.w, img.h)
    const clear = border.filter(p => img.data[p * 4 + 3]! < 128).length >= border.length * 0.5
    return clear ? 'clear' : options.cutBackground && cutBackground(img) ? 'cut' : 'kept'
  })
  const background: Picture['background'] = backgrounds.includes('cut') ? 'cut' : backgrounds.every(b => b === 'clear') ? 'clear' : 'kept'
  // One box round what is in every frame.
  const boxes = imgs.map(cropBox)
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y))
  const box = { x: x0, y: y0, w: Math.max(...boxes.map(b => b.x + b.w)) - x0, h: Math.max(...boxes.map(b => b.y + b.h)) - y0 }
  let th = Math.max(8, Math.min(PICTURE_MAX_H, Math.round(options.height)))
  let tw = Math.max(1, Math.round(box.w / box.h * th))
  if (tw > PICTURE_MAX_W) {
    tw = PICTURE_MAX_W
    th = Math.max(1, Math.round(box.h / box.w * tw))
  }
  const smalls = imgs.map(img => shrink(img, box, tw, th))
  const timing = imgs.length > 1 && each !== undefined ? { each: Math.round(Math.max(0.03, Math.min(2, each)) * 1000) / 1000 } : {}
  if (!options.color) {
    const rows = monoRows(stack(smalls))
    const frames = smalls.map((_, k) => rows.slice(k * th, (k + 1) * th))
    return { rows: frames[0]!, frames, w: tw, h: th, background, ...timing }
  }
  const edged = options.outline === true ? smalls.map(outline) : smalls
  const { rows, palette } = colorRows(stack(edged))
  const h = edged[0]!.h
  const frames = edged.map((_, k) => rows.slice(k * h, (k + 1) * h))
  return { rows: frames[0]!, frames, palette, w: edged[0]!.w, h, background, ...timing }
}

/** How big its file will be, roughly, in bytes: a frame's rows, quoted, one a line. */
export const pictureBytes = (picture: Picture) => picture.frames.length * picture.h * (picture.w + 6) + 2500

export { pictureCode } from './pixel-motion.ts'
