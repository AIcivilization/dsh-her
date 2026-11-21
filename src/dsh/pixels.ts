/**
 * 像素动画 on disk (docs/像素动画设计.md §5): the ones that come with her, and
 * folders under `<home>/pixels/<id>/` (anim.js and meta.json: its info, a
 * still, how long a frame took when it was tried). Shared by all characters,
 * like skins. The chat background's settings are in `<home>/pixel-background.json`.
 *
 * The code is never run here: it is tried in the page's sandbox before it is
 * sent, and runs only in a sandbox.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_PIXELS } from '../core/pixel-builtins.ts'
import { cleanBackground, cleanPixelInfo, PIXEL_ID, wrapPixelCode, type PixelBackground, type PixelInfo } from '../core/pixel.ts'

export interface PixelEntry {
  id: string
  name: string
  builtin: boolean
  about?: string
  info?: PixelInfo
  /** A PNG data URL of the middle frame. */
  thumb?: string
  frameMs?: number
  added?: number
}

const FOLDER = /^[\w\-一-鿿]{1,40}$/
const THUMB = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/

/** Make a folder name from an animation's name. */
export const pixelId = (name: string): string => name.trim().replace(/\s+/g, '-').replace(/[^\w\-一-鿿]/g, '').slice(0, 40)

export class Pixels {
  private readonly root: string
  private readonly bgFile: string

  constructor(home: string) {
    this.root = join(home, 'pixels')
    this.bgFile = join(home, 'pixel-background.json')
  }

  list(): PixelEntry[] {
    const own: PixelEntry[] = []
    if (existsSync(this.root)) {
      for (const id of readdirSync(this.root).sort()) {
        if (id.startsWith('.') || !FOLDER.test(id) || !existsSync(join(this.root, id, 'anim.js'))) continue
        let meta: Record<string, unknown> = {}
        try {
          meta = JSON.parse(readFileSync(join(this.root, id, 'meta.json'), 'utf8')) as Record<string, unknown>
        } catch {
          // still listed, with its folder name
        }
        const info = cleanPixelInfo(meta.info).info
        own.push({
          id, name: typeof meta.name === 'string' && meta.name !== '' ? meta.name : id, builtin: false,
          ...(info === undefined ? {} : { info }),
          ...(typeof meta.thumb === 'string' && THUMB.test(meta.thumb) ? { thumb: meta.thumb } : {}),
          ...(typeof meta.frameMs === 'number' ? { frameMs: meta.frameMs } : {}),
          ...(typeof meta.added === 'number' ? { added: meta.added } : {}),
        })
      }
    }
    return [...BUILTIN_PIXELS.map(b => ({ id: b.id, name: b.name, builtin: true, about: b.about })), ...own]
  }

  get(id: string): PixelEntry | undefined {
    return this.list().find(e => e.id === id)
  }

  code(id: string): string | undefined {
    const builtin = BUILTIN_PIXELS.find(b => b.id === id)
    if (builtin !== undefined) return builtin.code
    if (!FOLDER.test(id)) return undefined
    const file = join(this.root, id, 'anim.js')
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined
  }

  /**
   * Keep a file the page has tried: its code, and what the try found (info,
   * a still, the slowest frame). A file we cannot run is refused here too.
   */
  add(input: { name: string; code: string; info: unknown; thumb?: unknown; frameMs?: unknown; label?: string }): string {
    return this.put(undefined, input)
  }

  /** Write over one of one's own (像素工坊's 保存 again); its name may change, its id does not. `label`: the name shown, instead of the file's own. */
  update(id: string, input: { name: string; code: string; info: unknown; thumb?: unknown; frameMs?: unknown; label?: string }): string {
    if (!FOLDER.test(id) || !existsSync(join(this.root, id, 'anim.js'))) throw new Error('没有这个像素动画')
    return this.put(id, input)
  }

  private put(existing: string | undefined, input: { name: string; code: string; info: unknown; thumb?: unknown; frameMs?: unknown; label?: string }): string {
    const wrapped = wrapPixelCode(input.code)
    if (wrapped.script === undefined) throw new Error(wrapped.problems.join('；'))
    const { info, problems } = cleanPixelInfo(input.info)
    if (info === undefined) throw new Error(problems.join('；'))
    let id = existing ?? [input.name, info.name].map(pixelId).find(n => n !== '') ?? `pixel-${Date.now().toString(36)}`
    if (existing === undefined) for (let n = 2; existsSync(join(this.root, id)); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
    const dir = join(this.root, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'anim.js'), input.code)
    const thumb = typeof input.thumb === 'string' && input.thumb.length < 600_000 && THUMB.test(input.thumb) ? input.thumb : undefined
    const name = input.label !== undefined && input.label.trim() !== '' ? input.label.trim().slice(0, 40) : info.name
    writeFileSync(join(dir, 'meta.json'), `${JSON.stringify({
      name, info, ...(thumb === undefined ? {} : { thumb }),
      ...(typeof input.frameMs === 'number' && Number.isFinite(input.frameMs) ? { frameMs: input.frameMs } : {}), added: Date.now(),
    }, null, 2)}\n`)
    return id
  }

  /**
   * Keep a file that came in a 设计包, not tried yet (nothing runs here): its
   * still and info are made in the page's sandbox when the list is shown.
   */
  addUntried(name: string, code: string): string {
    const wrapped = wrapPixelCode(code)
    if (wrapped.script === undefined) throw new Error(wrapped.problems.join('；'))
    let id = pixelId(name) || `pixel-${Date.now().toString(36)}`
    for (let n = 2; existsSync(join(this.root, id)); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
    const dir = join(this.root, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'anim.js'), code)
    writeFileSync(join(dir, 'meta.json'), `${JSON.stringify({ name, added: Date.now() }, null, 2)}\n`)
    return id
  }

  /** Out of the list, into `.removed` (kept). */
  remove(id: string): void {
    if (BUILTIN_PIXELS.some(b => b.id === id)) throw new Error('自带的像素动画不能移走')
    if (!FOLDER.test(id) || !existsSync(join(this.root, id, 'anim.js'))) throw new Error('没有这个像素动画')
    mkdirSync(join(this.root, '.removed'), { recursive: true })
    renameSync(join(this.root, id), join(this.root, '.removed', `${Date.now()}-${id}`))
  }

  background(): PixelBackground {
    try {
      return cleanBackground(JSON.parse(readFileSync(this.bgFile, 'utf8')))
    } catch {
      return cleanBackground({})
    }
  }

  setBackground(change: unknown): PixelBackground {
    const now = this.background()
    const c = typeof change === 'object' && change !== null ? change as Record<string, unknown> : {}
    if (typeof c.id === 'string' && (!PIXEL_ID.test(c.id) || this.code(c.id) === undefined)) throw new Error('没有这个像素动画')
    const next = cleanBackground({
      ...now, ...c,
      look: { ...now.look, ...(typeof c.look === 'object' && c.look !== null ? c.look : {}) },
      triggers: { ...now.triggers, ...(typeof c.triggers === 'object' && c.triggers !== null ? c.triggers : {}) },
    })
    mkdirSync(join(this.bgFile, '..'), { recursive: true })
    writeFileSync(this.bgFile, `${JSON.stringify(next)}\n`)
    return next
  }

  /** The background as dsh's pages wear it: only when it is on and its animation is there. */
  worn(): PixelBackground | undefined {
    const bg = this.background()
    return bg.on && this.code(bg.id) !== undefined ? bg : undefined
  }
}
