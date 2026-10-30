/**
 * Alibaba Cloud Model Studio (百炼) CosyVoice over its WebSocket API: one
 * connection, kept open and reused, one task per sentence (run-task →
 * continue-task → finish-task; audio arrives as binary frames, then
 * task-finished). Tasks run one at a time, in order; the speech queue is
 * serial anyway, and a preview simply waits its turn.
 *
 * Audio is requested as raw PCM16 and wrapped in WAV here, so its duration
 * is exact. Docs: https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api
 */

import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { wavFromPcm16 } from '../core/index.ts'

/**
 * Mainland China (Beijing) and international (Singapore): a key works in the
 * region it was made in only, so a refused key is tried on the other one, and
 * the one that took it is kept.
 */
const ENDPOINTS = ['wss://dashscope.aliyuncs.com/api-ws/v1/inference', 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference']
const SAMPLE_RATE = 24000
const TASK_TIMEOUT_MS = 20_000
const CONNECT_TIMEOUT_MS = 8_000

/** The account cannot be used: no key or a refused one (`key`), or no quota left (`quota`). Retrying soon will not help. */
export class CloudAccountError extends Error {
  readonly reason: 'key' | 'quota'
  constructor(message: string, reason: 'key' | 'quota' = 'key') {
    super(message)
    this.reason = reason
  }
}
/** The cloud answered and refused this sentence: retrying it would not help. */
class CloudTaskError extends Error {}

export interface CloudAudio {
  /** WAV bytes. */
  audio: Uint8Array
  durationMs: number
  /** From sending the task to the last audio frame. */
  ms: number
}

interface Task {
  id: string
  /** Sent once the server says the task has started. */
  text: string
  chunks: Buffer[]
  resolve: (pcm: Buffer) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class CosyVoice {
  private socket: WebSocket | undefined
  private opening: Promise<WebSocket> | undefined
  private task: Task | undefined
  private chain: Promise<unknown> = Promise.resolve()
  private readonly model: string
  private readonly getKey: () => Promise<string | undefined>
  private readonly endpoints: readonly string[]
  /** The endpoint that last accepted the key; tried first. */
  private endpoint: string

  constructor(model: string, getKey: () => Promise<string | undefined>, endpoints: readonly string[] = ENDPOINTS) {
    this.model = model
    this.getKey = getKey
    this.endpoints = endpoints
    this.endpoint = endpoints[0]!
  }

  /** Open the connection ahead of time (when you start talking), so her first sentence does not pay for it. */
  warm(): void {
    this.connect().catch(() => undefined)
  }

  /** One sentence. Rejects with CloudAccountError when there is no key or it is refused. */
  synthesize(text: string, voice: string, rate: number): Promise<CloudAudio> {
    const run = this.chain.then(() => this.run(text, voice, rate))
    this.chain = run.catch(() => undefined)
    return run
  }

  close(): void {
    this.socket?.close()
    this.socket = undefined
    this.opening = undefined
  }

  private async run(text: string, voice: string, rate: number): Promise<CloudAudio> {
    const started = Date.now()
    let pcm: Buffer
    try {
      pcm = await this.once(await this.connect(), text, voice, rate)
    } catch (error) {
      if (error instanceof CloudAccountError || error instanceof CloudTaskError) throw error
      // A connection the server had already closed: try once more on a fresh one.
      this.close()
      pcm = await this.once(await this.connect(), text, voice, rate)
    }
    return { audio: wavFromPcm16(pcm, SAMPLE_RATE), durationMs: Math.round((pcm.byteLength / 2 / SAMPLE_RATE) * 1000), ms: Date.now() - started }
  }

  private once(socket: WebSocket, text: string, voice: string, rate: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const id = randomUUID().replaceAll('-', '')
      const timer = setTimeout(() => this.fail(new Error('云端语音超时')), TASK_TIMEOUT_MS)
      this.task = { id, text, chunks: [], resolve, reject, timer }
      socket.send(JSON.stringify({
        header: { action: 'run-task', task_id: id, streaming: 'duplex' },
        payload: {
          task_group: 'audio', task: 'tts', function: 'SpeechSynthesizer', model: this.model,
          parameters: { text_type: 'PlainText', voice, format: 'pcm', sample_rate: SAMPLE_RATE, volume: 50, rate, pitch: 1 },
          input: {},
        },
      }))
    })
  }

  private connect(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket)
    this.opening ??= this.open().finally(() => { this.opening = undefined })
    return this.opening
  }

  private async open(): Promise<WebSocket> {
    const key = await this.getKey()
    if (key === undefined) throw new CloudAccountError('还没有百炼的 API key')
    let refused: CloudAccountError | undefined
    for (const endpoint of [this.endpoint, ...this.endpoints.filter(e => e !== this.endpoint)]) {
      try {
        const socket = await this.dial(endpoint, key)
        this.endpoint = endpoint
        return socket
      } catch (error) {
        if (!(error instanceof CloudAccountError)) throw error
        refused = error
      }
    }
    throw refused!
  }

  private dial(endpoint: string, key: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(endpoint, { headers: { Authorization: `bearer ${key}` }, handshakeTimeout: CONNECT_TIMEOUT_MS })
      socket.on('unexpected-response', (_request, response) => {
        const status = response.statusCode ?? 0
        reject(status === 401 || status === 403 ? new CloudAccountError(`百炼拒绝了这个 key（HTTP ${status}）`) : new Error(`连不上百炼（HTTP ${status}）`))
        socket.terminate()
      })
      socket.on('open', () => {
        this.socket = socket
        resolve(socket)
      })
      socket.on('message', (data: Buffer, isBinary: boolean) => this.onMessage(socket, data, isBinary))
      socket.on('error', error => {
        reject(error)
        if (this.socket === socket) this.fail(error)
      })
      socket.on('close', () => {
        if (this.socket === socket) {
          this.socket = undefined
          this.fail(new Error('百炼的连接断了'))
        }
      })
    })
  }

  private onMessage(socket: WebSocket, data: Buffer, isBinary: boolean): void {
    const task = this.task
    if (task === undefined) return
    if (isBinary) {
      task.chunks.push(data)
      return
    }
    let event: { header?: { event?: string; task_id?: string; error_code?: string; error_message?: string } }
    try {
      event = JSON.parse(data.toString('utf8'))
    } catch {
      return
    }
    const header = event.header ?? {}
    if (header.task_id !== undefined && header.task_id !== task.id) return
    switch (header.event) {
      case 'task-started':
        socket.send(JSON.stringify({ header: { action: 'continue-task', task_id: task.id, streaming: 'duplex' }, payload: { input: { text: task.text } } }))
        socket.send(JSON.stringify({ header: { action: 'finish-task', task_id: task.id, streaming: 'duplex' }, payload: { input: {} } }))
        break
      case 'task-finished':
        this.settle()
        task.resolve(Buffer.concat(task.chunks))
        break
      case 'task-failed': {
        const message = `${header.error_code ?? ''} ${header.error_message ?? ''}`.trim()
        this.fail(/InvalidApiKey|Unauthorized|AccessDenied/i.test(message)
          ? new CloudAccountError(`百炼拒绝了这个 key（${message}）`)
          : /AllocationQuota|FreeTierOnly|Arrearage|Throttling\.AllocationQuota/i.test(message)
            ? new CloudAccountError(`百炼的额度用完了（${message}）`, 'quota')
            : new CloudTaskError(`云端语音失败：${message || '未知原因'}`))
        break
      }
    }
  }

  private settle(): void {
    if (this.task !== undefined) clearTimeout(this.task.timer)
    this.task = undefined
  }

  private fail(error: Error): void {
    const task = this.task
    this.settle()
    task?.reject(error)
  }
}
