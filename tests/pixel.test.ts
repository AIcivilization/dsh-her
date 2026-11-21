import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { cleanBackground, cleanLook, cleanPixelInfo, errorLine, onceSeconds, wrapPixelCode } from '../src/core/pixel.ts'
import { makeGrid } from '../src/core/pixel-grid.ts'
import { BUILTIN_PIXELS } from '../src/core/pixel-builtins.ts'
import { pixelSpec } from '../src/core/pixel-spec.ts'
import { Pixels } from '../src/dsh/pixels.ts'
import { planDesign } from '../src/core/design-pack.ts'
import { cleanIntro, introPixel } from '../src/core/intro.ts'

/** Run a wrapped file the way the worker does: its script, then `__anim`. */
function load(code: string): { info?: unknown; setup?: (g: unknown) => void; frame?: (g: unknown, t: number, n: number) => void } {
  const { script, problems } = wrapPixelCode(code)
  assert.deepEqual(problems, [])
  // eslint-disable-next-line no-new-func
  return new Function(`${script}\nreturn __anim`)() as never
}

test('every built-in animation reads, sets up and draws within its budget', () => {
  for (const b of BUILTIN_PIXELS) {
    const anim = load(b.code)
    const { info, problems } = cleanPixelInfo(anim.info)
    assert.deepEqual(problems, [], b.id)
    assert.ok(info !== undefined)
    assert.equal(info.name, b.name)
    const g = makeGrid(info.grid[0], info.grid[1], info.color)
    anim.setup?.(g)
    let drawn = 0
    let slowest = 0
    const last = info.seconds > 0 ? info.seconds : 6
    for (let n = 0; n < last * info.fps; n += 3) {
      const started = performance.now()
      anim.frame!(g, n / info.fps, n)
      slowest = Math.max(slowest, performance.now() - started)
      for (let i = 3; i < g.data.length; i += 4) if (g.data[i]! > 0) drawn++
    }
    assert.ok(drawn > 1000, `${b.id} draws something`)
    assert.ok(slowest < 40, `${b.id} slowest frame ${slowest.toFixed(1)} ms`)
  }
})

test('a file is refused with a reason it can paste back: imports, default exports, a bad info', () => {
  assert.match(wrapPixelCode("import x from 'y'\nexport function frame(){}").problems.join(), /import/)
  assert.match(wrapPixelCode('export default { frame() {} }').problems.join(), /export default/)
  assert.match(wrapPixelCode('x'.repeat(300 * 1024)).problems.join(), /太大/)
  const { problems } = cleanPixelInfo({ name: 'a', grid: [800, 600], fps: 60, seconds: -1, color: 'rainbow' })
  for (const word of ['384', 'fps', 'seconds', 'color']) assert.ok(problems.some(p => p.includes(word)), word)
  assert.match(cleanPixelInfo(undefined).problems.join(), /info/)
})

test('exports in a list and plain declarations both work; an error line is the file’s own', () => {
  const anim = load("const info = { name: 'a', grid: [8, 8], fps: 1, seconds: 1 }\nfunction frame(g) { g.set(0, 0) }\nexport { info, frame }")
  assert.equal(cleanPixelInfo(anim.info).info?.color, 'mono')
  assert.equal(typeof anim.frame, 'function')
  assert.equal(errorLine('Error: x\n    at frame (blob:null/abc:7:3)'), 5)
  assert.equal(errorLine(2), undefined)
})

test('the grid: shapes, erasing, fading, text, colour from a mono grid and the reverse', () => {
  const g = makeGrid(40, 20, 'mono')
  g.rect(0, 0, 4, 4, 0.5)
  assert.equal(Math.round(g.get(1, 1) * 100), 50)
  g.circle(2, 2, 1, 0, 0)
  assert.equal(g.get(2, 2), 0)
  g.fade(0.5)
  assert.ok(g.get(0, 0) < 0.3)
  g.clear()
  assert.equal(g.text(0, 0, 'Hi!'), 18)
  assert.ok(g.get(0, 0) > 0)
  g.set(39, 19, '#ffffff')
  assert.equal(g.get(39, 19), 1)
  g.set(100, 100)
  const c = makeGrid(4, 4, 'color')
  c.set(0, 0, '#ff0000')
  assert.deepEqual([...c.data.slice(0, 4)], [255, 0, 0, 255])
  assert.equal(g.random(), makeGrid(1, 1, 'mono').random())
})

test('settings are cleaned: looks, background, how long once lasts', () => {
  assert.deepEqual(cleanLook({ style: 'x', color: 'red', size: 5, fit: 'cover' }), { style: 'dots', color: 'theme', size: 1, fit: 'cover' })
  const bg = cleanBackground({ on: true, id: '../x', opacity: 2, triggers: { send: true, everyMin: 9999 } })
  assert.equal(bg.id, 'builtin:tail')
  assert.equal(bg.opacity, 0.6)
  assert.deepEqual(bg.triggers, { click: true, send: true, reply: false, open: false, loop: false, everyMin: 240 })
  assert.equal(onceSeconds({ seconds: 20 }), 8)
  assert.equal(onceSeconds({ seconds: 0 }), 6)
})

test('the instructions for a model carry the format and a working example', () => {
  const spec = pixelSpec()
  assert.match(spec, /export const info/)
  assert.match(spec, /g\.noise/)
  const example = /## 一个完整的例子\n\n```js\n([\s\S]+?)```/.exec(spec)?.[1]
  assert.ok(example !== undefined)
  assert.equal(cleanPixelInfo(load(example).info).problems.length, 0)
})


const GOOD = "export const info = { name: '小鱼', grid: [32, 18], fps: 10, seconds: 3 }\nexport function frame(g) { g.set(1, 1) }\n"

test('the store keeps tried files, lists the built-in ones first, moves removed ones aside, and keeps the background', () => {
  const home = mkdtempSync(join(tmpdir(), 'her-pixels-'))
  const pixels = new Pixels(home)
  assert.deepEqual(pixels.list().map(p => p.id), ['builtin:tail', 'builtin:waves', 'builtin:bubbles'])
  assert.throws(() => pixels.add({ name: 'x', code: "import a from 'b'", info: {} }), /import/)
  assert.throws(() => pixels.add({ name: 'x', code: GOOD, info: { name: 'x' } }), /grid/)
  const id = pixels.add({ name: '小鱼', code: GOOD, info: { name: '小鱼', grid: [32, 18], fps: 10, seconds: 3 }, thumb: 'data:image/png;base64,AAAA', frameMs: 1.5 })
  assert.equal(id, '小鱼')
  assert.equal(pixels.add({ name: '小鱼', code: GOOD, info: { name: '小鱼', grid: [32, 18], fps: 10, seconds: 3 }, thumb: 'javascript:alert(1)' }), '小鱼-2')
  const kept = pixels.get('小鱼-2')!
  assert.equal(kept.thumb, undefined)
  assert.equal(pixels.get('小鱼')!.thumb, 'data:image/png;base64,AAAA')
  assert.equal(pixels.code('小鱼'), GOOD)
  assert.equal(pixels.code('../etc'), undefined)
  assert.equal(pixels.addUntried('来自设计包', GOOD), '来自设计包')
  assert.equal(pixels.get('来自设计包')!.info, undefined)
  pixels.remove('小鱼')
  assert.equal(pixels.get('小鱼'), undefined)
  assert.throws(() => pixels.remove('builtin:tail'), /自带/)
  assert.equal(pixels.worn(), undefined)
  assert.throws(() => pixels.setBackground({ id: 'nope' }), /没有/)
  pixels.setBackground({ on: true, id: '小鱼-2', look: { style: 'code' }, triggers: { reply: true } })
  const bg = pixels.worn()!
  assert.equal(bg.id, '小鱼-2')
  assert.equal(bg.look.style, 'code')
  assert.equal(bg.look.fit, 'contain')
  assert.deepEqual([bg.triggers.click, bg.triggers.reply], [true, true])
})

test('the opening clip can be a 像素动画, drawn as its look says', () => {
  const intro = cleanIntro({ on: true, source: 'pixel:builtin:waves', look: { style: 'blocks', size: 0.1 } })
  assert.equal(introPixel(intro), 'builtin:waves')
  assert.deepEqual(intro.look, { style: 'blocks', color: 'theme', size: 0.2, fit: 'contain' })
  assert.equal(introPixel(cleanIntro({ source: '出场' })), undefined)
})

test('a 设计包 brings 像素动画 in pixels/, as its opening clip or chat background; one that cannot run is left out', () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  const manifest = { format: 'dsh-her-design@1', id: 'pix', name: '像素包', version: '1.0.0', author: 'a', license: 'CC0', intro: { pixel: 'fish.js', when: 'every' }, background: { pixel: 'sea.js', style: 'dots', opacity: 2 } }
  const { plan, problems } = planDesign([
    { name: 'design.json', data: enc(JSON.stringify(manifest)) },
    { name: 'pixels/fish.js', data: enc(GOOD) },
    { name: 'pixels/bad.js', data: enc("import x from 'y'") },
  ])
  assert.ok(plan !== undefined)
  assert.deepEqual(plan.pixelFiles.map(f => f.file), ['fish.js'])
  assert.ok(plan.skipped.some(s => s.startsWith('pixels/bad.js')))
  assert.deepEqual(plan.manifest.intro, { pixel: 'fish.js', when: 'every' })
  assert.equal(plan.manifest.background?.opacity, 0.6)
  assert.ok(problems.some(p => p.includes('sea.js')))
})

test('g.sprite: a picture in characters, scaled, mirrored, centred, with a palette', () => {
  const g = makeGrid(16, 8, 'mono')
  const ART = ['9.', '45', '#a']
  assert.equal(g.sprite(1, 1, ART), 2)
  assert.equal(g.get(1, 1), 1)
  assert.equal(g.get(2, 1), 0, "'.' is left alone")
  assert.ok(Math.abs(g.get(1, 2) - 4 / 9) < 0.01)
  assert.equal(g.get(1, 3), 1, "'#' is the brightest")
  g.clear()
  assert.equal(g.sprite(0, 0, ART, { scale: 2, flip: true }), 4)
  assert.equal(g.get(2, 0), 1, 'mirrored: the 9 is on the right')
  assert.equal(g.get(3, 1), 1, 'two cells each way')
  assert.equal(g.get(0, 0), 0)
  g.clear()
  g.sprite(8, 4, ['99', '99'], { center: true, flipY: true })
  assert.deepEqual([g.get(7, 3), g.get(8, 4), g.get(6, 4)], [1, 1, 0])
  // A palette: in mono a colour counts by how light it is; '0' covers what is under it.
  g.clear()
  g.rect(0, 0, 16, 8, 1)
  g.sprite(0, 0, 'ab0', { palette: { a: '#000000', b: 0.5 } })
  assert.deepEqual([g.get(0, 0), Math.round(g.get(1, 0) * 100) / 100, g.get(2, 0), g.get(3, 0)], [0, 0.5, 0, 1])
  const c = makeGrid(4, 1, 'color')
  c.sprite(0, 0, 'a', { palette: { a: '#ff8800' } })
  assert.deepEqual([...c.data.slice(0, 4)], [255, 136, 0, 255])
  // Off the grid, or nonsense, draws nothing and does not throw.
  g.clear()
  g.sprite(-50, -50, ['999'], { scale: 1000 })
  g.sprite(0, 0, undefined as never)
})

test('the example in the instructions runs as it says', () => {
  const spec = pixelSpec()
  const art = /const FISH = \[[^\]]+\]/.exec(spec)![0]
  const anim = load(`export const info = { name: '鱼', grid: [192, 108], fps: 24, seconds: 0 }\n${art}\nexport function frame(g, t) {\n  g.clear()\n${/const p = [^\n]+\ng\.sprite[^\n]+/.exec(spec)![0]}\n}`)
  const g = makeGrid(192, 108, 'mono')
  anim.frame!(g, 1, 24)
  let right = 0
  for (let x = 0; x < 192; x++) if (g.get(x, 54) > 0) right = x
  assert.ok(right > 40 && right < 70, `the fish is a quarter of the way along (${right})`)
})

test('a file with g.sprite brings it along to a player without it, and draws the same', async () => {
  const { forOlderPlayers } = await import('../src/core/pixel-compat.ts')
  const plain = BUILTIN_PIXELS[0]!.code
  assert.equal(forOlderPlayers(plain), plain, 'no sprite, no change')
  const code = `export const info = { name: '鱼', grid: [64, 36], fps: 12, seconds: 0 }
const FISH = ['..99.', '9999a', '..99.']
export function frame(g, t) {
  g.clear()
  g.sprite(10 + t * 4, 18, FISH, { scale: 2.5, center: true, flip: t > 1, palette: { a: '#000000' } })
}`
  const draw = (file: string, old: boolean) => {
    const anim = load(file)
    const g = makeGrid(64, 36, 'mono')
    if (old) delete (g as { sprite?: unknown }).sprite
    anim.setup?.(g)
    anim.frame!(g, 2, 24)
    return [...g.data]
  }
  const wrapped = forOlderPlayers(code)
  assert.notEqual(wrapped, code)
  assert.deepEqual(cleanPixelInfo(load(wrapped).info).info?.name, '鱼')
  assert.deepEqual(draw(wrapped, true), draw(code, false), 'the shim draws as the grid does')
  assert.deepEqual(draw(wrapped, false), draw(code, false), 'a player with g.sprite uses its own')
})
