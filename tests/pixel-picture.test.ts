import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanPixelInfo, wrapPixelCode } from '../src/core/pixel.ts'
import { makeGrid } from '../src/core/pixel-grid.ts'
import { colorRows, cropBox, cutBackground, makePicture, monoRows, outline, pictureCode, PICTURE_COLORS, PICTURE_MAX_H, PICTURE_MAX_W, type Rgba } from '../src/core/pixel-picture.ts'

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
  assert.ok(color.palette !== undefined && Object.keys(color.palette).length >= 2 && Object.keys(color.palette).length <= PICTURE_COLORS)
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

test('a wide picture is kept within the widest, a tall one within the tallest; colours are at most 32', () => {
  const wide = makePicture(picture(1000, 50, RED, () => undefined), { height: 40, color: false, cutBackground: false })
  assert.equal(wide.w, PICTURE_MAX_W)
  assert.equal(wide.h, 10)
  const tall = makePicture(picture(50, 1000, RED, () => undefined), { height: 500, color: false, cutBackground: false })
  assert.deepEqual([tall.w, tall.h], [6, PICTURE_MAX_H])
  const rainbow = picture(64, 64, WHITE, (x, y) => [x * 4, y * 4, (x * y) % 256, 255])
  const { palette } = colorRows(rainbow)
  assert.equal(Object.keys(palette).length, 32)
  assert.ok(Object.keys(palette).every(k => /^[a-zA-Z]$/.test(k)))
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

test('an outline is a ring a cell wide, each cell a darker shade of what it touches', () => {
  const dot = picture(3, 3, [0, 0, 0, 0], (x, y) => (x === 1 && y === 1 ? [210, 90, 30, 255] : y === 2 && x === 1 ? [30, 90, 210, 255] : undefined))
  const ring = outline(dot)
  assert.deepEqual([ring.w, ring.h], [5, 5])
  const at = (x: number, y: number) => Array.from(ring.data.subarray((y * 5 + x) * 4, (y * 5 + x) * 4 + 4))
  assert.deepEqual(at(2, 2), [210, 90, 30, 255], 'the picture moved in a cell')
  assert.deepEqual(at(2, 1), [70, 30, 10, 255], 'above the orange: dark orange')
  assert.deepEqual(at(2, 4), [10, 30, 70, 255], 'below the blue: dark blue')
  assert.equal(at(0, 0)[3], 0, 'corners are not touched')
  assert.equal(at(1, 1)[3], 0, 'nor diagonals')
  // Colour pictures can have one: a cell more each way.
  const plain = makePicture(art(), { height: 12, color: true, cutBackground: true })
  const edged = makePicture(art(), { height: 12, color: true, cutBackground: true, outline: true })
  assert.deepEqual([edged.w, edged.h], [plain.w + 2, plain.h + 2])
  assert.equal(edged.rows[0]![0], '.')
  assert.notEqual(edged.rows[0]![3], '.')
})

test('a tall picture starts on a grid it fits in', () => {
  const grids: string[] = []
  for (const height of [24, 64, 96, 128]) {
    const code = pictureCode(makePicture(art(), { height, color: true, cutBackground: true, outline: true }), '红方块')
    grids.push(/grid: \[(\d+), (\d+)\]/.exec(code)!.slice(1).join('×'))
  }
  assert.deepEqual(grids, ['192×108', '192×108', '256×144', '320×180'])
})

test('a green screen goes everywhere, shut-in patches too, and its green is taken off the edge', () => {
  const GREEN: [number, number, number, number] = [30, 200, 60, 255]
  // A ring of skin round a patch of green screen, the ring's inner edge tinted green.
  const img = picture(60, 60, GREEN, (x, y) => {
    const d = Math.max(Math.abs(x - 30), Math.abs(y - 30))
    if (d < 6) return undefined
    if (d === 6) return [180, 200, 150, 255]
    return d < 20 ? [220, 160, 130, 255] : undefined
  })
  assert.equal(cutBackground(img), true)
  const at = (x: number, y: number) => Array.from(img.data.subarray((y * 60 + x) * 4, (y * 60 + x) * 4 + 4))
  assert.equal(at(30, 30)[3], 0, 'the shut-in green is gone')
  assert.deepEqual(at(36, 30), [180, 180, 150, 255], 'the tinted edge has no more green than red')
  assert.deepEqual(at(30, 18), [220, 160, 130, 255], 'skin away from the screen is untouched')
  // A white background still keeps a white patch inside.
  const white = art()
  cutBackground(white)
  assert.equal(white.data[(50 * 200 + 50) * 4 + 3], 255)
})
