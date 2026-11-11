/**
 * 编排 (docs/设置页与编排设计.md §3): rows are kinds of things (皮肤, 头像,
 * 桌面, 宠物 …), columns are scenes, a cell is what a row shows in a scene.
 * An empty cell means "as below": each row falls through the scenes that are
 * on now, from the highest layer down, to the first scene (初始).
 *
 * The file is meant to be written by hand too, so reading it keeps every
 * field it does not know and reports problems in words instead of dropping
 * things. Pure: no file system, tested in Node.
 */

import { inHours, type Look, type LookWhen } from './look.ts'

export const STAGE_FORMAT = 'dsh-her-stage@1'

/** The rows there are now; a stage may name more (a newer version's, or its own). */
export const ROWS = ['skin', 'avatar', 'desktop', 'pet'] as const
export type KnownRow = typeof ROWS[number]
export const ROW_NAMES: Record<KnownRow, string> = { skin: '皮肤', avatar: '头像', desktop: '桌面', pet: '宠物' }

/** How a cell with several things in it picks the next one. */
export type PickMode = 'rotate' | 'random'

export interface Cell {
  /** Names in the library of that row (or `pack:<id>`, an imported look that plays its own states). */
  use: string[]
  pick?: PickMode
  [field: string]: unknown
}

/** When a scene comes up. A scene with several comes up when any one holds. */
export type When =
  | { on: 'her-speaking' }
  | { on: 'you-speaking' }
  | { on: 'thinking' }
  | { on: 'touched'; part?: 'head' | 'body'; kind?: 'tap' | 'long' }
  | { on: 'back' }
  | { on: 'opening' }
  | { on: 'active' }
  | { on: 'idle' }
  | { on: 'hours'; hours: string }
  | { on: 'quiet-hours' }
  | { on: 'random'; everyMinutes: [number, number] }
  | { on: 'she-chooses' }
  | { on: 'you-ask' }
  /** Every one of these at once ("早上 7–10 点，并且你在用电脑"). */
  | { on: 'all'; of: When[] }

export type WhenKind = When['on']
export const WHEN_KINDS: WhenKind[] = ['her-speaking', 'you-speaking', 'thinking', 'touched', 'back', 'opening', 'active', 'idle', 'hours', 'quiet-hours', 'random', 'she-chooses', 'you-ask', 'all']

/** How long a scene stays: played once, as long as its condition holds, or some minutes. */
export type Hold = 'once' | 'while' | { minutes: number }

export interface Scene {
  id: string
  name: string
  /** One line for her: what this scene is, so she can choose it herself. */
  about?: string
  when?: When[]
  hold?: Hold
  /** Switched off for now, kept. */
  off?: boolean
  cells: Record<string, Cell>
  [field: string]: unknown
}

export interface Stage {
  format: typeof STAGE_FORMAT
  name: string
  rows: string[]
  /** The first is 初始: what every row shows when nothing else is on. */
  scenes: Scene[]
  [field: string]: unknown
}

/**
 * Which layer a scene is in (§3.5), higher wins: something happening now
 * (3) over a scene she or you chose (2) over a lasting condition (1) over
 * 初始 (0). A scene with conditions of several layers is in the highest.
 */
export function layerOf(scene: Scene, index: number): number {
  if (index === 0) return 0
  let layer = 1
  const visit = (whens: readonly When[]) => {
    for (const when of whens) {
      if (['her-speaking', 'you-speaking', 'thinking', 'touched', 'back', 'opening'].includes(when.on)) layer = 3
      else if ((when.on === 'she-chooses' || when.on === 'you-ask' || when.on === 'random') && layer < 2) layer = 2
      else if (when.on === 'all') visit(when.of)
    }
  }
  visit(scene.when ?? [])
  return layer
}

/** What is going on now, as the body and the brain know it. */
export interface Situation {
  herSpeaking?: boolean
  youSpeaking?: boolean
  thinking?: boolean
  touched?: { part: 'head' | 'body'; kind: 'tap' | 'long' }
  back?: boolean
  opening?: boolean
  /** You are at the computer, or have not touched it for a while; undefined: not known. */
  user?: 'active' | 'idle'
  hour: number
  quiet?: boolean
  /** Scenes chosen by her or by you (or by chance) that are still holding. */
  chosen?: string[]
}

function holds(when: When, now: Situation, sceneId: string): boolean {
  switch (when.on) {
    case 'her-speaking': return now.herSpeaking === true
    case 'you-speaking': return now.youSpeaking === true
    case 'thinking': return now.thinking === true
    case 'touched': return now.touched !== undefined && (when.part === undefined || when.part === now.touched.part) && (when.kind === undefined || when.kind === now.touched.kind)
    case 'back': return now.back === true
    case 'opening': return now.opening === true
    case 'active': return now.user === 'active'
    case 'idle': return now.user === 'idle'
    case 'hours': return inHours(when.hours, now.hour)
    case 'quiet-hours': return now.quiet === true
    case 'random': case 'she-chooses': case 'you-ask': return now.chosen?.includes(sceneId) === true
    case 'all': return when.of.length > 0 && when.of.every(w => holds(w, now, sceneId))
  }
}

/**
 * The scenes on now, highest first: by layer, then within a layer the one
 * further right first (§3.5). 初始 is always last.
 */
export function scenesOn(stage: Stage, now: Situation): Scene[] {
  const on = stage.scenes
    .map((scene, index) => ({ scene, index, layer: layerOf(scene, index) }))
    .filter(({ scene, index }) => index === 0 || (scene.off !== true && (scene.when ?? []).some(w => holds(w, now, scene.id))))
  on.sort((a, b) => b.layer - a.layer || b.index - a.index)
  return on.map(o => o.scene)
}

/** What one row shows now: the first scene on that has something in this row ("as below" otherwise). */
export function cellFor(stage: Stage, row: string, on: Scene[]): { scene: Scene; cell: Cell } | undefined {
  for (const scene of on) {
    const cell = scene.cells[row]
    if (cell !== undefined && cell.use.length > 0) return { scene, cell }
  }
  return undefined
}

/** What every row shows now. */
export function resolveStage(stage: Stage, now: Situation): Record<string, { scene: Scene; cell: Cell } | undefined> {
  const on = scenesOn(stage, now)
  return Object.fromEntries(stage.rows.map(row => [row, cellFor(stage, row, on)]))
}

/**
 * Picks the next thing of a cell with several: in turn, or at random but
 * never the same twice running. Remembers per scene and row.
 */
export class Picker {
  private readonly last = new Map<string, number>()
  private readonly random: () => number

  constructor(random: () => number = Math.random) {
    this.random = random
  }

  next(sceneId: string, row: string, cell: Cell): string | undefined {
    const n = cell.use.length
    if (n === 0) return undefined
    const key = `${sceneId}\u0000${row}`
    const before = this.last.get(key)
    let index: number
    if (n === 1) index = 0
    else if (cell.pick === 'random') {
      index = Math.floor(this.random() * (before === undefined ? n : n - 1))
      if (before !== undefined && index >= before) index += 1
    } else index = before === undefined ? 0 : (before + 1) % n
    this.last.set(key, index)
    return cell.use[index]
  }
}

/** A new stage with only 初始. */
export function emptyStage(name: string): Stage {
  return { format: STAGE_FORMAT, name, rows: [...ROWS], scenes: [{ id: 'base', name: '初始', cells: {} }] }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function readWhen(raw: unknown, where: string, problems: string[]): When | undefined {
  if (!isObject(raw) || typeof raw.on !== 'string') {
    problems.push(`${where}：时机要写成 { "on": … }`)
    return undefined
  }
  const on = raw.on as WhenKind
  if (!WHEN_KINDS.includes(on)) {
    problems.push(`${where}：不认识的时机 ${raw.on}`)
    return undefined
  }
  if (on === 'hours' && (typeof raw.hours !== 'string' || !/^\s*\d{1,2}\s*-\s*\d{1,2}\s*$/.test(raw.hours))) {
    problems.push(`${where}：时间段要写成 "23-7" 这样`)
    return undefined
  }
  if (on === 'random') {
    const every = raw.everyMinutes
    if (!Array.isArray(every) || every.length !== 2 || !every.every(m => typeof m === 'number' && m > 0) || every[0] > every[1]) {
      problems.push(`${where}：随机要写 "everyMinutes": [最少, 最多]（分钟）`)
      return undefined
    }
  }
  if (on === 'all') {
    if (!Array.isArray(raw.of) || raw.of.length === 0) {
      problems.push(`${where}："all" 要写 "of": [几个时机]`)
      return undefined
    }
    const of = raw.of.map((w, i) => readWhen(w, `${where}的第 ${i + 1} 个`, problems))
    if (of.some(w => w === undefined)) return undefined
    return { ...raw, on: 'all', of: of as When[] }
  }
  return raw as unknown as When
}

/**
 * Read a stage written by us or by hand. Fields it does not know are kept;
 * what cannot be used is left out and said in `problems` (a missing stage
 * or no 初始 gives no stage at all).
 */
export function parseStage(raw: unknown): { stage?: Stage; problems: string[] } {
  const problems: string[] = []
  if (!isObject(raw)) return { problems: ['编排文件不是一个 JSON 对象'] }
  if (raw.format !== STAGE_FORMAT) return { problems: [`编排文件的 format 要是 ${STAGE_FORMAT}`] }
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) return { problems: ['编排里没有场景（第一列"初始"也没有）'] }
  const rows = Array.isArray(raw.rows) && raw.rows.every(r => typeof r === 'string') ? raw.rows as string[] : [...ROWS]
  if (!Array.isArray(raw.rows)) problems.push('没写 rows，用默认的四行')
  const ids = new Set<string>()
  const scenes: Scene[] = []
  raw.scenes.forEach((value, index) => {
    const where = `第 ${index + 1} 列`
    if (!isObject(value) || typeof value.id !== 'string' || value.id === '') {
      problems.push(`${where}：要有 id，没用上`)
      return
    }
    if (ids.has(value.id)) {
      problems.push(`${where}：id ${value.id} 重复了，没用上`)
      return
    }
    ids.add(value.id)
    const name = typeof value.name === 'string' && value.name !== '' ? value.name : value.id
    const when = Array.isArray(value.when) ? value.when.map((w, i) => readWhen(w, `${name} 的第 ${i + 1} 个时机`, problems)).filter((w): w is When => w !== undefined) : undefined
    if (index > 0 && value.off !== true && (when === undefined || when.length === 0)) problems.push(`${name}：没有时机，它不会出现`)
    const cells: Record<string, Cell> = {}
    if (isObject(value.cells)) {
      for (const [row, cell] of Object.entries(value.cells)) {
        if (!isObject(cell) || !Array.isArray(cell.use) || !cell.use.every(u => typeof u === 'string')) {
          problems.push(`${name} · ${row}：格子要写成 { "use": ["素材名"] }`)
          continue
        }
        const { pick, ...rest } = cell
        const known = pick === 'rotate' || pick === 'random'
        if (pick !== undefined && !known) problems.push(`${name} · ${row}：pick 只能是 rotate 或 random，按轮换算`)
        if (!rows.includes(row)) problems.push(`${name}：有一格在 ${row} 这一行，rows 里没有它`)
        cells[row] = { ...rest, use: cell.use as string[], ...(known ? { pick } : {}) }
      }
    }
    const hold = value.hold === 'once' || value.hold === 'while' || (isObject(value.hold) && typeof value.hold.minutes === 'number' && value.hold.minutes > 0) ? value.hold as Hold : undefined
    if (value.hold !== undefined && hold === undefined) problems.push(`${name}：hold 只能是 "once"、"while" 或 { "minutes": 数字 }`)
    const scene: Scene = { ...value, id: value.id, name, cells } as Scene
    if (when === undefined) delete scene.when
    else scene.when = when
    if (hold === undefined) delete scene.hold
    scenes.push(scene)
  })
  if (scenes.length === 0) return { problems }
  return { stage: { ...raw, format: STAGE_FORMAT, name: typeof raw.name === 'string' ? raw.name : '编排', rows, scenes } as Stage, problems }
}

/** Materials named in the stage that the library does not have (`pack:` names are checked by the caller). */
export function missingMaterials(stage: Stage, library: Record<string, readonly string[]>): string[] {
  const out: string[] = []
  for (const scene of stage.scenes) {
    for (const [row, cell] of Object.entries(scene.cells)) {
      for (const name of cell.use) {
        if (name.startsWith('pack:')) continue
        if (!(library[row] ?? []).includes(name)) out.push(`${scene.name}那一格用了"${name}"，${ROW_NAMES[row as KnownRow] ?? row}的素材库里没有`)
      }
    }
  }
  return out
}

/** A look's scene rule as a stage condition: both parts at once when it has both. */
function whenFromLook(when: LookWhen | undefined): When[] {
  const parts: When[] = []
  if (when?.hours !== undefined) parts.push({ on: 'hours', hours: when.hours })
  if (when?.user !== undefined) parts.push({ on: when.user })
  if (parts.length === 0) return []
  return parts.length === 1 ? parts : [{ on: 'all', of: parts }]
}

/**
 * The stage for a look made before 编排 (§3.11): its default scene and desk
 * pet in 初始, every other scene a column of the desktop row with the same
 * rule. Each pack is used whole (`pack:<id>`), so what she does inside it —
 * talking, listening, sleeping — stays as it was.
 */
export function stageFromLook(look: Look): Stage {
  const stage = emptyStage(look.name)
  const base = stage.scenes[0]!
  const first = look.scenes.find(s => s.id === look.default) ?? look.scenes[0]
  if (first !== undefined) base.cells.desktop = { use: [`pack:${first.pack}`] }
  if (look.desk !== undefined) base.cells.pet = { use: [`pack:${look.desk}`] }
  // The old rule: a scene with more conditions wins (one about you counts double), ties go to the earlier one.
  // Here the column further right wins, so they go in that order; the default scene keeps a column of its own when it has a rule.
  const weight = (when: LookWhen | undefined) => (when?.hours === undefined ? 0 : 1) + (when?.user === undefined ? 0 : 2)
  const columns = look.scenes
    .map((scene, index) => ({ scene, index, weight: weight(scene.when) }))
    .filter(({ scene, weight }) => scene !== first || weight > 0)
    .sort((a, b) => a.weight - b.weight || b.index - a.index)
  for (const { scene } of columns) {
    const when = whenFromLook(scene.when)
    stage.scenes.push({ id: scene.id, name: scene.name, ...(when.length === 0 ? { off: true } : { when }), hold: 'while', cells: { desktop: { use: [`pack:${scene.pack}`] } } })
  }
  stage.from = { look: look.id }
  if (look.minStayMinutes !== undefined) stage.desktopStayMinutes = look.minStayMinutes
  return stage
}

/** The stage for a single imported pack: a scene pack fills the desktop row, a figure the pet row. */
export function stageFromPack(pack: { packId: string; name: string; layer: 'overlay' | 'scene' }): Stage {
  const stage = emptyStage(pack.name)
  stage.scenes[0]!.cells[pack.layer === 'scene' ? 'desktop' : 'pet'] = { use: [`pack:${pack.packId}`] }
  stage.from = { pack: pack.packId }
  return stage
}

/** A material of `row` was renamed: every cell that used it uses the new name. Whether anything changed. */
export function renameMaterial(stage: Stage, row: string, from: string, to: string): boolean {
  let changed = false
  for (const scene of stage.scenes) {
    const cell = scene.cells[row]
    if (cell === undefined) continue
    cell.use = cell.use.map(name => {
      if (name !== from) return name
      changed = true
      return to
    })
  }
  return changed
}
