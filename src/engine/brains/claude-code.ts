/**
 * Claude Code as her front brain (docs/大脑与手设计.md, decision 4;
 * docs/实施计划.md step 10): the `claude` already installed and logged in on
 * this computer, run without a window and kept running for the conversation
 * (`-p` with stream-json in and out). We never see or keep a key.
 *
 * - Who she is goes in as the whole system prompt; Claude Code's own tools
 *   are all switched off (`--tools ""`), and only her tools (her-mcp.ts) are
 *   there, allowed without asking. Nobody's settings, hooks or MCP servers
 *   are loaded into her.
 * - What changes during the day (the date and part of it, what she
 *   remembers about you) goes before your words when it changed, not into the
 *   system prompt: changing that means starting the program again.
 * - Her reply streams back as text deltas (`--include-partial-messages`) and
 *   is cut into sentences (reply-stream.ts). An interruption stops the turn
 *   with Claude Code's own `interrupt` control request.
 * - The conversation id is kept, so the next start goes on with it
 *   (`--resume`); if that fails, a new one starts.
 */

import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { FrontBrain, ReplyEvents } from '../front-brain.ts'
import type { HerTool } from '../her-tools.ts'
import { startHerMcp, type HerMcp } from '../her-mcp.ts'
import { ReplyStream } from '../reply-stream.ts'

/** Where `claude` is: on PATH, else where its installers put it (an app started from the Dock has a bare PATH). */
export function findClaude(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, exists: (path: string) => boolean = existsSync): string | undefined {
  const name = platform === 'win32' ? 'claude.exe' : 'claude'
  const home = env.HOME ?? env.USERPROFILE ?? homedir()
  const onPath = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean).map(dir => join(dir, name))
  const usual = platform === 'win32'
    ? [join(home, '.local', 'bin', name)]
    : [join(home, '.local', 'bin', name), join(home, '.claude', 'local', name), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
  return [...onPath, ...usual].find(path => exists(path))
}

export interface ClaudeCodeOptions {
  /** Her room: where the program runs (nothing of yours is in it). */
  cwd: string
  /** Where the conversation id is kept. */
  sessionFile: string
  /** The `claude` program; found when not given. */
  program?: string
  /** A model alias or name for Claude Code (`sonnet`, `haiku`…); its own default when not given. */
  model?: string
  /** Who she is: the whole system prompt. A change starts the program again (the conversation goes on). */
  prompt: () => string
  /** What changes during the day; told before your words when it changed since it was last told. */
  context: () => string
  tools: () => HerTool[]
  events: ReplyEvents
  log?: (entry: Record<string, unknown>) => void
  /** For tests: what to run instead of spawning `program`. */
  spawn?: (program: string, args: string[], cwd: string) => ChildProcess
}

/** Words for what Claude Code said went wrong. */
export function explainClaudeError(text: string): string {
  if (/authenticat|OAuth|log ?in|401/i.test(text)) return 'Claude Code 的登录过期了：在终端里运行 claude，输入 /login 重新登录'
  if (/rate|limit|usage|quota|429/i.test(text)) return 'Claude Code 的用量到上限了，过一会儿再试'
  if (/overload|529|503/i.test(text)) return 'Claude 现在太忙了，过一会儿再试'
  return `Claude Code 出错了：${text.slice(0, 120)}`
}

export class ClaudeCodeBrain implements FrontBrain {
  private readonly options: ClaudeCodeOptions
  private readonly stream: ReplyStream
  private child: ChildProcess | undefined
  private runningPrompt: string | undefined
  private mcp: HerMcp | undefined
  private pending: string[] = []
  private toldContext: string | undefined
  private buffer = ''
  /** Turns and steps of this run, for reply ids. */
  private turn = 0
  private step = 0
  private run = randomUUID().slice(0, 8)
  private wordsThisTurn = false
  /** This turn was stopped by us: its end is an interruption, not an error. */
  private cutting = false
  private requests = 0
  lastError: string | undefined

  constructor(options: ClaudeCodeOptions) {
    this.options = options
    this.stream = new ReplyStream(options.events)
  }

  get sessionId(): string | undefined {
    try {
      const id = (JSON.parse(readFileSync(this.options.sessionFile, 'utf8')) as { sessionId?: unknown }).sessionId
      return typeof id === 'string' ? id : undefined
    } catch {
      return undefined
    }
  }

  private saveSession(id: string): void {
    mkdirSync(dirname(this.options.sessionFile), { recursive: true })
    writeFileSync(this.options.sessionFile, `${JSON.stringify({ sessionId: id, brain: 'claude-code' }, null, 2)}\n`)
  }

  private log(entry: Record<string, unknown>): void {
    this.options.log?.({ brain: 'claude-code', ...entry })
  }

  /** The program for this prompt: the running one, or a new start that goes on with the conversation. */
  private async ensure(): Promise<ChildProcess> {
    const prompt = this.options.prompt()
    if (this.child !== undefined && this.child.exitCode === null && this.runningPrompt === prompt) return this.child
    this.stop()
    this.mcp ??= await startHerMcp(this.options.tools, entry => this.log(entry))
    const program = this.options.program ?? findClaude()
    if (program === undefined) throw new Error('这台电脑上没有 Claude Code（claude）')
    const resume = this.sessionId
    const id = resume ?? randomUUID()
    if (resume === undefined) this.saveSession(id)
    const args = [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--system-prompt', prompt, '--system-prompt-snapshot', 'off',
      '--tools', '', '--strict-mcp-config', '--mcp-config', JSON.stringify(this.mcp.config()),
      '--allowedTools', 'mcp__her', '--permission-mode', 'dontAsk', '--setting-sources', '',
      ...(this.options.model === undefined ? [] : ['--model', this.options.model]),
      ...(resume === undefined ? ['--session-id', id] : ['--resume', resume]),
    ]
    mkdirSync(this.options.cwd, { recursive: true })
    const child = this.options.spawn?.(program, args, this.options.cwd)
      ?? spawn(program, args, { cwd: this.options.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    this.runningPrompt = prompt
    this.buffer = ''
    // A new start tells what changes during the day again.
    this.toldContext = undefined
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.read(chunk))
    child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk}`.slice(-2000) })
    child.on('error', error => this.gone(child, error.message))
    child.on('exit', code => this.gone(child, code === 0 ? undefined : stderr.trim() || `退出码 ${code}`))
    this.log({ event: 'start', resume: resume ?? null })
    return child
  }

  /** The program ended: a reply in progress ends with it; a conversation it could not go on with is not tried again. */
  private gone(child: ChildProcess, why: string | undefined): void {
    if (this.child !== child) return
    this.child = undefined
    this.runningPrompt = undefined
    if (why !== undefined) {
      this.log({ event: 'exit', why: why.slice(0, 300) })
      if (/No conversation found|session.*not found/i.test(why)) writeFileSync(this.options.sessionFile, '{}\n')
      this.lastError = explainClaudeError(why)
    }
    if (this.stream.active) this.stream.end('error')
  }

  private read(chunk: string): void {
    this.buffer += chunk
    let at: number
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, at).trim()
      this.buffer = this.buffer.slice(at + 1)
      if (line === '') continue
      let message: Record<string, unknown>
      try {
        message = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      this.handle(message)
    }
  }

  private handle(message: Record<string, unknown>): void {
    if (message.type === 'system' && message.subtype === 'init' && typeof message.session_id === 'string') {
      if (message.session_id !== this.sessionId) this.saveSession(message.session_id)
      return
    }
    if (message.type === 'stream_event') {
      const event = message.event as { type?: string; delta?: { type?: string; text?: string } } | undefined
      // Only her own words; a subagent's would not be hers (there are none: no tools for it).
      if (message.parent_tool_use_id !== null && message.parent_tool_use_id !== undefined) return
      if (event?.type === 'message_start') this.stream.start(`${this.run}@${this.turn}.${this.step++}`)
      else if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
        if (event.delta.text !== '') this.wordsThisTurn = true
        this.stream.delta(event.delta.text)
      } else if (event?.type === 'message_stop') this.stream.end('committed')
      return
    }
    if (message.type === 'result') {
      if (this.cutting) {
        this.cutting = false
        if (this.stream.active) this.stream.end('interrupted')
        return
      }
      const failed = message.is_error === true || (typeof message.subtype === 'string' && message.subtype !== 'success')
      if (failed) {
        const text = typeof message.result === 'string' ? message.result : String(message.subtype)
        this.lastError = explainClaudeError(text)
        this.log({ event: 'error', text: text.slice(0, 300) })
      }
      // A turn that ended (an error, an interruption) with a reply still open, or with no reply at all: closed, so she is not left thinking.
      if (this.stream.active) this.stream.end(failed ? 'error' : 'interrupted')
      else if (failed && !this.wordsThisTurn) {
        this.stream.start(`${this.run}@${this.turn}.${this.step++}`)
        this.stream.end('error')
      }
    }
  }

  private write(child: ChildProcess, message: unknown): void {
    child.stdin?.write(`${JSON.stringify(message)}\n`)
  }

  async say(text: string, via: 'voice' | 'text' | 'command'): Promise<void> {
    const child = await this.ensure()
    const context = this.options.context()
    const before = [...(context !== '' && context !== this.toldContext ? [`（现场：${context}）`] : []), ...this.pending]
    this.toldContext = context
    this.pending = []
    this.turn++
    this.step = 0
    this.wordsThisTurn = false
    this.cutting = false
    this.lastError = undefined
    this.log({ event: 'say', via, notes: before.length })
    this.write(child, { type: 'user', message: { role: 'user', content: [{ type: 'text', text: [...before, text].join('\n') }] } })
  }

  /** Kept for the next turn: Claude Code has no way to add context without a turn. */
  async note(text: string): Promise<void> {
    this.pending = [...this.pending, text].slice(-8)
  }

  interrupt(): void {
    this.stream.interrupt()
    if (this.child === undefined || !this.stream.active) return
    this.cutting = true
    this.write(this.child, { type: 'control_request', request_id: `interrupt-${++this.requests}`, request: { subtype: 'interrupt' } })
  }

  private stop(): void {
    const child = this.child
    this.child = undefined
    this.runningPrompt = undefined
    if (child === undefined) return
    child.stdin?.end()
    setTimeout(() => { if (child.exitCode === null) child.kill() }, 3000).unref()
  }

  async dispose(): Promise<void> {
    this.stop()
    await this.mcp?.close()
    this.mcp = undefined
  }
}
