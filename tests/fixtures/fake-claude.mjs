// A stand-in for `claude -p --input-format stream-json --output-format stream-json --include-partial-messages`:
// the messages it prints are the shapes Claude Code prints. It writes what it was started with and what it
// was sent to FAKE_CLAUDE_LOG (one JSON per line), and answers by what the user message contains.
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const log = (entry) => { if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(entry)}\n`) }
const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const args = process.argv.slice(2)
const at = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const session = at('--resume') ?? at('--session-id') ?? 'none'
log({ started: args })
if (at('--resume') === 'gone') {
  process.stderr.write('No conversation found with session ID: gone\n')
  process.exit(1)
}
let telling
const delta = (text) => out({ type: 'stream_event', session_id: session, parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } })
const result = (extra) => out({ type: 'result', subtype: 'success', is_error: false, session_id: session, ...extra })
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  log({ got: message })
  if (message.type === 'control_request' && message.request.subtype === 'interrupt') {
    clearInterval(telling)
    telling = undefined
    out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } })
    result({ subtype: 'error_during_execution', is_error: true, result: '' })
    return
  }
  if (message.type !== 'user') return
  const text = message.message.content.map((c) => c.text).join('')
  out({ type: 'system', subtype: 'init', session_id: session, tools: [], mcp_servers: [{ name: 'her', status: 'connected' }] })
  if (text.includes('登录')) {
    result({ is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' })
    return
  }
  out({ type: 'stream_event', session_id: session, parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1' } } })
  if (text.includes('长故事')) {
    let n = 0
    telling = setInterval(() => delta(`第${++n}句。`), 20)
    return
  }
  delta('你好')
  delta('。我是小禾，')
  delta('很高兴认识你。')
  out({ type: 'stream_event', session_id: session, parent_tool_use_id: null, event: { type: 'message_stop' } })
  result({ result: '你好。我是小禾，很高兴认识你。' })
})
