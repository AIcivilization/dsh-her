import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadCharacter, saveCharacter, type Character } from '../src/core/character.ts'
import { Characters } from '../src/dsh/characters.ts'

const her = (name: string): Character => ({ name, persona: `你是${name}。爱笑。`, callYou: '你', pronoun: '他', voice: { id: 'zh-CN-XiaoxiaoNeural', speed: 1 }, onboarded: true })

test('the first character is there before anything is saved; new ones are listed after her', () => {
  const home = mkdtempSync(join(tmpdir(), 'her-people-'))
  const people = new Characters(home, join(home, 'characters'), { cid: 'sample', name: '小禾' })
  assert.equal(people.active(), 'sample')
  assert.deepEqual(people.list(), [{ cid: 'sample', name: '小禾', line: '', active: true, first: true }])
  const cid = people.create(her('阿鲸'))
  assert.match(cid, /^c[a-z0-9]+$/)
  assert.deepEqual(people.list().map(c => [c.name, c.active, c.first]), [['小禾', true, true], ['阿鲸', false, false]])
  assert.equal(people.list()[1]!.line, '你是阿鲸')
  assert.equal(loadCharacter(join(home, 'characters', cid), her('x')).name, '阿鲸')
})

test('choosing a character is remembered, and both bodies still wear the one before until dressed', () => {
  const home = mkdtempSync(join(tmpdir(), 'her-people-'))
  const people = new Characters(home, join(home, 'characters'), { cid: 'sample', name: '小禾' })
  const cid = people.create(her('阿鲸'))
  assert.equal(people.needsDress('desktop'), false)
  people.use(cid)
  assert.equal(new Characters(home, join(home, 'characters'), { cid: 'sample', name: '小禾' }).active(), cid)
  assert.equal(people.needsDress('desktop'), true)
  assert.equal(people.needsDress('web'), true)
  people.dressed('web')
  assert.equal(people.needsDress('web'), false)
  assert.equal(people.needsDress('desktop'), true)
  assert.equal(people.active(), cid)
  // Back to the first, who has no file of her own yet.
  people.use('sample')
  assert.equal(people.active(), 'sample')
  assert.throws(() => people.use('nobody'), /没有这个人物/)
  assert.throws(() => people.use('../x'), /没有这个人物/)
})

test('the one in use and the first cannot be removed; a removed one is kept aside', () => {
  const home = mkdtempSync(join(tmpdir(), 'her-people-'))
  const dir = join(home, 'characters')
  const people = new Characters(home, dir, { cid: 'sample', name: '小禾' })
  saveCharacter(join(dir, 'sample'), her('小禾'))
  const cid = people.create(her('阿鲸'))
  people.use(cid)
  assert.throws(() => people.remove(cid), /正在用/)
  assert.throws(() => people.remove('sample'), /第一个人物/)
  people.use('sample')
  people.remove(cid)
  assert.deepEqual(people.list().map(c => c.cid), ['sample'])
  assert.equal(existsSync(join(dir, cid)), false)
  assert.equal(readdirSync(join(dir, '.removed')).length, 1)
  // A character whose folder went away: the first one is in use again.
  const other = people.create(her('阿海'))
  people.use(other)
  people.use('sample')
  people.remove(other)
  assert.equal(people.active(), 'sample')
})
