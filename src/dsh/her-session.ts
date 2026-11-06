/**
 * Her own session in DSH ("她 · <name>"): one ordinary persisted session per
 * character. Created once, resumed after every restart; its id is kept under
 * the dsh-her home, not in DSH. The creation follows dsh-vael's SelfSession.
 *
 * Inside her agent's scoped context she gets her own system prompt (DSH's
 * coding-agent prompt and runtime chatter are replaced) and a listener on her
 * live assistant stream, which turns text deltas into speakable sentences.
 * Reasoning and tool-call deltas are never spoken.
 *
 * Her prompt is rebuilt at every model request, so its performance section
 * always matches the body that is connected and what she remembers is current.
 * Her tools: `play_action` (a longer performance by the body) and `remember`,
 * `recall`, `forget` (her memory).
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSystemPrompt, SentenceSplitter, type Character } from '../core/index.ts'
import type { MemoryProvider } from '../memory/store.ts'

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
    section(definition: { name: string; order: number; text: string | (() => string); complete?: boolean; interpolate?: boolean }): unknown
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
  workspaceRegistry?: {
    create(path: string, title?: string): Promise<{ id?: string; attachSession(id: string): Promise<void> }>
    list?(): Array<{ id: string }>
    /** Move a workspace in the sidebar's order, before another. */
    insertBefore?(id: string, beforeId: string): Promise<unknown>
  }
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
  /** Who she is right now (the "她" page can change it at any time). */
  character: () => Pick<Character, 'name' | 'persona' | 'callYou' | 'pronoun'>
  /** The performance section for the connected body (empty without one). */
  performance: () => string
  /** Have the body perform an action; resolves when it is done. */
  playAction: (action: string) => Promise<{ ok: boolean; reason?: string; transcript?: string }>
  /** "关于对方" for her prompt, from memory. */
  aboutYou: () => string
  memory: MemoryProvider
  /** dsh-her home for this character: session.json and her room live here. */
  dir: string
  route: ModelRoute | undefined
  services: () => DshServices | undefined
  logger: { info(message: string): void; warn(message: string): void }
  events: ReplyEvents
}

/** One conversation of hers: a session in her workspace. */
export interface Segment {
  id: string
  title: string
  createdAt: string
}

interface SessionRecord {
  sessionId?: string
  previous?: string | null
  createdAt?: string
  segments?: Segment[]
  /** Her workspace was put first in the sidebar once; after that the user's order stands. */
  movedToTop?: boolean
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
    return `她 · ${this.deps.character().name}`
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

  private record(): SessionRecord {
    try {
      return JSON.parse(readFileSync(this.recordFile(), 'utf8')) as SessionRecord
    } catch {
      return {}
    }
  }

  private saveRecord(change: SessionRecord): void {
    writeFileSync(this.recordFile(), JSON.stringify({ ...this.record(), ...change }, null, 2))
  }

  private recorded(): string | undefined {
    const { sessionId } = this.record()
    return typeof sessionId === 'string' ? sessionId : undefined
  }

  /** Her conversations, newest last; the first one (from before there were several) included. */
  segments(): Segment[] {
    const record = this.record()
    const list = Array.isArray(record.segments) ? record.segments.filter(s => typeof s?.id === 'string') : []
    const current = record.sessionId
    if (current !== undefined && !list.some(s => s.id === current)) list.unshift({ id: current, title: this.title, createdAt: record.createdAt ?? new Date(0).toISOString() })
    return list
  }

  /** Start a new conversation in her workspace; the old one stays there. Her memory is shared. */
  async startNew(): Promise<Segment> {
    await this.dispose()
    this.opening = undefined
    const handle = await this.create(this.titleFor(new Date()))
    this.handle = handle
    return this.segments().at(-1)!
  }

  /** Go on with an earlier conversation: what you say from now on goes there. */
  async resume(id: string): Promise<void> {
    if (!this.segments().some(s => s.id === id)) throw new Error('没有这段对话')
    if (this.sessionId === id && this.handle !== undefined) return
    await this.dispose()
    this.opening = undefined
    this.saveRecord({ sessionId: id })
    await this.ensure()
  }

  /** "她 · 小禾 · 11月6日", numbered when there is already one that day. */
  private titleFor(now: Date): string {
    const day = `${now.getMonth() + 1}月${now.getDate()}日`
    const base = `${this.title} · ${day}`
    const taken = this.segments().filter(s => s.title === base || s.title.startsWith(`${base} `)).length
    return taken === 0 ? base : `${base} ${taken + 1}`
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
    this.handle = await this.create(this.title)
    return this.handle
  }

  /** A new session in her workspace, recorded as her current conversation. */
  private async create(title: string): Promise<AgentHandleLike> {
    const services = this.deps.services()
    if (services === undefined) throw new Error('DSH 的 agents 服务还不可用')
    const { logger, route } = this.deps
    const setup = (agentCtx: ScopedContext) => this.composeScope(agentCtx)
    const recorded = this.recorded()
    const before = this.segments()
    const sessionId = `dsh-her-${this.deps.cid}-${randomUUID()}`
    const room = join(this.deps.dir, 'room')
    mkdirSync(room, { recursive: true })
    const workspace = await services.workspaceRegistry?.create(room, this.title)
    const handle = await services.agents.create({ sessionId, meta: { cwd: room }, agentOptions: route, setup })
    try {
      await workspace?.attachSession(sessionId)
      services.sessionTitle?.rename(handle.agent.session, title)
    } catch (error) {
      logger.warn(`dsh-her: session created but not attached/titled (${(error as Error).message})`)
    }
    const createdAt = new Date().toISOString()
    this.saveRecord({ sessionId, previous: recorded ?? null, createdAt, segments: [...before, { id: sessionId, title, createdAt }].slice(-50) })
    logger.info(`dsh-her: created ${title} (${sessionId})`)
    return handle
  }

  /**
   * Her workspace goes first in the sidebar once, when she is set up (or
   * updated to a version that does this); after that the user's order stands.
   */
  async moveToTopOnce(): Promise<void> {
    if (this.record().movedToTop === true) return
    const registry = this.deps.services()?.workspaceRegistry
    if (registry?.list === undefined || registry.insertBefore === undefined) return
    const room = join(this.deps.dir, 'room')
    mkdirSync(room, { recursive: true })
    const workspace = await registry.create(room, this.title)
    const first = registry.list()[0]
    if (workspace.id !== undefined && first !== undefined && first.id !== workspace.id) await registry.insertBefore(workspace.id, first.id)
    this.saveRecord({ movedToTop: true })
  }

  private async composeScope(agentCtx: ScopedContext): Promise<void> {
    agentCtx.systemPrompt?.section({
      name: 'dsh-her:system', order: 0, complete: true, interpolate: false,
      // A failing part is left out, never the prompt: a throw here leaves her silent with no error (M4).
      text: () => {
        const { name, persona, callYou, pronoun } = this.deps.character()
        return buildSystemPrompt({
          name, persona, you: { call: callYou, pronoun },
          performance: this.safe('performance', this.deps.performance), aboutYou: this.safe('aboutYou', this.deps.aboutYou), now: new Date(),
        })
      },
    })
    agentCtx.systemPrompt?.suppressRuntimeContext?.()
    this.hideGlobalTools(agentCtx)
    // Without her tools she can still talk; never let them keep her session closed.
    await this.registerTools(agentCtx).catch((error: Error) => this.deps.logger.warn(`dsh-her: play_action not registered (${error.message})`))
    agentCtx.on('agent/assistant-stream', ({ frame }) => this.onFrame(frame))
  }

  /**
   * Her tools, in DSH's native tool shape (plain JSON Schema). Not through
   * `defineTool`: a plugin linked from outside the profile cannot import
   * dsh-tools, and an unconverted schema makes the model provider reject the
   * whole request.
   */
  private safe(part: string, make: () => string): string {
    try {
      return make()
    } catch (error) {
      this.deps.logger.warn(`dsh-her: prompt part ${part} failed (${(error as Error).message})`)
      return ''
    }
  }

  private async registerTools(agentCtx: ScopedContext): Promise<void> {
    const playAction = this.deps.playAction
    agentCtx.tools.register({
      name: 'play_action',
      description: '让你在桌面上的身体做一个较长的表演（离开画面换衣服、说准备好的台词等），做完才返回。能做哪些见系统提示词的"表演"一节。',
      parameters: {
        type: 'object',
        properties: { action: { type: 'string', description: '表演的名字，比如 outfit_jk' } },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, text: { type: 'string' } }, required: ['ok', 'text'] },
        render: (_args: unknown, value: { text: string }) => [{ type: 'text', text: value.text }],
      },
      execute: async (args: { action: string }) => {
        const action = String(args.action ?? '').trim()
        const result = await playAction(action)
        if (result.ok) return { ok: true, text: result.transcript === undefined ? `已经做完：${action}` : `已经做完：${action}（你说了"${result.transcript}"）` }
        const why = { unsupported: '身体不会这个表演', interrupted: '做到一半被打断了', 'no body': '桌面上没有连着身体', timeout: '等了太久没做完' }[result.reason ?? ''] ?? result.reason ?? '没做成'
        return { ok: false, text: `没做成：${action}（${why}）` }
      },
    })

    const memory = this.deps.memory
    const textOutput = {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_args: unknown, value: { text: string }) => [{ type: 'text', text: value.text }],
    }
    agentCtx.tools.register({
      name: 'remember',
      description: '记下一件关于对方的事。fact：长期成立的事实（称呼、喜好、忌讳、重要的人、生日）；event：具体的事，有日期就写 date。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '一句话，比如"他不吃香菜"、"他下周三去面试"' },
          kind: { type: 'string', enum: ['fact', 'event'] },
          date: { type: 'string', description: 'event 发生的日期 YYYY-MM-DD（把"明天""下周三"换算好）；没有就不填' },
        },
        required: ['text', 'kind'],
        additionalProperties: false,
      },
      output: textOutput,
      execute: async (args: { text: string; kind: 'fact' | 'event'; date?: string }) => {
        const hit = memory.remember({ kind: args.kind === 'event' ? 'episode' : 'fact', text: String(args.text ?? ''), ...(args.date === undefined ? {} : { due: args.date }) }, new Date())
        return { text: `记下了（${hit.id}）：${hit.text}` }
      },
    })
    agentCtx.tools.register({
      name: 'recall',
      description: '在你的记忆里找和这个话题有关的事（关于对方的事实、发生过的事、你的日记）。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '要找的话题，比如"面试"、"猫"' } },
        required: ['query'],
        additionalProperties: false,
      },
      output: textOutput,
      execute: async (args: { query: string }) => {
        const hits = memory.recall(String(args.query ?? ''), new Date())
        if (hits.length === 0) return { text: '没找到相关的记忆。' }
        return { text: hits.map(h => `[${h.id}] ${h.at.slice(0, 10)} ${h.text}`).join('\n') }
      },
    })
    agentCtx.tools.register({
      name: 'forget',
      description: '删掉记忆里的几条（id 来自 recall 的结果）。只在对方明确让你忘掉、并且确认过是哪条之后用。',
      parameters: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'string' }, description: '要删的 id，比如 ["f3", "e2"]' } },
        required: ['ids'],
        additionalProperties: false,
      },
      output: textOutput,
      execute: async (args: { ids: string[] }) => {
        const removed = memory.remove(Array.isArray(args.ids) ? args.ids.map(String) : [])
        return { text: removed === 0 ? '没有删掉任何东西（id 不对？）' : `删掉了 ${removed} 条。` }
      },
    })
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
