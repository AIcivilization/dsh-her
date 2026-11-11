/**
 * Voices from outside (docs/设置页与编排设计.md §7): 讯飞, any service that
 * speaks the OpenAI audio API (many clouds and local servers do), a
 * GPT-SoVITS server of your own, or another dsh plugin that registers one.
 * Each can also listen (讯飞 听写, OpenAI-style transcription). A voice of
 * these is `ext:<provider>:<voice>`; the providers are in
 * `<home>/voices.json`, their keys in Secrets. Her mouth and moves follow
 * only how long the audio is, so any of them works.
 */

import { createHmac } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'
import { decodeWav, wavFromPcm16 } from '../core/wav.ts'
import type { Secrets } from './secrets.ts'

export type ProviderKind = 'xfyun' | 'openai' | 'sovits' | 'plugin'
export const PROVIDER_KINDS: ProviderKind[] = ['xfyun', 'openai', 'sovits', 'plugin']

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  name: string
  /** openai, sovits: where it is (http…); xfyun: not used. */
  baseUrl?: string
  /** xfyun: its APPID (not secret). */
  appId?: string
  /** openai: the speech model (tts-1 …) and the transcription model (whisper-1 …). */
  model?: string
  asrModel?: string
  /** sovits: the reference clip on its server, what is said in it, its language. */
  refAudio?: string
  promptText?: string
  promptLang?: string
}

export interface VoicesConfig {
  providers: ProviderConfig[]
  /** Who listens: a provider id; none: the local recognition. */
  listen?: string
}

/** The keys each kind needs, kept in Secrets as `<provider>.<field>`. */
export const SECRET_FIELDS: Record<ProviderKind, string[]> = { xfyun: ['apiKey', 'apiSecret'], openai: ['apiKey'], sovits: [], plugin: [] }

/** A voice another plugin gives her, through the `herVoices` service. */
export interface PluginVoice {
  id: string
  name: string
  voices?: Array<{ id: string; name: string }>
  synthesize(text: string, options: { voice: string; speed: number }): Promise<{ audio: Uint8Array; format: 'wav' | 'mp3'; durationMs?: number }>
  recognize?(pcm16: Uint8Array, sampleRate: number): Promise<string>
}

export const isExtVoice = (id: string) => id.startsWith('ext:')
/** `ext:<provider>:<voice>` → its parts. */
export function parseExtVoice(id: string): { provider: string; voice: string } | undefined {
  const m = /^ext:([\w-]+):(.*)$/.exec(id)
  return m === null ? undefined : { provider: m[1]!, voice: m[2]! }
}

const cleanUrl = (v: unknown) => (typeof v === 'string' && /^https?:\/\/[^\s]+$/.test(v.trim()) ? v.trim().replace(/\/+$/, '') : undefined)
const cleanText = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : undefined)

export function cleanVoices(raw: unknown): VoicesConfig {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as { providers?: unknown; listen?: unknown }
  const providers: ProviderConfig[] = []
  for (const p of Array.isArray(v.providers) ? v.providers : []) {
    const r = p as Record<string, unknown>
    if (typeof r.id !== 'string' || !/^[\w-]{1,30}$/.test(r.id) || !PROVIDER_KINDS.includes(r.kind as ProviderKind) || providers.some(x => x.id === r.id)) continue
    const out: ProviderConfig = { id: r.id, kind: r.kind as ProviderKind, name: cleanText(r.name, 40) ?? r.id }
    const url = cleanUrl(r.baseUrl)
    if (url !== undefined) out.baseUrl = url
    for (const key of ['appId', 'model', 'asrModel', 'refAudio', 'promptText', 'promptLang'] as const) {
      const text = cleanText(r[key], key === 'promptText' || key === 'refAudio' ? 400 : 80)
      if (text !== undefined) out[key] = text
    }
    providers.push(out)
  }
  const listen = typeof v.listen === 'string' && providers.some(p => p.id === v.listen) ? v.listen : undefined
  return { providers, ...(listen === undefined ? {} : { listen }) }
}

/** 讯飞's signed address (its WebSocket APIs): HMAC-SHA256 of host, date and request line with the APISecret. */
export function xfyunUrl(host: string, path: string, apiKey: string, apiSecret: string, date = new Date().toUTCString()): string {
  const origin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`
  const signature = createHmac('sha256', apiSecret).update(origin).digest('base64')
  const authorization = Buffer.from(`api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`).toString('base64')
  return `wss://${host}${path}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${host}`
}

const wavMs = (wav: Uint8Array) => {
  const { samples, sampleRate } = decodeWav(wav)
  return Math.round(samples.length / sampleRate * 1000)
}

export interface Spoken {
  audio: Uint8Array
  durationMs: number
  format: 'wav' | 'mp3'
}

export class ExternalVoices {
  private readonly file: string
  private readonly secrets: Secrets
  private readonly plugins = new Map<string, PluginVoice>()

  constructor(home: string, secrets: Secrets) {
    this.file = join(home, 'voices.json')
    this.secrets = secrets
  }

  config(): VoicesConfig {
    try {
      return cleanVoices(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      return { providers: [] }
    }
  }

  save(config: VoicesConfig): VoicesConfig {
    const clean = cleanVoices(config)
    writeFileSync(this.file, `${JSON.stringify(clean, null, 2)}\n`)
    return clean
  }

  /** Another plugin's voice (the `herVoices` service); returns how to take it away. */
  register(voice: PluginVoice): () => void {
    if (!/^[\w-]{1,30}$/.test(voice.id)) throw new Error('voice id: letters, digits, - and _ only')
    this.plugins.set(voice.id, voice)
    return () => { if (this.plugins.get(voice.id) === voice) this.plugins.delete(voice.id) }
  }

  /** Every provider: configured ones, then those of plugins (as kind 'plugin'). */
  providers(): ProviderConfig[] {
    return [...this.config().providers.filter(p => p.kind !== 'plugin'), ...[...this.plugins.values()].map(p => ({ id: p.id, kind: 'plugin' as const, name: p.name }))]
  }

  pluginVoices(): Array<{ provider: string; voices: Array<{ id: string; name: string }> }> {
    return [...this.plugins.values()].map(p => ({ provider: p.id, voices: p.voices ?? [] }))
  }

  private provider(id: string): ProviderConfig {
    const found = this.providers().find(p => p.id === id)
    if (found === undefined) throw new Error(`没有这个语音服务：${id}`)
    return found
  }

  private async secret(provider: ProviderConfig, field: string): Promise<string> {
    const value = await this.secrets.get(`${provider.id}.${field}`)
    if (value === undefined) throw new Error(`${provider.name} 还没有填 ${field}`)
    return value
  }

  async synthesize(voiceId: string, text: string, speed: number): Promise<Spoken> {
    const parsed = parseExtVoice(voiceId)
    if (parsed === undefined) throw new Error(`不是外接的声音：${voiceId}`)
    const provider = this.provider(parsed.provider)
    switch (provider.kind) {
      case 'xfyun': return this.xfyunSpeak(provider, parsed.voice, text, speed)
      case 'openai': return this.openaiSpeak(provider, parsed.voice, text, speed)
      case 'sovits': return this.sovitsSpeak(provider, text, speed)
      case 'plugin': {
        const plugin = this.plugins.get(provider.id)
        if (plugin === undefined) throw new Error(`${provider.name} 那个插件没在运行`)
        const out = await plugin.synthesize(text, { voice: parsed.voice, speed })
        return { audio: out.audio, format: out.format, durationMs: out.durationMs ?? (out.format === 'wav' ? wavMs(out.audio) : Math.round(out.audio.byteLength / 6)) }
      }
    }
  }

  /** What you said, by the provider chosen to listen. */
  async recognize(pcm16: Uint8Array, sampleRate: number): Promise<string> {
    const id = this.config().listen
    if (id === undefined) throw new Error('没有选外接的识别')
    const provider = this.provider(id)
    if (provider.kind === 'xfyun') return this.xfyunListen(provider, pcm16, sampleRate)
    if (provider.kind === 'openai') return this.openaiListen(provider, pcm16, sampleRate)
    if (provider.kind === 'plugin') {
      const plugin = this.plugins.get(provider.id)
      if (plugin?.recognize === undefined) throw new Error(`${provider.name} 不会听`)
      return plugin.recognize(pcm16, sampleRate)
    }
    throw new Error(`${provider.name} 不会听`)
  }

  get listening(): string | undefined {
    return this.config().listen
  }

  private async xfyunSpeak(provider: ProviderConfig, voice: string, text: string, speed: number): Promise<Spoken> {
    if (provider.appId === undefined) throw new Error(`${provider.name} 还没有填 APPID`)
    const url = xfyunUrl('tts-api.xfyun.cn', '/v2/tts', await this.secret(provider, 'apiKey'), await this.secret(provider, 'apiSecret'))
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url)
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('讯飞没有回音（30 秒）')) }, 30_000)
      socket.on('open', () => socket.send(JSON.stringify({
        common: { app_id: provider.appId },
        business: { aue: 'raw', auf: 'audio/L16;rate=16000', vcn: voice || 'xiaoyan', speed: Math.max(0, Math.min(100, Math.round(50 * speed))), volume: 50, pitch: 50, tte: 'UTF8' },
        data: { status: 2, text: Buffer.from(text, 'utf8').toString('base64') },
      })))
      socket.on('message', raw => {
        const reply = JSON.parse(String(raw)) as { code: number; message?: string; data?: { audio?: string; status?: number } }
        if (reply.code !== 0) {
          clearTimeout(timer)
          socket.close()
          reject(new Error(`讯飞：${reply.message ?? reply.code}`))
          return
        }
        if (reply.data?.audio) chunks.push(Buffer.from(reply.data.audio, 'base64'))
        if (reply.data?.status === 2) {
          clearTimeout(timer)
          socket.close()
          resolve()
        }
      })
      socket.on('error', error => { clearTimeout(timer); reject(error) })
    })
    const pcm = new Uint8Array(Buffer.concat(chunks))
    return { audio: wavFromPcm16(pcm, 16000), durationMs: Math.round(pcm.byteLength / 32), format: 'wav' }
  }

  private async xfyunListen(provider: ProviderConfig, pcm16: Uint8Array, sampleRate: number): Promise<string> {
    if (provider.appId === undefined) throw new Error(`${provider.name} 还没有填 APPID`)
    if (sampleRate !== 16000) throw new Error('讯飞听写要 16k 的声音')
    const url = xfyunUrl('iat-api.xfyun.cn', '/v2/iat', await this.secret(provider, 'apiKey'), await this.secret(provider, 'apiSecret'))
    const words: string[] = []
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url)
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('讯飞听写没有回音')) }, 30_000)
      socket.on('open', () => {
        const FRAME = 1280
        for (let i = 0, n = 0; i < pcm16.byteLength || n === 0; i += FRAME, n++) {
          const audio = Buffer.from(pcm16.subarray(i, i + FRAME)).toString('base64')
          const data = { status: n === 0 ? 0 : 1, format: 'audio/L16;rate=16000', encoding: 'raw', audio }
          socket.send(JSON.stringify(n === 0 ? { common: { app_id: provider.appId }, business: { language: 'zh_cn', domain: 'iat', accent: 'mandarin', vad_eos: 3000 }, data } : { data }))
          if (i + FRAME >= pcm16.byteLength) break
        }
        socket.send(JSON.stringify({ data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' } }))
      })
      socket.on('message', raw => {
        const reply = JSON.parse(String(raw)) as { code: number; message?: string; data?: { status?: number; result?: { ws?: Array<{ cw?: Array<{ w?: string }> }> } } }
        if (reply.code !== 0) {
          clearTimeout(timer)
          socket.close()
          reject(new Error(`讯飞听写：${reply.message ?? reply.code}`))
          return
        }
        for (const w of reply.data?.result?.ws ?? []) words.push(w.cw?.[0]?.w ?? '')
        if (reply.data?.status === 2) {
          clearTimeout(timer)
          socket.close()
          resolve()
        }
      })
      socket.on('error', error => { clearTimeout(timer); reject(error) })
    })
    return words.join('').trim()
  }

  private async openaiSpeak(provider: ProviderConfig, voice: string, text: string, speed: number): Promise<Spoken> {
    if (provider.baseUrl === undefined) throw new Error(`${provider.name} 还没有填地址`)
    const key = await this.secrets.get(`${provider.id}.apiKey`)
    const res = await fetch(`${provider.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key === undefined ? {} : { authorization: `Bearer ${key}` }) },
      body: JSON.stringify({ model: provider.model ?? 'tts-1', input: text, voice: voice || 'alloy', response_format: 'wav', speed }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`${provider.name}：HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`)
    const audio = new Uint8Array(await res.arrayBuffer())
    return { audio, durationMs: wavMs(audio), format: 'wav' }
  }

  private async openaiListen(provider: ProviderConfig, pcm16: Uint8Array, sampleRate: number): Promise<string> {
    if (provider.baseUrl === undefined) throw new Error(`${provider.name} 还没有填地址`)
    const key = await this.secrets.get(`${provider.id}.apiKey`)
    const form = new FormData()
    form.append('file', new Blob([Buffer.from(wavFromPcm16(pcm16, sampleRate))], { type: 'audio/wav' }), 'speech.wav')
    form.append('model', provider.asrModel ?? 'whisper-1')
    form.append('language', 'zh')
    const res = await fetch(`${provider.baseUrl}/audio/transcriptions`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(60_000),
      ...(key === undefined ? {} : { headers: { authorization: `Bearer ${key}` } }),
    })
    if (!res.ok) throw new Error(`${provider.name}：HTTP ${res.status}`)
    return String(((await res.json()) as { text?: unknown }).text ?? '').trim()
  }

  private async sovitsSpeak(provider: ProviderConfig, text: string, speed: number): Promise<Spoken> {
    if (provider.baseUrl === undefined) throw new Error(`${provider.name} 还没有填地址`)
    const query = new URLSearchParams({ text, text_lang: 'zh', media_type: 'wav', speed_factor: String(speed), streaming_mode: 'false' })
    if (provider.refAudio !== undefined) query.set('ref_audio_path', provider.refAudio)
    if (provider.promptText !== undefined) query.set('prompt_text', provider.promptText)
    query.set('prompt_lang', provider.promptLang ?? 'zh')
    const res = await fetch(`${provider.baseUrl}/tts?${query}`, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`${provider.name}：HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`)
    const audio = new Uint8Array(await res.arrayBuffer())
    return { audio, durationMs: wavMs(audio), format: 'wav' }
  }
}
