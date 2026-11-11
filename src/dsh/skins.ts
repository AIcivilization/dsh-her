/**
 * Skins on disk: the built-in ones, and folders under `<home>/skins/<id>/`
 * (a skin.json and its files). The one in use is in `<home>/skin.json`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { BUILTIN_SKINS, parseSkin, type Skin } from '../core/skin.ts'

const FILES = /\.(json|png|jpe?g|webp|gif|avif|woff2?|ttf|otf|mp4|webm|mov|m4v|css)$/i

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
    if (!/^[\w\-一-鿿]{1,40}$/.test(id) || BUILTIN_SKINS.some(s => s.id === id) || name.startsWith('.') || !FILES.test(extname(name))) return undefined
    const target = resolve(this.root, id, name)
    return target.startsWith(resolve(this.root, id) + sep) ? target : undefined
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
