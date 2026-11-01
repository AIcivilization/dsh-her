/**
 * The appearance pack format (docs/外形包与姿势图.md) and how it is inferred
 * from file names, so a user never has to write it by hand.
 *
 * Names (see docs/素材生成提示词.md):
 *   anchor_<A>.png                     anchor still
 *   <A>_<role>_<nn>.mp4                loop at anchor A (a state, an emotion, or an action)
 *   <A>_to_<B>.mp4                     transition A → B
 *   <A>_exit_<dir>.mp4                 A → off
 *   off_enter_<dir>[_<outfit>].mp4     off → the standing anchor (of that outfit)
 *   lines/line_<name>.mp4 (+ .wav .txt)  a stored line, at the start anchor
 *   plate.png                          empty scene (scene packs), or the full-screen photo
 *   scene.json                         the photo's size and her region on it (from 做场景…)
 * An anchor may carry an outfit: `stand@jk`. Outfits only change off screen.
 *
 * Pure: no file system, so it is tested in Node.
 */

export const STATES = ['idle', 'listen', 'think', 'talk', 'sleep'] as const
export const EMOTIONS = ['happy', 'shy', 'pout', 'sad', 'angry', 'surprised', 'sleepy'] as const

export type ClipRole = 'state' | 'emotion' | 'action' | 'transition' | 'line'

export interface ClipSpec {
  id: string
  /** Source file, relative to the source folder. */
  source: string
  from: string
  to: string
  role: ClipRole
  /** state name, emotion name, or action id, depending on role. */
  name: string
  interruptible: boolean
  /** Stored lines: their audio and words. */
  audio?: string
  transcript?: string
}

export interface MacroSpec {
  action: string
  desc: string
  /** Walk to this anchor (through whatever clips lead there), then play `then` if given. */
  goTo: string
  then?: string
}

export interface InferredPack {
  anchors: Record<string, { image?: string }>
  start: string
  clips: ClipSpec[]
  macros: MacroSpec[]
  plate?: string
  /** Files that matched nothing. */
  unknown: string[]
}

const ACTION_WORDS: Record<string, string> = {
  wave: '挥手打招呼',
  touched: '被轻轻戳了一下的反应',
  show: '展示身上的衣服',
  dance: '跟着节奏轻轻摇摆',
  nod: '点头',
}

const ANCHOR = '[a-z]+(?:@[a-z0-9]+)?'
const LOOP = new RegExp(`^(${ANCHOR})_([a-z]+)_(\\d+)\\.(?:mp4|mov|webm)$`)
const TRANSITION = new RegExp(`^(${ANCHOR})_to_(${ANCHOR})\\.(?:mp4|mov|webm)$`)
const EXIT = new RegExp(`^(${ANCHOR})_exit_([a-z]+)\\.(?:mp4|mov|webm)$`)
const ENTER = /^off_enter_([a-z]+)(?:_([a-z0-9]+))?\.(?:mp4|mov|webm)$/
const ANCHOR_IMAGE = new RegExp(`^anchor_(${ANCHOR})\\.(?:png|jpg|jpeg)$`)
const LINE = /^lines\/line_([a-z0-9_]+)\.(?:mp4|mov|webm)$/

export function actionDesc(id: string): string {
  const base = id.includes('_') ? id.slice(id.lastIndexOf('_') + 1) : id
  return ACTION_WORDS[base] ?? id
}

/** The pose part of an anchor (`stand@jk` → `stand`) and its outfit. */
export function splitAnchor(anchor: string): { pose: string; outfit?: string } {
  const at = anchor.indexOf('@')
  return at < 0 ? { pose: anchor } : { pose: anchor.slice(0, at), outfit: anchor.slice(at + 1) }
}

/** Infer the pack from its file list (paths relative to the folder, `/` separated). */
export function inferPack(files: string[], read: (path: string) => string | undefined = () => undefined): InferredPack {
  const anchors: InferredPack['anchors'] = {}
  const clips: ClipSpec[] = []
  const unknown: string[] = []
  let plate: string | undefined
  const set = new Set(files)
  const touch = (anchor: string) => { anchors[anchor] ??= {} }

  for (const file of [...files].sort()) {
    const name = file.split('/').at(-1)!
    if (name.startsWith('.')) continue
    // Old versions and working folders ("测试版/") sit beside the clips; only lines/ is part of the pack.
    if (file.includes('/') && !file.startsWith('lines/')) continue
    let m: RegExpExecArray | null
    if ((m = ANCHOR_IMAGE.exec(file)) !== null) {
      touch(m[1]!)
      anchors[m[1]!]!.image = file
    } else if (file === 'plate.png' || file === 'plate.jpg') {
      plate = file
    } else if (file === 'scene.json' || file === 'crop.png' || file === 'crop.jpg' || /^plate_[\w-]+\.(png|jpe?g)$/.test(file)) {
      // Written by "做场景…": where her region is on the photo (read by the importer), the cut-out to generate clips from,
      // and the same photo in other shapes (listed in scene.json).
    } else if (/\.(txt|md)$/.test(file)) {
      // Notes beside the clips: prompts, instructions, the redo list.
    } else if ((m = TRANSITION.exec(file)) !== null) {
      touch(m[1]!); touch(m[2]!)
      clips.push({ id: name.replace(/\.\w+$/, ''), source: file, from: m[1]!, to: m[2]!, role: 'transition', name: 'transition', interruptible: false })
    } else if ((m = EXIT.exec(file)) !== null) {
      touch(m[1]!); touch('off')
      clips.push({ id: name.replace(/\.\w+$/, ''), source: file, from: m[1]!, to: 'off', role: 'transition', name: 'exit', interruptible: false })
    } else if ((m = ENTER.exec(file)) !== null) {
      // Resolved below, once every anchor is known.
      touch('off')
      clips.push({ id: name.replace(/\.\w+$/, ''), source: file, from: 'off', to: m[2] === undefined ? '' : `@${m[2]}`, role: 'transition', name: 'enter', interruptible: false })
    } else if ((m = LINE.exec(file)) !== null) {
      const base = file.replace(/\.\w+$/, '')
      const audio = ['.wav', '.mp3', '.m4a'].map(ext => base + ext).find(p => set.has(p))
      const transcript = read(`${base}.txt`)?.trim()
      clips.push({
        id: `line_${m[1]!}`, source: file, from: '', to: '', role: 'line', name: `line_${m[1]!}`, interruptible: true,
        ...(audio === undefined ? {} : { audio }), ...(transcript === undefined ? {} : { transcript }),
      })
    } else if ((m = LOOP.exec(file)) !== null) {
      const [, anchor, role] = m as unknown as [string, string, string]
      touch(anchor)
      const outfit = splitAnchor(anchor).outfit
      const kind: ClipRole = (STATES as readonly string[]).includes(role) ? 'state' : (EMOTIONS as readonly string[]).includes(role) ? 'emotion' : 'action'
      clips.push({
        id: name.replace(/\.\w+$/, ''), source: file, from: anchor, to: anchor, role: kind,
        name: kind === 'action' && outfit !== undefined ? `${outfit}_${role}` : role,
        interruptible: true,
      })
    } else if (!/\.(wav|mp3|m4a|txt)$/.test(file)) {
      unknown.push(file)
    }
  }

  const poses = Object.keys(anchors).filter(a => a !== 'off')
  const base = poses.filter(a => splitAnchor(a).outfit === undefined)
  const start = ['stand', 'sit'].find(a => anchors[a] !== undefined) ?? base[0] ?? poses[0] ?? 'off'
  // `off_enter_<dir>` comes back to the standing pose; `_<outfit>` to that pose in the outfit.
  for (const clip of clips) {
    if (clip.role === 'transition' && clip.from === 'off') {
      clip.to = clip.to === '' ? start : `${splitAnchor(start).pose}${clip.to}`
      touch(clip.to)
    }
    if (clip.role === 'line') {
      clip.from = start
      clip.to = start
    }
  }

  const macros: MacroSpec[] = []
  const outfits = [...new Set(Object.keys(anchors).map(a => splitAnchor(a).outfit).filter((o): o is string => o !== undefined))]
  for (const outfit of outfits) {
    const target = `${splitAnchor(start).pose}@${outfit}`
    if (!clips.some(c => c.from === 'off' && c.to === target)) continue
    const show = clips.find(c => c.role === 'action' && c.from === target && c.name === `${outfit}_show`)
    macros.push({ action: `outfit_${outfit}`, desc: `离开画面，换上 ${outfit} 再回来${show === undefined ? '' : '展示'}`, goTo: target, ...(show === undefined ? {} : { then: show.name }) })
  }
  if (outfits.length > 0 && clips.some(c => c.from === 'off' && c.to === start)) {
    macros.push({ action: 'outfit_default', desc: '离开画面，换回原来的衣服再回来', goTo: start })
  }
  return { anchors, start, clips, macros, ...(plate === undefined ? {} : { plate }), unknown }
}
