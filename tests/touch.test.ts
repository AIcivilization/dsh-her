import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTouchLines, touchClip, touchLinesPrompt, touchPart, TouchTracker } from '../src/core/touch.ts'

test('the top of her figure is her head', () => {
  assert.equal(touchPart(0.1), 'head')
  assert.equal(touchPart(0.29), 'head')
  assert.equal(touchPart(0.3), 'body')
  assert.equal(touchPart(0.9), 'body')
})

test('she does not answer every touch', () => {
  const tracker = new TouchTracker()
  assert.equal(tracker.next('head', 'tap', 100_000), 'head')
  assert.equal(tracker.next('head', 'tap', 103_000), undefined)
  assert.equal(tracker.next('body', 'tap', 108_001), 'body')
  assert.equal(tracker.next('head', 'long', 120_000), 'long')
})

test('playing with her gets its own answer', () => {
  const tracker = new TouchTracker()
  tracker.next('body', 'tap', 100_000)
  for (const t of [101_000, 102_000, 103_000]) assert.equal(tracker.next('body', 'tap', t), undefined)
  assert.equal(tracker.next('body', 'tap', 108_500), 'many')
})

test('she does not say the same line twice running', () => {
  const tracker = new TouchTracker()
  assert.equal(tracker.pick(['甲', '乙'], () => 0), '甲')
  assert.equal(tracker.pick(['甲', '乙'], () => 0), '乙')
  assert.equal(tracker.pick(['只有这句'], () => 0), '只有这句')
  assert.equal(tracker.pick([], () => 0), undefined)
})

test('her lines are read out of the answer, or refused whole', () => {
  const good = { head: ['别点啦'], body: ['干嘛戳我'], long: ['再摸一会儿'], many: ['够了够了'] }
  assert.deepEqual(parseTouchLines(`好的：\n${JSON.stringify(good)}`), good)
  assert.equal(parseTouchLines('不是 JSON'), undefined)
  assert.equal(parseTouchLines('{"head": ["a"]}'), undefined)
  assert.equal(parseTouchLines(JSON.stringify({ ...good, many: [] })), undefined)
  // A paragraph is not a short line.
  assert.deepEqual(parseTouchLines(JSON.stringify({ ...good, head: ['别点啦', '字'.repeat(40)] }))?.head, ['别点啦'])
  assert.match(touchLinesPrompt(), /JSON/)
})

test('a clip made for touching comes first, then a reaction the pack has', () => {
  const pack = (actions: string[], emotions: string[]) => ({ actions: actions.map(id => ({ id })), emotions })
  assert.deepEqual(touchClip(pack(['touch_head', 'touch'], ['happy']), 'head'), { act: 'touch_head' })
  assert.deepEqual(touchClip(pack(['touch'], ['happy']), 'head'), { act: 'touch' })
  assert.deepEqual(touchClip(pack([], ['smile', 'happy']), 'body'), { emotion: 'happy' })
  assert.equal(touchClip(pack(['wave'], []), 'body'), undefined)
  assert.equal(touchClip(undefined, 'body'), undefined)
})
