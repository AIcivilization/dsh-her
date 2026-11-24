/**
 * 像素工坊的草稿 (docs/像素工坊设计.md §1.3): `<home>/pixel-drafts/<id>/`,
 * a `v<n>.js` for each version and `draft.json` (its name, look, which
 * version is shown, what each version was, the 像素动画 it was saved as).
 * At most 30 versions; past that the oldest go, but the first stays. Code is
 * only kept here, never run.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { cleanLook, DEFAULT_LOOK, wrapPixelCode, type PixelLook } from '../core/pixel.ts'

export interface DraftVersion {
  n: number
  /** What made it: "🎲 🌊 水 · 涟漪", "格子 192 × 108", "照着「浪花」". */
  note: string
  at: number
  /** The look it had when it was made (a roll brings its own); going back to it brings that back. */
  look?: PixelLook
}

export interface DraftSummary {
  id: string
  name: string
  versions: number
  saved?: string
  changed: number
}

export interface DraftView {
  id: string
  name: string
  look: PixelLook
  current: number
  versions: DraftVersion[]
  /** The code of the version shown ('' before the first). */
  code: string
  /** The 像素动画 it was saved as. */
  saved?: string
  /** Its name was given by the die (a new roll may rename it); false once you name it. */
  autoName: boolean
}

interface DraftFile {
  name: string
  autoName?: boolean
  look: PixelLook
  current: number
  versions: DraftVersion[]
  saved?: string
  changed: number
}

const ID = /^d-[a-z0-9]{6,20}$/
export const MAX_VERSIONS = 30

export class PixelDrafts {
  private readonly root: string

  constructor(home: string) {
    this.root = join(home, 'pixel-drafts')
  }

  private dir(id: string): string {
    if (!ID.test(id)) throw new Error('没有这个草稿')
    return join(this.root, id)
  }

  private read(id: string): DraftFile {
    const dir = this.dir(id)
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(readFileSync(join(dir, 'draft.json'), 'utf8')) as Record<string, unknown>
    } catch {
      throw new Error('没有这个草稿')
    }
    const versions = Array.isArray(raw.versions)
      ? (raw.versions as DraftVersion[]).filter(v => Number.isInteger(v?.n) && existsSync(join(dir, `v${v.n}.js`)))
      : []
    const current = versions.some(v => v.n === raw.current) ? raw.current as number : versions[versions.length - 1]?.n ?? 0
    return {
      name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : '新的像素动画',
      look: cleanLook(raw.look, DEFAULT_LOOK),
      current, versions, autoName: raw.autoName === true,
      ...(typeof raw.saved === 'string' ? { saved: raw.saved } : {}),
      changed: typeof raw.changed === 'number' ? raw.changed : 0,
    }
  }

  private write(id: string, file: DraftFile): void {
    const dir = this.dir(id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'draft.json'), `${JSON.stringify({ ...file, changed: Date.now() }, null, 2)}\n`)
  }

  private view(id: string, file: DraftFile): DraftView {
    const code = file.current > 0 ? readFileSync(join(this.dir(id), `v${file.current}.js`), 'utf8') : ''
    return { id, name: file.name, look: file.look, current: file.current, versions: file.versions, code, autoName: file.name === '新的像素动画' || file.autoName === true, ...(file.saved === undefined ? {} : { saved: file.saved }) }
  }

  /** Drafts that have at least one version, the latest first. Empty ones are cleared away. */
  list(): DraftSummary[] {
    if (!existsSync(this.root)) return []
    const out: DraftSummary[] = []
    for (const id of readdirSync(this.root)) {
      if (!ID.test(id)) continue
      let file: DraftFile
      try {
        file = this.read(id)
      } catch {
        continue
      }
      if (file.versions.length === 0) {
        if (Date.now() - file.changed > 60_000) rmSync(this.dir(id), { recursive: true, force: true })
        continue
      }
      out.push({ id, name: file.name, versions: file.versions.length, changed: file.changed, ...(file.saved === undefined ? {} : { saved: file.saved }) })
    }
    return out.sort((a, b) => b.changed - a.changed)
  }

  /** A new draft: empty, or with `first` as its first version. */
  create(first?: { code: string; note: string; name?: string; look?: PixelLook; saved?: string }): DraftView {
    const id = `d-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
    this.write(id, { name: first?.name ?? '新的像素动画', look: first?.look ?? DEFAULT_LOOK, current: 0, versions: [], changed: Date.now(), ...(first?.saved === undefined ? {} : { saved: first.saved }) })
    return first === undefined ? this.get(id) : this.add(id, first.code, first.note)
  }

  get(id: string): DraftView {
    return this.view(id, this.read(id))
  }

  /** A new version (shown at once), with `look` (or the draft's look now). The code must at least be a file we can wrap. */
  add(id: string, code: string, note: string, look?: unknown): DraftView {
    const wrapped = wrapPixelCode(code)
    if (wrapped.script === undefined) throw new Error(wrapped.problems.join('；'))
    const file = this.read(id)
    const n = (file.versions[file.versions.length - 1]?.n ?? 0) + 1
    writeFileSync(join(this.dir(id), `v${n}.js`), code)
    if (look !== undefined) file.look = cleanLook(look, file.look)
    file.versions.push({ n, note: note.slice(0, 80), at: Date.now(), look: file.look })
    while (file.versions.length > MAX_VERSIONS) {
      const gone = file.versions.splice(1, 1)[0]!
      rmSync(join(this.dir(id), `v${gone.n}.js`), { force: true })
    }
    file.current = n
    this.write(id, file)
    return this.view(id, file)
  }

  /** Show version `n` (the next change goes on from it). */
  pick(id: string, n: number): DraftView {
    const file = this.read(id)
    const version = file.versions.find(v => v.n === n)
    if (version === undefined) throw new Error('没有这一版')
    file.current = n
    if (version.look !== undefined) file.look = cleanLook(version.look, file.look)
    this.write(id, file)
    return this.view(id, file)
  }

  /** `auto`: the name comes from the die, not from you. */
  set(id: string, change: { name?: unknown; look?: unknown; auto?: unknown }): DraftView {
    const file = this.read(id)
    if (typeof change.name === 'string' && change.name.trim() !== '') {
      file.name = change.name.trim().slice(0, 40)
      file.autoName = change.auto === true
    }
    if (typeof change.look === 'object' && change.look !== null) {
      file.look = cleanLook({ ...file.look, ...change.look }, file.look)
      // The version shown keeps the look it is seen with.
      const shown = file.versions.find(v => v.n === file.current)
      if (shown !== undefined) shown.look = file.look
    }
    this.write(id, file)
    return this.view(id, file)
  }

  markSaved(id: string, pixel: string): DraftView {
    const file = this.read(id)
    file.saved = pixel
    this.write(id, file)
    return this.view(id, file)
  }

  /** The draft's conversation with the AI (pixel-chat.ts): its dsh session and what was said. */
  chat(id: string): { sessionId?: string; items: unknown[] } {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir(id), 'chat.json'), 'utf8')) as { sessionId?: unknown; items?: unknown }
      return { ...(typeof raw.sessionId === 'string' ? { sessionId: raw.sessionId } : {}), items: Array.isArray(raw.items) ? raw.items : [] }
    } catch {
      return { items: [] }
    }
  }

  saveChat(id: string, chat: { sessionId?: string; items: unknown[] }): void {
    const dir = this.dir(id)
    if (!existsSync(dir)) return
    writeFileSync(join(dir, 'chat.json'), `${JSON.stringify({ ...chat, items: chat.items.slice(-200) })}\n`)
  }

  /** Into `.removed` (kept). */
  remove(id: string): void {
    const dir = this.dir(id)
    if (!existsSync(dir)) return
    mkdirSync(join(this.root, '.removed'), { recursive: true })
    renameSync(dir, join(this.root, '.removed', `${Date.now()}-${id}`))
  }
}
