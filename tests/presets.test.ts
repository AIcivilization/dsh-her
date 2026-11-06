import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveEntriesSafe, checkUnpacked, validatePresets } from '../src/dsh/presets.ts'

const sha = 'a'.repeat(64)
const good = { id: 'xiaohe', name: '小禾', kind: 'look', file: 'xiaohe.tar.gz', size: 10, sha256: sha }

test('the list keeps what can be used and leaves out the rest', () => {
  assert.deepEqual(validatePresets({ presets: [good] }), [good])
  assert.deepEqual(validatePresets({ presets: [good, { ...good, id: '../evil' }, { ...good, file: 'a/b.tar.gz' }, { ...good, file: 'x.zip' }, { ...good, sha256: 'no' }, { ...good, kind: 'x' }] }), [good])
  assert.deepEqual(validatePresets({ presets: [{ ...good, preview: { file: 'x.png', size: 99_000_000, sha256: sha } }] }), [])
  assert.deepEqual(validatePresets(undefined), [])
  assert.deepEqual(validatePresets({ presets: 'no' }), [])
})

test('paths that leave the archive are refused', () => {
  assert.equal(archiveEntriesSafe(['packs/a/pack.json', 'looks/a/look.json']), true)
  assert.equal(archiveEntriesSafe(['packs/../../x']), false)
  assert.equal(archiveEntriesSafe(['/etc/passwd']), false)
  assert.equal(archiveEntriesSafe(['C:\\x']), false)
  assert.equal(archiveEntriesSafe(['..\\x']), false)
})

const folder = () => mkdtempSync(join(tmpdir(), 'her-preset-'))
const put = (root: string, file: string) => {
  mkdirSync(join(root, file, '..'), { recursive: true })
  writeFileSync(join(root, file), 'x')
}

test('a preset holds only its own packs and look', () => {
  const dir = folder()
  put(dir, 'packs/xiaohe-desk/pack.json')
  put(dir, 'looks/xiaohe/look.json')
  assert.equal(checkUnpacked(dir, { id: 'xiaohe', kind: 'look' }), undefined)
  assert.match(checkUnpacked(folder(), { id: 'xiaohe', kind: 'look' })!, /没有外形/)

  const stray = folder()
  put(stray, 'packs/other/pack.json')
  assert.match(checkUnpacked(stray, { id: 'xiaohe', kind: 'pack' })!, /对不上/)

  const extra = folder()
  put(extra, 'packs/xiaohe/pack.json')
  put(extra, 'characters/x.json')
  assert.match(checkUnpacked(extra, { id: 'xiaohe', kind: 'pack' })!, /不该有/)

  const noLook = folder()
  put(noLook, 'packs/xiaohe/pack.json')
  assert.match(checkUnpacked(noLook, { id: 'xiaohe', kind: 'look' })!, /look\.json/)
})

test('a link inside a preset is refused', { skip: process.platform === 'win32' }, () => {
  const dir = folder()
  put(dir, 'packs/xiaohe/pack.json')
  symlinkSync('/etc/hosts', join(dir, 'packs/xiaohe/hosts'))
  assert.match(checkUnpacked(dir, { id: 'xiaohe', kind: 'pack' })!, /链接/)
})
