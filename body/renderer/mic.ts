/**
 * The microphone: capture at 16 kHz with the browser's echo cancellation and
 * noise suppression, speech detection (vad.ts), and two ways of listening:
 *
 * - once: the talk shortcut listens for one utterance, then the microphone
 *   closes (and the OS indicator goes off); no speech within 8 s closes it too.
 * - always: open until switched off.
 *
 * `paused` ignores everything heard (she is talking and you are not allowed
 * to cut in, see the barge-in fallback in main.ts).
 */

import { EnergyVad, SAMPLE_RATE } from './vad.ts'

const ONCE_TIMEOUT_MS = 8000

export interface MicEvents {
  /** Listening started or stopped (for the indicator). */
  listening(on: boolean): void
  speechStart(): void
  utterance(samples: Float32Array): void
  /** Speech started but was too short; or a "once" listen heard nothing. */
  nothing(): void
}

export class Mic {
  private stream: MediaStream | undefined
  private ctx: AudioContext | undefined
  private node: AudioWorkletNode | undefined
  private mode: 'off' | 'once' | 'always' = 'off'
  private onceTimer: number | undefined
  paused = false
  private readonly vad: EnergyVad
  private readonly events: MicEvents

  constructor(events: MicEvents) {
    this.events = events
    this.vad = new EnergyVad({
      start: () => {
        window.clearTimeout(this.onceTimer)
        this.events.speechStart()
      },
      utterance: samples => {
        this.events.utterance(samples)
        if (this.mode === 'once') this.close()
      },
      dropped: () => {
        this.events.nothing()
        if (this.mode === 'once') this.close()
      },
    })
  }

  get listening(): boolean {
    return this.mode !== 'off'
  }

  async listenOnce(): Promise<void> {
    if (this.mode === 'always') return
    await this.open('once')
    window.clearTimeout(this.onceTimer)
    this.onceTimer = window.setTimeout(() => {
      if (this.mode === 'once' && !this.vad.inSpeech) {
        this.close()
        this.events.nothing()
      }
    }, ONCE_TIMEOUT_MS)
  }

  async setAlways(on: boolean): Promise<void> {
    if (on) await this.open('always')
    else if (this.mode === 'always') this.close()
  }

  private async open(mode: 'once' | 'always'): Promise<void> {
    this.mode = mode
    if (this.stream === undefined) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
      await this.ctx.audioWorklet.addModule('mic-worklet.js')
      const source = this.ctx.createMediaStreamSource(this.stream)
      this.node = new AudioWorkletNode(this.ctx, 'her-capture')
      this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (this.mode !== 'off' && !this.paused) this.vad.push(event.data)
      }
      source.connect(this.node)
    }
    this.vad.reset()
    this.events.listening(true)
  }

  private close(): void {
    this.mode = 'off'
    window.clearTimeout(this.onceTimer)
    this.vad.reset()
    this.node?.disconnect()
    this.node = undefined
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = undefined
    void this.ctx?.close()
    this.ctx = undefined
    this.events.listening(false)
  }
}
