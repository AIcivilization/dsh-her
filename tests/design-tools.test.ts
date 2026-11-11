import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { designTools, herLookTools, undoSvg, type DesignDeps } from '../src/dsh/design-tools.ts'
import { Library } from '../src/dsh/library.ts'
import { Skins } from '../src/dsh/skins.ts'
import { StageStore } from '../src/dsh/stage-store.ts'
import { emptyStage } from '../src/pack/stage.ts'

function deps() {
  const home = mkdtempSync(join(tmpdir(), 'her-design-'))
  const applied: number[] = []
  const d: DesignDeps = { home, library: new Library(home), skins: new Skins(home), stages: new StageStore(home), applied: () => applied.push(1), log: () => {} }
  const tools = Object.fromEntries(designTools(d).map(t => [t.name, t]))
  return { home, d, tools, applied }
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="衣服"><rect width="10" height="10" fill="#e33"/></g></svg>'

test('an SVG is written safe, the one before is kept, and can be put back', async () => {
  const { d, tools, applied } = deps()
  assert.match((await tools.svg_set!.execute({ row: 'avatar', name: '鲸鱼娘', svg: SVG })).text, /写好/)
  const green = SVG.replace('#e33', '#1f5f3a').replace('<g', '<g onclick="x()"')
  assert.match((await tools.svg_set!.execute({ row: 'avatar', name: '鲸鱼娘', svg: green })).text, /能运行的东西去掉了/)
  const path = d.library.path('avatar', '鲸鱼娘')!
  assert.match(readFileSync(path, 'utf8'), /#1f5f3a/)
  assert.ok(!readFileSync(path, 'utf8').includes('onclick'))
  assert.match((await tools.svg_get!.execute({ row: 'avatar', name: '鲸鱼娘' })).text, /#1f5f3a/)
  assert.equal(undoSvg(d.home, d.library, 'avatar', '鲸鱼娘'), true)
  assert.match(readFileSync(path, 'utf8'), /#e33/)
  assert.equal(undoSvg(d.home, d.library, 'avatar', '鲸鱼娘'), false)
  assert.match((await tools.svg_set!.execute({ row: 'avatar', name: 'x', svg: '<html>' })).text, /不是一张 SVG/)
  assert.ok(applied.length >= 2)
})

test('编排 through the tools: read, save as a new version, refuse what is not one', async () => {
  const { d, tools } = deps()
  d.stages.save(emptyStage('旧的'))
  assert.match((await tools.stage_get!.execute({})).text, /"name": "旧的"/)
  const next = { ...emptyStage('新的'), scenes: [{ id: 'base', name: '初始', cells: { avatar: { use: ['发呆'] } } }] }
  assert.match((await tools.stage_set!.execute({ stage: next })).text, /已保存/)
  assert.equal(d.stages.load().stage?.name, '新的')
  assert.equal(d.stages.versions().length, 1)
  assert.match((await tools.stage_set!.execute({ stage: { format: 'x' } })).text, /没做成/)
})

test('a skin is written as a folder of your own; the built-in ones stay', async () => {
  const { d, tools } = deps()
  assert.match((await tools.skin_set!.execute({ id: 'whale-blue', skin: { name: 'x' } })).text, /没做成/)
  assert.match((await tools.skin_set!.execute({ id: '墨绿', skin: { name: '墨绿', colors: { '--dsw-alias-bg-base': { light: '#eef5ef', dark: '#0d1a12' } } } })).text, /写好了皮肤「墨绿」/)
  assert.equal(d.skins.get('墨绿')?.skin.name, '墨绿')
  assert.match((await tools.skin_get!.execute({})).text, /墨绿/)
})

test('her own few: put on a skin, change an SVG of herself', async () => {
  const { d } = deps()
  const worn: Array<string | undefined> = []
  const tools = Object.fromEntries(herLookTools({ ...d, wear: id => worn.push(id) }).map(t => [t.name, t]))
  assert.deepEqual(Object.keys(tools).sort(), ['skin_get', 'svg_get', 'svg_set', 'wear_skin'])
  assert.match((await tools.wear_skin!.execute({ id: 'deep-sea' })).text, /深海夜/)
  assert.deepEqual(worn, ['deep-sea'])
})
