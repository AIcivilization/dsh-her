/**
 * Her small picture in DSH's page: upper body, hands on the top edge of the chat
 * box as if it were a table. It is generated on a green screen with a narrow
 * white table along the bottom, because hands drawn on nothing come out floating.
 * Here both go: the screen is keyed away, the table cut at its edge, and her
 * fingers, which lie across it, stay.
 *
 * `头像原图.*` (what was uploaded) becomes `头像.png` and `头像.json` in the
 * project: how much of the picture's bottom hangs below the table's edge, for
 * placing it over the chat box.
 *
 * `头像原视频.*` is the same picture moving: each frame gets the same treatment,
 * it plays forward then backward so it loops, and `头像.mp4` holds colour over
 * mask, as her other clips do, because no format with transparency plays
 * everywhere (body/renderer/stacked.ts draws it).
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { ffmpegCommand, frame, stillSize } from './media.ts'

export const AVATAR_SOURCES = ['头像原图.png', '头像原图.jpg', '头像原图.jpeg', '头像原图.webp']
export const AVATAR_FILE = '头像.png'
export const AVATAR_INFO = '头像.json'
export const AVATAR_CLIP_SOURCES = ['头像原视频.mp4', '头像原视频.mov', '头像原视频.webm', '头像原视频.m4v']
export const AVATAR_CLIP = '头像.mp4'

const AVATAR_SIZE = 256
/** Keyed at this size, shown at about a third of it; fine for her edges, and small enough for a small server. */
const CLIP_WORK_SIZE = 384
const CLIP_FPS = 20
const CLIP_MOST_SECONDS = 10
/** A table is a strip along the bottom, not a light background. */
const MOST_TABLE = 0.2
/** Rows at the table's edge that are a blend of screen and table. */
const EDGE_ROWS = 4
/** How far green stands above the other two: below this she is solid, above that it is the screen. */
const GREEN_SOLID = 30
const GREEN_GONE = 90
const TABLE_LIGHT = 205

const clamp = (n: number) => Math.max(0, Math.min(1, n))

/** Is this RGBA picture's top-left corner a green screen? */
export function hasGreenScreen(rgba: Uint8Array): boolean {
  return rgba[1]! > rgba[0]! + 60 && rgba[1]! > rgba[2]! + 60
}

/**
 * Where the table starts: the top of the light rows along the bottom, judged at
 * both edges, where no hand can be. `height` when there is no table.
 */
export function tableLine(rgba: Uint8Array, width: number, height: number): number {
  const edgeLight = (y: number, x: number) => {
    const at = (y * width + x) * 4
    return Math.min(rgba[at]!, rgba[at + 1]!, rgba[at + 2]!) > TABLE_LIGHT && rgba[at + 3]! > 128
  }
  let line = height
  while (line > 0 && edgeLight(line - 1, 2) && edgeLight(line - 1, width - 3)) line--
  return height - line > height * MOST_TABLE ? height : line
}

/** Key the screen away and take the table out, in place; what is on the table (her fingers) stays. */
export function keyAvatar(rgba: Uint8Array, width: number, height: number, line: number): void {
  const screen = hasGreenScreen(rgba)
  const seam = Math.max(0, line - EDGE_ROWS)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      const [r, g, b] = [rgba[at]!, rgba[at + 1]!, rgba[at + 2]!]
      const over = g - Math.max(r, b)
      let alpha = screen ? 1 - clamp((over - GREEN_SOLID) / (GREEN_GONE - GREEN_SOLID)) : 1
      if (y >= seam && line < height) {
        // The table, and the blend at its edge, which is the only greenish thing there.
        const low = Math.min(r, g, b)
        const blended = y <= line + EDGE_ROWS && g >= r && g >= b
        // The table has no colour; her nails, as light as it, do.
        const neutral = Math.max(r, g, b) - low < 22
        if (blended) alpha = 0
        else if (y >= line && neutral) alpha = Math.min(alpha, clamp((TABLE_LIGHT - low) / 25))
      }
      // What is left of the green on her edges (hair) would show as a fringe.
      if (screen && over > 0) rgba[at + 1] = Math.max(r, b)
      rgba[at + 3] = Math.round(rgba[at + 3]! * alpha)
      // Scaling blends neighbours, the invisible ones too: they must not be green.
      if (rgba[at + 3] === 0) rgba.set([128, 128, 128], at)
    }
  }
}

/** Make the picture from what was uploaded. Needs ffmpeg in use (ensureFfmpeg). */
export async function makeAvatar(dir: string): Promise<{ overhang: number }> {
  const source = AVATAR_SOURCES.find(file => existsSync(join(dir, file)))
  if (source === undefined) throw new Error('还没有上传头像图')
  const path = join(dir, source)
  const { width, height } = await stillSize(path)
  const { stdout } = await promisify(execFile)(ffmpegCommand(), ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { encoding: 'buffer', maxBuffer: 1 << 30 })
  const line = tableLine(stdout, width, height)
  keyAvatar(stdout, width, height, line)
  await new Promise<void>((done, fail) => {
    const encode = spawn(ffmpegCommand(), ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', '-', '-vf', `scale=${AVATAR_SIZE}:-2:flags=lanczos`, '-frames:v', '1', join(dir, AVATAR_FILE)], { stdio: ['pipe', 'ignore', 'pipe'] })
    let errors = ''
    encode.stderr.on('data', chunk => { errors += chunk })
    encode.on('error', fail)
    encode.on('close', code => (code === 0 ? done() : fail(new Error(`处理头像没成功：${errors.trim().slice(-200)}`))))
    encode.stdin.end(stdout)
  })
  const overhang = (height - line) / height
  saveInfo(dir, { overhang })
  return { overhang }
}

function saveInfo(dir: string, change: { overhang?: number; clipOverhang?: number }): void {
  let info = {}
  try {
    info = JSON.parse(readFileSync(join(dir, AVATAR_INFO), 'utf8')) as object
  } catch {
    // the first one
  }
  writeFileSync(join(dir, AVATAR_INFO), `${JSON.stringify({ ...info, ...change }, null, 2)}\n`)
}

/** Make the moving picture from what was uploaded. Needs ffmpeg in use (ensureFfmpeg). */
export async function makeAvatarClip(dir: string): Promise<{ overhang: number }> {
  const source = AVATAR_CLIP_SOURCES.find(file => existsSync(join(dir, file)))
  if (source === undefined) throw new Error('还没有上传头像视频')
  const path = join(dir, source)
  // Without a picture, its first frame is one: what shows where a clip cannot play.
  if (!AVATAR_SOURCES.some(file => existsSync(join(dir, file)))) {
    await frame(path, 'first', join(dir, AVATAR_SOURCES[0]!))
    await makeAvatar(dir)
  }
  const size = CLIP_WORK_SIZE
  const frameBytes = size * size * 4
  const decode = spawn(ffmpegCommand(), ['-v', 'error', '-t', String(CLIP_MOST_SECONDS), '-i', path, '-filter_complex',
    `[0]fps=${CLIP_FPS},scale=${size}:${size}:flags=lanczos,split[a][b];[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1,format=rgba`,
    '-r', String(CLIP_FPS), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const encode = spawn(ffmpegCommand(), ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${size}x${size}`, '-r', String(CLIP_FPS), '-i', '-', '-filter_complex',
    `[0]scale=${AVATAR_SIZE}:${AVATAR_SIZE}:flags=lanczos,format=rgba,split[c][a];[a]alphaextract,format=yuv420p[m];[c]format=yuv420p[rgb];[rgb][m]vstack,format=yuv420p`,
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-movflags', '+faststart', join(dir, AVATAR_CLIP)], { stdio: ['pipe', 'ignore', 'pipe'] })
  let errors = ''
  for (const process of [decode, encode]) process.stderr.on('data', chunk => { errors += chunk })
  const finished = (process: typeof decode | typeof encode) => new Promise<number | null>(done => process.on('close', done))
  let line: number | undefined
  let held: Buffer = Buffer.alloc(0)
  const key = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      held = held.length === 0 ? chunk : Buffer.concat([held, chunk])
      let at = 0
      while (held.length - at >= frameBytes) {
        const picture = Buffer.from(held.subarray(at, at + frameBytes))
        line ??= tableLine(picture, size, size)
        keyAvatar(picture, size, size, line)
        this.push(picture)
        at += frameBytes
      }
      held = held.subarray(at)
      done()
    },
  })
  const closed = Promise.all([finished(decode), finished(encode)])
  await pipeline(decode.stdout, key, encode.stdin).catch(() => {})
  const [decoded, encoded] = await closed
  if (decoded !== 0 || encoded !== 0 || line === undefined) throw new Error(`处理头像视频没成功：${errors.trim().slice(-200) || '视频读不出来'}`)
  const overhang = (size - line) / size
  saveInfo(dir, { clipOverhang: overhang })
  return { overhang }
}
