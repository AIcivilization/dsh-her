/**
 * Whether she speaks first, and what about (docs/主动与触摸设计.md). Pure: the
 * clock, the presence and her record all come in as values.
 *
 * Every gate has a reason in plain words, shown on the "她" page, so "why is she
 * quiet" never needs a log. She backs off by herself: each opening you did not
 * answer doubles the wait, and after three she stops until you say something.
 */

export type PresenceState = 'active' | 'idle' | 'away'

export interface InitiativeSettings {
  on: boolean
  /** At most this many openings a day. */
  perDay: number
  /** Her quiet hours, minutes from midnight; may run past midnight. */
  quietFrom: number
  quietTo: number
}

export const DEFAULT_INITIATIVE: InitiativeSettings = { on: true, perDay: 3, quietFrom: 23 * 60 + 30, quietTo: 8 * 60 + 30 }

/** What she keeps between restarts. */
export interface InitiativeRecord {
  /** The day `count` is about. */
  day: string
  count: number
  /** When she last spoke first. */
  lastAt: number
  /** Openings in a row you did not answer. */
  unanswered: number
  /** What she said lately, so she does not repeat herself. */
  recent: string[]
  /** Dated events she has already brought up. */
  raised: string[]
  /** When you last talked (or touched her). */
  lastTalkAt: number
  /** When she may next speak just to keep you company. */
  nextCompanyAt: number
  /** After a failed try (no key, no network), nothing before this. */
  retryAt: number
  /** No openings until then; -1: until turned off. */
  focusUntil: number
}

export const EMPTY_RECORD: InitiativeRecord = { day: '', count: 0, lastAt: 0, unanswered: 0, recent: [], raised: [], lastTalkAt: 0, nextCompanyAt: 0, retryAt: 0, focusUntil: 0 }

export type Moment =
  | { kind: 'due'; id: string; text: string; due: string }
  | { kind: 'hello' }
  | { kind: 'back'; awayMinutes: number }
  | { kind: 'company' }

export interface InitiativeInput {
  settings: InitiativeSettings
  record: InitiativeRecord
  now: Date
  dayOf: (date: Date) => string
  /** She has been set up (the wizard is done). */
  ready: boolean
  /** A body is here to say it. */
  bodyHere: boolean
  /** She is switched off (the button on her page, or the body's menu). */
  off?: boolean
  /** undefined: no body has said lately whether you are there. */
  presence: PresenceState | undefined
  /** She is talking or thinking right now. */
  busy: boolean
  /** You came back to the computer just now, after being away. */
  returned?: { awayMinutes: number }
  due: Array<{ id: string; text: string; due?: string }>
}

export type Decision = { go: true; moment: Moment } | { go: false; why: string }

const MINUTE = 60_000
/** She does not open within this long of your last words. */
export const TALKED_QUIET_MS = 30 * MINUTE
/** At least this long between openings; doubled for each one you did not answer. */
export const MIN_GAP_MS = 90 * MINUTE
/** After this many unanswered openings she waits until you say something. */
export const MAX_UNANSWERED = 3
/** How long to wait after a try that failed. */
export const RETRY_MS = 30 * MINUTE
/** Keeping you company: this long after the last words, at random. */
export const COMPANY_MS: [number, number] = [150 * MINUTE, 300 * MINUTE]

export function inQuietHours(settings: InitiativeSettings, now: Date): boolean {
  const { quietFrom: from, quietTo: to } = settings
  if (from === to) return false
  const minute = now.getHours() * 60 + now.getMinutes()
  return from < to ? minute >= from && minute < to : minute >= from || minute < to
}

export function focusOn(record: InitiativeRecord, at: number): boolean {
  return record.focusUntil === -1 || record.focusUntil > at
}

/** "23:30". */
export function clockText(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** Whether she may speak first now, and about what. */
export function decide(input: InitiativeInput): Decision {
  const { settings, record, now, presence } = input
  const at = now.getTime()
  const today = input.dayOf(now)
  const wait = (why: string): Decision => ({ go: false, why })
  if (!settings.on) return wait('主动说话关着')
  if (focusOn(record, at)) return wait('专注中，她不主动说话')
  if (!input.ready) return wait('向导还没走完')
  if (input.off === true) return wait('她关着')
  if (!input.bodyHere) return wait('身体没连上')
  if (presence === undefined) return wait('不知道你在不在（身体还没报告）')
  if (presence !== 'active') return wait('你现在不在电脑前')
  if (inQuietHours(settings, now)) return wait(`安静时段（${clockText(settings.quietFrom)} 到 ${clockText(settings.quietTo)}）`)
  if (input.busy) return wait('她正在说话')
  const count = record.day === today ? record.count : 0
  if (count >= settings.perDay) return wait(`今天已经主动说过 ${count} 次了`)
  if (record.unanswered >= MAX_UNANSWERED) return wait('连着几次你都没回，她等你先开口')
  if (at < record.retryAt) return wait('上次没说成，过一会儿再试')
  if (at - record.lastTalkAt < TALKED_QUIET_MS) return wait('你们刚聊过')
  if (at - record.lastAt < MIN_GAP_MS * 2 ** record.unanswered) return wait('她刚说过，等一等')
  const dated = input.due.find(e => e.due !== undefined && !record.raised.includes(e.id))
  if (dated?.due !== undefined) return { go: true, moment: { kind: 'due', id: dated.id, text: dated.text, due: dated.due } }
  if (count === 0 && input.dayOf(new Date(record.lastTalkAt)) !== today) return { go: true, moment: { kind: 'hello' } }
  if (input.returned !== undefined) return { go: true, moment: { kind: 'back', awayMinutes: input.returned.awayMinutes } }
  if (at >= record.nextCompanyAt) return { go: true, moment: { kind: 'company' } }
  return wait('还没到她想说话的时候')
}

/** The next time she may speak just to keep you company. */
export function nextCompany(at: number, random: () => number = Math.random): number {
  const [min, max] = COMPANY_MS
  return at + min + random() * (max - min)
}

/** The record after she spoke first. */
export function afterSpeaking(record: InitiativeRecord, moment: Moment | undefined, text: string, now: Date, dayOf: (date: Date) => string, random: () => number = Math.random): InitiativeRecord {
  const at = now.getTime()
  const today = dayOf(now)
  return {
    ...record,
    day: today,
    // A try from the page says nothing about her daily allowance.
    count: moment === undefined ? (record.day === today ? record.count : 0) : (record.day === today ? record.count : 0) + 1,
    lastAt: moment === undefined ? record.lastAt : at,
    unanswered: moment === undefined ? record.unanswered : record.unanswered + 1,
    recent: [...record.recent, text].slice(-8),
    raised: moment?.kind === 'due' ? [...record.raised, moment.id].slice(-20) : record.raised,
    nextCompanyAt: nextCompany(at, random),
  }
}

/** The record after you said something or touched her: she is not ignored any more. */
export function afterYou(record: InitiativeRecord, at: number, random: () => number = Math.random): InitiativeRecord {
  return { ...record, unanswered: 0, lastTalkAt: at, nextCompanyAt: nextCompany(at, random) }
}

/** Fill in what an older or damaged file lacks. */
export function cleanRecord(value: unknown): InitiativeRecord {
  const saved = (typeof value === 'object' && value !== null ? value : {}) as Partial<InitiativeRecord>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  return {
    day: typeof saved.day === 'string' ? saved.day : '', count: num(saved.count), lastAt: num(saved.lastAt), unanswered: num(saved.unanswered),
    recent: strings(saved.recent), raised: strings(saved.raised), lastTalkAt: num(saved.lastTalkAt), nextCompanyAt: num(saved.nextCompanyAt), retryAt: num(saved.retryAt), focusUntil: num(saved.focusUntil),
  }
}

export function cleanSettings(value: unknown): InitiativeSettings {
  const saved = (typeof value === 'object' && value !== null ? value : {}) as Partial<InitiativeSettings>
  const minutes = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440 ? v : fallback)
  return {
    on: saved.on !== false,
    perDay: typeof saved.perDay === 'number' && Number.isInteger(saved.perDay) && saved.perDay >= 1 && saved.perDay <= 20 ? saved.perDay : DEFAULT_INITIATIVE.perDay,
    quietFrom: minutes(saved.quietFrom, DEFAULT_INITIATIVE.quietFrom),
    quietTo: minutes(saved.quietTo, DEFAULT_INITIATIVE.quietTo),
  }
}

const AWAY_TEXT = (minutes: number) => (minutes < 60 ? `大约 ${minutes} 分钟` : `大约 ${Math.round(minutes / 60)} 小时`)

const MOMENT_TEXT: Record<Moment['kind'], (moment: never) => string> = {
  due: (m: Extract<Moment, { kind: 'due' }>) => `对方有件事快到日子了（${m.due}）：${m.text}。你想起来了，主动提一句，像朋友关心，不要像日程提醒。`,
  hello: () => '你们今天还没说过话，对方刚来到电脑前。主动打个招呼，可以顺着现在的时段，或者接上次聊到的事。',
  back: (m: Extract<Moment, { kind: 'back' }>) => `对方离开电脑${AWAY_TEXT(m.awayMinutes)}，刚回来。主动说一句，可以问问刚才去做什么了，也可以说说你这边的小事。`,
  company: () => '对方在电脑前待了好一阵，你们有一会儿没说话了。主动说一句，别打扰太重：分享一件小事、一个念头，或者轻轻关心一下。',
}

/** What to ask her model for one opening. */
export function initiativePrompt(moment: Moment, recent: string[], lastTalk: string[]): string {
  return [
    `（现在没有人在对你说话，是你自己想开口。${(MOMENT_TEXT[moment.kind] as (m: Moment) => string)(moment)}）`,
    lastTalk.length === 0 ? '' : `你们最近说的话：\n${lastTalk.join('\n')}`,
    recent.length === 0 ? '' : `你最近主动说过这些，别重复：\n${recent.map(r => `- ${r}`).join('\n')}`,
    '只输出你要说的话：一两句，不超过四十个字。要具体，不说"在吗""你在干嘛呢"这种空话，也不要提到有人让你说话。',
    '你看不到对方的屏幕，也听不到对方的声音和键盘：不要假装知道对方此刻正在做什么，想知道就问。',
    '如果现在实在没什么想说的，只输出 PASS。',
  ].filter(s => s !== '').join('\n\n')
}

/** Her line out of the model's answer; undefined when she has nothing to say. */
export function parseOpening(answer: string): string | undefined {
  const text = answer.trim().replace(/^["“「]+|["”」]+$/g, '').trim()
  if (text === '' || /^pass\b/i.test(text)) return undefined
  return [...text].length > 160 ? [...text].slice(0, 160).join('') : text
}

/** Who is at the computer, from every body that reports it. A body gone silent no longer counts. */
export class Presence {
  private readonly reports = new Map<string, { state: PresenceState; at: number }>()
  private lastActiveAt = 0
  private lastReturn: { awayMinutes: number; at: number } | undefined
  private readonly ttlMs: number
  private readonly awayMs: number
  private readonly returnedForMs: number

  constructor(ttlMs = 3 * MINUTE, awayMs = 30 * MINUTE, returnedForMs = 5 * MINUTE) {
    this.ttlMs = ttlMs
    this.awayMs = awayMs
    this.returnedForMs = returnedForMs
  }

  /** A body's report. True when this means you just came back. */
  report(source: string, state: PresenceState, at: number): boolean {
    this.reports.set(source, { state, at })
    if (state !== 'active') return false
    const away = at - this.lastActiveAt
    const back = this.lastActiveAt !== 0 && away >= this.awayMs
    if (back) this.lastReturn = { awayMinutes: Math.round(away / MINUTE), at }
    this.lastActiveAt = at
    return back
  }

  current(at: number): PresenceState | undefined {
    const live = [...this.reports.values()].filter(r => at - r.at <= this.ttlMs)
    if (live.length === 0) return undefined
    if (live.some(r => r.state === 'active')) return 'active'
    return live.some(r => r.state === 'idle') ? 'idle' : 'away'
  }

  returned(at: number): { awayMinutes: number } | undefined {
    return this.lastReturn !== undefined && at - this.lastReturn.at <= this.returnedForMs ? { awayMinutes: this.lastReturn.awayMinutes } : undefined
  }

  clearReturned(): void {
    this.lastReturn = undefined
  }

  forget(source: string): void {
    this.reports.delete(source)
  }
}
