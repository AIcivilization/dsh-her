import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanPixelInfo, wrapPixelCode } from '../src/core/pixel.ts'
import { makeGrid } from '../src/core/pixel-grid.ts'
import { colorRows, cropBox, cutBackground, makePicture, monoRows, pictureCode, PICTURE_MAX_W, type Rgba } from '../src/core/pixel-picture.ts'

/** A w × h picture: a plain background and shapes drawn on it. */
function picture(w: number, h: number, bg: [number, number, number, number], paint: (x: number, y: number) => [number, number, number, number] | undefined): Rgba {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y) ?? bg
      data.set(c, (y * w + x) * 4)
    }
  }
  return { data, w, h }
}

const RED: [number, number, number, number] = [220, 30, 30, 255]
const YELLOW: [number, number, number, number] = [250, 220, 40, 255]
const WHITE: [number, number, number, number] = [255, 255, 255, 255]
/** A red square with a yellow middle, on white, off to one side; a white dot inside it that must not be taken away. */
const art = () => picture(200, 100, WHITE, (x, y) => {
  if (x < 20 || x >= 80 || y < 20 || y >= 80) return undefined
  if (x >= 48 && x < 52 && y >= 48 && y < 52) return WHITE
  return x >= 35 && x < 65 && y >= 35 && y < 65 ? YELLOW : RED
})

test('a plain background is taken away from the edges in, not inside the picture; then it is cut to what is left', () => {
  const img = art()
  assert.equal(cutBackground(img), true)
  assert.equal(img.data[3], 0, 'corner gone')
  assert.equal(img.data[(50 * 200 + 50) * 4 + 3], 255, 'the white inside stays')
  assert.deepEqual(cropBox(img), { x: 20, y: 20, w: 60, h: 60 })
  // A busy edge is left alone.
  const busy = picture(40, 40, WHITE, (x, y) => ((x + y) % 2 === 0 ? [0, 0, 0, 255] : undefined))
  assert.equal(cutBackground(busy), false)
})

test('a picture becomes rows of characters: mono by lightness, colour by letters', () => {
  const mono = makePicture(art(), { height: 12, color: false, cutBackground: true })
  assert.equal(mono.background, 'cut')
  assert.deepEqual([mono.w, mono.h], [12, 12])
  assert.equal(mono.rows.length, 12)
  assert.ok(mono.rows.every(r => /^[1-9.]{12}$/.test(r)))
  // The red edge is darker than the yellow middle.
  assert.ok(Number(mono.rows[0]![0]) < Number(mono.rows[6]![3]))
  assert.equal(mono.rows[6]![3], '9')

  const color = makePicture(art(), { height: 12, color: true, cutBackground: true })
  assert.ok(color.palette !== undefined && Object.keys(color.palette).length >= 2 && Object.keys(color.palette).length <= 16)
  const red = color.rows[0]![0]!
  const yellow = color.rows[6]![3]!
  assert.notEqual(red, yellow)
  assert.match(color.palette![red]!, /^#d[0-9a-f]1[0-9a-f]1[0-9a-f]$/)

  // Kept: nothing taken away; already see-through: said so.
  assert.equal(makePicture(art(), { height: 12, color: false, cutBackground: false }).background, 'kept')
  const clear = makePicture(picture(50, 50, [0, 0, 0, 0], (x, y) => (x > 10 && x < 40 && y > 10 && y < 40 ? RED : undefined)), { height: 10, color: false, cutBackground: true })
  assert.equal(clear.background, 'clear')
  assert.deepEqual([clear.w, clear.h], [10, 10])
})

test('a wide picture is kept within the widest; colours are at most 16', () => {
  const wide = makePicture(picture(1000, 50, RED, () => undefined), { height: 40, color: false, cutBackground: false })
  assert.equal(wide.w, PICTURE_MAX_W)
  assert.equal(wide.h, 5)
  const rainbow = picture(64, 64, WHITE, (x, y) => [x * 4, y * 4, (x * y) % 256, 255])
  const { palette } = colorRows(rainbow)
  assert.equal(Object.keys(palette).length, 16)
  assert.deepEqual(monoRows(picture(2, 1, WHITE, () => undefined)), ['99'])
})

test('the file made from a picture runs, draws the picture, and says to keep it', () => {
  for (const color of [false, true]) {
    const pic = makePicture(art(), { height: 24, color, cutBackground: true })
    const code = pictureCode(pic, '红方块')
    assert.match(code, /PICTURE 就是那张图/)
    const { script, problems } = wrapPixelCode(code)
    assert.deepEqual(problems, [])
    // eslint-disable-next-line no-new-func
    const anim = new Function(`${script}\nreturn __anim`)() as { info: unknown; frame: (g: unknown, t: number, n: number) => void }
    const info = cleanPixelInfo(anim.info).info!
    assert.equal(info.color, color ? 'color' : 'mono')
    const g = makeGrid(192, 108, info.color)
    anim.frame(g, 0, 0)
    let drawn = 0
    for (let i = 3; i < g.data.length; i += 4) if (g.data[i]! > 0) drawn++
    // 24 cells high at scale 3 (80% of 108 is 86): 72 × 72 drawn.
    assert.equal(drawn, 72 * 72)
  }
})
