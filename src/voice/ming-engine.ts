/**
 * What the local Ming voice (ming.ts) asks of the program that runs the
 * model. Two do: MLX in a Python process (Apple chips, ming-mlx.ts) and
 * audio.cpp's server (Mac, Windows, Linux; ming-audiocpp.ts).
 */

export interface MingRequest {
  text: string
  /** A built-in voice (灵风信_高兴 …), a recording to clone, or a description to design a voice from. */
  voice?: string
  ref?: { wav: string; text: string }
  design?: string
  emotion?: string
  speed?: string
  /** Flow-matching steps (MLX only; audio.cpp always takes 10). */
  steps: number
  seed?: number
}

export interface MingAudio {
  /** WAV, 16-bit mono. */
  audio: Uint8Array
  durationMs: number
  ms: number
}

/** Progress while installing: what is being done, and bytes so far. */
export type MingStep = (text: string, extra?: { done?: number; total?: number }) => void

export type Logger = { info(message: string): void; warn(message: string): void }

export interface MingEngine {
  readonly kind: 'mlx' | 'audiocpp'
  readonly installed: boolean
  /** Its process is up (it may still be loading). */
  readonly running: boolean
  install(step: MingStep): Promise<void>
  /** Start the process and load the model; `onExit` when it then dies by itself. Resolves with the loading time. */
  start(onExit: (why: string) => void): Promise<number>
  speak(request: MingRequest, timeoutMs: number): Promise<MingAudio>
  /** Stop the process; sentences waiting on it fail. */
  stop(): void
}

/** A sentence took too long: the process is stuck, not just this sentence. */
export class MingTimeout extends Error {
  constructor() {
    super('本机 Ming 太久没有回应')
  }
}
