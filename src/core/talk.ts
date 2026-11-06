/**
 * Her conversations (docs/对话入口设计.md): when a new one starts by itself,
 * and the last few lines the talk bar shows. Pure.
 */

export interface SplitSettings {
  /** A new conversation after this many hours without a word; null: never. */
  idleHours: number | null
  /** A new conversation once the current one is this big (tokens of her last request); null: never. */
  maxTokens: number | null
  /** A new conversation on the first words of each day. */
  daily: boolean
}

export const DEFAULT_SPLIT: SplitSettings = { idleHours: null, maxTokens: null, daily: false }

export const IDLE_CHOICES = [2, 6, 12, 24] as const
export const SIZE_CHOICES = [30_000, 60_000, 100_000] as const

export function cleanSplit(value: unknown): SplitSettings {
  const saved = (typeof value === 'object' && value !== null ? value : {}) as Partial<SplitSettings>
  const positive = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : null)
  return { idleHours: positive(saved.idleHours, 24 * 30), maxTokens: positive(saved.maxTokens, 2_000_000), daily: saved.daily === true }
}

/** Why what you say now should start a new conversation; undefined: go on with this one. */
export function splitReason(settings: SplitSettings, state: { lastAt: number; tokens: number; now: Date; dayOf: (date: Date) => string }): string | undefined {
  const { lastAt, tokens, now } = state
  // Nothing said yet in it: there is nothing to split from.
  if (lastAt === 0) return undefined
  if (settings.daily && state.dayOf(new Date(lastAt)) !== state.dayOf(now)) return '新的一天'
  if (settings.idleHours !== null && now.getTime() - lastAt >= settings.idleHours * 3_600_000) return `隔了 ${settings.idleHours} 小时以上`
  if (settings.maxTokens !== null && tokens >= settings.maxTokens) return '这一段已经很长了'
  return undefined
}

export interface TalkLine {
  who: 'you' | 'her'
  text: string
  time: number
}

/** The last `count` lines, from her session and what she said by herself, in order. */
export function lastLines(session: TalkLine[], own: TalkLine[], count: number): TalkLine[] {
  return [...session, ...own].sort((a, b) => a.time - b.time).slice(-count)
}

/** "约 3.2 万字" for a token count (a Chinese character is roughly one). */
export function sizeText(tokens: number): string {
  if (tokens < 10_000) return `约 ${Math.max(1, Math.round(tokens / 1000))} 千字`
  return `约 ${(tokens / 10_000).toFixed(tokens < 100_000 ? 1 : 0)} 万字`
}
