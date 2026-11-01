/**
 * A look: one character in several scenes, plus a desk-pet version and the
 * rules for which scene she is in (docs/形象工坊与多场景.md §5, §7).
 *
 * Each scene and the desk pet are ordinary imported packs, referred to by
 * pack id; `<home>/looks/<id>/look.json` ties them together. What she does
 * inside a scene is still the pack's pose graph; the look only decides which
 * pack is on screen.
 */

export const LOOK_FORMAT = 'dsh-her-look@1'

export interface LookWhen {
  /** Hours of the day, "7-10" (from 7:00 up to 10:00); may wrap past midnight, "22-7". */
  hours?: string
  /** "active": you are using the computer; "idle": you have not touched it for a while. */
  user?: 'active' | 'idle'
}

export interface LookScene {
  id: string
  name: string
  /** The imported pack that shows this scene. */
  pack: string
  when?: LookWhen
}

export interface Look {
  format: typeof LOOK_FORMAT
  id: string
  name: string
  /** The pack shown when she floats on top ("浮在最上层"); without one, the current scene is. */
  desk?: string
  scenes: LookScene[]
  /** The scene when no rule matches. */
  default: string
  /** An automatic switch waits at least this long after the last one. */
  minStayMinutes?: number
}

/** What the user set for a look: switching on or off, held in one scene, scenes left out. */
export interface LookPrefs {
  scene?: string
  auto?: boolean
  locked?: boolean
  off?: string[]
  /** When the scene last changed (ms since epoch). */
  switchedAt?: number
}

export const DEFAULT_STAY_MINUTES = 20
/** Untouched this long counts as "idle"; touched within ACTIVE_WITHIN as "active". */
export const IDLE_AFTER_S = 5 * 60
export const ACTIVE_WITHIN_S = 60

/** Whether `hour` (0–23) falls in "7-10" (end excluded); "22-7" wraps past midnight. A malformed range matches nothing. */
export function inHours(range: string, hour: number): boolean {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(range)
  if (m === null) return false
  const start = Number(m[1]) % 24
  const end = Number(m[2]) === 24 ? 24 : Number(m[2]) % 24
  if (start === end) return true
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

/**
 * The scene she should be in now: of the scenes switched on whose every
 * condition holds, the one with the most conditions (a rule about you beats
 * a time of day alone); ties go to the earlier scene. None: the default.
 */
export function pickScene(look: Pick<Look, 'scenes' | 'default'>, now: { hour: number; idleSeconds: number }, off: readonly string[] = []): string {
  let best: { id: string; score: number } | undefined
  for (const scene of look.scenes) {
    if (off.includes(scene.id)) continue
    const when = scene.when ?? {}
    let score = 0
    if (when.hours !== undefined) {
      if (!inHours(when.hours, now.hour)) continue
      score += 1
    }
    if (when.user !== undefined) {
      const ok = when.user === 'idle' ? now.idleSeconds >= IDLE_AFTER_S : now.idleSeconds < ACTIVE_WITHIN_S
      if (!ok) continue
      score += 2
    }
    if (score > 0 && (best === undefined || score > best.score)) best = { id: scene.id, score }
  }
  return best?.id ?? look.default
}

/**
 * Whether to switch automatically now: switching on, not held, nothing being
 * said, the last switch long enough ago, and a different scene wanted.
 */
export function shouldSwitch(look: Pick<Look, 'minStayMinutes'>, prefs: LookPrefs, current: string, wanted: string, now: number, busy: boolean): boolean {
  if (prefs.auto === false || prefs.locked === true || busy || wanted === current) return false
  const stay = (look.minStayMinutes ?? DEFAULT_STAY_MINUTES) * 60_000
  return prefs.switchedAt === undefined || now - prefs.switchedAt >= stay
}

/** "早上 7–10 点 · 你在用电脑时": a rule in words, for menus and the settings page. */
export function describeWhen(when: LookWhen | undefined): string {
  const parts: string[] = []
  if (when?.hours !== undefined) {
    const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(when.hours)
    parts.push(m === null ? when.hours : `${Number(m[1])}–${Number(m[2])} 点`)
  }
  if (when?.user === 'active') parts.push('你在用电脑时')
  if (when?.user === 'idle') parts.push('你很久没动时')
  return parts.length === 0 ? '没有条件时' : parts.join(' · ')
}

/** Check a look read from disk; the reason when it cannot be used. */
export function validateLook(value: unknown): { look?: Look; problem?: string } {
  const look = value as Look
  if (typeof look !== 'object' || look === null || look.format !== LOOK_FORMAT) return { problem: `不是 ${LOOK_FORMAT}` }
  if (typeof look.id !== 'string' || look.id === '' || typeof look.name !== 'string') return { problem: '缺少 id 或 name' }
  if (!Array.isArray(look.scenes) || look.scenes.length === 0) return { problem: '没有场景' }
  for (const scene of look.scenes) {
    if (typeof scene?.id !== 'string' || typeof scene.pack !== 'string' || typeof scene.name !== 'string') return { problem: '场景要有 id、name、pack' }
  }
  if (!look.scenes.some(s => s.id === look.default)) return { problem: `默认场景 ${String(look.default)} 不在场景里` }
  return { look }
}
