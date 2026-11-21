/**
 * The 像素动画 player page (docs/像素动画设计.md §4). It runs sandboxed: in
 * dsh's page as an iframe with an opaque origin and a CSP that allows no
 * network; on the desktop as the opening clip's own window. The file's code
 * runs in a worker made here, frame by frame; a frame that does not come back
 * in time ends the worker.
 *
 * From the host (postMessage from the parent, or `__pixelStart` on the desktop):
 *   { t: 'play', code, look, ink, mode: 'once' | 'loop', cap?, fade? } · { t: 'stop' } · { t: 'ink', ink }
 *   { t: 'probe', code, ink }
 * To the host: { t: 'ready' } · { t: 'playing', info } · { t: 'ended' } · { t: 'problem', problems }
 *   { t: 'probe', ok, info?, problems, warnings, thumb?, frameMs? }
 */

import { PIXEL_LIMITS, errorLine, onceSeconds, wrapPixelCode, type PixelInfo, type PixelLook } from '../../core/pixel.ts'
import { Painter, type Rgb } from './paint.ts'
import { sketchFrame, sketchStats, type Sketch } from '../../core/pixel-sketch.ts'

declare const __PIXEL_WORKER__: string

type Command =
  | { t: 'play'; code: string; look: PixelLook; ink: Rgb; mode: 'once' | 'loop'; cap?: number; fade?: boolean }
  | { t: 'stop' }
  | { t: 'ink'; ink: Rgb }
  | { t: 'probe'; code: string; ink: Rgb; sketch?: boolean }

const standalone = window.parent === window
const send = (message: unknown) => {
  if (standalone) {
    if ((message as { t: string }).t === 'ended' || (message as { t: string }).t === 'problem') window.close()
    return
  }
  window.parent.postMessage({ pixel: true, ...(message as object) }, '*')
}

const canvas = document.getElementById('c') as HTMLCanvasElement
const painter = new Painter(canvas)
window.addEventListener('resize', () => painter.resize())

/** A worker running one file, and the steps to get it going. */
class Anim {
  readonly worker: Worker
  info: PixelInfo | undefined
  private waiting: { resolve: (m: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined
  private dead = false
  onFrame: ((m: { n: number; ms: number; data: Uint8ClampedArray }) => void) | undefined

  constructor(script: string) {
    const url = URL.createObjectURL(new Blob([script, '\n;', __PIXEL_WORKER__], { type: 'text/javascript' }))
    this.worker = new Worker(url)
    URL.revokeObjectURL(url)
    this.worker.onerror = event => {
      event.preventDefault()
      const line = errorLine(event.lineno)
      this.fail(new Error(`${event.message || '代码出错'}${line === undefined ? '' : `（第 ${line} 行）`}`))
    }
    this.worker.onmessage = event => {
      const m = event.data as Record<string, unknown> & { t: string }
      if (m.t === 'frame' && this.waiting === undefined) {
        this.onFrame?.(m as never)
        return
      }
      if (m.t === 'error') {
        this.fail(new Error(`${String(m.where ?? '')}出错：${String(m.message)}${m.line === undefined ? '' : `（第 ${String(m.line)} 行）`}`))
        return
      }
      if (m.t === 'fail') {
        this.fail(new Error((m.problems as string[]).join('\n')))
        return
      }
      const waiting = this.waiting
      this.waiting = undefined
      if (waiting !== undefined) {
        clearTimeout(waiting.timer)
        waiting.resolve(m)
      }
    }
  }

  /** Wait for the next answer (ready, setup or a frame), or give up after `ms`. */
  next(ms: number, slow: string): Promise<Record<string, unknown>> {
    if (this.dead) return Promise.reject(new Error('已停止'))
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject, timer: setTimeout(() => this.fail(new Error(slow)), ms) }
    })
  }

  fail(error: Error): void {
    if (this.dead) return
    this.dead = true
    this.worker.terminate()
    const waiting = this.waiting
    this.waiting = undefined
    if (waiting !== undefined) {
      clearTimeout(waiting.timer)
      waiting.reject(error)
    } else this.onFail?.(error)
  }

  onFail: ((error: Error) => void) | undefined

  stop(): void {
    this.dead = true
    this.worker.terminate()
    if (this.waiting !== undefined) clearTimeout(this.waiting.timer)
    this.waiting = undefined
  }

  /** Make the worker and run setup; the file's info. */
  static async start(code: string): Promise<Anim> {
    const { script, problems } = wrapPixelCode(code)
    if (script === undefined) throw new Error(problems.join('\n'))
    const anim = new Anim(script)
    const ready = anim.next(PIXEL_LIMITS.setupMs, '文件读了太久还没准备好（是不是在最外层写了很慢的代码？）')
    const m = await ready
    anim.info = m.info as PixelInfo
    anim.worker.postMessage({ t: 'setup' })
    await anim.next(PIXEL_LIMITS.setupMs, `setup 超过 ${PIXEL_LIMITS.setupMs / 1000} 秒还没做完，太慢`)
    return anim
  }

  async frame(n: number, time: number): Promise<{ ms: number; data: Uint8ClampedArray }> {
    const answer = this.next(PIXEL_LIMITS.hardFrameMs * 4, `第 ${n} 帧超过 ${PIXEL_LIMITS.hardFrameMs * 4} 毫秒还没画完，太慢`)
    this.worker.postMessage({ t: 'frame', n, time })
    return await answer as { ms: number; data: Uint8ClampedArray }
  }
}

let playing: { anim: Anim; raf: number } | undefined

function stop(): void {
  if (playing === undefined) return
  cancelAnimationFrame(playing.raf)
  playing.anim.stop()
  playing = undefined
  painter.clear()
}

async function play(command: Extract<Command, { t: 'play' }>): Promise<void> {
  stop()
  let anim: Anim
  try {
    anim = await Anim.start(command.code)
  } catch (error) {
    send({ t: 'problem', problems: (error as Error).message.split('\n') })
    return
  }
  const info = anim.info!
  painter.set(info, command.look, command.ink)
  send({ t: 'playing', info })
  const once = command.mode === 'once'
  const total = once ? onceSeconds(info, command.cap ?? PIXEL_LIMITS.seconds) : Infinity
  const fade = command.fade !== false
  let start = performance.now()
  let hiddenAt: number | undefined
  let inFlight: { at: number } | undefined
  let lastN = -1
  const run = { anim, raf: 0 }
  playing = run
  const alphaAt = (elapsed: number) => {
    if (!fade) return 1
    const fadeIn = Math.min(1, elapsed / 0.35)
    return once ? Math.max(0, Math.min(fadeIn, (total - elapsed) / 0.5)) : fadeIn
  }
  const finish = () => {
    if (playing !== run) return
    stop()
    send({ t: 'ended' })
  }
  anim.onFail = error => {
    if (playing !== run) return
    stop()
    send({ t: 'problem', problems: error.message.split('\n') })
  }
  anim.onFrame = m => {
    inFlight = undefined
    if (playing !== run) return
    const elapsed = (performance.now() - start) / 1000
    painter.paint(m.data, alphaAt(elapsed))
  }
  const tick = (now: number) => {
    if (playing !== run) return
    run.raf = requestAnimationFrame(tick)
    if (document.hidden) {
      hiddenAt ??= now
      return
    }
    if (hiddenAt !== undefined) {
      start += now - hiddenAt
      hiddenAt = undefined
    }
    const elapsed = (now - start) / 1000
    if (elapsed >= total) {
      finish()
      return
    }
    if (inFlight !== undefined) {
      if (now - inFlight.at > PIXEL_LIMITS.hardFrameMs) anim.fail(new Error(`每帧超过 ${PIXEL_LIMITS.hardFrameMs} 毫秒，太慢，已经停止`))
      return
    }
    const time = !once && info.seconds > 0 ? elapsed % info.seconds : elapsed
    const n = Math.floor(time * info.fps)
    if (n === lastN) return
    lastN = n
    inFlight = { at: now }
    anim.worker.postMessage({ t: 'frame', n, time: n / info.fps })
  }
  run.raf = requestAnimationFrame(tick)
}

/** Try a file: load, setup, three frames timed; a still of the middle one. */
async function probe(command: Extract<Command, { t: 'probe' }>): Promise<void> {
  const warnings: string[] = []
  let anim: Anim | undefined
  try {
    anim = await Anim.start(command.code)
    const info = anim.info!
    const last = Math.max(0, Math.floor((info.seconds > 0 ? info.seconds : 6) * info.fps) - 1)
    const mid = Math.floor(last / 2)
    let slowest = 0
    let still: Uint8ClampedArray | undefined
    // For the AI (像素工坊): three frames as characters, at a fifth, half and nine tenths of the way.
    const looks = command.sketch === true ? [Math.floor(last * 0.2), mid, Math.floor(last * 0.9)] : []
    const sketches: Sketch[] = []
    for (const n of [...new Set([0, 1, ...looks, mid, last])].sort((a, b) => a - b)) {
      const f = await anim.frame(n, n / info.fps)
      if (n > 0) slowest = Math.max(slowest, f.ms)
      if (n === mid) still = f.data
      if (looks.includes(n)) {
        const [w, h] = info.grid
        sketches.push({ t: Math.round(n / info.fps * 10) / 10, text: sketchFrame(f.data, w, h, info.color === 'mono'), stats: sketchStats(f.data, w, h, info.color === 'mono') })
      }
    }
    if (slowest > 60) throw new Error(`每帧要 ${Math.round(slowest)} 毫秒，太慢（要在 ${PIXEL_LIMITS.frameMs} 毫秒以内）`)
    if (slowest > 16) warnings.push(`每帧要 ${Math.round(slowest)} 毫秒，有点慢，电脑差一点会卡（最好在 ${PIXEL_LIMITS.frameMs} 毫秒以内）`)
    let empty = true
    for (let i = 3; i < still!.length && empty; i += 4) if (still![i]! > 0 && (info.color === 'color' || still![i - 3]! > 0)) empty = false
    if (empty) warnings.push('中间那一帧什么都没画：看看 frame 里有没有填格子')
    send({ t: 'probe', ok: true, info, problems: [], warnings, thumb: Painter.thumb(info, still!, command.ink), frameMs: Math.round(slowest * 10) / 10, ...(sketches.length > 0 ? { sketches } : {}) })
  } catch (error) {
    send({ t: 'probe', ok: false, problems: (error as Error).message.split('\n'), warnings })
  } finally {
    anim?.stop()
  }
}

function handle(command: Command): void {
  if (command.t === 'play') void play(command)
  else if (command.t === 'stop') stop()
  else if (command.t === 'ink') {
    painter.setInk(command.ink)
  } else if (command.t === 'probe') void probe(command)
}

declare global {
  interface Window {
    __pixelStart?: (command: Command) => void
  }
}

if (standalone) {
  // The desktop's opening clip: started by the window's owner; a click skips it.
  window.__pixelStart = handle
  document.addEventListener('click', () => window.close())
} else {
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return
    const data = event.data as Command | undefined
    if (data !== undefined && typeof data === 'object' && typeof data.t === 'string') handle(data)
  })
  send({ t: 'ready' })
}
