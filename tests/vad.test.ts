import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EnergyVad, FRAME, SAMPLE_RATE, toPcm16 } from '../body/renderer/vad.ts'

/** Feed `ms` of a tone (speech stand-in) or near-silence, in 128-sample blocks like the worklet. */
function feed(vad: EnergyVad, ms: number, amplitude: number): void {
  const samples = new Float32Array(Math.round((SAMPLE_RATE * ms) / 1000))
  for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin(i / 3) + (Math.random() - 0.5) * 0.002
  for (let i = 0; i < samples.length; i += 128) vad.push(samples.subarray(i, i + 128))
}

function recorder() {
  const events: string[] = []
  let last: Float32Array | undefined
  const vad = new EnergyVad({
    start: () => events.push('start'),
    utterance: samples => { events.push('utterance'); last = samples },
    dropped: () => events.push('dropped'),
  })
  return { vad, events, last: () => last }
}

test('speech between silences is one utterance, with the lead-in kept', () => {
  const { vad, events, last } = recorder()
  feed(vad, 1000, 0)
  feed(vad, 1200, 0.2)
  feed(vad, 1000, 0)
  assert.deepEqual(events, ['start', 'utterance'])
  const ms = (last()!.length / SAMPLE_RATE) * 1000
  // 1.2 s of speech + up to 300 ms lead-in + 200 ms kept silence (frame-rounded).
  assert.ok(ms > 1300 && ms < 1800, `utterance ${ms} ms`)
})

test('a short click is dropped, steady room noise never starts speech', () => {
  const { vad, events } = recorder()
  feed(vad, 1000, 0.003)
  feed(vad, 160, 0.3)
  feed(vad, 1000, 0.003)
  assert.deepEqual(events, ['start', 'dropped'])
  const quiet = recorder()
  feed(quiet.vad, 3000, 0.006)
  assert.deepEqual(quiet.events, [])
})

test('frames are 20 ms and PCM conversion clips', () => {
  assert.equal((FRAME / SAMPLE_RATE) * 1000, 20)
  assert.deepEqual([...toPcm16(new Float32Array([0, 1, -1, 2]))], [0, 32767, -32768, 32767])
})
