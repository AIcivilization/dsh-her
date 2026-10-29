/**
 * Her local voice for the brain: sherpa-onnx in a child process (engine.ts),
 * plus what the plugin needs around it.
 *
 * - Models: if any are missing they are downloaded in the background; until
 *   then she has no voice and replies show as text only.
 * - Prewarm: one short synthesis at start, so her first real sentence does
 *   not pay for loading.
 * - Cache: short sentences ("嗯。" "好呀。") are kept, so the most common
 *   answers start at once.
 */

import { encodeWav } from '../core/index.ts'
import { LocalVoice } from './engine.ts'
import { fetchModel, missingModels, modelPath, MODELS } from './models.ts'
import type { Synthesized } from './speech-queue.ts'

export interface VoiceConfig {
  engine: 'local' | 'off'
  /** Kokoro speaker id (0–102). */
  sid: number
  speed: number
  threads: number
}

const CACHE_MAX_CHARS = 8
const CACHE_ENTRIES = 64

export type VoiceStatus = 'off' | 'downloading' | 'loading' | 'ready' | 'failed'

export class Voice {
  private engine: LocalVoice | undefined
  private state: VoiceStatus
  private readonly cache = new Map<string, Synthesized>()
  private readonly modelsDir: string
  private config: VoiceConfig
  private readonly logger: { info(message: string): void; warn(message: string): void }

  constructor(modelsDir: string, config: VoiceConfig, logger: { info(message: string): void; warn(message: string): void }) {
    this.modelsDir = modelsDir
    this.config = config
    this.logger = logger
    this.state = config.engine === 'off' ? 'off' : 'loading'
  }

  get status(): VoiceStatus {
    return this.state
  }

  /** Get the models, start the child, warm it up. Never throws; the status says how it went. */
  async start(): Promise<void> {
    if (this.config.engine === 'off') return
    try {
      const missing = missingModels(this.modelsDir)
      if (missing.length > 0) {
        this.state = 'downloading'
        this.logger.info(`dsh-her: downloading voice models (${missing.map(m => m.id).join(', ')}) into ${this.modelsDir}`)
        for (const spec of missing) await fetchModel(this.modelsDir, spec)
      }
      this.state = 'loading'
      this.engine = new LocalVoice({
        asrDir: modelPath(this.modelsDir, MODELS.find(m => m.id === 'asr')!),
        ttsDir: modelPath(this.modelsDir, MODELS.find(m => m.id === 'tts')!),
        threads: this.config.threads,
      })
      const { loadMs } = await this.engine.start()
      const warm = await this.engine.synthesize('嗯。', this.config.sid, this.config.speed)
      this.state = 'ready'
      this.logger.info(`dsh-her: voice ready (models ${loadMs} ms, warm-up ${warm.ms} ms)`)
    } catch (error) {
      this.state = 'failed'
      this.logger.warn(`dsh-her: voice unavailable, text only (${(error as Error).message})`)
    }
  }

  /** Change her speaker and speed (from the "她" page); takes effect with the next sentence. */
  setVoice(sid: number, speed: number): void {
    if (sid === this.config.sid && speed === this.config.speed) return
    this.config = { ...this.config, sid, speed }
  }

  get sid(): number {
    return this.config.sid
  }

  /** One sentence in a given voice, for trying voices; not cached. */
  async preview(text: string, sid: number, speed: number): Promise<Synthesized | undefined> {
    if (this.state !== 'ready' || this.engine === undefined) return undefined
    const audio = await this.engine.synthesize(text, sid, speed)
    return { audio: encodeWav(audio.samples, audio.sampleRate), durationMs: Math.round((audio.samples.length / audio.sampleRate) * 1000) }
  }

  /** Her sentence as WAV, or undefined when she has no voice right now. */
  async synthesize(text: string): Promise<Synthesized | undefined> {
    if (this.state !== 'ready' || this.engine === undefined || text === '') return undefined
    const key = `${this.config.sid}|${this.config.speed}|${text}`
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached
    const audio = await this.engine.synthesize(text, this.config.sid, this.config.speed)
    const result = { audio: encodeWav(audio.samples, audio.sampleRate), durationMs: Math.round((audio.samples.length / audio.sampleRate) * 1000) }
    if ([...text].length <= CACHE_MAX_CHARS) {
      this.cache.set(key, result)
      if (this.cache.size > CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!)
    }
    return result
  }

  /** What you said, from 16-bit mono PCM. Empty when nothing was understood. */
  async recognize(pcm16: Uint8Array, sampleRate: number): Promise<{ text: string; ms: number }> {
    if (this.state !== 'ready' || this.engine === undefined) throw new Error('语音识别还没准备好')
    const view = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
    const samples = new Float32Array(Math.floor(pcm16.byteLength / 2))
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 0x8000
    const heard = await this.engine.recognize(samples, sampleRate)
    return { text: heard.text, ms: heard.ms }
  }

  stop(): void {
    this.engine?.stop()
    this.engine = undefined
    if (this.state !== 'off') this.state = 'failed'
  }
}
