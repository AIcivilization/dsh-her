/**
 * Her tools (src/engine/her-tools.ts) as an MCP server on this computer, for
 * a front brain that takes tools over MCP (Claude Code now, Codex next).
 * The smallest Streamable HTTP server that does: one POST endpoint answering
 * JSON-RPC with JSON (no event stream), `initialize`, `tools/list`,
 * `tools/call`, `ping`. It listens on 127.0.0.1 only and wants a bearer
 * token, so nothing else on the computer can call her tools.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { HerTool } from './her-tools.ts'

const MAX_BODY = 1024 * 1024

export interface HerMcp {
  /** For `--mcp-config`: `{ mcpServers: { her: … } }`. */
  config(): { mcpServers: Record<string, { type: 'http'; url: string; headers: Record<string, string> }> }
  readonly url: string
  close(): Promise<void>
}

const answer = (res: ServerResponse, status: number, body?: unknown) => {
  res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const parts: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
      } else parts.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
}

/** Serve `tools()` (asked again on every list and call, so they follow the character of now). */
export async function startHerMcp(tools: () => HerTool[], log: (entry: Record<string, unknown>) => void = () => {}): Promise<HerMcp> {
  const token = randomBytes(24).toString('base64url')
  const expected = Buffer.from(`Bearer ${token}`)
  const call = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'her', version: '1' },
        }
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: tools().map(t => ({ name: t.name, description: t.description, inputSchema: t.parameters })) }
      case 'tools/call': {
        const tool = tools().find(t => t.name === params.name)
        if (tool === undefined) return { content: [{ type: 'text', text: `没有这个工具：${String(params.name)}` }], isError: true }
        try {
          const result = await tool.execute((params.arguments ?? {}) as Record<string, unknown>)
          log({ event: 'tool', name: tool.name, ok: result.ok !== false })
          return { content: [{ type: 'text', text: result.text }], ...(result.ok === false ? { isError: true } : {}) }
        } catch (error) {
          return { content: [{ type: 'text', text: `出错了：${(error as Error).message}` }], isError: true }
        }
      }
      default:
        throw Object.assign(new Error(`unknown method ${method}`), { code: -32601 })
    }
  }
  const server: Server = createServer((req, res) => {
    const given = Buffer.from(String(req.headers.authorization ?? ''))
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return answer(res, 401)
    if (req.method !== 'POST') return answer(res, 405)
    void readBody(req).then(async text => {
      let message: unknown
      try {
        message = JSON.parse(text)
      } catch {
        return answer(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
      }
      const handle = async (m: { id?: unknown; method?: unknown; params?: unknown }) => {
        if (typeof m.method !== 'string') return { jsonrpc: '2.0', id: m.id ?? null, error: { code: -32600, message: 'invalid request' } }
        // A notification (no id) gets no answer.
        if (m.id === undefined) return undefined
        try {
          return { jsonrpc: '2.0', id: m.id, result: await call(m.method, (m.params ?? {}) as Record<string, unknown>) }
        } catch (error) {
          return { jsonrpc: '2.0', id: m.id, error: { code: (error as { code?: number }).code ?? -32603, message: (error as Error).message } }
        }
      }
      if (Array.isArray(message)) {
        const out = (await Promise.all(message.map(m => handle(m as Record<string, unknown>)))).filter(r => r !== undefined)
        return out.length === 0 ? answer(res, 202) : answer(res, 200, out)
      }
      const out = await handle(message as Record<string, unknown>)
      return out === undefined ? answer(res, 202) : answer(res, 200, out)
    }, () => answer(res, 413))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as { port: number }
  const url = `http://127.0.0.1:${port}/mcp`
  return {
    url,
    config: () => ({ mcpServers: { her: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}
