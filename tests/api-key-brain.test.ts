import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ApiKeyBrain, explainKeyError } from '../src/engine/brains/api-key.ts'
import type { HerTool } from '../src/engine/her-tools.ts'

type Asked = { auth: string; body: { model: string; stream: boolean; messages: Array<{ role: string; content: string; tool_calls?: unknown; tool_call_id?: string }>; tools?: unknown[] } }

/** An OpenAI-compatible service on this computer that answers from a script. */
async function service(answers: Array<(res: import('node:http').ServerResponse) => void>) {
  const asked: Asked[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      asked.push({ auth: String(req.headers.authorization), body: JSON.parse(body) })
      const next = answers.shift()
      if (next === undefined) res.writeHead(500).end('no more')
      else next(res)
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  return { asked, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, close: () => server.close() }
}
const sse = (chunks: unknown[], slow = 0) => (res: import('node:http').ServerResponse) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  let i = 0
  const next = () => {
    if (i < chunks.length) {
      res.write(`data: ${JSON.stringify(chunks[i++])}\n\n`)
      if (slow > 0) setTimeout(next, slow)
      else next()
    } else res.end('data: [DONE]\n\n')
  }
  next()
}
const text = (t: string, finish: string | null = null) => ({ choices: [{ delta: { content: t }, finish_reason: finish }] })

function brain(base: string, tools: HerTool[] = [], key: string | undefined = 'sk-test') {
  const dir = mkdtempSync(join(tmpdir(), 'her-key-'))
  const said: string[] = []
  const b = new ApiKeyBrain({
    base, model: 'deepseek-chat', key: async () => key, historyFile: join(dir, 'history.json'),
    prompt: () => '你是小禾。', context: () => '今天是星期二', tools: () => tools,
    events: { start: () => said.push('start'), sentence: (_id, t) => said.push(t), end: (_id, o) => said.push(`end ${o}`) },
  })
  const until = async (check: () => boolean, ms = 3000) => {
    for (let t = 0; t < ms && !check(); t += 10) await new Promise(r => setTimeout(r, 10))
    assert.ok(check(), `waited too long: ${said.join(' | ')}`)
  }
  return { b, dir, said, until }
}

test('words stream back as sentences; the conversation is kept and goes with the next turn', async () => {
  const s = await service([sse([text('你好'), text('。我是小禾，'), text('很高兴认识你。', 'stop')]), sse([text('记得。', 'stop')])])
  const { b, dir, said, until } = brain(s.base)
  try {
    await b.note('（备注：你刚才主动说了"早"。）')
    await b.say('你好', 'text')
    await until(() => said.includes('end committed'))
    assert.deepEqual(said, ['start', '你好。', '我是小禾，很高兴认识你。', 'end committed'])
    assert.equal(s.asked[0]!.auth, 'Bearer sk-test')
    assert.deepEqual(s.asked[0]!.body.messages, [
      { role: 'system', content: '你是小禾。' },
      { role: 'user', content: '（现场：今天是星期二）\n（备注：你刚才主动说了"早"。）\n你好' },
    ])
    assert.equal(s.asked[0]!.body.stream, true)
    said.length = 0
    await b.say('还记得我吗', 'voice')
    await until(() => said.includes('end committed'))
    assert.deepEqual(s.asked[1]!.body.messages.slice(1).map(m => [m.role, m.content]), [
      ['user', '（现场：今天是星期二）\n（备注：你刚才主动说了"早"。）\n你好'],
      ['assistant', '你好。我是小禾，很高兴认识你。'],
      ['user', '还记得我吗'],
    ])
    assert.ok(b.sessionId !== undefined)
    assert.ok(!readFileSync(join(dir, 'history.json'), 'utf8').includes('sk-test'), 'the key is never kept')
  } finally {
    s.close()
  }
})

test('her tools as function calls: called, answered, then she speaks', async () => {
  const calls: unknown[] = []
  const remember: HerTool = { name: 'remember', description: '记下', parameters: { type: 'object' }, execute: async args => { calls.push(args); return { text: '记下了（f1）' } } }
  const s = await service([
    sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'remember', arguments: '{"text":"不吃' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '香菜","kind":"fact"}' } }] }, finish_reason: 'tool_calls' }] }]),
    sse([text('好，记住了。', 'stop')]),
  ])
  const { b, said, until } = brain(s.base, [remember])
  try {
    await b.say('我不吃香菜', 'text')
    await until(() => said.includes('end committed'))
    assert.deepEqual(calls, [{ text: '不吃香菜', kind: 'fact' }])
    assert.deepEqual(said, ['start', '好，记住了。', 'end committed'], 'a round of only tool calls is not an empty reply')
    assert.equal((s.asked[0]!.body.tools as unknown[]).length, 1)
    const second = s.asked[1]!.body.messages
    assert.equal(second.at(-2)!.role, 'assistant')
    assert.deepEqual(second.at(-1), { role: 'tool', tool_call_id: 'c1', content: '记下了（f1）' })
  } finally {
    s.close()
  }
})

test('cut off mid-reply: nothing more is said, and what she said stays; a bad key or no key says why', async () => {
  const many = Array.from({ length: 50 }, (_, i) => text(`第${i + 1}句。`))
  const s = await service([sse(many, 15), (res) => res.writeHead(401).end('{"error":"invalid key"}')])
  const { b, dir, said, until } = brain(s.base)
  try {
    await b.say('讲个长故事', 'text')
    await until(() => said.filter(x => x.startsWith('第')).length >= 2)
    b.interrupt()
    const told = said.length
    await until(() => said.at(-1) === 'end interrupted')
    assert.ok(said.slice(told).every(x => !x.startsWith('第')))
    const kept = JSON.parse(readFileSync(join(dir, 'history.json'), 'utf8')) as { messages: Array<{ role: string; content: string }> }
    assert.equal(kept.messages.at(-1)!.role, 'assistant')
    assert.match(kept.messages.at(-1)!.content, /^第1句。第2句。/)

    said.length = 0
    await b.say('你好', 'text')
    await until(() => said.includes('end error'))
    assert.match(b.lastError!, /API key 不对/)
  } finally {
    s.close()
  }
  const none = brain('http://127.0.0.1:9/v1', [], '')
  await none.b.say('你好', 'text')
  await none.until(() => none.said.includes('end error'))
  assert.match(none.b.lastError!, /还没有填 API key/)
  // A service that cannot be reached: said in words, not "fetch failed".
  const away = brain('http://127.0.0.1:9/v1')
  await away.b.say('你好', 'text')
  await away.until(() => away.said.includes('end error'))
  assert.match(away.b.lastError!, /127\.0\.0\.1/)
  assert.doesNotMatch(away.b.lastError!, /^fetch failed$/)
  assert.throws(() => new ApiKeyBrain({ base: 'http://evil.example/v1', key: async () => 'k', historyFile: '/tmp/x', prompt: () => '', context: () => '', tools: () => [], events: { start() {}, sentence() {}, end() {} } }), /https/)
  assert.match(explainKeyError(402, ''), /余额/)
})
