import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { HerSession, type DshServices, type ScopedContext, type StreamFrame } from '../src/dsh/her-session.ts'
import { herTools } from '../src/engine/her-tools.ts'
import { ReplyStream } from '../src/engine/reply-stream.ts'
import { FileMemory } from '../src/memory/store.ts'

/** Collects what a reply stream says. */
function recorder() {
  const said: string[] = []
  return {
    said,
    events: {
      start: (id: string) => said.push(`start ${id}`),
      sentence: (id: string, text: string) => said.push(`${id}: ${text}`),
      end: (id: string, outcome: string) => said.push(`end ${id} ${outcome}`),
    },
  }
}

test('a reply streams in as sentences; a cut-off or abandoned reply says no more', () => {
  const r = recorder()
  const stream = new ReplyStream(r.events)
  stream.delta('没开始的话不说。')
  stream.start('a')
  assert.equal(stream.active, true)
  stream.delta('你好呀。今天')
  stream.delta('怎么样')
  stream.end('committed')
  assert.equal(stream.active, false)
  assert.deepEqual(r.said, ['start a', 'a: 你好呀。', 'a: 今天怎么样', 'end a committed'])

  r.said.length = 0
  stream.start('b')
  stream.delta('第一句。第二')
  stream.interrupt()
  stream.delta('句也不说。')
  stream.end('interrupted')
  assert.deepEqual(r.said, ['start b', 'b: 第一句。', 'end b interrupted'])

  r.said.length = 0
  stream.start('c')
  stream.delta('没说完的')
  stream.end('abandoned')
  assert.deepEqual(r.said, ['start c', 'end c abandoned'])
  stream.end('again')
  assert.equal(r.said.length, 2, 'an end without a start is nothing')
})

test('her tools answer in words, whatever brain calls them', async () => {
  const memory = new FileMemory(mkdtempSync(join(tmpdir(), 'her-tools-')))
  let asked = ''
  const tools = herTools({
    playAction: async action => { asked = action; return action === 'wave' ? { ok: true, transcript: '嗨' } : { ok: false, reason: 'no body' } },
    memory,
    now: () => new Date(2026, 10, 25, 10),
  })
  assert.deepEqual(tools.map(t => t.name), ['play_action', 'remember', 'recall', 'forget'])
  for (const tool of tools) assert.equal((tool.parameters as { type: string }).type, 'object')
  const [play, remember, recall, forget] = tools
  assert.deepEqual(await play!.execute({ action: ' wave ' }), { ok: true, text: '已经做完：wave（你说了"嗨"）' })
  assert.equal(asked, 'wave')
  assert.deepEqual(await play!.execute({ action: 'jump' }), { ok: false, text: '没做成：jump（桌面上没有连着身体）' })
  const kept = await remember!.execute({ text: '他不吃香菜', kind: 'fact' })
  assert.match(kept.text, /^记下了（f\d+）：他不吃香菜$/)
  assert.match((await recall!.execute({ query: '香菜' })).text, /他不吃香菜/)
  assert.equal((await recall!.execute({ query: '火星' })).text, '没找到相关的记忆。')
  const id = /（(f\d+)）/.exec(kept.text)![1]!
  assert.equal((await forget!.execute({ ids: [id] })).text, '删掉了 1 条。')
  assert.equal((await forget!.execute({ ids: ['nope'] })).text, '没有删掉任何东西（id 不对？）')
})

test("DSH's session as a front brain: her prompt, her tools in DSH's shape, her stream as sentences", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'her-session-'))
  const registered: Array<{ name: string; output: { schema: { required: string[] } }; execute: (args: Record<string, unknown>) => Promise<unknown> }> = []
  const sections: string[] = []
  let listener: ((payload: { frame: StreamFrame }) => void) | undefined
  const sent: string[] = []
  let cancelled = 0
  const scope: ScopedContext = {
    tools: {
      register: definition => { registered.push(definition as (typeof registered)[number]); return () => {} },
      schemas: () => [{ name: 'shell' }, { name: 'run_code' }],
      restrict: () => () => {},
    },
    systemPrompt: { section: d => { sections.push(typeof d.text === 'function' ? d.text() : d.text) } },
    on: (_event, l) => { listener = l; return () => {} },
  }
  const agent = {
    session: { id: 'dsh-her-c1-x' },
    followup: (m: { content: Array<{ text: string }> }) => sent.push(`say ${m.content[0]!.text}`),
    inject: (m: { content: Array<{ text: string }> }) => sent.push(`note ${m.content[0]!.text}`),
    cancel: () => { cancelled++ },
    whenIdle: async () => {},
  }
  const services = {
    agents: {
      create: async (options: { setup?: (ctx: ScopedContext) => Promise<void> | void }) => { await options.setup?.(scope); return { agent, dispose: async () => {} } },
      resume: async () => { throw new Error('none') },
    },
  } as unknown as DshServices
  const r = recorder()
  const her = new HerSession({
    cid: 'c1', dir,
    character: () => ({ name: '小禾', persona: '你是小禾。', callYou: '阿文', pronoun: '他' }),
    performance: () => '',
    playAction: async () => ({ ok: true }),
    extraTools: () => [{ name: 'wear_skin', output: { schema: { required: [] } }, execute: async () => ({}) }],
    aboutYou: () => '',
    memory: new FileMemory(join(dir, 'memory')),
    route: undefined,
    services: () => services,
    logger: { info: () => {}, warn: () => {} },
    events: r.events,
  })
  await her.say('在吗', 'text')
  await her.note('（备注）')
  assert.deepEqual(sent, ['say 在吗', 'note （备注）'])
  assert.equal(her.sessionId, 'dsh-her-c1-x')
  assert.match(sections[0]!, /小禾/)
  // Her tools, in the order they always were, the extra ones after play_action.
  assert.deepEqual(registered.map(t => t.name), ['play_action', 'wear_skin', 'remember', 'recall', 'forget'])
  assert.deepEqual(registered[0]!.output.schema.required, ['ok', 'text'])
  assert.deepEqual(registered[2]!.output.schema.required, ['text'])
  assert.deepEqual(await registered[0]!.execute({ action: 'wave' }), { ok: true, text: '已经做完：wave' })
  assert.match(JSON.stringify(await registered[2]!.execute({ text: '他喜欢猫', kind: 'fact' })), /记下了/)

  // Her stream: text deltas become sentences; reasoning is never spoken; one reply id per turn and step.
  listener!({ frame: { type: 'start', attemptId: 'a', turn: 1, step: 0 } })
  listener!({ frame: { type: 'chunk', attemptId: 'a', index: 0, time: 0, chunk: { type: 'reasoning-delta', text: '想一想。' } } })
  listener!({ frame: { type: 'chunk', attemptId: 'a', index: 1, time: 0, chunk: { type: 'text-delta', text: '在的。你呢' } } })
  listener!({ frame: { type: 'end', attemptId: 'a', index: 2, outcome: { kind: 'committed' } } })
  assert.deepEqual(r.said, ['start a@1.0', 'a@1.0: 在的。', 'a@1.0: 你呢', 'end a@1.0 committed'])

  r.said.length = 0
  listener!({ frame: { type: 'start', attemptId: 'a', turn: 2, step: 0 } })
  listener!({ frame: { type: 'chunk', attemptId: 'a', index: 0, time: 0, chunk: { type: 'text-delta', text: '我跟你说。后面' } } })
  her.interrupt()
  listener!({ frame: { type: 'chunk', attemptId: 'a', index: 1, time: 0, chunk: { type: 'text-delta', text: '的不说。' } } })
  listener!({ frame: { type: 'end', attemptId: 'a', index: 2, outcome: { kind: 'interrupted' } } })
  assert.deepEqual(r.said, ['start a@2.0', 'a@2.0: 我跟你说。', 'end a@2.0 interrupted'])
  assert.equal(cancelled, 1)
})
