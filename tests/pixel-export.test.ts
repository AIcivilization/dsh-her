import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanPixelInfo, wrapPixelCode, type PixelInfo } from '../src/core/pixel.ts'
import { makeGrid } from '../src/core/pixel-grid.ts'
import { makeFrames, makePicture, type Rgba } from '../src/core/pixel-picture.ts'
import { MOTIONS, pictureCode, pictureTiming } from '../src/core/pixel-motion.ts'
import { encodeGif, lzw, readGifSource } from '../src/core/pixel-gif.ts'
import { compose, drawnBox, exportPlan, joinFrames, makeGif, quantize } from '../src/core/pixel-export.ts'
import { SITE_URL, withBrand } from '../src/core/pixel-brand.ts'

/** GIF's LZW, read back (what a viewer does). */
function unlzw(data: Uint8Array, minSize: number, length: number): Uint8Array {
  const clear = 1 << minSize, eoi = clear + 1
  let size = minSize + 1
  let dict: number[][] = []
  const reset = () => {
    dict = Array.from({ length: clear + 2 }, (_, i) => (i < clear ? [i] : []))
    size = minSize + 1
  }
  reset()
  const out: number[] = []
  let bit = 0
  const read = () => {
    let code = 0
    for (let i = 0; i < size; i++) {
      const b = data[(bit + i) >> 3]! >> ((bit + i) & 7) & 1
      code |= b << i
    }
    bit += size
    return code
  }
  let prev: number[] | undefined
  while (bit + size <= data.length * 8) {
    const code = read()
    if (code === clear) {
      reset()
      prev = undefined
      continue
    }
    if (code === eoi) break
    let entry: number[]
    if (code < dict.length) entry = dict[code]!
    else entry = [...prev!, prev![0]!]
    out.push(...entry)
    if (prev !== undefined) dict.push([...prev, entry[0]!])
    prev = entry
    if (dict.length === 1 << size && size < 12) size++
  }
  return Uint8Array.from(out.slice(0, length))
}

/** A GIF's frames as index arrays, and what it says about itself. */
function readGif(bytes: Uint8Array): { width: number; height: number; frames: Uint8Array[]; delays: number[]; transparent?: number } {
  const width = bytes[6]! | bytes[7]! << 8, height = bytes[8]! | bytes[9]! << 8
  let k = 13 + (bytes[10]! & 0x80 ? 3 << ((bytes[10]! & 7) + 1) : 0)
  const frames: Uint8Array[] = []
  const delays: number[] = []
  let transparent: number | undefined
  const blocks = () => {
    const parts: number[] = []
    while (bytes[k] !== 0) {
      const n = bytes[k]!
      parts.push(...bytes.subarray(k + 1, k + 1 + n))
      k += 1 + n
    }
    k++
    return Uint8Array.from(parts)
  }
  while (bytes[k] !== 0x3b) {
    if (bytes[k] === 0x21) {
      if (bytes[k + 1] === 0xf9) {
        delays.push(bytes[k + 4]! | bytes[k + 5]! << 8)
        if (bytes[k + 3]! & 1) transparent = bytes[k + 6]
      }
      k += 2
      blocks()
    } else if (bytes[k] === 0x2c) {
      k += 10
      const min = bytes[k++]!
      frames.push(unlzw(blocks(), min, width * height))
    } else throw new Error(`bad block ${bytes[k]}`)
  }
  return { width, height, frames, delays, ...(transparent === undefined ? {} : { transparent }) }
}

/** Run a file (as the sandbox does, without one) at times `ts`: its info and one grid a time. */
function render(code: string, ts: number[]): { info: PixelInfo; frames: Uint8ClampedArray[] } {
  const { script, problems } = wrapPixelCode(code)
  assert.deepEqual(problems, [])
  // eslint-disable-next-line no-new-func
  const anim = new Function(`${script}\nreturn __anim`)() as { info: unknown; frame: (g: unknown, t: number, n: number) => void }
  const read = cleanPixelInfo(anim.info)
  assert.deepEqual(read.problems, [])
  const info = read.info!
  const g = makeGrid(info.grid[0], info.grid[1], info.color)
  return { info, frames: ts.map(t => { anim.frame(g, t, Math.floor(t * info.fps)); return g.data.slice() }) }
}

function shot(x: number, y: number): Rgba {
  const data = new Uint8ClampedArray(40 * 40 * 4).fill(255)
  for (let yy = y; yy < y + 12; yy++) for (let xx = x; xx < x + 8; xx++) data.set([220, 30, 30, 255], (yy * 40 + xx) * 4)
  for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < x + 8; xx++) data.set([30, 30, 200, 255], (yy * 40 + xx) * 4)
  return { data, w: 40, h: 40 }
}

test('LZW: what is written reads back the same, across a table clear', () => {
  const plain = Uint8Array.from({ length: 30_000 }, (_, i) => (i * 7 + (i >> 5)) % 13)
  assert.deepEqual(unlzw(lzw(plain, 4), 4, plain.length), plain)
  const flat = new Uint8Array(5000).fill(1)
  assert.deepEqual(unlzw(lzw(flat, 2), 2, flat.length), flat)
})

test('a GIF: frames, delays, see-through, and the file inside it read back', () => {
  const frames = [Uint8Array.from([0, 1, 2, 1]), Uint8Array.from([2, 2, 0, 1])]
  const bytes = encodeGif({ width: 2, height: 2, palette: [0, 0, 0, 255, 0, 0, 0, 255, 0], transparent: 0, frames: frames.map(indices => ({ indices, delay: 8 })), comment: 'hi', source: { name: '鲸', code: 'export const info = {}', look: { style: 'dots' } } })
  assert.equal(String.fromCharCode(...bytes.subarray(0, 6)), 'GIF89a')
  const back = readGif(bytes)
  assert.deepEqual(back.frames, frames)
  assert.deepEqual(back.delays, [8, 8])
  assert.equal(back.transparent, 0)
  assert.deepEqual(readGifSource(bytes), { name: '鲸', code: 'export const info = {}', look: { style: 'dots' } })
  // A GIF without our block carries nothing; nor does something that is not a GIF.
  assert.equal(readGifSource(encodeGif({ width: 1, height: 1, palette: [0, 0, 0], frames: [{ indices: Uint8Array.from([0]), delay: 10 }] })), undefined)
  assert.equal(readGifSource(new TextEncoder().encode('not a gif at all')), undefined)
})

test('every motion comes back to the same picture after info.loop', () => {
  const still = makePicture(shot(5, 5), { height: 24, color: true, cutBackground: true, outline: true })
  const moving = makeFrames([shot(5, 5), shot(20, 10), shot(10, 20)], { height: 24, color: false, cutBackground: true }, 0.214)
  for (const pic of [still, moving]) {
    for (const m of MOTIONS) {
      const code = pictureCode(pic, '红块', m.id)
      const { loop } = pictureTiming(pic, m.id)
      const { info } = render(code, [0])
      assert.equal(info.loop, loop, m.name)
      for (const t of [0.05, 0.71, 1.93]) {
        const [a, b] = render(code, [t, t + loop]).frames
        assert.deepEqual(a, b, `${m.name}: ${t} and ${t} + ${loop}`)
      }
    }
  }
  // A beat fitted to the frames (3 × 0.214 s = 0.642 s a round): swaying (2 s) takes three rounds, walking (12 s) nineteen.
  assert.deepEqual(pictureTiming(moving, 'sway'), { beat: '0.642 * 3', loop: 1.926 })
  assert.equal(pictureTiming(moving, 'walk').loop, 12.198)
  // Shorter than a round: a whole number of beats in one round.
  const slow = makeFrames([shot(5, 5), shot(20, 10), shot(10, 20)], { height: 24, color: false, cutBackground: true }, 1.5)
  assert.deepEqual(pictureTiming(slow, 'hop'), { beat: '4.5 / 4', loop: 4.5 })
})

test('the plan: its own loop, one run, or a length joined softly', () => {
  const loop = exportPlan({ fps: 24, seconds: 0, loop: 2 })
  assert.equal(loop.join, 'loop')
  assert.equal(loop.fps, 12)
  assert.equal(loop.count, 24)
  assert.equal(loop.times.length, 24)
  assert.equal(exportPlan({ fps: 30, seconds: 5 }).join, 'once')
  assert.equal(exportPlan({ fps: 30, seconds: 5 }).fps, 15)
  const soft = exportPlan({ fps: 10, seconds: 0 }, 4)
  assert.equal(soft.join, 'soft')
  assert.equal(soft.count, 40)
  assert.ok(soft.times.length > 40)
  assert.equal(exportPlan({ fps: 10, seconds: 0 }, 4, false).join, 'cut')
  // A loop that is not a whole number of frames: the frames are spaced to fill it, so one past the last is a loop on.
  const odd = exportPlan({ fps: 24, seconds: 0, loop: 1.2 })
  assert.equal(odd.count, 14)
  assert.equal(odd.seconds, 1.2)
  assert.ok(Math.abs(odd.times[13]! + 1.2 / 14 - 1.2) < 1e-9)
  assert.ok(Math.abs(odd.fps - 14 / 1.2) < 1e-9)
  // Joined softly, the first frame is the one a turn later: the end runs on into it.
  const frames = soft.times.map(t => Uint8ClampedArray.from([t * 10, 0, 0, 255]))
  const joined = joinFrames(frames, soft)
  assert.equal(joined.length, 40)
  assert.deepEqual(joined[0], frames[40])
})

test('cut to what is drawn, enlarged by whole numbers, see-through when asked', () => {
  const pic = makePicture(shot(5, 5), { height: 24, color: true, cutBackground: true })
  const code = pictureCode(pic, '块', 'still')
  const { info, frames } = render(code, [0])
  const box = drawnBox(frames, info.grid[0], info.grid[1], false)
  // Much smaller than the grid: the picture, scaled, with a cell round it.
  assert.ok(box.w < info.grid[0] / 2 && box.h < info.grid[1], JSON.stringify(box))
  assert.equal((box.h - 2) % pic.h, 0)
  const out = compose(frames, info, { style: 'blocks', ink: [255, 255, 255], background: 'clear', mark: false }, box, 3)
  assert.equal(out.width, box.w * 3)
  const f = out.frames[0]!
  // Every pixel is either fully see-through or fully there; a cell is 3 × 3 of one colour.
  for (let i = 3; i < f.length; i += 4) assert.ok(f[i] === 0 || f[i] === 255)
  const at = (x: number, y: number) => Array.from(f.subarray((y * out.width + x) * 4, (y * out.width + x) * 4 + 4)).join()
  for (let cy = 0; cy < box.h; cy++) for (let cx = 0; cx < box.w; cx++) {
    assert.equal(at(cx * 3 + 2, cy * 3 + 2), at(cx * 3, cy * 3))
  }
  // On a background nothing is see-through.
  const on = compose(frames, info, { style: 'blocks', ink: [255, 255, 255], background: '#102030', mark: true }, box, 3)
  for (let i = 3; i < on.frames[0]!.length; i += 4) assert.equal(on.frames[0]![i], 255)
})

test('more than 255 colours are brought down to one palette', () => {
  const f = new Uint8ClampedArray(64 * 64 * 4)
  for (let i = 0; i < 64 * 64; i++) f.set([i % 64 * 4, (i >> 6) * 4, (i * 37) % 256, 255], i * 4)
  const q = quantize([f])
  assert.ok(q.palette.length / 3 <= 256)
  assert.equal(q.transparent, undefined)
  assert.equal(q.indices[0]!.length, 64 * 64)
})

test('a picture made into a WeChat sticker: square, small enough, its file inside with our line', () => {
  const moving = makeFrames([shot(5, 5), shot(20, 10), shot(10, 20)], { height: 48, color: true, cutBackground: true, outline: true }, 0.25)
  const code = pictureCode(moving, '红块', 'hop')
  const first = render(code, [0]).info
  const plan = exportPlan(first)
  assert.equal(plan.join, 'loop')
  const { info, frames } = render(code, plan.times)
  const gif = makeGif({ info, frames: joinFrames(frames, plan), fps: plan.fps, preset: 'wechat', look: { style: 'blocks', ink: [255, 255, 255], background: 'clear', mark: false }, source: { name: '红块', code } })
  assert.ok(gif.fits, `${gif.bytes.length} bytes`)
  assert.equal(gif.width, gif.height)
  assert.ok(gif.width >= 240)
  assert.ok(gif.carries)
  const back = readGif(gif.bytes)
  assert.equal(back.frames.length, gif.frames)
  assert.equal(back.transparent, 0)
  const source = readGifSource(gif.bytes)!
  assert.ok(source.code.includes(SITE_URL))
  assert.equal(withBrand(source.code), source.code)
})
