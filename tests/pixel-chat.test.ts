import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { makeGrid } from '../src/core/pixel-grid.ts'
import { BUILTIN_PIXELS } from '../src/core/pixel-builtins.ts'
import { sketchFrame, sketchReport, sketchStats } from '../src/core/pixel-sketch.ts'
import { cleanProbe, MAX_TRIES, PixelChats, pixelPrompt } from '../src/dsh/pixel-chat.ts'
import { PixelDrafts } from '../src/dsh/pixel-drafts.ts'
import type { NativeTool } from '../src/dsh/design-tools.ts'

test('a frame in characters: shape kept, where it is and how much it fills', () => {
  const g = makeGrid(96, 54, 'mono')
  g.rect(24, 13, 48, 27, 1)
  const text = sketchFrame(g.data, 96, 54, true, 48)
  const lines = text.split('\n')
  assert.equal(lines.length, 14)
  assert.match(lines[7]!, /^ {12}#{24}$/)
  const stats = sketchStats(g.data, 96, 54, true)
  assert.equal(stats.filled, 0.25)
  assert.deepEqual(stats.box, { left: 0.25, right: 0.75, top: 0.24, bottom: 0.74 })
  assert.match(sketchReport([{ t: 1, text, stats }]), /画到的格子占 25%；左右 25%–75%/)
  assert.match(sketchReport([{ t: 2, text: '', stats: { filled: 0 } }]), /什么都没画/)
})

test('what the page sends back is kept to its shape', () => {
  assert.deepEqual(cleanProbe(null), { ok: false, problems: [], warnings: [] })
  const ok = cleanProbe({ ok: true, info: { name: 'a', grid: [16, 9], fps: 12, seconds: 0 }, problems: [1, 'x'], warnings: [], frameMs: 1.5, sketches: [{ t: 1, text: '#', stats: { filled: 0.1 } }, { bad: true }] })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.problems, ['x'])
  assert.equal(ok.sketches?.length, 1)
  assert.equal(cleanProbe({ ok: true }).ok, false, 'no info, not ok')
})

/** A stand-in for dsh's agents: the setup is run on a fake scope, so the tools and the stream listener are ours to drive. */
function fakeDsh() {
  const said: string[] = []
  let tools: NativeTool[] = []
  let prompt: () => string = () => ''
  let stream: ((payload: { frame: unknown }) => void) | undefined
  let denied: readonly string[] = []
  const handle = { agent: { session: {}, followup: (m: { content: Array<{ text: string }> }) => said.push(m.content[0]!.text), cancel: () => undefined, whenIdle: async () => undefined } }
  const setupOn = async (options: { setup?: (ctx: unknown) => void }) => {
    tools = []
    options.setup?.({
      tools: { register: (t: NativeTool) => { tools.push(t); return () => undefined }, schemas: () => [{ name: 'shell' }, { name: 'run_code' }], restrict: (f: { deny: readonly string[] }) => { denied = f.deny; return () => undefined } },
      systemPrompt: { section: (d: { text: () => string }) => { prompt = d.text }, suppressRuntimeContext: () => undefined },
      on: (_event: string, listener: (payload: { frame: unknown }) => void) => { stream = listener; return () => undefined },
    })
    return handle
  }
  const services = { agents: { create: setupOn, resume: setupOn }, workspaceRegistry: { create: async () => ({ attachSession: async () => undefined }) } }
  return { services, said, tools: () => tools, prompt: () => prompt(), stream: (frame: unknown) => stream?.({ frame }), denied: () => denied }
}

test('the AI hands in code; the page tries it; a version is made only when it runs', async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-chat-'))
  const drafts = new PixelDrafts(home)
  const dsh = fakeDsh()
  const chats = new PixelChats({ drafts, services: () => dsh.services as never, route: () => undefined, room: join(home, 'room'), title: '她', logger: { info: () => undefined, warn: () => undefined } })
  const draft = drafts.create()
  chats.view(draft.id)
  await chats.send(draft.id, '做一只小鲸鱼')
  assert.deepEqual(dsh.said, ['做一只小鲸鱼'])
  assert.deepEqual(dsh.denied(), ['shell'], "DSH's tools hidden, run_code kept")
  assert.match(dsh.prompt(), /还是空的/)
  assert.match(dsh.prompt(), /export function frame/)
  assert.deepEqual(dsh.tools().map(t => t.name), ['pixel_read', 'pixel_write', 'pixel_look'])

  // Its words come in as a stream.
  dsh.stream({ type: 'start', attemptId: 'a', turn: 1, step: 1 })
  dsh.stream({ type: 'chunk', attemptId: 'a', index: 0, time: 0, chunk: { type: 'reasoning-delta', text: '想一想' } })
  dsh.stream({ type: 'chunk', attemptId: 'a', index: 1, time: 0, chunk: { type: 'text-delta', text: '好的，' } })
  dsh.stream({ type: 'chunk', attemptId: 'a', index: 2, time: 0, chunk: { type: 'text-delta', text: '我来画。' } })
  dsh.stream({ type: 'end', attemptId: 'a', index: 3, outcome: { kind: 'completed' } })
  assert.deepEqual(chats.view(draft.id).items.map(i => [i.who, i.text]), [['you', '做一只小鲸鱼'], ['ai', '好的，我来画。']])

  const write = dsh.tools().find(t => t.name === 'pixel_write')!
  const code = BUILTIN_PIXELS[0]!.code
  // The page fails it: no version.
  let pending = write.execute({ code, note: '小鲸鱼' })
  let probe = chats.view(draft.id).probe!
  assert.equal(probe.code, code)
  chats.answerProbe(draft.id, probe.req, { ok: false, problems: ['第 3 帧出错：x is not defined（第 12 行）'], warnings: [] })
  assert.match((await pending).text, /试跑没通过[\s\S]*第 12 行/)
  assert.equal(drafts.get(draft.id).versions.length, 0)
  // It runs: a version, and what it looks like goes back to the AI.
  pending = write.execute({ code, note: '小鲸鱼' })
  probe = chats.view(draft.id).probe!
  chats.answerProbe(draft.id, probe.req, { ok: true, info: { name: '鲸尾出水', grid: [192, 108], fps: 24, seconds: 5 }, problems: [], warnings: [], frameMs: 1.2, sketches: [{ t: 2.5, text: '  ##', stats: { filled: 0.1, box: { left: 0.4, right: 0.6, top: 0.2, bottom: 0.8 } } }] })
  const done = (await pending).text
  assert.match(done, /存成了 v1/)
  assert.match(done, /第 2.5 秒/)
  assert.equal(drafts.get(draft.id).versions[0]!.note, '🤖 小鲸鱼')
  assert.ok(chats.view(draft.id).items.some(i => i.who === 'note' && i.text === '✓ v1：小鲸鱼'))
  assert.match(dsh.prompt(), /正在播 v1/)
  assert.match((await dsh.tools().find(t => t.name === 'pixel_read')!.execute({})).text, /鲸尾出水/)

  // Not more than MAX_TRIES in one answer.
  for (let i = 2; i < MAX_TRIES; i++) {
    const p = write.execute({ code, note: 'x' })
    chats.answerProbe(draft.id, chats.view(draft.id).probe!.req, { ok: false, problems: ['坏了'], warnings: [] })
    await p
  }
  assert.match((await write.execute({ code, note: 'x' })).text, new RegExp(`已经交了 ${MAX_TRIES} 次`))

  // The look, when asked for.
  assert.match((await dsh.tools().find(t => t.name === 'pixel_look')!.execute({ style: 'blocks', color: '#ff88aa' })).text, /方块，颜色 #ff88aa/)
  assert.equal(drafts.get(draft.id).look.style, 'blocks')

  // What was said is kept with the draft.
  assert.ok(drafts.chat(draft.id).items.length >= 3)
  assert.match(drafts.chat(draft.id).sessionId ?? '', /^dsh-her-pixel-/)
})

test('with no workshop page open, code is not tried, and the AI is told why', async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-chat-'))
  const drafts = new PixelDrafts(home)
  const dsh = fakeDsh()
  const chats = new PixelChats({ drafts, services: () => dsh.services as never, route: () => undefined, room: join(home, 'room'), title: '她', logger: { info: () => undefined, warn: () => undefined } })
  const draft = drafts.create()
  await chats.send(draft.id, '画个圈')
  const write = dsh.tools().find(t => t.name === 'pixel_write')!
  // The page asked just now when it sent; make it long ago.
  ;(chats as unknown as { chats: Map<string, { seen: number }> }).chats.get(draft.id)!.seen = 0
  assert.match((await write.execute({ code: BUILTIN_PIXELS[0]!.code, note: '圈' })).text, /页面现在没开着/)
  assert.equal(drafts.get(draft.id).versions.length, 0)
  assert.throws(() => chats.view('d-nothere1'), /没有这个草稿/)
})
