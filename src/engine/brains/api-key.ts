/**
 * The simplest front brain (docs/实施计划.md step 10): an OpenAI-compatible
 * chat service with the user's own API key — DeepSeek by default, or any
 * other that speaks `/chat/completions`. She streams her reply (`stream:
 * true`), her four tools are function calls, and the conversation is kept in
 * a file of hers. Only talking: this brain is never a hand.
 *
 * The key is asked for at each turn from where it is kept (Mac keychain, or a
 * file only you can read: src/voice/secrets.ts) and goes nowhere but the
 * service's address; it is never logged.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FrontBrain, ReplyEvents } from '../front-brain.ts'
import type { HerTool } from '../her-tools.ts'
import { explain } from '../../net.ts'
import { ReplyStream } from '../reply-stream.ts'

export const DEFAULT_BASE = 'https://api.deepseek.com/v1'
export const DEFAULT_MODEL = 'deepseek-chat'
/** How much of the conversation is sent each time (messages, not counting her prompt). */
const KEEP_MESSAGES = 40
/** Tool rounds in one turn before she has to answer in words. */
const MAX_ROUNDS = 4

type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ApiKeyOptions {
  /** The service's address up to `/chat/completions` (https only, or this computer for tests). */
  base?: string
  model?: string
  key: () => Promise<string | undefined>
  /** Where the conversation is kept. */
  historyFile: string
  prompt: () => string
  context: () => string
  tools: () => HerTool[]
  events: ReplyEvents
  log?: (entry: Record<string, unknown>) => void
  fetch?: typeof fetch
}

/** Words for what the service answered. */
export function explainKeyError(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API key 不对，或者没有权限：在设置里换一个'
  if (status === 402) return 'API 账户的余额不够了'
  if (status === 429) return '请求太多了，或者用量到上限了，过一会儿再试'
  if (status >= 500) return `服务那边出错了（${status}），过一会儿再试`
  return `服务回了错误（${status}）：${body.slice(0, 120)}`
}

export class ApiKeyBrain implements FrontBrain {
  private readonly options: ApiKeyOptions
  private readonly stream: ReplyStream
  private pending: string[] = []
  private toldContext: string | undefined
  private abort: AbortController | undefined
  private turn = 0
  private readonly run = randomUUID().slice(0, 8)
  lastError: string | undefined

  constructor(options: ApiKeyOptions) {
    const base = options.base ?? DEFAULT_BASE
    if (!/^https:\/\//.test(base) && !/^http:\/\/127\.0\.0\.1:\d+(\/|$)/.test(base)) throw new Error('服务地址要以 https:// 开头')
    this.options = options
    this.stream = new ReplyStream(options.events)
  }

  private get base(): string {
    return (this.options.base ?? DEFAULT_BASE).replace(/\/+$/, '')
  }

  private history(): { id: string; messages: Message[] } {
    try {
      const saved = JSON.parse(readFileSync(this.options.historyFile, 'utf8')) as { id?: unknown; messages?: unknown }
      if (typeof saved.id === 'string' && Array.isArray(saved.messages)) return { id: saved.id, messages: saved.messages as Message[] }
    } catch {
      // none yet
    }
    return { id: randomUUID(), messages: [] }
  }

  private save(history: { id: string; messages: Message[] }): void {
    mkdirSync(dirname(this.options.historyFile), { recursive: true })
    // Only whole exchanges are cut away, so a tool answer never loses its call.
    let messages = history.messages
    while (messages.length > KEEP_MESSAGES) {
      const next = messages.findIndex((m, i) => i > 0 && m.role === 'user')
      messages = next < 0 ? messages.slice(-KEEP_MESSAGES) : messages.slice(next)
    }
    writeFileSync(`${this.options.historyFile}.tmp`, `${JSON.stringify({ id: history.id, messages }, null, 1)}\n`)
    renameSync(`${this.options.historyFile}.tmp`, this.options.historyFile)
  }

  get sessionId(): string | undefined {
    return this.history().messages.length === 0 ? undefined : this.history().id
  }

  private log(entry: Record<string, unknown>): void {
    this.options.log?.({ brain: 'api-key', ...entry })
  }

  async note(text: string): Promise<void> {
    this.pending = [...this.pending, text].slice(-8)
  }

  interrupt(): void {
    this.stream.interrupt()
    this.abort?.abort()
  }

  async dispose(): Promise<void> {
    this.interrupt()
  }

  async say(text: string, via: 'voice' | 'text' | 'command'): Promise<void> {
    // A reply still going is stopped first (Conversation cuts her off before; this is for anyone else).
    this.abort?.abort()
    const context = this.options.context()
    const before = [...(context !== '' && context !== this.toldContext ? [`（现场：${context}）`] : []), ...this.pending]
    this.toldContext = context
    this.pending = []
    this.lastError = undefined
    this.turn++
    const history = this.history()
    history.messages.push({ role: 'user', content: [...before, text].join('\n') })
    this.save(history)
    this.log({ event: 'say', via, notes: before.length })
    // The reply streams in the background: say() only sends.
    void this.reply(history).catch((error: Error) => {
      this.lastError = error.name === 'AbortError' ? undefined : error.message
      if (error.name !== 'AbortError') this.log({ event: 'error', text: error.message.slice(0, 200) })
      if (this.stream.active) this.stream.end(error.name === 'AbortError' ? 'interrupted' : 'error')
      else if (error.name !== 'AbortError') {
        this.stream.start(`${this.run}@${this.turn}.error`)
        this.stream.end('error')
      }
    })
  }

  private async reply(history: { id: string; messages: Message[] }): Promise<void> {
    const key = await this.options.key()
    if (key === undefined || key === '') throw new Error('还没有填 API key：在设置里填一个')
    const abort = new AbortController()
    this.abort = abort
    const tools = this.options.tools()
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const url = `${this.base}/chat/completions`
      const res = await (this.options.fetch ?? fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, accept: 'text/event-stream' },
        body: JSON.stringify({
          model: this.options.model ?? DEFAULT_MODEL,
          stream: true,
          messages: [{ role: 'system', content: this.options.prompt() }, ...history.messages],
          // The last round: words only.
          ...(tools.length === 0 || round === MAX_ROUNDS ? {} : { tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }),
        }),
        signal: abort.signal,
      }).catch((error: Error) => {
        if (error.name === 'AbortError') throw error
        throw new Error(explain(url, error))
      })
      if (!res.ok || res.body === null) throw new Error(explainKeyError(res.status, await res.text().catch(() => '')))
      // A reply begins with her first word: a round of only tool calls is not a reply with nothing in it.
      let started = false
      const begin = () => {
        if (started) return
        started = true
        this.stream.start(`${this.run}@${this.turn}.${round}`)
      }
      let content = ''
      const calls: Array<{ id: string; name: string; arguments: string }> = []
      let finish: string | undefined
      try {
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += value
          let at: number
          while ((at = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, at).trim()
            buffer = buffer.slice(at + 1)
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') continue
            let chunk: { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }> }
            try {
              chunk = JSON.parse(data)
            } catch {
              continue
            }
            const choice = chunk.choices?.[0]
            const delta = choice?.delta
            if (typeof delta?.content === 'string' && delta.content !== '') {
              content += delta.content
              begin()
              this.stream.delta(delta.content)
            }
            for (const call of delta?.tool_calls ?? []) {
              const slot = calls[call.index] ??= { id: '', name: '', arguments: '' }
              if (call.id !== undefined) slot.id = call.id
              if (call.function?.name !== undefined) slot.name += call.function.name
              if (call.function?.arguments !== undefined) slot.arguments += call.function.arguments
            }
            if (choice?.finish_reason) finish = choice.finish_reason
          }
        }
      } catch (error) {
        // Cut off: what she said so far stays in the conversation.
        if (content !== '') {
          history.messages.push({ role: 'assistant', content })
          this.save(history)
        }
        throw error
      }
      const used = calls.filter(c => c.name !== '')
      if (finish !== 'tool_calls' || used.length === 0) {
        history.messages.push({ role: 'assistant', content })
        this.save(history)
        begin()
        this.stream.end('committed')
        return
      }
      // Tools: her words so far end this reply; their answers go back for the next round.
      if (started) this.stream.end('committed')
      history.messages.push({ role: 'assistant', content, tool_calls: used.map(c => ({ id: c.id || randomUUID(), type: 'function', function: { name: c.name, arguments: c.arguments } })) })
      const asked = history.messages.at(-1) as Extract<Message, { role: 'assistant' }>
      for (const call of asked.tool_calls!) {
        const tool = tools.find(t => t.name === call.function.name)
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
        } catch {
          // a tool gets what could be read
        }
        const result = tool === undefined ? { text: `没有这个工具：${call.function.name}` } : await tool.execute(args).catch((error: Error) => ({ text: `出错了：${error.message}` }))
        this.log({ event: 'tool', name: call.function.name })
        history.messages.push({ role: 'tool', tool_call_id: call.id, content: result.text })
      }
      this.save(history)
      if (abort.signal.aborted) return
    }
  }
}
