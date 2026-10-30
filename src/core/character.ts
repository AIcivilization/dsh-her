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
  /** A CosyVoice voice id (voices.ts), and how fast she talks. */
  voice: { id: string; speed: number }
  /** Her model; undefined = the plugin config's, else DSH's default. `effort` empty = the route's default. */
  model?: { provider: string; model: string; effort?: string }
  /** The wizard has been completed once. */
  onboarded: boolean
}

export function loadCharacter(dir: string, defaults: Character): Character {
  try {
    const saved = JSON.parse(readFileSync(join(dir, 'character.json'), 'utf8')) as Partial<Character> & { voice?: { id?: unknown; speed?: unknown } }
    return {
      ...defaults,
      ...saved,
      pronoun: saved.pronoun === '他' || saved.pronoun === '她' || saved.pronoun === 'TA' ? saved.pronoun : defaults.pronoun,
      // Settings saved before the cloud voice name a local speaker number instead: keep the speed only.
      voice: {
        id: typeof saved.voice?.id === 'string' ? saved.voice.id : defaults.voice.id,
        speed: typeof saved.voice?.speed === 'number' ? saved.voice.speed : defaults.voice.speed,
      },
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
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(c.voice.id)) return '音色不对'
  if (!(c.voice.speed >= 0.5 && c.voice.speed <= 2)) return '语速要在 0.5 到 2 之间'
  if (c.model !== undefined && (c.model.provider.trim() === '' || c.model.model.trim() === '')) return '模型不对'
  return undefined
}
