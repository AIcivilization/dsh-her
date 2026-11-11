import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { cleanName, Library } from '../src/dsh/library.ts'
import { KEEP_VERSIONS, StageStore } from '../src/dsh/stage-store.ts'
import { emptyStage } from '../src/pack/stage.ts'

const home = () => mkdtempSync(join(tmpdir(), 'her-lib-'))

test('the library lists pictures and clips by name, and only those', () => {
  const h = home()
  const lib = new Library(h)
  const dir = join(h, 'library', 'avatar')
  mkdirSync(dir, { recursive: true })
  for (const f of ['打麻将.mp4', '发呆.webm', '托腮.png', '说明.txt', '.hidden.mp4', '一半.mp4.part']) writeFileSync(join(dir, f), 'x')
  assert.deepEqual(lib.list('avatar').map(m => [m.name, m.kind]), [['打麻将', 'video'], ['发呆', 'video'], ['托腮', 'image']])
  assert.deepEqual(lib.list('pet'), [])
  assert.match(lib.path('avatar', '打麻将') ?? '', /打麻将\.mp4$/)
})

test('uploads land as plain names in their row, nowhere else', () => {
  const lib = new Library(home())
  assert.match(lib.target('pet', '游.MP4') ?? '', /pet[/\\]游\.mp4$/)
  for (const [row, file] of [['nope', 'a.mp4'], ['pet', 'a.exe'], ['pet', '../a.mp4'], ['pet', '.a.mp4'], ['pet', 'a/b.mp4']] as const) assert.equal(lib.target(row, file), undefined, `${row} ${file}`)
  assert.equal(cleanName(' 打麻将 '), '打麻将')
  assert.equal(cleanName('a:b'), undefined)
})

test('rename keeps names unique; remove moves the file aside', () => {
  const h = home()
  const lib = new Library(h)
  const dir = join(h, 'library', 'desktop')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '海面.mp4'), 'x')
  writeFileSync(join(dir, '星空.mp4'), 'x')
  assert.throws(() => lib.rename('desktop', '海面', '星空'), /已经有/)
  lib.rename('desktop', '海面', '大海')
  assert.deepEqual(lib.list('desktop').map(m => m.name), ['大海', '星空'])
  lib.remove('desktop', '星空')
  assert.deepEqual(lib.list('desktop').map(m => m.name), ['大海'])
  assert.equal(readdirSync(join(h, 'library', '.removed', 'desktop')).length, 1)
})

test('each save keeps the one before as a version, the last few only', () => {
  const store = new StageStore(home())
  assert.deepEqual(store.load(), { problems: [] })
  for (let i = 0; i < KEEP_VERSIONS + 3; i++) store.save(emptyStage(`第${i}版`), 1000 + i)
  assert.equal(store.load().stage?.name, `第${KEEP_VERSIONS + 2}版`)
  const versions = store.versions()
  assert.equal(versions.length, KEEP_VERSIONS)
  assert.equal(versions[0]!.name, `第${KEEP_VERSIONS + 1}版`)
  store.restore(versions[0]!.id, 5000)
  assert.equal(store.load().stage?.name, `第${KEEP_VERSIONS + 1}版`)
  assert.equal(store.versions()[0]!.name, `第${KEEP_VERSIONS + 2}版`)
  assert.throws(() => store.restore('../x'), /没有这个版本/)
})

test('a broken file is reported, not thrown', () => {
  const h = home()
  mkdirSync(join(h, 'stages'), { recursive: true })
  writeFileSync(join(h, 'stages', 'stage.json'), '{ not json')
  const loaded = new StageStore(h).load()
  assert.equal(loaded.stage, undefined)
  assert.match(loaded.problems[0]!, /读不了/)
  assert.ok(existsSync(join(h, 'stages', 'stage.json')))
})
