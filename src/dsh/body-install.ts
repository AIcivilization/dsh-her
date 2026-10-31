/**
 * The installed body: downloaded from the release (body/scripts/package.mjs
 * makes it), checked, unpacked into `<home>/body/<version>/`, and kept up to
 * date. The release has `body-latest.json`:
 *
 *   { "format": "dsh-her-body@1", "version": "0.1.0",
 *     "assets": { "darwin-arm64": { "file": "dsh-her-body-0.1.0-darwin-arm64.zip", "size": …, "sha256": "…" } } }
 *
 * The app is `dsh-her.app` on macOS and a `dsh-her` folder with
 * `dsh-her.exe` on Windows (body/scripts/package.mjs makes both).
 * `<home>/body/current.json` says which version is installed. A download
 * that does not match its SHA-256 is thrown away; the previous version stays
 * until the new one is in place, and one older version is kept to go back to.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { systemTar } from '../platform.ts'
import type { LaunchPlan } from './body-launcher.ts'

const run = promisify(execFile)

export const MANIFEST = 'body-latest.json'
/** The app inside a release zip (and in `<home>/body/<version>/`). */
export const appName = (platform: string = process.platform) => (platform === 'win32' ? 'dsh-her' : 'dsh-her.app')
/** Platforms with a body in the release. */
const PACKAGED = new Set(['darwin', 'win32'])

export interface BodyAsset {
  file: string
  size: number
  sha256: string
}

export interface BodyManifest {
  format: 'dsh-her-body@1'
  version: string
  assets: Record<string, BodyAsset>
}

export interface Installed {
  version: string
  /** The app (macOS: dsh-her.app; Windows: the dsh-her folder) inside `<home>/body/<version>/`. */
  app: string
  installedAt: string
}

/** What the "她" page shows about the installed body. */
export interface InstallState {
  state: 'idle' | 'checking' | 'downloading' | 'installing' | 'failed'
  installed?: string
  /** The newest version in the release, when checked. */
  latest?: string
  /** A newer version is installed but the running body is still the old one. */
  restart?: boolean
  done?: number
  total?: number
  error?: string
  /** This install runs the development body from the repository instead. */
  dev: boolean
}

/** This computer's asset key in the manifest. */
export const platformKey = (platform = process.platform, arch = process.arch) => `${platform}-${arch}`

/** -1, 0, 1: "0.1.0-dev.0" < "0.1.0" < "0.1.1" < "0.2.0". */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main = '', pre] = v.split('-', 2)
    return { nums: main.split('.').map(n => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  if (x.pre === y.pre) return 0
  if (x.pre === undefined) return 1
  if (y.pre === undefined) return -1
  return x.pre < y.pre ? -1 : 1
}

export function validateManifest(value: unknown): BodyManifest {
  const m = value as BodyManifest
  if (typeof m !== 'object' || m === null || m.format !== 'dsh-her-body@1' || typeof m.version !== 'string' || typeof m.assets !== 'object' || m.assets === null) {
    throw new Error('发布里的 body-latest.json 不对')
  }
  for (const asset of Object.values(m.assets)) {
    if (typeof asset?.file !== 'string' || !/^[\w.-]+\.zip$/.test(asset.file) || typeof asset.size !== 'number' || !/^[0-9a-f]{64}$/.test(asset.sha256)) {
      throw new Error('发布里的 body-latest.json 有一项不对')
    }
  }
  return m
}

const bodyRoot = (home: string) => join(home, 'body')

export function installedBody(home: string): Installed | undefined {
  try {
    const current = JSON.parse(readFileSync(join(bodyRoot(home), 'current.json'), 'utf8')) as Installed
    return existsSync(current.app) ? current : undefined
  } catch {
    return undefined
  }
}

/** How to start the installed body. */
export function installedPlan(home: string): LaunchPlan | undefined {
  const installed = installedBody(home)
  if (installed === undefined) return undefined
  if (process.platform === 'darwin') return { binary: join(installed.app, 'Contents', 'MacOS', 'Electron'), args: [], cwd: join(installed.app, '..') }
  if (process.platform === 'win32') return { binary: join(installed.app, 'dsh-her.exe'), args: [], cwd: installed.app }
  return undefined
}

/** `base` + file: the release's download address ends with a slash, or the file is appended after one. */
const at = (base: string, file: string) => `${base.replace(/\/?$/, '/')}${file}`

export async function fetchManifest(base: string): Promise<BodyManifest> {
  const res = await fetch(at(base, MANIFEST), { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`读不到发布信息（${res.status}）：${at(base, MANIFEST)}`)
  return validateManifest(await res.json())
}

/**
 * Download this computer's asset of `manifest`, check it, unpack it next to
 * the installed version and make it current. Progress in bytes.
 */
export async function install(home: string, base: string, manifest: BodyManifest, onProgress: (done: number, total: number) => void): Promise<Installed> {
  if (!PACKAGED.has(process.platform)) throw new Error('这个系统的身体程序还没有发布（现在有 macOS 和 Windows 版）')
  const asset = manifest.assets[platformKey()]
  if (asset === undefined) throw new Error(`发布里没有这台电脑（${platformKey()}）的身体程序`)
  const root = bodyRoot(home)
  const downloads = join(root, 'download')
  mkdirSync(downloads, { recursive: true })
  const zip = join(downloads, asset.file)
  const res = await fetch(at(base, asset.file), { redirect: 'follow' })
  if (!res.ok || res.body === null) throw new Error(`下载失败（${res.status}）`)
  const hash = createHash('sha256')
  let done = 0
  const counted = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream).on('data', (chunk: Buffer) => {
    hash.update(chunk)
    done += chunk.length
    onProgress(done, asset.size)
  })
  await pipeline(counted, createWriteStream(`${zip}.part`))
  if (done !== asset.size || hash.digest('hex') !== asset.sha256) {
    rmSync(`${zip}.part`, { force: true })
    throw new Error('下载的文件校验不对（可能没下完或被改过），已经删掉，再试一次')
  }
  renameSync(`${zip}.part`, zip)

  const target = join(root, manifest.version)
  const unpacking = `${target}.unpacking`
  rmSync(unpacking, { recursive: true, force: true })
  mkdirSync(unpacking, { recursive: true })
  // macOS: ditto keeps the app's symlinks, permissions and signature. Windows: the system tar reads zip.
  if (process.platform === 'darwin') await run('ditto', ['-x', '-k', zip, unpacking], { timeout: 300_000 })
  else await run(systemTar(), ['-xf', zip, '-C', unpacking], { timeout: 300_000 })
  if (!existsSync(join(unpacking, appName()))) throw new Error('下载的包里没有身体程序')
  rmSync(target, { recursive: true, force: true })
  renameSync(unpacking, target)
  rmSync(zip, { force: true })

  const previous = installedBody(home)
  const installed: Installed = { version: manifest.version, app: join(target, appName()), installedAt: new Date().toISOString() }
  writeFileSync(join(root, 'current.json.tmp'), `${JSON.stringify(installed, null, 2)}\n`)
  renameSync(join(root, 'current.json.tmp'), join(root, 'current.json'))
  // Keep this version and the one before it; older ones go.
  for (const entry of readdirSync(root)) {
    const keep = entry === manifest.version || entry === previous?.version || entry === 'download' || entry.endsWith('.json')
    if (keep) continue
    try {
      rmSync(join(root, entry), { recursive: true, force: true })
    } catch {
      // Windows keeps a running program's files locked: that old version goes next time.
    }
  }
  return installed
}
