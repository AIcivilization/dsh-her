import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { BrainServer, type Discovery } from '../src/server/brain-server.ts'
import { encodeAudioFrame, PROTOCOL_VERSION, type BodyMessage, type BrainMessage, type Hello } from '../src/protocol/index.ts'

function hello(token: string, v = PROTOCOL_VERSION): Hello {
  return {
    t: 'hello', v, token,
    body: { kind: 'video', app: 'test', version: '0', os: 'test' },
    caps: { audioOut: ['wav'], asrLocal: false, ttsLocal: [], modes: ['overlay'], screens: [] },
    packs: [],
  }
}

function setup(preferredPort?: number) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-her-brain-'))
  const received: BodyMessage[] = []
  const server = new BrainServer({
    tokenFile: join(home, 'token'),
    discoveryFile: join(home, 'brain.json'),
    ...(preferredPort === undefined ? {} : { preferredPort }),
    welcome: () => ({ t: 'welcome', v: PROTOCOL_VERSION, sessionId: 's', characters: [], config: { mic: 'push-to-talk', bargeIn: true } }),
    message: (_client, message) => { received.push(message) },
  })
  return { home, server, received }
}

/** Connect, send hello, and collect what the brain answers. */
async function connect(url: string, first: Hello) {
  const socket = new WebSocket(url)
  const inbox: BrainMessage[] = []
  const closed = new Promise<number>(resolve => socket.on('close', code => resolve(code)))
  socket.on('message', data => inbox.push(JSON.parse(data.toString()) as BrainMessage))
  await new Promise(resolve => socket.on('open', resolve))
  socket.send(JSON.stringify(first))
  const next = async (): Promise<BrainMessage> => {
    for (let i = 0; i < 100 && inbox.length === 0; i++) await new Promise(r => setTimeout(r, 10))
    const message = inbox.shift()
    if (message === undefined) throw new Error('no message')
    return message
  }
  return { socket, next, closed }
}

test('a body with the right token is welcomed and can talk', async () => {
  const { server, received } = setup(0)
  const discovery = await server.start()
  try {
    const body = await connect(discovery.url, hello(discovery.token))
    assert.equal((await body.next()).t, 'welcome')
    body.socket.send(JSON.stringify({ t: 'ping', at: 42 }))
    assert.deepEqual(await body.next(), { t: 'pong', at: 42 })
    body.socket.send(JSON.stringify({ t: 'user.text', text: '你好' }))
    for (let i = 0; i < 100 && received.length === 0; i++) await new Promise(r => setTimeout(r, 10))
    assert.deepEqual(received, [{ t: 'user.text', text: '你好' }])
    assert.equal(server.bodies.length, 1)
    body.socket.close()
  } finally {
    await server.stop()
  }
})

test('a wrong token or protocol version is rejected and the socket closed', async () => {
  const { server } = setup(0)
  const discovery = await server.start()
  try {
    const stranger = await connect(discovery.url, hello('x'.repeat(43)))
    assert.deepEqual((await stranger.next()).t, 'reject')
    assert.equal(await stranger.closed, 4003)
    const old = await connect(discovery.url, hello(discovery.token, PROTOCOL_VERSION + 1))
    const reject = await old.next()
    assert.equal(reject.t === 'reject' && reject.reason, 'version')
    assert.equal(await old.closed, 4004)
    assert.equal(server.bodies.length, 0)
  } finally {
    await server.stop()
  }
})

test('the discovery file is private, names the brain, and is removed on stop', async () => {
  const { home, server } = setup(0)
  const discovery = await server.start()
  const file = join(home, 'brain.json')
  const written = JSON.parse(readFileSync(file, 'utf8')) as Discovery
  assert.equal(written.url, discovery.url)
  assert.equal(written.pid, process.pid)
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600)
  await server.stop()
  assert.equal(existsSync(file), false)
})

test('the token survives restarts; a taken port moves the brain to the next one', async () => {
  const blocker = createServer()
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve))
  const taken = (blocker.address() as { port: number }).port
  const { home, server } = setup(taken)
  try {
    const first = await server.start()
    assert.notEqual(server.port, taken)
    await server.stop()
    const again = new BrainServer({
      tokenFile: join(home, 'token'), discoveryFile: join(home, 'brain.json'), preferredPort: 0,
      welcome: () => ({ t: 'pong', at: 0 }), message: () => {},
    })
    const second = await again.start()
    assert.equal(second.token, first.token)
    await again.stop()
  } finally {
    blocker.close()
  }
})

test('audio frames are paired with the message that names their stream, both ways', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-her-brain-'))
  const heard: Array<{ message: BodyMessage; audio: number[] | undefined }> = []
  const server = new BrainServer({
    tokenFile: join(home, 'token'), discoveryFile: join(home, 'brain.json'), preferredPort: 0,
    welcome: () => ({ t: 'welcome', v: PROTOCOL_VERSION, sessionId: 's', characters: [], config: { mic: 'push-to-talk', bargeIn: true } }),
    message: (_client, message, audio) => { heard.push({ message, audio: audio === undefined ? undefined : [...audio] }) },
  })
  const discovery = await server.start()
  try {
    const socket = new WebSocket(discovery.url)
    const frames: Array<string | number[]> = []
    socket.on('message', (data, isBinary) => frames.push(isBinary ? [...(data as Buffer)] : data.toString()))
    await new Promise(resolve => socket.on('open', resolve))
    socket.send(JSON.stringify(hello(discovery.token)))
    for (let i = 0; i < 100 && frames.length === 0; i++) await new Promise(r => setTimeout(r, 10))
    socket.send(encodeAudioFrame(7, new Uint8Array([1, 2, 3])))
    socket.send(JSON.stringify({ t: 'user.utterance', uttId: 'u1', format: 'pcm16@16k', durationMs: 100, stream: 7 }))
    socket.send(JSON.stringify({ t: 'user.utterance', uttId: 'u2', format: 'pcm16@16k', durationMs: 100, stream: 8 }))
    for (let i = 0; i < 100 && heard.length < 2; i++) await new Promise(r => setTimeout(r, 10))
    assert.deepEqual(heard[0]!.audio, [1, 2, 3])
    assert.equal(heard[1]!.audio, undefined)
    server.broadcastWithAudio({ t: 'speak.seg', cid: 'c', uid: 'r', seq: 0, text: '嗯。', durationMs: 300, format: 'wav', stream: 5 }, 5, new Uint8Array([9]))
    for (let i = 0; i < 100 && frames.length < 3; i++) await new Promise(r => setTimeout(r, 10))
    assert.deepEqual(frames[1], [0, 0, 0, 5, 9])
    assert.equal(JSON.parse(frames[2] as string).t, 'speak.seg')
    socket.close()
  } finally {
    await server.stop()
  }
})
