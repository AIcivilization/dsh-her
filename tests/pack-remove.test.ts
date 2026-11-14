import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { removePackOrLook } from '../src/dsh/pack-remove.ts'
import { listProjects, removeProject } from '../src/dsh/workshop.ts'
import { newProject } from '../src/core/workshop.ts'

function home() {
  const root = mkdtempSync(join(tmpdir(), 'her-remove-'))
  const packs = join(root, 'packs')
  const pack = (id: string) => {
    mkdirSync(join(packs, id), { recursive: true })
    writeFileSync(join(packs, id, 'clips.json'), JSON.stringify({ name: id, clips: [{ id: 'a', file: 'a.mp4' }] }))
    writeFileSync(join(packs, id, 'a.mp4'), 'x')
  }
  for (const id of ['old-test', 'in-use', 'stage-desktop-base', 'room-desk', 'room-s1', 'room-other', 'shared']) pack(id)
  mkdirSync(join(root, 'looks', 'room'), { recursive: true })
  // room-other only shares the prefix; shared is borrowed, not made for it.
  const scenes = [{ id: 's1', name: '卧室', pack: 'room-s1' }, { id: 's2', name: '借来的', pack: 'shared' }]
  writeFileSync(join(root, 'looks', 'room', 'look.json'), JSON.stringify({ format: 'dsh-her-look@1', id: 'room', name: '卧室测试', desk: 'room-desk', scenes, default: 's1' }))
  return { root, packs }
}

test('an old 外形包 goes aside, kept in .removed; what she wears does not', () => {
  const h = home()
  assert.deepEqual(removePackOrLook(h.root, h.packs, 'old-test', ['in-use']), { name: 'old-test', gone: ['old-test'] })
  assert.equal(existsSync(join(h.packs, 'old-test')), false)
  assert.equal(readdirSync(join(h.packs, '.removed')).length, 1)
  assert.throws(() => removePackOrLook(h.root, h.packs, 'in-use', ['in-use']), /正在用/)
  assert.throws(() => removePackOrLook(h.root, h.packs, 'nope', []), /没有这个外形包/)
  assert.throws(() => removePackOrLook(h.root, h.packs, '../x', []), /没有这个外形包/)
})

test('a 形象 goes with its own packs; one of its packs alone, or what 编排 made, does not go', () => {
  const h = home()
  assert.throws(() => removePackOrLook(h.root, h.packs, 'room-desk', []), /形象「卧室测试」的一部分/)
  assert.throws(() => removePackOrLook(h.root, h.packs, 'stage-desktop-base', []), /编排/)
  assert.throws(() => removePackOrLook(h.root, h.packs, 'look:stage', []), /编排/)
  assert.throws(() => removePackOrLook(h.root, h.packs, 'look:room', ['look:room']), /正在用/)
  const { name, gone } = removePackOrLook(h.root, h.packs, 'look:room', ['in-use'])
  assert.equal(name, '卧室测试')
  assert.deepEqual(gone.sort(), ['look:room', 'room-desk', 'room-s1'])
  assert.equal(existsSync(join(h.root, 'looks', 'room')), false)
  assert.equal(readdirSync(join(h.root, 'looks', '.removed')).length, 1)
  assert.equal(existsSync(join(h.packs, 'old-test')), true, 'other packs stay')
  assert.equal(existsSync(join(h.packs, 'room-other')), true, 'a pack that only shares the name stays')
  assert.equal(existsSync(join(h.packs, 'shared')), true, 'a borrowed pack stays')
})

test('a 形象工坊 project goes aside and leaves the list', () => {
  const root = mkdtempSync(join(tmpdir(), 'her-projects-'))
  const project = newProject('test-1', '测试项目', new Date('2026-11-01'))
  mkdirSync(join(root, '测试项目'), { recursive: true })
  writeFileSync(join(root, '测试项目', '形象.json'), JSON.stringify(project))
  assert.equal(listProjects(root).length, 1)
  assert.equal(removeProject(project.id, root), '测试项目')
  assert.equal(listProjects(root).length, 0)
  assert.equal(readdirSync(join(root, '.removed')).length, 1)
  assert.throws(() => removeProject(project.id, root), /没有这个项目/)
})
