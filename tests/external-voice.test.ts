import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { cleanVoices, ExternalVoices, parseExtVoice, xfyunUrl } from '../src/voice/external.ts'
import { Secrets } from '../src/voice/secrets.ts'
import { encodeWav } from '../src/core/wav.ts'

test('讯飞 signed address: the signature is HMAC-SHA256 over host, date and request line', () => {
  const date = 'Tue, 10 Nov 2026 12:00:00 GMT'
  const url = new URL(xfyunUrl('tts-api.xfyun.cn', '/v2/tts', 'key123', 'secret456', date).replace('wss:', 'https:'))
  assert.equal(url.host, 'tts-api.xfyun.cn')
  assert.equal(url.searchParams.get('date'), date)
  assert.equal(url.searchParams.get('host'), 'tts-api.xfyun.cn')
  const auth = Buffer.from(url.searchParams.get('authorization')!, 'base64').toString()
  const signature = createHmac('sha256', 'secret456').update(`host: tts-api.xfyun.cn\ndate: ${date}\nGET /v2/tts HTTP/1.1`).digest('base64')
  assert.equal(auth, `api_key="key123", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`)
})

test('the settings keep only what makes sense', () => {
  const clean = cleanVoices({
    providers: [
      { id: 'xf', kind: 'xfyun', name: '讯飞', appId: 'abc' },
      { id: 'xf', kind: 'openai', name: '重复' },
      { id: 'bad id', kind: 'openai' },
      { id: 'local', kind: 'openai', baseUrl: 'http://127.0.0.1:9000/v1/', model: 'tts-1' },
      { id: 'w', kind: 'sovits', baseUrl: 'javascript:alert(1)' },
      { id: 'q', kind: 'nope' },
    ],
    listen: 'missing',
  })
  assert.deepEqual(clean.providers.map(p => p.id), ['xf', 'local', 'w'])
  assert.equal(clean.providers[1]!.baseUrl, 'http://127.0.0.1:9000/v1')
  assert.equal(clean.providers[2]!.baseUrl, undefined)
  assert.equal(clean.listen, undefined)
  assert.deepEqual(parseExtVoice('ext:xf:x4_lingxiaolu'), { provider: 'xf', voice: 'x4_lingxiaolu' })
  assert.equal(parseExtVoice('zh-CN-XiaoxiaoNeural'), undefined)
})

test('keys outside macOS: a file only you can read', async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-sec-'))
  const secrets = new Secrets(home, false)
  await secrets.set('xf.apiKey', 'k-1')
  assert.equal(await secrets.get('xf.apiKey'), 'k-1')
  // Windows has no such permission bits; the file is in your own profile there.
  if (process.platform !== 'win32') assert.equal(statSync(join(home, 'secrets.json')).mode & 0o777, 0o600)
  await secrets.set('xf.apiKey', '')
  assert.equal(await secrets.has('xf.apiKey'), false)
  await assert.rejects(secrets.set('a', 'x\ny'), /换行/)
})

test('an OpenAI-style service and a GPT-SoVITS server speak and listen; a plugin can give a voice', async () => {
  const wav = encodeWav(new Float32Array(8000), 16000)
  const seen: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''} ${body.slice(0, 80)}`)
      if (req.url?.startsWith('/v1/audio/transcriptions')) return res.end(JSON.stringify({ text: ' 你好 ' }))
      res.end(Buffer.from(wav))
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const home = mkdtempSync(join(tmpdir(), 'her-ext-'))
  const secrets = new Secrets(home, false)
  const voices = new ExternalVoices(home, secrets)
  voices.save({ providers: [
    { id: 'oa', kind: 'openai', name: '本地', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'tts-x' },
    { id: 'sv', kind: 'sovits', name: '我的', baseUrl: `http://127.0.0.1:${port}`, refAudio: '/ref.wav', promptText: '你好呀' },
  ], listen: 'oa' })
  await secrets.set('oa.apiKey', 'sk-test')
  const a = await voices.synthesize('ext:oa:nova', '你好', 1.2)
  assert.equal(a.durationMs, 500)
  assert.match(seen[0]!, /^POST \/v1\/audio\/speech Bearer sk-test .*"model":"tts-x".*"voice":"nova"/)
  const b = await voices.synthesize('ext:sv:', '你好', 1)
  assert.equal(b.durationMs, 500)
  assert.match(seen[1]!, /^GET \/tts\?text=%E4%BD%A0%E5%A5%BD.*ref_audio_path=%2Fref\.wav/)
  assert.equal(await voices.recognize(new Uint8Array(3200), 16000), '你好')
  const off = voices.register({ id: 'pl', name: '插件', synthesize: async () => ({ audio: wav, format: 'wav' }) })
  assert.ok(voices.providers().some(p => p.id === 'pl' && p.kind === 'plugin'))
  assert.equal((await voices.synthesize('ext:pl:any', 'x', 1)).durationMs, 500)
  off()
  await assert.rejects(voices.synthesize('ext:pl:any', 'x', 1), /没有这个语音服务/)
  server.close()
})
