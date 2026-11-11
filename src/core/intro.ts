/** Her opening clip (docs/设置页与编排设计.md §4.5): when it plays, and which one. Pure. */

export interface IntroSettings {
  on: boolean
  /** 'skin': the skin's own clip; else the name of an opening clip in the 素材库. */
  source: string
  /** Every time she comes out, or the first time each day. */
  when: 'every' | 'daily'
  /** Also when a dsh page opens (after it has drawn: dsh's own start screen cannot be changed). */
  dsh: boolean
  /** The day it last played on the desktop (YYYY-MM-DD). */
  lastDay?: string
}

export function cleanIntro(value: unknown): IntroSettings {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<IntroSettings>
  return {
    on: v.on === true,
    source: typeof v.source === 'string' && v.source.trim() !== '' ? v.source.trim() : 'skin',
    when: v.when === 'every' ? 'every' : 'daily',
    dsh: v.dsh === true,
    ...(typeof v.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.lastDay) ? { lastDay: v.lastDay } : {}),
  }
}
