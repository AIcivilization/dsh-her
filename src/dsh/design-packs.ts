/**
 * 设计包 on disk (docs/设计包格式.md): looking at one before anything is
 * written, putting the chosen parts in (a new character with her 编排 and
 * materials, a skin, an opening clip), remembering what came from whom, and
 * making one from the character of now. Never over what is there: a new
 * character, and materials and skins renamed when a name is taken.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { DESIGN_FORMAT, DESIGN_ROWS, freeName, planDesign, versionAtLeast, type DesignManifest, type DesignPlan, type DesignRow } from '../core/design-pack.ts'
import { invalidCharacter, type Character } from '../core/character.ts'
import { makeZip, readZip, type ZipEntry } from '../core/zip.ts'
import { parseStage, renameMaterial, type Stage } from '../pack/stage.ts'
import type { Characters } from './characters.ts'
import type { Library, LibraryRow } from './library.ts'
import type { Skins } from './skins.ts'
import { StageStore } from './stage-store.ts'
import { writePlay } from './stage-play.ts'

export interface DesignDepsDisk {
  home: string
  charactersDir: string
  /** This dsh-her's version, for a pack that needs a newer one. */
  version: string
  library: Library
  skins: Skins
  people: Characters
  /** The character of now: who, her folder, what she is. */
  current: () => { cid: string; dir: string; character: Character }
  /** Her opening clip: which 素材库 clip, how often (undefined: it is not one of the 素材库's). */
  intro: () => { source?: string; when: 'every' | 'daily' }
  setIntro: (source: string, when: 'every' | 'daily') => void
  /** After materials came in: look at them against the spec. */
  examine: () => void
}

/** What the page shows before anything is put in. */
export interface DesignPreview {
  token: string
  manifest: Pick<DesignManifest, 'id' | 'name' | 'version' | 'author' | 'license' | 'homepage' | 'description' | 'engine'>
  cover?: string
  character?: { name: string; persona: string }
  stage?: { scenes: number }
  skin?: { name: string }
  intro?: { name: string; when: 'every' | 'daily' }
  materials: Record<DesignRow, number>
  bytes: number
  skipped: string[]
  problems: string[]
  /** The pack wants a newer dsh-her than this. */
  newer?: string
}

export interface DesignChoice {
  /** The character, with her 编排, its materials and her 三视图. */
  character: boolean
  switchTo: boolean
  skin: boolean
  wearSkin: boolean
  intro: boolean
  setIntro: boolean
  /** Materials into the 素材库 when there is no character to take them. */
  materials: boolean
}

/** What came in from whom (for credits), in `<home>/designs.json`. */
export interface InstalledDesign {
  id: string
  name: string
  version: string
  author: string
  license: string
  homepage?: string
  at: number
  cid?: string
  character?: string
  skinId?: string
  materials: number
}

const COVER_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

export class DesignPacks {
  private readonly deps: DesignDepsDisk
  private readonly pending: string

  constructor(deps: DesignDepsDisk) {
    this.deps = deps
    this.pending = join(deps.home, 'uploads', 'designs')
  }

  private plan(token: string): DesignPlan {
    if (!/^[\w-]{8,64}$/.test(token)) throw new Error('没有这个设计包（重新选一次文件）')
    const path = join(this.pending, `${token}.zip`)
    if (!existsSync(path)) throw new Error('没有这个设计包（重新选一次文件）')
    const { plan, problems } = planDesign(readZip(readFileSync(path)))
    if (plan === undefined) throw new Error(problems.join('；'))
    return plan
  }

  /** Keep the zip for a while and say what is in it; nothing is put in yet. */
  preview(zip: Uint8Array): DesignPreview {
    const { plan, problems } = planDesign(readZip(zip))
    if (plan === undefined) throw new Error(problems.join('；'))
    // Packs looked at and not put in do not pile up.
    if (existsSync(this.pending)) for (const f of readdirSync(this.pending)) if (Date.now() - statSync(join(this.pending, f)).mtimeMs > 24 * 3_600_000) rmSync(join(this.pending, f), { force: true })
    const token = randomUUID()
    mkdirSync(this.pending, { recursive: true })
    writeFileSync(join(this.pending, `${token}.zip`), zip)
    const m = plan.manifest
    const stage = plan.stage === undefined ? undefined : parseStage(plan.stage)
    if (stage !== undefined && stage.stage === undefined) plan.problems.push(`编排用不了：${stage.problems.join('；')}`)
    const skinJson = plan.skinFiles.find(f => f.name === 'skin.json')
    let skinName: string | undefined
    try {
      skinName = skinJson === undefined ? undefined : (JSON.parse(new TextDecoder().decode(skinJson.data)) as { name?: string }).name ?? m.name
    } catch {
      plan.problems.push('皮肤的 skin.json 读不了')
    }
    const coverType = plan.cover === undefined ? undefined : COVER_TYPES[extname(plan.cover.file).toLowerCase()]
    return {
      token,
      manifest: { id: m.id, name: m.name, version: m.version, author: m.author, license: m.license, ...(m.homepage === undefined ? {} : { homepage: m.homepage }), ...(m.description === undefined ? {} : { description: m.description }), ...(m.engine === undefined ? {} : { engine: m.engine }) },
      ...(plan.cover !== undefined && coverType !== undefined && plan.cover.data.length <= 2 * 1024 * 1024 ? { cover: `data:${coverType};base64,${Buffer.from(plan.cover.data).toString('base64')}` } : {}),
      ...(m.character === undefined ? {} : { character: { name: m.character.name, persona: m.character.persona.slice(0, 200) } }),
      ...(stage?.stage === undefined ? {} : { stage: { scenes: stage.stage.scenes.length } }),
      ...(skinName === undefined ? {} : { skin: { name: skinName } }),
      ...(m.intro === undefined ? {} : { intro: { name: m.intro.material, when: m.intro.when } }),
      materials: Object.fromEntries(DESIGN_ROWS.map(r => [r, plan.materials[r].length])) as Record<DesignRow, number>,
      bytes: plan.bytes,
      skipped: plan.skipped,
      problems: plan.problems,
      ...(m.engine !== undefined && !versionAtLeast(this.deps.version, m.engine) ? { newer: m.engine } : {}),
    }
  }

  /** Put the chosen parts in. What was made, and what to know. */
  apply(token: string, choice: DesignChoice): { record: InstalledDesign; notes: string[] } {
    const plan = this.plan(token)
    const m = plan.manifest
    const { library, skins } = this.deps
    const notes: string[] = []
    const renamed: Record<string, Record<string, string>> = {}
    const put = (row: DesignRow, only?: string): number => {
      let count = 0
      for (const material of plan.materials[row]) {
        if (only !== undefined && material.name !== only) continue
        const name = freeName(material.name, n => library.path(row, n) !== undefined, m.name)
        const target = library.target(row, `${name}${extname(material.file).toLowerCase()}`)
        if (target === undefined) {
          notes.push(`素材「${material.name}」的名字放不进素材库，没装`)
          continue
        }
        mkdirSync(join(target, '..'), { recursive: true })
        writeFileSync(target, material.data)
        library.cleanSvg(target)
        if (name !== material.name) (renamed[row] ??= {})[material.name] = name
        count++
      }
      return count
    }
    const record: InstalledDesign = { id: m.id, name: m.name, version: m.version, author: m.author, license: m.license, ...(m.homepage === undefined ? {} : { homepage: m.homepage }), at: Date.now(), materials: 0 }
    const withCharacter = choice.character && m.character !== undefined
    if (withCharacter || (choice.materials && m.character === undefined)) {
      for (const row of DESIGN_ROWS) if (row !== 'intro') record.materials += put(row)
    }
    if (withCharacter) {
      const c = m.character!
      const now = this.deps.current().character
      let next: Character = {
        name: c.name, persona: c.persona, callYou: c.callYou ?? now.callYou, pronoun: c.pronoun ?? now.pronoun,
        voice: c.voice ?? now.voice, onboarded: true,
        ...(c.sheet === undefined ? {} : { sheet: renamed.sheet?.[c.sheet] ?? c.sheet }),
      }
      // A voice this dsh-her does not know: hers of now.
      if (invalidCharacter(next) !== undefined) next = { ...next, voice: now.voice }
      const problem = invalidCharacter(next)
      if (problem !== undefined) throw new Error(`人物装不进来：${problem}`)
      const cid = this.deps.people.create(next)
      record.cid = cid
      record.character = c.name
      const parsed = plan.stage === undefined ? undefined : parseStage(plan.stage).stage
      if (parsed !== undefined) {
        const stage = parsed as Stage
        for (const [row, names] of Object.entries(renamed)) for (const [from, to] of Object.entries(names)) renameMaterial(stage, row, from, to)
        const dir = join(this.deps.charactersDir, cid)
        new StageStore(dir).save(stage)
        writePlay(dir, { on: true })
      } else if (plan.stage !== undefined) notes.push('编排用不了，人物装好了但没有编排')
    } else if (plan.stage !== undefined && !choice.character) notes.push('编排跟着人物走：没装人物，编排就没装')
    if (choice.skin && plan.skinFiles.length > 0) {
      const { id, skipped } = skins.importFiles(plan.skinFiles, [m.id, m.name])
      record.skinId = id
      if (skipped.length > 0) notes.push(`皮肤里没收的文件：${skipped.join('、')}`)
      if (choice.wearSkin) skins.use(id)
    }
    if (choice.intro && m.intro !== undefined) {
      record.materials += put('intro', m.intro.material)
      const name = renamed.intro?.[m.intro.material] ?? m.intro.material
      if (choice.setIntro && library.path('intro', name) !== undefined) this.deps.setIntro(name, m.intro.when)
    }
    if (record.materials > 0) this.deps.examine()
    const list = this.installed()
    writeFileSync(join(this.deps.home, 'designs.json'), `${JSON.stringify([record, ...list].slice(0, 200), null, 1)}\n`)
    rmSync(join(this.pending, `${token}.zip`), { force: true })
    return { record, notes }
  }

  /** What came in, newest first. */
  installed(): InstalledDesign[] {
    try {
      const value = JSON.parse(readFileSync(join(this.deps.home, 'designs.json'), 'utf8')) as unknown
      return Array.isArray(value) ? value.filter((d): d is InstalledDesign => typeof d === 'object' && d !== null && typeof (d as InstalledDesign).name === 'string') : []
    } catch {
      return []
    }
  }

  /** What the character of now could go out with, for the page's choices. */
  exportable(): { character: string; stage?: { scenes: number; materials: number; skipped: string[] }; sheet?: string; skin?: string; intro?: string } {
    const { character, dir } = this.deps.current()
    const out: ReturnType<DesignPacks['exportable']> = { character: character.name }
    const stage = new StageStore(dir).load().stage
    if (stage !== undefined) {
      const { files, skipped } = this.stageMaterials(stage)
      out.stage = { scenes: stage.scenes.length, materials: files.length, skipped }
    }
    const sheet = this.sheetName(character)
    if (sheet !== undefined) out.sheet = sheet
    const skinId = this.deps.skins.current()
    const skin = skinId === undefined ? undefined : this.deps.skins.get(skinId)
    if (skin !== undefined && skin.skin.builtin !== true) out.skin = skin.skin.name
    const intro = this.deps.intro().source
    if (intro !== undefined && this.deps.library.path('intro', intro) !== undefined) out.intro = intro
    return out
  }

  private sheetName(character: Character): string | undefined {
    const sheets = this.deps.library.list('sheet').filter(m => m.kind === 'image')
    return sheets.find(m => m.name === character.sheet)?.name ?? (sheets.length === 1 ? sheets[0]!.name : undefined)
  }

  /** The 素材库 files a stage uses; cells of 外形包 cannot go out. */
  private stageMaterials(stage: Stage): { files: Array<{ row: LibraryRow; name: string; path: string }>; skipped: string[] } {
    const files = new Map<string, { row: LibraryRow; name: string; path: string }>()
    const skipped = new Set<string>()
    for (const scene of stage.scenes) {
      for (const [row, cell] of Object.entries(scene.cells)) {
        if (row === 'skin' || cell === undefined) continue
        for (const use of cell.use) {
          if (use.startsWith('pack:')) {
            skipped.add(`${scene.name}·${use.slice(5)}（外形包）`)
            continue
          }
          const path = this.deps.library.path(row, use)
          if (path === undefined) skipped.add(`${scene.name}·${use}（素材库里没有了）`)
          else files.set(`${row}/${use}`, { row: row as LibraryRow, name: use, path })
        }
      }
    }
    return { files: [...files.values()], skipped: [...skipped] }
  }

  /** A design pack of the character of now, with the parts chosen. */
  export(options: { parts: ReadonlySet<'character' | 'stage' | 'sheet' | 'skin' | 'intro'>; id: string; name: string; author: string; version: string; license: string; description?: string; homepage?: string }): { zip: Uint8Array; skipped: string[] } {
    const { character, dir } = this.deps.current()
    const id = options.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'my-design'
    if (id.length < 2) throw new Error('id 太短')
    if (options.license.trim() === '') throw new Error('要写许可')
    const files: ZipEntry[] = []
    const add = (path: string, data: Uint8Array | string) => files.push({ name: `${id}/${path}`, data: typeof data === 'string' ? new TextEncoder().encode(data) : data })
    const skipped: string[] = []
    const manifest: Record<string, unknown> = {
      format: DESIGN_FORMAT, id, name: options.name.trim().slice(0, 40) || character.name, version: options.version.trim() || '1.0.0',
      author: options.author.trim() || '（没写）', license: options.license.trim(),
      ...(options.description?.trim() ? { description: options.description.trim() } : {}),
      ...(options.homepage?.trim() && /^https:\/\//.test(options.homepage.trim()) ? { homepage: options.homepage.trim() } : {}),
      engine: this.deps.version.replace(/-.*$/, ''),
    }
    const sheet = this.sheetName(character)
    if (options.parts.has('character')) {
      manifest.character = {
        name: character.name, persona: character.persona, callYou: character.callYou, pronoun: character.pronoun, voice: character.voice,
        ...(options.parts.has('sheet') && sheet !== undefined ? { sheet } : {}),
      }
    }
    if (options.parts.has('stage')) {
      const stage = new StageStore(dir).load().stage
      if (stage === undefined) skipped.push('这个人物还没有编排')
      else {
        const used = this.stageMaterials(stage)
        skipped.push(...used.skipped)
        for (const f of used.files) add(`library/${f.row}/${f.path.split(/[/\\]/).pop()}`, readFileSync(f.path))
        add('stage.json', `${JSON.stringify(stage, null, 2)}\n`)
        manifest.stage = 'stage.json'
      }
    }
    if (options.parts.has('sheet') && sheet !== undefined) {
      const path = this.deps.library.path('sheet', sheet)!
      add(`library/sheet/${path.split(/[/\\]/).pop()}`, readFileSync(path))
    }
    if (options.parts.has('skin')) {
      const skinId = this.deps.skins.current()
      const entry = skinId === undefined ? undefined : this.deps.skins.get(skinId)
      if (entry === undefined || entry.skin.builtin === true) skipped.push('现在用的不是你自己的皮肤（自带的不用导出）')
      else {
        for (const f of readZip(this.deps.skins.zip(skinId!))) add(`skin/${f.name.split('/').pop()}`, f.data)
        manifest.skin = 'skin'
      }
    }
    if (options.parts.has('intro')) {
      const intro = this.deps.intro()
      const path = intro.source === undefined ? undefined : this.deps.library.path('intro', intro.source)
      if (path === undefined) skipped.push('开机动画不是素材库里的（用的是皮肤自带的，或者没设）')
      else {
        add(`library/intro/${path.split(/[/\\]/).pop()}`, readFileSync(path))
        manifest.intro = { material: intro.source, when: intro.when }
      }
    }
    if (manifest.character === undefined && manifest.stage === undefined && manifest.skin === undefined && manifest.intro === undefined && !files.some(f => f.name.includes('/library/'))) throw new Error('没有可以导出的东西')
    files.unshift({ name: `${id}/design.json`, data: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`) })
    const bytes = files.reduce((n, f) => n + f.data.length, 0)
    if (bytes > 500 * 1024 * 1024) throw new Error(`太大了（${Math.round(bytes / 1024 / 1024)} MB，设计包最多 500 MB）`)
    return { zip: makeZip(files), skipped }
  }
}
