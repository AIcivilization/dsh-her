/**
 * Who she is, as the wizard and the "她" page set it: `<home>/characters/<cid>/character.json`.
 * The plugin config only gives the first defaults; once saved here, this file
 * wins, and changes apply from her next model request (her prompt is rebuilt
 * every time) without restarting DSH.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Pronoun = '他' | '她' | 'TA'

export interface Character {
  name: string
  persona: string
  /** What she calls you; empty = she has not been told. */
  callYou: string
  /** How she refers to you in her notes and memories. */
  pronoun: Pronoun
  voice: { sid: number; speed: number }
  /** The wizard has been completed once. */
  onboarded: boolean
}

export function loadCharacter(dir: string, defaults: Character): Character {
  try {
    const saved = JSON.parse(readFileSync(join(dir, 'character.json'), 'utf8')) as Partial<Character>
    return {
      ...defaults,
      ...saved,
      pronoun: saved.pronoun === '他' || saved.pronoun === '她' || saved.pronoun === 'TA' ? saved.pronoun : defaults.pronoun,
      voice: { ...defaults.voice, ...saved.voice },
    }
  } catch {
    return defaults
  }
}

export function saveCharacter(dir: string, character: Character): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'character.json')
  writeFileSync(`${file}.tmp`, `${JSON.stringify(character, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}

/** Check a patch from the page; returns the error message, or undefined when it is fine. */
export function invalidCharacter(c: Character): string | undefined {
  if (c.name.trim() === '' || [...c.name].length > 20) return '名字要 1 到 20 个字'
  if (c.persona.trim() === '') return '人设不能是空的'
  if ([...c.persona].length > 3000) return '人设太长了（最多 3000 字）'
  if ([...c.callYou].length > 20) return '称呼最多 20 个字'
  if (!Number.isInteger(c.voice.sid) || c.voice.sid < 0 || c.voice.sid > 102) return '音色编号要在 0 到 102 之间'
  if (!(c.voice.speed >= 0.5 && c.voice.speed <= 2)) return '语速要在 0.5 到 2 之间'
  return undefined
}
