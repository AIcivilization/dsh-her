/**
 * Plays her reply sentence by sentence: each `speak.seg` is queued and played
 * in order, and its subtitle shows when its audio starts (not when it
 * arrives), so text and voice stay together. A sentence without audio is held
 * for its reading time instead.
 *
 * `cut()` stops at once and says where: which sentence, and how far into it,
 * so the brain can tell her what you actually heard.
 *
 * One sentence at a time, decoding included: while a sentence's audio is
 * being decoded nothing else starts and the reply does not end (issue #1: a
 * short line's `end` arriving mid-decode ended the reply and its audio was
 * thrown away; a second sentence arriving mid-decode played over the first).
 */

import type { Cue } from '../../src/protocol/index.ts'

export interface SpeechSegment {
  seq: number
  text: string
  durationMs: number
  audio?: Uint8Array
  cues?: Cue[]
}

export interface SpeechEvents {
  /** A sentence starts playing: show it, and act out its cues. */
  sentence(uid: string, seq: number, text: string, durationMs: number, cues: Cue[]): void
  progress(uid: string, seq: number, phase: 'start' | 'end'): void
  /** The reply has been said to the end. */
  done(uid: string): void
}

interface Playing {
  seq: number
  startedAt: number
  durationMs: number
  source?: AudioBufferSourceNode
  timer?: number
}

export class SpeechPlayer {
  private readonly ctx = new AudioContext()
  private readonly gain: GainNode
  private uid: string | undefined
  private queue: SpeechSegment[] = []
  private ended = false
  private playing: Playing | undefined
  /** A sentence taken from the queue and being made ready (decoded); cleared by stop(), so a late decode knows it was cut off. */
  private starting: { seq: number } | undefined
  private readonly events: SpeechEvents

  constructor(events: SpeechEvents, muted: boolean) {
    this.events = events
    this.gain = this.ctx.createGain()
    this.gain.gain.value = muted ? 0 : 1
    this.gain.connect(this.ctx.destination)
  }

  /** Is she saying something (or about to)? */
  get speaking(): boolean {
    return this.playing !== undefined || this.starting !== undefined || this.queue.length > 0
  }

  /** The reply being played, if any. */
  get replyId(): string | undefined {
    return this.uid
  }

  begin(uid: string): void {
    this.stop()
    this.uid = uid
    this.ended = false
  }

  seg(uid: string, segment: SpeechSegment): void {
    if (uid !== this.uid) return
    this.queue.push(segment)
    if (this.playing === undefined && this.starting === undefined) void this.next()
  }

  end(uid: string): void {
    if (uid !== this.uid) return
    this.ended = true
    if (this.playing === undefined && this.starting === undefined && this.queue.length === 0) this.finish()
  }

  cancel(uid: string): void {
    if (uid === this.uid) this.stop()
  }

  /** Stop now; where she was cut off, if she was talking. */
  cut(): { uid: string; seq: number; playedMs: number } | undefined {
    const uid = this.uid
    const playing = this.playing
    const nextSeq = this.starting?.seq ?? this.queue[0]?.seq
    this.stop()
    if (uid === undefined) return undefined
    if (playing !== undefined) return { uid, seq: playing.seq, playedMs: Math.round(performance.now() - playing.startedAt) }
    if (nextSeq !== undefined) return { uid, seq: nextSeq, playedMs: 0 }
    return undefined
  }

  private stop(): void {
    const playing = this.playing
    this.playing = undefined
    this.starting = undefined
    this.queue = []
    if (playing?.timer !== undefined) window.clearTimeout(playing.timer)
    if (playing?.source !== undefined) {
      playing.source.onended = null
      try {
        playing.source.stop()
      } catch {
        // already stopped
      }
    }
    this.uid = undefined
  }

  private async next(): Promise<void> {
    if (this.starting !== undefined) return
    const uid = this.uid
    const segment = this.queue.shift()
    if (uid === undefined) return
    if (segment === undefined) {
      if (this.ended) this.finish()
      return
    }
    const token = { seq: segment.seq }
    this.starting = token
    let buffer: AudioBuffer | undefined
    if (segment.audio !== undefined) {
      const bytes = segment.audio
      try {
        if (this.ctx.state === 'suspended') await this.ctx.resume()
        buffer = await this.ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      } catch {
        buffer = undefined
      }
    }
    // Cut off while decoding (stop() cleared the mark; a new reply may have begun).
    if (this.starting !== token || uid !== this.uid) return
    this.starting = undefined
    const playing: Playing = { seq: segment.seq, startedAt: performance.now(), durationMs: buffer === undefined ? segment.durationMs : buffer.duration * 1000 }
    this.playing = playing
    const done = () => {
      if (this.playing !== playing) return
      this.playing = undefined
      this.events.progress(uid, segment.seq, 'end')
      void this.next()
    }
    if (buffer !== undefined) {
      const source = this.ctx.createBufferSource()
      source.buffer = buffer
      source.connect(this.gain)
      source.onended = done
      playing.source = source
      source.start()
    } else {
      playing.timer = window.setTimeout(done, segment.durationMs)
    }
    this.events.sentence(uid, segment.seq, segment.text, playing.durationMs, segment.cues ?? [])
    this.events.progress(uid, segment.seq, 'start')
  }

  private finish(): void {
    const uid = this.uid
    this.uid = undefined
    if (uid !== undefined) this.events.done(uid)
  }
}
