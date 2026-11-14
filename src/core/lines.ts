/**
 * Lines written ahead of time for a character (docs/设计包格式.md, `character.lines`):
 * what she says when she is touched, when she appears, and when the quiet
 * hours begin. With a brain her touch lines are written by her model
 * (touch.ts); without one (the pet that does not chat) these are all she says.
 *
 * On disk, in the character's folder: `touch-lines.json` is `{ hash, lines }`,
 * the file the plugin has always kept, where `hash` ties the lines to the
 * persona they were written for; `lines.json` holds `hello` and `night`.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FALLBACK_LINES, type TouchLines, type TouchMood } from './touch.ts'

export interface WrittenLines {
  touch?: TouchLines
  hello?: string[]
  night?: string[]
}

export const LINE_CHARS = 40
export const LINES_PER_KIND = 20
const MOODS: TouchMood[] = ['head', 'body', 'long', 'many']
const MOOD_NAMES: Record<TouchMood, string> = { head: '摸头', body: '摸身体', long: '长按', many: '连着摸' }
const TOUCH_FILE = 'touch-lines.json'
const OTHER_FILE = 'lines.json'

/** Ties touch lines to the persona they were written for. */
export const personaHash = (character: { name: string; persona: string }): string =>
  createHash('sha1').update(`${character.name}\n${character.persona}`).digest('hex').slice(0, 12)

/** The usable lines of one kind, and what was left out. */
function list(raw: unknown, where: string, problems: string[]): string[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    problems.push(`${where} 要是一组句子`)
    return undefined
  }
  const lines = raw.filter((s): s is string => typeof s === 'string').map(s => s.trim()).filter(s => s !== '')
  const short = lines.filter(s => [...s].length <= LINE_CHARS)
  if (short.length < lines.length) problems.push(`${where} 里有 ${lines.length - short.length} 句超过 ${LINE_CHARS} 个字，没收`)
  if (short.length > LINES_PER_KIND) problems.push(`${where} 多于 ${LINES_PER_KIND} 句，只收前 ${LINES_PER_KIND} 句`)
  const kept = [...new Set(short)].slice(0, LINES_PER_KIND)
  return kept.length === 0 ? undefined : kept
}

/** Read `character.lines` of a design pack: what can be used is kept, what is wrong is said. */
export function parseLines(raw: unknown): { lines?: WrittenLines; problems: string[] } {
  const problems: string[] = []
  if (raw === undefined) return { problems }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { problems: ['character.lines 写得不对，没收'] }
  const v = raw as Record<string, unknown>
  const lines: WrittenLines = {}
  if (v.touch !== undefined) {
    if (typeof v.touch !== 'object' || v.touch === null || Array.isArray(v.touch)) problems.push('character.lines.touch 写得不对，没收')
    else {
      const given = v.touch as Record<string, unknown>
      const touch = {} as TouchLines
      let any = false
      for (const mood of MOODS) {
        const kept = list(given[mood], `台词·${MOOD_NAMES[mood]}`, problems)
        if (kept !== undefined) any = true
        // A mood the pack left out: the neutral lines, so a touch is never met with silence.
        touch[mood] = kept ?? [...FALLBACK_LINES[mood]]
      }
      if (any) lines.touch = touch
    }
  }
  const hello = list(v.hello, '台词·出场', problems)
  if (hello !== undefined) lines.hello = hello
  const night = list(v.night, '台词·晚安', problems)
  if (night !== undefined) lines.night = night
  return Object.keys(lines).length === 0 ? { problems } : { lines, problems }
}

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** The lines kept for this character; her touch lines only while they are still for this persona. */
export function loadLines(dir: string, character: { name: string; persona: string }): WrittenLines {
  const out: WrittenLines = {}
  const kept = readJson(join(dir, TOUCH_FILE)) as { hash?: unknown; lines?: unknown } | undefined
  if (kept !== undefined && kept !== null && kept.hash === personaHash(character)) {
    const touch = parseLines({ touch: kept.lines }).lines?.touch
    if (touch !== undefined) out.touch = touch
  }
  const other = parseLines(readJson(join(dir, OTHER_FILE))).lines
  if (other?.hello !== undefined) out.hello = other.hello
  if (other?.night !== undefined) out.night = other.night
  return out
}

/** Keep these lines for this character (what is not given is removed). */
export function saveLines(dir: string, character: { name: string; persona: string }, lines: WrittenLines): void {
  mkdirSync(dir, { recursive: true })
  if (lines.touch === undefined) rmSync(join(dir, TOUCH_FILE), { force: true })
  else writeFileSync(join(dir, TOUCH_FILE), `${JSON.stringify({ hash: personaHash(character), lines: lines.touch }, null, 2)}\n`)
  const other = { ...(lines.hello === undefined ? {} : { hello: lines.hello }), ...(lines.night === undefined ? {} : { night: lines.night }) }
  if (Object.keys(other).length === 0) rmSync(join(dir, OTHER_FILE), { force: true })
  else writeFileSync(join(dir, OTHER_FILE), `${JSON.stringify(other, null, 2)}\n`)
}
