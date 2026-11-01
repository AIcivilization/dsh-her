/**
 * Where a full-screen photo and her region go on a screen (docs/形象工坊与多场景.md §6).
 *
 * The photo fills the screen like a wallpaper, centred, but it is moved as
 * little as needed so her region is never cut. When the region cannot fit
 * even then (a region the photo's full height, on a wider screen), the photo
 * shrinks just enough to show her whole and `covers` is false: the page
 * fills the edges with a blurred copy.
 */

import type { SceneLayout } from './types.ts'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface SceneFit {
  /** Photo pixels to screen pixels. */
  scale: number
  /** The photo's top-left corner on the screen (may be negative). */
  left: number
  top: number
  /** Her region on the screen. */
  region: Box
  /** Whether the photo fills the whole screen. */
  covers: boolean
  /** `scale` against the scale that would just fill the screen (1 when it does). */
  shrink: number
}

/** Common screen shapes, width / height. */
export const SCREEN_SHAPES: ReadonlyArray<{ name: string; aspect: number }> = [
  { name: '16:10', aspect: 16 / 10 },
  { name: '16:9', aspect: 16 / 9 },
  { name: '21:9', aspect: 2.37 },
  { name: '3:2', aspect: 3 / 2 },
]

/** Keep [start, start + size) inside [0, view) by moving `offset` (the photo's edge) as little as possible. */
function place(offset: number, start: number, size: number, view: number, photo: number): number {
  if (photo <= view) return (view - photo) / 2
  let next = offset
  if (next + start < 0) next = -start
  if (next + start + size > view) next = view - start - size
  return Math.min(0, Math.max(view - photo, next))
}

export function fitScene(scene: Pick<SceneLayout, 'width' | 'height' | 'region'>, viewWidth: number, viewHeight: number): SceneFit {
  const r = scene.region
  const cover = Math.max(viewWidth / scene.width, viewHeight / scene.height)
  const scale = Math.min(cover, viewWidth / r.width, viewHeight / r.height)
  const width = scene.width * scale
  const height = scene.height * scale
  const left = place((viewWidth - width) / 2, r.x * scale, r.width * scale, viewWidth, width)
  const top = place((viewHeight - height) / 2, r.y * scale, r.height * scale, viewHeight, height)
  return {
    scale, left, top,
    region: { x: left + r.x * scale, y: top + r.y * scale, width: r.width * scale, height: r.height * scale },
    covers: scale >= cover * 0.999,
    shrink: scale >= cover * 0.999 ? 1 : scale / cover,
  }
}

/** How a scene fares on a screen of this shape: 1 = fills it and shows her whole; below 1 = shrunk that much, edges blurred. */
export function shrinkOn(scene: Pick<SceneLayout, 'width' | 'height' | 'region'>, aspect: number): number {
  return fitScene(scene, aspect * 1000, 1000).shrink
}

/** Of several photos of one scene (different shapes), the one closest to the screen's shape. */
export function closestShape<T extends { width: number; height: number }>(options: readonly T[], aspect: number): T | undefined {
  let best: T | undefined
  let distance = Infinity
  for (const option of options) {
    const d = Math.abs(Math.log(option.width / option.height / aspect))
    if (d < distance) {
      best = option
      distance = d
    }
  }
  return best
}

/** "16:9"-style name of a shape, or the ratio itself when it is none of the common ones. */
export function shapeName(aspect: number): string {
  const known = SCREEN_SHAPES.find(s => Math.abs(s.aspect / aspect - 1) < 0.02)
  return known?.name ?? `${aspect.toFixed(2)}:1`
}
