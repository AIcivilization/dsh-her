/**
 * What the body remembers between runs, in `<home>/body-settings.json`: the
 * pack chosen on the "她" page and the window mode. A pack chosen there wins
 * over `--pack` (which is only the first default the plugin passes).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PackSummary } from '../../src/protocol/index.ts'
import type { Mode } from '../shared/types.ts'
import { loadPack, summarize } from './pack/load.ts'

export interface BodySettings {
  /** Imported pack id, under `<home>/packs`. */
  pack?: string
  mode?: Mode
}

export function loadSettings(home: string): BodySettings {
  try {
    return JSON.parse(readFileSync(join(home, 'body-settings.json'), 'utf8')) as BodySettings
  } catch {
    return {}
  }
}

export function saveSettings(home: string, settings: BodySettings): void {
  mkdirSync(home, { recursive: true })
  const file = join(home, 'body-settings.json')
  writeFileSync(`${file}.tmp`, `${JSON.stringify(settings, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}

/** Every imported pack under `<home>/packs`, summarized for the brain. Broken ones are skipped. */
export function listPacks(packsDir: string): PackSummary[] {
  if (!existsSync(packsDir)) return []
  const out: PackSummary[] = []
  for (const id of readdirSync(packsDir).sort()) {
    if (id.startsWith('.') || !existsSync(join(packsDir, id, 'pack.json'))) continue
    try {
      out.push(summarize(loadPack(join(packsDir, id))))
    } catch {
      // half-written or from an older format: not offered
    }
  }
  return out
}
