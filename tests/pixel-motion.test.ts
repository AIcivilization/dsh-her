import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanPixelInfo, wrapPixelCode } from '../src/core/pixel.ts'
import { makeGrid } from '../src/core/pixel-grid.ts'
import { makeFrames, makePicture, pictureBytes, type Rgba } from '../src/core/pixel-picture.ts'
import { MOTIONS, pictureCode, readPictureFile } from '../src/core/pixel-motion.ts'

/** A 40 × 40 picture on white: a red block whose top left corner is at (x, y). */
function shot(x: number, y: number): Rgba {
  const data = new Uint8ClampedArray(40 * 40 * 4).fill(255)
  for (let yy = y; yy < y + 12; yy++) for (let xx = x; xx < x + 8; xx++) data.set([220, 30, 30, 255], (yy * 40 + xx) * 4)
  return { data, w: 40, h: 40 }
}

function run(code: string, t: number): { drawn: number; info: ReturnType<typeof cleanPixelInfo>['info'] } {
  const { script, problems } = wrapPixelCode(code)
  assert.deepEqual(problems, [])
  // eslint-disable-next-line no-new-func
  const anim = new Function(`${script}\nreturn __anim`)() as { info: unknown; frame: (g: unknown, t: number, n: number) => void }
  const info = cleanPixelInfo(anim.info).info!
  const g = makeGrid(info.grid[0], info.grid[1], info.color)
  anim.frame(g, t, 0)
  let drawn = 0
  for (let i = 3; i < g.data.length; i += 4) if (g.data[i]! > 0) drawn++
  return { drawn, info }
}

test('frames of a moving thing are cut to one box, one size, one palette', () => {
  const pic = makeFrames([shot(5, 5), shot(20, 10)], { height: 30, color: true, cutBackground: true }, 0.15)
  assert.equal(pic.frames.length, 2)
  assert.equal(pic.each, 0.15)
  // One box round both: 23 wide, 17 high, shrunk to 30 high.
  assert.equal(pic.h, 30)
  assert.equal(pic.w, Math.round(23 / 17 * 30))
  assert.ok(pic.frames.every(f => f.length === pic.h && f.every(r => r.length === pic.w)))
  // The block is in the top left of the first, the bottom right of the second.
  assert.notEqual(pic.frames[0]![0]![0], '.')
  assert.equal(pic.frames[1]![0]![0], '.')
  assert.notEqual(pic.frames[1]![pic.h - 1]![pic.w - 1], '.')
  assert.equal(pic.frames[0]![0]![0], pic.frames[1]![pic.h - 1]![pic.w - 1], 'the same red is the same letter')
  assert.ok(pictureBytes(pic) > 2 * 30 * pic.w)
  // One picture is one frame, with no timing.
  const one = makePicture(shot(5, 5), { height: 20, color: false, cutBackground: true })
  assert.equal(one.frames.length, 1)
  assert.equal(one.each, undefined)
})

test('every motion makes a file that runs and draws, still and in frames', () => {
  const still = makePicture(shot(5, 5), { height: 24, color: true, cutBackground: true, outline: true })
  const moving = makeFrames([shot(5, 5), shot(20, 10), shot(10, 20)], { height: 24, color: false, cutBackground: true }, 0.1)
  for (const pic of [still, moving]) {
    for (const m of MOTIONS) {
      const code = pictureCode(pic, '红块', m.id)
      for (const t of [0, 0.7, 1.9, 4.3]) assert.ok(run(code, t).drawn > 0, `${m.name} at ${t}`)
      const back = readPictureFile(code)!
      assert.equal(back.motion, m.id)
      assert.equal(back.name, '红块')
      assert.deepEqual(back.picture.frames, pic.frames)
      assert.deepEqual(back.picture.palette, pic.palette)
      assert.equal(back.picture.each, pic.each)
      // Made again the same way, it is the same file.
      assert.equal(pictureCode(back.picture, back.name, m.id), code)
    }
  }
})

test('frames take turns; walking goes across and turns round', () => {
  const moving = makeFrames([shot(5, 5), shot(20, 20)], { height: 24, color: false, cutBackground: true }, 0.5)
  const code = pictureCode(moving, '换帧', 'still')
  const at = (t: number) => {
    const { script } = wrapPixelCode(code)
    // eslint-disable-next-line no-new-func
    const anim = new Function(`${script}\nreturn __anim`)() as { info: { grid: [number, number] }; frame: (g: ReturnType<typeof makeGrid>, t: number, n: number) => void }
    const g = makeGrid(anim.info.grid[0], anim.info.grid[1], 'mono')
    anim.frame(g, t, 0)
    return Array.from(g.data).join(',')
  }
  assert.notEqual(at(0.1), at(0.6))
  assert.equal(at(0.1), at(1.1))
  const walk = pictureCode(makePicture(shot(5, 5), { height: 10, color: false, cutBackground: true }), '走', 'walk')
  const where = (t: number) => {
    const { script } = wrapPixelCode(walk)
    // eslint-disable-next-line no-new-func
    const anim = new Function(`${script}\nreturn __anim`)() as { info: { grid: [number, number] }; frame: (g: ReturnType<typeof makeGrid>, t: number, n: number) => void }
    const g = makeGrid(anim.info.grid[0], anim.info.grid[1], 'mono')
    anim.frame(g, t, 0)
    for (let x = 0; x < g.w; x++) for (let y = 0; y < g.h; y++) if (g.data[(y * g.w + x) * 4 + 3]! > 0) return x
    return -1
  }
  assert.ok(where(0) < where(3), 'left to right')
  assert.ok(where(9) < where(6.5), 'and back')
})

test('a file not made here, or changed past reading, has no picture to move', () => {
  assert.equal(readPictureFile('export const info = {}\nexport function frame(g) { g.clear() }'), undefined)
  const code = pictureCode(makePicture(shot(5, 5), { height: 10, color: true, cutBackground: true }), 'x', 'float')
  assert.equal(readPictureFile(code.replace(/^const PICTURE = \[$/m, 'const PICTURE = makeIt([')), undefined)
  // A file from before the motion line still reads, with no motion.
  const old = code.replace(/^\/\/ 动作：.*\n/m, '')
  assert.equal(readPictureFile(old)?.motion, undefined)
  assert.ok(readPictureFile(old)?.picture.rows.length === 10)
})
