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
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ffmpegCommand, stillSize } from './media.ts'

export const AVATAR_SOURCES = ['头像原图.png', '头像原图.jpg', '头像原图.jpeg', '头像原图.webp']
export const AVATAR_FILE = '头像.png'
export const AVATAR_INFO = '头像.json'

const AVATAR_SIZE = 256
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
  writeFileSync(join(dir, AVATAR_INFO), `${JSON.stringify({ overhang }, null, 2)}\n`)
  return { overhang }
}
