import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ClaudeCodeBrain, explainClaudeError, findClaude } from '../src/engine/brains/claude-code.ts'
import { startHerMcp } from '../src/engine/her-mcp.ts'
import type { HerTool } from '../src/engine/her-tools.ts'

const fake = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url))
const wave: HerTool = { name: 'play_action', description: '做动作', parameters: { type: 'object', properties: { action: { type: 'string' } } }, execute: async args => ({ ok: args.action === 'wave', text: `做了 ${String(args.action)}` }) }

function brain(change: { prompt?: () => string; context?: () => string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'her-claude-'))
  const logFile = join(dir, 'fake.log')
  const said: string[] = []
  const b = new ClaudeCodeBrain({
    cwd: join(dir, 'room'), sessionFile: join(dir, 'claude-session.json'), program: 'claude',
    prompt: change.prompt ?? (() => '你是小禾。'), context: change.context ?? (() => '今天是星期二，上午'),
    tools: () => [wave],
    events: { start: id => said.push(`start ${id}`), sentence: (_id, text) => said.push(text), end: (_id, outcome) => said.push(`end ${outcome}`) },
    spawn: (_program, args, cwd) => spawn(process.execPath, [fake, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, FAKE_CLAUDE_LOG: logFile } }),
  })
  const seen = () => readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { started?: string[]; got?: { type: string; message?: { content: Array<{ text: string }> }; request?: { subtype: string } } })
  const until = async (check: () => boolean, ms = 3000) => {
    for (let t = 0; t < ms && !check(); t += 10) await new Promise(r => setTimeout(r, 10))
    assert.ok(check(), 'waited too long')
  }
  return { b, dir, said, seen, until }
}

test('where claude is: on PATH, else where its installers put it', () => {
  const exists = (path: string) => ['/opt/homebrew/bin/claude', '/home/a/.local/bin/claude', 'C:\\Users\\a\\.local\\bin\\claude.exe'].includes(path)
  assert.equal(findClaude({ PATH: '/usr/bin:/opt/homebrew/bin', HOME: '/home/b' }, 'darwin', exists), '/opt/homebrew/bin/claude')
  assert.equal(findClaude({ PATH: '/usr/bin:/bin', HOME: '/home/a' }, 'darwin', exists), '/home/a/.local/bin/claude', 'an app from the Dock has a bare PATH')
  assert.equal(findClaude({ PATH: '/usr/bin', HOME: '/home/c' }, 'linux', path => path === '/home/a/.local/bin/claude'), undefined)
  assert.match(explainClaudeError('Failed to authenticate: OAuth session expired'), /\/login/)
  assert.match(explainClaudeError('429 rate limit'), /上限/)
})

test('her tools over MCP: listed, called, and nobody without the token gets in', async () => {
  const mcp = await startHerMcp(() => [wave])
  try {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...mcp.config().mcpServers.her!.headers }
    const rpc = async (body: unknown, h: Record<string, string> = headers) => fetch(mcp.url, { method: 'POST', headers: h, body: JSON.stringify(body) })
    const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json() as { result: { protocolVersion: string; capabilities: unknown } }
    assert.equal(init.result.protocolVersion, '2025-06-18')
    assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
    const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json() as { result: { tools: Array<{ name: string; inputSchema: unknown }> } }
    assert.deepEqual(list.result.tools.map(t => t.name), ['play_action'])
    const called = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'play_action', arguments: { action: 'wave' } } })).json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    assert.deepEqual(called.result, { content: [{ type: 'text', text: '做了 wave' }] })
    const failed = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'play_action', arguments: { action: 'jump' } } })).json() as { result: { isError?: boolean } }
    assert.equal(failed.result.isError, true)
    const unknown = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'nope' })).json() as { error: { code: number } }
    assert.equal(unknown.error.code, -32601)
    assert.equal((await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { 'content-type': 'application/json' })).status, 401)
    assert.equal((await fetch(mcp.url, { headers })).status, 405)
  } finally {
    await mcp.close()
  }
})

test("a conversation with Claude Code: who she is, only her tools, the day's context once, notes before your words, sentences back", async () => {
  const { b, said, seen, until } = brain()
  try {
    await b.note('（备注：你刚才主动说了"早"。）')
    await b.say('你好', 'text')
    await until(() => said.includes('end committed'))
    assert.deepEqual(said.slice(1), ['你好。', '我是小禾，很高兴认识你。', 'end committed'])
    const started = seen()[0]!.started!
    const flag = (name: string) => started[started.indexOf(name) + 1]
    assert.equal(flag('--system-prompt'), '你是小禾。')
    assert.equal(flag('--tools'), '', "none of Claude Code's own tools")
    assert.equal(flag('--allowedTools'), 'mcp__her')
    assert.equal(flag('--setting-sources'), '')
    assert.ok(started.includes('--strict-mcp-config'))
    assert.match(flag('--mcp-config')!, /"her".*"type":"http"/)
    assert.equal(flag('--session-id'), b.sessionId)
    const first = seen().find(e => e.got?.type === 'user')!.got!.message!.content[0]!.text
    assert.equal(first, '（现场：今天是星期二，上午）\n（备注：你刚才主动说了"早"。）\n你好')

    said.length = 0
    await b.say('再说一次', 'voice')
    await until(() => said.includes('end committed'))
    const second = seen().filter(e => e.got?.type === 'user')[1]!.got!.message!.content[0]!.text
    assert.equal(second, '再说一次', 'the same context is not told twice')
    assert.equal(seen().filter(e => e.started !== undefined).length, 1, 'one program for the conversation')
  } finally {
    await b.dispose()
  }
})

test('cut off: the rest is not said and Claude Code is told to stop; a new prompt starts it again on the same conversation', async () => {
  let persona = '你是小禾。'
  const { b, said, seen, until } = brain({ prompt: () => persona })
  try {
    await b.say('讲个长故事', 'text')
    await until(() => said.filter(s => s.startsWith('第')).length >= 2)
    b.interrupt()
    const told = said.length
    await until(() => said.at(-1) === 'end interrupted')
    assert.ok(said.slice(told).every(s => !s.startsWith('第')), 'nothing more is said')
    assert.ok(seen().some(e => e.got?.type === 'control_request' && e.got.request?.subtype === 'interrupt'))

    const id = b.sessionId
    persona = '你是小禾，今天有点累。'
    said.length = 0
    await b.say('你好', 'text')
    await until(() => said.includes('end committed'))
    const starts = seen().filter(e => e.started !== undefined).map(e => e.started!)
    assert.equal(starts.length, 2)
    assert.equal(starts[1]![starts[1]!.indexOf('--resume') + 1], id, 'goes on with the same conversation')
    assert.equal(starts[1]![starts[1]!.indexOf('--system-prompt') + 1], '你是小禾，今天有点累。')
  } finally {
    await b.dispose()
  }
})

test('a login that expired: a reply with no words, and why in plain words; a conversation that is gone starts anew', async () => {
  const { b, dir, said, until } = brain()
  try {
    await b.say('请登录', 'text')
    await until(() => said.includes('end error'))
    assert.match(b.lastError!, /登录过期/)
    await b.dispose()

    writeFileSync(join(dir, 'claude-session.json'), JSON.stringify({ sessionId: 'gone' }))
    said.length = 0
    await b.say('你好', 'text')
    await until(() => b.sessionId === undefined)
    said.length = 0
    await b.say('你好', 'text')
    await until(() => said.includes('end committed'))
    assert.notEqual(b.sessionId, 'gone')
  } finally {
    await b.dispose()
  }
})
