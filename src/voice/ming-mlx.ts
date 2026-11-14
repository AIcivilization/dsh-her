/**
 * Ming on MLX (docs/Ming本地声音设计.md): Apple chips with macOS 14+.
 *
 * - Install: uv (voice/uv.ts) builds a Python 3.12 environment in
 *   `<root>/env` and installs mlx-audio from python/ming-requirements.txt,
 *   every package pinned with its hash; the model (voice/ming-model.ts) is
 *   downloaded into `<root>/model`, each file checked against its size and
 *   SHA-256. An interrupted download goes on where it stopped.
 * - Run: python/ming_worker.py keeps the model loaded; one JSON request per
 *   line on its stdin, one reply per line on its stdout.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { wavFromPcm16 } from '../core/index.ts'
import { downloadChecked } from './checked-download.ts'
import { MingTimeout, type Logger, type MingAudio, type MingEngine, type MingRequest, type MingStep } from './ming-engine.ts'
import { MING_MODEL, MING_MODEL_BYTES } from './ming-model.ts'
import { installUv, run, uvEnv } from './uv.ts'

const PYTHON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'python')
const WORKER = join(PYTHON_DIR, 'ming_worker.py')
const REQUIREMENTS = join(PYTHON_DIR, 'ming-requirements.txt')
const LOAD_TIMEOUT_MS = 180_000

export class MlxEngine implements MingEngine {
  readonly kind = 'mlx'
  private readonly root: string
  private readonly uvHome: string
  private readonly logger: Logger
  private worker: ChildProcess | undefined
  private readonly pending = new Map<number, { resolve(reply: Record<string, unknown>): void; reject(error: Error): void }>()
  private nextId = 1
  private stderr: string[] = []

  /** `root`: `<home>/ming`; `uvHome`: `<home>/uv`, shared with the Edge voice. */
  constructor(root: string, uvHome: string, logger: Logger) {
    this.root = root
    this.uvHome = uvHome
    this.logger = logger
  }

  get installed(): boolean {
    return existsSync(this.python) && existsSync(join(this.modelDir, '.verified'))
  }

  get running(): boolean {
    return this.worker !== undefined
  }

  private get python(): string {
    return join(this.root, 'env', 'bin', 'python3')
  }

  private get modelDir(): string {
    return join(this.root, 'model')
  }

  async install(step: MingStep): Promise<void> {
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
  }

  /** Every model file, checked; files already checked (listed in `.checked.json`) are kept. */
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
          await downloadChecked(`${source}${file.name}`, target, file, got => onProgress(before + got, MING_MODEL_BYTES))
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

  async start(onExit: (why: string) => void): Promise<number> {
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
    const exited = (why: string) => {
      if (worker !== this.worker) return
      this.worker = undefined
      const detail = this.stderr.slice(-3).join(' ').slice(-300)
      const text = `${why}${detail === '' ? '' : `：${detail}`}`
      this.failPending(new Error(`本机 Ming 意外退出（${text}）`))
      onExit(text)
    }
    worker.on('error', error => exited(error.message))
    worker.on('exit', code => exited(`退出码 ${code}`))
    const reply = await this.send({ op: 'load', model: this.modelDir }, LOAD_TIMEOUT_MS)
    return Number(reply.loadMs)
  }

  async speak(request: MingRequest, timeoutMs: number): Promise<MingAudio> {
    const reply = await this.send({ op: 'speak', ...request }, timeoutMs)
    const pcm = Buffer.from(String(reply.pcm16), 'base64')
    const sampleRate = Number(reply.sampleRate)
    return { audio: wavFromPcm16(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), sampleRate), durationMs: Math.round(pcm.byteLength / 2 / sampleRate * 1000), ms: Number(reply.ms) }
  }

  stop(): void {
    const worker = this.worker
    this.worker = undefined
    if (worker === undefined) return
    worker.removeAllListeners('exit')
    worker.removeAllListeners('error')
    worker.kill()
    this.failPending(new Error('本机 Ming 已停止'))
  }

  private send(message: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const worker = this.worker
    if (worker?.stdin === null || worker === undefined) return Promise.reject(new Error('本机 Ming 没有在运行'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new MingTimeout())
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

  private failPending(error: Error): void {
    for (const waiting of this.pending.values()) waiting.reject(error)
    this.pending.clear()
  }
}
