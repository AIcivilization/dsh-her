/**
 * Turns her replies into audio sentence by sentence, in order.
 *
 * Synthesis is serial: one sentence at a time across all replies, so the
 * first sentence of a reply is never queued behind a later one. Each result
 * is emitted as soon as it is ready (the body queues playback), and a reply's
 * end is emitted after its last sentence. Cancelling a reply drops what has
 * not been synthesized yet and suppresses anything still in flight.
 *
 * A sentence whose synthesis fails is still emitted, without audio, so the
 * subtitle shows and the reply goes on.
 */

import type { Cue } from '../protocol/index.ts'

export interface Synthesized {
  audio: Uint8Array
  durationMs: number
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

type Job = { uid: string; kind: 'sentence'; seq: number; text: string; cues: Cue[] } | { uid: string; kind: 'end' }

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

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (let job = this.jobs.shift(); job !== undefined; job = this.jobs.shift()) {
        if (job.kind === 'end') {
          this.out.end(job.uid)
          continue
        }
        let audio: Synthesized | undefined
        try {
          audio = await this.synth(job.text)
        } catch {
          audio = undefined
        }
        if (this.cancelled.has(job.uid)) continue
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
