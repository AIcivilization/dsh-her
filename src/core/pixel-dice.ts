/**
 * 🎲 掷骰子 (docs/像素工坊设计.md §2): a die of six faces, one way each, each
 * with its own chance; a face's recipes, their numbers, the look, all at
 * random. What comes out is a plain 像素动画 file, the same as one uploaded,
 * so it can be kept as it is or changed after. Pure: no page, no files.
 *
 * A recipe is two pieces of code put into the file: `setup` (once) and `draw`
 * (each frame). In them: `g`, `t`, `P` (its numbers), `K` (how strong this
 * layer is, for the alpha), `R()` (random, seeded, for setup), `Z` (a salt),
 * `W`, `H`, `U` (the grid, and its size against 192 × 108), `S` (state), and
 * the file's helpers `ring` (an ellipse outline) and `hh` (a hash, 0–1).
 * Everything is drawn from `W`, `H`, `U`, so a recipe fits any grid.
 */

import type { PixelLook, PixelStyle } from './pixel.ts'

export type FaceId = 'water' | 'sky' | 'fire' | 'shape' | 'flow' | 'grow'

/** A number of a recipe: low, high, whole or not. */
type Range = [number, number, boolean?]

export interface Recipe {
  id: string
  name: string
  params: Record<string, Range>
  setup?: string
  draw: string
}

export interface Face {
  id: FaceId
  emoji: string
  name: string
  /** Its chance, in hundredths. */
  weight: number
  recipes: Recipe[]
}

const WATER: Recipe[] = [
  {
    id: 'waves', name: '波浪', params: { L: [2, 4, true], amp: [3, 9], speed: [0.6, 2], freq: [6, 18], foam: [0, 1, true] },
    draw: `for (let i = 0; i < P.L; i++) {
  const base = H * (0.3 + 0.6 * (i + 1) / (P.L + 1)), v = 0.35 + 0.65 * (i + 1) / P.L
  for (let x = 0; x < W; x++) {
    const y = base + Math.sin(x / (P.freq * U) + t * P.speed * (1 + i * 0.3) + i * 1.7) * P.amp * U + (g.noise(x / 14, i * 3 + Z, t * 0.5) - 0.5) * P.amp * U
    g.set(x, y, v, K)
    g.set(x, y + 1, v * 0.5, K * 0.6)
    if (P.foam && g.noise(x / 4, i + Z, t * 2) > 0.7) g.set(x, y - 1, 1, K * 0.8)
  }
}`,
  },
  {
    id: 'rain', name: '雨', params: { n: [40, 160, true], speed: [40, 110], len: [3, 8], slant: [-0.4, 0.4], splash: [0, 1, true] },
    setup: `S.d = []
for (let i = 0; i < P.n * W / 192; i++) S.d.push({ x: R() * W, y: R() * (H + 20), s: P.speed * U * (0.7 + 0.6 * R()), l: P.len * U * (0.6 + 0.8 * R()) })`,
    draw: `for (const d of S.d) {
  const span = H + d.l + 4
  const y = (d.y + d.s * t) % span
  const x = ((d.x + P.slant * y) % W + W) % W
  g.line(x - P.slant * d.l, y - d.l, x, y, 0.8, K * 0.9)
  if (P.splash && y > H - 3) { g.set(x - 1, H - 2, 1, K * 0.7); g.set(x + 1, H - 2, 1, K * 0.7) }
}`,
  },
  {
    id: 'ripples', name: '涟漪', params: { n: [3, 7, true], speed: [10, 28], life: [2, 5], rings: [2, 4, true] },
    setup: `S.o = []
for (let i = 0; i < P.n; i++) S.o.push(R() * P.life)`,
    draw: `for (let i = 0; i < P.n; i++) {
  const tt = t + S.o[i], k = Math.floor(tt / P.life), age = tt - k * P.life
  const x = (0.1 + 0.8 * hh(i * 31 + k, Z)) * W, y = (0.15 + 0.7 * hh(i * 17 + k, Z + 1)) * H
  const fade = 1 - age / P.life
  for (let r = 0; r < P.rings; r++) {
    const rad = age * P.speed * U - r * 5 * U
    if (rad > 0.5) ring(g, x, y, rad, rad * 0.45, 0.5 + 0.5 * fade, K * fade)
  }
  if (age < 0.3) g.circle(x, y, 1.5 * U, 1, K)
}`,
  },
  {
    id: 'bubbles', name: '气泡', params: { n: [15, 60, true], speed: [8, 24], size: [1.2, 3.5], wobble: [1, 4] },
    setup: `S.b = []
for (let i = 0; i < P.n * W / 192; i++) S.b.push({ x: R() * W, p: R(), s: P.speed * U * (0.6 + 0.8 * R()), r: Math.max(1, P.size * U * (0.5 + R())) })`,
    draw: `for (const b of S.b) {
  const span = H + b.r * 2 + 4
  const y = H + b.r - ((b.p * span + b.s * t) % span)
  const x = b.x + Math.sin(t * 1.5 + b.p * 20) * P.wobble * U
  ring(g, x, y, b.r, b.r, 0.8, K * 0.8)
  g.set(x - b.r * 0.4, y - b.r * 0.4, 1, K)
}`,
  },
]

const SKY: Recipe[] = [
  {
    id: 'stars', name: '星空', params: { n: [60, 260, true], tw: [0.5, 3], big: [0, 0.15] },
    setup: `S.s = []
for (let i = 0; i < P.n * W * H / (192 * 108); i++) S.s.push({ x: R() * W, y: R() * H, p: R(), b: 0.35 + 0.65 * R(), big: R() < P.big })`,
    draw: `for (const s of S.s) {
  const v = s.b * (0.55 + 0.45 * Math.sin(t * P.tw * (0.5 + s.p) + s.p * 40))
  g.set(s.x, s.y, v, K)
  if (s.big) { g.set(s.x - 1, s.y, v * 0.6, K); g.set(s.x + 1, s.y, v * 0.6, K); g.set(s.x, s.y - 1, v * 0.6, K); g.set(s.x, s.y + 1, v * 0.6, K) }
}`,
  },
  {
    id: 'meteors', name: '流星', params: { n: [40, 140, true], rate: [0.6, 2], len: [8, 20], speed: [70, 150], ang: [0.25, 0.6] },
    setup: `S.s = []
for (let i = 0; i < P.n * W * H / (192 * 108); i++) S.s.push({ x: R() * W, y: R() * H, p: R(), b: 0.2 + 0.4 * R() })`,
    draw: `for (const s of S.s) g.set(s.x, s.y, s.b * (0.7 + 0.3 * Math.sin(t * 2 + s.p * 30)), K)
const m = Math.floor(t * P.rate), dx = -Math.cos(P.ang), dy = Math.sin(P.ang)
for (let j = 0; j < 4; j++) {
  const id = m - j, age = t - id / P.rate, life = 1.2
  if (id < 0 || age > life) continue
  const x0 = (0.3 + 0.9 * hh(id, Z)) * W, y0 = hh(id, Z + 7) * H * 0.4
  const hx = x0 + dx * P.speed * U * age, hy = y0 + dy * P.speed * U * age
  const fade = 1 - age / life, L = P.len * U
  for (let i = 0; i < L; i++) g.set(hx - dx * i, hy - dy * i, 1 - i / L, K * fade)
}`,
  },
  {
    id: 'aurora', name: '极光', params: { bands: [2, 4, true], speed: [0.1, 0.5], height: [0.25, 0.5] },
    draw: `for (let i = 0; i < P.bands; i++) {
  const h = P.height * H * (0.7 + 0.3 * hh(i, Z))
  for (let x = 0; x < W; x++) {
    const c = H * (0.12 + 0.18 * i) + (g.noise(x / (40 * U), i + Z, t * P.speed) - 0.5) * H * 0.35
    const col = g.noise(x / (9 * U), i * 5 + Z, t * P.speed * 3)
    if (col < 0.35) continue
    const top = (col - 0.35) * 1.6
    for (let d = 0; d < h; d++) {
      const v = top * (1 - d / h) * (0.6 + 0.4 * Math.sin(d * 0.5 - t * 3 + x * 0.05))
      if (v > 0.04) g.set(x, c + d, v, K)
      else if (top * (1 - d / h) < 0.04) break
    }
  }
}`,
  },
  {
    id: 'clouds', name: '云', params: { sc: [18, 45], speed: [2, 10], cover: [0.42, 0.58] },
    draw: `const s = P.sc * U
for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
  const n = g.noise((x + t * P.speed * U) / s, y / s * 1.7, t * 0.05 + Z)
  if (n > P.cover) g.rect(x, y, 2, 2, Math.min(1, (n - P.cover) / (1 - P.cover) * 1.8), K)
}`,
  },
]

const FIRE: Recipe[] = [
  {
    id: 'flames', name: '火焰', params: { sc: [6, 14], speed: [10, 30], height: [0.4, 0.8], sparks: [0, 30, true] },
    draw: `const h = P.height * H, top = H - h, st = W > 200 ? 2 : 1
for (let y = Math.floor(top); y < H; y++) {
  const heat = (y - top) / h
  for (let x = 0; x < W; x += st) {
    const f = g.noise(x / (P.sc * U), (y + t * P.speed * U) / (P.sc * U), t * 0.3 + Z)
    const edge = 1 - Math.abs(x / W - 0.5) * 1.2
    const v = heat * edge * 1.6 * f - 0.3
    if (v > 0.03) g.rect(x, y, st, 1, Math.min(1, v), K)
  }
}
for (let i = 0; i < P.sparks; i++) {
  const life = 1.5, tt = t + i * 0.37, k = Math.floor(tt / life), age = tt - k * life
  g.set((0.2 + 0.6 * hh(i + k * 13, Z)) * W + Math.sin(age * 5 + i) * 3, H - age * h * 0.9, 1, K * (1 - age / life))
}`,
  },
  {
    id: 'fireworks', name: '烟花', params: { rate: [0.6, 1.6], n: [30, 80, true], size: [25, 50], grav: [10, 40] },
    draw: `const m = Math.floor(t * P.rate)
for (let j = 0; j < 4; j++) {
  const id = m - j
  if (id < 0) continue
  const age = t - id / P.rate
  const bx = (0.15 + 0.7 * hh(id, Z)) * W, by = (0.15 + 0.35 * hh(id, Z + 3)) * H
  const rise = 0.5
  if (age < rise) { const y = H - (H - by) * (age / rise); g.line(bx, y, bx, y + 3 * U, 1, K); continue }
  const a = age - rise, life = 1.6
  if (a > life) continue
  const fade = 1 - a / life, r = P.size * U * (1 - Math.exp(-a * 3))
  for (let i = 0; i < P.n; i++) {
    const q = i / P.n * Math.PI * 2 + hh(id, Z + 5) * 6, sp = 0.6 + 0.4 * hh(id * 97 + i, Z)
    const x = bx + Math.cos(q) * r * sp, y = by + Math.sin(q) * r * sp + P.grav * U * a * a * 0.5
    g.set(x, y, 1, K * fade)
    g.set(x - Math.cos(q) * 2, y - Math.sin(q) * 2, 0.6, K * fade * 0.6)
  }
}`,
  },
  {
    id: 'fireflies', name: '萤火虫', params: { n: [12, 50, true], speed: [0.02, 0.08], blink: [0.3, 1.5] },
    setup: `S.f = []
for (let i = 0; i < P.n; i++) S.f.push({ p: R() * 100, q: R() * 100, b: R() * 10, k: 0.5 + R() })`,
    draw: `for (const f of S.f) {
  const x = (g.noise(f.p, t * P.speed, Z) * 1.6 - 0.3) * W, y = (g.noise(f.q, t * P.speed, Z + 9) * 1.6 - 0.3) * H
  const v = Math.pow(Math.max(0, Math.sin(t * P.blink * f.k * 3 + f.b)), 2)
  if (v < 0.05) continue
  g.circle(x, y, 1.6 * U, v, K)
  ring(g, x, y, 3 * U, 3 * U, v * 0.4, K * 0.5)
}`,
  },
  {
    id: 'lightning', name: '闪电', params: { rate: [0.4, 1.2], branches: [1, 3, true], jag: [3, 8] },
    draw: `const m = Math.floor(t * P.rate), age = t - m / P.rate
for (let x = 0; x < W; x++) g.set(x, 2 * U + g.noise(x / 10, Z, t * 0.3) * 4 * U, 0.3, K * 0.6)
if (age < 0.45) {
  const flick = (age < 0.08 || (age > 0.16 && age < 0.24)) ? 1 : 0.35
  const bolt = (x, y, len, b, d) => {
    let px = x, py = y
    for (let i = 0; i < len; i++) {
      const nx = px + (hh(m * 131 + b * 17 + i, Z) - 0.5) * P.jag * U * 2, ny = py + P.jag * U
      g.line(px, py, nx, ny, 1, K * flick)
      if (d > 0 && hh(m * 7 + b * 3 + i, Z + 2) < 0.12) bolt(nx, ny, Math.floor(len * 0.4), b * 2 + i, d - 1)
      px = nx
      py = ny
      if (py > H) break
    }
  }
  bolt((0.2 + 0.6 * hh(m, Z)) * W, 0, Math.ceil(H / (P.jag * U)), 1, P.branches)
}`,
  },
]

const SHAPE: Recipe[] = [
  {
    id: 'kaleido', name: '万花筒', params: { sym: [5, 10, true], pts: [40, 90, true], speed: [0.2, 0.8], twist: [2, 6] },
    draw: `const cx = W / 2, cy = H / 2, R0 = Math.min(W, H) * 0.46
for (let k = 0; k < P.pts; k++) {
  const s = k / P.pts
  const r = R0 * s * (0.6 + 0.4 * g.noise(s * 3, t * 0.4, Z))
  const a0 = s * P.twist + t * P.speed + (g.noise(s * 2, t * 0.3, Z + 4) - 0.5) * 2
  const v = 0.4 + 0.6 * Math.sin(s * 9 - t * 2) ** 2
  for (let j = 0; j < P.sym; j++) {
    for (const m of [1, -1]) {
      const a = m * a0 + j * Math.PI * 2 / P.sym
      g.circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.8 * U + s * 1.2 * U, v, K)
    }
  }
}`,
  },
  {
    id: 'lissajous', name: '李萨如曲线', params: { a: [1, 5, true], b: [2, 6, true], ps: [0.2, 1], n: [300, 900, true] },
    draw: `const cx = W / 2, cy = H / 2, rx = W * 0.42, ry = H * 0.42
let px = 0, py = 0
for (let i = 0; i <= P.n; i++) {
  const s = i / P.n * Math.PI * 2
  const x = cx + Math.sin(P.a * s + t * P.ps) * rx, y = cy + Math.sin(P.b * s + t * P.ps * 0.37) * ry
  if (i > 0) g.line(px, py, x, y, 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s * 3 - t * 3)), K)
  px = x
  py = y
}`,
  },
  {
    id: 'polygons', name: '旋转多边形', params: { sides: [3, 8, true], count: [3, 8, true], speed: [0.2, 1], twist: [0.1, 0.6] },
    draw: `const cx = W / 2, cy = H / 2, R0 = Math.min(W, H) * 0.47
for (let i = 0; i < P.count; i++) {
  const r = R0 * (i + 1) / P.count * (0.85 + 0.15 * Math.sin(t * 1.3 + i))
  const a0 = t * P.speed * (1 + i * P.twist) * (i % 2 ? -1 : 1)
  const v = 0.4 + 0.6 * (i + 1) / P.count
  for (let k = 0; k < P.sides; k++) {
    const a = a0 + k / P.sides * Math.PI * 2, b = a0 + (k + 1) / P.sides * Math.PI * 2
    g.line(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(b) * r, cy + Math.sin(b) * r, v, K)
  }
}`,
  },
  {
    id: 'spiral', name: '螺旋', params: { arms: [1, 5, true], turns: [1.5, 5], speed: [0.5, 2], n: [120, 300, true] },
    draw: `const cx = W / 2, cy = H / 2, R0 = Math.min(W, H) * 0.48
for (let j = 0; j < P.arms; j++) for (let i = 0; i < P.n; i++) {
  const s = i / P.n, r = R0 * s, a = s * P.turns * Math.PI * 2 + j * Math.PI * 2 / P.arms - t * P.speed
  const v = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(s * 18 - t * 4))
  g.circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.6 + s * 1.4 * U, v, K)
}`,
  },
]

const FLOW: Recipe[] = [
  {
    id: 'digits', name: '数字雨', params: { dens: [0.35, 0.8], speed: [30, 90], len: [6, 16, true] },
    setup: `S.c = []
for (let x = 0; x < W; x += 6) if (R() < P.dens) S.c.push({ x, o: R() * 50, s: P.speed * (0.6 + 0.8 * R()) })`,
    draw: `const CH = '0123456789ABCDEF<>=+*#'
const span = H / 8 + P.len + 2
for (const c of S.c) {
  const head = (c.o + c.s * t / 8) % span
  for (let k = 0; k < P.len; k++) {
    const row = Math.floor(head) - k
    if (row < 0 || row * 8 > H) continue
    const ch = CH[Math.floor(hh(c.x * 7 + row, Math.floor(t * 6 + k) + Z) * CH.length)]
    g.text(c.x, row * 8, ch, k === 0 ? 1 : 0.85 - 0.75 * k / P.len, K)
  }
}`,
  },
  {
    id: 'field', name: '流场', params: { n: [150, 450, true], sc: [20, 50], speed: [15, 40], trail: [4, 12, true] },
    setup: `S.p = []
for (let i = 0; i < P.n * W * H / (192 * 108); i++) S.p.push({ x: R() * W, y: R() * H, h: [] })
S.last = -1`,
    draw: `if (t < S.last) for (const p of S.p) p.h.length = 0
const dt = S.last < 0 || t < S.last ? 1 / 24 : Math.min(0.2, t - S.last)
S.last = t
for (const p of S.p) {
  const a = g.noise(p.x / (P.sc * U), p.y / (P.sc * U), t * 0.1 + Z) * Math.PI * 4
  p.x += Math.cos(a) * P.speed * U * dt
  p.y += Math.sin(a) * P.speed * U * dt
  if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H) { p.x = hh(p.x * 13 + t, Z) * W; p.y = hh(p.y * 7 + t, Z + 1) * H; p.h.length = 0 }
  p.h.push(p.x, p.y)
  if (p.h.length > P.trail * 2) p.h.splice(0, 2)
  for (let i = 0; i < p.h.length; i += 2) g.set(p.h[i], p.h[i + 1], 0.25 + 0.75 * i / p.h.length, K)
}`,
  },
  {
    id: 'swarm', name: '粒子群', params: { n: [60, 200, true], groups: [1, 3, true], spread: [10, 30], speed: [0.3, 1] },
    setup: `S.p = []
for (let i = 0; i < P.n; i++) S.p.push({ g: i % P.groups, r: R(), a: R() * 6.28, w: 0.5 + R() * 1.5 })`,
    draw: `for (const p of S.p) {
  const gx = W / 2 + Math.sin(t * P.speed * (0.7 + p.g * 0.3) + p.g * 2) * W * 0.32
  const gy = H / 2 + Math.cos(t * P.speed * (1.1 + p.g * 0.2) + p.g) * H * 0.3
  for (let k = 0; k < 3; k++) {
    const tt = t - k * 0.06
    const rad = P.spread * U * (0.3 + p.r) * (0.7 + 0.3 * Math.sin(tt * 2 + p.a))
    const x = gx + Math.cos(p.a + tt * p.w * 2) * rad, y = gy + Math.sin(p.a + tt * p.w * 2) * rad * 0.7
    g.set(x, y, 1 - k * 0.3, K * (1 - k * 0.3))
  }
}`,
  },
  {
    id: 'tunnel', name: '隧道', params: { rings: [8, 16, true], speed: [0.5, 2], sides: [0, 6, true], wob: [0.03, 0.12] },
    draw: `const cx = W / 2, cy = H / 2, R0 = Math.hypot(W, H) * 0.55
for (let k = 0; k < P.rings; k++) {
  const z = ((k + t * P.speed) % P.rings) / P.rings, r = z * z * R0
  if (r < 1) continue
  const x = cx + Math.sin(t * 0.7 + z * 3) * W * P.wob * (1 - z), y = cy + Math.cos(t * 0.5 + z * 3) * H * P.wob * (1 - z)
  if (P.sides < 3) ring(g, x, y, r, r * 0.75, z, K)
  else for (let i = 0; i < P.sides; i++) {
    const a = i / P.sides * Math.PI * 2 + z * 1.5 + t * 0.2, b = (i + 1) / P.sides * Math.PI * 2 + z * 1.5 + t * 0.2
    g.line(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.75, x + Math.cos(b) * r, y + Math.sin(b) * r * 0.75, z, K)
  }
}`,
  },
]

const GROW: Recipe[] = [
  {
    id: 'life', name: '生命游戏', params: { dens: [0.2, 0.42], cs: [2, 3, true], rate: [6, 12] },
    setup: `S.w = Math.floor(W / P.cs)
S.h = Math.floor(H / P.cs)
S.seed = () => {
  S.a = new Uint8Array(S.w * S.h)
  S.age = new Float32Array(S.w * S.h).fill(99)
  for (let i = 0; i < S.a.length; i++) S.a[i] = R() < P.dens ? 1 : 0
  S.n = 0
}
S.step = () => {
  const w = S.w, h = S.h, a = S.a, b = new Uint8Array(w * h)
  let live = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) c += a[((y + dy + h) % h) * w + (x + dx + w) % w]
    const i = y * w + x, v = a[i] ? (c === 2 || c === 3 ? 1 : 0) : (c === 3 ? 1 : 0)
    b[i] = v
    live += v
    S.age[i] = v ? 0 : S.age[i] + 1
  }
  S.a = b
  S.n++
  if (live < b.length * 0.03 || S.n > 400) {
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(R() * w), y = Math.floor(R() * h)
      b[y * w + x] = 1; b[y * w + (x + 1) % w] = 1; b[((y + 1) % h) * w + x] = 1
    }
    S.n = 0
  }
}
S.seed()
S.last = -1
S.k = 0`,
    draw: `if (t < S.last) { S.seed(); S.k = 0 }
S.last = t
const target = Math.floor(t * P.rate)
for (let guard = 0; S.k < target && guard < 4; guard++) { S.step(); S.k++ }
if (S.k < target) S.k = target
const c = P.cs > 2 ? P.cs - 1 : P.cs
for (let i = 0; i < S.a.length; i++) {
  const v = S.a[i] ? 1 : S.age[i] < 4 ? 0.35 - S.age[i] * 0.08 : 0
  if (v > 0) g.rect((i % S.w) * P.cs, Math.floor(i / S.w) * P.cs, c, c, v, K)
}`,
  },
  {
    id: 'tree', name: '分形树', params: { depth: [6, 9, true], ang: [0.3, 0.6], sway: [0.02, 0.12], cycle: [5, 9] },
    draw: `const ph = (t % P.cycle) / P.cycle, grow = Math.min(1, ph * 2.2), fade = ph > 0.85 ? (1 - ph) / 0.15 : 1
const br = (x, y, len, a, d) => {
  const lv = P.depth - d
  const local = Math.max(0, Math.min(1, grow * P.depth - lv))
  if (local <= 0) return
  const aa = a + Math.sin(t * 1.3 + lv * 0.7 + Z) * P.sway * lv
  const x2 = x + Math.cos(aa) * len * local, y2 = y - Math.sin(aa) * len * local
  g.line(x, y, x2, y2, 0.45 + 0.55 * (1 - lv / P.depth), K * fade)
  if (local < 1) return
  if (d > 1) { br(x2, y2, len * 0.74, aa + P.ang, d - 1); br(x2, y2, len * 0.74, aa - P.ang * (0.8 + 0.4 * hh(d, Z)), d - 1) }
  else g.circle(x2, y2, 1.1 * U, 1, K * fade)
}
br(W / 2, H, H * 0.26, Math.PI / 2, P.depth)`,
  },
  {
    id: 'snow', name: '雪花', params: { n: [3, 8, true], size: [8, 18], rot: [0.1, 0.6], fall: [3, 10] },
    setup: `S.f = []
for (let i = 0; i < P.n; i++) S.f.push({ x: R() * W, y: R(), s: P.size * U * (0.6 + 0.8 * R()), b: 2 + Math.floor(R() * 3), r: R() * 6 })`,
    draw: `for (const f of S.f) {
  const span = H + f.s * 2
  const y = ((f.y * span + P.fall * U * t) % span) - f.s
  const x = f.x + Math.sin(t * 0.6 + f.r) * 4 * U
  const a0 = t * P.rot + f.r
  for (let k = 0; k < 6; k++) {
    const a = a0 + k * Math.PI / 3, c = Math.cos(a), s = Math.sin(a)
    g.line(x, y, x + c * f.s, y + s * f.s, 0.9, K)
    for (let j = 1; j <= f.b; j++) {
      const d = f.s * j / (f.b + 1), l = f.s * 0.35 * (1 - j / (f.b + 1.5))
      for (const m of [1, -1]) { const b = a + m * 0.8; g.line(x + c * d, y + s * d, x + c * d + Math.cos(b) * l, y + s * d + Math.sin(b) * l, 0.7, K) }
    }
  }
}`,
  },
  {
    id: 'vines', name: '藤蔓', params: { n: [3, 7, true], curl: [3, 9], speed: [0.15, 0.4], leaves: [0, 1, true] },
    setup: `S.v = []
for (let i = 0; i < P.n; i++) S.v.push({ x: (i + 0.5) / P.n * W + (R() - 0.5) * W / P.n, p: R() * 6, a: (0.04 + R() * 0.08) * W })`,
    draw: `const cyc = 1 / P.speed, ph = (t % cyc) / cyc, reach = Math.min(1, 0.08 + ph * 1.4), fade = ph > 0.85 ? (1 - ph) / 0.15 : 1
for (const v of S.v) {
  let px = v.x, py = H
  for (let i = 1; i <= 80 * reach; i++) {
    const s = i / 80
    const x = v.x + Math.sin(s * P.curl + v.p) * v.a * s, y = H - s * H * 0.92
    g.line(px, py, x, y, 0.6 + 0.4 * s, K * fade)
    if (P.leaves && i % 8 === 0) g.circle(x + ((i / 8) % 2 ? 2.5 : -2.5) * U, y, 1.3 * U, 0.9, K * fade)
    px = x
    py = y
  }
}`,
  },
]

export const FACES: Face[] = [
  { id: 'water', emoji: '🌊', name: '水', weight: 22, recipes: WATER },
  { id: 'sky', emoji: '🌌', name: '天空', weight: 20, recipes: SKY },
  { id: 'fire', emoji: '🔥', name: '光与火', weight: 18, recipes: FIRE },
  { id: 'shape', emoji: '🔷', name: '几何', weight: 16, recipes: SHAPE },
  { id: 'flow', emoji: '🌀', name: '流动', weight: 14, recipes: FLOW },
  { id: 'grow', emoji: '🌱', name: '生长', weight: 10, recipes: GROW },
]

/** The grids a roll may take: 中, 默认, 细. */
export const DICE_GRIDS: Array<{ grid: [number, number]; weight: number }> = [
  { grid: [160, 90], weight: 30 }, { grid: [192, 108], weight: 50 }, { grid: [256, 144], weight: 20 },
]
const STYLES: Array<{ style: PixelStyle; weight: number }> = [{ style: 'dots', weight: 45 }, { style: 'blocks', weight: 35 }, { style: 'code', weight: 20 }]
const FPS: Array<{ fps: number; weight: number }> = [{ fps: 24, weight: 70 }, { fps: 30, weight: 15 }, { fps: 15, weight: 15 }]

/** One of a weighted list. */
function weighted<T extends { weight: number }>(list: T[], random: () => number): T {
  const total = list.reduce((s, x) => s + x.weight, 0)
  let r = random() * total
  for (const x of list) {
    r -= x.weight
    if (r < 0) return x
  }
  return list[list.length - 1]!
}

export const pickFace = (random: () => number = Math.random): Face => weighted(FACES, random)

/** The numbers of a recipe, at random within their ranges. */
export function pickParams(recipe: Recipe, random: () => number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, [lo, hi, whole]] of Object.entries(recipe.params)) {
    const v = lo + (hi - lo) * random()
    out[key] = whole === true ? Math.min(hi, Math.round(v)) : Math.round(v * 1000) / 1000
  }
  return out
}

/** A colour from the wheel: hue 0–360, saturation and lightness 0–1. */
export function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** What a colour is called, for a name: by its hue. */
export function hueName(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (m === null) return ''
  const n = parseInt(m[1]!, 16)
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max - min < 0.08) return '银'
  let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
  h = (h * 60 + 360) % 360
  const names: Array<[number, string]> = [[15, '红'], [42, '橙'], [68, '金'], [160, '绿'], [195, '青'], [250, '蓝'], [290, '紫'], [335, '粉'], [361, '红']]
  return names.find(([upTo]) => h < upTo)![1]
}

export interface Layer {
  face: FaceId
  recipe: string
  params: Record<string, number>
  seed: number
  /** How strong it is (alpha times this): 1 on top, less underneath. */
  k: number
}

export interface DiceSpec {
  name: string
  grid: [number, number]
  fps: number
  seconds: number
  /** Bottom first. */
  layers: Layer[]
}

const findRecipe = (face: FaceId, id: string) => FACES.find(f => f.id === face)?.recipes.find(r => r.id === id)
const indent = (code: string, by: string) => code.split('\n').map(line => (line === '' ? line : by + line)).join('\n')

/** The file for a spec: a plain 像素动画. */
export function diceCode(spec: DiceSpec): string {
  const top = spec.layers[spec.layers.length - 1]!
  const label = (l: Layer) => {
    const face = FACES.find(f => f.id === l.face)!
    return `${face.emoji} ${face.name} · ${findRecipe(l.face, l.recipe)!.name}`
  }
  const under = spec.layers.length > 1 ? `（叠在 ${spec.layers.slice(0, -1).map(label).join('、')} 上面）` : ''
  const layers = spec.layers.map(l => {
    const recipe = findRecipe(l.face, l.recipe)
    if (recipe === undefined) throw new Error(`没有这个配方：${l.face}/${l.recipe}`)
    return `  // ${label(l)}
  (function () {
    const P = ${JSON.stringify(l.params).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')}
    const K = ${l.k}, Z = ${l.seed % 997}, R = rng(${l.seed})
    const S = {}
    let W = 0, H = 0, U = 1
    function setup(g) {
      W = g.w; H = g.h; U = Math.min(W / 192, H / 108)
${recipe.setup === undefined ? '' : indent(recipe.setup, '      ')}
    }
    function draw(g, t) {
${indent(recipe.draw, '      ')}
    }
    return { setup, draw }
  })(),`
  }).join('\n')
  return `// 🎲 掷骰子：${label(top)}${under}
// 这是一个普通的 dsh-her 像素动画，可以接着改，也可以直接用。
export const info = { name: ${JSON.stringify(spec.name)}, author: 'dsh-her 骰子', grid: [${spec.grid[0]}, ${spec.grid[1]}], fps: ${spec.fps}, seconds: ${spec.seconds}, color: 'mono' }

// 随机数（有种子，每次播放都一样）
function rng(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
// 0–1 之间的散列：同样的 n、k 总是同一个数
function hh(n, k) {
  const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453
  return x - Math.floor(x)
}
// 椭圆的轮廓
function ring(g, x, y, rx, ry, v, a) {
  const n = Math.max(8, Math.min(900, Math.ceil((rx + ry) * 3)))
  for (let i = 0; i < n; i++) {
    const q = i / n * Math.PI * 2
    g.set(x + Math.cos(q) * rx, y + Math.sin(q) * ry, v, a)
  }
}

// 一层一层画，先画的在下面
const layers = [
${layers}
]

export function setup(g) {
  for (const l of layers) l.setup(g)
}

export function frame(g, t) {
  g.clear()
  for (const l of layers) l.draw(g, t)
}
`
}

export interface DiceRoll {
  face: Face
  recipe: Recipe
  /** The face and recipe underneath, when two were mixed. */
  under?: { face: Face; recipe: Recipe }
  spec: DiceSpec
  look: PixelLook
  code: string
  /** How alike two rolls are: the same print, too alike. */
  print: string
}

const bucket = (recipe: Recipe, params: Record<string, number>) =>
  Object.entries(recipe.params).map(([key, [lo, hi]]) => Math.min(2, Math.floor(((params[key]! - lo) / (hi - lo || 1)) * 3))).join('')

function rollOnce(random: () => number): DiceRoll {
  const face = pickFace(random)
  const recipe = face.recipes[Math.floor(random() * face.recipes.length)]!
  const seed = 1 + Math.floor(random() * 2_000_000_000)
  const params = pickParams(recipe, random)
  const layers: Layer[] = [{ face: face.id, recipe: recipe.id, params, seed, k: 1 }]
  let under: DiceRoll['under']
  if (random() < 0.15) {
    const uf = pickFace(random)
    const ur = uf.recipes.filter(r => r.id !== recipe.id)[Math.floor(random() * (uf.recipes.length - (uf.id === face.id ? 1 : 0)))]!
    under = { face: uf, recipe: ur }
    layers.unshift({ face: uf.id, recipe: ur.id, params: pickParams(ur, random), seed: 1 + Math.floor(random() * 2_000_000_000), k: Math.round((0.3 + random() * 0.2) * 100) / 100 })
  }
  const grid = weighted(DICE_GRIDS, random).grid
  const fps = weighted(FPS, random).fps
  const seconds = random() < 0.5 ? 0 : 3 + Math.floor(random() * 6)
  const style = weighted(STYLES, random).style
  const color = random() < 0.1 ? 'theme' : hslHex(random() * 360, 0.6 + random() * 0.3, 0.55 + random() * 0.17)
  const hue = color === 'theme' ? '' : `${hueName(color)}色`
  const name = `${hue}${recipe.name}${under === undefined ? '' : `·${under.recipe.name}`}`
  const spec: DiceSpec = { name, grid, fps, seconds, layers }
  return {
    face, recipe, ...(under === undefined ? {} : { under }), spec,
    look: { style, color, size: 1, fit: 'contain' },
    code: diceCode(spec),
    print: `${recipe.id}:${bucket(recipe, params)}${under === undefined ? '' : `+${under.recipe.id}`}:${style}:${grid[0]}`,
  }
}

/**
 * Roll the die. `recent`: the prints of the last rolls, newest first (we keep
 * 50): a roll too like one of them, or the same recipe as the last, is rolled
 * again, up to five times.
 */
export function rollDice(recent: string[] = [], random: () => number = Math.random): DiceRoll {
  const last = recent[0]?.split(':')[0]
  let roll = rollOnce(random)
  for (let i = 0; i < 5 && (recent.includes(roll.print) || roll.recipe.id === last); i++) roll = rollOnce(random)
  return roll
}
