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
 * 5. Write `<packs>/<id>/pack.json` and `report.json`. A failed import
 *    leaves the previous pack in place.
 *
 * Importing the same folder again replaces its pack (same id, the layout
 * chosen for it kept) and keeps the previous version in `<packs>/.old/<id>`.
 * A clip whose last frame drifted from its first (generators that take only
 * a first frame) is made into a loop: forward, then backward. Sizes are
 * checked against the screen she will be on. The source folder's clips are
 * never touched; the only file written there is 重做清单.txt, the clips worth
 * generating again (removed when there are none).
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fitScene, shapeName } from './fit.ts'
import type { SceneLayout } from './types.ts'
import { inferPack, actionDesc, type ClipSpec, type MacroSpec } from './manifest.ts'
import { borderColor, frame, isGreenScreen, keyToStacked, loopBack, MASK_FPS, MASK_WIDTH, probe, ssim, stackedMask, stillSize, transcodeOpaque, type Probe } from './media.ts'

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
  /** Made into a loop on import (played forward, then backward). */
  looped?: 'back'
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
  /** A full-screen photo with her clips covering one region of it (see scene.json). */
  scene?: SceneLayout
  /** The folder it was imported from: importing it again replaces this pack. */
  source?: string
}

export type ReportLevel = 'ok' | 'warn' | 'error'
export interface ReportLine {
  level: ReportLevel
  text: string
}

export interface ImportOptions {
  id?: string
  name?: string
  /** The screen she will be on (logical size, device pixels per point): sizes are checked against it. */
  screen?: { width: number; height: number; scale: number }
  /** Make clips whose last frame drifted into loops (default on). */
  loop?: boolean
  onProgress?: (done: number, total: number, step: string) => void
}

/** A clip enlarged more than this on screen looks soft. */
const UPSCALE_WARN = 1.35

/** The pack already imported from this folder, if any. */
function previousImport(packsDir: string, sourceDir: string): Pack | undefined {
  if (!existsSync(packsDir)) return undefined
  for (const entry of readdirSync(packsDir)) {
    if (entry.startsWith('.')) continue
    try {
      const pack = JSON.parse(readFileSync(join(packsDir, entry, 'pack.json'), 'utf8')) as Pack
      if (pack.source === sourceDir) return pack
    } catch {
      // not an imported pack
    }
  }
  return undefined
}

/** A pack id from the folder name; a name with no Latin letters or digits (卧室) gets one from the folder's path. */
function idFor(packsDir: string, sourceDir: string): string {
  const slug = basename(sourceDir).replace(/-src$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  const hashed = `look-${createHash('sha1').update(sourceDir).digest('hex').slice(0, 8)}`
  if (slug === '') return hashed
  // Another folder's pack has this id already: keep both.
  return existsSync(join(packsDir, slug)) ? `${slug}-${hashed.slice(5)}` : slug
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

export async function importPack(source: string, packsDir: string, options: ImportOptions = {}): Promise<{ pack?: Pack; report: ReportLine[]; dir?: string }> {
  const sourceDir = resolve(source)
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
  if (at('state', 'talk').length === 0) say('warn', `没有说话片段（${inferred.start}_talk_01.mp4），说话时会用待机片段代替，嘴不会动`)
  for (const state of ['listen', 'think'] as const) {
    if (at('state', state).length === 0) say('warn', `没有${state === 'listen' ? '倾听' : '思考'}片段，会用待机代替`)
  }

  // A new home (a fresh server) has no packs folder yet.
  mkdirSync(packsDir, { recursive: true })
  const work = mkdtempSync(join(packsDir, '.import-'))
  try {
    const total = inferred.clips.length * 2 + 3
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
      // A scene from 做场景…: crop.png is exactly the frame her clips start from.
      const crop = ['crop.png', 'crop.jpg'].find(f => existsSync(join(sourceDir, f)))
      if (anchor === inferred.start && inferred.plate !== undefined && crop !== undefined) {
        refs.set(anchor, join(sourceDir, crop))
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
      // A loop at one place whose end drifted: play it forward, then back, so it ends where it began.
      let made = input
      let durationMs = p.durationMs
      const loops = clip.from === clip.to && clip.role !== 'line' && clip.role !== 'transition'
      let looped: PackClip['looped']
      if (options.loop !== false && loops && seam.outScore !== undefined && seam.out === 'fade') {
        made = join(work, `${tag}.loop.mp4`)
        await loopBack(input, made, MAX_WIDTH[layer])
        durationMs = (await probe(made)).durationMs
        seam.out = seam.in
        if (seam.inScore !== undefined) seam.outScore = seam.inScore
        looped = 'back'
      }
      const file = `clips/${clip.id}.mp4`
      let mask: PackClip['mask']
      if (layout === 'stacked') {
        await keyToStacked(made, join(work, file), background, MAX_WIDTH[layer])
        const stacked = await probe(join(work, file))
        const m = await stackedMask(join(work, file), join(work, `masks/${clip.id}.bin`), stacked)
        mask = { file: `masks/${clip.id}.bin`, width: MASK_WIDTH, height: m.height, fps: MASK_FPS, frames: m.frames }
      } else {
        await transcodeOpaque(made, join(work, file), MAX_WIDTH[layer])
      }
      if (made !== input) rmSync(made, { force: true })
      let audio: string | undefined
      if (clip.audio !== undefined) {
        mkdirSync(join(work, 'lines'), { recursive: true })
        audio = `lines/${basename(clip.audio)}`
        copyFileSync(join(sourceDir, clip.audio), join(work, audio))
      }
      step(`处理 ${clip.id}`)
      const { source: _source, audio: _audio, ...rest } = clip
      return { ...rest, file, durationMs, seam, ...(looped === undefined ? {} : { looped }), ...(mask === undefined ? {} : { mask }), ...(audio === undefined ? {} : { audio }) }
    })

    // What to generate again: the reasons go to the report and to 重做清单.txt beside the clips.
    const redo: Array<{ file: string; why: string }> = []
    for (const clip of clips) {
      const source = inferred.clips.find(c => c.id === clip.id)!.source
      if (clip.seam.inScore !== undefined && clip.seam.in === 'fade') {
        redo.push({ file: source, why: `第一帧和定妆照不一样（相似度 ${clip.seam.inScore}）：生成时首帧要用定妆照（场景用 crop.png）` })
      } else if (clip.seam.outScore !== undefined && clip.seam.out === 'fade') {
        redo.push({ file: source, why: `最后一帧回不到${clip.role === 'transition' ? '目标姿势' : '开头的姿势'}（相似度 ${clip.seam.outScore}）：用"首尾帧"模式，尾帧也放定妆照` })
      }
    }
    for (const item of redo) say('warn', `${item.file}：${item.why}。会用淡入淡出接上，建议重做`)
    const looped = clips.filter(c => c.looped !== undefined)
    if (looped.length > 0) say('ok', `${looped.length} 段结尾回不到开头，已经自动处理成循环（正放一遍再倒放一遍）：${looped.map(c => c.id).join('、')}`)

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
    // A full-screen photo with her clips over one region of it.
    let scene: SceneLayout | undefined
    if (plate !== undefined && existsSync(join(sourceDir, 'scene.json'))) {
      try {
        const value = JSON.parse(readFileSync(join(sourceDir, 'scene.json'), 'utf8')) as SceneLayout
        const r = value.region
        if (![value.width, value.height, r.x, r.y, r.width, r.height].every(n => Number.isFinite(n) && n >= 0) || r.width === 0 || r.height === 0) throw new Error('数字不对')
        scene = { width: value.width, height: value.height, region: { x: r.x, y: r.y, width: r.width, height: r.height } }
        say('ok', `全屏照片 ${value.width}×${value.height}，人物区 ${r.width}×${r.height}（在 ${r.x}, ${r.y}）`)
        // The same scene in other shapes, each with her region on it.
        const plates: NonNullable<SceneLayout['plates']> = []
        for (const other of value.plates ?? []) {
          const o = other.region
          if (typeof other.file !== 'string' || !/^plate_[\w-]+\.(png|jpe?g)$/.test(other.file) || !existsSync(join(sourceDir, other.file))) {
            say('warn', `scene.json 里的照片 ${String(other.file)} 找不到，跳过`)
            continue
          }
          if (![other.width, other.height, o?.x, o?.y, o?.width, o?.height].every(n => Number.isFinite(n) && n >= 0)) {
            say('warn', `scene.json 里 ${other.file} 的数字不对，跳过`)
            continue
          }
          copyFileSync(join(sourceDir, other.file), join(work, other.file))
          plates.push({ file: other.file, width: other.width, height: other.height, region: { x: o.x, y: o.y, width: o.width, height: o.height } })
          say('ok', `另一种比例的照片 ${other.file}（${shapeName(other.width / other.height)}），屏幕比例接近它时用它`)
        }
        if (plates.length > 0) scene.plates = plates
        const ratio = (first.width / first.height) / (r.width / r.height)
        // Clips of the whole picture in a framed region: squeezed or cut off, and only the user can say which they meant.
        if (Math.abs(ratio - 1) > 0.03 && Math.abs((first.width / first.height) / (value.width / value.height) - 1) <= 0.03) say('warn', '这些视频是整张画面的比例，却框了一小块人物区：到形象工坊点"用整张画面"，再导入一次')
        if (Math.abs(ratio - 1) > 0.03) say('warn', `视频的长宽比（${first.width}×${first.height}）和人物区（${r.width}×${r.height}）不一样，边上会被裁掉一点。生成视频时请用做场景时导出的 crop 图`)
      } catch (error) {
        say('warn', `scene.json 读不懂（${(error as Error).message}），按普通场景包处理`)
      }
    }

    const previous = previousImport(packsDir, sourceDir)
    const id = options.id ?? previous?.id ?? idFor(packsDir, sourceDir)
    const cap = MAX_WIDTH[layer]
    const out = first.width <= cap ? first : { ...first, width: cap, height: Math.round((first.height * cap) / first.width / 2) * 2 }
    if (options.screen !== undefined) checkSize(options.screen, layer, out, scene, plate === undefined ? undefined : await stillSize(join(work, plate)).catch(() => undefined), say)
    const pack: Pack = {
      format: PACK_FORMAT,
      id,
      name: options.name ?? previous?.name ?? basename(sourceDir),
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
      ...(scene === undefined ? {} : { scene }),
      source: sourceDir,
    }
    const cuts = clips.filter(c => c.seam.in === 'cut' && c.seam.out === 'cut').length
    say('ok', `${clips.length} 段已识别：${Object.keys(anchors).filter(a => a !== 'off').length} 个姿势，${at('state').length} 段状态、${at('emotion').length} 段情绪、${at('action').length} 段动作、${at('transition').length} 段过渡、${at('line').length} 段台词；${cuts} 段首尾都能无缝衔接`)
    if (inferred.macros.length > 0) say('ok', `组合动作：${inferred.macros.map(m => m.action).join('、')}`)
    for (const clip of clips.filter(c => c.role === 'action')) say('ok', `动作 ${clip.name}：${actionDesc(clip.name)}`)
    writeFileSync(join(work, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`)
    writeFileSync(join(work, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    // The stills made above for checking (reference poses, seam frames); the photos stay.
    const photos = new Set([plate, ...(scene?.plates ?? []).map(p => p.file)])
    for (const f of readdirSync(work)) if (f.endsWith('.png') && !photos.has(f)) rmSync(join(work, f))
    writeRedoList(sourceDir, redo)
    step('写入外形包')

    const dir = join(packsDir, id)
    if (existsSync(dir)) {
      // Keep the version this one replaces, one deep.
      const old = join(packsDir, '.old', id)
      mkdirSync(join(packsDir, '.old'), { recursive: true })
      rmSync(old, { recursive: true, force: true })
      renameSync(dir, old)
      say('ok', `替换了原来的「${previous?.name ?? id}」；上一版留在 ${old}`)
      writeFileSync(join(work, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    }
    renameSync(work, dir)
    return { pack, report, dir }
  } catch (error) {
    rmSync(work, { recursive: true, force: true })
    say('error', `处理失败：${(error as Error).message}`)
    return { report }
  }
}

/** Warn when what she is made of will be enlarged on this screen (soft), or her region does not fit its shape. */
function checkSize(
  screen: NonNullable<ImportOptions['screen']>,
  layer: Pack['layer'],
  clip: { width: number; height: number },
  scene: SceneLayout | undefined,
  photo: { width: number; height: number } | undefined,
  say: (level: ReportLevel, text: string) => void,
): void {
  const screenName = `${Math.round(screen.width * screen.scale)}×${Math.round(screen.height * screen.scale)}`
  if (scene !== undefined) {
    const fit = fitScene(scene, screen.width, screen.height)
    if (!fit.covers) {
      const wider = screen.width / screen.height > scene.width / scene.height
      say('warn', `你的屏幕（${shapeName(screen.width / screen.height)}）比照片（${shapeName(scene.width / scene.height)}）${wider ? '宽' : '窄'}，照片铺满时人物区会被裁到，所以画面缩小 ${Math.round((1 - fit.shrink) * 100)}%、边上用模糊补齐。想铺满：用"扩图"把照片扩成屏幕的比例，写进 scene.json 的 plates`)
    }
    const shown = { width: Math.round(fit.region.width * screen.scale), height: Math.round(fit.region.height * screen.scale) }
    const enlarge = shown.height / clip.height
    if (enlarge > UPSCALE_WARN) say('warn', `人物区在你的屏幕（${screenName}）上约 ${shown.width}×${shown.height} 像素，片段只有 ${clip.width}×${clip.height}，会放大 ${enlarge.toFixed(1)} 倍，看起来会糊。生成时选更高的分辨率（1080P）`)
    if (photo !== undefined) {
      const photoEnlarge = (fit.scale * screen.scale * scene.width) / photo.width
      if (photoEnlarge > UPSCALE_WARN) say('warn', `照片 ${photo.width}×${photo.height} 铺满你的屏幕（${screenName}）要放大 ${photoEnlarge.toFixed(1)} 倍，会有点糊。可以先用 AI 放大到屏幕的大小`)
    }
    return
  }
  if (layer === 'overlay') {
    // She stands about 42% of the screen's height (herSize in main/index.ts).
    const shown = Math.round(screen.height * 0.42 * screen.scale)
    const enlarge = shown / clip.height
    if (enlarge > UPSCALE_WARN) say('warn', `她在你的屏幕上约 ${shown} 像素高，片段只有 ${clip.height}，会放大 ${enlarge.toFixed(1)} 倍，看起来会糊`)
  }
}

const REDO_FILE = '重做清单.txt'

/** 重做清单.txt beside the clips: what to generate again and why. Removed when nothing needs redoing. */
function writeRedoList(sourceDir: string, redo: Array<{ file: string; why: string }>): void {
  const file = join(sourceDir, REDO_FILE)
  try {
    if (redo.length === 0) {
      rmSync(file, { force: true })
      return
    }
    const lines = ['这些片段建议重新生成（导入时自动写的，下次导入会更新）', '', ...redo.map(r => `${r.file}\n  ${r.why}`), '']
    writeFileSync(file, lines.join('\n'))
  } catch {
    // a read-only folder: the report says it all anyway
  }
}
