/** A download that only takes its place once its size and SHA-256 are right. */

import { createHash } from 'node:crypto'
import { createWriteStream, renameSync, rmSync } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fetchChecked } from '../net.ts'

/** One file from `url` into `target`, checked against its size and SHA-256 before it takes the file's place. */
export async function downloadChecked(url: string, target: string, file: { size: number; sha256: string }, onProgress: (got: number) => void): Promise<void> {
  const res = await fetchChecked(url, { signal: AbortSignal.timeout(3_600_000) })
  if (!res.ok || res.body === null) throw new Error(`HTTP ${res.status}`)
  const hash = createHash('sha256')
  let got = 0
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      got += chunk.length
      onProgress(got)
      done(null, chunk)
    },
  })
  const part = `${target}.part`
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), count, createWriteStream(part))
  if (got !== file.size || hash.digest('hex') !== file.sha256) {
    rmSync(part, { force: true })
    throw new Error('下载的文件校验不对')
  }
  renameSync(part, target)
}
