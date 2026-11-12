/**
 * The web body (docs/网页身体设计.md): she lives in DSH's own web page, so she
 * works with no desktop at all (a VPS, Linux, a phone's browser). The page is
 * the desktop body's renderer in a same-origin iframe (src/client/web-bridge.ts
 * stands in for Electron); everything reaches it through DSH's authenticated
 * `/api` channel, never the body protocol's loopback socket.
 *
 * - One live connection: the newest wins, an older tab is told it was replaced,
 *   so she never speaks twice.
 * - Brain to page: Server-Sent Events, audio inline as base64. Page to brain:
 *   plain POSTs, handled exactly like a desktop body's messages.
 * - Her clips are served from `<home>/packs` with Range and ETag, so `<video>`
 *   can seek and a clip is fetched once.
 *
 * Shown when: "on", or "auto" (the default) while no desktop body is connected.
 */

import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { BrainMessage, PackSummary } from '../protocol/index.ts'
import { clipsView, loadPack, summarize, type PackUrl } from '../pack/load.ts'
import { listLooks, lookPackId, lookSummary, idleLookSummary } from '../pack/looks.ts'
import type { Look } from '../pack/look.ts'
import { listPacks, loadSettings, saveSettings } from '../pack/settings.ts'
import type { BodyConfig, ClipsView, PackInfo } from '../pack/types.ts'

export type WebMode = 'auto' | 'on' | 'off'
/** A figure floating on the page, or the scene behind the page. */
export type WebPlace = 'pet' | 'background'
/** How much of the page the background is behind: all of it, or the chat column. */
export type WebScope = 'page' | 'chat'

interface WebSettings {
  mode?: WebMode
  place?: WebPlace
  scope?: WebScope
  /** As a background: how much of the page's own colour lies over her (%), and how soft she is (px of blur). */
  dim?: number
  blur?: number
}

/** A picture or clip of hers the page can show as it is. */
export interface ShowMedia {
  url: string
  kind: 'video' | 'image'
  /** `stacked`: colour above, mask below (drawn through a canvas); `alpha`: its own transparency. */
  layout: 'stacked' | 'alpha' | 'opaque'
  name: string
}

/** The veil over a background, so what you type reads clearly. */
export interface WebVeil {
  dim: number
  blur: number
}
export const DEFAULT_VEIL: WebVeil = { dim: 45, blur: 0 }
export const cleanVeil = (value: { dim?: unknown; blur?: unknown }): WebVeil => ({
  dim: typeof value.dim === 'number' && Number.isFinite(value.dim) ? Math.max(0, Math.min(95, Math.round(value.dim))) : DEFAULT_VEIL.dim,
  blur: typeof value.blur === 'number' && Number.isFinite(value.blur) ? Math.max(0, Math.min(30, Math.round(value.blur))) : DEFAULT_VEIL.blur,
})

export const WEB_BASE = '/api/dsh-her/web'
const KEEPALIVE_MS = 20_000
/** Her height in the floating window, CSS pixels; the bubble needs room above her. */
const HER_HEIGHT = 380
const BUBBLE_ROOM = 110
const MIN_WIDTH = 300

const NO_PACK: PackInfo = { id: '', name: '还没有外形', layer: 'overlay', layout: 'opaque', start: 'stand', clips: [], macros: [], aspect: 0.75 }

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.bin': 'application/octet-stream', '.mask': 'application/octet-stream',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.css': 'text/css; charset=utf-8',
}

/** What the page's floating window needs to know: its size, her config. */
export interface WebConfig extends BodyConfig {
  frame: { width: number; height: number }
}

/** A `Range: bytes=…` header for a file of `size` bytes; undefined when absent or not one simple range, 'invalid' when out of bounds. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '')
  if (match === null) return undefined
  const [, from = '', to = ''] = match
  if (from === '' && to === '') return undefined
  if (from === '') {
    const suffix = Number(to)
    if (suffix === 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(from)
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1)
  return start >= size || start > end ? 'invalid' : { start, end }
}

/** A file inside one pack, or undefined for a name that leaves it (or a pack id that is not one folder). */
export function packFile(packsDir: string, packId: string, file: string): string | undefined {
  if (packId === '' || packId.startsWith('.') || /[/\\]/.test(packId) || file === '') return undefined
  const root = resolve(packsDir, packId)
  const path = resolve(root, file)
  return path.startsWith(root + sep) ? path : undefined
}

/** A pack file as an HTTP response: seekable, and revalidated by ETag so it is only downloaded once. */
export function fileResponse(path: string, request: Request, forever = false): Response {
  if (!existsSync(path) || !statSync(path).isFile()) return new Response('not found', { status: 404 })
  const { size, mtimeMs } = statSync(path)
  const etag = `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`
  const headers: Record<string, string> = {
    'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    // A picture or clip is never a page: nothing in an SVG runs even when it is opened on its own.
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    'x-content-type-options': 'nosniff',
    'accept-ranges': 'bytes',
    etag,
    // An address with the file's date in it never changes: the browser need not even ask (traffic, on a VPS).
    'cache-control': forever ? 'private, max-age=31536000, immutable' : 'private, no-cache',
  }
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  const range = parseRange(request.headers.get('range'), size)
  if (range === 'invalid') return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } })
  const stream = (start: number, end: number) => Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream
  if (range !== undefined) {
    return new Response(stream(range.start, range.end), {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${size}`, 'content-length': String(range.end - range.start + 1) },
    })
  }
  if (size === 0) return new Response(new Uint8Array(0), { headers: { ...headers, 'content-length': '0' } })
  return new Response(stream(0, size - 1), { headers: { ...headers, 'content-length': String(size) } })
}

/**
 * Is she shown in a page? "auto": unless a desktop body is here for her. A page
 * opened from another device always has her: that desktop is not in front of its viewer.
 */
export function webShows(mode: WebMode, desktopHere: boolean, remotePage: boolean): boolean {
  return mode === 'on' || (mode === 'auto' && (remotePage || !desktopHere))
}

/** `&v=<date>` for a pack file's address, so a re-imported file is a new address. */
function versionOf(path: string): string {
  try {
    return `&v=${Math.floor(statSync(path).mtimeMs).toString(36)}`
  } catch {
    return ''
  }
}

/** The floating window's size for a pack: a scene shows whole, a figure gets room for her bubble. */
export function frameFor(pack: PackInfo): { her: { width: number; height: number }; frame: { width: number; height: number } } {
  const aspect = pack.aspect ?? 0.75
  if (pack.layer === 'scene') {
    const width = 400
    const height = Math.round(width / aspect)
    return { her: { width, height }, frame: { width, height } }
  }
  const her = { width: Math.round(HER_HEIGHT * aspect), height: HER_HEIGHT }
  return { her, frame: { width: Math.max(MIN_WIDTH, her.width), height: HER_HEIGHT + BUBBLE_ROOM } }
}

export class WebBody {
  private readonly home: string
  private readonly packsDir: string
  /** Sends a message down the live connection; undefined when none is open. */
  private push: ((data: string) => void) | undefined
  private closeLive: (() => void) | undefined

  constructor(home: string) {
    this.home = home
    this.packsDir = join(home, 'packs')
  }

  get connected(): boolean {
    return this.push !== undefined
  }

  private settings(): WebSettings {
    try {
      return JSON.parse(readFileSync(join(this.home, 'web-body.json'), 'utf8')) as WebSettings
    } catch {
      return {}
    }
  }

  private saveSettings(change: WebSettings): void {
    mkdirSync(this.home, { recursive: true })
    writeFileSync(join(this.home, 'web-body.json'), `${JSON.stringify({ ...this.settings(), ...change }, null, 2)}\n`)
  }

  get mode(): WebMode {
    const { mode } = this.settings()
    return mode === 'on' || mode === 'off' ? mode : 'auto'
  }

  set mode(mode: WebMode) {
    this.saveSettings({ mode })
  }

  /** The scene of what she wears now, when it has one: a background needs a scene, not a figure on a green screen. */
  private scenePack(): string | undefined {
    const { look, packId } = this.chosen()
    if (look !== undefined) {
      const scenes = look.scenes.filter(s => s.pack !== look.desk)
      const chosen = loadSettings(this.home).looks?.[look.id]?.scene
      return (scenes.find(s => s.id === chosen) ?? scenes.find(s => s.id === look.default) ?? scenes[0])?.pack
    }
    return packId !== undefined && listPacks(this.packsDir).find(p => p.packId === packId)?.layer === 'scene' ? packId : undefined
  }

  /** Where she is in the page: what was chosen, as far as what she wears allows. */
  place(): { place: WebPlace; scope: WebScope; canBackground: boolean } {
    const { place, scope } = this.settings()
    const canBackground = this.scenePack() !== undefined
    return { place: place === 'background' && canBackground ? 'background' : 'pet', scope: scope === 'chat' ? 'chat' : 'page', canBackground }
  }

  /** Choose where she is in the page, and have the page load what that shows. */
  setPlace(change: { place?: WebPlace; scope?: WebScope }): void {
    this.saveSettings(change)
    this.reload()
  }

  veil(): WebVeil {
    return cleanVeil(this.settings())
  }

  /** The page reads it the next time it asks (no reload: the picture is the same). */
  setVeil(change: Partial<WebVeil>): void {
    this.saveSettings(cleanVeil({ ...this.veil(), ...change }))
  }

  /** The chosen look (or pack), else the first there is. */
  private chosen(): { look?: Look; packId?: string } {
    const looks = listLooks(this.home, this.packsDir)
    const settings = loadSettings(this.home)
    const look = looks.find(l => l.id === settings.look)
    if (look !== undefined) return { look }
    if (settings.pack !== undefined && existsSync(join(this.packsDir, settings.pack))) return { packId: settings.pack }
    if (looks[0] !== undefined) return { look: looks[0] }
    const own = this.parts(looks)
    const first = listPacks(this.packsDir).find(p => !own(p.packId))
    return first === undefined ? {} : { packId: first.packId }
  }

  /** The packs a 形象工坊 import made for a look are shown as that look only. */
  private parts(looks: Look[]): (id: string) => boolean {
    return id => looks.some(l => id.startsWith(`${l.id}-`))
  }

  /** The pack on screen: in a floating window a look shows its desk pet, or else the scene she is in. */
  private shownId(): string | undefined {
    const { look, packId } = this.chosen()
    if (this.place().place === 'background') return this.scenePack()
    if (look === undefined) return packId
    const chosen = loadSettings(this.home).looks?.[look.id]?.scene
    const scene = look.scenes.find(s => s.id === chosen) ?? look.scenes.find(s => s.id === look.default)!
    return scene.desk ?? look.desk ?? scene.pack
  }

  private shown(): PackInfo {
    const id = this.shownId()
    if (id === undefined) return NO_PACK
    try {
      return this.load(id)
    } catch {
      return NO_PACK
    }
  }

  /** A pack with its files served to the page. */
  private load(id: string): PackInfo {
    return loadPack(join(this.packsDir, id), undefined, this.urls(id))
  }

  private urls(id: string): PackUrl {
    return (dir, file) => `${WEB_BASE}/file?p=${encodeURIComponent(id)}&f=${encodeURIComponent(file)}${versionOf(join(dir, file))}`
  }

  /**
   * What she shows now in each place, for the picture on 总览: the scene of
   * the wallpaper and the figure that floats, as files the page can play.
   */
  showcase(): { desktop?: ShowMedia; pet?: ShowMedia } {
    const { look, packId } = this.chosen()
    const media = (id: string | undefined): ShowMedia | undefined => {
      if (id === undefined) return undefined
      try {
        const pack = this.load(id)
        const clip = pack.clips.find(c => c.name === 'idle') ?? pack.clips.find(c => c.id === pack.start) ?? pack.clips[0]
        // A photo with her clips over one part of it: the photo is the scene.
        if (pack.scene !== undefined && pack.plateUrl !== undefined) return { url: pack.plateUrl, kind: 'image', layout: 'opaque', name: pack.name }
        if (clip !== undefined) return { url: clip.url, kind: 'video', layout: pack.layout, name: pack.name }
        return pack.plateUrl === undefined ? undefined : { url: pack.plateUrl, kind: 'image', layout: 'opaque', name: pack.name }
      } catch {
        return undefined
      }
    }
    if (look !== undefined) {
      const chosen = loadSettings(this.home).looks?.[look.id]?.scene
      const scene = look.scenes.find(s => s.id === chosen) ?? look.scenes.find(s => s.id === look.default) ?? look.scenes[0]
      const desk = scene?.desk ?? look.desk
      const desktop = scene === undefined || scene.pack === desk ? undefined : media(scene.pack)
      const pet = media(desk)
      return { ...(desktop === undefined ? {} : { desktop }), ...(pet === undefined ? {} : { pet }) }
    }
    const one = media(packId)
    if (one === undefined) return {}
    return listPacks(this.packsDir).find(p => p.packId === packId)?.layer === 'scene' ? { desktop: one } : { pet: one }
  }

  /** The pack she shows in the page now (in a look: the scene or desk pet on screen). */
  shownPackId(): string | undefined {
    return this.shownId()
  }

  /** A pack's clips for the "画面" card: what each is used for, editable in a development pack (clips.json). */
  clipsOf(id: string): ClipsView {
    return clipsView(join(this.packsDir, id), this.load(id), this.urls(id))
  }

  /** What the brain hears of what she can do, while no desktop body speaks for her. */
  summary(): PackSummary | undefined {
    const pack = this.shown()
    if (pack.id === '') return undefined
    const { look } = this.chosen()
    return look === undefined ? summarize(pack) : lookSummary(look, pack, loadSettings(this.home).looks?.[look.id] ?? {})
  }

  packList(): PackSummary[] {
    const looks = listLooks(this.home, this.packsDir)
    const own = looks.map(l => idleLookSummary(l, this.packsDir)).filter((p): p is PackSummary => p !== undefined)
    const parts = this.parts(looks)
    return [...own, ...listPacks(this.packsDir).filter(p => !parts(p.packId))]
  }

  activeId(): string | undefined {
    const { look, packId } = this.chosen()
    return look === undefined ? packId : lookPackId(look)
  }

  /** Show another pack or look (`look:<id>`), remember it, and have the page load it. */
  use(packId: string): void {
    const settings = loadSettings(this.home)
    if (packId.startsWith('look:')) {
      delete settings.pack
      settings.look = packId.slice('look:'.length)
    } else {
      delete settings.look
      settings.pack = packId
    }
    saveSettings(this.home, settings)
    this.reload()
  }

  /** Have the page start over (the pack changed). */
  reload(): void {
    this.push?.(JSON.stringify({ m: { t: 'web.reload' } }))
  }

  config(mute: boolean): WebConfig {
    const pack = this.shown()
    const { her, frame } = frameFor(pack)
    const mode = this.place().place === 'background' ? 'wallpaper' : pack.layer === 'scene' ? 'window' : 'overlay'
    return { mode, platform: 'web', pack, her, frame, debug: false, mute }
  }

  /** A file of a pack, for `<video>` and friends. */
  file(request: Request): Response {
    const query = new URL(request.url).searchParams
    const path = packFile(this.packsDir, query.get('p') ?? '', query.get('f') ?? '')
    return path === undefined ? new Response('not found', { status: 404 }) : fileResponse(path, request, query.has('v'))
  }

  /** The renderer's own files, built next to the plugin (lib/web-body). */
  asset(name: string): Response {
    const path = fileURLToPath(new URL(`../web-body/${name}`, import.meta.url))
    if (!existsSync(path)) return new Response('not built', { status: 404 })
    const type = name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8'
    return new Response(readFileSync(path), { headers: { 'content-type': type, 'cache-control': 'no-cache' } })
  }

  /** Open the live connection: `onOpen` says hello, `onClose` when it goes away (unless a newer one replaced it). */
  connect(signal: AbortSignal, onOpen: () => void, onClose: () => void): Response {
    // She only speaks in the newest tab.
    this.push?.(JSON.stringify({ m: { t: 'web.replaced' } }))
    this.closeLive?.()
    const encoder = new TextEncoder()
    let closed = false
    let timer: NodeJS.Timeout | undefined
    let finish = () => {}
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        const write = (text: string) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(text))
          } catch {
            finish()
          }
        }
        const push = (data: string) => write(`data: ${data}\n\n`)
        finish = () => {
          if (closed) return
          closed = true
          clearInterval(timer)
          const current = this.push === push
          if (current) {
            this.push = undefined
            this.closeLive = undefined
          }
          try {
            controller.close()
          } catch {
            // already closed by the reader going away
          }
          if (current) onClose()
        }
        this.push = push
        this.closeLive = finish
        timer = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS)
        timer.unref()
        write(': connected\n\n')
        onOpen()
      },
      cancel: () => finish(),
    })
    signal.addEventListener('abort', () => finish(), { once: true })
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
    })
  }

  send(message: BrainMessage): void {
    this.push?.(JSON.stringify({ m: message }))
  }

  /** A message and the audio its stream names, together. */
  sendWithAudio(message: BrainMessage, audio: Uint8Array): void {
    this.push?.(JSON.stringify({ m: message, a: Buffer.from(audio).toString('base64') }))
  }

  close(): void {
    this.closeLive?.()
  }
}
