import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Autoloop } from '../src/standalone/autoloop.ts'

/** A stand-in agent-autoloop: `init` writes a config for a port, `up` answers /healthz there. */
function fakeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'fake-autoloop-'))
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, '.pinned.json'), JSON.stringify({ tag: 'v9.9.9', commit: 'abc' }))
  writeFileSync(join(root, 'bin', 'agent-autoloop.ts'), `
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
const home = process.env.AGENT_AUTOLOOP_HOME
const [command, ...args] = process.argv.slice(2)
if (command === 'init') {
  const port = args[args.indexOf('--port') + 1]
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.json'), JSON.stringify({ url: 'http://127.0.0.1:' + port, owner: 'owner-key', release: process.env.AGENT_AUTOLOOP_RELEASE }))
} else if (command === 'up') {
  const { url } = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))
  writeFileSync(join(home, 'up.pid'), String(process.pid))
  createServer((req, res) => res.end(JSON.stringify({ ok: true }))).listen(Number(new URL(url).port), '127.0.0.1')
}
`)
  return root
}

/** Someone's own hub, answering /healthz, with its config in `<userHome>/.agent-autoloop`. */
async function theirs(userHome: string): Promise<Server> {
  const server = createServer((_req, res) => res.end(JSON.stringify({ ok: true })))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  mkdirSync(join(userHome, '.agent-autoloop'), { recursive: true })
  writeFileSync(join(userHome, '.agent-autoloop', 'config.json'), JSON.stringify({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, owner: 'their-owner' }))
  return server
}

const make = (home: string, userHome: string, root = fakeRoot()) => new Autoloop({ home, root, node: process.execPath, userHome })

test("ours, when there is no other: set up in her own folder on a port of its own, started, and stopped", async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-loop-'))
  const loop = make(home, mkdtempSync(join(tmpdir(), 'user-')))
  try {
    const state = await loop.start()
    assert.equal(state.kind, 'bundled')
    assert.ok(state.kind === 'bundled' && state.running && state.version === 'v9.9.9' && !state.ownAppeared)
    const config = JSON.parse(readFileSync(join(home, 'autoloop', 'config.json'), 'utf8')) as { url: string; release: string }
    assert.match(config.url, /^http:\/\/127\.0\.0\.1:\d+$/, 'this computer only')
    assert.equal(config.release, 'v9.9.9', 'it knows which release it is')
    assert.deepEqual(await loop.ownerAccess(), { url: config.url, key: 'owner-key' })
    await loop.stop()
    assert.equal((loop.state() as { running: boolean }).running, false)
  } finally {
    await loop.stop()
  }
})

test("theirs, when they have one and ours was never set up: connected to, nothing of ours runs", async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-loop-'))
  const userHome = mkdtempSync(join(tmpdir(), 'user-'))
  const server = await theirs(userHome)
  const loop = make(home, userHome)
  try {
    const state = await loop.start()
    assert.equal(state.kind, 'own')
    assert.deepEqual((await loop.ownerAccess())?.key, 'their-owner')
    assert.throws(() => readFileSync(join(home, 'autoloop', 'config.json')), 'nothing of ours is set up')
  } finally {
    await loop.stop()
    server.close()
  }
})

test("theirs appears after ours was in use: asked once, not switched; the answer is kept", async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-loop-'))
  const userHome = mkdtempSync(join(tmpdir(), 'user-'))
  const root = fakeRoot()
  const loop = make(home, userHome, root)
  let server: Server | undefined
  try {
    assert.equal((await loop.start()).kind, 'bundled')
    await loop.stop()
    server = await theirs(userHome)
    const again = await loop.start()
    assert.ok(again.kind === 'bundled' && again.ownAppeared, 'she asks; she does not switch by herself')
    const chosen = await loop.choose('own')
    assert.equal(chosen.kind, 'own')
    const later = make(home, userHome, root)
    assert.equal((await later.start()).kind, 'own', 'the answer stays')
    const back = await later.choose('bundled')
    assert.ok(back.kind === 'bundled' && back.running && !back.ownAppeared, 'kept ours: not asked again')
    await later.stop()
  } finally {
    await loop.stop()
    server?.close()
  }
})

test('ours stops by itself: started again', async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-loop-'))
  const loop = make(home, mkdtempSync(join(tmpdir(), 'user-')))
  try {
    await loop.start()
    const pid = Number(readFileSync(join(home, 'autoloop', 'up.pid'), 'utf8'))
    process.kill(pid)
    let next = pid
    for (let i = 0; i < 60 && next === pid; i++) {
      await new Promise(r => setTimeout(r, 100))
      try { next = Number(readFileSync(join(home, 'autoloop', 'up.pid'), 'utf8')) } catch { /* being written */ }
    }
    assert.notEqual(next, pid)
  } finally {
    await loop.stop()
  }
})

test('no agent-autoloop in this build: said so', async () => {
  const loop = new Autoloop({ home: mkdtempSync(join(tmpdir(), 'her-loop-')), root: mkdtempSync(join(tmpdir(), 'empty-')), node: process.execPath, userHome: mkdtempSync(join(tmpdir(), 'user-')) })
  const state = await loop.start()
  assert.deepEqual(state, { kind: 'none', why: '这一版没有带上 agent-autoloop' })
})
