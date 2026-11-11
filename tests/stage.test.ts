import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cellFor, emptyStage, layerOf, missingMaterials, parseStage, Picker, resolveStage, scenesOn, STAGE_FORMAT, renameMaterial, stageFromLook, stageFromPack, type Stage } from '../src/pack/stage.ts'
import { LOOK_FORMAT, pickScene, type Look } from '../src/pack/look.ts'

/** The example of docs/设置页与编排设计.md §3.10. */
const example: Stage = {
  format: STAGE_FORMAT,
  name: '鲸鱼娘·默认',
  rows: ['skin', 'avatar', 'desktop', 'pet'],
  scenes: [
    { id: 'base', name: '初始', cells: { skin: { use: ['鲸鱼蓝'] }, avatar: { use: ['发呆', '托腮', '画圈圈'], pick: 'rotate' }, desktop: { use: ['海面'] }, pet: { use: ['游', '吐泡泡'], pick: 'random' } } },
    { id: 'talk', name: '说话时', when: [{ on: 'her-speaking' }], hold: 'while', cells: { avatar: { use: ['说话'] }, pet: { use: ['挥手'] } } },
    { id: 'night', name: '夜里', when: [{ on: 'hours', hours: '23-7' }], hold: 'while', cells: { skin: { use: ['深海夜'] }, avatar: { use: ['睡觉'] }, desktop: { use: ['星空'] }, pet: { use: ['睡'] } } },
    { id: 'mahjong', name: '打麻将', about: '陪你打麻将', when: [{ on: 'she-chooses' }, { on: 'you-ask' }], hold: { minutes: 15 }, cells: { avatar: { use: ['麻将1', '麻将2'], pick: 'random' }, desktop: { use: ['麻将桌'] } } },
  ],
}

const shown = (now: Parameters<typeof resolveStage>[1]) => Object.fromEntries(Object.entries(resolveStage(example, now)).map(([row, got]) => [row, got?.scene.id]))

test('nothing on: every row shows 初始', () => {
  assert.deepEqual(shown({ hour: 12 }), { skin: 'base', avatar: 'base', desktop: 'base', pet: 'base' })
})

test('an empty cell falls through to the scene below, row by row', () => {
  // At night while she speaks: avatar and pet from 说话时, skin and desktop from 夜里.
  assert.deepEqual(shown({ hour: 23, herSpeaking: true }), { skin: 'night', avatar: 'talk', desktop: 'night', pet: 'talk' })
})

test('a chosen scene beats a lasting one, something happening beats both', () => {
  assert.deepEqual(shown({ hour: 1, chosen: ['mahjong'] }), { skin: 'night', avatar: 'mahjong', desktop: 'mahjong', pet: 'night' })
  assert.equal(shown({ hour: 1, chosen: ['mahjong'], herSpeaking: true }).avatar, 'talk')
})

test('layers, and within a layer the column further right first', () => {
  assert.deepEqual(example.scenes.map((s, i) => layerOf(s, i)), [0, 3, 1, 2])
  const two: Stage = { ...example, scenes: [example.scenes[0]!, { id: 'a', name: 'A', when: [{ on: 'active' }], cells: { pet: { use: ['a'] } } }, { id: 'b', name: 'B', when: [{ on: 'hours', hours: '0-24' }], cells: { pet: { use: ['b'] } } }] }
  assert.deepEqual(scenesOn(two, { hour: 9, user: 'active' }).map(s => s.id), ['b', 'a', 'base'])
  assert.equal(cellFor(two, 'pet', scenesOn(two, { hour: 9, user: 'active' }))?.cell.use[0], 'b')
})

test('a scene switched off never comes up; a touch can name the part', () => {
  const touch: Stage = { ...example, scenes: [example.scenes[0]!, { id: 'pat', name: '摸头', when: [{ on: 'touched', part: 'head' }], cells: { pet: { use: ['害羞'] } } }, { id: 'gone', name: '关着', off: true, when: [{ on: 'hours', hours: '0-24' }], cells: { pet: { use: ['x'] } } }] }
  assert.deepEqual(scenesOn(touch, { hour: 9, touched: { part: 'head', kind: 'tap' } }).map(s => s.id), ['pat', 'base'])
  assert.deepEqual(scenesOn(touch, { hour: 9, touched: { part: 'body', kind: 'tap' } }).map(s => s.id), ['base'])
})

test('rotate goes in turn; random never repeats itself', () => {
  const picker = new Picker(() => 0)
  const cell = example.scenes[0]!.cells.avatar!
  assert.deepEqual([1, 2, 3, 4].map(() => picker.next('base', 'avatar', cell)), ['发呆', '托腮', '画圈圈', '发呆'])
  const random = new Picker(() => 0.99)
  const pet = example.scenes[0]!.cells.pet!
  const picks = [1, 2, 3, 4, 5].map(() => random.next('base', 'pet', pet))
  for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i], picks[i - 1])
})

test('reading a stage keeps unknown fields and says what is wrong', () => {
  const { stage, problems } = parseStage({
    format: STAGE_FORMAT, name: '手写', rows: ['avatar', 'pet'], mine: { keep: true },
    scenes: [
      { id: 'base', name: '初始', cells: { avatar: { use: ['发呆'], fancy: 1 } } },
      { id: 'x', name: '没时机', cells: {} },
      { id: 'x', name: '重复', when: [{ on: 'back' }], cells: {} },
      { id: 'y', name: '坏时机', when: [{ on: 'rain' }, { on: 'hours', hours: 'night' }, { on: 'random', everyMinutes: [30, 10] }], cells: { pet: { use: ['a'], pick: 'shuffle' } } },
    ],
  })
  assert.ok(stage !== undefined)
  assert.deepEqual(stage.mine, { keep: true })
  assert.equal(stage.scenes[0]!.cells.avatar!.fancy, 1)
  assert.deepEqual(stage.scenes.map(s => s.id), ['base', 'x', 'y'])
  assert.equal(stage.scenes[2]!.when?.length, 0)
  assert.equal(stage.scenes[2]!.cells.pet!.pick, undefined)
  for (const word of ['没时机', '重复', 'rain', '时间段', '随机', 'pick']) assert.ok(problems.some(p => p.includes(word)), word)
})

test('a file that is not a stage gives no stage, in words', () => {
  assert.equal(parseStage({ format: 'other' }).stage, undefined)
  assert.equal(parseStage({ format: STAGE_FORMAT, scenes: [] }).stage, undefined)
  assert.match(parseStage(null).problems[0]!, /JSON/)
  assert.deepEqual(parseStage(emptyStage('新的')).problems, [])
})

test('materials the library does not have are named', () => {
  const missing = missingMaterials(example, { skin: ['鲸鱼蓝', '深海夜'], avatar: ['发呆', '托腮', '画圈圈', '说话', '睡觉', '麻将1'], desktop: ['海面', '星空'], pet: ['游', '吐泡泡', '挥手', '睡'] })
  assert.deepEqual(missing, ['打麻将那一格用了"麻将2"，头像的素材库里没有', '打麻将那一格用了"麻将桌"，桌面的素材库里没有'])
})

test('a look made before 编排 becomes a stage that picks the same scene', () => {
  const look: Look = {
    format: LOOK_FORMAT, id: 'lk', name: '小禾', desk: 'lk-desk', default: 'desk', minStayMinutes: 30,
    scenes: [
      { id: 'window', name: '窗边', pack: 'lk-window', when: { hours: '7-10' } },
      { id: 'desk', name: '书桌', pack: 'lk-desk-scene', when: { user: 'active' } },
      { id: 'sofa', name: '沙发', pack: 'lk-sofa', when: { hours: '18-23', user: 'idle' } },
      { id: 'bed', name: '卧室', pack: 'lk-bed' },
    ],
  }
  const stage = stageFromLook(look)
  assert.deepEqual(parseStage(JSON.parse(JSON.stringify(stage))).problems, [])
  assert.deepEqual(stage.scenes[0]!.cells, { desktop: { use: ['pack:lk-desk-scene'] }, pet: { use: ['pack:lk-desk'] } })
  assert.equal(stage.scenes.find(s => s.id === 'bed')?.off, true)
  assert.equal(stage.desktopStayMinutes, 30)
  const desktop = (hour: number, user: 'active' | 'idle') => resolveStage(stage, { hour, user }).desktop?.cell.use[0]
  const old = (hour: number, user: 'active' | 'idle') => `pack:${look.scenes.find(s => s.id === pickScene(look, { hour, idleSeconds: user === 'idle' ? 3600 : 0 }))!.pack}`
  for (const [hour, user] of [[8, 'active'], [12, 'active'], [12, 'idle'], [20, 'idle'], [20, 'active'], [2, 'idle']] as const) {
    assert.equal(desktop(hour, user), old(hour, user), `${hour} ${user}`)
  }
})

test('a single pack fills the row of its kind', () => {
  assert.deepEqual(stageFromPack({ packId: 'p', name: 'P', layer: 'overlay' }).scenes[0]!.cells, { pet: { use: ['pack:p'] } })
  assert.deepEqual(stageFromPack({ packId: 'p', name: 'P', layer: 'scene' }).scenes[0]!.cells, { desktop: { use: ['pack:p'] } })
})

test('renaming a material renames it in every cell of its row', () => {
  const stage = structuredClone(example)
  assert.equal(renameMaterial(stage, 'avatar', '发呆', '放空'), true)
  assert.deepEqual(stage.scenes[0]!.cells.avatar!.use, ['放空', '托腮', '画圈圈'])
  assert.equal(renameMaterial(stage, 'pet', '发呆', 'x'), false)
})
