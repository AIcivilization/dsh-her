/**
 * ffmpeg for the pack import: probing, frames, seam scores, keying into the
 * stacked layout, and click masks. Uses only the ffmpeg binary (no ffprobe):
 * `DSH_HER_FFMPEG`, else the app's own (installed body), else `ffmpeg` on PATH.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
/** The installed app carries its own ffmpeg next to the app's resources; development uses the one on PATH. */
/** Electron's resources folder (the installed body); not there in plain Node. */
const resources = (process as { resourcesPath?: unknown }).resourcesPath
const bundled = typeof resources === 'string' ? join(resources, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : undefined
const FFMPEG = process.env.DSH_HER_FFMPEG ?? (bundled !== undefined && existsSync(bundled) ? bundled : 'ffmpeg')

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
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-v', 'error', '-i', still, '-vf', 'crop=iw:ih/12:0:0,scale=1:1,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })
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
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', '-map_metadata', '-1', output])
}

/** Re-encode a clip as it is (scene packs). */
export async function transcodeOpaque(input: string, output: string, width: number): Promise<void> {
  await ffmpeg(['-y', '-i', input, '-vf', `scale='min(${width},iw)':-2,format=yuv420p`,
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', '-map_metadata', '-1', output])
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
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', output])
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
