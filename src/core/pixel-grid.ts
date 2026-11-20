/**
 * The grid a 像素动画 fills (`g` in its code; docs/像素动画设计.md §3): four
 * bytes a cell. Mono: [brightness, 0, 0, alpha]; colour: [r, g, b, alpha].
 * Later drawing covers earlier. Pure: runs in the worker and in tests.
 */

export type Paint = number | string

export interface PixelGrid {
  readonly w: number
  readonly h: number
  readonly mode: 'mono' | 'color'
  readonly data: Uint8ClampedArray
  clear(): void
  /** Every cell's alpha times k (0–1): for trails, instead of clear(). */
  fade(k: number): void
  set(x: number, y: number, c?: Paint, a?: number): void
  rgb(x: number, y: number, r: number, g: number, b: number, a?: number): void
  /** A cell's brightness times its alpha, 0–1. */
  get(x: number, y: number): number
  rect(x: number, y: number, w: number, h: number, c?: Paint, a?: number): void
  circle(cx: number, cy: number, r: number, c?: Paint, a?: number): void
  line(x0: number, y0: number, x1: number, y1: number, c?: Paint, a?: number): void
  /** 5 × 7 letters (A–Z, 0–9, common signs; lower case drawn as upper), 6 cells apart; the width drawn. */
  text(x: number, y: number, s: string, c?: Paint, a?: number): number
  random(): number
  /** Smooth noise, 0–1. */
  noise(x: number, y?: number, z?: number): number
  ease: Ease
}

export interface Ease {
  linear(p: number): number
  in(p: number): number
  out(p: number): number
  inOut(p: number): number
  outBack(p: number): number
  sine(p: number): number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const c01 = (p: number) => clamp01(Number.isFinite(p) ? p : 0)

export const EASE: Ease = {
  linear: p => c01(p),
  in: p => c01(p) ** 3,
  out: p => 1 - (1 - c01(p)) ** 3,
  inOut: p => { const t = c01(p); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2 },
  outBack: p => { const t = c01(p) - 1; return 1 + 2.70158 * t * t * t + 1.70158 * t * t },
  sine: p => (1 - Math.cos(Math.PI * c01(p))) / 2,
}

/** #rgb / #rrggbb as [r, g, b]; anything else white. */
export function parseHex(s: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim())
  if (m === null) return [255, 255, 255]
  const hex = m[1]!.length === 3 ? m[1]!.split('').map(ch => ch + ch).join('') : m[1]!
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

/** 5 × 7 glyphs, a row a hex byte (bit 4 the left column). */
const FONT: Record<string, string> = {
  '0': '0E11131519110E', '1': '040C040404040E', '2': '0E11010204081F', '3': '1F02040201110E',
  '4': '02060A121F0202', '5': '1F101E0101110E', '6': '0608101E11110E', '7': '1F010204080808',
  '8': '0E11110E11110E', '9': '0E11110F01020C',
  A: '0E11111F111111', B: '1E11111E11111E', C: '0E11101010110E', D: '1C12111111121C',
  E: '1F10101E10101F', F: '1F10101E101010', G: '0E11101711110F', H: '1111111F111111',
  I: '0E04040404040E', J: '0702020202120C', K: '11121418141211', L: '1010101010101F',
  M: '111B1515111111', N: '11111915131111', O: '0E11111111110E', P: '1E11111E101010',
  Q: '0E11111115120D', R: '1E11111E141211', S: '0F10100E01011E', T: '1F040404040404',
  U: '1111111111110E', V: '11111111110A04', W: '1111111515150A', X: '11110A040A1111',
  Y: '1111110A040404', Z: '1F01020408101F',
  ' ': '00000000000000', '.': '00000000000C0C', ',': '000000000C0408', ':': '000C0C000C0C00',
  ';': '000C0C000C0408', '!': '04040404040004', '?': '0E110102040004', '-': '0000001F000000',
  '+': '0004041F040400', '/': '00010204081000', '(': '02040808080402', ')': '08040202020408',
  '=': '00001F001F0000', '_': '0000000000001F', '<': '02040810080402', '>': '08040201020408',
  '*': '0004150E150400', '#': '0A0A1F0A1F0A0A', '%': '18190204081303', "'": '0C040800000000',
  '"': '0A0A0A00000000', '@': '0E11010D15150E', '[': '0E08080808080E', ']': '0E02020202020E',
  '&': '0C12140815120D', '$': '040F140E051E04', '~': '00000815020000',
}

/** A random number source from a seed (the same every run). */
export function seeded(seed = 0x9e3779b9): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Value noise in three dimensions, 0–1. */
export function noise3(x: number, y = 0, z = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi)
  const at = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz)
  return mix(
    mix(mix(at(0, 0, 0), at(1, 0, 0), xf), mix(at(0, 1, 0), at(1, 1, 0), xf), yf),
    mix(mix(at(0, 0, 1), at(1, 0, 1), xf), mix(at(0, 1, 1), at(1, 1, 1), xf), yf),
    zf,
  )
}

export function makeGrid(w: number, h: number, mode: 'mono' | 'color'): PixelGrid {
  const data = new Uint8ClampedArray(w * h * 4)
  let random = seeded()
  const put = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return
    const i = (yi * w + xi) * 4
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = a * 255
  }
  /** A paint as the cell's channels: mono keeps a brightness (a colour gives its lightness), colour keeps the colour (a number is grey). */
  const channels = (c: Paint = 1): [number, number, number] => {
    if (typeof c === 'string') {
      const [r, g, b] = parseHex(c)
      return mode === 'mono' ? [0.2126 * r + 0.7152 * g + 0.0722 * b, 0, 0] : [r, g, b]
    }
    const v = clamp01(Number.isFinite(c) ? c : 0) * 255
    return mode === 'mono' ? [v, 0, 0] : [v, v, v]
  }
  const paint = (x: number, y: number, c: Paint | undefined, a = 1) => {
    const [r, g, b] = channels(c)
    put(x, y, r, g, b, clamp01(a))
  }
  const grid: PixelGrid = {
    w, h, mode, data,
    clear: () => data.fill(0),
    fade: k => {
      const f = clamp01(k)
      for (let i = 3; i < data.length; i += 4) data[i] = data[i]! * f
    },
    set: (x, y, c, a) => paint(x, y, c, a),
    rgb: (x, y, r, g, b, a = 1) => (mode === 'mono' ? paint(x, y, 0.2126 * r / 255 + 0.7152 * g / 255 + 0.0722 * b / 255, a) : put(x, y, r, g, b, clamp01(a))),
    get: (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y)
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0
      const i = (yi * w + xi) * 4
      const v = mode === 'mono' ? data[i]! : 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
      return (v / 255) * (data[i + 3]! / 255)
    },
    rect: (x, y, rw, rh, c, a) => {
      const [r, g, b] = channels(c)
      const al = clamp01(a ?? 1)
      for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(h, Math.floor(y + rh)); yy++) {
        for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(w, Math.floor(x + rw)); xx++) put(xx, yy, r, g, b, al)
      }
    },
    circle: (cx, cy, rad, c, a) => {
      const [r, g, b] = channels(c)
      const al = clamp01(a ?? 1)
      const r2 = rad * rad
      for (let yy = Math.max(0, Math.floor(cy - rad)); yy <= Math.min(h - 1, Math.ceil(cy + rad)); yy++) {
        for (let xx = Math.max(0, Math.floor(cx - rad)); xx <= Math.min(w - 1, Math.ceil(cx + rad)); xx++) {
          const dx = xx + 0.5 - cx, dy = yy + 0.5 - cy
          if (dx * dx + dy * dy <= r2) put(xx, yy, r, g, b, al)
        }
      }
    },
    line: (x0, y0, x1, y1, c, a) => {
      const [r, g, b] = channels(c)
      const al = clamp01(a ?? 1)
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
      if (steps > 4 * (w + h)) return
      for (let i = 0; i <= steps; i++) put(x0 + (x1 - x0) * i / steps + 0.5, y0 + (y1 - y0) * i / steps + 0.5, r, g, b, al)
    },
    text: (x, y, s, c, a) => {
      const [r, g, b] = channels(c)
      const al = clamp01(a ?? 1)
      let at = Math.floor(x)
      for (const ch of String(s).slice(0, 200).toUpperCase()) {
        const glyph = FONT[ch]
        if (glyph !== undefined) {
          for (let row = 0; row < 7; row++) {
            const bits = parseInt(glyph.slice(row * 2, row * 2 + 2), 16)
            for (let col = 0; col < 5; col++) if (bits & (16 >> col)) put(at + col, Math.floor(y) + row, r, g, b, al)
          }
        }
        at += 6
      }
      return at - Math.floor(x)
    },
    random: () => random(),
    noise: (x, y, z) => noise3(x, y, z),
    ease: EASE,
  }
  // A new run starts the same: `random` begins again when the grid is made.
  random = seeded()
  return grid
}
