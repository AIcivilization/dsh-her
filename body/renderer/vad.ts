/**
 * Energy-based speech detection on 16 kHz mono audio, in 20 ms frames.
 *
 * The noise floor follows the room while nobody is talking. Speech starts when
 * the level stays above 3.5× the floor (and an absolute minimum) for 120 ms;
 * the 300 ms before that are kept, so the first syllable is not lost. It ends
 * after 700 ms below 2× the floor; an utterance shorter than 300 ms of speech
 * is noise and dropped. No DOM here, so it can be tested in Node.
 *
 * M2 uses this; silero VAD (already downloaded for the brain) can replace it
 * if echo or noise makes it trigger falsely too often.
 */

export const SAMPLE_RATE = 16_000
export const FRAME = 320
const START_FRAMES = 6
const END_FRAMES = 35
const PREROLL_FRAMES = 15
const MIN_SPEECH_FRAMES = 15
const MAX_FRAMES = 30 * 50
const MIN_START_LEVEL = 0.012
const MIN_END_LEVEL = 0.008

export interface VadEvents {
  start(): void
  /** A whole utterance, trailing silence trimmed to 200 ms. */
  utterance(samples: Float32Array): void
  /** Speech started but was too short to be an utterance. */
  dropped(): void
}

export class EnergyVad {
  private floor = 0.004
  private pending = new Float32Array(FRAME)
  private filled = 0
  private preroll: Float32Array[] = []
  private speech: Float32Array[] | undefined
  private above = 0
  private silent = 0
  private readonly events: VadEvents

  constructor(events: VadEvents) {
    this.events = events
  }

  get inSpeech(): boolean {
    return this.speech !== undefined
  }

  /** Forget any speech in progress (listening was turned off). */
  reset(): void {
    this.speech = undefined
    this.preroll = []
    this.above = 0
    this.silent = 0
    this.filled = 0
  }

  push(block: Float32Array): void {
    let offset = 0
    while (offset < block.length) {
      const take = Math.min(FRAME - this.filled, block.length - offset)
      this.pending.set(block.subarray(offset, offset + take), this.filled)
      this.filled += take
      offset += take
      if (this.filled === FRAME) {
        this.frame(this.pending)
        this.pending = new Float32Array(FRAME)
        this.filled = 0
      }
    }
  }

  private frame(frame: Float32Array): void {
    let sum = 0
    for (const s of frame) sum += s * s
    const level = Math.sqrt(sum / frame.length)
    if (this.speech === undefined) {
      if (level < this.floor * 3) this.floor = this.floor * 0.95 + level * 0.05
      this.preroll.push(frame)
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift()
      this.above = level > Math.max(this.floor * 3.5, MIN_START_LEVEL) ? this.above + 1 : 0
      if (this.above >= START_FRAMES) {
        this.speech = [...this.preroll]
        this.preroll = []
        this.silent = 0
        this.events.start()
      }
      return
    }
    this.speech.push(frame)
    this.silent = level < Math.max(this.floor * 2, MIN_END_LEVEL) ? this.silent + 1 : 0
    if (this.silent >= END_FRAMES || this.speech.length >= MAX_FRAMES) this.finish()
  }

  private finish(): void {
    const frames = this.speech!
    this.speech = undefined
    this.above = 0
    // Keep 200 ms of the trailing silence.
    const kept = frames.slice(0, frames.length - Math.max(0, this.silent - 10))
    this.silent = 0
    if (kept.length - PREROLL_FRAMES < MIN_SPEECH_FRAMES) {
      this.events.dropped()
      return
    }
    const samples = new Float32Array(kept.length * FRAME)
    kept.forEach((frame, i) => samples.set(frame, i * FRAME))
    this.events.utterance(samples)
  }
}

/** Float samples to 16-bit little-endian PCM. */
export function toPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
