import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wavFromPcm16 } from '../src/core/index.ts'
import { defaultIdleMinutes, mingUnsupported } from '../src/voice/ming.ts'
import { OwnVoices, trimSilence } from '../src/voice/ming-voices.ts'

test('Ming runs on Macs and on x64 Windows and Linux', () => {
  assert.equal(mingUnsupported('darwin', 'arm64', '25.2.0'), undefined)
  assert.equal(mingUnsupported('darwin', 'arm64', '22.6.0'), undefined)
  assert.equal(mingUnsupported('darwin', 'x64', '25.2.0'), undefined)
  assert.equal(mingUnsupported('win32', 'x64', '10.0'), undefined)
  assert.match(mingUnsupported('win32', 'arm64', '10.0')!, /暂不支持/)
  assert.equal(defaultIdleMinutes(16 * 2 ** 30), 10)
  assert.equal(defaultIdleMinutes(32 * 2 ** 30), 30)
})

test('own voices: a design is kept as is; a clone needs consent and its words', () => {
  const dir = mkdtempSync(join(tmpdir(), 'her-ming-'))
  try {
    const own = new OwnVoices(dir)
    const wav = wavFromPcm16(new Uint8Array(44_100 * 2), 44_100)
    const designed = own.addDraft(wav, { kind: 'design', text: '你好呀。', description: '温柔的女声' })
    const voice = own.keep(designed, '温柔')
    assert.deepEqual([voice.kind, voice.text, voice.description], ['design', '你好呀。', '温柔的女声'])
    assert.equal(own.ref(voice.id)?.text, '你好呀。')

    const cloned = own.addDraft(wav, { kind: 'clone', text: '今天天汽不错' })
    assert.throws(() => own.keep(cloned, '我'), /本人/)
    assert.throws(() => own.keep(cloned, '我', { consent: true, text: ' ' }), /说的话/)
    const mine = own.keep(cloned, '我', { consent: true, text: '今天天气不错' })
    assert.equal(own.ref(mine.id)?.text, '今天天气不错')
    assert.deepEqual(own.list().map(v => v.name), ['温柔', '我'])

    own.remove(mine.id)
    assert.equal(own.ref(mine.id), undefined)
    assert.ok(!existsSync(join(dir, `${mine.id}.wav`)))
    assert.throws(() => own.keep('../../etc/passwd', 'x'), /找不到/)

    assert.deepEqual(own.settings(), { quality: 'quality', moods: true })
    own.saveSettings({ quality: 'speed', idleMinutes: 0 })
    assert.deepEqual(own.settings(), { quality: 'speed', moods: true, idleMinutes: 0 })
    own.saveSettings({ idleMinutes: undefined })
    assert.equal(own.settings().idleMinutes, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a recording loses its quiet ends', () => {
  const rate = 1000
  const samples = new Int16Array(3 * rate)
  for (let i = rate; i < 2 * rate; i++) samples[i] = i % 2 === 0 ? 8000 : -8000
  const trimmed = trimSilence(samples, rate)
  assert.ok(trimmed.length >= rate && trimmed.length <= rate + 2 * (rate / 10) + rate / 100, String(trimmed.length))
})
