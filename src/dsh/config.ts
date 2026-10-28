import Schema from '@deepseek-ai/schemastery'
import { SAMPLE_PERSONA } from '../core/index.ts'

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
}) as Schema<HerConfig>
