import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeBargeIn } from '../src/core/echo.ts'

const her = '好，那我把阿灰的故事再往下讲，你听着。那天晚上风雨特别大，浪打到灯塔脚下。'

test('her own words coming back are echo, even recognized imperfectly', () => {
  assert.equal(judgeBargeIn('那天晚上风雨特别大', her), 'echo')
  assert.equal(judgeBargeIn('那天晚上风雨特别打浪打到灯塔', her), 'echo')
})

test('filler sounds and nothing are not you', () => {
  assert.equal(judgeBargeIn('嗯', her), 'filler')
  assert.equal(judgeBargeIn('嗯嗯。', her), 'filler')
  assert.equal(judgeBargeIn('', her), 'filler')
})

test('you talking over her is you, even when you echo a word or two', () => {
  assert.equal(judgeBargeIn('等一下，先别讲了', her), 'you')
  assert.equal(judgeBargeIn('阿灰后来怎么样了', her), 'you')
  assert.equal(judgeBargeIn('好', her), 'you')
})
