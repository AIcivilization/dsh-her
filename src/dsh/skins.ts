/**
 * Skins on disk: the built-in ones, and folders under `<home>/skins/<id>/`
 * (a skin.json and its files). The one in use is in `<home>/skin.json`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { BUILTIN_SKINS, parseSkin, type Skin } from '../core/skin.ts'
import { makeZip, readZip } from '../core/zip.ts'
import { cleanSvg } from '../pack/material-check.ts'

const FILES = /\.(json|png|jpe?g|webp|gif|avif|svg|woff2?|ttf|otf|mp4|webm|mov|m4v|css)$/i
const ID = /^[\w\-一-鿿]{1,40}$/

/** A skin's CSS file must not reach out of the page (no url(), no @import). */
export const safeSkinCss = (css: string): boolean => !/url\s*\(|@import|expression\s*\(/i.test(css)

/** Make an id from a name: letters, digits, Chinese and -. */
export const skinId = (name: string): string => name.trim().replace(/\s+/g, '-').replace(/[^\w\-一-鿿]/g, '').slice(0, 40)

export interface SkinEntry {
  skin: Skin
  problems: string[]
  /** When its files last changed (ms), so pages load it again. */
  rev: number
}

export class Skins {
  private readonly root: string
  private readonly home: string

  constructor(home: string) {
    this.home = home
    this.root = join(home, 'skins')
  }

  list(): SkinEntry[] {
    const own: SkinEntry[] = []
    if (existsSync(this.root)) {
      for (const id of readdirSync(this.root).sort()) {
        if (id.startsWith('.') || !existsSync(join(this.root, id, 'skin.json'))) continue
        const dir = join(this.root, id)
        const files = readdirSync(dir)
        let raw: unknown
        try {
          raw = JSON.parse(readFileSync(join(dir, 'skin.json'), 'utf8'))
        } catch (error) {
          own.push({ skin: { id, name: id }, problems: [`skin.json 读不了：${(error as Error).message}`], rev: 0 })
          continue
        }
        const { skin, problems } = parseSkin(raw, id, files)
        if (skin === undefined) continue
        const rev = Math.max(...files.map(f => statSync(join(dir, f)).mtimeMs))
        own.push({ skin, problems, rev: Math.floor(rev) })
      }
    }
    return [...BUILTIN_SKINS.map(skin => ({ skin, problems: [], rev: 0 })), ...own]
  }

  get(id: string): SkinEntry | undefined {
    return this.list().find(e => e.skin.id === id)
  }

  /** The skin in use; undefined: dsh as it is. */
  current(): string | undefined {
    try {
      const id = (JSON.parse(readFileSync(join(this.home, 'skin.json'), 'utf8')) as { id?: unknown }).id
      return typeof id === 'string' && this.get(id) !== undefined ? id : undefined
    } catch {
      return undefined
    }
  }

  use(id: string | undefined): void {
    if (id !== undefined && this.get(id) === undefined) throw new Error('没有这套皮肤')
    mkdirSync(this.home, { recursive: true })
    writeFileSync(join(this.home, 'skin.json'), `${JSON.stringify({ id: id ?? null })}\n`)
  }

  /** A file of a skin, to serve it. */
  file(id: string, name: string): string | undefined {
    if (!/^[\w\-一-鿿]+$/.test(id) || !/^[^/\\]+$/.test(name) || name.startsWith('.')) return undefined
    const path = join(this.root, id, name)
    return existsSync(path) ? path : undefined
  }

  /** Where an uploaded file of skin `id` goes: flat inside its folder, only the kinds a skin has. */
  target(id: string, file: string): string | undefined {
    const name = file.split(/[/\\]/).pop() ?? ''
    if (!ID.test(id) || BUILTIN_SKINS.some(s => s.id === id) || name.startsWith('.') || !FILES.test(extname(name))) return undefined
    const target = resolve(this.root, id, name)
    return target.startsWith(resolve(this.root, id) + sep) ? target : undefined
  }

  /** A skin of one's own as a zip: its folder's files, under a folder of its id (to send to someone). */
  zip(id: string): Uint8Array {
    if (BUILTIN_SKINS.some(s => s.id === id)) throw new Error('自带的皮肤不用下载')
    const dir = join(this.root, id)
    if (!ID.test(id) || !existsSync(join(dir, 'skin.json'))) throw new Error('没有这套皮肤')
    const names = readdirSync(dir).filter(name => !name.startsWith('.') && FILES.test(extname(name)) && statSync(join(dir, name)).isFile())
    return makeZip(names.map(name => ({ name: `${id}/${name}`, data: readFileSync(join(dir, name)) })))
  }

  /**
   * A skin from a zip (made by the download above, or by hand): its
   * skin.json wherever it is in the zip, and the files beside it. Its id: the
   * folder it was in, else its name, else `fallback`; one already taken gets
   * -2, -3 …. What a skin cannot have is left out and said.
   */
  importZip(zip: Uint8Array, fallback: string): { id: string; skipped: string[] } {
    const entries = readZip(zip).filter(e => !/(^|\/)(__MACOSX|\.)/.test(e.name))
    const manifest = entries.find(e => e.name.split('/').pop() === 'skin.json')
    if (manifest === undefined) throw new Error('zip 里没有 skin.json')
    const base = manifest.name.slice(0, manifest.name.length - 'skin.json'.length)
    let parsed: { name?: unknown }
    try {
      parsed = JSON.parse(new TextDecoder().decode(manifest.data)) as { name?: unknown }
    } catch (error) {
      throw new Error(`skin.json 读不了：${(error as Error).message}`)
    }
    const folder = base.replace(/\/$/, '').split('/').pop() ?? ''
    let id = skinId(folder) || skinId(typeof parsed.name === 'string' ? parsed.name : '') || skinId(fallback) || `skin${Date.now().toString(36)}`
    if (BUILTIN_SKINS.some(s => s.id === id)) id = `${id}-mine`
    for (let n = 2; existsSync(join(this.root, id)); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
    const skipped: string[] = []
    const dir = join(this.root, id)
    mkdirSync(dir, { recursive: true })
    try {
      for (const entry of entries) {
        if (!entry.name.startsWith(base)) continue
        const name = entry.name.slice(base.length)
        // Notes for people (the template's README) are not part of the skin, and not worth a warning.
        if (/\.(md|txt)$/i.test(name)) continue
        const target = name.includes('/') ? undefined : this.target(id, name)
        if (target === undefined) {
          skipped.push(name)
          continue
        }
        if (/\.svg$/i.test(name)) writeFileSync(target, cleanSvg(new TextDecoder().decode(entry.data)).svg)
        else if (/\.css$/i.test(name) && !safeSkinCss(new TextDecoder().decode(entry.data))) skipped.push(`${name}（里面有 url() 或 @import）`)
        else writeFileSync(target, entry.data)
      }
    } catch (error) {
      rmSync(dir, { recursive: true, force: true })
      throw error
    }
    return { id, skipped }
  }

  /** Out of the list, into `.removed` (kept). */
  remove(id: string): void {
    if (BUILTIN_SKINS.some(s => s.id === id)) throw new Error('自带的皮肤不能移走')
    if (!existsSync(join(this.root, id, 'skin.json'))) throw new Error('没有这套皮肤')
    mkdirSync(join(this.root, '.removed'), { recursive: true })
    renameSync(join(this.root, id), join(this.root, '.removed', `${Date.now()}-${id}`))
    if (this.current() === undefined) this.use(undefined)
  }
}
