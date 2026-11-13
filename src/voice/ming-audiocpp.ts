/**
 * Ming on audio.cpp (docs/Ming跨平台.md): the same model, run by audio.cpp's
 * `audiocpp_server`, a native program with no Python. It runs on Windows,
 * Linux and Intel Macs, on the GPU (Vulkan, CUDA, Metal) or the CPU.
 *
 * - Install, into `<root>/audiocpp/`: the GGUF model (`model/`) and the main
 *   build of audio.cpp for this computer (`<version>/<build>/`), each checked
 *   against its size and SHA-256 (audiocpp-release.ts). Then a self-check:
 *   one sentence on every backend the build has, timed; the fastest is used
 *   (`choice.json`) and shown on the page. When nothing runs, the CPU-only
 *   fallback builds are tried. The CUDA build (about 1 GB) only on request.
 * - Run: `audiocpp_server` on a free port of 127.0.0.1, with the model
 *   loaded; one sentence per `POST /v1/audio/speech`, a WAV back.
 *
 * The request mapping keeps what MLX does (python/ming_worker.py): built-in
 * voices are an IP caption over a zero speaker embedding, with the mood and
 * pace in the same caption; your own voices clone their recording, the mood
 * as an instruction; a design is the voice-design template. audio.cpp's flow
 * takes a fixed 10 steps, so "速度优先" makes no difference here.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { availableParallelism } from 'node:os'
import { delimiter, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { decodeWav, encodeWav } from '../core/index.ts'
import { systemTar } from '../platform.ts'
import { AUDIOCPP_BUILDS, AUDIOCPP_VERSION, audiocppUrl, buildBytes, MING_GGUF, type AudioCppBuild, type Backend } from './audiocpp-release.ts'
import { downloadChecked } from './checked-download.ts'
import { MingTimeout, type Logger, type MingAudio, type MingEngine, type MingRequest, type MingStep } from './ming-engine.ts'

/** One sentence slower than this, and she is better off on Edge. */
export const SLOW_MS = 5000
/** The sentence the self-check times (16 characters, about one of her sentences). */
export const CHECK_TEXT = '你好呀，今天过得怎么样？我一直在等你。'
const WARM = { text: '嗯。', voice: '灵小芸', steps: 5 } satisfies MingRequest
const LOAD_TIMEOUT_MS = 180_000
const HEALTH_TIMEOUT_MS = 60_000
const CHECK_TIMEOUT_MS = 120_000
const MODEL_ID = 'ming'

export const BACKEND_LABELS: Record<Backend, string> = { metal: '显卡（Metal）', vulkan: '显卡（Vulkan）', cuda: 'NVIDIA 显卡（CUDA）', cpu: 'CPU' }

export interface CheckResult {
  build: string
  backend: Backend
  /** One sentence (CHECK_TEXT), once the model was loaded and warm. */
  ms?: number
  error?: string
}

export interface AudioCppChoice {
  version: string
  build: string
  backend: Backend
  ms: number
  results: CheckResult[]
  at: string
}

/** What the page shows: what is used, how fast, the alternatives, and whether CUDA can be added. */
export interface AudioCppInfo {
  chosen?: { build: string; backend: Backend; label: string; ms: number }
  results: Array<CheckResult & { label: string }>
  slow: boolean
  cuda: 'none' | 'available' | 'installed'
  /** The CUDA download, in MB. */
  cudaMB?: number
}

// ---------------------------------------------------------------- pure parts

/** The fastest backend that spoke; undefined when none did. */
export function pickFastest(results: readonly CheckResult[]): CheckResult | undefined {
  return results.filter(r => r.ms !== undefined && r.error === undefined).sort((a, b) => a.ms! - b.ms!)[0]
}

/** CPU threads for audio.cpp: leave the rest of the computer two, at most 8 (more does not help a 0.5B model). */
export function cpuThreads(logical: number = availableParallelism()): number {
  return logical <= 4 ? Math.max(1, logical) : Math.min(8, logical - 2)
}

/**
 * Ming-3.0's control caption (mlx-audio's ming3_instruction): the layout and
 * key order the model was trained on, Chinese field names.
 */
export function ming3Instruction(controls: { emotion?: string; speed?: string; ip?: string }): string {
  const item = {
    序号: 1, 说话人: 'speaker_1', 方言: null, 风格: null, 语速: controls.speed ?? null, 基频: null, 音量: null, 情感: controls.emotion ?? null,
    BGM: { Genre: null, Mood: null, Instrument: null, Theme: null, ENV: null, SNR: null },
    IP: controls.ip ?? null,
  }
  // Python's json.dumps spacing: ", " and ": ".
  return JSON.stringify({ audio_sequence: [item] }).replaceAll(/("(?:[^"\\]|\\.)*"|[,:])/g, m => (m === ',' ? ', ' : m === ':' ? ': ' : m))
}

/** The body of `POST /v1/audio/speech` for one sentence. */
export function speechBody(request: MingRequest, model = MODEL_ID): Record<string, unknown> {
  const options: Record<string, string | boolean> = { language: 'zh' }
  const body: Record<string, unknown> = { model, input: request.text, response_format: 'wav' }
  if (request.seed !== undefined) body.seed = request.seed
  const mood = { ...(request.emotion === undefined ? {} : { emotion: request.emotion }), ...(request.speed === undefined ? {} : { speed: request.speed }) }
  if (request.design !== undefined) {
    options.template_name = 'voice_design'
    options.instruct = request.design
    options.zero_speaker_embedding = true
  } else if (request.ref !== undefined) {
    body.voice_ref = { type: 'path', path: request.ref.wav }
    body.reference_text = request.ref.text
    if (mood.emotion !== undefined || mood.speed !== undefined) options.instruct = ming3Instruction(mood)
  } else if (request.voice !== undefined) {
    // The IP template takes no mood, so the whole caption goes in as it is.
    options.template_name = 'freeform'
    options.instruct = ming3Instruction({ ...mood, ip: request.voice })
    options.zero_speaker_embedding = true
  } else {
    throw new Error('要选一个声音')
  }
  body.options = options
  return body
}

/** The server's configuration: this model only, on one backend, on 127.0.0.1. */
export function serverConfig(o: { port: number; backend: Backend; threads: number; model: string }): Record<string, unknown> {
  return {
    host: '127.0.0.1', port: o.port, backend: o.backend, threads: o.threads,
    lazy_load: false, max_loaded_models: 1, idle_unload_ms: 0, log_request_body: false,
    models: [{ id: MODEL_ID, family: 'ming3_tts', path: o.model, task: 'tts', mode: 'offline' }],
  }
}

/** A failed reply in a sentence: the server's `{"error": …}` message when it sent one. */
export function replyError(status: number, text: string): string {
  let message = text.trim()
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown }
    const error = parsed.error
    message = typeof error === 'string' ? error : typeof (error as { message?: unknown })?.message === 'string' ? (error as { message: string }).message : typeof parsed.message === 'string' ? parsed.message : message
  } catch {
    // not JSON: the text itself
  }
  return `本机 Ming 出错（HTTP ${status}）${message === '' ? '' : `：${message.slice(0, 300)}`}`
}

/** An NVIDIA driver is installed (its tool or its kernel module is there). */
export function hasNvidia(platform: string = process.platform, exists: (path: string) => boolean = existsSync): boolean {
  if (platform === 'win32') return exists(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe'))
  if (platform === 'linux') return exists('/proc/driver/nvidia/version')
  return false
}

/** The page's view of a choice. */
export function audiocppInfo(choice: AudioCppChoice | undefined, cuda: AudioCppInfo['cuda'], cudaBytes?: number): AudioCppInfo {
  const label = (r: { backend: Backend }) => BACKEND_LABELS[r.backend]
  return {
    ...(choice === undefined ? {} : { chosen: { build: choice.build, backend: choice.backend, label: label(choice), ms: choice.ms } }),
    results: (choice?.results ?? []).map(r => ({ ...r, label: label(r) })),
    slow: choice !== undefined && choice.ms > SLOW_MS,
    cuda,
    ...(cudaBytes === undefined ? {} : { cudaMB: Math.round(cudaBytes / 1e6) }),
  }
}

// ---------------------------------------------------------------- the engine

export class AudioCppEngine implements MingEngine {
  readonly kind = 'audiocpp'
  private readonly dir: string
  private readonly logger: Logger
  private readonly builds: readonly AudioCppBuild[]
  private server: { child: ChildProcess; base: string } | undefined
  private output: string[] = []

  /** `root`: `<home>/ming`. `key`: `<platform>-<arch>`, which builds apply. */
  constructor(root: string, logger: Logger, key = `${process.platform}-${process.arch}`) {
    this.dir = join(root, 'audiocpp')
    this.logger = logger
    this.builds = AUDIOCPP_BUILDS[key] ?? []
  }

  get installed(): boolean {
    const choice = this.choice()
    return choice !== undefined && this.modelReady && this.serverOf(choice.build) !== undefined
  }

  get running(): boolean {
    return this.server !== undefined
  }

  /** What the page shows. */
  get info(): AudioCppInfo {
    const cuda = this.builds.find(b => b.kind === 'cuda')
    const state = cuda === undefined ? 'none' : this.fetched(cuda) ? 'installed' : hasNvidia() ? 'available' : 'none'
    return audiocppInfo(this.choice(), state, cuda === undefined ? undefined : buildBytes(cuda))
  }

  choice(): AudioCppChoice | undefined {
    try {
      const choice = JSON.parse(readFileSync(join(this.dir, 'choice.json'), 'utf8')) as AudioCppChoice
      return choice.version === AUDIOCPP_VERSION ? choice : undefined
    } catch {
      return undefined
    }
  }

  private get model(): string {
    return join(this.dir, 'model', MING_GGUF.file)
  }

  private get modelReady(): boolean {
    return existsSync(join(this.dir, 'model', '.verified')) && existsSync(this.model)
  }

  private buildDir(id: string): string {
    return join(this.dir, AUDIOCPP_VERSION, id)
  }

  private fetched(build: AudioCppBuild): boolean {
    return existsSync(join(this.buildDir(build.id), '.verified'))
  }

  async install(step: MingStep): Promise<void> {
    mkdirSync(this.dir, { recursive: true })
    // An older audio.cpp: its programs go, the model stays.
    for (const entry of readdirSync(this.dir)) if (/^v\d/.test(entry) && entry !== AUDIOCPP_VERSION) rmSync(join(this.dir, entry), { recursive: true, force: true })
    if (this.builds.length === 0) throw new Error('这台电脑上没有能用的 audio.cpp')
    await this.downloadModel(step)
    const results: CheckResult[] = []
    for (const build of this.builds.filter(b => b.kind === 'main')) {
      await this.fetchBuild(build, step)
      results.push(...await this.check(build, step))
    }
    for (const build of this.builds.filter(b => b.kind === 'fallback')) {
      if (pickFastest(results) !== undefined) break
      await this.fetchBuild(build, step)
      results.push(...await this.check(build, step))
    }
    // A CUDA build added before (a reinstall over it) is measured too.
    for (const build of this.builds.filter(b => b.kind === 'cuda' && this.fetched(b))) results.push(...await this.check(build, step))
    this.saveChoice(results)
  }

  /** Download the CUDA build (about 1 GB) and measure it; it is used when it is the fastest. */
  async addCuda(step: MingStep): Promise<void> {
    const build = this.builds.find(b => b.kind === 'cuda')
    if (build === undefined) throw new Error('这台电脑没有 CUDA 版')
    this.stop()
    await this.fetchBuild(build, step)
    const results = await this.check(build, step)
    this.saveChoice([...(this.choice()?.results ?? []).filter(r => r.build !== build.id), ...results])
  }

  /** Measure every downloaded build again (after a driver update, say). */
  async recheck(step: MingStep): Promise<void> {
    this.stop()
    const results: CheckResult[] = []
    for (const build of this.builds.filter(b => this.fetched(b))) results.push(...await this.check(build, step))
    this.saveChoice(results)
  }

  /** Use this one from now on (from the page); it must have spoken in the self-check. */
  choose(build: string, backend: Backend): void {
    const choice = this.choice()
    const result = choice?.results.find(r => r.build === build && r.backend === backend && r.ms !== undefined && r.error === undefined)
    if (choice === undefined || result === undefined) throw new Error('这一种在自检时没能说话，不能选')
    this.stop()
    this.writeChoice({ ...choice, build, backend, ms: result.ms! })
  }

  private saveChoice(results: CheckResult[]): void {
    const best = pickFastest(results)
    if (best === undefined) {
      const why = [...new Set(results.map(r => r.error).filter(Boolean))].join('；').slice(0, 300)
      throw new Error(`这台电脑跑不起来本机 Ming${why === '' ? '' : `（${why}）`}`)
    }
    this.writeChoice({ version: AUDIOCPP_VERSION, build: best.build, backend: best.backend, ms: best.ms!, results, at: new Date().toISOString() })
    this.logger.info(`dsh-her: Ming on audio.cpp uses ${best.build} / ${best.backend} (${best.ms} ms a sentence); ${results.map(r => `${r.backend}: ${r.ms ?? r.error}`).join(', ')}`)
  }

  private writeChoice(choice: AudioCppChoice): void {
    writeFileSync(join(this.dir, 'choice.json'), `${JSON.stringify(choice, null, 2)}\n`)
  }

  private async downloadModel(step: MingStep): Promise<void> {
    if (this.modelReady) return
    const modelDir = join(this.dir, 'model')
    mkdirSync(modelDir, { recursive: true })
    let lastError: Error | undefined
    for (const source of MING_GGUF.sources) {
      try {
        await downloadChecked(`${source}${MING_GGUF.file}`, this.model, MING_GGUF, got => step('下载声音模型（约 1.7 GB）', { done: got, total: MING_GGUF.size }))
        writeFileSync(join(modelDir, '.verified'), `${MING_GGUF.repo}@${MING_GGUF.revision}\n`)
        return
      } catch (error) {
        lastError = error as Error
        this.logger.warn(`dsh-her: Ming GGUF from ${source} failed (${lastError.message})`)
      }
    }
    throw new Error(`下载声音模型失败：${lastError?.message ?? ''}`)
  }

  /** Download and unpack a build (its program, and CUDA's runtime next to it). */
  private async fetchBuild(build: AudioCppBuild, step: MingStep): Promise<void> {
    if (this.fetched(build)) return
    const target = this.buildDir(build.id)
    const staging = `${target}.staging`
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    const total = buildBytes(build)
    let before = 0
    try {
      for (const p of build.packages) {
        const archive = join(this.dir, AUDIOCPP_VERSION, p.file)
        const what = build.kind === 'cuda' ? `下载 CUDA 版（约 ${Math.round(total / 1e6)} MB）` : `下载语音程序（约 ${Math.round(total / 1e6)} MB）`
        if (!(existsSync(archive) && statSync(archive).size === p.size)) {
          await downloadChecked(audiocppUrl(p.file), archive, p, got => step(what, { done: before + got, total }))
        }
        before += p.size
        step('解压语音程序')
        // bsdtar reads both .tar.gz and (Windows 10+) .zip.
        await promisify(execFile)(systemTar(), ['-xf', archive, '-C', staging], { timeout: 600_000 })
        rmSync(archive, { force: true })
      }
      rmSync(target, { recursive: true, force: true })
      renameSync(staging, target)
      if (serverIn(target) === undefined) throw new Error('程序包里没有 audiocpp_server')
      writeFileSync(join(target, '.verified'), `${build.packages.map(p => `${p.file} ${p.sha256}`).join('\n')}\n`)
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }

  private serverOf(buildId: string): string | undefined {
    const dir = this.buildDir(buildId)
    return existsSync(join(dir, '.verified')) ? serverIn(dir) : undefined
  }

  /** Every backend of a build: load, warm up, time one sentence. */
  private async check(build: AudioCppBuild, step: MingStep): Promise<CheckResult[]> {
    const results: CheckResult[] = []
    for (const backend of build.backends) {
      step(`测一下哪种最快：${BACKEND_LABELS[backend]}…`)
      try {
        await this.launch(build.id, backend)
        await this.speak(WARM, LOAD_TIMEOUT_MS)
        const said = await this.speak({ text: CHECK_TEXT, voice: '灵小芸', steps: 10 }, CHECK_TIMEOUT_MS)
        results.push({ build: build.id, backend, ms: said.ms })
      } catch (error) {
        results.push({ build: build.id, backend, error: (error as Error).message.slice(0, 200) })
      } finally {
        this.stop()
      }
    }
    return results
  }

  async start(onExit: (why: string) => void): Promise<number> {
    const choice = this.choice()
    if (choice === undefined) throw new Error('本机 Ming 还没装好')
    const started = Date.now()
    await this.launch(choice.build, choice.backend, onExit)
    await this.speak(WARM, LOAD_TIMEOUT_MS)
    return Date.now() - started
  }

  /** Start `audiocpp_server` and wait until it answers. */
  private async launch(buildId: string, backend: Backend, onExit?: (why: string) => void): Promise<void> {
    this.stop()
    const exe = this.serverOf(buildId)
    if (exe === undefined) throw new Error('找不到语音程序，重新安装一次吧')
    const dir = this.buildDir(buildId)
    const port = await freePort()
    const config = join(this.dir, 'server.json')
    writeFileSync(config, JSON.stringify(serverConfig({ port, backend, threads: cpuThreads(), model: this.model }), null, 2))
    // CUDA's runtime libraries sit next to the program (or in a folder of the runtime archive).
    const libs = libraryDirs(dir)
    const env = { ...process.env }
    if (process.platform === 'win32') env.PATH = [...libs, env.PATH ?? env.Path ?? ''].join(delimiter)
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = [...libs, env.LD_LIBRARY_PATH ?? ''].filter(Boolean).join(delimiter)
    this.output = []
    const child = spawn(exe, ['--config', config, '--no-ui'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const keep = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim() !== '') this.output.push(line.trim())
      if (this.output.length > 30) this.output.splice(0, this.output.length - 30)
    }
    child.stdout!.on('data', keep)
    child.stderr!.on('data', keep)
    const base = `http://127.0.0.1:${port}`
    this.server = { child, base }
    let exited: string | undefined
    const gone = (why: string) => {
      exited ??= `${why}${this.lastOutput === '' ? '' : `：${this.lastOutput}`}`
      if (this.server?.child !== child) return
      this.server = undefined
      onExit?.(exited)
    }
    child.on('error', error => gone(error.message))
    child.on('exit', (code, signal) => gone(`退出码 ${code ?? signal}`))
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    while (true) {
      if (exited !== undefined) throw new Error(`语音程序启动失败（${exited}）`)
      if (Date.now() > deadline) {
        this.stop()
        throw new Error('语音程序太久没有启动')
      }
      const health = await call(`${base}/health`, undefined, 2000).catch(() => undefined)
      if (health?.status === 200) return
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  private get lastOutput(): string {
    return this.output.slice(-3).join(' ').slice(-300)
  }

  async speak(request: MingRequest, timeoutMs: number): Promise<MingAudio> {
    const server = this.server
    if (server === undefined) throw new Error('本机 Ming 没有在运行')
    const started = Date.now()
    let reply: { status: number; body: Buffer }
    try {
      reply = await call(`${server.base}/v1/audio/speech`, JSON.stringify(speechBody(request)), timeoutMs)
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') throw new MingTimeout()
      throw new Error(`本机 Ming 没有回应（${(error as Error).message}）`)
    }
    if (reply.status !== 200) throw new Error(replyError(reply.status, reply.body.toString('utf8')))
    const { samples, sampleRate } = decodeWav(new Uint8Array(reply.body.buffer, reply.body.byteOffset, reply.body.byteLength))
    return { audio: encodeWav(samples, sampleRate), durationMs: Math.round(samples.length / sampleRate * 1000), ms: Date.now() - started }
  }

  stop(): void {
    const server = this.server
    this.server = undefined
    if (server === undefined) return
    server.child.removeAllListeners('exit')
    server.child.removeAllListeners('error')
    server.child.kill()
  }
}

/** `audiocpp_server` in a build's folder (at its top, or one folder down). */
function serverIn(dir: string): string | undefined {
  const name = process.platform === 'win32' ? 'audiocpp_server.exe' : 'audiocpp_server'
  if (existsSync(join(dir, name))) return join(dir, name)
  for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    if (entry.isDirectory() && existsSync(join(dir, entry.name, name))) return join(dir, entry.name, name)
  }
  return undefined
}

/** Folders of a build that hold shared libraries. */
function libraryDirs(dir: string): string[] {
  const found = new Set<string>()
  const look = (at: string, depth: number) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory() && depth > 0 && entry.name !== 'model_specs' && entry.name !== 'tools') look(join(at, entry.name), depth - 1)
      else if (/\.(dll|so(\.\d+)*|dylib)$/.test(entry.name)) found.add(at)
    }
  }
  look(dir, 2)
  return [...found]
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('no port'))))
    })
  })
}

/**
 * GET (no body) or POST JSON to the local server with node:http: no proxy
 * (Node's fetch can follow HTTP_PROXY, and 127.0.0.1 must not go through it).
 */
function call(url: string, json: string | undefined, timeoutMs: number): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, {
      method: json === undefined ? 'GET' : 'POST',
      headers: json === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }) })
      res.on('error', error => { clearTimeout(timer); reject(error) })
    })
    const timer = setTimeout(() => {
      const error = new Error('timed out')
      error.name = 'TimeoutError'
      req.destroy(error)
    }, timeoutMs)
    req.on('error', error => { clearTimeout(timer); reject(error) })
    req.end(json)
  })
}
