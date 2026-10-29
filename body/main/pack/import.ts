/**
 * Import a folder of clips as an appearance pack (docs/外形包与姿势图.md §4).
 *
 * 1. Infer the pack from file names (manifest.ts).
 * 2. Check: specs, the minimum (an anchor, idle, talk), audio only on lines.
 * 3. Seams: each clip's first and last frames against its anchors (SSIM).
 *    Close enough is a hard cut at runtime; otherwise a crossfade, and the
 *    report says which clip to redo.
 * 4. Process: a green screen is keyed into the stacked layout (colour above,
 *    mask below, H.264) with a click mask; anything else is kept opaque.
 * 5. Write `<packs>/<id>/pack.json` and `report.json`. The source folder is
 *    never touched, and a failed import leaves the previous pack in place.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { inferPack, actionDesc, type ClipSpec, type MacroSpec } from './manifest.ts'
import { borderColor, frame, isGreenScreen, keyToStacked, MASK_FPS, MASK_WIDTH, probe, ssim, stackedMask, transcodeOpaque, type Probe } from './media.ts'

export const PACK_FORMAT = 'dsh-her-pack@1'
/**
 * First/last frame at least this similar to the anchor: hard cut. Strict on
 * purpose: a wrong "cut" shows as a jump, a wrong "fade" only as a crossfade.
 * (On the flat synthetic test pack, two different poses still score 0.91.)
 */
export const SEAM_CUT = 0.95
/** Output width caps: she on the desktop needs little; a scene fills the screen. */
const MAX_WIDTH = { overlay: 720, scene: 1920 } as const

export interface PackClip extends Omit<ClipSpec, 'source' | 'audio'> {
  file: string
  durationMs: number
  seam: { in: 'cut' | 'fade'; out: 'cut' | 'fade'; inScore?: number; outScore?: number }
  mask?: { file: string; width: number; height: number; fps: number; frames: number }
  audio?: string
}

export interface Pack {
  format: typeof PACK_FORMAT
  id: string
  name: string
  importedAt: string
  kind: 'video'
  layer: 'overlay' | 'scene'
  layout: 'stacked' | 'opaque'
  canvas: { width: number; height: number }
  anchors: Record<string, { image?: string }>
  start: string
  clips: PackClip[]
  macros: MacroSpec[]
  plate?: string
}

export type ReportLevel = 'ok' | 'warn' | 'error'
export interface ReportLine {
  level: ReportLevel
  text: string
}

export interface ImportOptions {
  id?: string
  name?: string
  onProgress?: (done: number, total: number, step: string) => void
}

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (prefix === '') out.push(...listFiles(path, `${entry}/`))
    } else {
      out.push(prefix + entry)
    }
  }
  return out
}

/** At most `limit` jobs at a time, results in order. */
async function pool<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await job(items[i]!)
    }
  }))
  return results
}

export async function importPack(sourceDir: string, packsDir: string, options: ImportOptions = {}): Promise<{ pack?: Pack; report: ReportLine[]; dir?: string }> {
  const report: ReportLine[] = []
  const say = (level: ReportLevel, text: string) => report.push({ level, text })
  const files = listFiles(sourceDir)
  const inferred = inferPack(files, path => {
    try {
      return readFileSync(join(sourceDir, path), 'utf8')
    } catch {
      return undefined
    }
  })
  for (const file of inferred.unknown) say('warn', `不知道 ${file} 是做什么用的，已忽略`)

  // The minimum: an anchor with idle, and talk somewhere.
  const at = (role: string, name?: string) => inferred.clips.filter(c => c.role === role && (name === undefined || c.name === name))
  if (inferred.clips.length === 0) {
    say('error', '没有找到任何片段。文件名要按"素材生成提示词"里的规则命名，比如 stand_idle_01.mp4')
    return { report }
  }
  if (!at('state', 'idle').some(c => c.from === inferred.start)) {
    say('error', `起始姿势「${inferred.start}」没有待机片段（${inferred.start}_idle_01.mp4）`)
    return { report }
  }
  if (at('state', 'talk').length === 0) say('warn', '没有说话片段（stand_talk_01.mp4），说话时会用待机片段代替')
  for (const state of ['listen', 'think'] as const) {
    if (at('state', state).length === 0) say('warn', `没有${state === 'listen' ? '倾听' : '思考'}片段，会用待机代替`)
  }

  const work = mkdtempSync(join(packsDir, '.import-'))
  try {
    const total = inferred.clips.length * 2 + 2
    let done = 0
    const step = (text: string) => options.onProgress?.(++done, total, text)

    // Specs.
    const probes = new Map<string, Probe>()
    await pool(inferred.clips, 4, async clip => {
      probes.set(clip.id, await probe(join(sourceDir, clip.source)))
    })
    const first = probes.get(inferred.clips[0]!.id)!
    for (const clip of inferred.clips) {
      const p = probes.get(clip.id)!
      if (p.width !== first.width || p.height !== first.height) say('warn', `${clip.source} 的分辨率是 ${p.width}×${p.height}，和其他片段（${first.width}×${first.height}）不一样，会被缩放`)
      if (p.hasAudio && clip.role !== 'line') say('warn', `${clip.source} 带了声音；除了储备台词，片段的声音都不会播放`)
      if (p.durationMs > 15_000) say('warn', `${clip.source} 有 ${(p.durationMs / 1000).toFixed(1)} 秒，片段一般 5 秒左右`)
    }
    for (const clip of at('line')) {
      if (clip.audio === undefined) say('warn', `${clip.source} 没有同名的 .wav 声音文件，播放时没有声音`)
      if (clip.transcript === undefined) say('warn', `${clip.source} 没有同名的 .txt 文字稿，她不会记得自己说过这句`)
    }
    step('检查规格')

    // Reference stills per anchor: the anchor image, else the first frame of a clip that starts there.
    const refs = new Map<string, string>()
    for (const anchor of Object.keys(inferred.anchors)) {
      const image = inferred.anchors[anchor]!.image
      if (image !== undefined) {
        refs.set(anchor, join(sourceDir, image))
        continue
      }
      const source = inferred.clips.find(c => c.from === anchor && c.role !== 'line')
      if (source === undefined) continue
      const still = join(work, `ref_${anchor.replace('@', '_')}.png`)
      await frame(join(sourceDir, source.source), 'first', still)
      refs.set(anchor, still)
      if (anchor !== 'off') say('warn', `没有锚点图 anchor_${anchor}.png，用 ${source.source} 的第一帧代替`)
    }

    // Background.
    const startRef = refs.get(inferred.start)!
    const background = await borderColor(startRef)
    const green = isGreenScreen(background)
    const layer = inferred.plate !== undefined ? 'scene' : 'overlay'
    const layout = green && layer === 'overlay' ? 'stacked' : 'opaque'
    if (layer === 'overlay' && !green) say('warn', '背景不是绿幕，她会带着方形背景显示。桌宠包建议用纯绿背景（#00B140）')
    step('识别背景')

    // Seams and processing, two clips at a time.
    mkdirSync(join(work, 'clips'), { recursive: true })
    mkdirSync(join(work, 'masks'), { recursive: true })
    const clips = await pool(inferred.clips, 2, async (clip): Promise<PackClip> => {
      const input = join(sourceDir, clip.source)
      const p = probes.get(clip.id)!
      const seam: PackClip['seam'] = { in: 'fade', out: 'fade' }
      const fromRef = refs.get(clip.from)
      const toRef = refs.get(clip.to)
      const tag = clip.id.replace('@', '_')
      if (fromRef !== undefined) {
        const still = join(work, `${tag}.first.png`)
        await frame(input, 'first', still)
        seam.inScore = Number((await ssim(fromRef, still)).toFixed(3))
        seam.in = seam.inScore >= SEAM_CUT ? 'cut' : 'fade'
      }
      if (toRef !== undefined) {
        const still = join(work, `${tag}.last.png`)
        await frame(input, 'last', still)
        seam.outScore = Number((await ssim(toRef, still)).toFixed(3))
        seam.out = seam.outScore >= SEAM_CUT ? 'cut' : 'fade'
      }
      step(`比对接缝 ${clip.id}`)
      const file = `clips/${clip.id}.mp4`
      let mask: PackClip['mask']
      if (layout === 'stacked') {
        await keyToStacked(input, join(work, file), background, MAX_WIDTH[layer])
        const stacked = await probe(join(work, file))
        const m = await stackedMask(join(work, file), join(work, `masks/${clip.id}.bin`), stacked)
        mask = { file: `masks/${clip.id}.bin`, width: MASK_WIDTH, height: m.height, fps: MASK_FPS, frames: m.frames }
      } else {
        await transcodeOpaque(input, join(work, file), MAX_WIDTH[layer])
      }
      let audio: string | undefined
      if (clip.audio !== undefined) {
        mkdirSync(join(work, 'lines'), { recursive: true })
        audio = `lines/${basename(clip.audio)}`
        copyFileSync(join(sourceDir, clip.audio), join(work, audio))
      }
      step(`处理 ${clip.id}`)
      const { source: _source, audio: _audio, ...rest } = clip
      return { ...rest, file, durationMs: p.durationMs, seam, ...(mask === undefined ? {} : { mask }), ...(audio === undefined ? {} : { audio }) }
    })

    for (const clip of clips) {
      const bad = [clip.seam.inScore !== undefined && clip.seam.in === 'fade' ? `开头 ${clip.seam.inScore}` : '', clip.seam.outScore !== undefined && clip.seam.out === 'fade' ? `结尾 ${clip.seam.outScore}` : ''].filter(Boolean)
      if (bad.length > 0) say('warn', `${clip.id} 和锚点对不齐（相似度 ${bad.join('，')}，低于 ${SEAM_CUT}），会用交叉淡化，建议重抽`)
    }

    // Anchors and plate.
    mkdirSync(join(work, 'anchors'), { recursive: true })
    const anchors: Pack['anchors'] = {}
    for (const [anchor, info] of Object.entries(inferred.anchors)) {
      anchors[anchor] = {}
      if (info.image !== undefined) {
        const image = `anchors/${basename(info.image)}`
        copyFileSync(join(sourceDir, info.image), join(work, image))
        anchors[anchor]!.image = image
      }
    }
    let plate: string | undefined
    if (inferred.plate !== undefined) {
      plate = basename(inferred.plate)
      copyFileSync(join(sourceDir, inferred.plate), join(work, plate))
    }

    const id = options.id ?? (basename(sourceDir).replace(/-src$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'pack')
    const cap = MAX_WIDTH[layer]
    const out = first.width <= cap ? first : { ...first, width: cap, height: Math.round((first.height * cap) / first.width / 2) * 2 }
    const pack: Pack = {
      format: PACK_FORMAT,
      id,
      name: options.name ?? id,
      importedAt: new Date().toISOString(),
      kind: 'video',
      layer,
      layout,
      canvas: { width: out.width, height: out.height },
      anchors,
      start: inferred.start,
      clips,
      macros: inferred.macros,
      ...(plate === undefined ? {} : { plate }),
    }
    const cuts = clips.filter(c => c.seam.in === 'cut' && c.seam.out === 'cut').length
    say('ok', `${clips.length} 段已识别：${Object.keys(anchors).filter(a => a !== 'off').length} 个姿势，${at('state').length} 段状态、${at('emotion').length} 段情绪、${at('action').length} 段动作、${at('transition').length} 段过渡、${at('line').length} 段台词；${cuts} 段首尾都能无缝衔接`)
    if (inferred.macros.length > 0) say('ok', `组合动作：${inferred.macros.map(m => m.action).join('、')}`)
    for (const clip of clips.filter(c => c.role === 'action')) say('ok', `动作 ${clip.name}：${actionDesc(clip.name)}`)
    writeFileSync(join(work, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`)
    writeFileSync(join(work, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    for (const f of readdirSync(work)) if (f.endsWith('.png')) rmSync(join(work, f))
    step('写入外形包')

    const dir = join(packsDir, id)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    renameSync(work, dir)
    return { pack, report, dir }
  } catch (error) {
    rmSync(work, { recursive: true, force: true })
    say('error', `处理失败：${(error as Error).message}`)
    return { report }
  }
}
