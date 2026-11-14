/**
 * 设计包 (docs/设计包格式.md): the one agreement between designers and the
 * body engine. A zip with `design.json` and the files it uses — a character,
 * her 编排 and its materials, a skin, an opening clip, any of them. This file
 * reads and checks one; it writes nothing. Pure.
 */

import type { ZipEntry } from './zip.ts'

export const DESIGN_FORMAT = 'dsh-her-design@1'
export const DESIGN_ROWS = ['avatar', 'desktop', 'pet', 'intro', 'sheet'] as const
export type DesignRow = typeof DESIGN_ROWS[number]
export const MAX_DESIGN_BYTES = 500 * 1024 * 1024
export const MAX_DESIGN_FILES = 300

const MATERIAL = /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|m4v)$/i
const SKIN_FILE = /\.(json|png|jpe?g|webp|gif|avif|svg|woff2?|ttf|otf|mp4|webm|mov|m4v|css)$/i
const COVER = /^cover\.(png|jpe?g|webp)$/i

export interface DesignCharacter {
  name: string
  persona: string
  callYou?: string
  pronoun?: '他' | '她' | 'TA'
  voice?: { id: string; speed: number }
  sheet?: string
}

export interface DesignManifest {
  format: typeof DESIGN_FORMAT
  id: string
  name: string
  version: string
  author: string
  license: string
  homepage?: string
  description?: string
  engine?: string
  cover?: string
  character?: DesignCharacter
  stage?: string
  skin?: string
  intro?: { material: string; when: 'every' | 'daily' }
}

const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : undefined)

/** Read design.json: what is wrong is said, what can be used is kept; no manifest when the must-haves are missing. */
export function parseDesignManifest(raw: unknown): { manifest?: DesignManifest; problems: string[] } {
  const problems: string[] = []
  if (typeof raw !== 'object' || raw === null) return { problems: ['design.json 不是一个 JSON 对象'] }
  const v = raw as Record<string, unknown>
  if (v.format !== DESIGN_FORMAT) problems.push(`format 要写 "${DESIGN_FORMAT}"（现在是 ${JSON.stringify(v.format ?? null)}）`)
  const id = typeof v.id === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(v.id) ? v.id : undefined
  if (id === undefined) problems.push('id 要用小写字母、数字和 -，2–40 个字')
  const name = text(v.name, 40)
  if (name === undefined) problems.push('缺少 name')
  const version = text(v.version, 20)
  if (version === undefined) problems.push('缺少 version')
  const author = text(v.author, 60)
  if (author === undefined) problems.push('缺少 author')
  const license = text(v.license, 200)
  if (license === undefined) problems.push('缺少 license：要写清许可，用户装之前要看')
  if (problems.length > 0 && (id === undefined || name === undefined || license === undefined || v.format !== DESIGN_FORMAT)) return { problems }
  const manifest: DesignManifest = { format: DESIGN_FORMAT, id: id!, name: name!, version: version ?? '0', author: author ?? '（没写）', license: license! }
  const homepage = text(v.homepage, 300)
  if (homepage !== undefined) {
    if (/^https:\/\//i.test(homepage)) manifest.homepage = homepage
    else problems.push('homepage 要是 https:// 开头的地址')
  }
  const description = text(v.description, 400)
  if (description !== undefined) manifest.description = description
  const engine = text(v.engine, 20)
  if (engine !== undefined) {
    if (/^\d+\.\d+\.\d+$/.test(engine)) manifest.engine = engine
    else problems.push('engine 要写成 0.9.0 这样的版本号')
  }
  const cover = text(v.cover, 80)
  if (cover !== undefined) manifest.cover = cover
  if (v.character !== undefined) {
    const c = v.character as Record<string, unknown>
    const cname = text(c?.name, 20)
    const persona = text(c?.persona, 3000)
    if (cname === undefined || persona === undefined) problems.push('character 要有 name（20 字以内）和 persona')
    else {
      const character: DesignCharacter = { name: cname, persona }
      const callYou = text(c.callYou, 20)
      if (callYou !== undefined) character.callYou = callYou
      if (c.pronoun === '他' || c.pronoun === '她' || c.pronoun === 'TA') character.pronoun = c.pronoun
      const voice = c.voice as { id?: unknown; speed?: unknown } | undefined
      if (voice !== undefined) {
        if (typeof voice.id === 'string' && /^[\w:.\-一-鿿]{1,80}$/.test(voice.id)) {
          character.voice = { id: voice.id, speed: typeof voice.speed === 'number' && Number.isFinite(voice.speed) ? Math.min(2, Math.max(0.5, voice.speed)) : 1 }
        } else problems.push('character.voice.id 不对')
      }
      const sheet = text(c.sheet, 80)
      if (sheet !== undefined) character.sheet = sheet
      manifest.character = character
    }
  }
  const stage = text(v.stage, 80)
  if (stage !== undefined) manifest.stage = stage
  const skin = text(v.skin, 80)
  if (skin !== undefined) manifest.skin = skin
  if (v.intro !== undefined) {
    const intro = v.intro as { material?: unknown; when?: unknown }
    const material = text(intro?.material, 80)
    if (material === undefined) problems.push('intro.material 要写 library/intro 里一个素材的名字')
    else manifest.intro = { material, when: intro.when === 'every' ? 'every' : 'daily' }
  }
  return { manifest, problems }
}

/** A design pack's files, sorted out. */
export interface DesignPlan {
  manifest: DesignManifest
  /** Materials by row: name (file name without its extension) → its file. */
  materials: Record<DesignRow, Array<{ name: string; file: string; data: Uint8Array }>>
  stage?: unknown
  skinFiles: Array<{ name: string; data: Uint8Array }>
  cover?: { file: string; data: Uint8Array }
  /** Files left out, and why. */
  skipped: string[]
  problems: string[]
  bytes: number
}

const nameOf = (file: string) => file.replace(/\.[^.]+$/, '')

/** Sort a zip's files into the parts of a design pack, checking what can be checked without writing anything. */
export function planDesign(entries: readonly ZipEntry[]): { plan?: DesignPlan; problems: string[] } {
  const files = entries.filter(e => !/(^|\/)(__MACOSX|\.)/.test(e.name))
  if (files.length > MAX_DESIGN_FILES) return { problems: [`文件太多了（${files.length} 个，最多 ${MAX_DESIGN_FILES} 个）`] }
  const manifestEntry = files.find(e => e.name.split('/').pop() === 'design.json' && e.name.split('/').length <= 2)
  if (manifestEntry === undefined) return { problems: ['zip 里没有 design.json：这不是一个设计包（皮肤 zip 请在「皮肤」页上传）'] }
  const base = manifestEntry.name.slice(0, manifestEntry.name.length - 'design.json'.length)
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestEntry.data))
  } catch (error) {
    return { problems: [`design.json 读不了：${(error as Error).message}`] }
  }
  const { manifest, problems } = parseDesignManifest(raw)
  if (manifest === undefined) return { problems }
  const plan: DesignPlan = { manifest, materials: { avatar: [], desktop: [], pet: [], intro: [], sheet: [] }, skinFiles: [], skipped: [], problems, bytes: 0 }
  const skinDir = manifest.skin === undefined ? undefined : `${manifest.skin.replace(/\/+$/, '')}/`
  for (const entry of files) {
    if (!entry.name.startsWith(base) || entry === manifestEntry) continue
    const path = entry.name.slice(base.length)
    plan.bytes += entry.data.length
    if (path === 'README.md') continue
    const parts = path.split('/')
    if (parts[0] === 'library' && parts.length === 3 && (DESIGN_ROWS as readonly string[]).includes(parts[1]!) && MATERIAL.test(parts[2]!)) {
      plan.materials[parts[1] as DesignRow].push({ name: nameOf(parts[2]!), file: parts[2]!, data: entry.data })
    } else if (skinDir !== undefined && path.startsWith(skinDir) && parts.length === 2 && SKIN_FILE.test(parts[1]!)) {
      plan.skinFiles.push({ name: parts[1]!, data: entry.data })
    } else if (manifest.stage !== undefined && path === manifest.stage) {
      try {
        plan.stage = JSON.parse(new TextDecoder().decode(entry.data))
      } catch (error) {
        problems.push(`${path} 读不了：${(error as Error).message}`)
      }
    } else if (path === manifest.cover || (manifest.cover === undefined && COVER.test(path))) {
      plan.cover = { file: path, data: entry.data }
    } else plan.skipped.push(path)
  }
  if (plan.bytes > MAX_DESIGN_BYTES) return { problems: [`太大了（解开有 ${Math.round(plan.bytes / 1024 / 1024)} MB，最多 500 MB）`] }
  if (manifest.stage !== undefined && plan.stage === undefined && !problems.some(p => p.includes(manifest.stage!))) problems.push(`design.json 说有编排 ${manifest.stage}，但 zip 里没有`)
  if (manifest.skin !== undefined && !plan.skinFiles.some(f => f.name === 'skin.json')) problems.push(`design.json 说有皮肤 ${manifest.skin}/，但里面没有 skin.json`)
  if (manifest.character?.sheet !== undefined && !plan.materials.sheet.some(m => m.name === manifest.character!.sheet)) problems.push(`三视图「${manifest.character.sheet}」不在 library/sheet 里`)
  if (manifest.intro !== undefined && !plan.materials.intro.some(m => m.name === manifest.intro!.material)) problems.push(`开机动画「${manifest.intro.material}」不在 library/intro 里`)
  // Two files of one name in a row (发呆.mp4 and 发呆.webm): the second cannot be told apart.
  for (const row of DESIGN_ROWS) {
    const seen = new Set<string>()
    plan.materials[row] = plan.materials[row].filter(m => (seen.has(m.name) ? (plan.skipped.push(`library/${row}/${m.file}（和另一个文件同名）`), false) : (seen.add(m.name), true)))
  }
  const has = manifest.character !== undefined || plan.stage !== undefined || plan.skinFiles.length > 0 || manifest.intro !== undefined || DESIGN_ROWS.some(r => plan.materials[r].length > 0)
  if (!has) return { problems: [...problems, '这个设计包里什么都没有'] }
  return { plan, problems }
}

/** Whether `have` is at least `need` (plain x.y.z versions). */
export function versionAtLeast(have: string, need: string): boolean {
  const a = have.split(/[.-]/).map(n => Number.parseInt(n, 10) || 0)
  const b = need.split(/[.-]/).map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}

/** Names a material can take without clashing: the name, else "name（pack）", else with a number. */
export function freeName(name: string, taken: (name: string) => boolean, pack: string): string {
  if (!taken(name)) return name
  const tagged = `${name}（${pack}）`.slice(0, 80)
  if (!taken(tagged)) return tagged
  for (let n = 2; ; n++) if (!taken(`${tagged}-${n}`)) return `${tagged}-${n}`
}
