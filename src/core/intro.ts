/** Her opening clip (docs/设置页与编排设计.md §4.5): when it plays, and which one. Pure. */

import { cleanLook, type PixelLook } from './pixel.ts'

/** A 像素动画 as the opening clip is drawn over a part of the screen, as dots by default. */
export const INTRO_LOOK: PixelLook = { style: 'dots', color: 'theme', size: 0.6, fit: 'contain' }

export interface IntroSettings {
  on: boolean
  /** 'skin': the skin's own clip; `pixel:<id>`: a 像素动画 (docs/像素动画设计.md §6); else the name of an opening clip in the 素材库. */
  source: string
  /** How a 像素动画 is drawn when it is the clip. */
  look: PixelLook
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
    look: cleanLook(v.look, INTRO_LOOK),
    ...(typeof v.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.lastDay) ? { lastDay: v.lastDay } : {}),
  }
}

/** The 像素动画 chosen as the clip, if one is. */
export const introPixel = (settings: IntroSettings): string | undefined =>
  settings.source.startsWith('pixel:') ? settings.source.slice('pixel:'.length) : undefined
