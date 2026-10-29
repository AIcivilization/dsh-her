/**
 * Load an appearance pack for playing: an imported pack (`pack.json`), or a
 * development pack of loose idle clips (`clips.json`, M0/M1).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AvatarState, PackSummary } from '../../../src/protocol/index.ts'
import type { PackInfo, PackLayout } from '../../shared/types.ts'
import type { Pack } from './import.ts'
import { actionDesc } from './manifest.ts'

const url = (dir: string, file: string) => pathToFileURL(join(dir, file)).href

export function loadPack(dir: string): PackInfo {
  if (existsSync(join(dir, 'pack.json'))) {
    const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as Pack
    return {
      id: pack.id,
      name: pack.name,
      layer: pack.layer,
      layout: pack.layout,
      start: pack.start,
      macros: pack.macros,
      clips: pack.clips.map(c => ({
        id: c.id, url: url(dir, c.file), from: c.from, to: c.to, role: c.role, name: c.name,
        interruptible: c.interruptible, durationMs: c.durationMs, seam: { in: c.seam.in, out: c.seam.out },
        ...(c.mask === undefined ? {} : { mask: { ...c.mask, url: url(dir, c.mask.file) } }),
        ...(c.audio === undefined ? {} : { audioUrl: url(dir, c.audio) }),
        ...(c.transcript === undefined ? {} : { transcript: c.transcript }),
      })),
      ...(pack.plate === undefined ? {} : { plateUrl: url(dir, pack.plate) }),
    }
  }
  // Development pack: loose clips, all idle (or the role they name), at one anchor, crossfaded.
  const manifest = JSON.parse(readFileSync(join(dir, 'clips.json'), 'utf8')) as { name: string; layout?: PackLayout; clips: Array<{ id: string; file: string; role?: string }> }
  return {
    id: manifest.name,
    name: manifest.name,
    layer: 'overlay',
    layout: manifest.layout ?? 'opaque',
    start: 'stand',
    macros: [],
    clips: manifest.clips.map(c => ({
      id: c.id, url: url(dir, c.file), from: 'stand', to: 'stand', role: 'state', name: c.role ?? 'idle',
      interruptible: true, durationMs: 5000, seam: { in: 'fade', out: 'fade' },
    })),
  }
}

/** What the brain needs to know about the pack (hello): states, emotions, actions. */
export function summarize(pack: PackInfo): PackSummary {
  const states = [...new Set(pack.clips.filter(c => c.role === 'state').map(c => c.name))] as AvatarState[]
  const emotions = [...new Set(pack.clips.filter(c => c.role === 'emotion').map(c => c.name))]
  const actions: PackSummary['actions'] = []
  for (const clip of pack.clips) {
    if (clip.role === 'action' && !actions.some(a => a.id === clip.name)) actions.push({ id: clip.name, desc: actionDesc(clip.name), durationMs: clip.durationMs })
    if (clip.role === 'line') {
      actions.push({ id: clip.name, desc: `说储备台词：${clip.transcript ?? clip.name}`, durationMs: clip.durationMs, hasAudio: clip.audioUrl !== undefined, ...(clip.transcript === undefined ? {} : { transcript: clip.transcript }) })
    }
  }
  for (const macro of pack.macros) actions.push({ id: macro.action, desc: macro.desc })
  return { packId: pack.id, kind: 'video', name: pack.name, layer: pack.layer, states, emotions, actions, hitParts: ['body'] }
}
