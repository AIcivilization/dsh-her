/**
 * "生成安装包" (docs/独立安装包设计.md §5, docs/实施计划.md step 7): the
 * character of now, as a zip someone without DSH unpacks and opens. It is
 * 真人桌宠 from our GitHub release (downloaded once, checked, kept in
 * `<home>/player/`), her 设计包 as `<名字>.her`, and a 说明.txt. Nothing is
 * compiled here, and a Mac's installer can be made on Windows and back.
 *
 * - macOS: `真人桌宠.app`, `<名字>.her` and `说明.txt` side by side (the app is
 *   signed: nothing goes inside it). Opening the .her puts her in.
 * - Windows: the `真人桌宠` folder with `<名字>.her` and `说明.txt` in it; the
 *   program finds the .her beside it at its first start.
 *
 * Never in it: memory, conversations, model settings, keys, skins.
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { appendToZip } from '../core/zip-append.ts'
import { httpFetch, NetError } from '../net.ts'
import { PLAYER_MANIFEST, RELEASE_BASE, validatePlayerManifest, type PlayerAsset, type PlayerManifest } from '../standalone/player-update.ts'
import { downloadChecked } from './body-install.ts'

/** The two computers there is a 真人桌宠 for. */
export const INSTALLER_TARGETS = ['darwin-arm64', 'win32-x64'] as const
export type InstallerTarget = typeof INSTALLER_TARGETS[number]
export const TARGET_NAME: Record<InstallerTarget, string> = { 'darwin-arm64': 'Mac（Apple 芯片）', 'win32-x64': 'Windows（64 位）' }
const TARGET_SHORT: Record<InstallerTarget, string> = { 'darwin-arm64': 'mac', 'win32-x64': 'windows' }

/** A licence that does not let her be passed on (the user's own words or ours). */
export const keepsToOneself = (license: string): boolean => /仅.{0,4}个人|不许转发|不得转发|不可转发|禁止转发|不许分享|personal use only|no redistribution/i.test(license)

/** A name that is safe as a file name on both systems. */
export function fileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 40)
  return clean === '' ? '她' : clean
}

export interface InstallerPlan {
  version: string
  targets: Array<{ target: InstallerTarget; name: string; size: number; cached: boolean }>
}

export interface InstallerJob {
  state: 'idle' | 'running' | 'done' | 'failed'
  /** What it is doing now, in words. */
  step?: string
  progress?: { done: number; total: number }
  /** The installers made, where they were saved. */
  files?: string[]
  error?: string
}

const cacheDir = (home: string) => join(home, 'player')

/** Whether a kept file is the one the release lists (its size, then its SHA-256). */
async function matches(path: string, asset: PlayerAsset): Promise<boolean> {
  if (!existsSync(path) || statSync(path).size !== asset.size) return false
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex') === asset.sha256
}

export class Installers {
  private readonly home: string
  private readonly base: string
  private manifest: PlayerManifest | undefined
  job: InstallerJob = { state: 'idle' }

  constructor(home: string, base: string = RELEASE_BASE) {
    this.home = home
    this.base = base
  }

  /** The newest 真人桌宠 on our release (from GitHub itself: it carries the checksums). */
  private async latest(): Promise<PlayerManifest> {
    const url = `${this.base}${PLAYER_MANIFEST}`
    let res: Response
    try {
      res = await httpFetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
    } catch (error) {
      throw new NetError(url, error)
    }
    if (res.status === 404) throw new Error('我们的发布里还没有真人桌宠（还没发布过），现在生成不了')
    if (!res.ok) throw new Error(`读不到发布信息（${res.status}）`)
    this.manifest = validatePlayerManifest(await res.json())
    return this.manifest
  }

  /** What has to be downloaded first, for the page to ask before anything is. */
  async plan(targets: readonly InstallerTarget[]): Promise<InstallerPlan> {
    const manifest = await this.latest()
    return {
      version: manifest.version,
      targets: targets.map(target => {
        const asset = manifest.assets[target]
        if (asset === undefined) throw new Error(`发布里没有 ${TARGET_NAME[target]} 的真人桌宠`)
        const kept = join(cacheDir(this.home), asset.file)
        return { target, name: TARGET_NAME[target], size: asset.size, cached: existsSync(kept) && statSync(kept).size === asset.size }
      }),
    }
  }

  /**
   * Make one installer per target into `outDir`: the player (downloaded if it
   * is not kept yet), the 设计包 and 说明.txt. Runs once at a time; the page
   * follows `job`.
   */
  async make(options: { targets: readonly InstallerTarget[]; design: Uint8Array; name: string; author: string; license: string; outDir: string }): Promise<string[]> {
    if (this.job.state === 'running') throw new Error('已经在生成了')
    if (keepsToOneself(options.license)) throw new Error(`许可是"${options.license}"：这样的她不能生成安装包给别人。换一个允许转发的许可再生成`)
    if (options.targets.length === 0) throw new Error('选一个系统')
    this.job = { state: 'running', step: '读发布信息' }
    try {
      const manifest = this.manifest ?? await this.latest()
      const dir = cacheDir(this.home)
      mkdirSync(dir, { recursive: true })
      mkdirSync(options.outDir, { recursive: true })
      const her = `${fileName(options.name)}.her`
      const made: string[] = []
      for (const target of options.targets) {
        const asset = manifest.assets[target]
        if (asset === undefined) throw new Error(`发布里没有 ${TARGET_NAME[target]} 的真人桌宠`)
        const player = join(dir, asset.file)
        if (!await matches(player, asset)) {
          this.job = { state: 'running', step: `下载 ${TARGET_NAME[target]} 的真人桌宠 ${manifest.version}`, progress: { done: 0, total: asset.size } }
          await downloadChecked(`${this.base}${asset.file}`, asset, player, (done, total) => { this.job = { ...this.job, progress: { done, total } } })
        }
        this.job = { state: 'running', step: `打包 ${TARGET_NAME[target]} 的安装包` }
        const inside = target === 'win32-x64' ? '真人桌宠/' : ''
        const out = join(options.outDir, `真人桌宠-${fileName(options.name)}-${TARGET_SHORT[target]}.zip`)
        rmSync(out, { force: true })
        appendToZip(player, `${out}.part`, [
          { name: `${inside}${her}`, data: options.design },
          { name: `${inside}说明.txt`, data: new TextEncoder().encode(readme(target, { her, name: options.name, author: options.author, license: options.license, version: manifest.version })) },
        ])
        rmSync(out, { force: true })
        renameSync(`${out}.part`, out)
        made.push(out)
      }
      // Older players kept here go: only this release's are needed.
      const keep = new Set(Object.values(manifest.assets).map(a => a.file))
      for (const entry of readdirSync(dir)) if (!keep.has(entry)) rmSync(join(dir, entry), { recursive: true, force: true })
      this.job = { state: 'done', files: made }
      return made
    } catch (error) {
      this.job = { state: 'failed', error: (error as Error).message }
      throw error
    }
  }
}

/** 说明.txt: how to open it the first time, how to get rid of it. Windows wants CRLF. */
export function readme(target: InstallerTarget, about: { her: string; name: string; author: string; license: string; version: string }): string {
  const head = [
    `这是「${about.name}」，住在桌面上的真人桌宠。`,
    `设计：${about.author || '（没写）'}　许可：${about.license}`,
    `程序：真人桌宠 ${about.version}（身体引擎 dsh-her，https://github.com/AIcivilization/dsh-her）`,
    '不要账号、不要 key。除了每天看一次有没有新版本，不联网（设置里能关）。',
    '',
  ]
  const mac = [
    '【Mac 上怎么装】',
    '1. 双击收到的 zip 解压（用系统自带的解压就行）。',
    '2. 把「真人桌宠」拖进"应用程序"文件夹。',
    '3. 打开"应用程序"里的真人桌宠。第一次会被系统拦住，说"无法验证开发者"：',
    '   打开"系统设置 → 隐私与安全性"，往下找到"真人桌宠"那一行，点"仍要打开"，再输一次密码。只要做一次。',
    `4. 双击「${about.her}」，看一眼里面有什么，点"装进来"，她就出来了。`,
    '',
    '她出来以后，屏幕右上角的菜单栏里有她的名字：点它能关掉她、换住的地方（壁纸里 / 浮在桌面上）、调大小、打开设置。',
    '',
    '【不想要了】退出（菜单栏 → 退出），把"应用程序"里的真人桌宠拖进废纸篓；',
    '她的数据在 ~/Library/Application Support/真人桌宠，一起删掉就干净了。',
  ]
  const windows = [
    '【Windows 上怎么装】',
    '1. 在收到的 zip 上点右键 →"全部解压缩"，放在你想放的地方（比如 文档 或 D 盘）。不要在压缩包里直接打开。',
    '2. 打开解压出来的「真人桌宠」文件夹，双击「真人桌宠.exe」。',
    '   第一次会出现"Windows 已保护你的电脑"：点"更多信息"，再点"仍要运行"。只要做一次。',
    `3. 它会找到同一个文件夹里的「${about.her}」，给你看一眼里面有什么，点"装进来"，她就出来了。`,
    '',
    '她出来以后，屏幕右下角的托盘里有她的图标：点它能关掉她、换住的地方（壁纸里 / 浮在桌面上）、调大小、打开设置。',
    '',
    '【不想要了】退出（托盘图标 → 退出），删掉「真人桌宠」文件夹；',
    '她的数据在 %APPDATA%\\真人桌宠，一起删掉就干净了。',
  ]
  const text = [...head, ...(target === 'win32-x64' ? windows : mac), ''].join('\n')
  return target === 'win32-x64' ? text.replace(/\n/g, '\r\n') : text
}
