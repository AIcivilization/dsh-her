/**
 * Framing a 形象工坊 scene without a desktop body: the photo (plate.png) and the
 * region she moves in become scene.json and crop.png in the scene's folder,
 * with ffmpeg (the desktop body's 做场景 window does the same with Electron).
 */

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cropStill, stillSize } from './media.ts'
import type { SceneLayout } from './types.ts'

const MIN_REGION = 64

/** The photo of a scene folder, or undefined when it has none yet. */
export function plateIn(dir: string): string | undefined {
  return ['plate.png', 'plate.jpg', 'plate.jpeg'].find(file => existsSync(join(dir, file)))
}

/** A region kept inside a photo, on whole pixels; even sizes, since video encoders need them. */
export function clampRegion(region: SceneLayout['region'], photo: { width: number; height: number }): SceneLayout['region'] {
  const x = Math.max(0, Math.round(region.x))
  const y = Math.max(0, Math.round(region.y))
  const even = (n: number) => Math.floor(n / 2) * 2
  return { x, y, width: even(Math.min(Math.round(region.width), photo.width - x)), height: even(Math.min(Math.round(region.height), photo.height - y)) }
}

export async function saveFrame(dir: string, region: SceneLayout['region']): Promise<SceneLayout> {
  const plate = plateIn(dir)
  if (plate === undefined) throw new Error('这个场景还没有照片（plate.png）')
  const photo = await stillSize(join(dir, plate))
  const r = clampRegion(region, photo)
  if (r.width < MIN_REGION || r.height < MIN_REGION) throw new Error('人物区太小了')
  await cropStill(join(dir, plate), r, join(dir, 'crop.png'))
  const scene: SceneLayout = { width: photo.width, height: photo.height, region: r }
  writeFileSync(join(dir, 'scene.json'), `${JSON.stringify(scene, null, 2)}\n`)
  return scene
}
