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
import { loadPack, summarize } from '../pack/load.ts'
import { listLooks, lookPackId, lookSummary, idleLookSummary } from '../pack/looks.ts'
import type { Look } from '../pack/look.ts'
import { listPacks, loadSettings, saveSettings } from '../pack/settings.ts'
import type { BodyConfig, PackInfo } from '../pack/types.ts'

export type WebMode = 'auto' | 'on' | 'off'

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
export function fileResponse(path: string, request: Request): Response {
  if (!existsSync(path) || !statSync(path).isFile()) return new Response('not found', { status: 404 })
  const { size, mtimeMs } = statSync(path)
  const etag = `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`
  const headers: Record<string, string> = {
    'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    etag,
    'cache-control': 'private, no-cache',
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

  get mode(): WebMode {
    try {
      const { mode } = JSON.parse(readFileSync(join(this.home, 'web-body.json'), 'utf8')) as { mode?: WebMode }
      return mode === 'on' || mode === 'off' ? mode : 'auto'
    } catch {
      return 'auto'
    }
  }

  set mode(mode: WebMode) {
    mkdirSync(this.home, { recursive: true })
    writeFileSync(join(this.home, 'web-body.json'), `${JSON.stringify({ mode }, null, 2)}\n`)
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
    if (look === undefined) return packId
    if (look.desk !== undefined) return look.desk
    const scene = loadSettings(this.home).looks?.[look.id]?.scene
    return (look.scenes.find(s => s.id === scene) ?? look.scenes.find(s => s.id === look.default)!).pack
  }

  private shown(): PackInfo {
    const id = this.shownId()
    if (id === undefined) return NO_PACK
    try {
      return loadPack(join(this.packsDir, id), undefined, (dir, file) => `${WEB_BASE}/file?p=${encodeURIComponent(id)}&f=${encodeURIComponent(file)}`)
    } catch {
      return NO_PACK
    }
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
    return { mode: pack.layer === 'scene' ? 'window' : 'overlay', platform: 'web', pack, her, frame, debug: false, mute }
  }

  /** A file of a pack, for `<video>` and friends. */
  file(request: Request): Response {
    const query = new URL(request.url).searchParams
    const path = packFile(this.packsDir, query.get('p') ?? '', query.get('f') ?? '')
    return path === undefined ? new Response('not found', { status: 404 }) : fileResponse(path, request)
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
