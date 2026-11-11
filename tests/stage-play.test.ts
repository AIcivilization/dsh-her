import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { Library } from '../src/dsh/library.ts'
import { compileStage, readPlay, removeStageLook, writePlay } from '../src/dsh/stage-play.ts'
import { listLooks } from '../src/pack/looks.ts'
import { loadPack } from '../src/pack/load.ts'
import { STAGE_FORMAT, type Stage } from '../src/pack/stage.ts'

function home() {
  const h = mkdtempSync(join(tmpdir(), 'her-play-'))
  const packs = join(h, 'packs')
  mkdirSync(join(packs, 'bedroom'), { recursive: true })
  writeFileSync(join(packs, 'bedroom', 'clips.json'), JSON.stringify({ name: 'bedroom', layer: 'scene', clips: [{ id: 'a', file: 'a.mp4' }] }))
  for (const [row, file] of [['desktop', '海面.mp4'], ['desktop', '星空.mp4'], ['pet', '游.webm'], ['pet', '吐泡泡.webm'], ['desktop', '照片.png']] as const) {
    mkdirSync(join(h, 'library', row), { recursive: true })
    writeFileSync(join(h, 'library', row, file), 'x')
  }
  return { h, packs }
}

const stage: Stage = {
  format: STAGE_FORMAT, name: '测试', rows: ['skin', 'avatar', 'desktop', 'pet'], desktopStayMinutes: 30,
  scenes: [
    { id: 'base', name: '初始', cells: { desktop: { use: ['海面'] }, pet: { use: ['游', '吐泡泡'], pick: 'random' } } },
    { id: 'night', name: '夜里', when: [{ on: 'hours', hours: '23-7' }], cells: { desktop: { use: ['星空'] } } },
    { id: 'bed', name: '卧室', when: [{ on: 'all', of: [{ on: 'hours', hours: '21-24' }, { on: 'idle' }] }], cells: { desktop: { use: ['pack:bedroom'] } } },
    { id: 'talk', name: '说话时', when: [{ on: 'her-speaking' }], cells: { desktop: { use: ['星空'] } } },
    { id: 'pic', name: '照片', when: [{ on: 'you-ask' }], cells: { desktop: { use: ['照片'] }, pet: { use: ['游'] } } },
  ],
}

test('the stage becomes a look the bodies know, with its packs', () => {
  const { h, packs } = home()
  const { look, notes } = compileStage(stage, h, packs, new Library(h), ['bedroom'])
  assert.ok(look !== undefined)
  assert.deepEqual(look.scenes.map(s => [s.id, s.pack, s.when]), [
    ['base', 'stage-desktop-base', undefined],
    ['night', 'stage-desktop-night', { hours: '23-7' }],
    ['bed', 'bedroom', { hours: '21-24', user: 'idle' }],
    // Asked for by you: its desktop is a picture that could not be made into a clip here, so 初始's desktop with its own pet.
    ['pic', 'stage-desktop-base', undefined],
  ])
  assert.equal(look.scenes.find(s => s.id === 'pic')?.desk, 'stage-pet-pic')
  assert.equal(look.desk, 'stage-pet-base')
  assert.equal(look.default, 'base')
  assert.equal(look.minStayMinutes, 30)
  // The bodies find it as a look, and its packs load: the pet's webm clips with their transparency.
  assert.deepEqual(listLooks(h, packs).map(l => l.id), ['stage'])
  const pet = loadPack(join(packs, 'stage-pet-base'))
  assert.equal(pet.layout, 'alpha')
  assert.deepEqual(pet.clips.map(c => [c.role, c.name]), [['state', 'idle'], ['state', 'idle']])
  assert.equal(loadPack(join(packs, 'stage-desktop-base')).layer, 'scene')
  for (const word of ['一下子', '图片']) assert.ok(notes.some(n => n.includes(word)), word)
})

test('compiling again replaces the packs it made, and leaves the others', () => {
  const { h, packs } = home()
  compileStage(stage, h, packs, new Library(h), ['bedroom'])
  const smaller: Stage = { ...stage, scenes: [stage.scenes[0]!] }
  compileStage(smaller, h, packs, new Library(h), ['bedroom', 'stage-desktop-night'])
  assert.equal(existsSync(join(packs, 'stage-desktop-night')), false)
  assert.equal(existsSync(join(packs, 'bedroom', 'clips.json')), true)
  assert.equal(JSON.parse(readFileSync(join(h, 'looks', 'stage', 'look.json'), 'utf8')).scenes.length, 1)
})

test('nothing to show: no look, and it says so', () => {
  const { h, packs } = home()
  const empty: Stage = { ...stage, scenes: [{ id: 'base', name: '初始', cells: {} }] }
  const { look, notes } = compileStage(empty, h, packs, new Library(h), [])
  assert.equal(look, undefined)
  assert.match(notes[0]!, /至少/)
})

test('the switch is remembered with what she wore before', () => {
  const { h } = home()
  assert.deepEqual(readPlay(h), { on: false })
  writePlay(h, { on: true, before: 'look:old' })
  assert.deepEqual(readPlay(h), { on: true, before: 'look:old' })
})

test('stopping takes the look and its packs away, nothing else', () => {
  const { h, packs } = home()
  compileStage(stage, h, packs, new Library(h), ['bedroom'])
  removeStageLook(h, packs)
  assert.deepEqual(listLooks(h, packs), [])
  assert.equal(existsSync(join(packs, 'stage-pet-base')), false)
  assert.equal(existsSync(join(packs, 'bedroom', 'clips.json')), true)
})

test('a real picture becomes a still clip the body can play', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 && 'no ffmpeg here' }, () => {
  const { h, packs } = home()
  const png = join(h, 'library', 'desktop', '照片.png')
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x36:d=1', '-frames:v', '1', png])
  const one: Stage = { ...stage, scenes: [{ id: 'base', name: '初始', cells: { desktop: { use: ['照片'] } } }] }
  const { look, notes } = compileStage(one, h, packs, new Library(h), [])
  assert.deepEqual(notes, [])
  const pack = loadPack(join(packs, look!.scenes[0]!.pack))
  assert.match(pack.clips[0]!.url, /m0\.mp4$/)
})
