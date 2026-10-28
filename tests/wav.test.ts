import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeWav, encodeWav } from '../src/core/wav.ts'

test('a WAV round-trips its sample rate and samples within PCM16 precision', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25])
  const wav = encodeWav(samples, 24000)
  assert.equal(wav.byteLength, 44 + samples.length * 2)
  const decoded = decodeWav(wav)
  assert.equal(decoded.sampleRate, 24000)
  assert.equal(decoded.samples.length, samples.length)
  decoded.samples.forEach((s, i) => assert.ok(Math.abs(s - samples[i]!) < 1e-3, `sample ${i}: ${s}`))
})

test('out-of-range samples are clipped instead of wrapping', () => {
  const decoded = decodeWav(encodeWav(new Float32Array([2, -2]), 16000))
  assert.ok(decoded.samples[0]! > 0.99)
  assert.ok(decoded.samples[1]! < -0.99)
})

test('anything that is not a WAV is rejected', () => {
  assert.throws(() => decodeWav(new TextEncoder().encode('definitely not audio, just text')), /not a WAV/)
})
