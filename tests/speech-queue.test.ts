import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heardText, SpeechQueue, type Synthesized } from '../src/voice/speech-queue.ts'

function recorder(delayMs = 1, fail?: string) {
  const events: string[] = []
  const synth = async (text: string): Promise<Synthesized | undefined> => {
    await new Promise(resolve => setTimeout(resolve, delayMs))
    if (text === fail) throw new Error('boom')
    return { audio: new TextEncoder().encode(text), durationMs: [...text].length * 100, format: 'wav' }
  }
  const queue = new SpeechQueue(synth, {
    sentence: (uid, seq, text, audio) => events.push(`${uid}#${seq} ${text}${audio === undefined ? ' (no audio)' : ` ${audio.durationMs}ms`}`),
    end: uid => events.push(`${uid} end`),
  })
  return { queue, events }
}

test('sentences come out in order, each reply ends after its last sentence', async () => {
  const { queue, events } = recorder()
  queue.say('a', 0, '你好。')
  queue.say('a', 1, '今天下雨。')
  queue.end('a')
  queue.say('b', 0, '嗯。')
  queue.end('b')
  await queue.idle()
  assert.deepEqual(events, ['a#0 你好。 300ms', 'a#1 今天下雨。 500ms', 'a end', 'b#0 嗯。 200ms', 'b end'])
})

test('a cancelled reply stops at once, including the sentence being synthesized', async () => {
  const { queue, events } = recorder(20)
  queue.say('a', 0, '第一句。')
  queue.say('a', 1, '第二句。')
  queue.end('a')
  await new Promise(resolve => setTimeout(resolve, 5))
  queue.cancel('a')
  queue.say('a', 2, '取消之后来的。')
  queue.say('b', 0, '新的回复。')
  queue.end('b')
  await queue.idle()
  assert.deepEqual(events, ['b#0 新的回复。 500ms', 'b end'])
})

test('a sentence that fails to synthesize still shows, without audio', async () => {
  const { queue, events } = recorder(1, '坏句子。')
  queue.say('a', 0, '坏句子。')
  queue.say('a', 1, '好句子。')
  queue.end('a')
  await queue.idle()
  assert.deepEqual(events, ['a#0 坏句子。 (no audio)', 'a#1 好句子。 400ms', 'a end'])
})

test('the next sentences are synthesized at the same time, and still come out in order', async () => {
  let running = 0
  let most = 0
  const events: string[] = []
  // Later sentences finish first: order must come from the queue, not from the service.
  const synth = async (text: string): Promise<Synthesized | undefined> => {
    most = Math.max(most, ++running)
    await new Promise(resolve => setTimeout(resolve, 60 - [...text].length * 10))
    running--
    return { audio: new Uint8Array(1), durationMs: 100, format: 'mp3' }
  }
  const queue = new SpeechQueue(synth, { sentence: (uid, seq, text) => events.push(`${uid}#${seq} ${text}`), end: uid => events.push(`${uid} end`) })
  const started = Date.now()
  for (const [seq, text] of ['一。', '二二。', '三三三。', '四四四四。'].entries()) queue.say('a', seq, text)
  queue.end('a')
  await queue.idle()
  assert.deepEqual(events, ['a#0 一。', 'a#1 二二。', 'a#2 三三三。', 'a#3 四四四四。', 'a end'])
  assert.equal(most, 3, 'three at a time')
  assert.ok(Date.now() - started < 140, `took ${Date.now() - started} ms`)
})

test('heard text: whole sentences before the cut, and the played share of the cut one', () => {
  const sent = [
    { seq: 0, text: '你回来啦。', durationMs: 1000 },
    { seq: 1, text: '今天外面下大雨。', durationMs: 2000 },
  ]
  assert.equal(heardText(sent, 1, 1000), '你回来啦。今天外面')
  assert.equal(heardText(sent, 0, 0), '')
  assert.equal(heardText(sent, 1, 99999), '你回来啦。今天外面下大雨。')
})
