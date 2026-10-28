/**
 * Her own session in DSH ("她 · <name>"): one ordinary persisted session per
 * character. Created once, resumed after every restart; its id is kept under
 * the dsh-her home, not in DSH. The creation follows dsh-vael's SelfSession.
 *
 * Inside her agent's scoped context she gets her own system prompt (DSH's
 * coding-agent prompt and runtime chatter are replaced) and a listener on her
 * live assistant stream, which turns text deltas into speakable sentences.
 * Reasoning and tool-call deltas are never spoken.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSystemPrompt, SentenceSplitter } from '../core/index.ts'

export interface ModelRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

interface UserMessageLike {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: string; [key: string]: unknown }
}

interface AgentLike {
  readonly session: { readonly id: string }
  followup(message: UserMessageLike): void
  /** Context for the next model request, without starting a turn. */
  inject(message: UserMessageLike): void
  cancel(cause?: unknown): void
  whenIdle(): Promise<void>
}

interface AgentHandleLike {
  readonly agent: AgentLike
  dispose(): Promise<void>
}

/** One live publication of her assistant stream (`agent/assistant-stream`). */
export type StreamFrame =
  | { type: 'start'; attemptId: string; turn: number; step: number }
  | { type: 'chunk'; attemptId: string; index: number; time: number; chunk: { type: string; text?: string } }
  | { type: 'end'; attemptId: string; index: number; outcome: { kind: string } }

export interface ScopedContext {
  tools: {
    register(definition: unknown): () => void
    /** Tool schemas as a scope sees them; no scope = the global surface. */
    schemas(scope?: unknown): Array<{ name: string }>
    /** Hide global tools from the calling agent scope (scoped registrations stay visible). */
    restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void
  }
  systemPrompt?: {
    section(definition: { name: string; order: number; text: string; complete?: boolean; interpolate?: boolean }): unknown
    suppressRuntimeContext?(): unknown
  }
  on(event: 'agent/assistant-stream', listener: (payload: { frame: StreamFrame }) => void): () => void
}

export interface DshServices {
  agents: {
    create(options: {
      sessionId: string
      meta?: { cwd?: string }
      agentOptions?: ModelRoute
      setup?: (agentCtx: ScopedContext) => void | Promise<void>
    }): Promise<AgentHandleLike>
    resume(options: {
      resumeSessionId: string
      agentOptions?: ModelRoute
      setup?: (agentCtx: ScopedContext) => void | Promise<void>
    }): Promise<AgentHandleLike>
  }
  agentDefaultModel?: { currentSelection(): { provider: string; model: string } | undefined }
  workspaceRegistry?: { create(path: string, title?: string): Promise<{ attachSession(id: string): Promise<void> }> }
  sessionTitle?: { rename(session: unknown, title: string): void }
  sessionQuery?: { readSession(id: string): Promise<{ events: Array<{ seq: number; type: string; data: unknown }> }> }
}

/**
 * What her stream produces, per reply: one `start`, any number of `sentence`s,
 * one `end`. `replyId` is unique across turns.
 */
export interface ReplyEvents {
  start(replyId: string): void
  sentence(replyId: string, text: string): void
  end(replyId: string, outcome: string): void
}

export interface HerSessionDeps {
  cid: string
  name: string
  persona: string
  /** dsh-her home for this character: session.json and her room live here. */
  dir: string
  route: ModelRoute | undefined
  services: () => DshServices | undefined
  logger: { info(message: string): void; warn(message: string): void }
  events: ReplyEvents
}

export class HerSession {
  private handle: AgentHandleLike | undefined
  private opening: Promise<AgentHandleLike> | undefined
  private readonly splitter = new SentenceSplitter()
  /** Set by interrupt(): the rest of the current reply is not spoken. */
  private dropping = false
  /** The reply being streamed, unique across turns. */
  private replyId: string | undefined
  private readonly deps: HerSessionDeps

  constructor(deps: HerSessionDeps) {
    this.deps = deps
  }

  get title(): string {
    return `她 · ${this.deps.name}`
  }

  get sessionId(): string | undefined {
    return this.handle?.agent.session.id ?? this.recorded()
  }

  /** Her live agent: reuse, resume the recorded session, or create it the first time. */
  ensure(): Promise<AgentHandleLike> {
    if (this.handle !== undefined) return Promise.resolve(this.handle)
    this.opening ??= this.open().finally(() => { this.opening = undefined })
    return this.opening
  }

  /** Send what you said (typed or recognized) as a new turn. */
  async say(text: string, via: 'voice' | 'text' | 'command'): Promise<AgentLike> {
    const { agent } = await this.ensure()
    agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'dsh-her', via } })
    return agent
  }

  /** Tell her something for her next turn without making her answer (what was heard of a cut-off reply, …). */
  async note(text: string): Promise<void> {
    const { agent } = await this.ensure()
    agent.inject({ id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'dsh-her-context' } })
  }

  /** Stop the reply in progress (barge-in). DSH keeps the delivered prefix marked `interrupted`. */
  interrupt(): void {
    this.splitter.reset()
    this.dropping = true
    try {
      this.handle?.agent.cancel(new Error('dsh-her: interrupted'))
    } catch {
      // nothing in progress
    }
  }

  async dispose(): Promise<void> {
    const handle = this.handle
    this.handle = undefined
    try {
      await handle?.dispose()
    } catch {
      // the owning scope may already have torn it down
    }
  }

  private recordFile(): string {
    return join(this.deps.dir, 'session.json')
  }

  private recorded(): string | undefined {
    try {
      const value = JSON.parse(readFileSync(this.recordFile(), 'utf8')) as { sessionId?: unknown }
      return typeof value.sessionId === 'string' ? value.sessionId : undefined
    } catch {
      return undefined
    }
  }

  private async open(): Promise<AgentHandleLike> {
    const services = this.deps.services()
    if (services === undefined) throw new Error('DSH 的 agents 服务还不可用')
    const { logger, route } = this.deps
    const setup = (agentCtx: ScopedContext) => this.composeScope(agentCtx)
    const recorded = this.recorded()
    if (recorded !== undefined) {
      try {
        this.handle = await services.agents.resume({ resumeSessionId: recorded, agentOptions: route, setup })
        logger.info(`dsh-her: resumed ${this.title} (${recorded})`)
        return this.handle
      } catch (error) {
        logger.warn(`dsh-her: could not resume ${recorded} (${(error as Error).message}); creating a new session`)
      }
    }
    const sessionId = `dsh-her-${this.deps.cid}-${randomUUID()}`
    const room = join(this.deps.dir, 'room')
    mkdirSync(room, { recursive: true })
    const workspace = await services.workspaceRegistry?.create(room, this.title)
    const handle = await services.agents.create({ sessionId, meta: { cwd: room }, agentOptions: route, setup })
    try {
      await workspace?.attachSession(sessionId)
      services.sessionTitle?.rename(handle.agent.session, this.title)
    } catch (error) {
      logger.warn(`dsh-her: session created but not attached/titled (${(error as Error).message})`)
    }
    writeFileSync(this.recordFile(), JSON.stringify({ sessionId, previous: recorded ?? null, createdAt: new Date().toISOString() }, null, 2))
    logger.info(`dsh-her: created ${this.title} (${sessionId})`)
    this.handle = handle
    return handle
  }

  private composeScope(agentCtx: ScopedContext): void {
    const text = buildSystemPrompt({ name: this.deps.name, persona: this.deps.persona })
    agentCtx.systemPrompt?.section({ name: 'dsh-her:system', order: 0, text, complete: true, interpolate: false })
    agentCtx.systemPrompt?.suppressRuntimeContext?.()
    this.hideGlobalTools(agentCtx)
    agentCtx.on('agent/assistant-stream', ({ frame }) => this.onFrame(frame))
  }

  /**
   * P1: she only keeps you company, so DSH's work tools (shell, files, web…)
   * are hidden from her session. Their schemas would also cost thousands of
   * tokens on every turn. Tools she gets later are registered in her own scope,
   * which a restriction never hides.
   */
  private hideGlobalTools(agentCtx: ScopedContext): void {
    try {
      const names = agentCtx.tools.schemas().map(schema => schema.name).filter(name => name !== 'run_code')
      if (names.length > 0) agentCtx.tools.restrict({ deny: names })
    } catch (error) {
      this.deps.logger.warn(`dsh-her: could not hide DSH tools from her session (${(error as Error).message})`)
    }
  }

  private onFrame(frame: StreamFrame): void {
    const { events } = this.deps
    if (frame.type === 'start') {
      this.splitter.reset()
      this.dropping = false
      // DSH's attempt id repeats across turns (it ends in the agent's revision), so the turn and step make it unique.
      this.replyId = `${frame.attemptId}@${frame.turn}.${frame.step}`
      events.start(this.replyId)
      return
    }
    const id = this.replyId
    if (id === undefined) return
    if (frame.type === 'chunk') {
      if (this.dropping || frame.chunk.type !== 'text-delta' || typeof frame.chunk.text !== 'string') return
      for (const sentence of this.splitter.push(frame.chunk.text)) events.sentence(id, sentence)
    } else {
      if (!this.dropping && frame.outcome.kind !== 'abandoned') {
        for (const sentence of this.splitter.flush()) events.sentence(id, sentence)
      }
      this.splitter.reset()
      this.replyId = undefined
      events.end(id, frame.outcome.kind)
    }
  }
}
