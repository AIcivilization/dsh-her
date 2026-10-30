import { test } from 'node:test'
import assert from 'node:assert/strict'
import { speakable } from '../src/core/speakable.ts'

test('plain spoken text is left alone', () => {
  assert.equal(speakable('你回来啦，我等你好久了。'), '你回来啦，我等你好久了。')
})

test('markdown, links, code and list bullets are not read out', () => {
  assert.equal(speakable('**真的**很好看，看这里 https://example.com/a?b=1 吧。'), '真的很好看，看这里 吧。')
  assert.equal(speakable('- 第一件事：喝水。'), '第一件事：喝水。')
  assert.equal(speakable('2. 早点睡。'), '早点睡。')
  assert.equal(speakable('运行 `npm test` 就行。'), '运行 就行。')
  assert.equal(speakable('点[这里](https://x.y)看看。'), '点这里看看。')
})

test('performance tags drive the body and are never spoken', () => {
  assert.equal(speakable('〔开心〕今天天气真好呀〔动作:wave〕'), '今天天气真好呀')
})

test('stage directions are not spoken; a long bracket is', () => {
  assert.equal(speakable('【瞪他】赶紧睡（笑），真的(sighs)。'), '赶紧睡，真的。')
  assert.equal(speakable('看[这里](https://a.b)。'), '看这里。')
  assert.equal(speakable('那部电影（就是我们上次在电影院没看完的那部）挺好看。'), '那部电影（就是我们上次在电影院没看完的那部）挺好看。')
})
