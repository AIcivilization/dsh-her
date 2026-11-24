/**
 * The 像素动画 that come with her (docs/像素动画设计.md §10): code of our own,
 * written in the same format as anyone's upload. Pure (strings).
 */

const WAVES = `// 浪花：一道浪涌起来，浪尖碎成水花落下。适合开机动画。
export const info = { name: '浪花', author: 'dsh-her', grid: [192, 108], fps: 24, seconds: 4, color: 'mono' }

const drops = []

export function setup(g) {
  for (let i = 0; i < 180; i++) {
    drops.push({ x: 64 + g.random() * 64, vx: (g.random() - 0.5) * 56, vy: -28 - g.random() * 56, delay: g.random() * 0.7 })
  }
}

export function frame(g, t) {
  g.clear()
  // 浪慢慢涌起来，中间最高
  const swell = g.ease.sine(Math.min(1, t / 1.2)) * (1 - g.ease.in(Math.max(0, (t - 2.4) / 1.6)))
  for (let x = 0; x < g.w; x++) {
    const surface = 80 - swell * 26 * Math.exp(-(((x - 96) / 30) ** 2)) + Math.sin(x / 9 + t * 3) * 1.6 + (g.noise(x / 14, t * 0.8) - 0.5) * 4
    for (let y = Math.max(0, Math.floor(surface) + 1); y < g.h; y++) {
      const depth = Math.min(1, (y - surface) / 22)
      g.set(x, y, 0.25 + 0.75 * g.noise(x / 6, y / 4, t * 1.5), (1 - depth) * 0.8)
    }
    g.set(x, surface, 1, 1)
  }
  // 浪尖碎开以后，水花抛起来再落回去
  for (const d of drops) {
    const s = t - 1 - d.delay
    if (s < 0) continue
    const y = 56 + d.vy * s + 42 * s * s
    if (y > 80) continue
    g.set(d.x + d.vx * s, y, 0.95, Math.max(0, 1 - s / 2))
  }
}
`

const BUBBLES = `// 气泡：一串串气泡从下面慢慢升上来，一直循环。适合当背景。
export const info = { name: '气泡', author: 'dsh-her', grid: [160, 90], fps: 15, seconds: 0, color: 'mono' }

const bubbles = []

export function setup(g) {
  for (let i = 0; i < 42; i++) {
    bubbles.push({ x: g.random() * g.w, r: 1 + g.random() * 3.5, speed: 4 + g.random() * 10, phase: g.random() * 100, wobble: 1 + g.random() * 3 })
  }
}

export function frame(g, t) {
  g.clear()
  for (const b of bubbles) {
    const span = g.h + 12
    const y = g.h + 6 - ((t * b.speed + b.phase * 7) % span)
    const x = b.x + Math.sin(t * 1.3 + b.phase) * b.wobble
    // 一个圈，上面亮一点
    for (let a = 0; a < Math.PI * 2; a += 0.35 / b.r) {
      g.set(x + Math.cos(a) * b.r, y + Math.sin(a) * b.r, 0.5 + 0.5 * Math.max(0, -Math.sin(a)), 0.9)
    }
    g.set(x - b.r * 0.4, y - b.r * 0.4, 1, 1)
  }
}
`

const TAIL = `// 鲸尾出水：鲸鱼尾巴从海面升起来，晃一晃，用力拍下去，溅起水花。
export const info = { name: '鲸尾出水', author: 'dsh-her', grid: [192, 108], fps: 24, seconds: 5, color: 'mono' }

const WATER = 80
const spray = []

export function setup(g) {
  for (let i = 0; i < 220; i++) {
    spray.push({ vx: (g.random() - 0.5) * 72, vy: -24 - g.random() * 62, at: 3.1 + g.random() * 0.35, big: g.random() < 0.2 })
  }
}

// 尾巴：rise 是露出水面多高，tilt 是往前倒的角度
function tail(g, cx, rise, tilt) {
  const sin = Math.sin(tilt), cos = Math.cos(tilt)
  const at = (u, h) => [cx + u * cos + h * sin, WATER - h * cos + u * sin]
  for (let h = -4; h <= rise; h += 1) {
    const [x, y] = at(0, h)
    if (y < WATER) g.circle(x, y, 7 - 3 * (h / Math.max(1, rise)), 0.85)
  }
  for (const side of [-1, 1]) {
    for (let k = 0; k <= 1; k += 0.02) {
      const [x, y] = at(side * k * 34, rise + 2 + Math.sin(k * Math.PI * 0.9) * 7 + k * k * 6)
      if (y < WATER) g.circle(x, y, 6.5 * (1 - k) + 0.6, 0.95)
    }
  }
  // 尾鳍中间的小缺口（a = 0 就是擦掉）
  const [nx, ny] = at(0, rise + 9)
  g.circle(nx, ny, 2.4, 0, 0)
}

export function frame(g, t) {
  g.clear()
  for (let x = 0; x < g.w; x++) {
    const s = WATER + Math.sin(x / 11 + t * 2.2) * 1.2 + (g.noise(x / 9, t) - 0.5) * 2
    g.set(x, s, 0.9, 0.9)
    for (let y = Math.ceil(s) + 1; y < g.h; y += 2) g.set(x + ((y >> 1) & 1), y, 0.3 * g.noise(x / 5, y / 3, t), 0.6)
  }
  // 升起来，在上面晃一晃，再狠狠拍下去
  let rise = -1, tilt = 0
  if (t < 1.6) { rise = g.ease.out(t / 1.6) * 50; tilt = -0.15 + 0.1 * (t / 1.6) }
  else if (t < 2.7) { rise = 50 + Math.sin((t - 1.6) * 3) * 2; tilt = -0.05 + Math.sin((t - 1.6) * 2.4) * 0.12 }
  else if (t < 3.2) { const p = (t - 2.7) / 0.5; rise = 50 * (1 - g.ease.in(p)); tilt = 0.08 + p * 0.9 }
  if (rise > 0) tail(g, 96, rise, tilt)
  // 尾巴举着的时候往下淌的水
  if (t > 0.6 && t < 2.8) {
    for (let i = 0; i < 18; i++) g.set(96 + (g.random() - 0.5) * 60, WATER - g.random() * rise * 0.9, 0.7, 0.6)
  }
  // 拍下去的水花
  for (const d of spray) {
    const s = t - d.at
    if (s < 0) continue
    const x = 110 + d.vx * s, y = WATER - 2 + d.vy * s + 45 * s * s
    if (y > WATER + 1) continue
    if (d.big) g.rect(x, y, 2, 2, 1, Math.max(0, 1 - s / 1.6))
    else g.set(x, y, 1, Math.max(0, 1 - s / 1.6))
  }
  // 入水的地方一圈圈散开
  if (t > 3.2) {
    const r = (t - 3.2) * 40
    for (let x = -r; x <= r; x += 1) g.set(110 + x, WATER + 1 + Math.sqrt(Math.max(0, 1 - (x / r) ** 2)) * r * 0.08, 0.8, Math.max(0, 1 - (t - 3.2) / 1.8))
  }
}
`

export interface BuiltinPixel {
  id: string
  name: string
  code: string
  /** What it is good for, in a few words. */
  about: string
}

export const BUILTIN_PIXELS: BuiltinPixel[] = [
  { id: 'builtin:tail', name: '鲸尾出水', code: TAIL, about: '5 秒，开机动画或点一下播一遍' },
  { id: 'builtin:waves', name: '浪花', code: WAVES, about: '4 秒，开机动画' },
  { id: 'builtin:bubbles', name: '气泡', code: BUBBLES, about: '一直循环，适合背景' },
]

/** The example in the instructions for a model. */
export const EXAMPLE_PIXEL = WAVES
