import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileMemory } from '../src/memory/store.ts'
import { digestPrompt, parseDigest, transcriptOf } from '../src/memory/digest.ts'

const day = (s: string) => new Date(`${s}T10:00:00`)

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-her-mem-'))
  return { dir, memory: new FileMemory(dir) }
}

test('told facts are confirmed and show in her profile; duplicates are kept once', () => {
  const { memory } = fresh()
  memory.remember({ kind: 'fact', text: '他叫阿文' }, day('2026-10-01'))
  memory.remember({ kind: 'fact', text: '他不吃香菜' }, day('2026-10-02'))
  memory.remember({ kind: 'fact', text: '他不吃香菜' }, day('2026-10-03'))
  assert.equal(memory.list().facts.length, 2)
  assert.equal(memory.profile(), '- 他不吃香菜\n- 他叫阿文')
})

test('digest facts wait as candidates; after 7 days they settle, sensitive ones never do', () => {
  const { memory } = fresh()
  memory.applyDigest('2026-10-01', {
    diary: '今天他回来得很晚，我们聊了猫。',
    facts: [{ text: '他想养一只猫' }, { text: '他最近在吃安眠药', sensitive: false }],
    episodes: [{ text: '他下周三去面试', due: '2026-10-08' }],
  }, day('2026-10-01'))
  const facts = memory.list().facts
  assert.deepEqual(facts.map(f => [f.text, f.status, f.sensitive]), [['他想养一只猫', 'candidate', false], ['他最近在吃安眠药', 'candidate', true]])
  assert.equal(memory.profile(), '')
  assert.equal(memory.settle(day('2026-10-05')), 0)
  assert.equal(memory.settle(day('2026-10-09')), 1)
  assert.equal(memory.profile(), '- 他想养一只猫')
  assert.equal(memory.confirm([facts[1]!.id]), 1)
  assert.equal(memory.lastDigestDay(), '2026-10-01')
})

test('dated events are due the day before and on the day, then not', () => {
  const { memory } = fresh()
  memory.remember({ kind: 'episode', text: '他下周三去面试', due: '2026-10-08' }, day('2026-10-01'))
  assert.deepEqual(memory.due(day('2026-10-06')), [])
  assert.equal(memory.due(day('2026-10-07')).length, 1)
  assert.equal(memory.due(day('2026-10-08')).length, 1)
  assert.deepEqual(memory.due(day('2026-10-09')), [])
})

test('recall finds facts, events and diary pages; remove forgets them', () => {
  const { memory } = fresh()
  memory.remember({ kind: 'fact', text: '他养了一只叫团子的橘猫' }, day('2026-10-01'))
  memory.remember({ kind: 'episode', text: '他说下周三去腾讯面试' }, day('2026-10-02'))
  memory.applyDigest('2026-10-02', { diary: '他今天提到面试，有点紧张，我让他早点睡。', facts: [], episodes: [] }, day('2026-10-02'))
  const hits = memory.recall('面试', day('2026-10-03'))
  assert.deepEqual(hits.map(h => h.kind).sort(), ['diary', 'episode'])
  assert.equal(memory.recall('团子', day('2026-10-03'))[0]?.kind, 'fact')
  assert.equal(memory.remove(hits.map(h => h.id)), 2)
  assert.deepEqual(memory.recall('面试', day('2026-10-03')), [])
})

test('recent shows the last two diary days before today; export and clear', () => {
  const { dir, memory } = fresh()
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) memory.applyDigest(d, { diary: `${d} 的日记`, facts: [], episodes: [] }, day(d))
  assert.equal(memory.recent(day('2026-10-03')), '2026-10-01：2026-10-01 的日记\n2026-10-02：2026-10-02 的日记')
  assert.match(memory.exportMarkdown(), /### 2026-10-03/)
  assert.match(readFileSync(join(dir, 'diary', '2026-10-02.md'), 'utf8'), /^# 2026-10-02/)
  memory.clear()
  assert.deepEqual(memory.list(), { facts: [], episodes: [], diary: [] })
})

test('the transcript keeps the day, drops context notes and tags', () => {
  const start = Date.parse('2026-10-02T00:00:00')
  const end = start + 86_400_000
  const lines = transcriptOf([
    { type: 'user/message', time: start - 1, data: { content: [{ type: 'text', text: '昨天的话' }] } },
    { type: 'user/message', time: start + 10, data: { content: [{ type: 'text', text: '我下周三面试' }], source: { kind: 'dsh-her' } } },
    { type: 'user/message', time: start + 11, data: { content: [{ type: 'text', text: '（备注：你被打断了）' }], source: { kind: 'dsh-her-context' } } },
    { type: 'user/message', time: start + 12, data: { content: [{ type: 'text', text: 'Current runtime context: cwd …' }], source: { kind: 'runtime-context' } } },
    { type: 'assistant/message', time: start + 20, data: { message: { content: [{ type: 'reasoning', text: '想想' }, { type: 'text', text: '〔开心〕加油呀！' }] } } },
  ], start, end)
  assert.deepEqual(lines.map(l => `${l.who}:${l.text}`), ['you:我下周三面试', 'her:加油呀！'])
  const prompt = digestPrompt('小禾', '2026-10-02', lines, ['他叫阿文'])
  assert.match(prompt.user, /对方：我下周三面试/)
  assert.match(prompt.user, /- 他叫阿文/)
})

test('the digest parser tolerates chatter around the JSON and drops bad items', () => {
  const parsed = parseDigest('好的，整理如下：\n{"diary":"今天不错","facts":[{"text":"他叫阿文"},{"oops":1}],"episodes":[{"text":"面试","due":"2026-10-08"},{"text":"看电影","due":"下周"}]}\n以上。')
  assert.deepEqual(parsed, { diary: '今天不错', facts: [{ text: '他叫阿文', sensitive: false }], episodes: [{ text: '面试', due: '2026-10-08' }, { text: '看电影' }] })
  assert.equal(parseDigest('没有 JSON'), undefined)
})

test('a memory folder cleared by hand while she runs is recreated, not a crash', async () => {
  const { dir, memory } = fresh()
  const { rmSync } = await import('node:fs')
  rmSync(dir, { recursive: true, force: true })
  assert.equal(memory.recent(day('2026-10-02')), '')
  assert.equal(memory.profile(), '')
  memory.remember({ kind: 'fact', text: '他叫阿文' }, day('2026-10-02'))
  assert.equal(memory.profile(), '- 他叫阿文')
})

test('the digest does not write down again an event she already remembered that day', () => {
  const { memory } = fresh()
  memory.remember({ kind: 'episode', text: '阿文下周三去腾讯面试', due: '2026-11-04' }, day('2026-10-29'))
  const added = memory.applyDigest('2026-10-29', {
    diary: '日记',
    facts: [],
    episodes: [{ text: '阿文下周三（11月4日）要去腾讯面试，有点紧张', due: '2026-11-04' }, { text: '阿文明天要早起', due: '2026-10-30' }],
  }, day('2026-10-29'))
  assert.deepEqual(added, { facts: 0, episodes: 1 })
  assert.equal(memory.list().episodes.length, 2)
})

test('forgetting a memory also takes its sentences out of her diary', () => {
  const { dir, memory } = fresh()
  const cat = memory.remember({ kind: 'fact', text: '阿文养了一只橘猫，叫团子' }, day('2026-10-29'))
  memory.applyDigest('2026-10-29', {
    diary: '今天阿文回来得很晚。说到最后他才说自己不吃香菜，养了只橘猫叫团子，我白操心了半天。下周三他要去面试。',
    facts: [], episodes: [],
  }, day('2026-10-29'))
  memory.remove([cat.id])
  const page = readFileSync(join(dir, 'diary', '2026-10-29.md'), 'utf8')
  assert.doesNotMatch(page, /团子/)
  assert.match(page, /今天阿文回来得很晚。/)
  assert.match(page, /下周三他要去面试。/)
})
