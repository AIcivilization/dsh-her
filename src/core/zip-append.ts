/**
 * A zip with a few files added, everything already in it copied byte for
 * byte (docs/独立安装包设计.md §5, "生成安装包"): the player's zip has symlinks,
 * executable bits and a signed app inside, and rewriting its entries would
 * lose them. The original's local records are copied as they are, the new
 * files come after them, then the original central directory unchanged (its
 * offsets still hold) and the new files' entries. Streams through, so a
 * 200 MB player is never all in memory.
 *
 * New files are stored (not compressed), with UTF-8 names and ordinary
 * file permissions.
 */

import { closeSync, fstatSync, openSync, readSync, writeSync } from 'node:fs'
import { crc32 } from './zip.ts'

const EOCD = 0x06054b50
const ZIP64_EOCD = 0x06064b50
const ZIP64_LOCATOR = 0x07064b50
const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50

interface Directory {
  /** Where the central directory starts and how long it is. */
  offset: number
  size: number
  entries: number
}

function readAt(fd: number, position: number, length: number): Buffer {
  const out = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const n = readSync(fd, out, done, length - done, position + done)
    if (n === 0) throw new Error('zip 文件不完整')
    done += n
  }
  return out
}

/** The central directory of a zip, zip64 included. */
function directory(fd: number): Directory {
  const size = fstatSync(fd).size
  const tail = readAt(fd, Math.max(0, size - 65_557), Math.min(size, 65_557))
  let at = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD) {
      at = i
      break
    }
  }
  if (at < 0) throw new Error('这不是一个 zip 文件')
  if (tail.readUInt16LE(at + 4) !== 0 || tail.readUInt16LE(at + 6) !== 0) throw new Error('分卷的 zip 不认识')
  let entries = tail.readUInt16LE(at + 10)
  let cdSize = tail.readUInt32LE(at + 12)
  let cdOffset = tail.readUInt32LE(at + 16)
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locatorAt = at - 20
    if (locatorAt < 0 || tail.readUInt32LE(locatorAt) !== ZIP64_LOCATOR) throw new Error('zip64 的目录找不到')
    const record = readAt(fd, Number(tail.readBigUInt64LE(locatorAt + 8)), 56)
    if (record.readUInt32LE(0) !== ZIP64_EOCD) throw new Error('zip64 的目录不对')
    entries = Number(record.readBigUInt64LE(32))
    cdSize = Number(record.readBigUInt64LE(40))
    cdOffset = Number(record.readBigUInt64LE(48))
  }
  return { offset: cdOffset, size: cdSize, entries }
}

function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((Math.max(1980, at.getFullYear()) - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  }
}

/** Copy `length` bytes from one file to another in pieces. */
function copy(from: number, to: number, start: number, length: number): void {
  const chunk = Buffer.alloc(4 * 1024 * 1024)
  let done = 0
  while (done < length) {
    const n = readSync(from, chunk, 0, Math.min(chunk.length, length - done), start + done)
    if (n === 0) throw new Error('zip 文件不完整')
    writeSync(to, chunk, 0, n)
    done += n
  }
}

/** Write `source` with `added` after its own files to `out` (a new file). */
export function appendToZip(source: string, out: string, added: ReadonlyArray<{ name: string; data: Uint8Array }>, at: Date = new Date()): void {
  const from = openSync(source, 'r')
  const to = openSync(out, 'w')
  try {
    const dir = directory(from)
    // Everything before the central directory: the original files, as they are.
    copy(from, to, 0, dir.offset)
    let position = dir.offset
    const { time, date } = dosTime(at)
    const centrals: Buffer[] = []
    for (const file of added) {
      const name = Buffer.from(file.name, 'utf8')
      const crc = crc32(file.data)
      const local = Buffer.alloc(30)
      local.writeUInt32LE(LOCAL, 0)
      local.writeUInt16LE(20, 4) // version needed
      local.writeUInt16LE(0x0800, 6) // UTF-8 names
      local.writeUInt16LE(0, 8) // stored
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(file.data.length, 18)
      local.writeUInt32LE(file.data.length, 22)
      local.writeUInt16LE(name.length, 26)
      local.writeUInt16LE(0, 28)
      writeSync(to, local)
      writeSync(to, name)
      writeSync(to, file.data)
      const central = Buffer.alloc(46)
      central.writeUInt32LE(CENTRAL, 0)
      central.writeUInt16LE((3 << 8) | 20, 4) // made on Unix: the permissions below are read
      central.writeUInt16LE(20, 6)
      central.writeUInt16LE(0x0800, 8)
      central.writeUInt16LE(0, 10)
      central.writeUInt16LE(time, 12)
      central.writeUInt16LE(date, 14)
      central.writeUInt32LE(crc, 16)
      central.writeUInt32LE(file.data.length, 20)
      central.writeUInt32LE(file.data.length, 24)
      central.writeUInt16LE(name.length, 28)
      central.writeUInt32LE((0o100644 << 16) >>> 0, 38) // a plain file, rw-r--r--
      central.writeUInt32LE(position, 42)
      centrals.push(central, name)
      position += 30 + name.length + file.data.length
    }
    if (position > 0xfffffffe) throw new Error('生成的安装包太大了（超过 4 GB）')
    // The original directory, unchanged: its offsets point at the copied files, which did not move.
    const cdStart = position
    copy(from, to, dir.offset, dir.size)
    for (const part of centrals) writeSync(to, part)
    const cdSize = dir.size + centrals.reduce((n, b) => n + b.length, 0)
    const entries = dir.entries + added.length
    if (entries > 0xfffe) throw new Error('安装包里的文件太多了')
    const end = Buffer.alloc(22)
    end.writeUInt32LE(EOCD, 0)
    end.writeUInt16LE(entries, 8)
    end.writeUInt16LE(entries, 10)
    end.writeUInt32LE(cdSize, 12)
    end.writeUInt32LE(cdStart, 16)
    writeSync(to, end)
  } finally {
    closeSync(from)
    closeSync(to)
  }
}
