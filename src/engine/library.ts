/**
 * 素材库 (docs/设置页与编排设计.md §2): one folder per row under
 * `<home>/library/`, a file's name (without its extension) is the
 * material's name. Removing moves the file into `<home>/library/.removed/`
 * rather than deleting it.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { checkMaterial, cleanSvg, parseFfmpegInfo, type MaterialInfo } from '../pack/material-check.ts'
import { borderColor, ffmpegCommand, keyToAlpha } from '../pack/media.ts'
import { extname, join, resolve, sep } from 'node:path'

/**
 * The rows that keep files here (皮肤 has its own folders); `intro` holds
 * opening clips (§4.5), `sheet` the character's 三视图 and other reference
 * pictures everything else is made from (§14).
 */
export const LIBRARY_ROWS = ['avatar', 'desktop', 'pet', 'intro', 'sheet'] as const
export type LibraryRow = typeof LIBRARY_ROWS[number]

const VIDEO = new Set(['.mp4', '.webm', '.mov', '.m4v'])
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])

export interface Material {
  name: string
  file: string
  kind: 'video' | 'image'
  size: number
  /** ms since epoch. */
  addedAt: number
  /** Size, length, transparency, once looked at (§2.2). */
  info?: MaterialInfo
  /** What does not fit the spec, and what will happen. */
  warnings?: string[]
}

interface InfoCache {
  [file: string]: { mtime: number; info: MaterialInfo }
}

export const isLibraryRow = (row: string): row is LibraryRow => (LIBRARY_ROWS as readonly string[]).includes(row)
export const materialKind = (file: string): Material['kind'] | undefined => {
  const ext = extname(file).toLowerCase()
  return VIDEO.has(ext) ? 'video' : IMAGE.has(ext) ? 'image' : undefined
}
const nameOf = (file: string) => file.slice(0, file.length - extname(file).length)

/** A name that stays one plain file name: no folders, nothing hidden, not too long. */
export function cleanName(name: string): string | undefined {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed.length > 80 || trimmed.startsWith('.') || /[/\\:*?"<>|\u0000-\u001f]/.test(trimmed)) return undefined
  return trimmed
}

export class Library {
  readonly root: string

  constructor(home: string) {
    this.root = join(home, 'library')
  }

  private dir(row: LibraryRow): string {
    return join(this.root, row)
  }

  list(row: LibraryRow): Material[] {
    const dir = this.dir(row)
    if (!existsSync(dir)) return []
    const out: Material[] = []
    for (const file of readdirSync(dir).sort((a, b) => a.localeCompare(b, 'zh'))) {
      const kind = materialKind(file)
      if (file.startsWith('.') || kind === undefined) continue
      const info = statSync(join(dir, file))
      if (!info.isFile()) continue
      const known = this.cache()[`${row}/${file}`]
      const looked = known !== undefined && known.mtime === Math.floor(info.mtimeMs) ? known.info : undefined
      out.push({ name: nameOf(file), file, kind, size: info.size, addedAt: info.mtimeMs, ...(looked === undefined ? {} : { info: looked, warnings: checkMaterial(row, looked) }) })
    }
    return out
  }

  all(): Record<LibraryRow, Material[]> {
    return Object.fromEntries(LIBRARY_ROWS.map(row => [row, this.list(row)])) as Record<LibraryRow, Material[]>
  }

  /** Where an upload of `file` to `row` goes; undefined when it is not a picture or a clip, or not a plain name. */
  target(row: string, file: string): string | undefined {
    if (!isLibraryRow(row) || materialKind(file) === undefined) return undefined
    const name = cleanName(nameOf(file))
    if (name === undefined) return undefined
    const target = resolve(this.dir(row), `${name}${extname(file).toLowerCase()}`)
    return target.startsWith(resolve(this.dir(row)) + sep) ? target : undefined
  }

  /** The file of a material, to show it. */
  path(row: string, name: string): string | undefined {
    if (!isLibraryRow(row)) return undefined
    const material = this.list(row).find(m => m.name === name)
    return material === undefined ? undefined : join(this.dir(row), material.file)
  }

  rename(row: string, from: string, to: string): void {
    if (!isLibraryRow(row)) throw new Error('没有这一行')
    const material = this.list(row).find(m => m.name === from)
    if (material === undefined) throw new Error(`素材库里没有"${from}"`)
    const name = cleanName(to)
    if (name === undefined) throw new Error('名字不能为空，不能有 / \\ : * ? " < > |，也不能以 . 开头')
    if (name !== from && this.list(row).some(m => m.name === name)) throw new Error(`已经有一个叫"${name}"的了`)
    renameSync(join(this.dir(row), material.file), join(this.dir(row), `${name}${extname(material.file)}`))
  }

  private cache(): InfoCache {
    try {
      return JSON.parse(readFileSync(join(this.root, '.info.json'), 'utf8')) as InfoCache
    } catch {
      return {}
    }
  }

  /** Materials not looked at yet. */
  unexamined(): Array<{ row: LibraryRow; name: string }> {
    return LIBRARY_ROWS.flatMap(row => this.list(row).filter(m => m.info === undefined).map(m => ({ row, name: m.name })))
  }

  /** Look at a material once (ffmpeg): its size, length, transparency; kept in `.info.json`. */
  async examine(row: LibraryRow, name: string): Promise<MaterialInfo | undefined> {
    const material = this.list(row).find(m => m.name === name)
    if (material === undefined) return undefined
    const path = join(this.dir(row), material.file)
    let info: MaterialInfo
    if (/\.svg$/i.test(material.file)) info = { kind: 'image', alpha: true, bytes: material.size }
    else {
      const text = await new Promise<string>(resolve => {
        execFile(ffmpegCommand(), ['-hide_banner', '-i', path], { timeout: 30_000 }, (_error, _stdout, stderr) => resolve(String(stderr)))
      })
      info = parseFfmpegInfo(text, material.kind, material.size)
      if (info.width === undefined) return undefined
    }
    const cache = this.cache()
    cache[`${row}/${material.file}`] = { mtime: Math.floor(statSync(path).mtimeMs), info }
    mkdirSync(this.root, { recursive: true })
    writeFileSync(join(this.root, '.info.json.tmp'), JSON.stringify(cache))
    renameSync(join(this.root, '.info.json.tmp'), join(this.root, '.info.json'))
    return info
  }

  /**
   * "抠掉背景": a copy of the material with its plain background (the colour
   * along its top edge) made transparent; the original stays. Its name.
   */
  async keyOut(row: string, name: string): Promise<string> {
    if (!isLibraryRow(row)) throw new Error('没有这一行')
    const material = this.list(row).find(m => m.name === name)
    if (material === undefined) throw new Error(`素材库里没有"${name}"`)
    if (/\.svg$/i.test(material.file)) throw new Error('SVG 本来就是透明的')
    const input = join(this.dir(row), material.file)
    let made = cleanName(`${name}-透明`) ?? `${name}-t`
    for (let i = 2; this.list(row).some(m => m.name === made); i++) made = `${name}-透明${i}`
    const ext = material.kind === 'video' ? '.webm' : '.png'
    const output = join(this.dir(row), `${made}${ext}`)
    const part = join(this.root, `.keying-${Date.now()}${ext}`)
    try {
      // A clip's background is read from its first frame.
      await keyToAlpha(input, part, await borderColor(input))
      renameSync(part, output)
    } catch (error) {
      try { rmSync(part, { force: true }) } catch { /* nothing made */ }
      const text = (error as Error).message
      throw new Error(/libvpx|Unknown encoder|Encoder not found/i.test(text) ? '这台电脑上的 ffmpeg 不能做带透明的视频（缺 VP9 编码）' : `没抠成：${text.split('\n').pop() ?? text}`)
    }
    return made
  }

  /** An uploaded SVG made safe to show (nothing in it runs); whether anything was taken out. */
  cleanSvg(path: string): boolean {
    if (!/\.svg$/i.test(path)) return false
    const { svg, removed } = cleanSvg(readFileSync(path, 'utf8'))
    if (removed) writeFileSync(path, svg)
    return removed
  }

  /** Out of the library, into `.removed` (kept, not deleted). */
  remove(row: string, name: string): void {
    if (!isLibraryRow(row)) throw new Error('没有这一行')
    const material = this.list(row).find(m => m.name === name)
    if (material === undefined) throw new Error(`素材库里没有"${name}"`)
    const bin = join(this.root, '.removed', row)
    mkdirSync(bin, { recursive: true })
    renameSync(join(this.dir(row), material.file), join(bin, `${Date.now()}-${material.file}`))
  }
}
