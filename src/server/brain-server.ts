/**
 * The brain's side of the body protocol: a WebSocket server on loopback.
 * Design: docs/身体协议.md §2–3.
 *
 * - Port: the preferred one, else the next free ones, else any free port.
 * - Token: created once and kept in `<home>/token` (mode 600); a body proves
 *   itself with it in `hello`, never in the URL.
 * - Discovery: `<home>/brain.json` (mode 600) says where the brain listens and
 *   carries the token, so a body started by hand can find it; it is rewritten
 *   on every start because the port may change, and removed on stop.
 * - Heartbeat: a body pings every 15 s; one silent for 45 s is dropped.
 *
 * The server knows nothing about DSH or sessions; the plugin wires it.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { parseMessage, PROTOCOL_VERSION, type BodyMessage, type BrainMessage, type Hello } from '../protocol/index.ts'

export const DEFAULT_PORT = 38100
const PORT_TRIES = 20
const DEAD_AFTER_MS = 45_000

export interface BodyClient {
  readonly id: number
  readonly hello: Hello
  send(message: BrainMessage): void
}

export interface BrainServerOptions {
  /** `<home>/token` and `<home>/brain.json`. */
  tokenFile: string
  discoveryFile: string
  preferredPort?: number
  /** Called once a body has said a valid hello; return its welcome. */
  welcome(client: BodyClient): BrainMessage
  /** Every later message from an admitted body. */
  message(client: BodyClient, message: BodyMessage): void
  /** An admitted body went away. */
  closed?(client: BodyClient): void
  logger?: { info(message: string): void; warn(message: string): void }
}

export interface Discovery {
  url: string
  token: string
  pid: number
  protocol: number
  startedAt: string
}

function writePrivate(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text, { mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {
    // Windows: the user's profile directory is already private.
  }
}

/** The brain's token: read, or created on first start. */
export function loadToken(file: string): string {
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim()
    if (token.length >= 32) return token
  }
  const token = randomBytes(32).toString('base64url')
  writePrivate(file, `${token}\n`)
  return token
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.byteLength === y.byteLength && timingSafeEqual(x, y)
}

async function listen(port: number): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: 32 * 1024 * 1024 })
    server.once('listening', () => resolve(server))
    server.once('error', reject)
  })
}

export class BrainServer {
  private server: WebSocketServer | undefined
  private token = ''
  private nextId = 1
  private readonly clients = new Map<WebSocket, BodyClient>()
  private reaper: NodeJS.Timeout | undefined
  private readonly lastSeen = new Map<WebSocket, number>()
  private readonly options: BrainServerOptions

  constructor(options: BrainServerOptions) {
    this.options = options
  }

  get port(): number | undefined {
    const address = this.server?.address()
    return typeof address === 'object' && address !== null ? address.port : undefined
  }

  get url(): string | undefined {
    return this.port === undefined ? undefined : `ws://127.0.0.1:${this.port}`
  }

  get bodies(): BodyClient[] {
    return [...this.clients.values()]
  }

  async start(): Promise<Discovery> {
    this.token = loadToken(this.options.tokenFile)
    const first = this.options.preferredPort ?? DEFAULT_PORT
    let lastError: unknown
    for (let i = 0; i <= PORT_TRIES && this.server === undefined; i++) {
      try {
        this.server = await listen(i === PORT_TRIES ? 0 : first + i)
      } catch (error) {
        lastError = error
      }
    }
    if (this.server === undefined) throw lastError
    this.server.on('connection', socket => this.accept(socket))
    this.reaper = setInterval(() => this.reap(), 15_000)
    this.reaper.unref()
    const discovery: Discovery = { url: this.url!, token: this.token, pid: process.pid, protocol: PROTOCOL_VERSION, startedAt: new Date().toISOString() }
    writePrivate(this.options.discoveryFile, `${JSON.stringify(discovery, null, 2)}\n`)
    this.options.logger?.info(`dsh-her: brain listening on ${this.url}`)
    return discovery
  }

  broadcast(message: BrainMessage): void {
    for (const client of this.clients.values()) client.send(message)
  }

  async stop(): Promise<void> {
    clearInterval(this.reaper)
    const server = this.server
    this.server = undefined
    for (const socket of this.clients.keys()) socket.close(1001, 'brain stopping')
    this.clients.clear()
    try {
      const current = JSON.parse(readFileSync(this.options.discoveryFile, 'utf8')) as Partial<Discovery>
      if (current.pid === process.pid) rmSync(this.options.discoveryFile, { force: true })
    } catch {
      // already gone
    }
    await new Promise<void>(resolve => server === undefined ? resolve() : server.close(() => resolve()))
  }

  private accept(socket: WebSocket): void {
    this.lastSeen.set(socket, Date.now())
    const send = (message: BrainMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
    }
    // The first message must be a valid hello within 10 s.
    const helloTimer = setTimeout(() => socket.close(4000, 'no hello'), 10_000)
    socket.on('message', (data, isBinary) => {
      this.lastSeen.set(socket, Date.now())
      if (isBinary) return // audio arrives from M2 on
      const message = parseMessage<BodyMessage>(data.toString())
      if (message === undefined) return
      const client = this.clients.get(socket)
      if (client === undefined) {
        clearTimeout(helloTimer)
        this.admit(socket, message, send)
        return
      }
      if (message.t === 'ping') {
        client.send({ t: 'pong', at: message.at })
        return
      }
      try {
        this.options.message(client, message)
      } catch (error) {
        this.options.logger?.warn(`dsh-her: body message ${message.t} failed (${(error as Error).message})`)
      }
    })
    socket.on('close', () => {
      clearTimeout(helloTimer)
      this.lastSeen.delete(socket)
      const client = this.clients.get(socket)
      this.clients.delete(socket)
      if (client !== undefined) this.options.closed?.(client)
    })
    socket.on('error', () => socket.close())
  }

  private admit(socket: WebSocket, message: BodyMessage, send: (message: BrainMessage) => void): void {
    if (message.t !== 'hello') {
      socket.close(4001, 'hello first')
      return
    }
    if (typeof message.token !== 'string' || !sameToken(message.token, this.token)) {
      send({ t: 'reject', reason: 'token', message: '令牌不对：请重新配对，或让 dsh 重新拉起身体' })
      socket.close(4003, 'token')
      return
    }
    if (message.v !== PROTOCOL_VERSION) {
      send({ t: 'reject', reason: 'version', message: `协议版本不一致（身体 ${message.v}，大脑 ${PROTOCOL_VERSION}），请更新` })
      socket.close(4004, 'version')
      return
    }
    const client: BodyClient = { id: this.nextId++, hello: message, send }
    this.clients.set(socket, client)
    send(this.options.welcome(client))
    this.options.logger?.info(`dsh-her: body #${client.id} connected (${message.body.kind} ${message.body.version}, ${message.body.os})`)
  }

  private reap(): void {
    const now = Date.now()
    for (const [socket, seen] of this.lastSeen) {
      if (now - seen > DEAD_AFTER_MS) socket.terminate()
    }
  }
}
