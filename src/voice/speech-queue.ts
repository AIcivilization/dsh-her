/**
 * Turns her replies into audio sentence by sentence, in order.
 *
 * The next few sentences are synthesized at once (AHEAD), so while one plays
 * the following ones are already on their way; a slow voice service only
 * makes the first sentence of a reply wait. Sentences are started and
 * emitted strictly in order, across replies, so the first sentence of a reply
 * is never queued behind a later one. Each result is emitted as soon as it
 * and everything before it are ready (the body queues playback), and a reply's
 * end is emitted after its last sentence. Cancelling a reply drops what has
 * not been emitted yet; synthesis already running for it is thrown away.
 *
 * A sentence whose synthesis fails is still emitted, without audio, so the
 * subtitle shows and the reply goes on.
 */

import type { Cue } from '../protocol/index.ts'

export interface Synthesized {
  audio: Uint8Array
  durationMs: number
  format: 'wav' | 'mp3'
}

export interface SpeechOut {
  sentence(uid: string, seq: number, text: string, audio: Synthesized | undefined, cues: Cue[]): void
  end(uid: string): void
}

/** What a reply has sent so far: enough to say how much of it was heard when it is cut off. */
export interface SentSentence {
  seq: number
  text: string
  durationMs: number
}

/** Sentences being synthesized at the same time, counted from the next to emit. */
const AHEAD = 3

type Job =
  | { uid: string; kind: 'sentence'; seq: number; text: string; cues: Cue[]; audio?: Promise<Synthesized | undefined> }
  | { uid: string; kind: 'end' }

export class SpeechQueue {
  private readonly jobs: Job[] = []
  private running = false
  private readonly cancelled = new Set<string>()
  private readonly sent = new Map<string, SentSentence[]>()
  private readonly synth: (text: string) => Promise<Synthesized | undefined>
  private readonly out: SpeechOut

  constructor(synth: (text: string) => Promise<Synthesized | undefined>, out: SpeechOut) {
    this.synth = synth
    this.out = out
  }

  say(uid: string, seq: number, text: string, cues: Cue[] = []): void {
    if (this.cancelled.has(uid)) return
    this.jobs.push({ uid, kind: 'sentence', seq, text, cues })
    this.startAhead()
    void this.pump()
  }

  end(uid: string): void {
    if (this.cancelled.has(uid)) return
    this.jobs.push({ uid, kind: 'end' })
    void this.pump()
  }

  cancel(uid: string): void {
    this.cancelled.add(uid)
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i]!.uid === uid) this.jobs.splice(i, 1)
    // Remember only recent cancellations.
    if (this.cancelled.size > 32) this.cancelled.delete(this.cancelled.values().next().value!)
  }

  /** Sentences of a reply that went out, in order. */
  sentOf(uid: string): SentSentence[] {
    return this.sent.get(uid) ?? []
  }

  /** Resolves when nothing is queued or being synthesized. */
  async idle(): Promise<void> {
    while (this.running || this.jobs.length > 0) await new Promise(resolve => setTimeout(resolve, 5))
  }

  /** Start synthesizing the first AHEAD sentences still to emit. */
  private startAhead(): void {
    let sentences = 0
    for (const job of this.jobs) {
      if (job.kind !== 'sentence') continue
      if (++sentences > AHEAD) break
      job.audio ??= this.synth(job.text).catch(() => undefined)
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (let job = this.jobs[0]; job !== undefined; job = this.jobs[0]) {
        if (job.kind === 'end') {
          this.jobs.shift()
          this.out.end(job.uid)
          continue
        }
        this.startAhead()
        const audio = await job.audio
        // Cancelled while it was synthesized: cancel() already took it out.
        if (this.jobs[0] !== job) continue
        this.jobs.shift()
        this.startAhead()
        const record = this.sent.get(job.uid) ?? []
        record.push({ seq: job.seq, text: job.text, durationMs: audio?.durationMs ?? 0 })
        this.sent.set(job.uid, record)
        if (this.sent.size > 16) this.sent.delete(this.sent.keys().next().value!)
        this.out.sentence(job.uid, job.seq, job.text, audio, job.cues)
      }
    } finally {
      this.running = false
    }
  }
}

/**
 * How much of a reply was heard when it was cut off: every sentence before
 * the one playing, plus the share of that one its played time covers.
 */
export function heardText(sent: SentSentence[], seq: number, playedMs: number): string {
  let heard = ''
  for (const sentence of sent) {
    if (sentence.seq < seq) heard += sentence.text
    else if (sentence.seq === seq) {
      const chars = [...sentence.text]
      const share = sentence.durationMs > 0 ? Math.min(1, Math.max(0, playedMs / sentence.durationMs)) : 0
      heard += chars.slice(0, Math.round(chars.length * share)).join('')
    }
  }
  return heard
}
