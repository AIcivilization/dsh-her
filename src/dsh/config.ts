import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_MIRRORS } from '../net.ts'
import { DEFAULT_VOICE, SAMPLE_PERSONA } from '../core/index.ts'
import type { VoiceConfig } from '../voice/voice.ts'

export interface HerConfig {
  /** Where dsh-her keeps characters, packs, models and the discovery file, outside DSH. `~` expands. */
  home: string
  character: {
    /** Stable id; her session and memory are keyed by it. */
    id: string
    name: string
    persona: string
  }
  /** Model route for her session; both empty = DSH's current default model. A fast, non-reasoning model keeps her quick to answer. */
  provider: string
  model: string
  /** Reasoning effort for her model route; empty = the route's default. Lower answers sooner. */
  reasoningEffort: string
  /** Preferred port of the body protocol server (the next free one is used if taken). */
  port: number
  body: {
    /** auto: start the body app when DSH starts and no body is connected; off: never. */
    launch: 'auto' | 'off'
    /** Appearance pack directory passed to the body; empty = the body's default. */
    pack: string
    /** Where the body app is downloaded from: the release's address, ending with the folder that has body-latest.json. */
    releases: string
    /** Start the development body in the repository when there is one (off: behave like a release install). */
    useDev: boolean
    /** Prefixes put before a GitHub address when GitHub cannot be reached (net.ts); every file through them is checked. */
    mirrors: string[]
  }
  voice: VoiceConfig & {
    /** How the body listens: one utterance per shortcut press, or all the time. */
    mic: 'push-to-talk' | 'always'
  }
}

export const Config: Schema<HerConfig> = Schema.object({
  home: Schema.string().default('~/.dsh-her').description('dsh-her home (characters, packs, voice models)'),
  character: Schema.object({
    id: Schema.string().default('sample').description('Character id (her session and memory are keyed by it)'),
    name: Schema.string().default('小禾').description('Her name'),
    persona: Schema.string().role('textarea').default(SAMPLE_PERSONA).description('Who she is and how she talks'),
  }).default({}),
  provider: Schema.string().default('').description('Model provider for her session (empty = DSH default)'),
  model: Schema.string().default('').description('Model for her session (empty = DSH default)'),
  reasoningEffort: Schema.string().default('').description('Reasoning effort for her model (empty = route default; lower answers sooner)'),
  port: Schema.natural().max(65535).default(38100).description('Preferred port for the body (next free one if taken)'),
  body: Schema.object({
    launch: Schema.union(['auto', 'off']).default('auto').description('Start the body app with DSH'),
    pack: Schema.string().default('').description('Appearance pack directory (empty = body default)'),
    releases: Schema.string().default('https://github.com/AIcivilization/dsh-her/releases/latest/download/').description('Where the body app is downloaded from (the folder with body-latest.json)'),
    useDev: Schema.boolean().default(true).description('Use the development body in the repository when there is one (off: like a release install)'),
    mirrors: Schema.array(String).default([...DEFAULT_MIRRORS]).description('GitHub mirrors tried when github.com cannot be reached (body, voice models, Ming); files are checked by size and SHA-256. Empty: GitHub only'),
  }).default({}),
  voice: Schema.object({
    enabled: Schema.boolean().default(true).description('Her voice; off = she only writes'),
    voice: Schema.string().default(DEFAULT_VOICE).description('Her first voice: a Microsoft Edge voice (free, via edge-tts) or an Alibaba Cloud CosyVoice voice (key in DASHSCOPE_API_KEY or the macOS keychain); the "她" page can change it'),
    speed: Schema.number().min(0.5).max(2).default(1).description('Speaking speed'),
    threads: Schema.natural().min(1).max(16).default(4).description('CPU threads for local speech recognition'),
    mic: Schema.union(['push-to-talk', 'always']).default('push-to-talk').description('Microphone: one utterance per shortcut press, or always listening'),
  }).default({}),
}) as Schema<HerConfig>
