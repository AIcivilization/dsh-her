import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeAudioFrame, encodeAudioFrame, parseMessage } from '../src/protocol/index.ts'

test('parseMessage keeps any message with a type and rejects the rest', () => {
  assert.deepEqual(parseMessage('{"t":"user.text","text":"你好"}'), { t: 'user.text', text: '你好' })
  assert.deepEqual(parseMessage('{"t":"from.the.future","x":1}'), { t: 'from.the.future', x: 1 })
  assert.equal(parseMessage('{"text":"no type"}'), undefined)
  assert.equal(parseMessage('{"t":""}'), undefined)
  assert.equal(parseMessage('[1,2]'), undefined)
  assert.equal(parseMessage('not json'), undefined)
})

test('audio frames round-trip their stream id and payload', () => {
  const payload = new Uint8Array([1, 2, 3, 250])
  const frame = encodeAudioFrame(0xabcdef01, payload)
  assert.equal(frame.byteLength, 8)
  const decoded = decodeAudioFrame(frame)
  assert.equal(decoded?.stream, 0xabcdef01)
  assert.deepEqual([...decoded!.payload], [1, 2, 3, 250])
})

test('audio frames decode from a view into a larger buffer', () => {
  const backing = new Uint8Array(16)
  backing.set(encodeAudioFrame(7, new Uint8Array([9, 9])), 5)
  const decoded = decodeAudioFrame(backing.subarray(5, 11))
  assert.equal(decoded?.stream, 7)
  assert.deepEqual([...decoded!.payload], [9, 9])
})

test('a frame shorter than its header is rejected', () => {
  assert.equal(decodeAudioFrame(new Uint8Array(3)), undefined)
})
