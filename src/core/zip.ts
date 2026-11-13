/**
 * Zip files, enough for skins (docs/设置页与编排设计.md §18): writing keeps
 * files as they are (no compression: pictures and fonts are compressed
 * already), reading takes stored and deflated entries, the two every zip
 * tool writes. Names are kept to plain relative paths.
 */

import { inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A date as zip keeps it (local time, two-second steps). */
function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((Math.max(1980, at.getFullYear()) - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  }
}

/** A zip of these files, stored (names as UTF-8), dated `at`. */
export function makeZip(entries: readonly ZipEntry[], at: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder()
  const { time, date } = dosTime(at)
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // names are UTF-8
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, entry.data.length, true)
    local.setUint32(22, entry.data.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, entry.data)
    const head = new DataView(new ArrayBuffer(46))
    head.setUint32(0, 0x02014b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 20, true)
    head.setUint16(8, 0x0800, true)
    head.setUint16(12, time, true)
    head.setUint16(14, date, true)
    head.setUint32(16, crc, true)
    head.setUint32(20, entry.data.length, true)
    head.setUint32(24, entry.data.length, true)
    head.setUint16(28, name.length, true)
    head.setUint32(42, offset, true)
    central.push(new Uint8Array(head.buffer), name)
    offset += 30 + name.length + entry.data.length
  }
  const size = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let pos = 0
  for (const p of all) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

/** The files in a zip (folders left out). Throws on what it cannot read; refuses more than `limit` bytes unpacked. */
export function readZip(zip: Uint8Array, limit = 80 * 1024 * 1024): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('这不是一个 zip 文件')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const utf8 = new TextDecoder('utf-8')
  const out: ZipEntry[] = []
  let total = 0
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('zip 文件坏了')
    const method = view.getUint16(at + 10, true)
    const packed = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extra = view.getUint16(at + 30, true)
    const comment = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = utf8.decode(zip.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extra + comment
    if (name.endsWith('/')) continue
    total += size
    if (total > limit) throw new Error('zip 里的文件太大了')
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = zip.subarray(start, start + packed)
    const data = method === 0 ? raw.slice() : method === 8 ? new Uint8Array(inflateRawSync(raw)) : undefined
    if (data === undefined) throw new Error(`zip 里的 ${name} 用了读不了的压缩方式`)
    out.push({ name, data })
  }
  return out
}
