/**
 * Her own tools, once for every front brain (src/engine/front-brain.ts):
 * `play_action` (a longer performance by her body) and `remember`, `recall`,
 * `forget` (her memory). Plain JSON Schema and an `execute` that answers in
 * words: DSH registers them as native tools (src/dsh/her-session.ts), Claude
 * Code and Codex will get them over MCP.
 */

import type { MemoryProvider } from '../memory/store.ts'

export interface HerTool {
  name: string
  description: string
  /** JSON Schema of the arguments (an object). */
  parameters: Record<string, unknown>
  execute(args: Record<string, unknown>): Promise<{ ok?: boolean; text: string }>
}

export interface HerToolDeps {
  /** Have the body perform an action; resolves when it is done. */
  playAction: (action: string) => Promise<{ ok: boolean; reason?: string; transcript?: string }>
  memory: MemoryProvider
  now?: () => Date
}

const WHY_NOT: Record<string, string> = { unsupported: '身体不会这个表演', interrupted: '做到一半被打断了', 'no body': '桌面上没有连着身体', timeout: '等了太久没做完' }

export function herTools(deps: HerToolDeps): HerTool[] {
  const now = deps.now ?? (() => new Date())
  const { memory } = deps
  return [
    {
      name: 'play_action',
      description: '让你在桌面上的身体做一个较长的表演（离开画面换衣服、说准备好的台词等），做完才返回。能做哪些见系统提示词的"表演"一节。',
      parameters: {
        type: 'object',
        properties: { action: { type: 'string', description: '表演的名字，比如 outfit_jk' } },
        required: ['action'],
        additionalProperties: false,
      },
      async execute(args) {
        const action = String(args.action ?? '').trim()
        const result = await deps.playAction(action)
        if (result.ok) return { ok: true, text: result.transcript === undefined ? `已经做完：${action}` : `已经做完：${action}（你说了"${result.transcript}"）` }
        const why = WHY_NOT[result.reason ?? ''] ?? result.reason ?? '没做成'
        return { ok: false, text: `没做成：${action}（${why}）` }
      },
    },
    {
      name: 'remember',
      description: '记下一件关于对方的事。fact：长期成立的事实（称呼、喜好、忌讳、重要的人、生日）；event：具体的事，有日期就写 date。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '一句话，比如"他不吃香菜"、"他下周三去面试"' },
          kind: { type: 'string', enum: ['fact', 'event'] },
          date: { type: 'string', description: 'event 发生的日期 YYYY-MM-DD（把"明天""下周三"换算好）；没有就不填' },
        },
        required: ['text', 'kind'],
        additionalProperties: false,
      },
      async execute(args) {
        const date = typeof args.date === 'string' ? args.date : undefined
        const hit = memory.remember({ kind: args.kind === 'event' ? 'episode' : 'fact', text: String(args.text ?? ''), ...(date === undefined ? {} : { due: date }) }, now())
        return { text: `记下了（${hit.id}）：${hit.text}` }
      },
    },
    {
      name: 'recall',
      description: '在你的记忆里找和这个话题有关的事（关于对方的事实、发生过的事、你的日记）。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '要找的话题，比如"面试"、"猫"' } },
        required: ['query'],
        additionalProperties: false,
      },
      async execute(args) {
        const hits = memory.recall(String(args.query ?? ''), now())
        if (hits.length === 0) return { text: '没找到相关的记忆。' }
        return { text: hits.map(h => `[${h.id}] ${h.at.slice(0, 10)} ${h.text}`).join('\n') }
      },
    },
    {
      name: 'forget',
      description: '删掉记忆里的几条（id 来自 recall 的结果）。只在对方明确让你忘掉、并且确认过是哪条之后用。',
      parameters: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'string' }, description: '要删的 id，比如 ["f3", "e2"]' } },
        required: ['ids'],
        additionalProperties: false,
      },
      async execute(args) {
        const removed = memory.remove(Array.isArray(args.ids) ? args.ids.map(String) : [])
        return { text: removed === 0 ? '没有删掉任何东西（id 不对？）' : `删掉了 ${removed} 条。` }
      },
    },
  ]
}
