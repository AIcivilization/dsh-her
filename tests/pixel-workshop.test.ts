import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { cleanPixelInfo, wrapPixelCode } from '../src/core/pixel.ts'
import { BUILTIN_PIXELS } from '../src/core/pixel-builtins.ts'
import { makeGrid } from '../src/core/pixel-grid.ts'
import { describeChange, infoOverride, withInfo } from '../src/core/pixel-workshop.ts'
import { MAX_VERSIONS, PixelDrafts } from '../src/engine/pixel-drafts.ts'
import { Pixels } from '../src/engine/pixels.ts'

const infoOf = (code: string) => {
  const { script } = wrapPixelCode(code)
  // eslint-disable-next-line no-new-func
  return cleanPixelInfo((new Function(`${script}\nreturn __anim`)() as { info: unknown }).info).info
}

test('a setting changed in the workshop is one line that overrides info, replaced when changed again', () => {
  const code = BUILTIN_PIXELS.find(b => b.id === 'builtin:waves')!.code
  let next = withInfo(code, { grid: [256, 144] })
  next = withInfo(next, { seconds: 0, fps: 15 })
  assert.equal(next.match(/工坊里的设置/g)?.length, 1)
  assert.deepEqual(infoOverride(next), { grid: [256, 144], seconds: 0, fps: 15 })
  const info = infoOf(next)!
  assert.deepEqual(info.grid, [256, 144])
  assert.equal(info.fps, 15)
  assert.equal(info.seconds, 0)
  assert.equal(info.name, '浪花')
  assert.equal(describeChange({ grid: [160, 90], seconds: 0 }), '格子 160 × 90，一直循环')
})

test('drafts keep their versions; past 30 the oldest go but the first stays; saved again it is the same 像素动画', () => {
  const home = mkdtempSync(join(tmpdir(), 'her-drafts-'))
  const drafts = new PixelDrafts(home)
  const pixels = new Pixels(home)
  const empty = drafts.create()
  assert.equal(empty.code, '')
  assert.deepEqual(drafts.list(), [], 'an empty draft is not listed')
  const code = BUILTIN_PIXELS.find(b => b.id === 'builtin:waves')!.code
  let d = drafts.add(empty.id, code, '🎲 一')
  for (let i = 2; i <= MAX_VERSIONS + 5; i++) d = drafts.add(d.id, code.replace('浪花', `浪花${i}`), `第 ${i} 次`)
  assert.equal(d.versions.length, MAX_VERSIONS)
  assert.equal(d.versions[0]!.n, 1)
  assert.equal(d.current, MAX_VERSIONS + 5)
  assert.ok(!existsSync(join(home, 'pixel-drafts', d.id, 'v2.js')))
  d = drafts.pick(d.id, 1)
  assert.equal(d.code, code)
  // Each version keeps its look: a roll's own, or the one it was changed to while shown.
  d = drafts.add(d.id, code, '🎲 红', { style: 'code', color: '#ff0000', size: 1, fit: 'contain' })
  const red = d.current
  d = drafts.add(d.id, code, '🎲 蓝', { style: 'dots', color: '#0000ff', size: 1, fit: 'contain' })
  d = drafts.set(d.id, { look: { size: 0.5 } })
  assert.equal(drafts.pick(d.id, red).look.color, '#ff0000')
  assert.equal(drafts.pick(d.id, d.current).look.size, 0.5)
  d = drafts.pick(d.id, 1)
  assert.throws(() => drafts.pick(d.id, 2), /没有这一版/)
  assert.throws(() => drafts.add(d.id, "import x from 'y'", ''), /import/)
  assert.equal(d.autoName, true)
  assert.equal(drafts.set(d.id, { name: '红色涟漪', auto: true }).autoName, true)
  d = drafts.set(d.id, { name: '我的浪', look: { style: 'blocks', color: '#ff0000' } })
  assert.equal(d.autoName, false)
  assert.equal(d.look.style, 'blocks')
  assert.equal(d.look.color, '#ff0000')
  assert.equal(drafts.list()[0]!.name, '我的浪')

  const info = infoOf(d.code)
  const id = pixels.add({ name: d.name, label: d.name, code: d.code, info })
  assert.equal(pixels.get(id)!.name, '我的浪')
  assert.equal(pixels.update(id, { name: d.name, label: '改了名', code: d.code, info }), id)
  assert.equal(pixels.get(id)!.name, '改了名')
  assert.throws(() => pixels.update('builtin:waves', { name: 'x', code: d.code, info }), /没有/)
  // An upload is still named by its own info.
  assert.equal(pixels.get(pixels.add({ name: 'file-name', code, info: infoOf(code) }))!.name, '浪花')

  drafts.remove(d.id)
  assert.deepEqual(drafts.list(), [])
  assert.throws(() => drafts.get('../x'), /没有这个草稿/)
})

test('no size is refused: a file of 600 KB is kept as a version and runs', () => {
  const home = mkdtempSync(join(tmpdir(), 'her-big-'))
  const drafts = new PixelDrafts(home)
  const rows = Array.from({ length: 128 }, () => `'${'a'.repeat(190)}',`).join('\n')
  const frames = Array.from({ length: 26 }, () => `[\n${rows}\n],`).join('\n')
  const code = `export const info = { name: '大', grid: [384, 216], fps: 24, seconds: 0, color: 'color' }\nconst FRAMES = [\n${frames}\n]\nexport function frame(g, t) { g.clear(); g.sprite(g.w / 2, g.h / 2, FRAMES[Math.floor(t * 4) % FRAMES.length], { center: true, palette: { a: '#ff0000' } }) }\n`
  assert.ok(code.length > 600 * 1024, `${code.length}`)
  const { script, problems } = wrapPixelCode(code)
  assert.deepEqual(problems, [])
  // eslint-disable-next-line no-new-func
  const anim = new Function(`${script}\nreturn __anim`)() as { info: unknown; frame: (g: unknown, t: number) => void }
  const info = cleanPixelInfo(anim.info).info!
  const g = makeGrid(info.grid[0], info.grid[1], info.color)
  anim.frame(g, 0.3)
  assert.ok(g.data.some((v, i) => i % 4 === 3 && v > 0), 'it draws')
  const d = drafts.add(drafts.create().id, code, '大')
  assert.equal(d.code, code)
})
