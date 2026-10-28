import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readingMs, SentenceSplitter } from '../src/core/sentences.ts'

function run(deltas: string[]): string[] {
  const splitter = new SentenceSplitter()
  return [...deltas.flatMap(d => splitter.push(d)), ...splitter.flush()]
}

test('splits on Chinese and English terminators across deltas', () => {
  assert.deepEqual(run(['你回来', '啦。今天', '怎么样？I am', ' fine! 好']), ['你回来啦。', '今天怎么样？', 'I am fine!', '好'])
})

test('a closing quote stays with its sentence, even in the next delta', () => {
  assert.deepEqual(run(['她说："好呀。', '"然后笑了。']), ['她说："好呀。"', '然后笑了。'])
})

test('line breaks end a sentence', () => {
  assert.deepEqual(run(['第一行\n第二行']), ['第一行', '第二行'])
})

test('punctuation-only fragments are never spoken', () => {
  assert.deepEqual(run(['好的。', '！', '…', '\n', '** ']), ['好的。'])
})

test('a long clause without a terminator is cut at its last soft pause', () => {
  const clause = '今天我们一起去了海边，看了很久的日落，又沿着沙滩走了很远很远，最后在路边的小店吃了一碗热乎乎的面条'
  const splitter = new SentenceSplitter()
  const first = splitter.push(clause)
  assert.equal(first.length, 1)
  assert.ok(first[0]!.endsWith('，'))
  assert.equal(first[0]! + splitter.flush().join(''), clause)
})

test('reset drops the unfinished sentence', () => {
  const splitter = new SentenceSplitter()
  splitter.push('说到一半')
  splitter.reset()
  assert.deepEqual(splitter.flush(), [])
})

test('reading time counts letters and digits only, with a floor', () => {
  assert.equal(readingMs('好。'), 1200)
  assert.equal(readingMs('你回来啦，我等你好久了。'), 10 * 220)
  assert.equal(readingMs('！？…'), 1200)
})

test('the first sentence of a reply is cut early at a soft pause, later ones are not', () => {
  assert.deepEqual(run(['今天外面下雨，记得带伞哦。明天也会下雨，后天放晴，大后天又要降温。']), [
    '今天外面下雨，', '记得带伞哦。', '明天也会下雨，后天放晴，大后天又要降温。',
  ])
})

test('after reset the next reply gets the early cut again', () => {
  const splitter = new SentenceSplitter()
  splitter.push('第一段回复说完了。')
  splitter.flush()
  splitter.reset()
  assert.deepEqual(splitter.push('新的回复开头，'), [])
  assert.deepEqual(splitter.push('接着说'), ['新的回复开头，'])
})
