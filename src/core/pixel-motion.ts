/**
 * 一键动起来 (docs/像素工坊设计.md "一键动起来和多帧"): a pixel picture
 * made from pictures, written as a 像素动画 file that moves it in one of a
 * few ways, no AI needed; and the picture read back out of such a file, so
 * another way of moving is a click. The code is plain and commented: the AI,
 * or a person, can go on from it. Pure.
 */

import type { Picture } from './pixel-picture.ts'

export type Motion = 'still' | 'float' | 'breathe' | 'sway' | 'hop' | 'walk' | 'turn' | 'sparkle'

export const MOTIONS: Array<{ id: Motion; name: string; about: string }> = [
  { id: 'float', name: '浮动', about: '轻轻上下浮着' },
  { id: 'breathe', name: '呼吸', about: '上半身慢慢起伏，脚不动' },
  { id: 'sway', name: '摇摆', about: '跟着节奏左右晃，越往上晃得越多' },
  { id: 'hop', name: '跳一跳', about: '原地一跳一跳' },
  { id: 'walk', name: '走来走去', about: '从左走到右，转身走回来' },
  { id: 'turn', name: '转身', about: '每两秒转一次身' },
  { id: 'sparkle', name: '闪闪发光', about: '身边冒出一闪一闪的小星星' },
  { id: 'still', name: '不动', about: '站着不动（多帧的话只换帧）' },
]

/** The grids a picture's file may start on, coarsest first (as the workshop offers them, from 默认 up). */
const PICTURE_GRIDS: Array<[number, number]> = [[192, 108], [256, 144], [320, 180], [384, 216]]

/** What a file made here says about itself: the line that names its motion. */
const MOTION_LINE = /^\/\/ 动作：(\S+)/m

const quoteRows = (rows: string[], indent: string) => rows.map(r => `${indent}'${r}',`).join('\n')

/** How each motion draws `pic` (the frame now), scaled `s`, its options `o`. */
const MOVES: Record<Motion, string> = {
  still: `  g.sprite(g.w / 2, g.h / 2, pic, o)`,
  float: `  // 轻轻上下浮动
  g.sprite(g.w / 2, g.h / 2 + Math.sin(t * 2) * 2, pic, o)`,
  breathe: `  // 上半身每 3 秒起伏一次，脚不动：下半身照画，上半身抬高，中间缺的那一行补上
  const lift = Math.round((1 - Math.cos(t * Math.PI * 2 / 3)) / 2 * s)
  const half = Math.floor(pic.length * 0.55)
  const left = g.w / 2 - pic[0].length * s / 2, top = g.h / 2 - pic.length * s / 2
  const at = { ...o, center: false }
  g.sprite(left, top + half * s, pic.slice(half), at)
  g.sprite(left, top + half * s - lift, [pic[half]], at)
  g.sprite(left, top - lift, pic.slice(0, half), at)`,
  sway: `  // 一行一行错开画：越往上晃得越多，脚底不动
  const left = g.w / 2 - pic[0].length * s / 2, top = g.h / 2 - pic.length * s / 2
  const swing = Math.sin(t * 2.5) * pic[0].length * s * 0.08
  for (let r = 0; r < pic.length; r++) {
    const k = 1 - r / pic.length
    g.sprite(left + Math.round(swing * k), top + r * s, [pic[r]], { ...o, center: false })
  }`,
  hop: `  // 1.2 秒跳一次：前一半在空中，后一半站在地上
  const p = (t % 1.2) / 1.2
  const up = p < 0.5 ? Math.sin(p / 0.5 * Math.PI) * g.h * 0.12 : 0
  g.sprite(g.w / 2, g.h / 2 - up, pic, o)`,
  walk: `  // 6 秒走一趟：从左走到右，翻过来走回去，一路轻轻颠
  const span = g.w / 2 - pic[0].length * s / 2 - 2
  const p = (t / 6) % 2
  const x = g.w / 2 + (p < 1 ? p * 2 - 1 : 3 - p * 2) * span
  const bob = Math.abs(Math.sin(t * 6)) * s
  g.sprite(x, g.h / 2 - bob, pic, { ...o, flip: p >= 1 })`,
  turn: `  // 每两秒转一次身
  g.sprite(g.w / 2, g.h / 2, pic, { ...o, flip: Math.floor(t / 2) % 2 === 1 })`,
  sparkle: `  // 轻轻浮着，身边冒出一闪一闪的小星星
  g.sprite(g.w / 2, g.h / 2 + Math.sin(t * 2) * 2, pic, o)
  const w = pic[0].length * s, h = pic.length * s
  for (let i = 0; i < 12; i++) {
    const round = t * 0.6 + i / 12
    const life = round % 1
    const seed = Math.floor(round) * 97 + i * 13
    const rx = Math.sin(seed * 12.9898) * 43758.5453 % 1, ry = Math.sin(seed * 78.233) * 43758.5453 % 1
    const x = Math.round(g.w / 2 + rx * w * 0.75), y = Math.round(g.h / 2 + ry * h * 0.6)
    const a = Math.sin(life * Math.PI)
    g.rect(x, y, 1, 1, STAR, a)
    if (a > 0.5) { g.rect(x - 1, y, 3, 1, STAR, a - 0.4); g.rect(x, y - 1, 1, 3, STAR, a - 0.4) }
  }`,
}

/** The file for a pixel picture, moving as `motion`. */
export function pictureCode(picture: Picture, name: string, motion: Motion = 'float'): string {
  const color = picture.palette !== undefined
  const many = picture.frames.length > 1
  // The coarsest grid it fits in at eight tenths, so a tall picture is not cut off.
  const grid = PICTURE_GRIDS.find(([gw, gh]) => picture.w <= gw * 0.8 && picture.h <= gh * 0.8) ?? PICTURE_GRIDS[PICTURE_GRIDS.length - 1]!
  const about = MOTIONS.find(m => m.id === motion)!
  const art = many
    ? `const FRAMES = [\n${picture.frames.map(f => `  [\n${quoteRows(f, '    ')}\n  ],`).join('\n')}\n]\nconst PICTURE = FRAMES[0]\n/** 每帧几秒 */\nconst EACH = ${picture.each ?? 0.1}\n`
    : `const PICTURE = [\n${quoteRows(picture.rows, '  ')}\n]\n`
  const palette = color ? `const PALETTE = ${JSON.stringify(picture.palette).replace(/"(\w)":/g, '$1: ').replace(/,/g, ', ')}\n` : ''
  const star = motion === 'sparkle' ? `const STAR = ${color ? "'#fff4b8'" : '1'}\n` : ''
  return `// 🖼 用图片转的像素图（${picture.w} × ${picture.h} 格${many ? `，${picture.frames.length} 帧` : ''}）。
// PICTURE${many ? ' 和 FRAMES' : ''} 就是那张图：要它动，就移动、翻转、缩放它，或者复制一份改几格（眨眼、张嘴、抬手）轮着换；不要整个重画。
// 动作：${about.name}（像素工坊里点「动起来」换；也可以跟 AI 说）
export const info = { name: ${JSON.stringify(name)}, author: '', grid: [${grid[0]}, ${grid[1]}], fps: 24, seconds: 0, color: '${color ? 'color' : 'mono'}' }

${art}${palette}${star}
export function frame(g, t) {
  g.clear()
  const pic = ${many ? 'FRAMES[Math.floor(t / EACH) % FRAMES.length]' : 'PICTURE'}
  // 放大到占画面八成，放在中间
  const s = Math.max(1, Math.floor(Math.min(g.h * 0.8 / pic.length, g.w * 0.8 / pic[0].length)))
  const o = { scale: s, center: true${color ? ', palette: PALETTE' : ''} }
${MOVES[motion]}
}
`
}

/** The rows of a quoted list starting at `at` in `code` (one string a line), and where it ended. */
function readRows(lines: string[], from: number): { rows: string[]; end: number } {
  const rows: string[] = []
  let k = from
  for (; k < lines.length; k++) {
    const m = /^\s*'([^'\\]*)',?\s*$/.exec(lines[k]!)
    if (m === null) break
    rows.push(m[1]!)
  }
  return { rows, end: k }
}

export interface PictureFile {
  picture: Picture
  name: string
  /** The motion it says it has, when it was made here. */
  motion?: Motion
}

/**
 * The pixel picture in a file made from pictures (PICTURE, or FRAMES; its
 * PALETTE; EACH), to make it again moving another way. Undefined when the
 * file has none, or it is not as written here.
 */
export function readPictureFile(code: string): PictureFile | undefined {
  const lines = code.split('\n')
  let frames: string[][] = []
  const framesAt = lines.findIndex(l => /^const FRAMES = \[\s*$/.test(l))
  if (framesAt >= 0) {
    let k = framesAt + 1
    while (k < lines.length && /^\s*\[\s*$/.test(lines[k]!)) {
      const { rows, end } = readRows(lines, k + 1)
      if (rows.length === 0 || !/^\s*\],?\s*$/.test(lines[end] ?? '')) return undefined
      frames.push(rows)
      k = end + 1
    }
  } else {
    const at = lines.findIndex(l => /^const PICTURE = \[\s*$/.test(l))
    if (at < 0) return undefined
    const { rows, end } = readRows(lines, at + 1)
    if (rows.length === 0 || !/^\]\s*$/.test(lines[end] ?? '')) return undefined
    frames = [rows]
  }
  if (frames.length === 0) return undefined
  const h = frames[0]!.length, w = Math.max(...frames[0]!.map(r => r.length))
  if (frames.some(f => f.length !== h)) return undefined
  let palette: Record<string, string> | undefined
  const p = /^const PALETTE = (\{.*\})\s*$/m.exec(code)
  if (p !== null) {
    try {
      palette = JSON.parse(p[1]!.replace(/([{,]\s*)([A-Za-z])\s*:/g, '$1"$2":').replace(/'/g, '"')) as Record<string, string>
    } catch {
      return undefined
    }
  }
  const each = Number(/^const EACH = ([\d.]+)/m.exec(code)?.[1])
  let name = ''
  try {
    name = JSON.parse(/name: ("(?:[^"\\]|\\.)*")/.exec(code)?.[1] ?? '""') as string
  } catch {
    // no name then
  }
  const said = MOTION_LINE.exec(code)?.[1]?.replace(/（.*$/, '')
  const motion = MOTIONS.find(m => m.name === said)?.id
  const picture: Picture = {
    rows: frames[0]!, frames, w, h, background: 'clear',
    ...(palette === undefined ? {} : { palette }),
    ...(frames.length > 1 && Number.isFinite(each) && each > 0 ? { each } : {}),
  }
  return { picture, name, ...(motion === undefined ? {} : { motion }) }
}
