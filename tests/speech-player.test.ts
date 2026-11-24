import assert from 'node:assert/strict'
import { test } from 'node:test'

/**
 * The desktop body's speech player (body/renderer/speech-player.ts) against a
 * pretend Web Audio: decoding finishes only when the test says so, so the
 * races of issue #1 can be laid out step by step.
 */

interface FakeSource { started: number; stopped: boolean; onended: (() => void) | null; buffer: unknown }
const sources: FakeSource[] = []
const decodes: Array<() => void> = []

class FakeAudioContext {
  state = 'running'
  destination = {}
  createGain() { return { gain: { value: 1 }, connect() { /* to the speakers */ } } }
  createBufferSource(): FakeSource & { connect(): void; start(): void; stop(): void } {
    const s = { started: 0, stopped: false, onended: null as (() => void) | null, buffer: undefined as unknown, connect() { /* to the gain */ }, start() { s.started++ }, stop() { s.stopped = true } }
    sources.push(s)
    return s
  }
  async resume() { this.state = 'running' }
  decodeAudioData(): Promise<{ duration: number }> {
    return new Promise(resolve => decodes.push(() => resolve({ duration: 0.4 })))
  }
}

const g = globalThis as unknown as Record<string, unknown>
g.AudioContext = FakeAudioContext
g.window = { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (t: number) => clearTimeout(t) }

const { SpeechPlayer } = await import('../body/renderer/speech-player.ts')

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const audio = () => ({ audio: new Uint8Array([1, 2, 3]) })

function player() {
  const said: string[] = []
  const done: string[] = []
  const p = new SpeechPlayer({
    sentence: (_uid, seq, text) => { said.push(`${seq}:${text}`) },
    progress: () => undefined,
    done: uid => { done.push(uid) },
  }, false)
  return { p, said, done }
}

test('a short line whose end comes while it is decoding is still played, and only then done (issue #1, first part)', async () => {
  sources.length = decodes.length = 0
  const { p, said, done } = player()
  p.begin('r1')
  p.seg('r1', { seq: 0, text: '你回来啦', durationMs: 400, ...audio() })
  p.end('r1')
  await tick()
  assert.deepEqual(done, [], 'not done while its audio is decoding')
  assert.equal(p.speaking, true)
  decodes.shift()!()
  await tick()
  assert.equal(sources.length, 1)
  assert.equal(sources[0]!.started, 1, 'played')
  assert.deepEqual(said, ['0:你回来啦'], 'its words shown')
  sources[0]!.onended!()
  await tick()
  assert.deepEqual(done, ['r1'], 'done once it has played')
})

test('two sentences arriving together play one after the other, not over each other (issue #1, second part)', async () => {
  sources.length = decodes.length = 0
  const { p, said, done } = player()
  p.begin('r2')
  p.seg('r2', { seq: 0, text: '第一句', durationMs: 400, ...audio() })
  p.seg('r2', { seq: 1, text: '第二句', durationMs: 400, ...audio() })
  p.end('r2')
  await tick()
  assert.equal(decodes.length, 1, 'only the first is being decoded')
  decodes.shift()!()
  await tick()
  assert.equal(sources.filter(s => s.started > 0).length, 1, 'one playing')
  assert.equal(decodes.length, 0, 'the second waits for the first to end')
  sources[0]!.onended!()
  await tick()
  assert.equal(decodes.length, 1)
  decodes.shift()!()
  await tick()
  assert.equal(sources.length, 2)
  assert.deepEqual(said, ['0:第一句', '1:第二句'])
  assert.deepEqual(done, [])
  sources[1]!.onended!()
  await tick()
  assert.deepEqual(done, ['r2'])
})

test('a reply cut off while decoding stays quiet, and the next reply is not held up by it', async () => {
  sources.length = decodes.length = 0
  const { p, said, done } = player()
  p.begin('old')
  p.seg('old', { seq: 0, text: '旧的', durationMs: 400, ...audio() })
  await tick()
  assert.equal(p.cut()?.uid, 'old', 'cut while decoding: said where (the sentence not yet heard)')
  p.begin('new')
  p.seg('new', { seq: 0, text: '新的', durationMs: 400, ...audio() })
  await tick()
  assert.equal(decodes.length, 2, 'the new one decodes without waiting for the old')
  decodes.shift()!()
  await tick()
  assert.equal(sources.length, 0, 'the old audio is not played')
  decodes.shift()!()
  await tick()
  assert.equal(sources.length, 1)
  assert.deepEqual(said, ['0:新的'])
  p.end('new')
  sources[0]!.onended!()
  await tick()
  assert.deepEqual(done, ['new'])
})

test('a sentence without audio is held for its reading time', async () => {
  sources.length = decodes.length = 0
  const { p, said, done } = player()
  p.begin('r3')
  p.seg('r3', { seq: 0, text: '只有字', durationMs: 20 })
  p.end('r3')
  await tick()
  assert.deepEqual(said, ['0:只有字'])
  assert.deepEqual(done, [])
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.deepEqual(done, ['r3'])
})
