import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { decodeWav } from '../src/core/index.ts'
import { CloudAccountError, CosyVoice } from '../src/voice/cosyvoice.ts'

/** A stand-in for the CosyVoice WebSocket API: 2 bytes of PCM per character of text. */
async function fakeCloud(options: { key?: string; dropAfterTasks?: number; failText?: string } = {}) {
  const key = options.key ?? 'good'
  const seen = { connections: 0, tasks: [] as Array<{ voice: string; rate: number; text: string }> }
  const server = new WebSocketServer({
    port: 0,
    verifyClient: (info, done) => done(info.req.headers.authorization === `bearer ${key}`, 401),
  })
  server.on('connection', (socket: WebSocket) => {
    seen.connections++
    let params: { voice: string; rate: number } | undefined
    socket.on('message', (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as { header: { action: string; task_id: string }; payload: { parameters?: { voice: string; rate: number }; input?: { text?: string } } }
      const id = message.header.task_id
      const send = (event: string, extra: Record<string, string> = {}) => socket.send(JSON.stringify({ header: { event, task_id: id, ...extra }, payload: {} }))
      if (message.header.action === 'run-task') {
        params = message.payload.parameters
        send('task-started')
      } else if (message.header.action === 'continue-task') {
        const text = message.payload.input?.text ?? ''
        seen.tasks.push({ voice: params!.voice, rate: params!.rate, text })
        if (text === options.failText) return send('task-failed', { error_code: 'InvalidParameter', error_message: 'bad text' })
        socket.send(Buffer.alloc([...text].length * 2, 1))
      } else if (message.header.action === 'finish-task') {
        if (seen.tasks.at(-1)?.text === options.failText) return
        send('task-finished')
        if (options.dropAfterTasks !== undefined && seen.tasks.length === options.dropAfterTasks) socket.close()
      }
    })
  })
  await new Promise(resolve => server.once('listening', resolve))
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, seen, close: () => new Promise(resolve => server.close(resolve)) }
}

test('sentences go out in order on one connection, as WAV of the right length', async () => {
  const cloud = await fakeCloud()
  const voice = new CosyVoice('cosyvoice-v3-flash', async () => 'good', [cloud.url])
  const [a, b] = await Promise.all([voice.synthesize('你好呀。', 'longanrou_v3', 1), voice.synthesize('嗯。', 'longxing_v3', 1.2)])
  assert.deepEqual(cloud.seen.tasks, [{ voice: 'longanrou_v3', rate: 1, text: '你好呀。' }, { voice: 'longxing_v3', rate: 1.2, text: '嗯。' }])
  assert.equal(cloud.seen.connections, 1)
  assert.equal(decodeWav(a.audio).samples.length, 4)
  assert.equal(decodeWav(b.audio).sampleRate, 24000)
  voice.close()
  await cloud.close()
})

test('no key, or a refused one, is a CloudAccountError', async () => {
  const cloud = await fakeCloud()
  await assert.rejects(new CosyVoice('m', async () => undefined, [cloud.url]).synthesize('嗯。', 'v', 1), CloudAccountError)
  await assert.rejects(new CosyVoice('m', async () => 'wrong', [cloud.url]).synthesize('嗯。', 'v', 1), CloudAccountError)
  await cloud.close()
})

test('a connection the server closed is replaced, and a failed task does not block the next', async () => {
  const cloud = await fakeCloud({ dropAfterTasks: 1, failText: '坏' })
  const voice = new CosyVoice('m', async () => 'good', [cloud.url])
  await voice.synthesize('一。', 'v', 1)
  await new Promise(resolve => setTimeout(resolve, 50))
  await voice.synthesize('二。', 'v', 1)
  assert.equal(cloud.seen.connections, 2)
  await assert.rejects(voice.synthesize('坏', 'v', 1), /bad text/)
  assert.equal(cloud.seen.tasks.filter(t => t.text === '坏').length, 1, 'a refused sentence is not retried')
  const after = await voice.synthesize('三。', 'v', 1)
  assert.equal(decodeWav(after.audio).samples.length, 2)
  voice.close()
  await cloud.close()
})

test('a key refused by one region is tried on the other, which is then kept', async () => {
  const mainland = await fakeCloud({ key: 'cn-key' })
  const intl = await fakeCloud({ key: 'intl-key' })
  const voice = new CosyVoice('m', async () => 'intl-key', [mainland.url, intl.url])
  await voice.synthesize('一。', 'v', 1)
  voice.close()
  await voice.synthesize('二。', 'v', 1)
  assert.equal(intl.seen.tasks.length, 2)
  assert.equal(mainland.seen.connections, 0)
  voice.close()
  await mainland.close()
  await intl.close()
})
