import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractCues, isHeavy, performanceSection } from '../src/core/cues.ts'
import type { PackSummary } from '../src/protocol/index.ts'

const pack: PackSummary = {
  packId: 'test-doll', kind: 'video', name: '测试小人', layer: 'overlay',
  states: ['idle', 'talk', 'listen'], emotions: ['happy'], hitParts: ['body'],
  actions: [
    { id: 'wave', desc: '挥手打招呼', durationMs: 2500 },
    { id: 'jk_show', desc: '展示身上的衣服', durationMs: 2500 },
    { id: 'line_hello', desc: '说储备台词：你好呀', durationMs: 2600, hasAudio: true, transcript: '你好呀' },
    { id: 'outfit_jk', desc: '离开画面，换上 jk 再回来展示' },
  ],
}

test('tags become cues and leave the text', () => {
  assert.deepEqual(extractCues('〔开心〕你回来啦〔动作:wave〕', pack), { text: '你回来啦', cues: [{ kind: 'emotion', name: 'happy' }, { kind: 'act', name: 'wave' }] })
  assert.deepEqual(extractCues('〔动作：挥手打招呼〕嗨！', pack), { text: '嗨！', cues: [{ kind: 'act', name: 'wave' }] })
})

test('tags the pack cannot do are dropped silently, heavy actions are not inline', () => {
  assert.deepEqual(extractCues('〔害羞〕才没有呢〔动作:fly〕〔动作:outfit_jk〕', pack), { text: '才没有呢', cues: [] })
  assert.deepEqual(extractCues('〔开心〕好', undefined), { text: '好', cues: [] })
})

test('outfits and stored lines are heavy; loops are light', () => {
  assert.deepEqual(pack.actions.map(isHeavy), [false, false, true, true])
})

test('the performance section lists only what this pack can do', () => {
  const text = performanceSection(pack)
  assert.match(text, /〔开心〕/)
  assert.match(text, /〔动作:wave〕：挥手打招呼/)
  assert.match(text, /play_action/)
  assert.match(text, /- outfit_jk：/)
  assert.doesNotMatch(text, /害羞/)
  assert.equal(performanceSection(undefined), '')
})
