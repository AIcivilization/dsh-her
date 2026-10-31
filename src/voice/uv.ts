/**
 * Running Python tools without asking the computer for a Python: uv
 * (https://github.com/astral-sh/uv), one pinned, checksummed download kept
 * in `<home>/uv`, fetches a Python of its own into the same folder and builds
 * virtual environments with it. No dialogs, nothing system-wide. Used by the
 * Edge voice (when the computer has no usable Python) and the Ming voice.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchChecked } from '../net.ts'
import { systemTar } from '../platform.ts'

export function run(cmd: string, args: string[], timeout: number, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 << 20, ...(env === undefined ? {} : { env: { ...process.env, ...env } }) }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(String(stderr || error.message).trim().split('\n').slice(-2).join(' ')))
      else resolve(String(stdout))
    })
  })
}

/** What uv needs to keep its Python and downloads inside `uvHome`. */
export function uvEnv(uvHome: string): NodeJS.ProcessEnv {
  return { UV_PYTHON_INSTALL_DIR: join(uvHome, 'python'), UV_CACHE_DIR: join(uvHome, 'cache'), UV_NO_CONFIG: '1' }
}

/** uv, pinned: version and the SHA-256 of each download (from the release's .sha256 files). */
const UV_VERSION = '0.11.26'
const UV_ASSETS: Record<string, { file: string; sha256: string }> = {
  'darwin-arm64': { file: 'uv-aarch64-apple-darwin.tar.gz', sha256: '8f7fbf1708399b921857bce71e1d60f0d3ccf52a30caebc1c1a2f175dce13ab6' },
  'darwin-x64': { file: 'uv-x86_64-apple-darwin.tar.gz', sha256: '922b460202707dd5f4ccacbadbe7f6a546cc46e82a99bf50ca99a7977a78eddd' },
  'win32-x64': { file: 'uv-x86_64-pc-windows-msvc.zip', sha256: '4e1278ede866be6c0bf32d2f466cc6de7a9fb399ecf20c9ce2d186e52424be47' },
}

/** The uv binary in `uvHome`, downloaded and checked the first time. */
export async function installUv(uvHome: string): Promise<string> {
  const key = `${process.platform}-${process.arch}`
  const asset = UV_ASSETS[key]
  if (asset === undefined) throw new Error(`这台电脑（${key}）没有 Python，也没有现成的办法自动装：请先装 Python 3`)
  const dir = join(uvHome, UV_VERSION)
  const found = [join(dir, 'uv'), join(dir, 'uv.exe'), join(dir, asset.file.replace(/\.(tar\.gz|zip)$/, ''), 'uv')].find(p => existsSync(p))
  if (found !== undefined) return found
  const res = await fetchChecked(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset.file}`, { signal: AbortSignal.timeout(300_000) })
  if (!res.ok) throw new Error(`下载 uv 失败（${res.status}）`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('下载的 uv 校验不对，没有使用')
  await mkdir(dir, { recursive: true })
  const archive = join(dir, asset.file)
  await writeFile(archive, bytes)
  // tar reads both the .tar.gz and (Windows 10+) the .zip.
  await run(systemTar(), ['-xf', archive, '-C', dir], 120_000)
  await rm(archive, { force: true })
  const uv = [join(dir, 'uv'), join(dir, 'uv.exe'), join(dir, asset.file.replace(/\.(tar\.gz|zip)$/, ''), 'uv')].find(p => existsSync(p))
  if (uv === undefined) throw new Error('uv 解压后找不到')
  return uv
}
