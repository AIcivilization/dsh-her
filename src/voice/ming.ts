/**
 * Ming-3.0-tts on this computer (docs/Ming本地声音设计.md, docs/Ming跨平台.md):
 * offline, free, with moods, and voices of your own. Two programs run it:
 *
 * - MLX (ming-mlx.ts): Apple chips with macOS 14+, a Python process;
 * - audio.cpp (ming-audiocpp.ts): Windows, Linux and Intel Macs (and Apple
 *   chips on older macOS), a native server; at install it times every backend
 *   it has (GPU, CPU) and keeps the fastest.
 *
 * Which one follows from the computer (`mingEngine`); `DSH_HER_MING_ENGINE`
 * overrides it (`audiocpp` on an Apple chip, to compare the two).
 *
 * Both are installed on request from the "她" page; deleting `<home>/ming`
 * uninstalls them. The process keeps the model loaded (about 2 GB of memory);
 * sentences go to it one at a time. It starts with the first sentence (or
 * when you start talking, `warm`), and stops after some minutes without a
 * sentence to give the memory back. A process that dies is started again with
 * the next sentence; one that dies twice within five minutes is left stopped
 * (`failed`) until `restart`.
 */

import { rmSync } from 'node:fs'
import { release, totalmem } from 'node:os'
import { AudioCppEngine, type AudioCppInfo } from './ming-audiocpp.ts'
import { MingTimeout, type Logger, type MingAudio, type MingEngine, type MingRequest } from './ming-engine.ts'
import { MlxEngine } from './ming-mlx.ts'
import { AUDIOCPP_BUILDS, type Backend } from './audiocpp-release.ts'

export type { MingAudio, MingRequest } from './ming-engine.ts'

export type MingState = 'unsupported' | 'absent' | 'installing' | 'stopped' | 'loading' | 'ready' | 'failed'

export interface MingStatus {
  state: MingState
  /** Which program runs Ming here. */
  engine?: 'mlx' | 'audiocpp'
  /** audio.cpp: what the self-check found and what is used. */
  audiocpp?: AudioCppInfo
  /** While installing: what is being done, and bytes so far. */
  step?: string
  done?: number
  total?: number
  error?: string
}

const SPEAK_TIMEOUT_MS = 90_000
const CRASH_WINDOW_MS = 5 * 60_000

/** On Windows it is not offered yet (not tried there); `DSH_HER_MING_ENGINE=audiocpp` turns it on for trying it. */
export const MING_WINDOWS_NOT_YET = '本机 Ming 在 Windows 上暂时还不能用（还在测试）。现在可以用微软 Edge 的声音，或者在「声音」页下面的「外接的语音服务」里接你自己电脑上的 GPT-SoVITS。'

/** Which program runs Ming on a computer, or why none can. */
export function mingEngine(platform: string = process.platform, arch: string = process.arch, darwin = release(), override = process.env.DSH_HER_MING_ENGINE): { engine: 'mlx' | 'audiocpp' } | { unsupported: string } {
  const audiocpp = AUDIOCPP_BUILDS[`${platform}-${arch}`] !== undefined
  if (override === 'audiocpp' && audiocpp) return { engine: 'audiocpp' }
  if (platform === 'win32') return { unsupported: MING_WINDOWS_NOT_YET }
  // MLX needs macOS 14 (Darwin 23); measured on an M1 Pro it is as fast as audio.cpp's Metal (docs/Ming跨平台.md §6).
  if (platform === 'darwin' && arch === 'arm64' && Number.parseInt(darwin, 10) >= 23) return { engine: 'mlx' }
  if (audiocpp) return { engine: 'audiocpp' }
  return { unsupported: '本机 Ming 支持 Mac、x64 的 Windows 和 Linux；这台电脑（ARM 的 Windows 或 Linux）暂不支持' }
}

/** Why Ming cannot run here, or undefined when it can. */
export function mingUnsupported(platform: string = process.platform, arch: string = process.arch, darwin = release()): string | undefined {
  const which = mingEngine(platform, arch, darwin, undefined)
  return 'unsupported' in which ? which.unsupported : undefined
}

/** Minutes without a sentence before the worker stops: 10 on a computer with 16 GB or less, else 30. */
export const defaultIdleMinutes = (memory = totalmem()): number => (memory <= 16 * 2 ** 30 ? 10 : 30)

export class MingVoice {
  private readonly root: string
  private readonly logger: Logger
  private readonly engine: MingEngine | undefined
  private state: MingStatus
  private starting: Promise<void> | undefined
  private installing: Promise<void> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private lastUse = 0
  private crashes: number[] = []
  private idleMinutes: number
  private readonly idleTimer: NodeJS.Timeout

  /** `root`: `<home>/ming`; `uvHome`: `<home>/uv`, shared with the Edge voice. `idleMinutes` 0: never stop. */
  constructor(root: string, uvHome: string, logger: Logger, idleMinutes = defaultIdleMinutes()) {
    this.root = root
    this.logger = logger
    this.idleMinutes = idleMinutes
    const which = mingEngine()
    if ('unsupported' in which) {
      this.state = { state: 'unsupported', error: which.unsupported }
    } else {
      this.engine = which.engine === 'mlx' ? new MlxEngine(root, uvHome, logger) : new AudioCppEngine(root, logger)
      this.state = { state: this.installed ? 'stopped' : 'absent' }
    }
    this.idleTimer = setInterval(() => this.stopWhenIdle(), 60_000)
    this.idleTimer.unref()
  }

  get status(): MingStatus {
    if (this.engine === undefined) return this.state
    return { ...this.state, engine: this.engine.kind, ...(this.engine instanceof AudioCppEngine ? { audiocpp: this.engine.info } : {}) }
  }

  get installed(): boolean {
    return this.engine?.installed ?? false
  }

  setIdleMinutes(minutes: number): void {
    this.idleMinutes = minutes
  }

  /** Install everything (once; a second call joins the first). Progress shows in `status`. */
  install(): Promise<void> {
    return this.busy(engine => engine.install((text, extra = {}) => { this.state = { state: 'installing', step: text, ...extra } }), '安装本机 Ming 失败')
  }

  /** audio.cpp: download the CUDA build and measure it. */
  addCuda(): Promise<void> {
    return this.busy(engine => this.audiocpp(engine).addCuda((text, extra = {}) => { this.state = { state: 'installing', step: text, ...extra } }), '加 CUDA 版失败')
  }

  /** audio.cpp: time every backend again. */
  recheck(): Promise<void> {
    return this.busy(engine => this.audiocpp(engine).recheck((text, extra = {}) => { this.state = { state: 'installing', step: text, ...extra } }), '自检失败')
  }

  /** audio.cpp: use this build and backend from now on. */
  chooseBackend(build: string, backend: Backend): void {
    if (this.engine === undefined) throw new Error(this.state.error)
    this.audiocpp(this.engine).choose(build, backend)
    this.crashes = []
    this.state = { state: 'stopped' }
  }

  private audiocpp(engine: MingEngine): AudioCppEngine {
    if (!(engine instanceof AudioCppEngine)) throw new Error('只有 audio.cpp 版本机 Ming 有这一项')
    return engine
  }

  /** Installing, or measuring: one at a time, with the voice stopped, progress in `status`. */
  private busy(work: (engine: MingEngine) => Promise<void>, failed: string): Promise<void> {
    const engine = this.engine
    if (engine === undefined) return Promise.reject(new Error(this.state.error))
    this.installing ??= (async () => {
      this.stop()
      this.state = { state: 'installing' }
      try {
        await work(engine)
        this.crashes = []
        this.state = { state: 'stopped' }
        this.logger.info(`dsh-her: Ming voice installed (${engine.kind})`)
      } catch (error) {
        this.state = { state: engine.installed ? 'stopped' : 'failed', error: `${failed}：${(error as Error).message}` }
        if (!engine.installed) throw new Error(this.state.error)
        throw error
      }
    })().finally(() => { this.installing = undefined })
    return this.installing
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
    this.starting = undefined
    this.engine?.stop()
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
    try {
      return await this.engine!.speak(request, SPEAK_TIMEOUT_MS)
    } catch (error) {
      // A process stuck on one sentence is stuck for all of them.
      if (error instanceof MingTimeout) this.stop()
      throw error
    } finally {
      this.lastUse = Date.now()
    }
  }

  private ensure(): Promise<void> {
    const engine = this.engine
    if (engine === undefined) return Promise.reject(new Error(this.state.error))
    if (this.state.state === 'ready' && engine.running) return Promise.resolve()
    if (this.state.state === 'installing') return Promise.reject(new Error('本机 Ming 正在安装'))
    if (!engine.installed) return Promise.reject(new Error('本机 Ming 还没安装'))
    if (this.state.state === 'failed' && this.crashes.length >= 2) return Promise.reject(new Error(this.state.error ?? '本机 Ming 出错了'))
    this.starting ??= this.start(engine).finally(() => { this.starting = undefined })
    return this.starting
  }

  private async start(engine: MingEngine): Promise<void> {
    this.state = { state: 'loading' }
    try {
      const loadMs = await engine.start(why => this.onExit(why))
      this.state = { state: 'ready' }
      this.lastUse = Date.now()
      this.logger.info(`dsh-her: Ming voice loaded (${engine.kind}, ${loadMs} ms)`)
    } catch (error) {
      engine.stop()
      this.state = { state: 'failed', error: `本机 Ming 启动失败：${(error as Error).message}` }
      this.crashes.push(Date.now())
      throw new Error(this.state.error)
    }
  }

  private onExit(why: string): void {
    const now = Date.now()
    this.crashes = [...this.crashes.filter(at => now - at < CRASH_WINDOW_MS), now]
    this.state = this.crashes.length >= 2 ? { state: 'failed', error: `本机 Ming 连续出错（${why}）` } : { state: 'stopped' }
    this.logger.warn(`dsh-her: Ming voice exited (${why})`)
  }

  private stopWhenIdle(): void {
    if (this.idleMinutes <= 0 || this.state.state !== 'ready') return
    if (Date.now() - this.lastUse < this.idleMinutes * 60_000) return
    this.logger.info(`dsh-her: Ming voice idle for ${this.idleMinutes} min, stopped to free memory`)
    this.stop()
  }
}
