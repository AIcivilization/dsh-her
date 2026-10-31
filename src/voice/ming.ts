/**
 * Ming-3.0-tts on this computer (docs/Ming本地声音设计.md): offline, free,
 * with moods, and voices of your own. Apple chips with macOS 14+ only (MLX).
 *
 * - Install (on request, from the "她" page): uv (voice/uv.ts) builds a
 *   Python 3.12 environment in `<home>/ming/env` and installs mlx-audio from
 *   python/ming-requirements.txt, every package pinned with its hash; the
 *   model (voice/ming-model.ts) is downloaded into `<home>/ming/model`, each
 *   file checked against its size and SHA-256. An interrupted download goes
 *   on where it stopped. Deleting `<home>/ming` uninstalls it.
 * - Run: python/ming_worker.py, one process that keeps the model loaded
 *   (about 2 GB of memory); sentences go to it one at a time. It starts with
 *   the first sentence (or when you start talking, `warm`), and stops after
 *   some minutes without a sentence to give the memory back.
 * - A worker that dies is started again with the next sentence; one that dies
 *   twice within five minutes is left stopped (`failed`) until `restart`.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { release, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { wavFromPcm16 } from '../core/index.ts'
import { MING_MODEL, MING_MODEL_BYTES } from './ming-model.ts'
import { installUv, run, uvEnv } from './uv.ts'

export type MingState = 'unsupported' | 'absent' | 'installing' | 'stopped' | 'loading' | 'ready' | 'failed'

export interface MingStatus {
  state: MingState
  /** While installing: what is being done, and bytes of the model so far. */
  step?: string
  done?: number
  total?: number
  error?: string
}

export interface MingRequest {
  text: string
  /** A built-in voice (灵风信_高兴 …), a recording to clone, or a description to design a voice from. */
  voice?: string
  ref?: { wav: string; text: string }
  design?: string
  emotion?: string
  speed?: string
  steps: number
  seed?: number
}

export interface MingAudio {
  /** WAV, 16-bit mono. */
  audio: Uint8Array
  durationMs: number
  ms: number
}

type Logger = { info(message: string): void; warn(message: string): void }

const PYTHON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'python')
const WORKER = join(PYTHON_DIR, 'ming_worker.py')
const REQUIREMENTS = join(PYTHON_DIR, 'ming-requirements.txt')
const LOAD_TIMEOUT_MS = 180_000
const SPEAK_TIMEOUT_MS = 90_000
const CRASH_WINDOW_MS = 5 * 60_000

/** Why Ming cannot run here, or undefined when it can: Apple chips and macOS 14 (Darwin 23) or later. */
export function mingUnsupported(platform: string = process.platform, arch: string = process.arch, darwin = release()): string | undefined {
  if (platform !== 'darwin' || arch !== 'arm64') return '本机 Ming 只支持 Apple 芯片的 Mac'
  if (Number.parseInt(darwin, 10) < 23) return '本机 Ming 要 macOS 14 或更新'
  return undefined
}

/** Minutes without a sentence before the worker stops: 10 on a Mac with 16 GB or less, else 30. */
export const defaultIdleMinutes = (memory = totalmem()): number => (memory <= 16 * 2 ** 30 ? 10 : 30)

export class MingVoice {
  private readonly root: string
  private readonly uvHome: string
  private readonly logger: Logger
  private state: MingStatus
  private worker: ChildProcess | undefined
  private starting: Promise<void> | undefined
  private installing: Promise<void> | undefined
  private readonly pending = new Map<number, { resolve(reply: Record<string, unknown>): void; reject(error: Error): void }>()
  private queue: Promise<unknown> = Promise.resolve()
  private nextId = 1
  private lastUse = 0
  private crashes: number[] = []
  private stderr: string[] = []
  private idleMinutes: number
  private readonly idleTimer: NodeJS.Timeout

  /** `root`: `<home>/ming`; `uvHome`: `<home>/uv`, shared with the Edge voice. `idleMinutes` 0: never stop. */
  constructor(root: string, uvHome: string, logger: Logger, idleMinutes = defaultIdleMinutes()) {
    this.root = root
    this.uvHome = uvHome
    this.logger = logger
    this.idleMinutes = idleMinutes
    const unsupported = mingUnsupported()
    this.state = unsupported !== undefined ? { state: 'unsupported', error: unsupported } : { state: this.installed ? 'stopped' : 'absent' }
    this.idleTimer = setInterval(() => this.stopWhenIdle(), 60_000)
    this.idleTimer.unref()
  }

  get status(): MingStatus {
    return this.state
  }

  get installed(): boolean {
    return existsSync(this.python) && existsSync(join(this.modelDir, '.verified'))
  }

  setIdleMinutes(minutes: number): void {
    this.idleMinutes = minutes
  }

  private get python(): string {
    return join(this.root, 'env', 'bin', 'python3')
  }

  private get modelDir(): string {
    return join(this.root, 'model')
  }

  /** Install everything (once; a second call joins the first). Progress shows in `status`. */
  install(): Promise<void> {
    if (this.state.state === 'unsupported') return Promise.reject(new Error(this.state.error))
    this.installing ??= this.doInstall().finally(() => { this.installing = undefined })
    return this.installing
  }

  private async doInstall(): Promise<void> {
    const step = (text: string, extra: Partial<MingStatus> = {}) => { this.state = { state: 'installing', step: text, ...extra } }
    try {
      step('准备 Python（第一次约 1 分钟）')
      const env = uvEnv(this.uvHome)
      const uv = await installUv(this.uvHome)
      const envDir = join(this.root, 'env')
      if (!existsSync(this.python)) await run(uv, ['venv', '--quiet', '--python', '3.12', envDir], 600_000, env)
      step('安装语音程序（约 450 MB）')
      await run(uv, ['pip', 'install', '--quiet', '--require-hashes', '--python', this.python, '-r', REQUIREMENTS], 1_200_000, env)
      // Installed now: the downloads are not needed any more.
      rmSync(env.UV_CACHE_DIR!, { recursive: true, force: true })
      await this.downloadModel((done, total) => step('下载声音模型（约 1.6 GB）', { done, total }))
      this.state = { state: 'stopped' }
      this.logger.info('dsh-her: Ming voice installed')
    } catch (error) {
      this.state = { state: 'failed', error: `安装本机 Ming 失败：${(error as Error).message}` }
      throw new Error(this.state.error)
    }
  }

  /** Every model file, checked; files already checked (listed in `.verified`) are kept. */
  private async downloadModel(onProgress: (done: number, total: number) => void): Promise<void> {
    mkdirSync(this.modelDir, { recursive: true })
    const marker = join(this.modelDir, '.verified')
    if (existsSync(marker)) return
    const checkedFile = join(this.modelDir, '.checked.json')
    const checked = new Set<string>(existsSync(checkedFile) ? JSON.parse(readFileSync(checkedFile, 'utf8')) as string[] : [])
    let done = 0
    for (const file of MING_MODEL.files) {
      const target = join(this.modelDir, file.name)
      if (checked.has(file.sha256) && existsSync(target) && statSync(target).size === file.size) {
        done += file.size
        onProgress(done, MING_MODEL_BYTES)
        continue
      }
      const before = done
      let lastError: Error | undefined
      for (const source of MING_MODEL.sources) {
        try {
          await download(`${source}${file.name}`, target, file, got => onProgress(before + got, MING_MODEL_BYTES))
          lastError = undefined
          break
        } catch (error) {
          lastError = error as Error
          this.logger.warn(`dsh-her: Ming model ${file.name} from ${source} failed (${lastError.message})`)
        }
      }
      if (lastError !== undefined) throw new Error(`下载 ${file.name} 失败：${lastError.message}`)
      done = before + file.size
      checked.add(file.sha256)
      writeFileSync(checkedFile, JSON.stringify([...checked]))
    }
    writeFileSync(marker, `${MING_MODEL.repo}@${MING_MODEL.revision}\n`)
    rmSync(checkedFile, { force: true })
  }

  /** Stop and delete everything (about 2 GB). */
  uninstall(): void {
    this.stop()
    rmSync(this.root, { recursive: true, force: true })
    if (this.state.state !== 'unsupported') this.state = { state: 'absent' }
  }

  /** You started talking: have the model loaded by the time she answers. */
  warm(): void {
    if (this.installed && this.state.state === 'stopped') void this.ensure().catch(() => undefined)
  }

  /** After `failed`: forget the crashes and start again. */
  async restart(): Promise<void> {
    this.stop()
    this.crashes = []
    if (this.installed) this.state = { state: 'stopped' }
    await this.ensure()
  }

  /** One sentence. Sentences are said one at a time, in the order asked. */
  synthesize(request: MingRequest): Promise<MingAudio> {
    const job = this.queue.then(() => this.speakNow(request))
    this.queue = job.catch(() => undefined)
    return job
  }

  stop(): void {
    const worker = this.worker
    this.worker = undefined
    this.starting = undefined
    if (worker !== undefined) {
      worker.removeAllListeners('exit')
      worker.kill()
      this.failPending(new Error('本机 Ming 已停止'))
    }
    if (this.state.state === 'ready' || this.state.state === 'loading') this.state = { state: 'stopped' }
  }

  /** Stop for good (the plugin is unloading). */
  close(): void {
    clearInterval(this.idleTimer)
    this.stop()
  }

  private async speakNow(request: MingRequest): Promise<MingAudio> {
    await this.ensure()
    this.lastUse = Date.now()
    const reply = await this.send({ op: 'speak', ...request }, SPEAK_TIMEOUT_MS)
    this.lastUse = Date.now()
    const pcm = Buffer.from(String(reply.pcm16), 'base64')
    const sampleRate = Number(reply.sampleRate)
    return { audio: wavFromPcm16(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), sampleRate), durationMs: Math.round(pcm.byteLength / 2 / sampleRate * 1000), ms: Number(reply.ms) }
  }

  private ensure(): Promise<void> {
    if (this.state.state === 'ready' && this.worker !== undefined) return Promise.resolve()
    if (this.state.state === 'unsupported') return Promise.reject(new Error(this.state.error))
    if (this.state.state === 'installing') return Promise.reject(new Error('本机 Ming 正在安装'))
    if (!this.installed) return Promise.reject(new Error('本机 Ming 还没安装'))
    if (this.state.state === 'failed' && this.crashes.length >= 2) return Promise.reject(new Error(this.state.error ?? '本机 Ming 出错了'))
    this.starting ??= this.start().finally(() => { this.starting = undefined })
    return this.starting
  }

  private async start(): Promise<void> {
    this.state = { state: 'loading' }
    this.stderr = []
    const worker = spawn(this.python, ['-I', WORKER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false', PYTHONUNBUFFERED: '1' },
    })
    this.worker = worker
    createInterface({ input: worker.stdout! }).on('line', line => this.onReply(line))
    createInterface({ input: worker.stderr! }).on('line', line => {
      this.stderr.push(line)
      if (this.stderr.length > 20) this.stderr.shift()
    })
    worker.on('error', error => this.onExit(worker, error.message))
    worker.on('exit', code => this.onExit(worker, `退出码 ${code}`))
    try {
      const reply = await this.send({ op: 'load', model: this.modelDir }, LOAD_TIMEOUT_MS)
      this.state = { state: 'ready' }
      this.lastUse = Date.now()
      this.logger.info(`dsh-her: Ming voice loaded (${String(reply.loadMs)} ms)`)
    } catch (error) {
      this.stop()
      this.state = { state: 'failed', error: `本机 Ming 启动失败：${(error as Error).message}` }
      this.crashes.push(Date.now())
      throw new Error(this.state.error)
    }
  }

  private send(message: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const worker = this.worker
    if (worker?.stdin === null || worker === undefined) return Promise.reject(new Error('本机 Ming 没有在运行'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('本机 Ming 太久没有回应'))
        // A worker stuck on one sentence is stuck for all of them.
        this.stop()
      }, timeoutMs)
      this.pending.set(id, {
        resolve: reply => { clearTimeout(timer); resolve(reply) },
        reject: error => { clearTimeout(timer); reject(error) },
      })
      worker.stdin!.write(`${JSON.stringify({ ...message, id })}\n`)
    })
  }

  private onReply(line: string): void {
    let reply: Record<string, unknown>
    try {
      reply = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    const waiting = this.pending.get(Number(reply.id))
    if (waiting === undefined) return
    this.pending.delete(Number(reply.id))
    if (reply.ok === true) waiting.resolve(reply)
    else waiting.reject(new Error(String(reply.error ?? '未知错误')))
  }

  private onExit(worker: ChildProcess, why: string): void {
    if (worker !== this.worker) return
    this.worker = undefined
    const detail = this.stderr.slice(-3).join(' ').slice(-300)
    this.failPending(new Error(`本机 Ming 意外退出（${why}）${detail === '' ? '' : `：${detail}`}`))
    const now = Date.now()
    this.crashes = [...this.crashes.filter(at => now - at < CRASH_WINDOW_MS), now]
    this.state = this.crashes.length >= 2
      ? { state: 'failed', error: `本机 Ming 连续出错（${why}）${detail === '' ? '' : `：${detail}`}` }
      : { state: 'stopped' }
    this.logger.warn(`dsh-her: Ming voice exited (${why}) ${detail}`)
  }

  private failPending(error: Error): void {
    for (const waiting of this.pending.values()) waiting.reject(error)
    this.pending.clear()
  }

  private stopWhenIdle(): void {
    if (this.idleMinutes <= 0 || this.state.state !== 'ready' || this.pending.size > 0) return
    if (Date.now() - this.lastUse < this.idleMinutes * 60_000) return
    this.logger.info(`dsh-her: Ming voice idle for ${this.idleMinutes} min, stopped to free memory`)
    this.stop()
  }
}

/** One file from `url` into `target`, checked against its size and SHA-256 before it takes the file's place. */
async function download(url: string, target: string, file: { size: number; sha256: string }, onProgress: (got: number) => void): Promise<void> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(3_600_000) })
  if (!res.ok || res.body === null) throw new Error(`HTTP ${res.status}`)
  const hash = createHash('sha256')
  let got = 0
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      got += chunk.length
      onProgress(got)
      done(null, chunk)
    },
  })
  const part = `${target}.part`
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), count, createWriteStream(part))
  if (got !== file.size || hash.digest('hex') !== file.sha256) {
    rmSync(part, { force: true })
    throw new Error('下载的文件校验不对')
  }
  renameSync(part, target)
}

