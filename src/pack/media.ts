/**
 * ffmpeg for the pack import: probing, frames, seam scores, keying into the
 * stacked layout, and click masks. Uses only the ffmpeg binary (no ffprobe):
 * `DSH_HER_FFMPEG`, else the app's own (installed body), else `ffmpeg` on PATH.
 */

import { execFile, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
/** The installed app carries its own ffmpeg next to the app's resources; development uses the one on PATH. */
/** Electron's resources folder (the installed body); not there in plain Node. */
const resources = (process as { resourcesPath?: unknown }).resourcesPath
const bundled = typeof resources === 'string' ? join(resources, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : undefined
let FFMPEG = process.env.DSH_HER_FFMPEG ?? (bundled !== undefined && existsSync(bundled) ? bundled : 'ffmpeg')

/** Use this ffmpeg from now on (one the brain found or downloaded). */
export function useFfmpeg(path: string): void {
  FFMPEG = path
  encoders = undefined
}

/**
 * H.264 encoders, best first. Builds differ: a GPL one has libx264; an LGPL
 * one (what is shipped and downloaded, BtbN's) has Cisco's libopenh264; Windows
 * has Media Foundation's and macOS VideoToolbox's even without either.
 */
const H264 = ['libx264', 'libopenh264', 'h264_mf', 'h264_videotoolbox'] as const
export type H264Encoder = typeof H264[number]

/** The encoder to use from what `ffmpeg -encoders` lists; undefined when none can write H.264. */
export function pickH264(encoderList: string): H264Encoder | undefined {
  const names = new Set(encoderList.split('\n').map(line => /^\s*V\S*\s+(\S+)/.exec(line)?.[1]).filter((n): n is string => n !== undefined))
  return H264.find(name => names.has(name))
}

/**
 * Arguments for H.264 at a quality given as libx264's CRF (12: near lossless,
 * for work in between; 20–22: what she plays). Encoders without CRF get a bitrate
 * that looks the same at her sizes.
 */
export function h264Args(encoder: H264Encoder, crf: number): string[] {
  if (encoder === 'libx264') return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf)]
  const rate = crf <= 14 ? '20M' : crf <= 20 ? '8M' : '5M'
  if (encoder === 'h264_videotoolbox') return ['-c:v', 'h264_videotoolbox', '-b:v', rate, '-allow_sw', '1']
  return ['-c:v', encoder, '-b:v', rate, '-maxrate', rate]
}

let encoders: Promise<H264Encoder> | undefined
const NO_H264 = '这个 ffmpeg 不能写 H.264（没有 libx264、libopenh264 或系统自带的编码器），导入要用它：换一个 ffmpeg'

/** The H.264 arguments for the ffmpeg in use (looked up once per ffmpeg). */
export async function h264(crf: number): Promise<string[]> {
  encoders ??= run(FFMPEG, ['-hide_banner', '-encoders'], { maxBuffer: 8 * 1024 * 1024 }).then(({ stdout }) => {
    const found = pickH264(stdout)
    if (found === undefined) throw new Error(NO_H264)
    return found
  })
  const encoder = await encoders.catch(error => {
    encoders = undefined
    throw error
  })
  return h264Args(encoder, crf)
}

/** The same, where waiting is not possible (making stills into clips while a stage is put on). */
export function h264Sync(crf: number): string[] {
  const found = pickH264(String(spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 20_000 }).stdout ?? ''))
  if (found === undefined) throw new Error(NO_H264)
  return h264Args(found, crf)
}

/** The ffmpeg in use: a full path once one was found, else the bare name on PATH. */
export const ffmpegCommand = () => FFMPEG

async function ffmpeg(args: string[]): Promise<string> {
  try {
    const { stderr } = await run(FFMPEG, ['-hide_banner', ...args], { maxBuffer: 64 * 1024 * 1024 })
    return stderr
  } catch (error) {
    const failure = error as { stderr?: string; code?: unknown }
    // `ffmpeg -i file` alone exits 1 by design; its stderr is still the probe.
    if (typeof failure.stderr === 'string' && args.length === 2 && args[0] === '-i') return failure.stderr
    throw new Error(`ffmpeg ${args.join(' ')}: ${(failure.stderr ?? String(error)).trim().split('\n').slice(-3).join(' ')}`)
  }
}

export interface Probe {
  width: number
  height: number
  fps: number
  durationMs: number
  hasAudio: boolean
}

export async function probe(file: string): Promise<Probe> {
  const info = await ffmpeg(['-i', file])
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(info)
  const video = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*?([\d.]+) (?:fps|tbr)/.exec(info)
  if (duration === null || video === null) throw new Error(`读不出视频信息：${file}`)
  return {
    width: Number(video[1]),
    height: Number(video[2]),
    fps: Number(video[3]),
    durationMs: Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000),
    hasAudio: /Stream #[^\n]*Audio:/.test(info),
  }
}

/** Whether ffmpeg can be run here (the body brings its own; a server may not have one). */
export async function hasFfmpeg(): Promise<boolean> {
  try {
    await run(FFMPEG, ['-hide_banner', '-version'])
    return true
  } catch {
    return false
  }
}

/** A rectangle of a still image, as a PNG. */
export async function cropStill(file: string, region: { x: number; y: number; width: number; height: number }, out: string): Promise<void> {
  await ffmpeg(['-y', '-i', file, '-vf', `crop=${region.width}:${region.height}:${region.x}:${region.y}`, '-frames:v', '1', out])
}

/** Width and height of a still image. */
export async function stillSize(file: string): Promise<{ width: number; height: number }> {
  const info = await ffmpeg(['-i', file])
  const size = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(info)
  if (size === null) throw new Error(`读不出图片尺寸：${file}`)
  return { width: Number(size[1]), height: Number(size[2]) }
}

/** First or last frame of a clip, as a PNG. */
export async function frame(file: string, which: 'first' | 'last', out: string): Promise<void> {
  if (which === 'first') await ffmpeg(['-y', '-i', file, '-frames:v', '1', out])
  else await ffmpeg(['-y', '-sseof', '-0.3', '-i', file, '-update', '1', out])
}

/** SSIM of two stills (0–1), both scaled to 320×320. */
export async function ssim(a: string, b: string): Promise<number> {
  const out = await ffmpeg(['-i', a, '-i', b, '-lavfi', '[0]scale=320:320,format=yuv420p[a];[1]scale=320:320,format=yuv420p[b];[a][b]ssim', '-f', 'null', '-'])
  const all = /All:([\d.]+)/.exec(out)
  if (all === null) throw new Error('SSIM failed')
  return Number(all[1])
}

/** Average colour of a still's border, as 0xRRGGBB, to recognise a green screen. */
export async function borderColor(still: string): Promise<{ r: number; g: number; b: number }> {
  // Sample the top strip: a background, whatever the subject does.
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-v', 'error', '-i', still, '-vf', 'crop=iw:ih/12:0:0,scale=1:1,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-'], { encoding: 'buffer' })
  const bytes = stdout as unknown as Buffer
  return { r: bytes[0] ?? 0, g: bytes[1] ?? 0, b: bytes[2] ?? 0 }
}

export function isGreenScreen(color: { r: number; g: number; b: number }): boolean {
  return color.g > 90 && color.g > color.r + 50 && color.g > color.b + 40
}

const hex = (c: { r: number; g: number; b: number }) => `0x${[c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')}`

/**
 * Key a green-screen clip into the stacked layout: colour on top, alpha mask
 * below, H.264. `width` caps the output width (height follows, kept even).
 */
export async function keyToStacked(input: string, output: string, key: { r: number; g: number; b: number }, width: number): Promise<void> {
  await ffmpeg(['-y', '-i', input, '-filter_complex',
    `[0]scale='min(${width},iw)':-2,chromakey=${hex(key)}:0.13:0.06,despill=type=green,format=rgba,split[c][a];` +
    '[a]alphaextract,format=yuv420p[m];[c]format=yuv420p[rgb];[rgb][m]vstack,format=yuv420p',
    '-an', ...await h264(20), '-movflags', '+faststart', '-map_metadata', '-1', output])
}

/**
 * Take a plain background out of a clip or a picture (素材库's "抠掉背景"):
 * a WebM with transparency (VP9), or a PNG. A coloured background (green,
 * blue) is keyed by its hue; a white or grey one by its colour.
 */
export async function keyToAlpha(input: string, output: string, key: { r: number; g: number; b: number }): Promise<void> {
  const plain = Math.max(key.r, key.g, key.b) - Math.min(key.r, key.g, key.b) < 40
  const spill = isGreenScreen(key) ? ',despill=type=green' : key.b > key.r + 50 && key.b > key.g + 40 ? ',despill=type=blue' : ''
  const filter = plain ? `colorkey=${hex(key)}:0.1:0.05` : `chromakey=${hex(key)}:0.13:0.06${spill}`
  if (/\.png$/i.test(output)) await ffmpeg(['-y', '-i', input, '-vf', `${filter},format=rgba`, '-frames:v', '1', output])
  else {
    await ffmpeg(['-y', '-i', input, '-vf', `scale=trunc(iw/2)*2:trunc(ih/2)*2,${filter},format=yuva420p`, '-an',
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-auto-alt-ref', '0', '-map_metadata', '-1', output])
  }
}

/** Re-encode a clip as it is (scene packs). */
export async function transcodeOpaque(input: string, output: string, width: number): Promise<void> {
  await ffmpeg(['-y', '-i', input, '-vf', `scale='min(${width},iw)':-2,format=yuv420p`,
    '-an', ...await h264(20), '-movflags', '+faststart', '-map_metadata', '-1', output])
}

/**
 * Play a clip forward and then backward, so it ends on its own first frame:
 * a loop for a clip whose last frame drifted (generators that take only a
 * first frame). Scaled to `width` first, since reversing holds every frame
 * in memory; kept near-lossless for the keying or transcoding that follows.
 */
export async function loopBack(input: string, output: string, width: number): Promise<void> {
  await ffmpeg(['-y', '-i', input, '-filter_complex',
    `[0]scale='min(${width},iw)':-2,split[a][b];[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1:a=0,format=yuv420p`,
    '-an', ...await h264(12), output])
}

export const MASK_WIDTH = 64
export const MASK_FPS = 10

/**
 * Click mask of a stacked clip: its lower half, 64 px wide, 10 frames a
 * second, one byte per pixel. Returns the mask height and frame count.
 */
export async function stackedMask(stacked: string, output: string, source: Probe): Promise<{ height: number; frames: number }> {
  const frameH = source.height / 2
  const height = Math.max(2, Math.round((MASK_WIDTH * frameH) / source.width / 2) * 2)
  await ffmpeg(['-y', '-i', stacked, '-vf', `crop=iw:ih/2:0:ih/2,fps=${MASK_FPS},scale=${MASK_WIDTH}:${height},format=gray`, '-f', 'rawvideo', output])
  const { size } = await import('node:fs').then(fs => fs.promises.stat(output))
  return { height, frames: Math.floor(size / (MASK_WIDTH * height)) }
}
