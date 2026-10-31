/**
 * Local speech recognition models (sherpa-onnx). They are downloaded on first
 * use into `<home>/models`, never shipped in the package. Her own voice is in
 * the cloud (cosyvoice.ts). Design: docs/语音方案.md.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fetchChecked } from '../net.ts'
import { systemTar } from '../platform.ts'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

const RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'

export interface ModelSpec {
  id: 'asr' | 'vad'
  /** Directory (or file, for a bare .onnx) it unpacks to under the models dir. */
  name: string
  url: string
  bytes: number
  /** Checked before use: the file may come through a mirror (net.ts). */
  sha256: string
  archive: boolean
}

export const MODELS: readonly ModelSpec[] = [
  {
    id: 'asr',
    name: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
    url: `${RELEASES}/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2`,
    bytes: 165_783_878,
    sha256: '7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63',
    archive: true,
  },
  {
    id: 'vad',
    name: 'silero_vad.onnx',
    url: `${RELEASES}/asr-models/silero_vad.onnx`,
    bytes: 643_854,
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
    archive: false,
  },
]

export function modelPath(modelsDir: string, spec: ModelSpec): string {
  return join(modelsDir, spec.name)
}

export function missingModels(modelsDir: string): ModelSpec[] {
  return MODELS.filter(spec => !existsSync(modelPath(modelsDir, spec)))
}

/**
 * Download and unpack one model. Writes to a temporary name first, so an
 * interrupted download never looks installed.
 */
export async function fetchModel(
  modelsDir: string,
  spec: ModelSpec,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  mkdirSync(modelsDir, { recursive: true })
  const response = await fetchChecked(spec.url)
  if (!response.ok || response.body === null) throw new Error(`下载失败 ${spec.url}（HTTP ${response.status}）`)
  const total = spec.bytes
  const partial = join(modelsDir, `${spec.name}.download`)
  let received = 0
  const hash = createHash('sha256')
  const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>)
  body.on('data', (chunk: Buffer) => {
    received += chunk.byteLength
    hash.update(chunk)
    onProgress?.(received, total)
  })
  await pipeline(body, createWriteStream(partial))
  if (received !== spec.bytes || hash.digest('hex') !== spec.sha256) {
    rmSync(partial, { force: true })
    throw new Error(`下载的 ${spec.name} 校验不对（可能没下完或被改过），已经删掉，下次再试`)
  }
  if (!spec.archive) {
    renameSync(partial, modelPath(modelsDir, spec))
    return
  }
  const staging = join(modelsDir, `${spec.name}.unpack`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    // bsdtar ships with macOS and Windows 10+, and reads bzip2 itself.
    await promisify(execFile)(systemTar(), ['-xjf', partial, '-C', staging])
    renameSync(join(staging, spec.name), modelPath(modelsDir, spec))
  } finally {
    rmSync(staging, { recursive: true, force: true })
    rmSync(partial, { force: true })
  }
}
