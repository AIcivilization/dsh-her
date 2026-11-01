/**
 * 形象工坊 on disk: each project is a folder under `~/Documents/dsh-her 素材`
 * (where the user can see it and drop files in), with
 *
 *   形象.json              the project (character card, scenes, clips)
 *   参考图提示词.txt        how to make 参考图.png, her "ID photo"
 *   参考图.png             (the user's) — also the desk pet's anchor
 *   生成清单.md            every clip: first frame, file, prompt
 *   MiniMax生成任务.md      the same, as a task for MiniMax Code (when that is the tool)
 *   ComfyUI生成清单.json    the same, for a ComfyUI script (when that is the tool)
 *   桌宠/提示词.txt         + the desk pet's clips
 *   场景-卧室/提示词.txt     + 照片提示词.txt, plate.png, scene.json, crop.png, clips
 *
 * A part's minimum is one idle clip (without talk clips her mouth does not
 * move, but she is there). A video whose name matches nothing is listed as a
 * stray, so the page can ask which clip it is.
 *
 * The prompts are rewritten on every save; the user's pictures and clips are
 * never touched. Importing hands the folders to the body (same computer).
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clipList, comfyuiList, DESK_DIR, EXAMPLE_FILES, EXAMPLE_SLOTS, minimaxTask, PROJECT_FILE, promptsFile, REFERENCE_FILE, referencePrompt, safeName, sceneDir, scenePhotoPrompt, validateProject,
  type ClipPlan, type Generator, type LookProject, type WorkshopCard,
} from '../core/workshop.ts'

export const MATERIALS_DIR = join(homedir(), 'Documents', 'dsh-her 素材')

export interface PartStatus {
  /** 桌宠, or the scene's name. */
  name: string
  folder: string
  /** Clips planned, and how many of them are in the folder. */
  planned: number
  made: number
  /** The minimum (one idle clip) is there. */
  enough: boolean
  /** The clips in the folder, by planned name. */
  have: string[]
  /** Videos in the folder whose names match no clip: which clip each is, the user says. */
  strays: string[]
  /** Scenes: the photo, and her region framed on it (scene.json and crop.png). */
  photo?: boolean
  framed?: boolean
}

export interface ProjectStatus {
  dir: string
  reference: boolean
  parts: PartStatus[]
  /** Something can be imported: at least one part has its minimum (and a scene its frame). */
  importable: boolean
}

function readProject(dir: string): LookProject | undefined {
  try {
    return validateProject(JSON.parse(readFileSync(join(dir, PROJECT_FILE), 'utf8')))
  } catch {
    return undefined
  }
}

/** Every project in the materials folder, newest first. */
export function listProjects(root = MATERIALS_DIR): Array<{ project: LookProject; status: ProjectStatus }> {
  if (!existsSync(root)) return []
  const out: Array<{ project: LookProject; status: ProjectStatus }> = []
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('.')) continue
    const dir = join(root, entry)
    const project = readProject(dir)
    if (project !== undefined) out.push({ project, status: projectStatus(project, dir) })
  }
  return out.sort((a, b) => b.project.createdAt.localeCompare(a.project.createdAt))
}

export function findProject(id: string, root = MATERIALS_DIR): { project: LookProject; dir: string } | undefined {
  const found = listProjects(root).find(p => p.project.id === id)
  return found === undefined ? undefined : { project: found.project, dir: found.status.dir }
}

const has = (dir: string, file: string) => existsSync(join(dir, file))

const CLIP_TYPES = ['.mp4', '.mov', '.webm']
const hasClip = (folder: string, name: string) => CLIP_TYPES.some(type => existsSync(join(folder, `${name}${type}`)))
/** A name the importer understands by itself (pose_role_nn). */
const IMPORTER_NAME = /^[a-z]+(?:@[a-z0-9]+)?_[a-z0-9_]+$/

function straysIn(folder: string, clips: readonly ClipPlan[]): string[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder).filter(file => {
    const type = extname(file).toLowerCase()
    const name = basename(file, extname(file))
    return !file.startsWith('.') && CLIP_TYPES.includes(type) && !clips.some(clip => clip.file === name) && !IMPORTER_NAME.test(name)
  })
}

function partClips(project: LookProject, folder: string): ClipPlan[] | undefined {
  return folder === DESK_DIR ? project.desk.clips : project.scenes.find(scene => sceneDir(scene) === folder)?.clips
}

export function projectStatus(project: LookProject, dir: string): ProjectStatus {
  const parts: PartStatus[] = []
  const count = (folder: string, clips: LookProject['desk']['clips']) => {
    const planned = clips.filter(c => c.off !== true)
    const here = join(dir, folder)
    const have = clips.filter(c => hasClip(here, c.file)).map(c => c.file)
    const made = planned.filter(c => have.includes(c.file))
    const enough = have.some(file => /_idle_\d+$/.test(file))
    return { planned: planned.length, made: made.length, enough, have, strays: straysIn(here, clips) }
  }
  if (project.desk.on) parts.push({ name: '桌宠', folder: DESK_DIR, ...count(DESK_DIR, project.desk.clips) })
  for (const scene of project.scenes) {
    const folder = sceneDir(scene)
    const photo = ['plate.png', 'plate.jpg'].some(f => has(join(dir, folder), f))
    const framed = has(join(dir, folder), 'scene.json') && has(join(dir, folder), 'crop.png')
    parts.push({ name: scene.name, folder, ...count(folder, scene.clips), photo, framed })
  }
  const reference = has(dir, REFERENCE_FILE)
  return { dir, reference, parts, importable: parts.some(p => p.enough && p.framed !== false && (p.folder !== DESK_DIR || reference || has(join(dir, DESK_DIR), 'anchor_stand.png'))) }
}

/**
 * Write a project: its folder (made on first save, named after it), 形象.json
 * and every prompt file. Pictures and clips already there stay as they are.
 */
export function saveProject(input: unknown, screen?: { width: number; height: number }, root = MATERIALS_DIR): { project: LookProject; status: ProjectStatus } {
  const project = validateProject(input)
  const existing = findProject(project.id, root)
  let dir = existing?.dir
  if (dir === undefined) {
    const base = safeName(project.name)
    dir = join(root, existsSync(join(root, base)) ? `${base}-${project.id}` : base)
  }
  mkdirSync(dir, { recursive: true })
  const write = (file: string, text: string) => {
    writeFileSync(`${file}.tmp`, text)
    renameSync(`${file}.tmp`, file)
  }
  write(join(dir, PROJECT_FILE), `${JSON.stringify(project, null, 2)}\n`)
  write(join(dir, '参考图提示词.txt'), [
    `${project.name} · 参考图（她的"身份证"）`,
    '',
    `用文生图工具（豆包、即梦等）生成，存成 ${REFERENCE_FILE} 放在这个文件夹里。之后每个场景的照片都要把它当参考图，她才是同一个人。`,
    '',
    referencePrompt(project),
    '',
  ].join('\n'))
  write(join(dir, '生成清单.md'), clipList(project, dir))
  // The tool's own task file; another tool's, left from before, goes.
  const taskFiles: Array<[string, Generator, (p: LookProject, d: string) => string]> = [['MiniMax生成任务.md', 'minimax', minimaxTask], ['ComfyUI生成清单.json', 'comfyui', comfyuiList]]
  for (const [file, generator, make] of taskFiles) {
    if (project.generator === generator) write(join(dir, file), make(project, dir))
    else rmSync(join(dir, file), { force: true })
  }
  if (project.desk.on) {
    mkdirSync(join(dir, DESK_DIR), { recursive: true })
    write(join(dir, DESK_DIR, '提示词.txt'), promptsFile(project, 'desk'))
  }
  for (const scene of project.scenes) {
    const folder = join(dir, sceneDir(scene))
    mkdirSync(folder, { recursive: true })
    write(join(folder, '照片提示词.txt'), [
      `${project.name} · ${scene.name} · 全屏照片`,
      '',
      `用文生图工具生成，把上一层的 ${REFERENCE_FILE} 放进"参考图 / 保持人物一致"。存成 plate.png 放在这个文件夹，然后在「她」页面的形象工坊里点"框人物区"。`,
      '',
      scenePhotoPrompt(project, scene, screen),
      '',
    ].join('\n'))
    write(join(folder, '提示词.txt'), promptsFile(project, scene))
  }
  return { project, status: projectStatus(project, dir) }
}

/** A stray video is this clip: it takes the clip's name, and a clip that was unticked is ticked. */
export function assignClip(id: string, folder: string, file: string, clip: string, screen?: { width: number; height: number }, root = MATERIALS_DIR): { project: LookProject; status: ProjectStatus } {
  const found = findProject(id, root)
  if (found === undefined) throw new Error('找不到这个项目')
  const clips = partClips(found.project, folder)
  if (clips === undefined) throw new Error('这个项目没有这部分')
  const target = clips.find(c => c.file === clip)
  if (target === undefined) throw new Error('清单里没有这一段')
  const here = join(found.dir, folder)
  if (!straysIn(here, clips).includes(file)) throw new Error(`找不到 ${file}`)
  if (hasClip(here, clip)) throw new Error(`${clip} 已经有视频了`)
  renameSync(join(here, file), join(here, `${clip}${extname(file).toLowerCase()}`))
  if (target.off !== true) return { project: found.project, status: projectStatus(found.project, found.dir) }
  delete target.off
  return saveProject(found.project, screen, root)
}

/** Delete a stray video the user does not want (only a stray, never a clip or anything else). */
export function removeStray(id: string, folder: string, file: string, root = MATERIALS_DIR): ProjectStatus {
  const found = findProject(id, root)
  if (found === undefined) throw new Error('找不到这个项目')
  const clips = partClips(found.project, folder)
  if (clips === undefined) throw new Error('这个项目没有这部分')
  const here = join(found.dir, folder)
  if (!straysIn(here, clips).includes(file)) throw new Error(`找不到 ${file}`)
  rmSync(join(here, file))
  return projectStatus(found.project, found.dir)
}

/** Before importing: the desk pet's anchor is the reference picture. */
export function prepareImport(project: LookProject, dir: string): void {
  if (project.desk.on && has(dir, REFERENCE_FILE) && !has(join(dir, DESK_DIR), 'anchor_stand.png')) {
    copyFileSync(join(dir, REFERENCE_FILE), join(dir, DESK_DIR, 'anchor_stand.png'))
  }
}

/** The settings of a project: what export copies without "pictures and videos". */
const SETTINGS = new Set(['.json', '.txt', '.md'])

/** Every file of a folder (relative paths), skipping MiniMax's scratch and hidden files. */
function filesOf(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...filesOf(path, `${prefix}${entry}/`))
    else out.push(prefix + entry)
  }
  return out
}

/** A folder name in `parent` that is not taken yet: name, name-2, name-3 … */
function freeDir(parent: string, name: string): string {
  let dir = join(parent, name)
  for (let n = 2; existsSync(dir); n++) dir = join(parent, `${name}-${n}`)
  return dir
}

/**
 * Copy a project to another folder (`dest`/<its name>): its settings
 * (形象.json, the prompts, scene.json), and with `media` its pictures and
 * clips too. The copy can be imported anywhere with importProject.
 */
export function exportProject(id: string, dest: string, media: boolean, root = MATERIALS_DIR): { dir: string; files: number } {
  const found = findProject(id, root)
  if (found === undefined) throw new Error('找不到这个项目')
  if (resolve(dest).startsWith(resolve(found.dir))) throw new Error('不能导出到项目自己的文件夹里')
  const dir = freeDir(dest, basename(found.dir))
  let files = 0
  for (const file of filesOf(found.dir)) {
    if (!media && !SETTINGS.has(extname(file).toLowerCase())) continue
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    copyFileSync(join(found.dir, file), join(dir, file))
    files++
  }
  return { dir, files }
}

/**
 * Bring a project in from elsewhere: a folder with 形象.json in it, or the
 * 形象.json itself. It becomes a new project in the materials folder (a new
 * id if one with its id is there already), with whatever pictures and clips
 * came along; the prompts are written afresh.
 */
export function importProject(path: string, screen?: { width: number; height: number }, root = MATERIALS_DIR): { project: LookProject; status: ProjectStatus } {
  const source = statSync(path).isDirectory() ? path : dirname(path)
  const file = statSync(path).isDirectory() ? join(path, PROJECT_FILE) : path
  if (!existsSync(file)) throw new Error(`这个文件夹里没有 ${PROJECT_FILE}`)
  let project: LookProject
  try {
    project = validateProject(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    throw new Error(`${basename(file)} 读不懂：${(error as Error).message}`)
  }
  const existing = findProject(project.id, root)
  if (existing !== undefined && resolve(existing.dir) === resolve(source)) throw new Error('这个项目已经在形象工坊里了')
  if (existing !== undefined) project = { ...project, id: `p${Date.now().toString(36)}` }
  mkdirSync(root, { recursive: true })
  const dir = freeDir(root, safeName(project.name))
  for (const name of filesOf(source)) {
    if (name === PROJECT_FILE) continue
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    copyFileSync(join(source, name), join(dir, name))
  }
  writeFileSync(join(dir, PROJECT_FILE), `${JSON.stringify(project, null, 2)}\n`)
  return saveProject(project, screen, root)
}

/** Where examples are looked for: the user's own first, then the plugin's. */
export function exampleDirs(home: string): string[] {
  return [join(home, 'examples', 'workshop'), fileURLToPath(new URL('../../examples/workshop/', import.meta.url))]
}

/** The file to serve for an example slot, if it has been put in place. */
export function exampleFile(home: string, file: string): string | undefined {
  if (!EXAMPLE_FILES.has(file)) return undefined
  return exampleDirs(home).map(d => join(d, file)).find(f => existsSync(f))
}

/** Every card's example slots and whether each is there yet. */
export function examples(home: string): Array<{ card: WorkshopCard; file: string; label: string; ready: boolean }> {
  return (Object.entries(EXAMPLE_SLOTS) as Array<[WorkshopCard, typeof EXAMPLE_SLOTS[WorkshopCard]]>).flatMap(([card, slots]) =>
    slots.map(slot => ({ card, ...slot, ready: exampleFile(home, slot.file) !== undefined })))
}
