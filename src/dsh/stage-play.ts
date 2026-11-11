/**
 * Playing 编排 (docs/设置页与编排设计.md §3): the stage becomes a look the
 * bodies already know — `look:stage` — so its scene rules, the 20-minute
 * stay, locking and asking her by name all keep working. The desktop row
 * gives the look's scenes, 初始's pet its desk pet. Cells of library clips
 * become small development packs (`stage-<row>-<scene>`), their clips
 * played in turn while she idles. Her small picture is not in the look:
 * the brain picks it from the avatar row as things happen.
 *
 * Not yet: a moment (her speaking, a touch) changing the desktop or the pet.
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { cleanPlace, LOOK_FORMAT, type Look, type LookScene, type LookWhen } from '../pack/look.ts'
import { layerOf, type Cell, type Scene, type Stage, type When } from '../pack/stage.ts'
import { ffmpegCommand } from '../pack/media.ts'
import type { Library } from './library.ts'

export const STAGE_LOOK = 'stage'
export const STAGE_LOOK_ID = `look:${STAGE_LOOK}`

/** A stage condition as a look's rule, when a look can say it. */
function lookWhen(whens: readonly When[] | undefined): LookWhen | undefined | 'none' {
  if (whens === undefined || whens.length === 0) return 'none'
  // Chosen by her, by you or by chance: the brain sends the bodies there, the look needs no rule.
  if (whens.every(w => w.on === 'she-chooses' || w.on === 'you-ask' || w.on === 'random')) return 'none'
  for (const when of whens) {
    if (when.on === 'hours') return { hours: when.hours }
    if (when.on === 'active' || when.on === 'idle') return { user: when.on }
    if (when.on === 'all') {
      const out: LookWhen = {}
      for (const part of when.of) {
        if (part.on === 'hours') out.hours = part.hours
        else if (part.on === 'active' || part.on === 'idle') out.user = part.on
        else return undefined
      }
      return out
    }
  }
  return undefined
}

/**
 * A picture as a clip the bodies can play: a few seconds of it standing
 * still (transparent pictures keep their transparency, as WebM). Made once
 * per picture and kept in `<home>/library/.clips/`.
 */
function clipOfPicture(home: string, row: string, path: string): string | undefined {
  const alpha = /\.(png|webp|gif)$/i.test(path) && row === 'pet'
  const out = join(home, 'library', '.clips', row, `${basename(path)}-${Math.floor(statSync(path).mtimeMs).toString(36)}.${alpha ? 'webm' : 'mp4'}`)
  if (existsSync(out)) return out
  mkdirSync(dirname(out), { recursive: true })
  const codec = alpha ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-tune', 'stillimage']
  const made = spawnSync(ffmpegCommand(), ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', path, '-t', '6', '-r', '10', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', ...codec, `${out}.part.${alpha ? 'webm' : 'mp4'}`], { timeout: 120_000 })
  if (made.status !== 0) {
    rmSync(`${out}.part.${alpha ? 'webm' : 'mp4'}`, { force: true })
    return undefined
  }
  renameSync(`${out}.part.${alpha ? 'webm' : 'mp4'}`, out)
  return out
}

/** Make a pack folder from the clips (and pictures) of a cell; its id, or why not. */
function packFromCell(home: string, packsDir: string, library: Library, row: 'desktop' | 'pet', sceneId: string, sceneName: string, cell: Cell, existing: ReadonlySet<string>): { id?: string; note?: string } {
  const pack = cell.use.find(u => u.startsWith('pack:') && existing.has(u.slice(5)))
  const notes: string[] = []
  const clips = cell.use
    .filter(u => !u.startsWith('pack:'))
    .flatMap(name => {
      const path = library.path(row, name)
      if (path === undefined) return []
      if (/\.(mp4|webm|mov|m4v)$/i.test(path)) return [{ name, path }]
      const clip = clipOfPicture(home, row, path)
      if (clip === undefined) notes.push(`${sceneName}·${name}：图片转成视频没成功（要用 ffmpeg），这一个先不算`)
      return clip === undefined ? [] : [{ name, path: clip }]
    })
  if (clips.length === 0) {
    if (pack !== undefined) return { id: pack.slice(5), ...(notes.length === 0 ? {} : { note: notes.join('；') }) }
    return { note: notes.length > 0 ? notes.join('；') : `${sceneName}·${row === 'desktop' ? '桌面' : '宠物'}：没有能播的东西，这一格先不算` }
  }
  const id = `${STAGE_LOOK}-${row}-${sceneId}`.replace(/[^\w-]/g, '_')
  const dir = join(packsDir, id)
  mkdirSync(dir, { recursive: true })
  const files = clips.map((clip, i) => {
    const file = `m${i}${extname(clip.path).toLowerCase()}`
    try {
      linkSync(clip.path, join(dir, file))
    } catch {
      copyFileSync(clip.path, join(dir, file))
    }
    return { id: `m${i}`, file, desc: clip.name }
  })
  const alpha = clips.every(c => /\.webm$/i.test(c.path))
  const manifest = { name: id, title: `编排·${sceneName}`, layer: row === 'desktop' ? 'scene' : 'overlay', layout: row === 'pet' && alpha ? 'alpha' : 'opaque', clips: files }
  writeFileSync(join(dir, 'clips.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  if (pack !== undefined) notes.push(`${sceneName}：同一格里有外形也有视频，先用视频`)
  return { id, ...(notes.length === 0 ? {} : { note: notes.join('；') }) }
}

/**
 * Write `<home>/looks/stage/look.json` (and the packs it needs) from the
 * stage. Returns what could not be played yet, in words; undefined look when
 * nothing in it can be shown.
 */
export function compileStage(stage: Stage, home: string, packsDir: string, library: Library, packIds: readonly string[]): { look?: Look; notes: string[] } {
  const notes: string[] = []
  // The packs made last time go; this stage makes its own.
  if (existsSync(packsDir)) for (const entry of readdirSync(packsDir)) if (entry.startsWith(`${STAGE_LOOK}-`)) rmSync(join(packsDir, entry), { recursive: true, force: true })
  const existing = new Set(packIds.filter(id => !id.startsWith(`${STAGE_LOOK}-`)))
  const base = stage.scenes[0]!
  const scenes: LookScene[] = []
  const made = (row: 'desktop' | 'pet', scene: Scene): string | undefined => {
    const cell = scene.cells[row]
    if (cell === undefined || cell.use.length === 0) return undefined
    const result = packFromCell(home, packsDir, library, row, scene.id, scene.name, cell, existing)
    if (result.note !== undefined) notes.push(result.note)
    return result.id
  }
  const desk = made('pet', base)
  const baseDesktop = made('desktop', base)
  stage.scenes.forEach((scene, index) => {
    if (index > 0 && scene.off === true) return
    if (index > 0 && layerOf(scene, index) === 3) {
      if (scene.cells.desktop !== undefined || scene.cells.pet !== undefined) notes.push(`${scene.name}：她开口、被碰这类一下子的事，现在只换头像，桌面和宠物先不跟着换`)
      return
    }
    const when = index === 0 ? 'none' : lookWhen(scene.when)
    if (when === undefined) {
      notes.push(`${scene.name}：这种时机（比如安静时段）桌面和宠物还跟不上，只换头像`)
      return
    }
    const own = index === 0 ? baseDesktop : made('desktop', scene)
    const pet = index === 0 ? undefined : made('pet', scene)
    // An empty desktop cell is "as below": 初始's desktop, so the scene can still bring its pet.
    const pack = own ?? (pet !== undefined ? baseDesktop ?? desk : undefined)
    if (pack === undefined) return
    scenes.push({ id: scene.id, name: scene.name, pack, ...(pet === undefined ? {} : { desk: pet }), ...(when === 'none' ? {} : { when }) })
  })
  // No desktop at all: she floats, and the look still needs a scene.
  if (scenes.length === 0 && desk !== undefined) scenes.push({ id: base.id, name: base.name, pack: desk })
  if (scenes.length === 0) {
    notes.push('桌面和宠物都还没有能播的东西：至少给"初始"的桌面或宠物选一个')
    return { notes }
  }
  const stay = typeof stage.desktopStayMinutes === 'number' ? stage.desktopStayMinutes : undefined
  const pet = cleanPlace((stage.place as { pet?: unknown } | undefined)?.pet)
  const look: Look = {
    format: LOOK_FORMAT, id: STAGE_LOOK, name: `编排·${stage.name}`,
    ...(desk === undefined ? {} : { desk }),
    scenes, default: scenes.find(s => s.id === base.id)?.id ?? scenes[0]!.id,
    ...(stay === undefined ? {} : { minStayMinutes: stay }),
    ...(pet === undefined ? {} : { place: { pet } }),
  }
  const dir = join(home, 'looks', STAGE_LOOK)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'look.json.tmp'), `${JSON.stringify(look, null, 2)}\n`)
  renameSync(join(dir, 'look.json.tmp'), join(dir, 'look.json'))
  return { look, notes }
}

/** Take the stage's look and its packs away (she stopped playing it); made again when she plays it again. */
export function removeStageLook(home: string, packsDir: string): void {
  rmSync(join(home, 'looks', STAGE_LOOK), { recursive: true, force: true })
  if (existsSync(packsDir)) for (const entry of readdirSync(packsDir)) if (entry.startsWith(`${STAGE_LOOK}-`)) rmSync(join(packsDir, entry), { recursive: true, force: true })
}

/** Whether she plays the stage, and what she wore before, to go back to. In `<home>/stages/play.json`. */
export interface PlayState {
  on: boolean
  before?: string
}

export function readPlay(home: string): PlayState {
  try {
    const value = JSON.parse(readFileSync(join(home, 'stages', 'play.json'), 'utf8')) as Partial<PlayState>
    return { on: value.on === true, ...(typeof value.before === 'string' ? { before: value.before } : {}) }
  } catch {
    return { on: false }
  }
}

export function writePlay(home: string, play: PlayState): void {
  mkdirSync(join(home, 'stages'), { recursive: true })
  writeFileSync(join(home, 'stages', 'play.json'), `${JSON.stringify(play)}\n`)
}
