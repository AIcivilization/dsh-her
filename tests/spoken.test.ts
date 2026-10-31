import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractSounds, mingSpeech, serviceOf, spokenNumbers, withSounds } from '../src/core/index.ts'
import { readInteger } from '../src/core/spoken-numbers.ts'

test('integers read the Chinese way', () => {
  const cases: Record<string, string> = {
    0: '零', 7: '七', 10: '十', 12: '十二', 20: '二十', 105: '一百零五', 110: '一百一十', 1205: '一千二百零五',
    2000: '两千', 10001: '一万零一', 20000: '两万', 100000: '十万', 1000050: '一百万零五十', 300000000: '三亿',
  }
  for (const [n, said] of Object.entries(cases)) assert.equal(readInteger(n), said, n)
})

test('numbers in her sentences are written out', () => {
  const cases: Array<[string, string]> = [
    ['离开会还有2个小时。', '离开会还有两个小时。'],
    ['现在是3点15分', '现在是三点十五分'],
    ['下午2点见', '下午两点见'],
    ['约在15:30', '约在十五点三十分'],
    ['早上9:05起床，8:00出门', '早上九点零五分起床，八点出门'],
    ['2026年10月31日', '二零二六年十月三十一日'],
    ['2月和2年', '二月和两年'],
    ['涨了30%，还有2.5%', '涨了百分之三十，还有百分之二点五'],
    ['今天20~25℃', '今天二十到二十五度'],
    ['大概3-5天', '大概三到五天'],
    ['体重52.6公斤', '体重五十二点六公斤'],
    ['我的电话13812345678', '我的电话一三八一二三四五六七八'],
    ['验证码是4821', '验证码是四八二一'],
    ['房间0302', '房间零三零二'],
    ['2026-10-31', '二零二六年十月三十一日'],
  ]
  for (const [text, said] of cases) assert.equal(spokenNumbers(text), said, text)
})

test('sound tags go to the nearer end, out of the subtitle', () => {
  const start = extractSounds('〔叹气〕雨还没停呢。')
  assert.equal(start.text, '雨还没停呢。')
  assert.equal(withSounds(start.text, start), '[Sigh] 雨还没停呢。')
  const end = extractSounds('不过有你陪着，也挺好的〔笑〕')
  assert.equal(withSounds(end.text, end), '不过有你陪着，也挺好的 [Laughter]')
  const middle = extractSounds('你呀〔笑〕，真是拿你没办法。')
  assert.deepEqual([middle.text, middle.before, middle.after], ['你呀，真是拿你没办法。', ['[Laughter]'], []])
  const none = extractSounds('〔开心〕好呀')
  assert.equal(none.text, '〔开心〕好呀', 'other tags are left for extractCues')
})

test('Ming voices: moods, own voices, speed', () => {
  assert.equal(serviceOf('ming:灵风信'), 'ming')
  assert.equal(serviceOf('ming-own:abc'), 'ming')
  assert.deepEqual(mingSpeech('ming:灵风信', 'happy', 1), { voice: '灵风信_高兴' })
  assert.deepEqual(mingSpeech('ming:灵风信', 'surprised', 1), { voice: '灵风信_中性' }, 'a mood it was not recorded in')
  assert.deepEqual(mingSpeech('ming:灵风信', 'shy', 1), { voice: '灵风信_中性' })
  assert.deepEqual(mingSpeech('ming:灵梦', 'sad', 1.3), { voice: '灵梦', emotion: '悲伤', speed: '快速' })
  assert.deepEqual(mingSpeech('ming-own:v1', 'happy', 0.8), { own: 'v1', emotion: '高兴', speed: '慢速' })
  assert.deepEqual(mingSpeech('ming:灵梦', undefined, 1), { voice: '灵梦' })
})
