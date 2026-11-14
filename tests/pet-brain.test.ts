import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import WebSocket from 'ws'
import { makeZip } from '../src/core/zip.ts'
import { PROTOCOL_VERSION, type BodyMessage, type BrainMessage, type Hello } from '../src/protocol/index.ts'
import { cleanPet, PetBrain } from '../src/standalone/pet-brain.ts'

const bytes = (text: string) => new TextEncoder().encode(text)
const lines = { touch: { head: ['别闹。'], body: ['怎么啦？'], long: ['嗯……'], many: ['好啦好啦。'] }, hello: ['我来啦。'], night: ['去睡吧。'] }
const design = (name = '樱花糖') => makeZip([
  { name: 'design.json', data: bytes(JSON.stringify({
    format: 'dsh-her-design@1', id: 'sakura-sugar', name, version: '1.0.0', author: '某人', license: 'CC BY 4.0',
    character: { name, persona: `你是${name}。`, lines }, stage: 'stage.json', skin: 'skin',
  })) },
  { name: 'stage.json', data: bytes(JSON.stringify({ format: 'dsh-her-stage@1', name, rows: ['desktop'], scenes: [{ id: 'base', name: '初始', cells: { desktop: { use: ['窗边'] } } }] })) },
  { name: 'library/desktop/窗边.mp4', data: bytes('mp4') },
  { name: 'skin/skin.json', data: bytes('{"name":"x"}') },
])

const hello = (token: string): Hello => ({
  t: 'hello', v: PROTOCOL_VERSION, token,
  body: { kind: 'video', app: 'test', version: '0', os: 'test' },
  caps: { audioOut: ['wav'], asrLocal: false, ttsLocal: [], modes: ['overlay'], screens: [] },
  packs: [],
})

/** A body: connects, says hello, and keeps what the brain says. */
async function body(home: string) {
  const { url, token } = JSON.parse(readFileSync(join(home, 'brain.json'), 'utf8')) as { url: string; token: string }
  const socket = new WebSocket(url)
  const inbox: BrainMessage[] = []
  socket.on('message', data => inbox.push(JSON.parse(data.toString()) as BrainMessage))
  await new Promise(resolve => socket.on('open', resolve))
  socket.send(JSON.stringify(hello(token)))
  /** The next message of this kind (ones before it are dropped). */
  const wait = async <T extends BrainMessage['t']>(t: T): Promise<Extract<BrainMessage, { t: T }>> => {
    for (let i = 0; i < 200; i++) {
      while (inbox.length > 0) {
        const message = inbox.shift()!
        if (message.t === t) return message as Extract<BrainMessage, { t: T }>
      }
      await new Promise(r => setTimeout(r, 10))
    }
    throw new Error(`no ${t}`)
  }
  const quiet = async (ms = 80) => {
    await new Promise(r => setTimeout(r, ms))
    return inbox.splice(0)
  }
  const say = (message: BodyMessage) => socket.send(JSON.stringify(message))
  return { wait, quiet, say, close: () => socket.close() }
}

test('settings that cannot be are put right', () => {
  assert.deepEqual(cleanPet({ quietFrom: 9999, petScale: 99, off: 'yes', wallpaper: true, nightDay: 'today' }), { off: false, quietFrom: 23 * 60 + 30, quietTo: 8 * 60 + 30, wallpaper: true, petScale: 3 })
})

test('the pet without a brain: nobody at first, a 设计包 brings her in, she answers a touch, says hello and good night', async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-pet-'))
  let clock = new Date(2026, 10, 14, 12, 0, 0).getTime()
  const brain = new PetBrain({ home, version: '0.9.0', preferredPort: 38900 + Math.floor(Math.random() * 500), now: () => clock, random: () => 0, comeOutAfterMs: 20 })
  await brain.start()
  try {
    // Nobody yet.
    assert.equal(brain.state().empty, true)
    const first = await body(home)
    assert.deepEqual((await first.wait('welcome')).characters, [])
    first.say({ t: 'touch', cid: 'x', part: 'head', kind: 'tap' })
    assert.deepEqual(await first.quiet(), [], 'nobody answers a touch')
    first.close()

    // Looked at first: nothing but the kept zip is written.
    const preview = brain.previewDesign(design())
    assert.equal(preview.character?.lines, 6)
    assert.equal(brain.state().empty, true)

    // Put in: she is the one shown, with her 编排 on; the skin stays out.
    const { record } = await brain.installDesign(preview.token)
    assert.equal(record.skinId, undefined)
    const state = brain.state()
    assert.equal(state.character?.name, '樱花糖')
    assert.deepEqual(state.stage, { has: true, playing: true, notes: [] })
    assert.deepEqual(state.lines, { touch: true, hello: 1, night: 1 })
    assert.ok(existsSync(join(home, 'looks', 'stage', 'look.json')), 'her 编排 is a look the body can show')

    // A body comes back to a new welcome: who she is, what she wears, a word of hello.
    const her = await body(home)
    const welcome = await her.wait('welcome')
    assert.equal(welcome.characters[0]?.name, '樱花糖')
    assert.equal(welcome.config.mic, 'push-to-talk')
    assert.equal((await her.wait('bubble')).text, '我来啦。')
    assert.equal((await her.wait('pack.use')).packId, 'look:stage')

    // Touched: one of her lines for that; not again at once.
    her.say({ t: 'touch', cid: record.cid!, part: 'head', kind: 'tap' })
    assert.equal((await her.wait('bubble')).text, '别闹。')
    her.say({ t: 'touch', cid: record.cid!, part: 'body', kind: 'tap' })
    assert.deepEqual((await her.quiet()).filter(m => m.t === 'bubble'), [])
    clock += 9000
    her.say({ t: 'touch', cid: record.cid!, part: 'body', kind: 'long' })
    assert.equal((await her.wait('bubble')).text, '嗯……')

    // The quiet hours begin: good night, once.
    clock = new Date(2026, 10, 14, 23, 31, 0).getTime()
    brain.tick()
    assert.equal((await her.wait('bubble')).text, '去睡吧。')
    brain.tick()
    assert.deepEqual((await her.quiet()).filter(m => m.t === 'bubble'), [])

    // Talked to: she says she cannot, rather than nothing.
    her.say({ t: 'user.text', text: '在吗' })
    assert.match((await her.wait('bubble')).text, /不会聊天/)

    // Where the body shows her is kept for its next welcome.
    her.say({ t: 'body.prefs', places: { wallpaper: true, overlay: false }, tray: true, holdKey: false, petScale: 1.5 })
    await her.quiet()
    assert.equal(brain.state().settings.petScale, 1.5)

    // Switched off from the body's menu: every body is told, and she is silent.
    her.say({ t: 'off.set', off: true })
    assert.equal((await her.wait('config')).off, true)
    clock += 60_000
    her.say({ t: 'touch', cid: record.cid!, part: 'head', kind: 'tap' })
    assert.deepEqual((await her.quiet()).filter(m => m.t === 'bubble'), [])
    brain.setOff(false)
    her.close()

    // Another one comes in: two in the list, the new one shown; the first can be shown again, the shown one cannot go.
    const second = await brain.installDesign(brain.previewDesign(design('薄荷')).token)
    assert.deepEqual(brain.state().characters.map(c => c.name).sort(), ['樱花糖', '薄荷'].sort())
    assert.equal(brain.state().character?.name, '薄荷')
    assert.throws(() => brain.removeCharacter(second.record.cid!), /正在用/)
    await brain.useCharacter(record.cid!)
    const again = await body(home)
    const next = await again.wait('welcome')
    assert.equal(next.characters[0]?.name, '樱花糖')
    assert.deepEqual(next.config.places, { wallpaper: true, overlay: false })
    assert.equal(next.config.petScale, 1.5)
    brain.removeCharacter(second.record.cid!)
    assert.equal(brain.state().characters.length, 1)
    again.close()
  } finally {
    await brain.stop()
  }
})
