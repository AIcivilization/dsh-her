import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closestShape, fitScene, shapeName, shrinkOn } from '../body/shared/fit.ts'

// The 卧室 scene: a 16:10 photo, her region the photo's full height.
const bedroom = { width: 1586, height: 992, region: { x: 788, y: 0, width: 558, height: 992 } }

const inside = (box: { x: number; y: number; width: number; height: number }, w: number, h: number) =>
  box.x >= -0.01 && box.y >= -0.01 && box.x + box.width <= w + 0.01 && box.y + box.height <= h + 0.01

test('a photo of the screen shape fills it exactly', () => {
  const fit = fitScene(bedroom, 1586, 992)
  assert.equal(fit.covers, true)
  assert.equal(fit.shrink, 1)
  assert.deepEqual([fit.left, fit.top, fit.scale], [0, 0, 1])
})

test('on a 16:9 screen a full-height region shrinks the photo instead of cutting her', () => {
  const fit = fitScene(bedroom, 1920, 1080)
  assert.equal(fit.covers, false)
  assert.ok(inside(fit.region, 1920, 1080))
  assert.equal(Math.round(fit.region.height), 1080)
  assert.ok(fit.shrink < 0.95 && fit.shrink > 0.85)
})

test('a region that fits is kept whole by moving the photo, not shrinking it', () => {
  // Her near the right edge, two thirds of the height: on a narrow (4:3) screen the centred crop would cut her.
  const scene = { width: 1600, height: 1000, region: { x: 1300, y: 300, width: 280, height: 600 } }
  const fit = fitScene(scene, 1200, 900)
  assert.equal(fit.covers, true)
  assert.ok(inside(fit.region, 1200, 900))
  assert.ok(fit.left < 0 && fit.left >= 1200 - 1600 * fit.scale)
})

test('a centred region stays centred', () => {
  const scene = { width: 1600, height: 1000, region: { x: 700, y: 200, width: 200, height: 600 } }
  const fit = fitScene(scene, 1920, 1080)
  assert.equal(fit.covers, true)
  assert.equal(Math.round(fit.left), Math.round((1920 - 1600 * fit.scale) / 2))
})

test('shrinkOn tells how each screen shape fares', () => {
  assert.equal(shrinkOn(bedroom, 1586 / 992), 1)
  assert.ok(shrinkOn(bedroom, 16 / 9) < 1)
  assert.ok(shrinkOn(bedroom, 2.37) < shrinkOn(bedroom, 16 / 9))
  // A narrower screen crops the sides; she is not near them, so nothing shrinks.
  assert.equal(shrinkOn(bedroom, 3 / 2), 1)
})

test('closestShape picks the photo nearest the screen shape', () => {
  const plates = [{ id: '16x10', width: 1600, height: 1000 }, { id: '16x9', width: 1920, height: 1080 }, { id: '21x9', width: 3440, height: 1440 }]
  assert.equal(closestShape(plates, 1920 / 1080)?.id, '16x9')
  assert.equal(closestShape(plates, 3024 / 1964)?.id, '16x10')
  assert.equal(closestShape(plates, 2560 / 1080)?.id, '21x9')
  assert.equal(closestShape([], 1.6), undefined)
})

test('shapeName names common shapes', () => {
  assert.equal(shapeName(1920 / 1080), '16:9')
  assert.equal(shapeName(2560 / 1600), '16:10')
  // A MacBook Pro's screen is not quite 16:10.
  assert.equal(shapeName(3024 / 1964), '1.54:1')
  assert.equal(shapeName(3440 / 1440), '21:9')
  assert.equal(shapeName(1.25), '1.25:1')
})
