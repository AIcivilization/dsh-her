import { test } from 'node:test'
import assert from 'node:assert/strict'
import { search, tokens } from '../src/memory/search.ts'

const DAY = 86_400_000
const now = Date.UTC(2026, 9, 29)

test('Chinese becomes bigrams, Latin becomes words', () => {
  assert.deepEqual(tokens('下周三面试 at Tencent!'), ['下周', '周三', '三面', '面试', 'at', 'tencent'])
  assert.deepEqual(tokens('猫'), ['猫'])
})

test('the memory that shares the most words wins; unrelated ones are left out', () => {
  const docs = [
    { id: 'e1', text: '他说下周三要去腾讯面试，有点紧张', at: now - 2 * DAY },
    { id: 'f1', text: '他喜欢吃热汤面，不吃香菜', at: now - 10 * DAY },
    { id: 'f2', text: '他养了一只叫团子的橘猫', at: now - 5 * DAY },
  ]
  const hits = search(docs, '面试怎么样了', now)
  assert.equal(hits[0]?.id, 'e1')
  assert.ok(!hits.some(h => h.id === 'f2'))
  assert.equal(search(docs, '团子', now)[0]?.id, 'f2')
  assert.deepEqual(search(docs, '量子力学', now), [])
})

test('between equal matches, the newer memory comes first', () => {
  const docs = [
    { id: 'old', text: '他想去青海湖旅行', at: now - 300 * DAY },
    { id: 'new', text: '他想去青海湖旅行', at: now - 1 * DAY },
  ]
  assert.deepEqual(search(docs, '青海湖', now).map(h => h.id), ['new', 'old'])
})
