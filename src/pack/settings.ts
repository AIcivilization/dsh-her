/**
 * What the body remembers between runs, in `<home>/body-settings.json`: the
 * pack chosen on the "她" page and the window mode. A pack chosen there wins
 * over `--pack` (which is only the first default the plugin passes).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PackSummary } from '../protocol/index.ts'
import type { LookPrefs } from './look.ts'
import type { Mode } from './types.ts'
import { loadPack, summarize } from './load.ts'

export interface BodySettings {
  /** Imported pack id, under `<home>/packs`. */
  pack?: string
  /** A look (`<home>/looks/<id>`) instead of a single pack. */
  look?: string
  /** Per look: the scene she is in and how scenes switch. */
  looks?: Record<string, LookPrefs>
  mode?: Mode
  /** Hold the right Option / Alt key in any program to talk (docs/对话入口设计.md); needs a system permission on macOS. */
  holdKey?: boolean
  /** Switched off (the brain says so; kept here so she does not flash up at the next start). */
  off?: boolean
  /** Where she shows on the desktop, each on its own (both: two windows). Not set: one window, by `mode`. */
  places?: { wallpaper: boolean; overlay: boolean }
  /** No icon in the menu bar / tray (her settings are in dsh). */
  noTray?: boolean
  /** How big she floats on the desktop, 0.5–1.6 times the usual (her page sets it). */
  petScale?: number
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

/** Every pack under `<home>/packs` (imported, or a local development pack), summarized for the brain. Broken ones are skipped. */
export function listPacks(packsDir: string): PackSummary[] {
  if (!existsSync(packsDir)) return []
  const out: PackSummary[] = []
  for (const id of readdirSync(packsDir).sort()) {
    const dir = join(packsDir, id)
    if (id.startsWith('.') || !(existsSync(join(dir, 'pack.json')) || existsSync(join(dir, 'clips.json')))) continue
    try {
      out.push(summarize(loadPack(dir)))
    } catch {
      // half-written or from an older format: not offered
    }
  }
  return out
}
