/**
 * Her speaking first, on the clock (the rules are in core/initiative.ts).
 *
 * An opening never touches her session: it is one small model call of its own
 * with a time limit, so it cannot leave her session busy or grow it, and if the
 * model hangs she simply says nothing. Her session hears what she said right
 * before your next words, so your answer lands in the right conversation.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterSpeaking, afterYou, cleanRecord, cleanSettings, decide, focusOn, Presence, RETRY_MS, type InitiativeRecord, type InitiativeSettings, type Moment, type PresenceState } from '../core/initiative.ts'

/** The model gets this long for one opening. */
const COMPOSE_LIMIT_MS = 45_000
const FOCUS_SPAN_MS = 2 * 60 * 60_000

export interface InitiativeDeps {
  file: string
  dayOf: (date: Date) => string
  ready: () => boolean
  bodyHere: () => boolean
  busy: () => boolean
  due: (now: Date) => Array<{ id: string; text: string; due?: string }>
  /** Her line for this moment (undefined moment: a try from the page); undefined when she has nothing to say. */
  compose: (moment: Moment | undefined, recent: string[]) => Promise<string | undefined>
  speak: (text: string) => void
  log: (entry: Record<string, unknown>) => void
  /** Focus was turned on or off: tell the bodies, for their menus. */
  focusChanged: (on: boolean) => void
}

export interface InitiativeView {
  settings: InitiativeSettings
  /** Focus: off, until a time, or until turned off (-1). */
  focus: { on: boolean; until: number }
  today: number
  /** Why she is quiet right now, in plain words; undefined when she may speak. */
  why?: string
  /** What she said first last, and when. */
  last?: { text: string; at: number }
}

export type FocusChoice = 'off' | 'span' | 'always'

export class Initiative {
  readonly presence = new Presence()
  private readonly deps: InitiativeDeps
  private settingsNow: InitiativeSettings
  private record: InitiativeRecord
  private composing = false
  private lastSaid: { text: string; at: number } | undefined

  constructor(deps: InitiativeDeps) {
    this.deps = deps
    let saved: { settings?: unknown; record?: unknown } = {}
    try {
      saved = JSON.parse(readFileSync(deps.file, 'utf8')) as typeof saved
    } catch {
      // first run, or a damaged file: start over
    }
    this.settingsNow = cleanSettings(saved.settings)
    this.record = cleanRecord(saved.record)
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.deps.file), { recursive: true })
      writeFileSync(`${this.deps.file}.tmp`, `${JSON.stringify({ settings: this.settingsNow, record: this.record }, null, 2)}\n`)
      renameSync(`${this.deps.file}.tmp`, this.deps.file)
    } catch (error) {
      this.deps.log({ event: 'initiative', error: (error as Error).message })
    }
  }

  private decision(now: Date) {
    const at = now.getTime()
    const returned = this.presence.returned(at)
    return decide({
      settings: this.settingsNow, record: this.record, now, dayOf: this.deps.dayOf,
      ready: this.deps.ready(), bodyHere: this.deps.bodyHere(), presence: this.presence.current(at), busy: this.composing || this.deps.busy(),
      due: this.deps.due(now), ...(returned === undefined ? {} : { returned }),
    })
  }

  /** Look whether she should say something now. Never throws, and never leaves her stuck. */
  tick(now = new Date()): void {
    const decision = this.decision(now)
    if (decision.go) void this.open(decision.moment, now)
  }

  /** A body says whether you are at the computer; coming back may be her moment. */
  report(source: string, state: PresenceState, at = Date.now()): void {
    if (this.presence.report(source, state, at)) this.tick(new Date(at))
  }

  private async open(moment: Moment, now: Date): Promise<void> {
    this.composing = true
    if (moment.kind === 'back') this.presence.clearReturned()
    const startedAt = Date.now()
    try {
      const text = await this.withLimit(this.deps.compose(moment, this.record.recent))
      // You said something while she thought, or she started talking: the moment has passed.
      if (this.record.lastTalkAt >= startedAt || this.deps.busy()) return
      if (text === undefined) {
        this.record = { ...this.record, retryAt: Date.now() + RETRY_MS }
        this.save()
        this.deps.log({ event: 'opening', moment: moment.kind, said: null })
        return
      }
      this.record = afterSpeaking(this.record, moment, text, new Date(), this.deps.dayOf)
      this.lastSaid = { text, at: Date.now() }
      this.save()
      this.deps.log({ event: 'opening', moment: moment.kind, said: text })
      this.deps.speak(text)
    } catch (error) {
      this.record = { ...this.record, retryAt: now.getTime() + RETRY_MS }
      this.save()
      this.deps.log({ event: 'opening', moment: moment.kind, error: (error as Error).message })
    } finally {
      this.composing = false
    }
  }

  private withLimit<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const limit = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`模型 ${COMPOSE_LIMIT_MS / 1000} 秒没有回答`)), COMPOSE_LIMIT_MS)
      timer.unref()
    })
    return Promise.race([work, limit]).finally(() => clearTimeout(timer))
  }

  /** You said something or touched her. */
  heardYou(at = Date.now()): void {
    this.record = afterYou(this.record, at)
    this.save()
  }

  /** From the page: have her say something now, whatever the clock says; returns what she said. */
  async tryNow(): Promise<string> {
    if (!this.deps.bodyHere()) throw new Error('身体还没连上，她没法开口')
    if (this.composing || this.deps.busy()) throw new Error('她正在说话，等她说完')
    this.composing = true
    try {
      const text = await this.withLimit(this.deps.compose(undefined, this.record.recent))
      if (text === undefined) throw new Error('她这会儿没什么想说的，过一会儿再试')
      this.record = afterSpeaking(this.record, undefined, text, new Date(), this.deps.dayOf)
      this.lastSaid = { text, at: Date.now() }
      this.save()
      this.deps.log({ event: 'opening', moment: 'try', said: text })
      this.deps.speak(text)
      return text
    } finally {
      this.composing = false
    }
  }

  get focused(): boolean {
    return focusOn(this.record, Date.now())
  }

  setSettings(change: Partial<InitiativeSettings>): void {
    this.settingsNow = cleanSettings({ ...this.settingsNow, ...change })
    this.save()
  }

  setFocus(choice: FocusChoice, at = Date.now()): void {
    this.record = { ...this.record, focusUntil: choice === 'off' ? 0 : choice === 'always' ? -1 : at + FOCUS_SPAN_MS }
    this.save()
    this.deps.focusChanged(choice !== 'off')
  }

  view(now = new Date()): InitiativeView {
    const decision = this.decision(now)
    const at = now.getTime()
    return {
      settings: this.settingsNow,
      focus: { on: focusOn(this.record, at), until: this.record.focusUntil },
      today: this.record.day === this.deps.dayOf(now) ? this.record.count : 0,
      ...(decision.go ? {} : { why: decision.why }),
      ...(this.lastSaid === undefined ? {} : { last: this.lastSaid }),
    }
  }
}
