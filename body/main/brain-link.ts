/**
 * The body's connection to the brain (docs/身体协议.md §2).
 *
 * Where to connect: DSH_HER_URL / DSH_HER_TOKEN when the plugin started this
 * body; otherwise, and whenever those stop working (DSH restarted on another
 * port), the discovery file `<home>/brain.json`, re-read on every attempt.
 * Retries back off from 1 s to 30 s with jitter, but a rewritten brain.json
 * (DSH just started) triggers an attempt at once. A ping every 15 s; no answer
 * for 45 s means the brain is gone.
 *
 * `<home>/body.json` holds this body's pid while it runs, so the plugin does
 * not start a second one while this one is still backing off.
 */

import { mkdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseMessage, PROTOCOL_VERSION, type BodyMessage, type BrainMessage, type Hello } from '../../src/protocol/index.ts'

export type LinkStatus = 'connecting' | 'connected' | 'waiting' | 'rejected'

export interface LinkOptions {
  home: string
  hello: () => Omit<Hello, 't' | 'v' | 'token'>
  onMessage: (message: BrainMessage) => void
  onStatus: (status: LinkStatus, detail?: string) => void
}

interface Endpoint {
  url: string
  token: string
}

const expand = (p: string) => p.replace(/^~(?=$|[\\/])/, homedir())

export class BrainLink {
  private socket: WebSocket | undefined
  private attempt = 0
  private retry: NodeJS.Timeout | undefined
  private heartbeat: NodeJS.Timeout | undefined
  private lastHeard = 0
  private fromEnv: Endpoint | undefined
  private stopped = false
  private watcher: FSWatcher | undefined
  private readonly options: LinkOptions

  constructor(options: LinkOptions) {
    this.options = options
    const url = process.env.DSH_HER_URL
    const token = process.env.DSH_HER_TOKEN
    if (url && token) this.fromEnv = { url, token }
  }

  start(): void {
    this.stopped = false
    const dir = expand(this.options.home)
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'body.json'), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, { mode: 0o600 })
      this.watcher = watch(dir, (_event, name) => {
        if (name === 'brain.json' && this.socket === undefined && !this.stopped) {
          clearTimeout(this.retry)
          this.retry = setTimeout(() => this.connect(), 300)
        }
      })
    } catch (error) {
      console.warn(`cannot watch ${dir}: ${(error as Error).message}`)
    }
    this.connect()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retry)
    clearInterval(this.heartbeat)
    this.watcher?.close()
    this.socket?.close()
    try {
      const file = join(expand(this.options.home), 'body.json')
      if ((JSON.parse(readFileSync(file, 'utf8')) as { pid?: number }).pid === process.pid) rmSync(file, { force: true })
    } catch {
      // already gone
    }
  }

  send(message: BodyMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  private discovery(): Endpoint | undefined {
    try {
      const value = JSON.parse(readFileSync(join(expand(this.options.home), 'brain.json'), 'utf8')) as Partial<Endpoint>
      return typeof value.url === 'string' && typeof value.token === 'string' ? { url: value.url, token: value.token } : undefined
    } catch {
      return undefined
    }
  }

  private connect(): void {
    if (this.stopped) return
    // The env endpoint first; after it fails once, the discovery file (it follows DSH restarts).
    const endpoint = (this.attempt === 0 ? this.fromEnv : undefined) ?? this.discovery() ?? this.fromEnv
    if (endpoint === undefined) {
      this.options.onStatus('waiting', '找不到 dsh（没有 brain.json）')
      this.scheduleRetry()
      return
    }
    this.options.onStatus('connecting')
    let socket: WebSocket
    try {
      socket = new WebSocket(endpoint.url)
    } catch (error) {
      this.options.onStatus('waiting', (error as Error).message)
      this.scheduleRetry()
      return
    }
    this.socket = socket
    let welcomed = false
    socket.addEventListener('open', () => {
      this.lastHeard = Date.now()
      const hello: Hello = { t: 'hello', v: PROTOCOL_VERSION, token: endpoint.token, ...this.options.hello() }
      socket.send(JSON.stringify(hello))
    })
    socket.addEventListener('message', event => {
      this.lastHeard = Date.now()
      if (typeof event.data !== 'string') return
      const message = parseMessage<BrainMessage>(event.data)
      if (message === undefined) return
      if (message.t === 'welcome') {
        welcomed = true
        this.attempt = 0
        this.startHeartbeat(socket)
        this.options.onStatus('connected')
      } else if (message.t === 'reject') {
        this.options.onStatus('rejected', message.message)
      }
      if (message.t !== 'pong') this.options.onMessage(message)
    })
    socket.addEventListener('close', () => {
      clearInterval(this.heartbeat)
      if (this.socket === socket) this.socket = undefined
      if (this.stopped) return
      if (welcomed) this.options.onStatus('waiting', '和 dsh 断开了')
      this.scheduleRetry()
    })
    socket.addEventListener('error', () => {
      // 'close' follows and schedules the retry.
    })
  }

  private startHeartbeat(socket: WebSocket): void {
    clearInterval(this.heartbeat)
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastHeard > 45_000) {
        socket.close()
        return
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'ping', at: Date.now() }))
    }, 15_000)
  }

  private scheduleRetry(): void {
    clearTimeout(this.retry)
    const base = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt, 5))
    this.attempt++
    this.retry = setTimeout(() => this.connect(), base * (0.8 + Math.random() * 0.4))
  }
}
