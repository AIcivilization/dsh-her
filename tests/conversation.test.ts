import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Conversation, type ConversationDeps } from '../src/engine/conversation.ts'
import type { FrontBrain } from '../src/engine/front-brain.ts'
import type { BrainMessage } from '../src/protocol/index.ts'

/** A brain that records what it is told, a voice that records what it says, and the bodies' messages. */
function setup(change: Partial<ConversationDeps> = {}) {
  const told: string[] = []
  const said: string[] = []
  const sent: BrainMessage[] = []
  const logged: Array<Record<string, unknown>> = []
  const voiced = new Map<string, Array<{ seq: number; text: string; durationMs: number }>>()
  let interrupts = 0
  let off = false
  const brain: FrontBrain = {
    say: async text => { told.push(`say ${text}`) },
    note: async text => { told.push(`note ${text}`) },
    interrupt: () => { interrupts++ },
    sessionId: 's1',
    dispose: async () => {},
  }
  const speech = {
    cancel: (uid: string) => said.push(`cancel ${uid}`),
    end: (uid: string) => said.push(`end ${uid}`),
    sentOf: (uid: string) => voiced.get(uid) ?? [],
  }
  const conv = new Conversation({
    cid: 'c1',
    brain: () => brain,
    speech: () => speech,
    speak: (uid, seq, text) => {
      said.push(`${uid}#${seq} ${text}`)
      voiced.set(uid, [...(voiced.get(uid) ?? []), { seq, text, durationMs: 1000 }])
    },
    broadcast: message => sent.push(message),
    off: () => off,
    log: entry => logged.push(entry),
    heardYou: () => {},
    warm: () => {},
    stuckAfterMs: 60_000,
    stuckText: '（卡住了）',
    maxNotes: 4,
    ...change,
  })
  return { conv, told, said, sent, logged, interrupts: () => interrupts, setOff: (v: boolean) => { off = v } }
}

test('you say something: notes and how far you heard her go first, then your words; her reply comes back sentence by sentence', async () => {
  const t = setup({ beforeTurn: async text => { t.told.push(`before ${text}`) } })
  t.conv.addNote('（备注：你刚才主动说了"早"。）')
  t.conv.hear('在吗', 'voice', 1000)
  assert.equal(t.conv.awaitingReply, true)
  assert.equal(t.conv.busy(1000), true)
  assert.deepEqual(t.sent.at(-1), { t: 'state', cid: 'c1', state: 'think' })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(t.told, ['before 在吗', 'note （备注：你刚才主动说了"早"。）', 'say 在吗'])
  assert.deepEqual(t.conv.notes, [], 'said once')

  t.conv.events.start('r1')
  assert.equal(t.conv.awaitingReply, false)
  t.conv.events.sentence('r1', '在的。')
  t.conv.events.sentence('r1', '你呢？')
  t.conv.events.end('r1', 'committed')
  assert.deepEqual(t.said, ['r1#0 在的。', 'r1#1 你呢？', 'end r1'])
  assert.equal(t.conv.current, undefined)
  assert.deepEqual(t.conv.finished.map(f => [f.attemptId, f.sentences.length, f.outcome]), [['r1', 2, 'committed']])
  assert.ok(t.sent.some(m => m.t === 'speak.begin'))
  t.conv.dispose()
})

test('a body cuts her off: what you heard is told before your next words, the rest is not said', async () => {
  const t = setup()
  t.conv.events.start('r1')
  t.conv.events.sentence('r1', '我跟你说。')
  t.conv.events.sentence('r1', '今天特别好。')
  t.conv.interrupted('r1', 1, 500, 5000)
  assert.equal(t.interrupts(), 1, 'her brain stops')
  assert.ok(t.said.includes('cancel r1'))
  assert.match(t.conv.cutNote!, /只说到"我跟你说。今天特"/)
  // What came in right after was her own voice through the speakers: the reply to compare with, once.
  assert.deepEqual(t.conv.takeBargeIn(6000), { uid: 'r1', said: '我跟你说。今天特别好。' })
  assert.equal(t.conv.takeBargeIn(6000), undefined)
  t.conv.events.end('r1', 'interrupted')
  t.conv.hear('嗯', 'text')
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.match(t.told[0]!, /^note （备注：你上一段话只说到/)
  assert.equal(t.told[1], 'say 嗯')
  t.conv.dispose()
})

test('her own lines: spoken, noted for her brain, cut like a reply; nothing while she is off', () => {
  const t = setup()
  const lines: string[] = []
  const withHook = setup({ ownLine: text => lines.push(text) })
  withHook.conv.sayOwnLine('早呀。今天也加油。', '（备注：主动说了早）', 1000)
  assert.deepEqual(lines, ['早呀。今天也加油。'])
  const own = withHook.conv.ownLine!.uid
  assert.deepEqual(withHook.said, [`${own}#0 早呀。`, `${own}#1 今天也加油。`, `end ${own}`])
  assert.deepEqual(withHook.conv.notes, ['（备注：主动说了早）'])
  assert.equal(withHook.conv.busy(1000), true, 'her voice is still playing')
  // Cut off: the whole line's note goes, the note of how far you heard it comes instead.
  withHook.conv.interrupted(own, 0, 0, 2000)
  assert.deepEqual(withHook.conv.notes, [])
  assert.match(withHook.conv.cutNote!, /刚开口就被对方打断/)
  assert.equal(withHook.conv.ownLine, undefined)
  assert.equal(withHook.interrupts(), 0, 'her brain was not talking')

  t.setOff(true)
  t.conv.sayOwnLine('不该说。', '（备注）')
  assert.deepEqual(t.said, [])
})

test('a reply with no words, and a reply that never starts, are handed on', async () => {
  const empty: string[] = []
  const t = setup({ emptyReply: (_trace, outcome) => empty.push(outcome), stuckAfterMs: 20 })
  t.conv.events.start('r1')
  t.conv.events.end('r1', 'committed')
  assert.deepEqual(empty, ['committed'])
  t.conv.hear('在吗', 'text')
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.deepEqual(empty, ['committed', 'stuck'])
  assert.equal(t.conv.awaitingReply, false)
  assert.deepEqual(t.sent.at(-1), { t: 'bubble', cid: 'c1', text: '（卡住了）', ttlMs: 8000 })
  // A sentence clears what went wrong before.
  t.conv.problem = { text: '模型出错了', at: 1 }
  t.conv.events.start('r2')
  t.conv.events.sentence('r2', '好了。')
  assert.equal(t.conv.problem, undefined)
  t.conv.dispose()
})

test('no brain yet: what you say is not taken; a brain that fails says so on her', async () => {
  const none = new Conversation({ ...setupDeps(), brain: () => undefined })
  none.hear('在吗', 'text')
  assert.equal(none.awaitingReply, false)
  const sent: BrainMessage[] = []
  const failing = new Conversation({ ...setupDeps(), broadcast: m => sent.push(m), brain: () => ({ say: async () => { throw new Error('没有模型') }, note: async () => {}, interrupt: () => {}, sessionId: undefined, dispose: async () => {} }) })
  failing.hear('在吗', 'text')
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(failing.awaitingReply, false)
  assert.deepEqual(sent.at(-1), { t: 'bubble', cid: 'c1', text: '（我还没准备好：没有模型）', ttlMs: 6000 })
  failing.dispose()
})

function setupDeps(): ConversationDeps {
  return {
    cid: 'c1', brain: () => undefined, speech: () => undefined, speak: () => {}, broadcast: () => {}, off: () => false,
    log: () => {}, heardYou: () => {}, warm: () => {}, stuckAfterMs: 60_000, stuckText: '', maxNotes: 4,
  }
}
