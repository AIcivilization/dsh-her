/**
 * 像素动画 (docs/像素动画设计.md): one .js file that fills a coarse grid every
 * frame; the engine decides how the grid is drawn (blocks, dots, code
 * lettering) and in what colour. This file reads a file's `info`, turns the
 * file into a script a worker can run, and cleans the settings. Pure.
 */

export const PIXEL_FORMAT = 'dsh-her-pixel@1'

export const PIXEL_LIMITS = {
  /** The largest grid, in cells. */
  w: 384, h: 216,
  fps: 30,
  /** The longest an opening clip may play. */
  seconds: 8,
  bytes: 200 * 1024,
  /** What a frame should take, and what stops it. */
  frameMs: 8, hardFrameMs: 250, setupMs: 1500,
} as const

export type PixelStyle = 'blocks' | 'dots' | 'code'
export const PIXEL_STYLES: PixelStyle[] = ['blocks', 'dots', 'code']
export const STYLE_NAME: Record<PixelStyle, string> = { blocks: '方块', dots: '圆点', code: '代码字' }

export interface PixelInfo {
  name: string
  author?: string
  grid: [number, number]
  fps: number
  /** One run; 0: goes on for ever (a background only). */
  seconds: number
  /** 'mono': each cell a brightness; 'color': each cell its own colour (blocks only). */
  color: 'mono' | 'color'
}

/** How a grid is drawn: the style, the colour ('theme' or #rrggbb), how much of the area it takes, cover or contain. */
export interface PixelLook {
  style: PixelStyle
  color: string
  size: number
  fit: 'contain' | 'cover'
}

export const DEFAULT_LOOK: PixelLook = { style: 'dots', color: 'theme', size: 1, fit: 'contain' }

/** What plays it once in the chat background. */
export interface PixelTriggers {
  /** A click on blank space. */
  click: boolean
  /** You send a message. */
  send: boolean
  /** dsh has finished answering. */
  reply: boolean
  /** A dsh page opens. */
  open: boolean
  /** Every so many minutes (0: no). */
  everyMin: number
  /** Over and over, never stopping. */
  loop: boolean
}

export interface PixelBackground {
  on: boolean
  /** The animation (`builtin:waves` or one of one's own). */
  id: string
  look: PixelLook
  /** How strong it shows, 0.03–0.6. */
  opacity: number
  triggers: PixelTriggers
}

export const DEFAULT_BACKGROUND: PixelBackground = {
  on: false, id: 'builtin:tail', look: { ...DEFAULT_LOOK, size: 1, fit: 'contain' }, opacity: 0.18,
  triggers: { click: true, send: false, reply: false, open: false, everyMin: 0, loop: false },
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** A colour we accept: 'theme' or #rgb / #rrggbb. */
export const cleanColor = (v: unknown, fallback = 'theme'): string =>
  typeof v === 'string' && (v === 'theme' || /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) ? v.toLowerCase() : fallback

export function cleanLook(raw: unknown, fallback: PixelLook = DEFAULT_LOOK): PixelLook {
  const v = isObject(raw) ? raw : {}
  return {
    style: PIXEL_STYLES.includes(v.style as PixelStyle) ? v.style as PixelStyle : fallback.style,
    color: cleanColor(v.color, fallback.color),
    size: typeof v.size === 'number' && Number.isFinite(v.size) ? clamp(v.size, 0.2, 1) : fallback.size,
    fit: v.fit === 'cover' || v.fit === 'contain' ? v.fit : fallback.fit,
  }
}

export function cleanBackground(raw: unknown): PixelBackground {
  const v = isObject(raw) ? raw : {}
  const d = DEFAULT_BACKGROUND
  const t = isObject(v.triggers) ? v.triggers : {}
  const flag = (key: keyof PixelTriggers) => (typeof t[key] === 'boolean' ? t[key] as boolean : d.triggers[key] as boolean)
  return {
    on: v.on === true,
    id: typeof v.id === 'string' && PIXEL_ID.test(v.id) ? v.id : d.id,
    look: cleanLook(v.look, d.look),
    opacity: typeof v.opacity === 'number' && Number.isFinite(v.opacity) ? clamp(v.opacity, 0.03, 0.6) : d.opacity,
    triggers: {
      click: flag('click'), send: flag('send'), reply: flag('reply'), open: flag('open'), loop: flag('loop'),
      everyMin: typeof t.everyMin === 'number' && Number.isFinite(t.everyMin) ? clamp(Math.round(t.everyMin), 0, 240) : 0,
    },
  }
}

/** An animation's id: `builtin:<name>`, or a folder name of one's own. */
export const PIXEL_ID = /^(builtin:[a-z]{2,20}|[\w\-一-鿿]{1,40})$/

/** Read `info` (from the file, as the worker found it): what is wrong is said, in words to paste back to the model. */
export function cleanPixelInfo(raw: unknown): { info?: PixelInfo; problems: string[] } {
  const problems: string[] = []
  if (!isObject(raw)) return { problems: ['没有找到 info：文件里要写 export const info = { name, grid, fps, seconds, color }'] }
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim().slice(0, 40) : undefined
  if (name === undefined) problems.push('info.name 要写一个名字')
  const grid = raw.grid
  let size: [number, number] | undefined
  if (!Array.isArray(grid) || grid.length !== 2 || !grid.every(n => Number.isInteger(n) && (n as number) >= 8)) {
    problems.push(`info.grid 要写成 [宽, 高]，都是 8 以上的整数（现在是 ${JSON.stringify(grid ?? null)}）`)
  } else if ((grid[0] as number) > PIXEL_LIMITS.w || (grid[1] as number) > PIXEL_LIMITS.h) {
    problems.push(`info.grid 写成了 [${grid[0]}, ${grid[1]}]，最大 ${PIXEL_LIMITS.w} × ${PIXEL_LIMITS.h}`)
  } else size = [grid[0] as number, grid[1] as number]
  const fps = raw.fps
  if (typeof fps !== 'number' || !Number.isInteger(fps) || fps < 1 || fps > PIXEL_LIMITS.fps) problems.push(`info.fps 要是 1 到 ${PIXEL_LIMITS.fps} 的整数（现在是 ${JSON.stringify(fps ?? null)}）`)
  const seconds = raw.seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 600) problems.push(`info.seconds 要是 0 到 600 之间的秒数，0 表示一直循环（现在是 ${JSON.stringify(seconds ?? null)}）`)
  const color = raw.color === undefined ? 'mono' : raw.color
  if (color !== 'mono' && color !== 'color') problems.push(`info.color 只能是 'mono' 或 'color'（现在是 ${JSON.stringify(color)}）`)
  if (problems.length > 0 || name === undefined || size === undefined) return { problems }
  return {
    info: {
      name, grid: size, fps: fps as number, seconds: seconds as number, color: color as 'mono' | 'color',
      ...(typeof raw.author === 'string' && raw.author.trim() !== '' ? { author: raw.author.trim().slice(0, 60) } : {}),
    },
    problems,
  }
}

/** Lines our wrapper puts before the file's first line, to say errors at the file's own line numbers. */
export const WRAP_LINES = 2

/**
 * Make the file a plain script: `export` taken off its declarations, the
 * whole inside a function, and what it defines handed back as `__anim`. A
 * file that imports, or exports in a way we do not read, is refused with the
 * reason.
 */
export function wrapPixelCode(code: string): { script?: string; problems: string[] } {
  const problems: string[] = []
  if (new TextEncoder().encode(code).length > PIXEL_LIMITS.bytes) problems.push(`文件太大：最多 ${PIXEL_LIMITS.bytes / 1024} KB`)
  if (/^\s*import[\s{*'"]/m.test(code) || /\bimport\s*\(/.test(code)) problems.push('不能 import 别的文件：所有代码写在这一个文件里')
  let body = code
    .replace(/^(\s*)export\s+(?=(const|let|var|function|async\s+function|class)\b)/gm, '$1')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
  if (/^\s*export\s+default\b/m.test(body)) problems.push('不要用 export default：写成 export const info、export function setup、export function frame')
  else if (/^\s*export\b/m.test(body)) problems.push('export 只能用在 const、function 前面')
  if (problems.length > 0) return { problems }
  // A last line comment must not swallow what follows.
  body = `${body}\n`
  const script = `var __anim = (function () { 'use strict';\n\n${body};return { info: typeof info === 'undefined' ? undefined : info, setup: typeof setup === 'function' ? setup : undefined, frame: typeof frame === 'function' ? frame : undefined }\n})();\n`
  return { script, problems }
}

/** Where an error is in the file: the first line:column of the worker's script in a stack, made the file's own. */
export function errorLine(stackOrLine: string | number | undefined): number | undefined {
  const raw = typeof stackOrLine === 'number' ? stackOrLine : Number(/:(\d+):\d+\)?\s*$/m.exec(stackOrLine ?? '')?.[1] ?? /:(\d+):\d+/.exec(stackOrLine ?? '')?.[1])
  return Number.isFinite(raw) && raw > WRAP_LINES ? raw - WRAP_LINES : undefined
}

/** An animation's display length: an opening clip runs at most 8 s; one that never ends plays 6 s when played once. */
export const onceSeconds = (info: Pick<PixelInfo, 'seconds'>, cap: number = PIXEL_LIMITS.seconds): number =>
  info.seconds > 0 ? Math.min(info.seconds, cap) : Math.min(6, cap)
