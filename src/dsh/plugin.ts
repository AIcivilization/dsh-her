/**
 * The DSH shell: opens her session as soon as DSH's agent services are ready
 * and exposes `/her`. Everything hangs off `ctx.effect`, so disabling or
 * uninstalling the plugin closes her session handle.
 *
 * M0 stage: no body yet. Her replies are split into sentences and written to
 * `<home>/logs/stream.jsonl` with timings, which is how the session spike is
 * checked; `/her <text>` talks to her and reports the timings in the chat.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { herPaths } from '../core/index.ts'
import type { HerConfig } from './config.ts'
import { HerSession, type DshServices, type ModelRoute } from './her-session.ts'

interface CommandsLike {
  register(definition: {
    name: string
    description: string
    input?: { hint: string }
    handler: (invocation: { rawInput: string }) => Promise<{ kind: 'success' | 'error'; text: string }>
  }): () => void
}

const SERVICES = ['agents', 'agentDefaultModel', 'workspaceRegistry', 'sessionTitle', 'sessionQuery'] as const

const STOP_WORDS = new Set(['停', '停下', 'stop'])
const INTERRUPT_CHECK = '测打断'
const DIAGNOSE = '诊断'

/** One reply as seen from the stream, for timing and for `/her`'s answer. */
interface ReplyTrace {
  attemptId: string
  startedAt: number
  firstSentenceAt?: number
  sentences: string[]
  outcome?: string
}

export function apply(ctx: Context, config: HerConfig): void {
  const paths = herPaths(config.home)
  const cid = config.character.id
  const dir = join(paths.characters, cid)
  let services: DshServices | undefined
  let session: HerSession | undefined
  let sentAt: number | undefined
  let current: ReplyTrace | undefined
  const finished: ReplyTrace[] = []

  const log = (entry: Record<string, unknown>) => {
    try {
      appendFileSync(join(paths.logs, 'stream.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), cid, ...entry })}\n`)
    } catch (error) {
      ctx.logger.warn(`dsh-her: stream log failed (${(error as Error).message})`)
    }
  }

  const route = (): ModelRoute | undefined => {
    const effort = config.reasoningEffort === '' ? {} : { reasoningEffort: config.reasoningEffort }
    if (config.provider !== '' && config.model !== '') return { provider: config.provider, model: config.model, ...effort }
    const selected = services?.agentDefaultModel?.currentSelection()
    return selected === undefined ? undefined : { provider: selected.provider, model: selected.model, ...effort }
  }

  /** Resolves on the first sentence of the next reply. */
  let onFirstSentence: (() => void) | undefined

  ctx.effect(() => {
    mkdirSync(dir, { recursive: true })
    mkdirSync(paths.logs, { recursive: true })
    session = new HerSession({
      cid,
      name: config.character.name,
      persona: config.character.persona,
      dir,
      get route() { return route() },
      services: () => services,
      logger: ctx.logger,
      events: {
        start(attemptId) {
          current = { attemptId, startedAt: Date.now(), sentences: [] }
          log({ event: 'start', attemptId, sinceSendMs: sentAt === undefined ? null : current.startedAt - sentAt })
        },
        sentence(attemptId, text) {
          const now = Date.now()
          if (current?.attemptId === attemptId) {
            current.firstSentenceAt ??= now
            current.sentences.push(text)
          }
          onFirstSentence?.()
          onFirstSentence = undefined
          log({ event: 'sentence', attemptId, text, sinceSendMs: sentAt === undefined ? null : now - sentAt })
        },
        end(attemptId, outcome) {
          log({ event: 'end', attemptId, outcome, sinceSendMs: sentAt === undefined ? null : Date.now() - sentAt })
          if (current?.attemptId === attemptId) {
            current.outcome = outcome
            finished.push(current)
            if (finished.length > 20) finished.shift()
          }
          current = undefined
        },
      },
    } as ConstructorParameters<typeof HerSession>[0])
    if (services !== undefined) open()
    return async () => {
      const closing = session
      session = undefined
      closing?.interrupt()
      await closing?.dispose()
    }
  })

  const open = () => {
    session?.ensure().catch(error => ctx.logger.warn(`dsh-her: her session not ready (${(error as Error).message})`))
  }

  ctx.inject([...SERVICES], (serviceCtx) => {
    serviceCtx.effect(() => {
      services = serviceCtx as unknown as DshServices
      open()
      return () => { services = undefined }
    })
  })

  /**
   * M0 spike: send a prompt, interrupt right after her first sentence, then
   * read her session back and report what DSH recorded for the cut reply.
   */
  const checkInterrupt = async (her: HerSession, prompt: string): Promise<{ kind: 'success' | 'error'; text: string }> => {
    const query = services?.sessionQuery
    const id = her.sessionId
    const before = query === undefined || id === undefined ? -1 : Math.max(-1, ...(await query.readSession(id)).events.map(e => e.seq))
    const first = new Promise<void>(resolve => { onFirstSentence = resolve })
    sentAt = Date.now()
    const agent = await her.say(prompt, 'command')
    const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 60_000).unref())
    if (await Promise.race([first, timeout]) === 'timeout') return { kind: 'error', text: '60 秒内没有等到第一句' }
    const cutAt = Date.now()
    her.interrupt()
    await agent.whenIdle()
    const idleMs = Date.now() - cutAt
    const events = query === undefined || her.sessionId === undefined ? [] : (await query.readSession(her.sessionId)).events.filter(e => e.seq > before)
    const message = events.filter(e => e.type === 'assistant/message').at(-1)?.data as { interrupted?: boolean; usage?: unknown; message?: { content?: Array<{ type: string; text?: string }> } } | undefined
    const kept = message?.message?.content?.filter(b => b.type === 'text').map(b => b.text ?? '').join('') ?? ''
    const end = events.filter(e => e.type === 'turn/end').at(-1)?.data as { reason?: { kind?: string } } | undefined
    log({ event: 'interrupt-check', idleMs, turnEnd: end?.reason?.kind ?? null, interrupted: message?.interrupted ?? null, kept, usage: message?.usage ?? null, eventTypes: events.map(e => e.type) })
    return {
      kind: 'success',
      text: [
        `第一句后 ${idleMs} ms 停稳`,
        `turn/end：${end?.reason?.kind ?? '（无）'}`,
        `assistant/message.interrupted：${message?.interrupted === true ? 'true' : String(message?.interrupted)}`,
        `DSH 记下的前半段（${[...kept].length} 字）：${kept.slice(0, 120)}${[...kept].length > 120 ? '…' : ''}`,
      ].join('\n'),
    }
  }

  /** M0 spike: what her last model request carried (tools, system prompt) and what it cost. */
  const diagnose = async (her: HerSession): Promise<{ kind: 'success' | 'error'; text: string }> => {
    const query = services?.sessionQuery
    const id = her.sessionId
    if (query === undefined || id === undefined) return { kind: 'error', text: '会话还没建好' }
    const events = (await query.readSession(id)).events
    const header = events.filter(e => e.type === 'request/header').at(-1)?.data as Record<string, unknown> | undefined
    const usage = events.filter(e => e.type === 'assistant/message' && (e.data as { usage?: unknown }).usage !== undefined).at(-1)?.data as { usage?: unknown } | undefined
    const system = events.filter(e => e.type === 'system/message').at(-1)?.data as { message?: unknown } | undefined
    const tools = (header?.tools ?? header?.toolSchemas ?? header?.additions) as Array<{ name?: string }> | undefined
    const result = {
      headerKeys: header === undefined ? null : Object.keys(header),
      toolNames: Array.isArray(tools) ? tools.map(t => t.name) : null,
      systemChars: system === undefined ? null : JSON.stringify(system.message).length,
      usage: usage?.usage ?? null,
    }
    log({ event: 'diagnose', ...result })
    return { kind: 'success', text: JSON.stringify(result, null, 2) }
  }

  ctx.inject(['commands'], (commandCtx) => {
    const commands = (commandCtx as unknown as { commands: CommandsLike }).commands
    commandCtx.effect(() => commands.register({
      name: 'her',
      description: 'dsh-her: talk to her (`/her 你好`), stop her (`/her 停`), or show her session',
      input: { hint: '[想对她说的话 | 停]' },
      async handler(invocation) {
        if (session === undefined) return { kind: 'error', text: 'dsh-her：还没有启动' }
        const text = invocation.rawInput.trim()
        if (text === '') {
          const id = session.sessionId
          return { kind: 'success', text: id === undefined ? `${session.title}：会话还没建好` : `${session.title}\n会话：${id}\n日志：${join(paths.logs, 'stream.jsonl')}` }
        }
        if (STOP_WORDS.has(text.toLowerCase())) {
          session.interrupt()
          return { kind: 'success', text: '已让她停下。' }
        }
        if (text.startsWith(INTERRUPT_CHECK)) return checkInterrupt(session, text.slice(INTERRUPT_CHECK.length).trim() || '给我讲一个很长很长的睡前故事，至少讲十句。')
        if (text === DIAGNOSE) return diagnose(session)
        sentAt = Date.now()
        const before = finished.length
        const agent = await session.say(text, 'command')
        await agent.whenIdle()
        const reply = finished.slice(before).at(-1)
        if (reply === undefined) return { kind: 'error', text: '她没有回复（看 DSH 日志里的模型错误）' }
        const firstMs = reply.firstSentenceAt === undefined ? '—' : `${reply.firstSentenceAt - sentAt} ms`
        return {
          kind: 'success',
          text: `${reply.sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n（开始生成 ${reply.startedAt - sentAt} ms · 第一句 ${firstMs} · ${reply.outcome}）`,
        }
      },
    }))
  })
}
