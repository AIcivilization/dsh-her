/**
 * Looks on disk (`<home>/looks/<id>/look.json`) and what the brain hears of
 * them. The rules themselves are in look.ts.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LookView, PackSummary } from '../protocol/index.ts'
import { describeWhen, validateLook, type Look, type LookPrefs } from './look.ts'
import type { PackInfo } from './types.ts'
import { loadPack, summarize } from './load.ts'

const hasPack = (packsDir: string, id: string) => existsSync(join(packsDir, id, 'pack.json')) || existsSync(join(packsDir, id, 'clips.json'))

/** Every usable look. Scenes whose pack is missing are left out (and a look left without its default scene is skipped). */
export function listLooks(home: string, packsDir: string): Look[] {
  const dir = join(home, 'looks')
  if (!existsSync(dir)) return []
  const out: Look[] = []
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue
    try {
      const { look, problem } = validateLook(JSON.parse(readFileSync(join(dir, entry, 'look.json'), 'utf8')))
      if (look === undefined) {
        console.warn(`look ${entry}: ${problem}`)
        continue
      }
      const scenes = look.scenes.filter(s => hasPack(packsDir, s.pack)).map(s => {
        if (s.desk === undefined || hasPack(packsDir, s.desk)) return s
        const { desk: _gone, ...rest } = s
        return rest
      })
      if (!scenes.some(s => s.id === look.default)) {
        console.warn(`look ${entry}: the default scene's pack is missing`)
        continue
      }
      const { desk, ...rest } = look
      out.push({ ...rest, scenes, ...(desk !== undefined && hasPack(packsDir, desk) ? { desk } : {}) })
    } catch {
      // no look.json, or not JSON: not offered
    }
  }
  return out
}

export const lookPackId = (look: Look) => `look:${look.id}`

/** A look as the brain sees it in the pack list: what the pack on screen can do, plus moving between scenes. */
export function lookSummary(look: Look, shown: PackInfo, prefs: LookPrefs): PackSummary {
  const base = summarize(shown)
  const current = prefs.scene ?? look.default
  const actions = [...base.actions]
  for (const scene of look.scenes) {
    if (scene.id === current || prefs.off?.includes(scene.id)) continue
    actions.push({ id: `scene_${scene.id}`, desc: `去「${scene.name}」（对方要你换个地方，或想看你在${scene.name}的样子时）` })
  }
  if (prefs.locked === true || prefs.auto === false) actions.push({ id: 'scene_auto', desc: '恢复按时间和对方在不在，自动换地方（对方说"随你走动吧"时）' })
  else actions.push({ id: 'scene_stay', desc: '就待在现在这里，不再自动换地方（对方说"就待在这"时）' })
  return { ...base, packId: lookPackId(look), name: look.name, layer: 'scene', actions }
}

/** A look that is not on screen: summarized from its default scene. */
export function idleLookSummary(look: Look, packsDir: string): PackSummary | undefined {
  try {
    const scene = look.scenes.find(s => s.id === look.default)!
    return lookSummary(look, loadPack(join(packsDir, scene.pack)), {})
  } catch {
    return undefined
  }
}

export function lookView(look: Look, prefs: LookPrefs): LookView {
  return {
    id: look.id,
    name: look.name,
    scenes: look.scenes.map(s => ({ id: s.id, name: s.name, when: describeWhen(s.when), on: !(prefs.off ?? []).includes(s.id) })),
    current: prefs.scene ?? look.default,
    auto: prefs.auto !== false,
    locked: prefs.locked === true,
    desk: look.desk !== undefined,
  }
}
