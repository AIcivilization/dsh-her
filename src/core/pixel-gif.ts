/**
 * A GIF writer for 像素动画 (docs/像素导出设计.md §2), and a reader for the
 * one thing we put in: the animation's own file, in an application block of
 * ours, so a GIF dropped back into the workshop opens as its file. Pure: no
 * page, no canvas. GIF89a, one global palette (up to 256 colours), looping
 * for ever, a comment; each frame whole, cleared before the next when there
 * is transparency.
 */

export interface GifFrame {
  /** One palette index a pixel, width × height. */
  indices: Uint8Array
  /** How long it shows, in hundredths of a second. */
  delay: number
}

export interface GifInput {
  width: number
  height: number
  /** r, g, b, r, g, b, …: at most 256 colours. */
  palette: number[]
  /** The index that is see-through, if any. */
  transparent?: number
  frames: GifFrame[]
  comment?: string
  /** Our own block: the animation's file and how it looked. */
  source?: GifSource
}

/** What a GIF made here carries, to open it again in the workshop. */
export interface GifSource {
  name: string
  code: string
  look?: unknown
}

/** The application block's name (8) and code (3). */
const APP_ID = 'DSHHER10'
const APP_AUTH = 'PX1'

class Bytes {
  private buf: Uint8Array<ArrayBuffer> = new Uint8Array(1 << 16)
  length = 0
  private room(n: number): void {
    if (this.length + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.length + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.length))
    this.buf = next
  }
  byte(b: number): void {
    this.room(1)
    this.buf[this.length++] = b & 0xff
  }
  u16(n: number): void {
    this.byte(n)
    this.byte(n >> 8)
  }
  bytes(data: ArrayLike<number>): void {
    this.room(data.length)
    this.buf.set(data, this.length)
    this.length += data.length
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i))
  }
  /** Data in sub-blocks of at most 255, then the 0 that ends them. */
  blocks(data: Uint8Array): void {
    for (let i = 0; i < data.length; i += 255) {
      const part = data.subarray(i, Math.min(data.length, i + 255))
      this.byte(part.length)
      this.bytes(part)
    }
    this.byte(0)
  }
  done(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.length)
  }
}

/** The LZW code stream of one frame's indices (as GIF wants it: variable width, clear at 4096). */
export function lzw(indices: Uint8Array, minSize: number): Uint8Array<ArrayBuffer> {
  const out = new Bytes()
  const clear = 1 << minSize, eoi = clear + 1
  let size = minSize + 1
  let next = eoi + 1
  let table = new Map<number, number>()
  let cur = 0, bits = 0
  const emit = (code: number) => {
    cur |= code << bits
    bits += size
    while (bits >= 8) {
      out.byte(cur & 0xff)
      cur >>>= 8
      bits -= 8
    }
  }
  emit(clear)
  if (indices.length === 0) {
    emit(eoi)
    if (bits > 0) out.byte(cur & 0xff)
    return out.done()
  }
  let prefix = indices[0]!
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!
    const key = (prefix << 8) | k
    const found = table.get(key)
    if (found !== undefined) {
      prefix = found
      continue
    }
    emit(prefix)
    if (next === 4096) {
      emit(clear)
      table = new Map()
      size = minSize + 1
      next = eoi + 1
    } else {
      if (next >= 1 << size) size++
      table.set(key, next++)
    }
    prefix = k
  }
  emit(prefix)
  emit(eoi)
  if (bits > 0) out.byte(cur & 0xff)
  return out.done()
}

const utf8 = (s: string) => new TextEncoder().encode(s)

/** The GIF file. */
export function encodeGif(input: GifInput): Uint8Array<ArrayBuffer> {
  const { width, height, frames } = input
  const colors = Math.max(2, Math.ceil(input.palette.length / 3))
  if (colors > 256) throw new Error('a GIF has at most 256 colours')
  let tableBits = 1
  while (1 << tableBits < colors) tableBits++
  const table = new Uint8Array(3 << tableBits)
  table.set(input.palette.slice(0, table.length))
  const out = new Bytes()
  out.ascii('GIF89a')
  out.u16(width)
  out.u16(height)
  out.byte(0x80 | 0x70 | (tableBits - 1))
  out.byte(input.transparent ?? 0)
  out.byte(0)
  out.bytes(table)
  // Loop for ever.
  out.bytes([0x21, 0xff, 0x0b])
  out.ascii('NETSCAPE2.0')
  out.bytes([0x03, 0x01, 0x00, 0x00, 0x00])
  if (input.comment !== undefined) {
    out.bytes([0x21, 0xfe])
    out.blocks(utf8(input.comment))
  }
  if (input.source !== undefined) {
    out.bytes([0x21, 0xff, 0x0b])
    out.ascii(APP_ID + APP_AUTH)
    out.blocks(utf8(JSON.stringify({ v: 1, ...input.source })))
  }
  const minSize = Math.max(2, tableBits)
  const see = input.transparent !== undefined
  for (const frame of frames) {
    // Graphic control: cleared to nothing before the next frame when there is see-through, so frames do not pile up.
    out.bytes([0x21, 0xf9, 0x04, (see ? 2 << 2 : 1 << 2) | (see ? 1 : 0)])
    out.u16(Math.max(2, Math.round(frame.delay)))
    out.byte(input.transparent ?? 0)
    out.byte(0)
    out.byte(0x2c)
    out.u16(0)
    out.u16(0)
    out.u16(width)
    out.u16(height)
    out.byte(0)
    out.byte(minSize)
    out.blocks(lzw(frame.indices, minSize))
  }
  out.byte(0x3b)
  return out.done()
}

/** The data of the sub-blocks starting at `at`, and where they end (after the 0). */
function readBlocks(bytes: Uint8Array, at: number): { data: Uint8Array; end: number } | undefined {
  const parts: Uint8Array[] = []
  let k = at
  let total = 0
  while (k < bytes.length) {
    const n = bytes[k]!
    if (n === 0) {
      const data = new Uint8Array(total)
      let o = 0
      for (const p of parts) {
        data.set(p, o)
        o += p.length
      }
      return { data, end: k + 1 }
    }
    if (k + 1 + n > bytes.length) return undefined
    parts.push(bytes.subarray(k + 1, k + 1 + n))
    total += n
    k += 1 + n
  }
  return undefined
}

/** The animation a GIF made here carries; undefined for any other GIF (or one a site has made again and lost it). */
export function readGifSource(bytes: Uint8Array): GifSource | undefined {
  if (bytes.length < 13 || String.fromCharCode(...bytes.subarray(0, 3)) !== 'GIF') return undefined
  let k = 13
  const flags = bytes[10]!
  if ((flags & 0x80) !== 0) k += 3 << ((flags & 7) + 1)
  while (k < bytes.length) {
    const b = bytes[k]!
    if (b === 0x3b) return undefined
    if (b === 0x21) {
      const label = bytes[k + 1]
      if (label === 0xff && bytes[k + 2] === 11 && String.fromCharCode(...bytes.subarray(k + 3, k + 14)) === APP_ID + APP_AUTH) {
        const read = readBlocks(bytes, k + 14)
        if (read === undefined) return undefined
        try {
          const raw = JSON.parse(new TextDecoder().decode(read.data)) as Record<string, unknown>
          if (typeof raw.code !== 'string' || raw.code.length > 400_000) return undefined
          return { name: typeof raw.name === 'string' ? raw.name.slice(0, 40) : '', code: raw.code, ...(raw.look === undefined ? {} : { look: raw.look }) }
        } catch {
          return undefined
        }
      }
      const read = readBlocks(bytes, k + 2)
      if (read === undefined) return undefined
      k = read.end
      continue
    }
    if (b === 0x2c) {
      if (k + 10 > bytes.length) return undefined
      const local = bytes[k + 9]!
      k += 10
      if ((local & 0x80) !== 0) k += 3 << ((local & 7) + 1)
      const read = readBlocks(bytes, k + 1)
      if (read === undefined) return undefined
      k = read.end
      continue
    }
    return undefined
  }
  return undefined
}
