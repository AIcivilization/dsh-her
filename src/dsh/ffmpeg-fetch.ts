/**
 * Finding ffmpeg for the brain. An app opened from the Dock or Start menu has a
 * bare PATH, so an ffmpeg the user's terminal can run may not be on it: look in
 * the usual places and ask the login shell too. Failing that, a computer without
 * one (a VPS) gets one pinned, checked download into `<home>/ffmpeg`, from
 * dsh-her's release `ffmpeg-1` (BtbN's LGPL builds, the program alone, gzipped);
 * a mirror may serve it, the SHA-256 decides. macOS has no build there.
 */

import { execFile } from 'node:child_process'
import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { fetchChecked } from '../net.ts'
import { hasFfmpeg, useFfmpeg } from '../pack/media.ts'
import { installedBody } from './body-install.ts'

const RELEASE = 'https://github.com/AIcivilization/dsh-her/releases/download/ffmpeg-1/'

export const FFMPEG_BUILDS: Record<string, { file: string; size: number; sha256: string }> = {
  'linux-x64': { file: 'ffmpeg-8.1-linux-x64.gz', size: 58167037, sha256: 'e3bcb58db89178fc9b303d6d4da646023f532c33cf9a39cd4ec7ff2295c605f2' },
  'linux-arm64': { file: 'ffmpeg-8.1-linux-arm64.gz', size: 53387780, sha256: '6fe8e0ca5fab3e372642ab844c011548618769e8fab42852093972fac77f2109' },
  'win32-x64': { file: 'ffmpeg-8.1-win32-x64.gz', size: 54486001, sha256: 'd81b7c919af2fe627f5f206ffafe490ee03fecdcbf9173345bb280e7d6e62f22' },
}

/** Where a GUI app's PATH does not reach. */
const KNOWN_PLACES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', join(homedir(), 'bin', 'ffmpeg'), join(homedir(), '.local', 'bin', 'ffmpeg')]

/** The path in what a shell printed; rc files may print other things first. */
export function ffmpegInOutput(output: string): string | undefined {
  return output.split('\n').map(line => line.trim()).filter(line => line.startsWith('/') && line.endsWith('/ffmpeg')).at(-1)
}

async function fromLoginShell(): Promise<string | undefined> {
  if (process.platform === 'win32') return undefined
  try {
    const { stdout } = await promisify(execFile)(process.env.SHELL ?? '/bin/sh', ['-ilc', 'command -v ffmpeg'], { timeout: 5000 })
    return ffmpegInOutput(stdout)
  } catch {
    return undefined
  }
}

/** Make an ffmpeg already on this computer the one in use; false when there is none. */
export async function findFfmpeg(home: string): Promise<boolean> {
  if (await hasFfmpeg()) return true
  const own = join(home, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  // The installed desktop body carries its own.
  const app = installedBody(home)?.app
  const inBody = app === undefined ? [] : [join(app, 'Contents', 'Resources', 'ffmpeg'), join(dirname(app), 'resources', 'ffmpeg.exe')]
  const shell = await fromLoginShell()
  for (const candidate of [own, ...inBody, ...KNOWN_PLACES, ...(shell === undefined ? [] : [shell])]) {
    if (!existsSync(candidate)) continue
    useFfmpeg(candidate)
    if (await hasFfmpeg()) return true
  }
  return false
}

const INSTALL_HINT = 'Ubuntu / Debian：sudo apt install ffmpeg；mac：brew install ffmpeg；Windows：winget install ffmpeg'

/** Gunzip `url` into `target`, checking the compressed bytes before it takes the file's place. */
export async function downloadFfmpeg(url: string, target: string, build: { size: number; sha256: string }, onProgress: (done: number, total: number) => void): Promise<void> {
  const res = await fetchChecked(url)
  if (!res.ok || res.body === null) throw new Error(`HTTP ${res.status}`)
  const hash = createHash('sha256')
  let got = 0
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      got += chunk.length
      onProgress(got, build.size)
      done(null, chunk)
    },
  })
  const part = `${target}.part`
  try {
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), count, createGunzip(), createWriteStream(part))
    if (got !== build.size || hash.digest('hex') !== build.sha256) throw new Error('下载的文件校验不对')
    chmodSync(part, 0o755)
    renameSync(part, target)
  } catch (error) {
    rmSync(part, { force: true })
    throw error
  }
}

/** Make sure ffmpeg can run: what is here, or the download. Throws what to do when neither works. */
export async function ensureFfmpeg(home: string, onProgress: (done: number, total: number) => void, key = `${process.platform}-${process.arch}`, base = RELEASE): Promise<void> {
  if (await findFfmpeg(home)) return
  const dir = join(home, 'ffmpeg')
  const own = join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  const build = FFMPEG_BUILDS[key]
  if (build === undefined) throw new Error(`这台电脑上找不到 ffmpeg，导入要用它。${INSTALL_HINT}`)
  mkdirSync(dir, { recursive: true })
  try {
    await downloadFfmpeg(`${base}${build.file}`, own, build, onProgress)
  } catch (error) {
    throw new Error(`这台电脑上找不到 ffmpeg，自动下载也没成功（${(error as Error).message}）。可以手动安装：${INSTALL_HINT}`, { cause: error })
  }
  useFfmpeg(own)
  if (!await hasFfmpeg()) throw new Error(`下载的 ffmpeg 在这台电脑上运行不了。可以手动安装：${INSTALL_HINT}`)
}
