/**
 * Ready-made looks (docs/预设形象.md): a list and archives attached to a GitHub
 * release. What is in them was already made into packs, so choosing one needs
 * neither ffmpeg nor materials. No list on the release just means none offered.
 *
 * The list comes from GitHub itself, never a mirror: it carries the sizes and
 * checksums that make a mirror's download safe to use.
 */

import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fetchChecked, httpFetch } from '../net.ts'
import { systemTar } from '../platform.ts'

export const PRESETS_FILE = 'presets.json'
const MAX_PREVIEW = 3_000_000

export interface PresetFile {
  file: string
  size: number
  sha256: string
}

export interface Preset extends PresetFile {
  id: string
  name: string
  desc?: string
  /** A look (several scenes) or one pack. */
  kind: 'look' | 'pack'
  preview?: PresetFile
}

const at = (base: string, file: string) => `${base.replace(/\/?$/, '/')}${file}`
const validFile = (value: unknown, ending: RegExp): boolean => {
  const f = value as Partial<PresetFile> | undefined
  return typeof f?.file === 'string' && /^[\w.-]+$/.test(f.file) && ending.test(f.file) && typeof f.size === 'number' && f.size > 0 && typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256)
}

/** The entries of a list that can be used; a bad one is left out rather than failing the rest. */
export function validatePresets(value: unknown): Preset[] {
  const list = (value as { presets?: unknown } | undefined)?.presets
  if (!Array.isArray(list)) return []
  return list.filter((p: Partial<Preset>) =>
    typeof p?.id === 'string' && /^[a-z0-9][a-z0-9-]{0,40}$/.test(p.id) && typeof p.name === 'string' && p.name !== ''
    && (p.kind === 'look' || p.kind === 'pack') && validFile(p, /\.tar\.gz$/)
    && (p.preview === undefined || (validFile(p.preview, /\.(png|jpg|jpeg)$/i) && (p.preview as PresetFile).size <= MAX_PREVIEW))) as Preset[]
}

export async function fetchPresets(base: string): Promise<Preset[]> {
  const res = await httpFetch(at(base, PRESETS_FILE), { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`读不到预设列表（${res.status}）`)
  return validatePresets(await res.json())
}

const cacheDir = (home: string) => join(home, 'presets')

/** Where a preset's picture is kept once fetched. */
export function previewPath(home: string, id: string): string | undefined {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) return undefined
  const path = join(cacheDir(home), `${id}.preview`)
  return existsSync(path) ? path : undefined
}

/** Fetch a preset's picture once, checked. A picture that fails is simply not shown. */
export async function cachePreview(home: string, base: string, preset: Preset): Promise<boolean> {
  const { preview } = preset
  if (preview === undefined) return false
  const path = join(cacheDir(home), `${preset.id}.preview`)
  const mark = `${path}.sha256`
  try {
    if (existsSync(path) && readFileSync(mark, 'utf8') === preview.sha256) return true
    const res = await fetchChecked(at(base, preview.file), { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return false
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length !== preview.size || createHash('sha256').update(bytes).digest('hex') !== preview.sha256) return false
    mkdirSync(cacheDir(home), { recursive: true })
    writeFileSync(path, bytes)
    writeFileSync(mark, preview.sha256)
    return true
  } catch {
    return false
  }
}

/** Every path in an archive stays inside it. */
export function archiveEntriesSafe(entries: string[]): boolean {
  return entries.every(entry => {
    const path = entry.replace(/\\/g, '/')
    return path !== '' && !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && !path.split('/').includes('..')
  })
}

/** What may be in a preset: `packs/<id>[-part]` and `looks/<id>`, plain files and folders only. */
export function checkUnpacked(dir: string, preset: Pick<Preset, 'id' | 'kind'>): string | undefined {
  const top = readdirSync(dir).filter(name => !name.startsWith('.'))
  if (top.some(name => name !== 'packs' && name !== 'looks')) return '包里有不该有的东西'
  const packs = existsSync(join(dir, 'packs')) ? readdirSync(join(dir, 'packs')).filter(name => !name.startsWith('.')) : []
  if (packs.length === 0) return '包里没有外形'
  if (packs.some(name => name !== preset.id && !name.startsWith(`${preset.id}-`))) return '包里的外形和预设名字对不上'
  const looks = existsSync(join(dir, 'looks')) ? readdirSync(join(dir, 'looks')).filter(name => !name.startsWith('.')) : []
  if (looks.some(name => name !== preset.id)) return '包里的形象和预设名字对不上'
  if (preset.kind === 'look' && !existsSync(join(dir, 'looks', preset.id, 'look.json'))) return '包里没有 look.json'
  const walk = (at: string): boolean => readdirSync(at).every(name => {
    const path = join(at, name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return false
    return stat.isDirectory() ? walk(path) : stat.isFile()
  })
  return walk(dir) ? undefined : '包里有链接文件'
}

const run = promisify(execFile)

/** Download, check, unpack and put a preset in place. Replaces an earlier copy of it. */
export async function installPreset(home: string, base: string, preset: Preset, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const dir = cacheDir(home)
  mkdirSync(dir, { recursive: true })
  const archive = join(dir, `${preset.id}.tar.gz.part`)
  const res = await fetchChecked(at(base, preset.file), signal === undefined ? {} : { signal })
  if (!res.ok || res.body === null) throw new Error(`下载失败（${res.status}）`)
  const hash = createHash('sha256')
  let done = 0
  const counted = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream).on('data', (chunk: Buffer) => {
    hash.update(chunk)
    done += chunk.length
    onProgress(done, preset.size)
  })
  const unpacking = join(dir, `${preset.id}.unpacking`)
  try {
    await pipeline(counted, createWriteStream(archive), signal === undefined ? {} : { signal })
    if (done !== preset.size || hash.digest('hex') !== preset.sha256) throw new Error('下载的文件校验不对（可能没下完或被改过），已经删掉，再试一次')
    const { stdout } = await run(systemTar(), ['-tzf', archive], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
    if (!archiveEntriesSafe(stdout.split(/\r?\n/).filter(Boolean))) throw new Error('这个包的路径不安全，没有解开')
    rmSync(unpacking, { recursive: true, force: true })
    mkdirSync(unpacking, { recursive: true })
    await run(systemTar(), ['-xzf', archive, '-C', unpacking], { timeout: 300_000 })
    const problem = checkUnpacked(unpacking, preset)
    if (problem !== undefined) throw new Error(problem)
    placeUnpacked(unpacking, home)
  } finally {
    rmSync(archive, { force: true })
    rmSync(unpacking, { recursive: true, force: true })
  }
}

/** Move what was unpacked to `<home>/packs` and `<home>/looks`. */
function placeUnpacked(unpacked: string, home: string): void {
  for (const group of ['packs', 'looks']) {
    const from = join(unpacked, group)
    if (!existsSync(from)) continue
    mkdirSync(join(home, group), { recursive: true })
    for (const name of readdirSync(from)) {
      if (name.startsWith('.')) continue
      const to = join(home, group, name)
      rmSync(to, { recursive: true, force: true })
      renameSync(join(from, name), to)
    }
  }
}
