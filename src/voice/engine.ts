/**
 * Parent side of the local speech recognition child process. Requests are answered in order of completion,
 * matched by id. If the child dies, pending requests fail and the next call
 * starts a fresh one.
 *
 * Inside the DSH desktop app `process.execPath` is Electron, so the child is
 * started with ELECTRON_RUN_AS_NODE. The sherpa native library directory is
 * put on the loader path, as sherpa-onnx documents.
 */

import { fork, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WorkerInit, WorkerReply, WorkerRequest } from './worker.ts'

type Success = Extract<WorkerReply, { ok: true }>
type Pending = { resolve: (reply: Success) => void; reject: (error: Error) => void }
type RequestBody = WorkerRequest extends infer R ? R extends WorkerRequest ? Omit<R, 'id'> : never : never

/** Directory of the platform package holding sherpa's shared libraries, if installed. */
function nativeLibDir(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    return dirname(require.resolve(`sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}/package.json`))
  } catch {
    return undefined
  }
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (process.versions.electron !== undefined) env.ELECTRON_RUN_AS_NODE = '1'
  const lib = nativeLibDir()
  if (lib !== undefined) {
    const key = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : process.platform === 'win32' ? 'PATH' : 'LD_LIBRARY_PATH'
    const sep = process.platform === 'win32' ? ';' : ':'
    env[key] = env[key] ? `${lib}${sep}${env[key]}` : lib
  }
  return env
}

export class LocalVoice {
  private child: ChildProcess | undefined
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private ready: Promise<{ loadMs: number }> | undefined
  private readonly init: WorkerInit

  constructor(init: WorkerInit) {
    this.init = init
  }

  /** Load the models (once); resolves with how long loading took. */
  start(): Promise<{ loadMs: number }> {
    this.ready ??= this.request({ op: 'init', init: this.init }).then(reply => {
      if (reply.op !== 'init') throw new Error('unexpected reply')
      return { loadMs: reply.loadMs }
    })
    return this.ready
  }

  async recognize(samples: Float32Array, sampleRate: number): Promise<{ text: string; lang: string; ms: number }> {
    await this.start()
    const reply = await this.request({ op: 'asr', samples, sampleRate })
    if (reply.op !== 'asr') throw new Error('unexpected reply')
    return { text: reply.text, lang: reply.lang, ms: reply.ms }
  }

  stop(): void {
    this.child?.kill()
    this.child = undefined
    this.ready = undefined
  }

  private spawn(): ChildProcess {
    const here = fileURLToPath(import.meta.url)
    const worker = here.replace(/engine\.(ts|js)$/, 'worker.$1')
    const child = fork(worker, [], { env: childEnv(), serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    child.on('message', (reply: WorkerReply) => {
      const waiter = this.pending.get(reply.id)
      if (waiter === undefined) return
      this.pending.delete(reply.id)
      if (reply.ok) waiter.resolve(reply)
      else waiter.reject(new Error(reply.error))
    })
    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.child = undefined
        this.ready = undefined
      }
      const error = new Error(`语音子进程退出了（${signal ?? code}）`)
      for (const waiter of this.pending.values()) waiter.reject(error)
      this.pending.clear()
    })
    return child
  }

  private request(body: RequestBody): Promise<Success> {
    this.child ??= this.spawn()
    const id = this.nextId++
    const child = this.child
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.send({ ...body, id } as WorkerRequest)
    })
  }
}
