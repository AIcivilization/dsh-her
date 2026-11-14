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
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { candidates, fetchChecked, httpFetch, NetError } from '../net.ts'
import { systemTar } from '../platform.ts'
import type { LaunchPlan } from './body-launcher.ts'

const run = promisify(execFile)

export const MANIFEST = 'body-latest.json'
/** The app inside a release zip (and in `<home>/body/<version>/`). */
export const appName = (platform: string = process.platform) => (platform === 'win32' ? 'dsh-her' : 'dsh-her.app')
/** Whether this computer can have the desktop body at all (its package is in the release); else she lives in the web page. */
export const desktopBodyExists = (platform: string = process.platform, arch: string = process.arch) => (platform === 'darwin' && arch === 'arm64') || (platform === 'win32' && arch === 'x64')
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

/**
 * The release's manifest, from GitHub itself (through the system proxy when
 * there is one), never from a mirror: it carries the checksums that make a
 * mirror's zip safe to use.
 */
export async function fetchManifest(base: string): Promise<BodyManifest> {
  let res: Response
  try {
    res = await httpFetch(at(base, MANIFEST), { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  } catch (error) {
    throw new NetError(at(base, MANIFEST), error)
  }
  if (!res.ok) throw new Error(`读不到发布信息（${res.status}）：${at(base, MANIFEST)}`)
  return validateManifest(await res.json())
}

/**
 * The manifest of this plugin's own release, put into the npm package when it
 * was published (scripts/embed-body-release.mjs). The npm registry (and its
 * mirrors) is reachable where GitHub is not, so a first install can still
 * know what to download and how to check it.
 */
export function bundledRelease(file = fileURLToPath(new URL('../body-release.json', import.meta.url))): { manifest: BodyManifest; base: string } | undefined {
  try {
    const { base, manifest } = JSON.parse(readFileSync(file, 'utf8')) as { base: string; manifest: unknown }
    return typeof base === 'string' && base.startsWith('https://github.com/') ? { base, manifest: validateManifest(manifest) } : undefined
  } catch {
    return undefined
  }
}

/** What to install: the newest release on GitHub, or, when GitHub cannot be reached, this plugin's own. */
export async function latestRelease(base: string): Promise<{ manifest: BodyManifest; base: string }> {
  try {
    return { manifest: await fetchManifest(base), base }
  } catch (error) {
    const bundled = bundledRelease()
    if (error instanceof NetError && bundled !== undefined) return bundled
    throw error
  }
}

/** This computer's asset of a release. */
function assetFor(manifest: BodyManifest): BodyAsset {
  if (!PACKAGED.has(process.platform)) throw new Error('这个系统的身体程序还没有发布（现在有 macOS 和 Windows 版）')
  const asset = manifest.assets[platformKey()]
  if (asset === undefined) throw new Error(`发布里没有这台电脑（${platformKey()}）的身体程序`)
  return asset
}

/** Where a zip waits to be installed; a download manager's file goes here too. */
export const downloadFolder = (home: string) => join(bodyRoot(home), 'download')

/**
 * Download this computer's asset of `manifest`, check it, unpack it next to
 * the installed version and make it current. Progress in bytes. `signal`
 * cancels it; what was downloaded so far is thrown away.
 */
export async function install(home: string, base: string, manifest: BodyManifest, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<Installed> {
  const asset = assetFor(manifest)
  const downloads = downloadFolder(home)
  mkdirSync(downloads, { recursive: true })
  const zip = join(downloads, asset.file)
  // From GitHub, or a mirror when GitHub cannot be reached: the size and SHA-256 below decide either way.
  const res = await fetchChecked(at(base, asset.file), signal === undefined ? {} : { signal })
  if (!res.ok || res.body === null) throw new Error(`下载失败（${res.status}）`)
  const hash = createHash('sha256')
  let done = 0
  const counted = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream).on('data', (chunk: Buffer) => {
    hash.update(chunk)
    done += chunk.length
    onProgress(done, asset.size)
  })
  try {
    await pipeline(counted, createWriteStream(`${zip}.part`), signal === undefined ? {} : { signal })
  } catch (error) {
    rmSync(`${zip}.part`, { force: true })
    throw error
  }
  if (done !== asset.size || hash.digest('hex') !== asset.sha256) {
    rmSync(`${zip}.part`, { force: true })
    throw new Error('下载的文件校验不对（可能没下完或被改过），已经删掉，再试一次')
  }
  renameSync(`${zip}.part`, zip)
  return unpack(home, manifest, zip)
}

/** What the page shows for downloading by hand: the links, where the file goes, whether it is there yet. */
export interface ManualInstall {
  version: string
  file: string
  size: number
  sha256: string
  /** GitHub first, then each mirror. */
  urls: string[]
  folder: string
  /** none: no file yet; partial: the file is there but not its full size (still downloading?); ready: size is right. */
  downloaded: 'none' | 'partial' | 'ready'
  downloadedSize?: number
  /** The program once installed (the plugin starts it; shown for anyone who wants to start it by hand). */
  program: string
}

/** The file a download manager saved: under its own name, or (renamed) any zip of exactly the right size. */
function findDownloaded(home: string, asset: BodyAsset): { path: string; size: number } | undefined {
  const folder = downloadFolder(home)
  const named = join(folder, asset.file)
  if (existsSync(named)) return { path: named, size: statSync(named).size }
  if (!existsSync(folder)) return undefined
  for (const entry of readdirSync(folder)) {
    if (!entry.toLowerCase().endsWith('.zip')) continue
    const size = statSync(join(folder, entry)).size
    if (size === asset.size) return { path: join(folder, entry), size }
  }
  return undefined
}

export function manualInstall(home: string, base: string, manifest: BodyManifest): ManualInstall {
  const asset = assetFor(manifest)
  const found = findDownloaded(home, asset)
  const app = join(bodyRoot(home), manifest.version, appName())
  return {
    version: manifest.version, file: asset.file, size: asset.size, sha256: asset.sha256,
    urls: candidates(at(base, asset.file)),
    folder: downloadFolder(home),
    downloaded: found === undefined ? 'none' : found.size === asset.size ? 'ready' : 'partial',
    ...(found === undefined ? {} : { downloadedSize: found.size }),
    program: process.platform === 'win32' ? join(app, 'dsh-her.exe') : app,
  }
}

/** Install the zip downloaded by hand, after the same check a download gets. A file that fails it is left alone, for you to see. */
export async function installDownloaded(home: string, manifest: BodyManifest): Promise<Installed> {
  const asset = assetFor(manifest)
  const found = findDownloaded(home, asset)
  if (found === undefined) throw new Error(`在 ${downloadFolder(home)} 里没找到 ${asset.file}`)
  if (found.size !== asset.size) throw new Error(`文件还不完整：${(found.size / 1e6).toFixed(0)} / ${(asset.size / 1e6).toFixed(0)} MB。等下载完再安装`)
  const hash = createHash('sha256')
  await pipeline(createReadStream(found.path), hash)
  if (hash.digest('hex') !== asset.sha256) throw new Error('文件校验不对（可能下载出错或被改过）：删掉它，重新下载一次')
  return unpack(home, manifest, found.path)
}

/** Unpack a checked zip next to the installed version and make it current. */
async function unpack(home: string, manifest: BodyManifest, zip: string): Promise<Installed> {
  const root = bodyRoot(home)
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
