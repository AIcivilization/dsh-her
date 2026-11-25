/**
 * 真人桌宠 keeping itself up to date (docs/独立安装包设计.md, decision 6;
 * docs/实施计划.md step 6): once a day it reads `player-latest.json` from our
 * GitHub release (a small file; nothing about the user is sent); a newer
 * version is offered in the tray; only a click downloads it, and only a file
 * whose size and SHA-256 match goes in. The version before stays, to go back to.
 *
 * Here: what was found and chosen (`<home>/update.json`), the check, the
 * download and unpacking into `<home>/updates/<version>/`. Putting the new app
 * in place of the running one is the body's (body/main/update.ts): it is
 * different on each system and needs the program to restart.
 *
 * Switched off, nothing here goes out to the network.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { compareVersions, downloadChecked } from '../engine/body-install.ts'
import { httpFetch, NetError } from '../net.ts'
import { systemTar } from '../platform.ts'

const run = promisify(execFile)

export const PLAYER_MANIFEST = 'player-latest.json'
export const PLAYER_FORMAT = 'dsh-her-player@1'
/** Our latest release: GitHub sends this address to the newest one's files. */
export const RELEASE_BASE = 'https://github.com/AIcivilization/dsh-her/releases/latest/download/'
/** How often she looks for a new version, and how soon after starting. */
export const CHECK_EVERY_MS = 24 * 3_600_000
export const FIRST_CHECK_AFTER_MS = 60_000

/** The program inside a release zip (and in `<home>/updates/<version>/`). */
export const playerApp = (platform: string = process.platform): string => (platform === 'win32' ? '真人桌宠' : '真人桌宠.app')

export interface PlayerAsset {
  file: string
  size: number
  sha256: string
}

export interface PlayerManifest {
  format: typeof PLAYER_FORMAT
  version: string
  assets: Record<string, PlayerAsset>
}

export function validatePlayerManifest(value: unknown): PlayerManifest {
  const m = value as PlayerManifest
  if (typeof m !== 'object' || m === null || m.format !== PLAYER_FORMAT || typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version) || typeof m.assets !== 'object' || m.assets === null) {
    throw new Error('发布里的 player-latest.json 不对')
  }
  for (const asset of Object.values(m.assets)) {
    if (typeof asset?.file !== 'string' || !/^[\w.-]+\.zip$/.test(asset.file) || typeof asset.size !== 'number' || !/^[0-9a-f]{64}$/.test(asset.sha256)) {
      throw new Error('发布里的 player-latest.json 有一项不对')
    }
  }
  return m
}

/** What is kept between runs. */
export interface UpdateState {
  /** Look once a day (on by default); off, it never goes out to the network. */
  auto: boolean
  /** When it last looked, and what it found. */
  checkedAt?: number
  latest?: string
  /** A newer version for this computer, with its file. */
  available?: { version: string } & PlayerAsset
  /** The version before the one running, kept to go back to. */
  previous?: { version: string; path: string }
  /** What went wrong last time, in words. */
  error?: string
}

export function cleanUpdate(value: unknown): UpdateState {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const out: UpdateState = { auto: v.auto !== false }
  if (typeof v.checkedAt === 'number') out.checkedAt = v.checkedAt
  if (typeof v.latest === 'string') out.latest = v.latest
  const a = v.available as Record<string, unknown> | undefined
  if (a !== undefined && typeof a.version === 'string' && typeof a.file === 'string' && typeof a.size === 'number' && typeof a.sha256 === 'string') {
    out.available = { version: a.version, file: a.file, size: a.size, sha256: a.sha256 }
  }
  const p = v.previous as Record<string, unknown> | undefined
  if (p !== undefined && typeof p.version === 'string' && typeof p.path === 'string') out.previous = { version: p.version, path: p.path }
  if (typeof v.error === 'string') out.error = v.error
  return out
}

/**
 * Where to look: our release, or (to try an update by hand) an address on
 * this computer given in `ZHENREN_UPDATE_BASE`. Nothing else is accepted from
 * outside: an update replaces the program itself.
 */
export function releaseBase(env: NodeJS.ProcessEnv = process.env): string {
  const given = env.ZHENREN_UPDATE_BASE
  if (given !== undefined && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(given)) return given
  return RELEASE_BASE
}

export interface PlayerUpdatesOptions {
  home: string
  /** The version running now. */
  version: string
  base?: string
  now?: () => number
  platform?: string
  arch?: string
}

export class PlayerUpdates {
  private readonly file: string
  private readonly dir: string
  private readonly options: PlayerUpdatesOptions
  private readonly now: () => number
  private busy: Promise<unknown> | undefined
  /** Download progress, while there is one. */
  progress: { done: number; total: number } | undefined

  constructor(options: PlayerUpdatesOptions) {
    this.options = options
    this.now = options.now ?? Date.now
    this.file = join(options.home, 'update.json')
    this.dir = join(options.home, 'updates')
  }

  get base(): string {
    return this.options.base ?? releaseBase()
  }

  state(): UpdateState {
    let saved: unknown
    try {
      saved = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      saved = undefined
    }
    const state = cleanUpdate(saved)
    // What was offered is no longer newer (it went in, or an older one came back): not offered.
    if (state.available !== undefined && compareVersions(state.available.version, this.options.version) <= 0) delete state.available
    if (state.previous !== undefined && !existsSync(state.previous.path)) delete state.previous
    return state
  }

  private save(change: Partial<UpdateState>, drop: Array<keyof UpdateState> = []): UpdateState {
    const next = { ...this.state(), ...change } as UpdateState
    for (const key of drop) delete next[key]
    mkdirSync(this.options.home, { recursive: true })
    writeFileSync(`${this.file}.tmp`, `${JSON.stringify(next, null, 2)}\n`)
    renameSync(`${this.file}.tmp`, this.file)
    return next
  }

  setAuto(auto: boolean): UpdateState {
    return this.save({ auto })
  }

  /** Whether the daily look is due. */
  due(): boolean {
    const { auto, checkedAt } = this.state()
    return auto && (checkedAt === undefined || this.now() - checkedAt >= CHECK_EVERY_MS)
  }

  /** Read the release's manifest (from GitHub itself, never a mirror: it carries the checksums) and remember what is newer. */
  async check(): Promise<UpdateState> {
    const url = `${this.base}${PLAYER_MANIFEST}`
    try {
      let res: Response
      try {
        res = await httpFetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
      } catch (error) {
        throw new NetError(url, error)
      }
      if (!res.ok) throw new Error(`读不到发布信息（${res.status}）`)
      const manifest = validatePlayerManifest(await res.json())
      const key = `${this.options.platform ?? process.platform}-${this.options.arch ?? process.arch}`
      const asset = manifest.assets[key]
      const newer = asset !== undefined && compareVersions(manifest.version, this.options.version) > 0
      return this.save({ checkedAt: this.now(), latest: manifest.version, ...(newer ? { available: { version: manifest.version, ...asset } } : {}) }, newer ? ['error'] : ['error', 'available'])
    } catch (error) {
      // Tried today: not again every minute.
      this.save({ checkedAt: this.now(), error: (error as Error).message })
      throw error
    }
  }

  /**
   * Download the version offered, check it and unpack it. The folder of the
   * new program, ready to be put in place; at most one download at a time.
   */
  async download(onProgress: () => void = () => {}): Promise<{ version: string; app: string }> {
    if (this.busy !== undefined) throw new Error('已经在下载了')
    const available = this.state().available
    if (available === undefined) throw new Error('没有新版本可以下载（先点"现在检查"）')
    const work = (async () => {
      mkdirSync(this.dir, { recursive: true })
      const zip = join(this.dir, available.file)
      this.progress = { done: 0, total: available.size }
      await downloadChecked(`${this.base}${available.file}`, available, zip, (done, total) => {
        this.progress = { done, total }
        onProgress()
      })
      const target = join(this.dir, available.version)
      const unpacking = `${target}.unpacking`
      rmSync(unpacking, { recursive: true, force: true })
      mkdirSync(unpacking, { recursive: true })
      // macOS: ditto keeps the app's symlinks, permissions and signature. Windows: the system tar reads zip.
      if ((this.options.platform ?? process.platform) === 'darwin') await run('ditto', ['-x', '-k', zip, unpacking], { timeout: 300_000 })
      else await run(systemTar(this.options.platform as NodeJS.Platform | undefined), ['-xf', zip, '-C', unpacking], { timeout: 300_000 })
      rmSync(zip, { force: true })
      if (!existsSync(join(unpacking, playerApp(this.options.platform)))) throw new Error('下载的包里没有真人桌宠')
      rmSync(target, { recursive: true, force: true })
      renameSync(unpacking, target)
      return { version: available.version, app: join(target, playerApp(this.options.platform)) }
    })()
    this.busy = work
    try {
      return await work
    } catch (error) {
      this.save({ error: (error as Error).message })
      throw error
    } finally {
      this.busy = undefined
      this.progress = undefined
    }
  }

  /** Where the program that is put aside goes: `<home>/updates/previous/`. */
  previousSlot(): string {
    return join(this.dir, 'previous', playerApp(this.options.platform))
  }

  /** The program now running is (about to be) kept aside as `version`. */
  putAside(version: string): UpdateState {
    return this.save({ previous: { version, path: this.previousSlot() } }, ['error'])
  }

  /** At start: what an earlier update unpacked or left behind goes; the version kept aside stays. */
  tidy(): void {
    if (!existsSync(this.dir)) return
    for (const entry of readdirSync(this.dir)) {
      if (entry === 'previous' || entry === 'update-error.txt') continue
      try {
        rmSync(join(this.dir, entry), { recursive: true, force: true })
      } catch {
        // Windows keeps a file that is still open: it goes next time.
      }
    }
  }

  /** What went wrong when Windows put the new version in (written by the script), once. */
  takeWindowsError(): string | undefined {
    const file = join(this.dir, 'update-error.txt')
    if (!existsSync(file)) return undefined
    const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim()
    rmSync(file, { force: true })
    return text === '' ? undefined : text
  }

  busyNow(): boolean {
    return this.busy !== undefined
  }
}
