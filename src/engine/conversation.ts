/**
 * Talking with her, whatever her front brain is (docs/实施计划.md step 9):
 * what you say goes to the brain (cutting her off first), her reply comes
 * back sentence by sentence to her voice, a body cutting her off is
 * remembered as how far you heard her, and she says things by herself (an
 * opening, a touch line) outside her brain's turns. Moved out of the DSH
 * plugin unchanged; DSH and 真人桌宠 run the same one.
 *
 * What is DSH's or the plugin's stays outside, as hooks: how a sentence is
 * dressed for her voice (cues, Ming's sounds), whether a new conversation
 * starts before a turn, what to make of a reply with no words.
 */

import { SentenceSplitter } from '../core/sentences.ts'
import { readingMs } from '../core/sentences.ts'
import type { BrainMessage } from '../protocol/index.ts'
import { heardText, type SpeechQueue } from '../voice/speech-queue.ts'
import type { FrontBrain, ReplyEvents } from './front-brain.ts'

/** One reply of hers, for the log and for `/her`. */
export interface ReplyTrace {
  attemptId: string
  startedAt: number
  firstSentenceAt?: number
  sentences: string[]
  outcome?: string
}

export interface ConversationDeps {
  cid: string
  brain: () => FrontBrain | undefined
  speech: () => Pick<SpeechQueue, 'cancel' | 'end' | 'sentOf'> | undefined
  /** Say one sentence of hers to her voice (the plugin takes her cues and sounds out first). */
  speak: (uid: string, seq: number, text: string) => void
  broadcast: (message: BrainMessage) => void
  /** She is switched off: nothing of her own is said. */
  off: () => boolean
  log: (entry: Record<string, unknown>) => void
  /** Someone talked to her (her openings wait). */
  heardYou: (at?: number) => void
  /** A voice that has to start up starts while she thinks. */
  warm: () => void
  /** Before a turn goes to the brain, after she was cut off: may start a new conversation. Its sync part runs at once. */
  beforeTurn?: (text: string, at: number) => Promise<void>
  /** A reply ended without a word (the plugin finds out why). */
  emptyReply?: (trace: ReplyTrace, outcome: string) => void
  /** Any reply ended. */
  replyEnded?: () => void
  /** She said a line of her own (for the talk bar). */
  ownLine?: (text: string) => void
  /** How long to wait for a reply to start before saying she is stuck, and what to say. */
  stuckAfterMs: number
  stuckText: string
  maxNotes: number
}

export class Conversation {
  private readonly deps: ConversationDeps
  /** When what you last said was sent. */
  sentAt: number | undefined
  /** The reply streaming now. */
  current: ReplyTrace | undefined
  readonly finished: ReplyTrace[] = []
  /** Resolves on the first sentence of the next reply. */
  onFirstSentence: (() => void) | undefined
  /** What you heard of her last cut-off reply; told to her before your next turn. */
  cutNote: string | undefined
  /** What she said first and how you touched her, told to her brain before your next words. */
  notes: string[] = []
  /** Her own line in progress (an opening, a touch line), outside her brain. */
  ownLine: { uid: string; note: string } | undefined
  /** Waiting for a reply to start, and until when her voice is still playing. */
  awaitingReply = false
  speakingUntil = 0
  /** Her reply a body last cut off, to tell your voice from her own through the speakers. */
  lastCut: { uid: string; at: number } | undefined
  /** The last reply that came out empty because her model failed; cleared by the next sentence she says. */
  problem: { text: string; at: number } | undefined
  private stuckTimer: NodeJS.Timeout | undefined
  private nextOwn = 1
  /** Her brain's reply events: give these to the brain. */
  readonly events: ReplyEvents

  constructor(deps: ConversationDeps) {
    this.deps = deps
    this.events = {
      start: attemptId => this.replyStarted(attemptId),
      sentence: (attemptId, text) => this.replySentence(attemptId, text),
      end: (attemptId, outcome) => this.replyEnded(attemptId, outcome),
    }
  }

  /** She is talking, thinking or still being heard. */
  busy(now = Date.now()): boolean {
    return this.current !== undefined || this.awaitingReply || now < this.speakingUntil
  }

  addNote(note: string): void {
    this.notes = [...this.notes, note].slice(-this.deps.maxNotes)
  }

  /** Her voice plays a sentence this long (from the speech queue). */
  playing(durationMs: number, now = Date.now()): void {
    this.speakingUntil = Math.max(this.speakingUntil, now) + durationMs
  }

  /** She says something by herself, not as a reply: her brain hears of it before your next words. */
  sayOwnLine(text: string, note: string, now = Date.now()): void {
    const speech = this.deps.speech()
    if (speech === undefined || this.deps.off()) return
    this.deps.warm()
    const uid = `own-${now.toString(36)}-${this.nextOwn++}`
    this.ownLine = { uid, note }
    this.addNote(note)
    this.deps.ownLine?.(text)
    this.deps.broadcast({ t: 'speak.begin', cid: this.deps.cid, uid })
    const splitter = new SentenceSplitter()
    const sentences = [...splitter.push(text), ...splitter.flush()]
    sentences.forEach((sentence, seq) => this.deps.speak(uid, seq, sentence))
    speech.end(uid)
    this.speakingUntil = Math.max(this.speakingUntil, now + readingMs(text))
  }

  /** Stop her current reply: generation, synthesis and every body's playback. */
  cut(): void {
    const speech = this.deps.speech()
    if (this.ownLine !== undefined) {
      speech?.cancel(this.ownLine.uid)
      this.deps.broadcast({ t: 'speak.cancel', cid: this.deps.cid, uid: this.ownLine.uid })
      this.ownLine = undefined
      this.speakingUntil = 0
    }
    if (this.current === undefined) return
    this.deps.brain()?.interrupt()
    speech?.cancel(this.current.attemptId)
    this.deps.broadcast({ t: 'speak.cancel', cid: this.deps.cid, uid: this.current.attemptId })
  }

  /** You said something (typed or spoken): cut her off if she is talking, then pass it on. */
  hear(text: string, via: 'text' | 'voice', now = Date.now()): void {
    const her = this.deps.brain()
    if (her === undefined) return
    const { cid, broadcast, log } = this.deps
    this.cut()
    this.sentAt = now
    this.awaitingReply = true
    this.speakingUntil = 0
    this.deps.heardYou(now)
    this.deps.warm()
    broadcast({ t: 'state', cid, state: 'think' })
    clearTimeout(this.stuckTimer)
    this.stuckTimer = setTimeout(() => {
      log({ event: 'stuck', text, waitedMs: this.deps.stuckAfterMs })
      this.awaitingReply = false
      broadcast({ t: 'state', cid, state: 'idle' })
      broadcast({ t: 'bubble', cid, text: this.deps.stuckText, ttlMs: 8000 })
      this.deps.emptyReply?.({ attemptId: '', startedAt: now, sentences: [] }, 'stuck')
    }, this.deps.stuckAfterMs)
    this.stuckTimer.unref()
    const note = [...this.notes, ...(this.cutNote === undefined ? [] : [this.cutNote])].join('\n')
    this.cutNote = undefined
    this.notes = []
    ;(this.deps.beforeTurn?.(text, now) ?? Promise.resolve())
      .then(() => (note === '' ? undefined : her.note(note)))
      .then(() => her.say(text, via))
      .catch((error: Error) => {
        this.awaitingReply = false
        broadcast({ t: 'state', cid, state: 'idle' })
        broadcast({ t: 'bubble', cid, text: `（我还没准备好：${error.message}）`, ttlMs: 6000 })
      })
  }

  /** A body cut her off at `seq`, `playedMs` into it: remember what you heard and stop the rest. */
  interrupted(uid: string, seq: number, playedMs: number, now = Date.now()): void {
    const speech = this.deps.speech()
    const heard = heardText(speech?.sentOf(uid) ?? [], seq, playedMs)
    this.cutNote = heard === ''
      ? '（备注：你上一段话刚开口就被对方打断了，对方什么都没听到。）'
      : `（备注：你上一段话只说到"${heard}"就被对方打断了，后面的部分对方没有听到。）`
    this.deps.log({ event: 'interrupted', uid, seq, playedMs, heard })
    this.lastCut = { uid, at: now }
    if (this.ownLine?.uid === uid) {
      // What she said by herself was cut: the note above says how far she got, not the whole line.
      const whole = this.ownLine.note
      this.notes = this.notes.filter(n => n !== whole)
      this.ownLine = undefined
      this.speakingUntil = 0
    }
    if (this.current?.attemptId === uid) this.deps.brain()?.interrupt()
    speech?.cancel(uid)
  }

  /** Right after a barge-in, what was heard may be her own voice: the cut-off reply to compare with (once). */
  takeBargeIn(endedAt: number): { uid: string; said: string } | undefined {
    const barge = this.lastCut !== undefined && endedAt - this.lastCut.at < 10_000 ? this.lastCut : undefined
    this.lastCut = undefined
    if (barge === undefined) return undefined
    return { uid: barge.uid, said: (this.deps.speech()?.sentOf(barge.uid) ?? []).map(s => s.text).join('') }
  }

  dispose(): void {
    clearTimeout(this.stuckTimer)
  }

  private replyStarted(attemptId: string, now = Date.now()): void {
    clearTimeout(this.stuckTimer)
    this.awaitingReply = false
    // A reply means someone is talking to her, wherever from.
    this.deps.heardYou()
    this.current = { attemptId, startedAt: now, sentences: [] }
    this.deps.log({ event: 'start', attemptId, sinceSendMs: this.sentAt === undefined ? null : now - this.sentAt })
    this.deps.broadcast({ t: 'speak.begin', cid: this.deps.cid, uid: attemptId })
  }

  private replySentence(attemptId: string, text: string, now = Date.now()): void {
    let seq = 0
    if (this.current?.attemptId === attemptId) {
      this.current.firstSentenceAt ??= now
      this.current.sentences.push(text)
      seq = this.current.sentences.length - 1
    }
    this.onFirstSentence?.()
    this.onFirstSentence = undefined
    this.problem = undefined
    this.deps.log({ event: 'sentence', attemptId, text, sinceSendMs: this.sentAt === undefined ? null : now - this.sentAt })
    this.deps.speak(attemptId, seq, text)
  }

  private replyEnded(attemptId: string, outcome: string): void {
    this.deps.log({ event: 'end', attemptId, outcome, sinceSendMs: this.sentAt === undefined ? null : Date.now() - this.sentAt })
    if (this.current?.attemptId === attemptId) {
      this.current.outcome = outcome
      if (this.current.sentences.length === 0) this.deps.emptyReply?.(this.current, outcome)
      this.finished.push(this.current)
      if (this.finished.length > 20) this.finished.shift()
    }
    this.deps.speech()?.end(attemptId)
    this.current = undefined
    this.deps.replyEnded?.()
  }
}
