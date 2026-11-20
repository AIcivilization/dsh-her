/**
 * The worker side of a 像素动画 (docs/像素动画设计.md §4): this script runs
 * after the file's own (wrapped by `wrapPixelCode`, which leaves `__anim`),
 * in a worker of the sandboxed player page, where nothing can reach the
 * network or dsh. It answers the page frame by frame.
 *
 * In:  { t: 'setup' } · { t: 'frame', n, time }
 * Out: { t: 'ready', info } · { t: 'fail', problems } · { t: 'setup', ms }
 *      { t: 'frame', n, ms, data } · { t: 'error', message, line? }
 */

import { cleanPixelInfo, errorLine, type PixelInfo } from '../../core/pixel.ts'
import { makeGrid, type PixelGrid } from '../../core/pixel-grid.ts'

declare const __anim: { info?: unknown; setup?: (g: PixelGrid) => void; frame?: (g: PixelGrid, t: number, n: number) => void }

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent) => void) | null
}
const scope = self as unknown as WorkerScope

const said = (error: unknown) => {
  const e = error as { message?: unknown; stack?: unknown }
  const line = errorLine(typeof e?.stack === 'string' ? e.stack : undefined)
  return { message: typeof e?.message === 'string' ? e.message : String(error), ...(line === undefined ? {} : { line }) }
}

let info: PixelInfo | undefined
let grid: PixelGrid | undefined

const anim = typeof __anim === 'undefined' ? undefined : __anim
if (anim === undefined) scope.postMessage({ t: 'fail', problems: ['文件没能运行'] })
else {
  const read = cleanPixelInfo(anim.info)
  const problems = [...read.problems]
  if (typeof anim.frame !== 'function') problems.push('没有找到 frame：文件里要写 export function frame(g, t, n) { … }')
  if (read.info === undefined || problems.length > 0) scope.postMessage({ t: 'fail', problems })
  else {
    info = read.info
    grid = makeGrid(info.grid[0], info.grid[1], info.color)
    scope.postMessage({ t: 'ready', info })
  }
}

scope.onmessage = event => {
  const message = event.data as { t: string; n?: number; time?: number }
  if (anim === undefined || grid === undefined || info === undefined) return
  if (message.t === 'setup') {
    const started = performance.now()
    try {
      anim.setup?.(grid)
      scope.postMessage({ t: 'setup', ms: performance.now() - started })
    } catch (error) {
      scope.postMessage({ t: 'error', where: 'setup', ...said(error) })
    }
    return
  }
  if (message.t === 'frame') {
    const n = message.n ?? 0
    const started = performance.now()
    try {
      anim.frame!(grid, message.time ?? 0, n)
    } catch (error) {
      scope.postMessage({ t: 'error', where: `第 ${n} 帧`, ...said(error) })
      return
    }
    const ms = performance.now() - started
    const data = grid.data.slice()
    scope.postMessage({ t: 'frame', n, ms, data }, [data.buffer])
  }
}
