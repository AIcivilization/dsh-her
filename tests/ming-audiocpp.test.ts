import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeWav, encodeWav } from '../src/core/index.ts'
import { AUDIOCPP_BUILDS, AUDIOCPP_VERSION, MING_GGUF } from '../src/voice/audiocpp-release.ts'
import { audiocppInfo, cpuThreads, hasNvidia, ming3Instruction, pickFastest, replyError, serverConfig, SLOW_MS, speechBody } from '../src/voice/ming-audiocpp.ts'
import { mingEngine, mingUnsupported } from '../src/voice/ming.ts'

test('which program runs Ming: MLX on Apple chips with macOS 14, audio.cpp on other x64 computers', () => {
  assert.deepEqual(mingEngine('darwin', 'arm64', '25.2.0', undefined), { engine: 'mlx' })
  assert.deepEqual(mingEngine('darwin', 'arm64', '25.2.0', 'audiocpp'), { engine: 'audiocpp' })
  assert.deepEqual(mingEngine('darwin', 'arm64', '22.6.0', undefined), { engine: 'audiocpp' })
  assert.deepEqual(mingEngine('darwin', 'x64', '25.2.0', undefined), { engine: 'audiocpp' })
  assert.deepEqual(mingEngine('win32', 'x64', '10.0.22631', undefined), { engine: 'audiocpp' })
  assert.deepEqual(mingEngine('linux', 'x64', '6.8.0', undefined), { engine: 'audiocpp' })
  assert.match(mingUnsupported('win32', 'arm64', '10.0')!, /ARM/)
  assert.match(mingUnsupported('linux', 'arm64', '6.8.0')!, /ARM/)
  assert.equal(mingUnsupported('win32', 'x64', '10.0'), undefined)
})

test('every build is pinned: this version, a size and a SHA-256; one main build per computer', () => {
  for (const [key, builds] of Object.entries(AUDIOCPP_BUILDS)) {
    assert.equal(builds.filter(b => b.kind === 'main').length, 1, key)
    for (const build of builds) {
      assert.ok(build.backends.length > 0)
      for (const p of build.packages) {
        assert.ok(p.file.startsWith(`audio-${AUDIOCPP_VERSION}-`), p.file)
        assert.match(p.sha256, /^[0-9a-f]{64}$/)
        assert.ok(p.size > 1_000_000)
      }
    }
  }
  // CUDA comes with its runtime; the main builds run on the GPU and the CPU.
  assert.equal(AUDIOCPP_BUILDS['win32-x64']!.find(b => b.kind === 'cuda')!.packages.length, 2)
  assert.deepEqual(AUDIOCPP_BUILDS['win32-x64']!.find(b => b.kind === 'main')!.backends, ['vulkan', 'cpu'])
  assert.match(MING_GGUF.sha256, /^[0-9a-f]{64}$/)
  assert.ok(MING_GGUF.sources.every(s => s.endsWith('/')))
})

test('the self-check keeps the fastest backend that spoke', () => {
  const results = [
    { build: 'w-vulkan', backend: 'vulkan' as const, ms: 900 },
    { build: 'w-vulkan', backend: 'cpu' as const, ms: 4200 },
    { build: 'w-cuda', backend: 'cuda' as const, error: 'driver too old' },
  ]
  assert.deepEqual(pickFastest(results), results[0])
  assert.equal(pickFastest([{ build: 'w', backend: 'cpu', error: 'x' }]), undefined)
  assert.equal(pickFastest([]), undefined)

  const choice = { version: AUDIOCPP_VERSION, build: 'w-vulkan', backend: 'vulkan' as const, ms: 900, results, at: '' }
  const info = audiocppInfo(choice, 'available', 854_645_866)
  assert.deepEqual(info.chosen, { build: 'w-vulkan', backend: 'vulkan', label: '显卡（Vulkan）', ms: 900 })
  assert.equal(info.slow, false)
  assert.equal(info.cudaMB, 855)
  assert.equal(info.results[2]!.label, 'NVIDIA 显卡（CUDA）')
  assert.equal(audiocppInfo({ ...choice, backend: 'cpu', ms: SLOW_MS + 1 }, 'none').slow, true)
  assert.deepEqual(audiocppInfo(undefined, 'none').results, [])
})

test('CPU threads: all of a small CPU, two left over on a bigger one, at most 8', () => {
  assert.equal(cpuThreads(1), 1)
  assert.equal(cpuThreads(4), 4)
  assert.equal(cpuThreads(8), 6)
  assert.equal(cpuThreads(32), 8)
})

test('the mood caption is the one Ming was trained on (mlx-audio ming3_instruction)', () => {
  // json.dumps({"audio_sequence": [...]}, ensure_ascii=False) from mlx-audio 0.6.3.
  assert.equal(
    ming3Instruction({ emotion: '高兴', ip: '灵小芸' }),
    '{"audio_sequence": [{"序号": 1, "说话人": "speaker_1", "方言": null, "风格": null, "语速": null, "基频": null, "音量": null, "情感": "高兴", "BGM": {"Genre": null, "Mood": null, "Instrument": null, "Theme": null, "ENV": null, "SNR": null}, "IP": "灵小芸"}]}',
  )
  // Commas and colons inside values stay as they are.
  assert.match(ming3Instruction({ speed: '慢速', ip: 'a,b:c' }), /"语速": "慢速".*"IP": "a,b:c"/)
})

test('a sentence as audio.cpp asks for it: built-in voice, own voice, design', () => {
  const builtIn = speechBody({ text: '你好。', voice: '灵风信_高兴', steps: 10 })
  assert.equal(builtIn.model, 'ming')
  assert.equal(builtIn.input, '你好。')
  assert.equal(builtIn.response_format, 'wav')
  const builtInOptions = builtIn.options as Record<string, unknown>
  assert.equal(builtInOptions.template_name, 'freeform')
  assert.equal(builtInOptions.zero_speaker_embedding, true)
  assert.equal(builtInOptions.language, 'zh')
  assert.match(String(builtInOptions.instruct), /"IP": "灵风信_高兴"/)

  const moody = speechBody({ text: '你好。', voice: '灵梦', emotion: '悲伤', speed: '慢速', steps: 10 })
  assert.match(String((moody.options as Record<string, unknown>).instruct), /"语速": "慢速".*"情感": "悲伤".*"IP": "灵梦"/)

  const own = speechBody({ text: '你好。', ref: { wav: 'C:\\voices\\v1.wav', text: '今天天气不错' }, steps: 10 })
  assert.deepEqual(own.voice_ref, { type: 'path', path: 'C:\\voices\\v1.wav' })
  assert.equal(own.reference_text, '今天天气不错')
  assert.equal((own.options as Record<string, unknown>).instruct, undefined)
  const ownMoody = speechBody({ text: '你好。', ref: { wav: '/v.wav', text: '嗯' }, emotion: '高兴', steps: 10 })
  assert.match(String((ownMoody.options as Record<string, unknown>).instruct), /"情感": "高兴".*"IP": null/)

  const design = speechBody({ text: '你好。', design: '温柔的女声', steps: 10, seed: 22 })
  assert.equal(design.seed, 22)
  assert.deepEqual(design.options, { language: 'zh', template_name: 'freeform', instruct: '温柔的女声', zero_speaker_embedding: true })

  assert.throws(() => speechBody({ text: '你好。', steps: 10 }), /声音/)
})

test('server configuration: this model alone, loaded at start, local only', () => {
  const config = serverConfig({ port: 50123, backend: 'vulkan', threads: 6, model: 'C:\\m\\ming.gguf' })
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.port, 50123)
  assert.equal(config.backend, 'vulkan')
  assert.equal(config.lazy_load, false)
  assert.deepEqual(config.models, [{ id: 'ming', family: 'ming3_tts', path: 'C:\\m\\ming.gguf', task: 'tts', mode: 'offline' }])
})

test('a failed reply says what the server said', () => {
  assert.equal(replyError(400, '{"error":{"message":"unsupported Ming template_name: x","type":"invalid_request_error"}}'), '本机 Ming 出错（HTTP 400）：unsupported Ming template_name: x')
  assert.equal(replyError(500, '{"error":"model failed"}'), '本机 Ming 出错（HTTP 500）：model failed')
  assert.equal(replyError(503, 'busy'), '本机 Ming 出错（HTTP 503）：busy')
  assert.equal(replyError(502, ''), '本机 Ming 出错（HTTP 502）')
})

test('NVIDIA: its tool on Windows, its kernel module on Linux', () => {
  assert.equal(hasNvidia('win32', p => p.endsWith('nvidia-smi.exe')), true)
  assert.equal(hasNvidia('win32', () => false), false)
  assert.equal(hasNvidia('linux', p => p === '/proc/driver/nvidia/version'), true)
  assert.equal(hasNvidia('darwin', () => true), false)
})

test('WAV from a voice engine: 32-bit float and stereo are read too', () => {
  const rate = 44_100
  const float = new Uint8Array(44 + 4 * 2 * 2)
  const view = new DataView(float.buffer)
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF'); view.setUint32(4, float.byteLength - 8, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 2, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true)
  // An unfilled size (a stream): read to the end.
  ascii(36, 'data'); view.setUint32(40, 0xffffffff, true)
  view.setFloat32(44, 0.5, true); view.setFloat32(48, -1, true); view.setFloat32(52, -0.25, true); view.setFloat32(56, 1, true)
  const decoded = decodeWav(float)
  assert.equal(decoded.sampleRate, rate)
  assert.deepEqual([...decoded.samples], [0.5, -0.25])

  const round = decodeWav(encodeWav(new Float32Array([0, 0.5, -0.5]), 16_000))
  assert.equal(round.samples.length, 3)
  assert.ok(Math.abs(round.samples[1]! - 0.5) < 1e-3)
  assert.throws(() => decodeWav(new Uint8Array(4)), /not a WAV/)
})
