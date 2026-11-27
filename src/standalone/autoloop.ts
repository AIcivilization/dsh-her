/**
 * The loop she lives by (docs/大脑与手设计.md, decision 5; docs/实施计划.md
 * step 12): agent-autoloop, the user's own when they have one running, else
 * the copy that comes with 真人桌宠.
 *
 * - The user's own: `~/.agent-autoloop/config.json` and its hub answering
 *   `/healthz`. She connects to it; nothing of theirs is started, stopped or
 *   rewritten.
 * - Ours: its code is in the app (fetched and checked at build time,
 *   scripts/fetch-autoloop.mjs), its data in `<home>/autoloop` (never
 *   `~/.agent-autoloop`, so nothing of theirs is touched and it adds nothing to
 *   their Claude Code or Codex). Set up once with its own `init` on a free
 *   port of this computer only, then run with `up` as a child process, started
 *   again if it stops.
 * - One loop per computer: when the user installs their own after ours was
 *   in use, she does not switch by herself; she asks once (`ownAppeared`).
 */

import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export interface AutoloopOptions {
  /** 真人桌宠's home: ours lives in `<home>/autoloop`. */
  home: string
  /** Where agent-autoloop's code is. */
  root: string
  /** The program that runs it (Electron as Node, or Node), and what it needs in its environment. */
  node: string
  nodeEnv?: Record<string, string>
  /** Where to look for the user's own (their home). */
  userHome?: string
  log?: (entry: Record<string, unknown>) => void
  fetch?: typeof fetch
}

export type AutoloopState =
  | { kind: 'off' }
  | { kind: 'own'; url: string }
  | { kind: 'bundled'; url: string; running: boolean; version: string; ownAppeared: boolean }
  | { kind: 'none'; why: string }

/** Which one to use, once the user has said. */
type Preference = 'auto' | 'own' | 'bundled'

const RESTARTS = 5
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** A free port on this computer only. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

export class Autoloop {
  private readonly options: AutoloopOptions
  private child: ChildProcess | undefined
  private stopping = false
  private restarts = 0
  private current: AutoloopState = { kind: 'off' }

  constructor(options: AutoloopOptions) {
    this.options = options
  }

  /** Ours: its data folder. */
  get dataDir(): string {
    return join(this.options.home, 'autoloop')
  }

  private get prefFile(): string {
    return join(this.options.home, 'autoloop-choice.json')
  }

  private preference(): Preference {
    try {
      const use = (JSON.parse(readFileSync(this.prefFile, 'utf8')) as { use?: unknown }).use
      return use === 'own' || use === 'bundled' ? use : 'auto'
    } catch {
      return 'auto'
    }
  }

  private log(entry: Record<string, unknown>): void {
    this.options.log?.({ loop: 'agent-autoloop', ...entry })
  }

  /** What version ours is (written by the fetch script). */
  private pinned(): { tag: string; commit: string } | undefined {
    try {
      return JSON.parse(readFileSync(join(this.options.root, '.pinned.json'), 'utf8')) as { tag: string; commit: string }
    } catch {
      return undefined
    }
  }

  private async healthy(url: string): Promise<boolean> {
    try {
      const res = await (this.options.fetch ?? fetch)(`${url.replace(/\/+$/, '')}/healthz`, { signal: AbortSignal.timeout(3000) })
      return res.ok && (await res.json() as { ok?: unknown }).ok === true
    } catch {
      return false
    }
  }

  /** The user's own, when it is set up and its hub answers. */
  async findOwn(): Promise<{ url: string; owner?: string } | undefined> {
    const file = join(this.options.userHome ?? homedir(), '.agent-autoloop', 'config.json')
    if (!existsSync(file)) return undefined
    try {
      const config = JSON.parse(readFileSync(file, 'utf8')) as { url?: unknown; owner?: unknown }
      if (typeof config.url !== 'string') return undefined
      return (await this.healthy(config.url)) ? { url: config.url, ...(typeof config.owner === 'string' ? { owner: config.owner } : {}) } : undefined
    } catch {
      return undefined
    }
  }

  /** Where the owner's requests go, and their key: of whichever one is in use. */
  async ownerAccess(): Promise<{ url: string; key: string } | undefined> {
    const state = this.current
    if (state.kind === 'own') {
      const own = await this.findOwn()
      return own?.owner === undefined ? undefined : { url: own.url, key: own.owner }
    }
    if (state.kind === 'bundled') {
      const config = this.config()
      return config?.owner === undefined ? undefined : { url: config.url, key: config.owner }
    }
    return undefined
  }

  private config(): { url: string; owner?: string } | undefined {
    try {
      return JSON.parse(readFileSync(join(this.dataDir, 'config.json'), 'utf8')) as { url: string; owner?: string }
    } catch {
      return undefined
    }
  }

  private env(): NodeJS.ProcessEnv {
    const pinned = this.pinned()
    // An app started from the Dock has a bare PATH: where Claude Code and Codex usually are, after what there is.
    const extra = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
    const path = [process.env.PATH ?? '', ...(process.platform === 'win32' ? [] : extra)].filter(Boolean).join(delimiter)
    return {
      ...process.env,
      ...this.options.nodeEnv,
      PATH: path,
      AGENT_AUTOLOOP_HOME: this.dataDir,
      ...(pinned === undefined ? {} : { AGENT_AUTOLOOP_RELEASE: pinned.tag, AGENT_AUTOLOOP_COMMIT: pinned.commit }),
    }
  }

  private program(): string {
    return join(this.options.root, 'bin', 'agent-autoloop.ts')
  }

  /** Ours, set up the first time: its own init, on a free port of this computer only. */
  private async init(): Promise<void> {
    if (existsSync(join(this.dataDir, 'config.json'))) return
    mkdirSync(this.dataDir, { recursive: true })
    const port = await freePort()
    await new Promise<void>((resolve, reject) => {
      execFile(this.options.node, ['--disable-warning=ExperimentalWarning', this.program(), 'init', '--no-service', '--port', String(port)], { env: this.env(), timeout: 60_000 }, (error, stdout, stderr) => {
        this.log({ event: 'init', ok: error === null, port })
        if (error === null) resolve()
        else reject(new Error(`${String(stderr || stdout).trim().split('\n').at(-1) ?? error.message}`))
      })
    })
  }

  private run(): void {
    const child = spawn(this.options.node, ['--disable-warning=ExperimentalWarning', this.program(), 'up'], { env: this.env(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    const log = join(this.dataDir, 'up.log')
    const keep = (chunk: Buffer) => {
      try {
        appendFileSync(log, chunk)
      } catch {
        // a log that cannot be written is no reason to stop
      }
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.on('exit', code => {
      if (this.child !== child) return
      this.child = undefined
      if (this.current.kind === 'bundled') this.current = { ...this.current, running: false }
      if (this.stopping) return
      this.log({ event: 'exit', code })
      // Started again a few times, then left stopped (the settings window says so).
      if (this.restarts++ < RESTARTS) setTimeout(() => { if (!this.stopping && this.child === undefined) this.run() }, 2000 * this.restarts).unref()
    })
  }

  /** Connect to theirs, or set ours up and start it. */
  async start(): Promise<AutoloopState> {
    this.stopping = false
    const use = this.preference()
    const own = use === 'bundled' ? undefined : await this.findOwn()
    const oursInUse = existsSync(join(this.dataDir, 'config.json'))
    // Theirs, when they chose it, or when ours was never set up: nothing of ours runs.
    if (own !== undefined && (use === 'own' || !oursInUse)) {
      this.current = { kind: 'own', url: own.url }
      this.log({ event: 'use', which: 'own', url: own.url })
      return this.current
    }
    if (!existsSync(this.program())) {
      this.current = { kind: 'none', why: '这一版没有带上 agent-autoloop' }
      return this.current
    }
    try {
      await this.init()
    } catch (error) {
      this.current = { kind: 'none', why: `没能准备好：${(error as Error).message}` }
      return this.current
    }
    const config = this.config()!
    this.restarts = 0
    if (this.child === undefined && !(await this.healthy(config.url))) this.run()
    let running = false
    for (let i = 0; i < 40 && !running; i++) {
      running = await this.healthy(config.url)
      if (!running) await sleep(250)
    }
    // Theirs is running beside ours, and nobody chose yet: asked once.
    const ownAppeared = use === 'auto' && (await this.findOwn()) !== undefined
    this.current = { kind: 'bundled', url: config.url, running, version: this.pinned()?.tag ?? '?', ownAppeared }
    this.log({ event: 'use', which: 'bundled', url: config.url, running })
    return this.current
  }

  state(): AutoloopState {
    return this.current
  }

  /** The user chose: theirs from now on (ours stops), or ours (not asked again). */
  async choose(use: 'own' | 'bundled'): Promise<AutoloopState> {
    mkdirSync(this.options.home, { recursive: true })
    writeFileSync(this.prefFile, `${JSON.stringify({ use })}\n`)
    if (use === 'own') await this.stop()
    return this.start()
  }

  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    this.child = undefined
    if (child !== undefined && child.exitCode === null) {
      child.kill()
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5000)])
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    if (this.current.kind === 'bundled') this.current = { ...this.current, running: false }
  }

  /** The program is quitting: ours goes with it now (an async stop would not finish before the exit). */
  killNow(): void {
    this.stopping = true
    if (this.child !== undefined && this.child.exitCode === null) this.child.kill()
    this.child = undefined
  }

  /** Off: nothing of ours runs, theirs is not used. */
  async off(): Promise<void> {
    await this.stop()
    this.current = { kind: 'off' }
  }
}
