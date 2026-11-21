/**
 * 导出 GIF (docs/像素导出设计.md): a 像素动画 made into a GIF that plays
 * anywhere — a WeChat sticker first. The frames come from the sandbox as
 * grids (what the file's `frame` filled); here they are joined up, cut to
 * what is drawn, enlarged by whole numbers only (crisp squares), put on a
 * background, given one palette and written out, made smaller until the
 * file fits. Pure: no page, no canvas, so the dsh page and the tests run the
 * same code.
 */

import type { PixelInfo, PixelStyle } from './pixel.ts'
import { encodeGif, type GifSource } from './pixel-gif.ts'
import { GIF_COMMENT, withBrand } from './pixel-brand.ts'

export type Rgb = [number, number, number]

export type ExportPreset = 'wechat' | 'square' | 'whole'

export const EXPORT_PRESETS: Record<ExportPreset, { name: string; about: string; side: number; crop: boolean; square: boolean; budget: number }> = {
  wechat: { name: '微信表情', about: '正方形，透明底，压到 500 KB 以内', side: 240, crop: true, square: true, budget: 500 * 1024 },
  square: { name: '方形大图', about: '头像、朋友圈、小红书', side: 480, crop: true, square: true, budget: 5 * 1024 * 1024 },
  whole: { name: '整个画面', about: '原来的画面，不裁', side: 480, crop: false, square: false, budget: 8 * 1024 * 1024 },
}

/** The longest a GIF runs, and the most frames asked of the sandbox. */
export const EXPORT_MAX_SECONDS = 20
export const EXPORT_MAX_FRAMES = 300
/** Lengths offered when the file does not say when it joins up. */
export const EXPORT_LENGTHS = [2, 3, 4, 6]

/** How one turn is cut: the file says when it looks the same again; it plays once; or we pick a length (joined softly, or not). */
export type JoinWay = 'loop' | 'once' | 'soft' | 'cut'

export interface ExportPlan {
  /** Frames a second in the GIF. */
  fps: number
  /** Seconds of one turn. */
  seconds: number
  join: JoinWay
  /** Times (s) to ask the sandbox for: the turn, then (for 'soft') a little past its end. */
  times: number[]
  /** Frames in the turn (the rest of `times` are for joining). */
  count: number
}

/**
 * What to record: its own loop when it has one; one run when it plays once;
 * else `pick` seconds (default 3), joined softly unless `soft` is false.
 * A frame rate a GIF shows well: 24 → 12, 30 → 15, at most 15.
 */
export function exportPlan(info: Pick<PixelInfo, 'fps' | 'seconds' | 'loop'>, pick?: number, soft = true): ExportPlan {
  const fps = info.fps <= 15 ? info.fps : info.fps % 12 === 0 ? 12 : 15
  let seconds: number
  let join: JoinWay
  if (info.loop !== undefined && info.loop > 0 && info.loop <= EXPORT_MAX_SECONDS) {
    seconds = info.loop
    join = 'loop'
  } else if (info.seconds > 0) {
    seconds = Math.min(info.seconds, EXPORT_MAX_SECONDS)
    join = 'once'
  } else {
    seconds = Math.min(pick ?? 3, EXPORT_MAX_SECONDS)
    join = soft ? 'soft' : 'cut'
  }
  // A whole number of frames in the turn, spaced to fill it exactly (1.2 s at 12 a second is 14 frames
  // of 0.0857 s, not 14 of 0.0833 that stop short): the frame after the last is the first again.
  const count = Math.max(1, Math.min(EXPORT_MAX_FRAMES, Math.round(seconds * fps)))
  const step = seconds / count
  const extra = join === 'soft' ? Math.max(1, Math.round(Math.min(0.6, seconds / 4) / step)) : 0
  const times = Array.from({ length: count + extra }, (_, i) => i * step)
  return { fps: count / seconds, seconds, join, times, count }
}

/**
 * The turn's frames, joined: for 'soft', the first few are blended from the
 * frames one turn later into their own, so the last frame runs on into the
 * first. Grids are RGBA (mono: r = brightness, a = alpha).
 */
export function joinFrames(frames: Uint8ClampedArray[], plan: ExportPlan): Uint8ClampedArray[] {
  const turn = frames.slice(0, plan.count)
  if (plan.join !== 'soft') return turn
  const extra = frames.length - plan.count
  return turn.map((f, i) => {
    if (i >= extra) return f
    const later = frames[i + plan.count]!
    const w = i / extra
    const out = new Uint8ClampedArray(f.length)
    for (let k = 0; k < f.length; k++) out[k] = later[k]! + (f[k]! - later[k]!) * w
    return out
  })
}

export interface ExportLook {
  /** Blocks or dots; code lettering is exported as blocks. */
  style: PixelStyle
  /** The colour of a mono animation. */
  ink: Rgb
  /** 'clear', or #rrggbb behind it. */
  background: string
  /** The little pixel whale in a corner (off unless one asks). */
  mark: boolean
}

export interface Composed {
  width: number
  height: number
  /** One RGBA picture a frame, straight alpha (0 or 255 when the background is clear). */
  frames: Uint8ClampedArray[]
}

/** A cell's colour and how much it shows (0–1). */
const cellOf = (data: Uint8ClampedArray, i: number, mono: boolean, ink: Rgb): [number, number, number, number] =>
  mono ? [ink[0], ink[1], ink[2], (data[i]! * data[i + 3]!) / 65025] : [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]! / 255]

/** The cells drawn in any frame, with one cell round them; the whole grid when nothing is. */
export function drawnBox(frames: Uint8ClampedArray[], gw: number, gh: number, mono: boolean): { x: number; y: number; w: number; h: number } {
  let x0 = gw, y0 = gh, x1 = -1, y1 = -1
  for (const f of frames) {
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = (y * gw + x) * 4
        const shows = mono ? f[i]! * f[i + 3]! > 255 * 16 : f[i + 3]! > 16
        if (!shows) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: gw, h: gh }
  x0 = Math.max(0, x0 - 1)
  y0 = Math.max(0, y0 - 1)
  x1 = Math.min(gw - 1, x1 + 1)
  y1 = Math.min(gh - 1, y1 + 1)
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** How big a cell is drawn, as many pixels a side, for a preset: the largest whole number that fits its size. */
export function cellScale(preset: ExportPreset, box: { w: number; h: number }): number {
  const p = EXPORT_PRESETS[preset]
  const long = Math.max(box.w, box.h)
  return p.square ? Math.max(1, Math.floor(p.side / long)) : Math.max(1, Math.round(p.side / long))
}

/** The little whale (ours): `#` body, `o` eye, `w` spout. */
const WHALE = [
  '...w.w......',
  '....w.......',
  '..#####...##',
  '.#######.##.',
  '##o#######..',
  '#########...',
  '.#######....',
]

const hexRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * The frames as pictures: `box` of the grid, each cell `k` pixels a side,
 * centred on a `width` × `height` picture.
 */
export function compose(
  frames: Uint8ClampedArray[], info: Pick<PixelInfo, 'grid' | 'color'>, look: ExportLook,
  box: { x: number; y: number; w: number; h: number }, k: number, size?: { width: number; height: number },
): Composed {
  const [gw] = info.grid
  const mono = info.color === 'mono'
  const width = size?.width ?? box.w * k, height = size?.height ?? box.h * k
  const left = Math.floor((width - box.w * k) / 2), top = Math.floor((height - box.h * k) / 2)
  const clear = look.background === 'clear'
  const bg: Rgb = clear ? [0, 0, 0] : hexRgb(look.background)
  const dots = mono && look.style === 'dots' && k >= 3
  // The disc of each brightness, as which pixels of a k × k cell it covers (16 sizes).
  const discs = dots ? Array.from({ length: 16 }, (_, level) => {
    const r = ((level + 1) / 16) * k * 0.62
    const cover = new Uint8Array(k * k)
    for (let py = 0; py < k; py++) for (let px = 0; px < k; px++) {
      const dx = px + 0.5 - k / 2, dy = py + 0.5 - k / 2
      cover[py * k + px] = dx * dx + dy * dy <= r * r || (r < 1 && px === Math.floor(k / 2) && py === Math.floor(k / 2)) ? 1 : 0
    }
    return cover
  }) : []
  const out = frames.map(f => {
    const pic = new Uint8ClampedArray(width * height * 4)
    if (!clear) for (let i = 0; i < pic.length; i += 4) {
      pic[i] = bg[0]
      pic[i + 1] = bg[1]
      pic[i + 2] = bg[2]
      pic[i + 3] = 255
    }
    for (let cy = 0; cy < box.h; cy++) {
      for (let cx = 0; cx < box.w; cx++) {
        const gi = ((box.y + cy) * gw + box.x + cx) * 4
        let [r, g, b, a] = cellOf(f, gi, mono, look.ink)
        let cover: Uint8Array | undefined
        if (dots) {
          // A dot: its size is the brightness; it shows fully.
          const v = f[gi]! / 255
          if (v < 0.02 || f[gi + 3]! < 4) continue
          cover = discs[Math.min(15, Math.floor(v * 16))]
          a = f[gi + 3]! / 255
        }
        if (a <= 0.004) continue
        if (clear) {
          // See-through is all or nothing in a GIF: a faint mono cell is drawn darker instead of fainter.
          if (a < (mono ? 0.15 : 0.5)) continue
          if (mono) {
            const shade = 0.35 + 0.65 * Math.min(1, a)
            r *= shade
            g *= shade
            b *= shade
          }
          a = 1
        } else {
          r = bg[0] + (r - bg[0]) * a
          g = bg[1] + (g - bg[1]) * a
          b = bg[2] + (b - bg[2]) * a
          a = 1
        }
        const x0 = left + cx * k, y0 = top + cy * k
        for (let py = 0; py < k; py++) {
          const row = (y0 + py) * width
          for (let px = 0; px < k; px++) {
            if (cover !== undefined && cover[py * k + px] === 0) continue
            const o = (row + x0 + px) * 4
            pic[o] = r
            pic[o + 1] = g
            pic[o + 2] = b
            pic[o + 3] = 255
          }
        }
      }
    }
    if (look.mark) stampWhale(pic, width, height)
    return pic
  })
  return { width, height, frames: out }
}

/** The whale in the bottom right corner, a white edge round it so it shows on anything. */
function stampWhale(pic: Uint8ClampedArray, width: number, height: number): void {
  const s = Math.max(1, Math.floor(Math.min(width, height) / 100))
  const w = WHALE[0]!.length, h = WHALE.length
  const left = width - (w + 2) * s - s * 2, top = height - (h + 2) * s - s * 2
  if (left < 0 || top < 0) return
  const put = (cx: number, cy: number, rgb: Rgb) => {
    for (let py = 0; py < s; py++) for (let px = 0; px < s; px++) {
      const o = ((top + cy * s + py) * width + left + cx * s + px) * 4
      pic[o] = rgb[0]
      pic[o + 1] = rgb[1]
      pic[o + 2] = rgb[2]
      pic[o + 3] = 255
    }
  }
  const at = (x: number, y: number) => WHALE[y]?.[x] ?? '.'
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    if (at(x, y) !== '.') continue
    const near = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => at(x + dx!, y + dy!) !== '.')
    if (near) put(x + 1, y + 1, [255, 255, 255])
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y)
    if (c === '#') put(x + 1, y + 1, [58, 128, 230])
    else if (c === 'o') put(x + 1, y + 1, [20, 30, 60])
    else if (c === 'w') put(x + 1, y + 1, [150, 210, 255])
  }
}

/**
 * One palette for all the frames: every colour when there are at most 255
 * (index 0 is see-through when anything is), else 255 chosen by median cut,
 * each pixel its nearest.
 */
export function quantize(frames: Uint8ClampedArray[]): { palette: number[]; transparent?: number; indices: Uint8Array[] } {
  const counts = new Map<number, number>()
  let see = false
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4) {
      if (f[i + 3]! < 128) {
        see = true
        continue
      }
      const c = (f[i]! << 16) | (f[i + 1]! << 8) | f[i + 2]!
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
  }
  const room = see ? 255 : 256
  const colors = [...counts.keys()]
  let chosen: number[]
  const lookup = new Map<number, number>()
  if (colors.length <= room) {
    chosen = colors
    chosen.forEach((c, k) => lookup.set(c, k + (see ? 1 : 0)))
  } else {
    chosen = medianCut(colors, counts, room)
    const pal = chosen.map(c => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const)
    for (const c of colors) {
      const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255
      let best = 0, bestD = Infinity
      for (let k = 0; k < pal.length; k++) {
        const p = pal[k]!
        const d = (p[0] - r) ** 2 * 3 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 2
        if (d < bestD) {
          bestD = d
          best = k
        }
      }
      lookup.set(c, best + (see ? 1 : 0))
    }
  }
  const palette: number[] = see ? [0, 0, 0] : []
  for (const c of chosen) palette.push((c >> 16) & 255, (c >> 8) & 255, c & 255)
  if (palette.length === 0) palette.push(0, 0, 0)
  const indices = frames.map(f => {
    const out = new Uint8Array(f.length / 4)
    for (let i = 0, p = 0; i < f.length; i += 4, p++) {
      out[p] = f[i + 3]! < 128 ? 0 : lookup.get((f[i]! << 16) | (f[i + 1]! << 8) | f[i + 2]!)!
    }
    return out
  })
  return { palette, ...(see ? { transparent: 0 } : {}), indices }
}

/** `most` colours for `colors`: boxes split at the median of their widest channel, each its weighted mean. */
function medianCut(colors: number[], counts: Map<number, number>, most: number): number[] {
  type Box = number[]
  const ch = (c: number, k: number) => (c >> (16 - k * 8)) & 255
  const range = (box: Box) => {
    let best = 0, widest = -1
    for (let k = 0; k < 3; k++) {
      let lo = 255, hi = 0
      for (const c of box) {
        const v = ch(c, k)
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      if (hi - lo > widest) {
        widest = hi - lo
        best = k
      }
    }
    return { k: best, width: widest }
  }
  const boxes: Box[] = [colors]
  while (boxes.length < most) {
    let pick = -1, score = -1
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b]!
      if (box.length < 2) continue
      let weight = 0
      for (const c of box) weight += counts.get(c)!
      const s = range(box).width * Math.sqrt(weight)
      if (s > score) {
        score = s
        pick = b
      }
    }
    if (pick < 0) break
    const box = boxes[pick]!
    const { k } = range(box)
    box.sort((a, b) => ch(a, k) - ch(b, k))
    let total = 0
    for (const c of box) total += counts.get(c)!
    let run = 0, cut = 1
    for (let i = 0; i < box.length - 1; i++) {
      run += counts.get(box[i]!)!
      if (run >= total / 2) {
        cut = i + 1
        break
      }
    }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut))
  }
  return boxes.map(box => {
    let r = 0, g = 0, b = 0, n = 0
    for (const c of box) {
      const w = counts.get(c)!
      r += ch(c, 0) * w
      g += ch(c, 1) * w
      b += ch(c, 2) * w
      n += w
    }
    return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)
  })
}

/** Hundredths of a second for each frame at `fps`, rounding carried over so the whole is right. */
export function delaysFor(count: number, fps: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.max(2, Math.round((i + 1) * 100 / fps) - Math.round(i * 100 / fps)))
}

export interface ExportInput {
  info: Pick<PixelInfo, 'grid' | 'color'>
  /** The grids from the sandbox, already joined (see joinFrames). */
  frames: Uint8ClampedArray[]
  fps: number
  preset: ExportPreset
  look: ExportLook
  /** The animation, put inside the GIF so it opens again in the workshop (left out when it would not fit). */
  source?: GifSource
}

export interface ExportResult {
  bytes: Uint8Array<ArrayBuffer>
  width: number
  height: number
  frames: number
  fps: number
  /** Within the preset's size. */
  fits: boolean
  /** The animation's file is inside. */
  carries: boolean
}

/**
 * The GIF, made smaller until it fits the preset: fewer frames first (every
 * other one), then smaller cells. The file inside counts too; it is left
 * out when it would take more than a third of the room.
 */
export function makeGif(input: ExportInput): ExportResult {
  const preset = EXPORT_PRESETS[input.preset]
  const [gw, gh] = input.info.grid
  const mono = input.info.color === 'mono'
  const box = preset.crop ? drawnBox(input.frames, gw, gh, mono) : { x: 0, y: 0, w: gw, h: gh }
  const k0 = cellScale(input.preset, box)
  const source = input.source === undefined ? undefined : { ...input.source, code: withBrand(input.source.code) }
  const sourceBytes = source === undefined ? 0 : new TextEncoder().encode(JSON.stringify(source)).length + 64
  const carry = source !== undefined && sourceBytes < preset.budget / 3
  let smallest: ExportResult | undefined
  for (let k = k0; k >= 1; k--) {
    for (const stride of [1, 2]) {
      if (stride === 2 && input.frames.length < 4) continue
      const picked = input.frames.filter((_, i) => i % stride === 0)
      const fps = input.fps / stride
      const long = Math.max(box.w, box.h)
      const side = Math.max(long * k, Math.round(preset.side * k / k0))
      const size = preset.square ? { width: side, height: side } : undefined
      const pics = compose(picked, input.info, input.look, box, k, size)
      const q = quantize(pics.frames)
      const delays = delaysFor(picked.length, fps)
      const bytes = encodeGif({
        width: pics.width, height: pics.height, palette: q.palette, ...(q.transparent === undefined ? {} : { transparent: q.transparent }),
        frames: q.indices.map((indices, i) => ({ indices, delay: delays[i]! })),
        comment: GIF_COMMENT,
        ...(carry ? { source } : {}),
      })
      const result: ExportResult = { bytes, width: pics.width, height: pics.height, frames: picked.length, fps, fits: bytes.length <= preset.budget, carries: carry }
      if (result.fits) return result
      if (smallest === undefined || bytes.length < smallest.bytes.length) smallest = result
    }
  }
  return smallest!
}
