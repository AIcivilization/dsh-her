/**
 * Load an appearance pack for playing: an imported pack (`pack.json`), or a
 * development pack of loose idle clips (`clips.json`, M0/M1).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AvatarState, PackSummary } from '../../../src/protocol/index.ts'
import { closestShape } from '../../shared/fit.ts'
import type { ClipUse, ClipsView, PackInfo, PackLayout, SceneLayout } from '../../shared/types.ts'
import type { Pack } from './import.ts'
import { actionDesc } from './manifest.ts'

const url = (dir: string, file: string) => pathToFileURL(join(dir, file)).href

/**
 * The photo to show behind her and her region on it. A scene with photos of
 * several shapes shows the one closest to the screen's (`screenAspect`,
 * width / height); without one, the first.
 */
function placed(dir: string, plate: string | undefined, scene: SceneLayout | undefined, screenAspect: number | undefined): Pick<PackInfo, 'plateUrl' | 'scene'> {
  if (plate === undefined) return scene === undefined ? {} : { scene }
  if (scene === undefined) return { plateUrl: url(dir, plate) }
  const options = [{ file: plate, width: scene.width, height: scene.height, region: scene.region }, ...(scene.plates ?? [])]
  const pick = (screenAspect === undefined ? undefined : closestShape(options, screenAspect)) ?? options[0]!
  return { plateUrl: url(dir, pick.file), scene: { width: pick.width, height: pick.height, region: pick.region } }
}

export function loadPack(dir: string, screenAspect?: number): PackInfo {
  if (existsSync(join(dir, 'pack.json'))) {
    const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as Pack
    const shown = placed(dir, pack.plate, pack.scene, screenAspect)
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
      ...shown,
      aspect: shown.scene === undefined ? pack.canvas.width / pack.canvas.height : shown.scene.width / shown.scene.height,
    }
  }
  // Development pack: loose clips, each marked in clips.json with what it is for (the "画面" tab of her
  // settings window writes these). Unmarked clips are idle variants at the main place.
  const manifest = readDevManifest(dir)
  const anchorOf = (clip: DevClip) => clip.at ?? (clip.name === undefined ? MAIN : `look:${clip.name}`)
  const used = manifest.clips.filter(c => c.use !== 'none')
  const shown = placed(dir, manifest.plate, manifest.scene, screenAspect)
  return {
    // Its id is its folder, so the brain can pick it like an imported pack.
    id: basename(dir),
    name: manifest.title ?? manifest.name,
    layer: manifest.layer ?? 'overlay',
    layout: manifest.layout ?? 'opaque',
    start: MAIN,
    macros: used.filter(c => c.name !== undefined && c.at === undefined).map(c => ({ action: `look_${c.name}`, desc: `换成「${c.desc ?? c.name}」的画面并一直保持（只在对方要求换时用）`, goTo: anchorOf(c), jump: true })),
    clips: used.map(c => {
      const at = anchorOf(c)
      const base = { id: c.id, url: url(dir, c.file), from: at, interruptible: true, durationMs: c.durationMs ?? 5000, seam: { in: 'fade' as const, out: 'fade' as const } }
      if (c.to !== undefined) return { ...base, to: c.to, role: 'transition' as const, name: 'transition' }
      if (c.action !== undefined) return { ...base, to: at, role: 'action' as const, name: c.action }
      if (c.emotion !== undefined) return { ...base, to: at, role: 'emotion' as const, name: c.emotion }
      return { ...base, to: at, role: 'state' as const, name: c.state ?? c.role ?? 'idle' }
    }),
    // A window shows the whole scene when there is one, else her picture.
    ...(shown.scene !== undefined ? { aspect: shown.scene.width / shown.scene.height } : manifest.width && manifest.height ? { aspect: manifest.width / manifest.height } : {}),
    ...shown,
  }
}

const MAIN = 'stand'

/** One clip of a development pack, as clips.json describes it. */
export interface DevClip {
  id: string
  file: string
  /** Where the clip came from (the original file name). */
  from?: string
  /** A state loop: idle (default), listen, talk, think, sleep. */
  state?: string
  /** A one-shot action (for example look_up), or an emotion (shy, happy …). */
  action?: string
  emotion?: string
  /** The place it plays at (default: the main place); `to`: it moves her to another place (falling asleep). */
  at?: string
  to?: string
  /** A look asked for by name ("换成近景"), and what it shows. */
  name?: string
  desc?: string
  /** "none": kept in the folder but not played. */
  use?: 'none'
  durationMs?: number
  /** Older files: the state name. */
  role?: string
}

export interface DevManifest {
  name: string
  title?: string
  layer?: 'overlay' | 'scene'
  layout?: PackLayout
  width?: number
  height?: number
  /** A full-screen photo behind her, and where on it her clips play. */
  plate?: string
  scene?: SceneLayout
  clips: DevClip[]
}

export function readDevManifest(dir: string): DevManifest {
  return JSON.parse(readFileSync(join(dir, 'clips.json'), 'utf8')) as DevManifest
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

/** What a clip is used for, in the words of the "画面" tab. */
export function useOf(clip: DevClip): ClipUse {
  if (clip.use === 'none') return 'none'
  if (clip.to !== undefined) return 'fall-asleep'
  if (clip.state === 'sleep') return 'sleep'
  if (clip.emotion === 'shy' || clip.emotion === 'happy') return clip.emotion
  if (clip.state === 'listen' || clip.state === 'talk' || clip.state === 'think') return clip.state
  return 'idle'
}

/** The current pack's clips for the "画面" tab. */
export function clipsView(dir: string, pack: PackInfo): ClipsView {
  if (!existsSync(join(dir, 'clips.json'))) {
    return { packId: pack.id, name: pack.name, editable: false, clips: pack.clips.map(c => ({ id: c.id, url: c.url, desc: `${c.role} · ${c.name}`, use: 'idle', durationMs: c.durationMs })) }
  }
  const manifest = readDevManifest(dir)
  return {
    packId: pack.id, name: pack.name, editable: true,
    clips: manifest.clips.map(c => ({ id: c.id, url: url(dir, c.file), desc: c.desc ?? '', use: useOf(c), durationMs: c.durationMs ?? 5000 })),
  }
}

/** Write what each clip is used for back to clips.json; other fields are kept. */
export function saveClipUses(dir: string, changes: Array<{ id: string; use: ClipUse; desc: string }>): void {
  const manifest = readDevManifest(dir)
  for (const change of changes) {
    const clip = manifest.clips.find(c => c.id === change.id)
    if (clip === undefined) continue
    for (const key of ['state', 'emotion', 'at', 'to', 'use', 'role', 'action'] as const) delete clip[key]
    if (change.use === 'none') clip.use = 'none'
    else if (change.use === 'fall-asleep') clip.to = 'asleep'
    else if (change.use === 'sleep') Object.assign(clip, { at: 'asleep', state: 'sleep' })
    else if (change.use === 'shy' || change.use === 'happy') clip.emotion = change.use
    else if (change.use !== 'idle') clip.state = change.use
    if (change.desc.trim() === '') delete clip.desc
    else clip.desc = change.desc.trim()
  }
  const file = join(dir, 'clips.json')
  writeFileSync(`${file}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}
