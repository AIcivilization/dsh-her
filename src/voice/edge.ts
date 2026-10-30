/**
 * Microsoft Edge "Read aloud" voices (晓晓, 晓伊 …) through the open-source
 * command-line tool edge-tts (https://github.com/rany2/edge-tts), the same
 * way dsh-audiobook does it: we never talk to the service ourselves.
 *
 * Where the tool comes from, first found wins:
 *   1. one already installed by dsh-her (`<home>/edge-tts`), dsh-audiobook or
 *      dsh-tingdong (`~/.dsh/<plugin>/edge-tts`), or on the PATH via Homebrew;
 *   2. otherwise it is installed in the background into `<home>/edge-tts`,
 *      a Python virtual environment of its own, built with the computer's
 *      Python 3.8+ if it has one;
 *   3. without one (a new Mac has only a /usr/bin/python3 that asks to install
 *      the developer tools), uv (https://github.com/astral-sh/uv, one pinned,
 *      checksummed download) fetches a Python of its own into `<home>/uv`
 *      and builds the environment with it. No dialogs, nothing system-wide.
 * Deleting `<home>/edge-tts` (and `<home>/uv`) uninstalls it.
 *
 * One process per sentence, so each pays for a fresh connection (about 2.5 s
 * measured on 2026-10-29); the speech queue synthesizes ahead to hide it.
 * Needs the internet; not an official Microsoft API, so it may stop working.
 */

import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** audio-24khz-48kbitrate-mono-mp3: constant bitrate, so bytes give the duration. */
const MP3_BYTES_PER_MS = 48_000 / 8 / 1000
const SPEAK_TIMEOUT_MS = 20_000
const win = process.platform === 'win32'

export interface EdgeAudio {
  /** MP3 bytes. */
  audio: Uint8Array
  durationMs: number
  ms: number
}

export type EdgeStatus = 'missing' | 'installing' | 'ready' | 'failed'

function run(cmd: string, args: string[], timeout: number, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 << 20, ...(env === undefined ? {} : { env: { ...process.env, ...env } }) }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(String(stderr || error.message).trim().split('\n').slice(-2).join(' ')))
      else resolve(String(stdout))
    })
  })
}

const venvBin = (root: string, name: string) => join(root, win ? 'Scripts' : 'bin', win ? `${name}.exe` : name)

/** `--rate` for a speed factor: 1.2 → "+20%". */
export function edgeRate(speed: number): string {
  const percent = Math.round((speed - 1) * 100)
  return `${percent >= 0 ? '+' : ''}${percent}%`
}

export class EdgeVoice {
  private readonly ownDir: string
  private installing: Promise<void> | undefined
  private state: EdgeStatus = 'missing'
  private error: string | undefined

  private readonly viaUv: boolean

  /** `ownDir`: where dsh-her installs its own copy (`<home>/edge-tts`). `viaUv`: skip the computer's Python (tests). */
  constructor(ownDir: string, options: { viaUv?: boolean } = {}) {
    this.ownDir = ownDir
    this.viaUv = options.viaUv === true
    if (this.bin() !== undefined) this.state = 'ready'
  }

  get status(): { status: EdgeStatus; error?: string } {
    return this.error === undefined ? { status: this.state } : { status: this.state, error: this.error }
  }

  /** The edge-tts command, or undefined when there is none yet. */
  bin(): string | undefined {
    const dsh = join(homedir(), '.dsh')
    const roots = this.viaUv ? [this.ownDir] : [this.ownDir, join(dsh, 'dsh-audiobook', 'edge-tts'), join(dsh, 'dsh-tingdong', 'edge-tts')]
    for (const root of roots) {
      if (existsSync(venvBin(root, 'edge-tts'))) return venvBin(root, 'edge-tts')
    }
    return this.viaUv ? undefined : ['/opt/homebrew/bin/edge-tts', '/usr/local/bin/edge-tts', '/usr/bin/edge-tts'].find(p => existsSync(p))
  }

  /** Make sure the tool is there, installing it once if needed. */
  ensure(): Promise<void> {
    if (this.bin() !== undefined) {
      this.state = 'ready'
      return Promise.resolve()
    }
    this.installing ??= this.install().finally(() => { this.installing = undefined })
    return this.installing
  }

  /** One sentence as MP3. */
  async synthesize(text: string, voice: string, speed: number): Promise<EdgeAudio> {
    await this.ensure()
    const bin = this.bin()
    if (bin === undefined) throw new Error('Edge 语音组件还没装好')
    const started = Date.now()
    const out = join(tmpdir(), `dsh-her-${randomUUID()}.mp3`)
    try {
      // --text=…: a sentence starting with "-" is not taken for an option.
      const args = ['--voice', voice, `--rate=${edgeRate(speed)}`, `--text=${text}`, '--write-media', out]
      try {
        await run(bin, args, SPEAK_TIMEOUT_MS)
      } catch {
        // The network hiccups now and then: once more.
        await run(bin, args, SPEAK_TIMEOUT_MS)
      }
      const audio = new Uint8Array(await readFile(out))
      if (audio.byteLength === 0) throw new Error('Edge 没有返回声音')
      return { audio, durationMs: Math.round(audio.byteLength / MP3_BYTES_PER_MS), ms: Date.now() - started }
    } finally {
      await rm(out, { force: true })
    }
  }

  private async install(): Promise<void> {
    this.state = 'installing'
    this.error = undefined
    try {
      const python = this.viaUv ? undefined : await findPython()
      const venvPython = venvBin(this.ownDir, win ? 'python' : 'python3')
      if (python !== undefined) {
        if (!existsSync(venvPython)) await run(python, ['-m', 'venv', this.ownDir], 120_000)
        await run(venvPython, ['-m', 'pip', 'install', '-q', '--disable-pip-version-check', '--upgrade', 'edge-tts'], 300_000)
      } else {
        // No Python here: uv brings one of its own, kept next to edge-tts.
        const uvHome = join(dirname(this.ownDir), 'uv')
        const uv = await installUv(uvHome)
        const env = { UV_PYTHON_INSTALL_DIR: join(uvHome, 'python'), UV_CACHE_DIR: join(uvHome, 'cache'), UV_NO_CONFIG: '1' }
        if (!existsSync(venvPython)) await run(uv, ['venv', '--quiet', '--python', '3.12', this.ownDir], 600_000, env)
        await run(uv, ['pip', 'install', '--quiet', '--python', venvPython, '--upgrade', 'edge-tts'], 300_000, env)
        // The downloads are installed now; only the Python itself must stay.
        await rm(env.UV_CACHE_DIR, { recursive: true, force: true })
      }
      if (this.bin() === undefined) throw new Error('装完了却找不到 edge-tts')
      this.state = 'ready'
    } catch (error) {
      this.state = 'failed'
      this.error = `安装 Edge 语音组件失败：${(error as Error).message}`
      throw new Error(this.error)
    }
  }
}

/**
 * A Python 3.8+ to build the virtual environment with. On a Mac,
 * /usr/bin/python3 (and a bare `python3`, which is the same) only work once
 * the developer tools are installed; before that, running them pops up the
 * installer, so they are not even tried.
 */
async function findPython(): Promise<string | undefined> {
  const devTools = process.platform !== 'darwin' || await run('/usr/bin/xcode-select', ['-p'], 10_000).then(() => true, () => false)
  const candidates = win ? ['py', 'python', 'python3'] : ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', ...(devTools ? ['/usr/bin/python3', 'python3'] : [])]
  for (const python of candidates) {
    if (python.includes('/') && !existsSync(python)) continue
    try {
      const [major, minor] = (await run(python, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], 15_000)).trim().split('.').map(Number)
      if (major === 3 && minor! >= 8) return python
    } catch {
      // the next one
    }
  }
  return undefined
}

/** uv, pinned: version and the SHA-256 of each download (from the release's .sha256 files). */
const UV_VERSION = '0.11.26'
const UV_ASSETS: Record<string, { file: string; sha256: string }> = {
  'darwin-arm64': { file: 'uv-aarch64-apple-darwin.tar.gz', sha256: '8f7fbf1708399b921857bce71e1d60f0d3ccf52a30caebc1c1a2f175dce13ab6' },
  'darwin-x64': { file: 'uv-x86_64-apple-darwin.tar.gz', sha256: '922b460202707dd5f4ccacbadbe7f6a546cc46e82a99bf50ca99a7977a78eddd' },
  'win32-x64': { file: 'uv-x86_64-pc-windows-msvc.zip', sha256: '4e1278ede866be6c0bf32d2f466cc6de7a9fb399ecf20c9ce2d186e52424be47' },
}

/** The uv binary in `uvHome`, downloaded and checked the first time. */
async function installUv(uvHome: string): Promise<string> {
  const key = `${process.platform}-${process.arch}`
  const asset = UV_ASSETS[key]
  if (asset === undefined) throw new Error(`这台电脑（${key}）没有 Python，也没有现成的办法自动装：请先装 Python 3`)
  const dir = join(uvHome, UV_VERSION)
  const found = [join(dir, 'uv'), join(dir, 'uv.exe'), join(dir, asset.file.replace(/\.(tar\.gz|zip)$/, ''), 'uv')].find(p => existsSync(p))
  if (found !== undefined) return found
  const res = await fetch(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset.file}`, { redirect: 'follow', signal: AbortSignal.timeout(300_000) })
  if (!res.ok) throw new Error(`下载 uv 失败（${res.status}）`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('下载的 uv 校验不对，没有使用')
  await mkdir(dir, { recursive: true })
  const archive = join(dir, asset.file)
  await writeFile(archive, bytes)
  // tar reads both the .tar.gz and (Windows 10+) the .zip.
  await run('tar', ['-xf', archive, '-C', dir], 120_000)
  await rm(archive, { force: true })
  const uv = [join(dir, 'uv'), join(dir, 'uv.exe'), join(dir, asset.file.replace(/\.(tar\.gz|zip)$/, ''), 'uv')].find(p => existsSync(p))
  if (uv === undefined) throw new Error('uv 解压后找不到')
  return uv
}
