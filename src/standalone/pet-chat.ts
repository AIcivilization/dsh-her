/**
 * 真人桌宠 talking (docs/实施计划.md step 11): the character of now with a
 * front brain of the user's choosing — Claude Code already logged in on this
 * computer, or an OpenAI-compatible service with their own key (DeepSeek by
 * default). The same conversation as in DSH (src/engine/conversation.ts):
 * you type in her talk bar, she answers sentence by sentence in a bubble and,
 * when the Edge voice is there, out loud; she can be cut off, and she
 * remembers you (her memory and tools, as in DSH).
 *
 * Not yet: listening (speech recognition needs a model and a native module
 * the app does not ship), Ming and the paid voices, speaking first.
 */

import { join } from 'node:path'
import type { Character } from '../core/character.ts'
import { extractCues } from '../core/cues.ts'
import { buildSystemPrompt, memoryContext, partOfDay } from '../core/prompt.ts'
import { readingMs } from '../core/sentences.ts'
import { speakable } from '../core/speakable.ts'
import { DEFAULT_VOICE, serviceOf } from '../core/voices.ts'
import { ApiKeyBrain, DEFAULT_BASE, DEFAULT_MODEL } from '../engine/brains/api-key.ts'
import { ClaudeCodeBrain, findClaude } from '../engine/brains/claude-code.ts'
import { Conversation } from '../engine/conversation.ts'
import type { FrontBrain } from '../engine/front-brain.ts'
import { herTools } from '../engine/her-tools.ts'
import { FileMemory } from '../memory/store.ts'
import type { BrainMessage, PackSummary } from '../protocol/index.ts'
import { EdgeVoice } from '../voice/edge.ts'
import type { Secrets } from '../voice/secrets.ts'
import { SpeechQueue } from '../voice/speech-queue.ts'

/** Which brain she talks with. */
export type BrainChoice =
  | { kind: 'none' }
  | { kind: 'claude-code'; model?: string }
  | { kind: 'api-key'; base?: string; model?: string }

export const API_KEY_NAME = 'zhenren-api-key'
const STUCK_AFTER_MS = 30_000
const MAX_NOTES = 4
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function cleanBrainChoice(value: unknown): BrainChoice {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const text = (x: unknown, max: number) => (typeof x === 'string' && x.trim() !== '' ? x.trim().slice(0, max) : undefined)
  const model = text(v.model, 80)
  if (v.kind === 'claude-code') return { kind: 'claude-code', ...(model === undefined ? {} : { model }) }
  if (v.kind === 'api-key') {
    const base = text(v.base, 200)
    return { kind: 'api-key', ...(base !== undefined && /^https:\/\//.test(base) ? { base } : {}), ...(model === undefined ? {} : { model }) }
  }
  return { kind: 'none' }
}

export interface PetChatDeps {
  home: string
  cid: string
  /** Her folder: memory, room, conversation. */
  dir: string
  character: () => Character
  choice: BrainChoice
  secrets: Secrets
  /** Her voice out loud (Edge); off: words only. */
  voice: () => boolean
  broadcast: (message: BrainMessage) => void
  broadcastWithAudio: (message: BrainMessage, stream: number, audio: Uint8Array) => void
  bodyPack: () => PackSummary | undefined
  playAction: (action: string) => Promise<{ ok: boolean; reason?: string }>
  off: () => boolean
  log: (entry: Record<string, unknown>) => void
  /** For tests: a brain to use instead of making one. */
  brain?: FrontBrain
}

export class PetChat {
  readonly memory: FileMemory
  readonly conv: Conversation
  private readonly deps: PetChatDeps
  private brain: FrontBrain | undefined
  private readonly speech: SpeechQueue
  private readonly edge: EdgeVoice
  private nextStream = 1
  private lines: Array<{ who: 'you' | 'her'; text: string }> = []

  constructor(deps: PetChatDeps) {
    this.deps = deps
    this.memory = new FileMemory(join(deps.dir, 'memory'))
    this.edge = new EdgeVoice(join(deps.home, 'edge-tts'))
    const { cid, broadcast } = deps
    this.speech = new SpeechQueue((text) => this.synthesize(text), {
      sentence: (uid, seq, text, audio, cues) => {
        const withCues = cues.length === 0 ? {} : { cues }
        this.conv.playing(audio?.durationMs ?? readingMs(text))
        if (audio === undefined) {
          broadcast({ t: 'speak.seg', cid, uid, seq, text, durationMs: text === '' ? 300 : readingMs(text), ...withCues })
          return
        }
        const stream = this.nextStream++
        deps.broadcastWithAudio({ t: 'speak.seg', cid, uid, seq, text, durationMs: audio.durationMs, format: audio.format, stream, ...withCues }, stream, audio.audio)
      },
      end: uid => broadcast({ t: 'speak.end', cid, uid }),
    })
    this.conv = new Conversation({
      cid,
      brain: () => this.ensureBrain(),
      speech: () => this.speech,
      speak: (uid, seq, text) => {
        if (deps.off()) return
        const performed = extractCues(text, deps.bodyPack())
        if (performed.text !== '' || performed.cues.length > 0) this.speech.say(uid, seq, performed.text, performed.cues)
      },
      broadcast,
      off: deps.off,
      log: deps.log,
      heardYou: () => {},
      warm: () => {},
      beforeTurn: async text => {
        this.lines = [...this.lines, { who: 'you' as const, text }].slice(-12)
        this.broadcastTalk()
      },
      emptyReply: (_trace, outcome) => {
        const why = this.brain?.lastError
        if (outcome === 'stuck' || why === undefined) return
        broadcast({ t: 'bubble', cid, text: `（${why}）`, ttlMs: 12_000 })
      },
      replyEnded: () => {
        const reply = this.conv.finished.at(-1)
        if (reply !== undefined && reply.sentences.length > 0) {
          this.lines = [...this.lines, { who: 'her' as const, text: reply.sentences.join('') }].slice(-12)
          this.broadcastTalk()
        }
      },
      ownLine: text => {
        this.lines = [...this.lines, { who: 'her' as const, text }].slice(-12)
        this.broadcastTalk()
      },
      stuckAfterMs: STUCK_AFTER_MS,
      stuckText: '（我好像卡住了，没能开始回答。看看设置里的"和她聊天"？）',
      maxNotes: MAX_NOTES,
    })
  }

  /** Her voice, when it is ready; words only until then (the tool installs itself the first time). */
  private async synthesize(text: string) {
    if (!this.deps.voice()) return undefined
    const c = this.deps.character()
    const voice = serviceOf(c.voice.id) === 'edge' ? c.voice.id : DEFAULT_VOICE
    if (this.edge.bin() === undefined) {
      void this.edge.ensure().catch(() => undefined)
      return undefined
    }
    try {
      const audio = await this.edge.synthesize(speakable(text), voice, c.voice.speed)
      return { audio: audio.audio, durationMs: audio.durationMs, format: 'mp3' as const }
    } catch (error) {
      this.deps.log({ event: 'voice', error: (error as Error).message.slice(0, 200) })
      return undefined
    }
  }

  /** Who she is: changes start Claude Code again on the same conversation. */
  private prompt(): string {
    const c = this.deps.character()
    return buildSystemPrompt({ name: c.name, persona: c.persona, you: { call: c.callYou, pronoun: c.pronoun } })
  }

  /** What changes during the day: the date, and what she remembers about you. */
  private context(): string {
    const now = new Date()
    const day = `今天是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日，星期${WEEKDAYS[now.getDay()]}，${partOfDay(now)}`
    const about = memoryContext({ profile: this.memory.profile(), recent: this.memory.recent(now), due: this.memory.due(now) })
    return about === '' ? day : `${day}\n${about}`
  }

  private ensureBrain(): FrontBrain | undefined {
    if (this.brain !== undefined) return this.brain
    if (this.deps.brain !== undefined) return (this.brain = this.deps.brain)
    const { choice, dir } = this.deps
    const common = {
      prompt: () => this.prompt(),
      context: () => this.context(),
      tools: () => herTools({ playAction: this.deps.playAction, memory: this.memory }),
      events: this.conv.events,
      log: this.deps.log,
    }
    if (choice.kind === 'claude-code') {
      this.brain = new ClaudeCodeBrain({ cwd: join(dir, 'room'), sessionFile: join(dir, 'claude-session.json'), ...(choice.model === undefined ? {} : { model: choice.model }), ...common })
    } else if (choice.kind === 'api-key') {
      this.brain = new ApiKeyBrain({
        base: choice.base ?? DEFAULT_BASE, model: choice.model ?? DEFAULT_MODEL,
        key: () => this.deps.secrets.get(API_KEY_NAME), historyFile: join(dir, 'chat.json'), ...common,
      })
    }
    return this.brain
  }

  /** You typed something. */
  hear(text: string): void {
    const clean = text.trim().slice(0, 2000)
    if (clean !== '') this.conv.hear(clean, 'text')
  }

  interrupted(uid: string, seq: number, playedMs: number): void {
    this.conv.interrupted(uid, seq, playedMs)
  }

  /** A line of her own (a touch, a hello), out loud and noted for her brain. */
  sayOwnLine(text: string, note: string): void {
    this.conv.sayOwnLine(text, note)
  }

  talkView() {
    const c = this.deps.character()
    return { name: c.name, lines: this.lines.slice(-6), segments: [], simple: true }
  }

  private broadcastTalk(): void {
    this.deps.broadcast({ t: 'talk', ...this.talkView() })
  }

  async dispose(): Promise<void> {
    this.conv.cut()
    this.conv.dispose()
    await this.brain?.dispose()
    this.brain = undefined
  }
}

/** What the settings window shows about her brain. */
export async function brainStatus(choice: BrainChoice, secrets: Secrets): Promise<{ choice: BrainChoice; claude: boolean; key: boolean }> {
  return { choice, claude: findClaude() !== undefined, key: await secrets.has(API_KEY_NAME) }
}
