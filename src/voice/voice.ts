/**
 * Her voice for the brain.
 *
 * - Listening: local speech recognition (sherpa-onnx SenseVoice in a child
 *   process, engine.ts). Its model is downloaded in the background on first
 *   use; until then she only reads what you type.
 * - Speaking: the service of the voice she uses (core/voices.ts): Microsoft
 *   Edge voices through the edge-tts tool (edge.ts, the default), or Alibaba
 *   Cloud Model Studio CosyVoice (cosyvoice.ts). When the service cannot
 *   speak (tool not installed yet, no key, no quota, offline), a sentence goes
 *   out without audio and shows as text; a key added later is picked up
 *   without restarting.
 * - Cache: short sentences ("嗯。" "好呀。") are kept, so the most common
 *   answers start at once.
 */

import { serviceOf, VOICE_MODEL, type VoiceService } from '../core/index.ts'
import { LocalVoice } from './engine.ts'
import { CloudAccountError, CosyVoice } from './cosyvoice.ts'
import { EdgeVoice } from './edge.ts'
import { readCloudKey } from './cloud-key.ts'
import { fetchModel, missingModels, modelPath, MODELS } from './models.ts'
import type { Synthesized } from './speech-queue.ts'

export interface VoiceConfig {
  /** false: she only writes (text only). */
  enabled: boolean
  /** Voice id (src/core/voices.ts); its service speaks. */
  voice: string
  speed: number
  /** CPU threads for local speech recognition. */
  threads: number
}

const CACHE_MAX_CHARS = 8
const CACHE_ENTRIES = 64
/** After "no key" or "no quota", try the cloud again at most this often (a key added later is picked up). */
const KEY_RECHECK_MS = 30_000

/** Listening (local recognition). */
export type VoiceStatus = 'off' | 'downloading' | 'loading' | 'ready' | 'failed'
/** Speaking, with the service of her current voice. */
export type SpeakingStatus = 'off' | 'checking' | 'installing' | 'ready' | 'no-key' | 'no-quota' | 'failed'

type Logger = { info(message: string): void; warn(message: string): void }

export class Voice {
  private asr: LocalVoice | undefined
  private listening: VoiceStatus = 'loading'
  private speakingState: SpeakingStatus
  private speakingError: string | undefined
  private keyCheckedAt = 0
  private readonly cloud: CosyVoice
  private readonly edge: EdgeVoice
  private readonly cache = new Map<string, Synthesized>()
  private readonly modelsDir: string
  private config: VoiceConfig
  private readonly logger: Logger

  /** `edgeDir`: where dsh-her installs its own edge-tts if none is found. */
  constructor(modelsDir: string, edgeDir: string, config: VoiceConfig, logger: Logger) {
    this.modelsDir = modelsDir
    this.config = config
    this.logger = logger
    this.speakingState = config.enabled ? 'checking' : 'off'
    this.cloud = new CosyVoice(VOICE_MODEL, readCloudKey)
    this.edge = new EdgeVoice(edgeDir)
  }

  /** Listening. */
  get status(): VoiceStatus {
    return this.listening
  }

  get speaking(): { status: SpeakingStatus; service: VoiceService; error?: string } {
    const service = serviceOf(this.config.voice)
    return this.speakingError === undefined ? { status: this.speakingState, service } : { status: this.speakingState, service, error: this.speakingError }
  }

  /** Check the cloud voice and get recognition ready. Never throws; the statuses say how it went. */
  async start(): Promise<void> {
    if (this.config.enabled) void this.speak('嗯。').catch(() => undefined)
    try {
      const missing = missingModels(this.modelsDir)
      if (missing.length > 0) {
        this.listening = 'downloading'
        this.logger.info(`dsh-her: downloading speech recognition models (${missing.map(m => m.id).join(', ')}) into ${this.modelsDir}`)
        for (const spec of missing) await fetchModel(this.modelsDir, spec)
      }
      this.listening = 'loading'
      this.asr = new LocalVoice({ asrDir: modelPath(this.modelsDir, MODELS.find(m => m.id === 'asr')!), threads: this.config.threads })
      const { loadMs } = await this.asr.start()
      this.listening = 'ready'
      this.logger.info(`dsh-her: speech recognition ready (${loadMs} ms)`)
    } catch (error) {
      this.listening = 'failed'
      this.logger.warn(`dsh-her: speech recognition unavailable, typing only (${(error as Error).message})`)
    }
  }

  /** You started talking: open the cloud connection now, while your words are recognized. */
  warm(): void {
    if (serviceOf(this.config.voice) === 'cosyvoice' && (this.speakingState === 'ready' || this.speakingState === 'failed')) this.cloud.warm()
  }

  /** Change her voice and speed (from the "她" page); takes effect with the next sentence. */
  setVoice(voice: string, speed: number): void {
    const switched = serviceOf(voice) !== serviceOf(this.config.voice)
    this.config = { ...this.config, voice, speed }
    if (switched && this.config.enabled) {
      // A new service: what was true of the old one (no key …) says nothing about it.
      this.mark('checking')
      void this.speak('嗯。').catch(() => undefined)
    }
  }

  /** One sentence in a given voice, for trying voices; not cached. Throws with a message for the page. */
  async preview(text: string, voice: string, speed: number): Promise<Synthesized> {
    if (!this.config.enabled) throw new Error('她的声音已关闭（插件设置里 voice.enabled 是 false）')
    return this.speak(text, voice, speed)
  }

  /** Her sentence as audio, or undefined when she cannot speak right now (it shows as text). */
  async synthesize(text: string): Promise<Synthesized | undefined> {
    if (!this.config.enabled || text === '') return undefined
    if ((this.speakingState === 'no-key' || this.speakingState === 'no-quota') && Date.now() - this.keyCheckedAt < KEY_RECHECK_MS) return undefined
    const key = `${this.config.voice}|${this.config.speed}|${text}`
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached
    try {
      const result = await this.speak(text)
      if ([...text].length <= CACHE_MAX_CHARS) {
        this.cache.set(key, result)
        if (this.cache.size > CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!)
      }
      return result
    } catch {
      return undefined
    }
  }

  /** What you said, from 16-bit mono PCM. Empty when nothing was understood. */
  async recognize(pcm16: Uint8Array, sampleRate: number): Promise<{ text: string; ms: number }> {
    if (this.listening !== 'ready' || this.asr === undefined) throw new Error('语音识别还没准备好')
    const view = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
    const samples = new Float32Array(Math.floor(pcm16.byteLength / 2))
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 0x8000
    const heard = await this.asr.recognize(samples, sampleRate)
    return { text: heard.text, ms: heard.ms }
  }

  stop(): void {
    this.asr?.stop()
    this.asr = undefined
    this.cloud.close()
    if (this.listening !== 'off') this.listening = 'failed'
  }

  private async speak(text: string, voice = this.config.voice, speed = this.config.speed): Promise<Synthesized> {
    try {
      if (serviceOf(voice) === 'edge') {
        if (this.edge.status.status !== 'ready') this.mark('installing')
        const audio = await this.edge.synthesize(text, voice, speed)
        this.mark('ready')
        return { audio: audio.audio, durationMs: audio.durationMs, format: 'mp3' }
      }
      const audio = await this.cloud.synthesize(text, voice, speed)
      this.mark('ready')
      return { audio: audio.audio, durationMs: audio.durationMs, format: 'wav' }
    } catch (error) {
      this.mark(error instanceof CloudAccountError ? (error.reason === 'quota' ? 'no-quota' : 'no-key') : 'failed', (error as Error).message)
      throw error
    }
  }

  private mark(status: SpeakingStatus, error?: string): void {
    if (status === 'no-key' || status === 'no-quota') this.keyCheckedAt = Date.now()
    if (status !== this.speakingState) {
      const service = serviceOf(this.config.voice)
      if (status === 'ready') this.logger.info(`dsh-her: voice ready (${service})`)
      else if (status !== 'checking' && status !== 'installing') this.logger.warn(`dsh-her: voice ${status} (${service})${error === undefined ? '' : `: ${error}`}; replies show as text`)
    }
    this.speakingState = status
    this.speakingError = error
  }
}
