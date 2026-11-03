/**
 * Files sent from the browser, for a computer you are not sitting at: a whole
 * materials folder to import as a pack, or pictures and clips for a 形象工坊
 * project. Each file streams to disk under a temporary name and takes its
 * place only when complete.
 */

import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const MAX_FILE_BYTES = 2 * 1024 ** 3
/** What materials are made of: pictures, clips, sound, and the text files that go with them. */
const ALLOWED = new Set(['.mp4', '.webm', '.mov', '.m4v', '.png', '.jpg', '.jpeg', '.webp', '.wav', '.mp3', '.m4a', '.json', '.txt', '.md'])

/** Where a relative path lands under `root`; undefined when it leaves it or names something hidden. */
export function uploadTarget(root: string, path: string): string | undefined {
  const parts = path.split(/[/\\]+/).filter(Boolean)
  if (parts.length === 0 || parts.some(p => p === '.' || p === '..' || p.startsWith('.'))) return undefined
  const target = resolve(root, ...parts)
  return target.startsWith(resolve(root) + sep) ? target : undefined
}

export const uploadAllowed = (path: string) => ALLOWED.has(extname(path).toLowerCase())

/** Write a request's body to `target`. The file appears only once it is whole. */
export async function saveUpload(request: Request, target: string): Promise<number> {
  if (request.body === null) throw new Error('没有收到文件')
  mkdirSync(dirname(target), { recursive: true })
  const part = `${target}.part`
  let size = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      if (size > MAX_FILE_BYTES) done(new Error('文件太大了（一个文件最多 2 GB）'))
      else done(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(request.body as import('node:stream/web').ReadableStream), limit, createWriteStream(part))
  } catch (error) {
    rmSync(part, { force: true })
    throw error
  }
  renameSync(part, target)
  return size
}
