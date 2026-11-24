/**
 * 像素工坊 (docs/像素工坊设计.md §1): what the page changes in a file without
 * the AI. Grid, frame rate and length live in the file's `info`; a setting
 * changed here is one line at the end that overrides them, so it works on any
 * file however its `info` is written, and changing it again replaces the line.
 * Pure.
 */

export interface InfoChange {
  grid?: [number, number]
  fps?: number
  seconds?: number
}

/** The grids the page offers, coarse to fine (the finest is the largest a file may have). */
export const WORKSHOP_GRIDS: Array<{ label: string; grid: [number, number] }> = [
  { label: '粗', grid: [128, 72] }, { label: '中', grid: [160, 90] }, { label: '默认', grid: [192, 108] }, { label: '细', grid: [256, 144] },
  { label: '很细', grid: [320, 180] }, { label: '最细', grid: [384, 216] },
]
export const WORKSHOP_FPS = [12, 15, 24, 30]

const MARK = ' // 工坊里的设置'
const LINE = /\n;Object\.assign\(info, (\{[^\n]*\})\) \/\/ 工坊里的设置\n*$/

/** What the override line says now. */
export function infoOverride(code: string): InfoChange {
  const m = LINE.exec(code)
  if (m === null) return {}
  try {
    return JSON.parse(m[1]!) as InfoChange
  } catch {
    return {}
  }
}

/** The file without its override line (its end trimmed). */
export const withoutInfo = (code: string): string => code.replace(LINE, '').replace(/\s*$/, '')

/** The file with `change` put into its override line. */
export function withInfo(code: string, change: InfoChange): string {
  const next: InfoChange = { ...infoOverride(code) }
  if (change.grid !== undefined) next.grid = [Math.round(change.grid[0]), Math.round(change.grid[1])]
  if (change.fps !== undefined) next.fps = Math.round(change.fps)
  if (change.seconds !== undefined) next.seconds = Math.max(0, Math.round(change.seconds))
  const body = withoutInfo(code)
  return `${body}\n;Object.assign(info, ${JSON.stringify(next)})${MARK}\n`
}

/** What a change says, for the list of versions. */
export function describeChange(change: InfoChange): string {
  const parts: string[] = []
  if (change.grid !== undefined) parts.push(`格子 ${change.grid[0]} × ${change.grid[1]}`)
  if (change.fps !== undefined) parts.push(`每秒 ${change.fps} 帧`)
  if (change.seconds !== undefined) parts.push(change.seconds === 0 ? '一直循环' : `${change.seconds} 秒一遍`)
  return parts.join('，')
}
