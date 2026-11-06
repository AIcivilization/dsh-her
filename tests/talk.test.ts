import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanSplit, DEFAULT_SPLIT, lastLines, sizeText, splitReason } from '../src/core/talk.ts'

const dayOf = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
const now = new Date(2026, 10, 6, 10, 0)
const HOUR = 3_600_000

test('off by default: always the same conversation', () => {
  assert.equal(splitReason(DEFAULT_SPLIT, { lastAt: now.getTime() - 100 * HOUR, tokens: 9e6, now, dayOf }), undefined)
})

test('each rule starts a new one, and says why', () => {
  assert.equal(splitReason({ ...DEFAULT_SPLIT, daily: true }, { lastAt: new Date(2026, 10, 5, 23, 0).getTime(), tokens: 0, now, dayOf }), '新的一天')
  assert.equal(splitReason({ ...DEFAULT_SPLIT, daily: true }, { lastAt: now.getTime() - HOUR, tokens: 0, now, dayOf }), undefined)
  assert.match(splitReason({ ...DEFAULT_SPLIT, idleHours: 6 }, { lastAt: now.getTime() - 6 * HOUR, tokens: 0, now, dayOf })!, /6 小时/)
  assert.equal(splitReason({ ...DEFAULT_SPLIT, idleHours: 6 }, { lastAt: now.getTime() - 5 * HOUR, tokens: 0, now, dayOf }), undefined)
  assert.match(splitReason({ ...DEFAULT_SPLIT, maxTokens: 60_000 }, { lastAt: now.getTime() - 1, tokens: 60_000, now, dayOf })!, /很长/)
})

test('a conversation with nothing said yet is never split', () => {
  assert.equal(splitReason({ idleHours: 1, maxTokens: 1, daily: true }, { lastAt: 0, tokens: 5, now, dayOf }), undefined)
})

test('settings from a file are cleaned', () => {
  assert.deepEqual(cleanSplit(undefined), DEFAULT_SPLIT)
  assert.deepEqual(cleanSplit({ idleHours: 6, maxTokens: -1, daily: 'yes' }), { idleHours: 6, maxTokens: null, daily: false })
})

test('the bar shows the last lines of both, in order', () => {
  const session = [{ who: 'you' as const, text: 'a', time: 1 }, { who: 'her' as const, text: 'b', time: 3 }]
  const own = [{ who: 'her' as const, text: 'opening', time: 2 }, { who: 'her' as const, text: 'touch', time: 4 }]
  assert.deepEqual(lastLines(session, own, 3).map(l => l.text), ['opening', 'b', 'touch'])
})

test('size in plain words', () => {
  assert.equal(sizeText(800), '约 1 千字')
  assert.equal(sizeText(32_000), '约 3.2 万字')
  assert.equal(sizeText(120_000), '约 12 万字')
})
