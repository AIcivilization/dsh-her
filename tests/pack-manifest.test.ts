import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferPack } from '../src/pack/manifest.ts'

const files = [
  'anchor_stand.png', 'anchor_sit.png', 'anchor_stand@jk.png',
  'stand_idle_01.mp4', 'stand_idle_02.mp4', 'stand_talk_01.mp4', 'stand_happy_01.mp4', 'stand_wave_01.mp4',
  'sit_idle_01.mp4', 'sit_to_stand.mp4', 'stand_to_sit.mp4',
  'stand_exit_right.mp4', 'off_enter_right.mp4', 'off_enter_right_jk.mp4',
  'stand@jk_idle_01.mp4', 'stand@jk_show_01.mp4', 'stand@jk_exit_right.mp4',
  'lines/line_hello.mp4', 'lines/line_hello.wav', 'lines/line_hello.txt',
  'notes.docx', '.DS_Store',
]

test('file names become anchors, roles and transitions', () => {
  const pack = inferPack(files, path => (path === 'lines/line_hello.txt' ? '你好呀。\n' : undefined))
  assert.deepEqual(Object.keys(pack.anchors).sort(), ['off', 'sit', 'stand', 'stand@jk'])
  assert.equal(pack.start, 'stand')
  const byId = new Map(pack.clips.map(c => [c.id, c]))
  assert.deepEqual(byId.get('stand_talk_01'), { id: 'stand_talk_01', source: 'stand_talk_01.mp4', from: 'stand', to: 'stand', role: 'state', name: 'talk', interruptible: true })
  assert.equal(byId.get('stand_happy_01')!.role, 'emotion')
  assert.equal(byId.get('stand_wave_01')!.name, 'wave')
  assert.equal(byId.get('stand@jk_show_01')!.name, 'jk_show')
  assert.deepEqual([byId.get('sit_to_stand')!.from, byId.get('sit_to_stand')!.to, byId.get('sit_to_stand')!.interruptible], ['sit', 'stand', false])
  assert.deepEqual([byId.get('stand@jk_exit_right')!.from, byId.get('stand@jk_exit_right')!.to], ['stand@jk', 'off'])
  assert.deepEqual([byId.get('off_enter_right')!.from, byId.get('off_enter_right')!.to], ['off', 'stand'])
  assert.deepEqual([byId.get('off_enter_right_jk')!.from, byId.get('off_enter_right_jk')!.to], ['off', 'stand@jk'])
  const line = byId.get('line_hello')!
  assert.deepEqual([line.from, line.audio, line.transcript], ['stand', 'lines/line_hello.wav', '你好呀。'])
  assert.deepEqual(pack.unknown, ['notes.docx'])
})

test('outfits that can be reached off screen become macros', () => {
  const pack = inferPack(files)
  assert.deepEqual(pack.macros, [
    { action: 'outfit_jk', desc: '离开画面，换上 jk 再回来展示', goTo: 'stand@jk', then: 'jk_show' },
    { action: 'outfit_default', desc: '离开画面，换回原来的衣服再回来', goTo: 'stand' },
  ])
})

test('a minimal pack is one anchor with idle and talk', () => {
  const pack = inferPack(['stand_idle_01.mp4', 'stand_talk_01.mp4'])
  assert.deepEqual(Object.keys(pack.anchors), ['stand'])
  assert.equal(pack.start, 'stand')
  assert.deepEqual(pack.macros, [])
})

test('notes, old versions and extra photo shapes are not reported as unknown', () => {
  const pack = inferPack([
    'plate.png', 'plate_16x9.png', 'scene.json', 'crop.png', 'stand_idle_01.mp4', 'stand_talk_01.mp4',
    '提示词.txt', '重做清单.txt', 'MiniMax生成任务.md', '测试版/stand_idle_01.mp4', 'lines/line_hi.mp4',
  ])
  assert.deepEqual(pack.unknown, [])
  assert.deepEqual(pack.clips.map(c => c.source).sort(), ['lines/line_hi.mp4', 'stand_idle_01.mp4', 'stand_talk_01.mp4'])
  assert.equal(pack.plate, 'plate.png')
})
