/**
 * HTTP endpoints for the "她" page, on DSH's own authenticated `/api` channel
 * (`ctx.connection.fetch`), so every request has already passed DSH's browser
 * authentication before it gets here.
 *
 * Every endpoint is POST with a JSON body and answers `{ ok: true, … }` or
 * `{ ok: false, message }`. The page polls `/state`; changes answer with the
 * fresh state, so the page never shows something the brain does not have.
 */

import type { Character } from '../core/index.ts'
import type { PackSummary, WindowMode } from '../protocol/index.ts'
import type { Fact, Episode } from '../memory/store.ts'
import type { ReportLine } from './import-status.ts'

export const API_BASE = '/api/dsh-her'

export interface StateView {
  platform: string
  character: Character
  model: { provider: string; model: string } | null
  voice: { status: string; sid: number; speed: number }
  body: {
    connected: boolean
    /** A body process is running (it may still be connecting). */
    running: boolean
    /** This install can start a development body. */
    canStart: boolean
    info?: { kind: string; version: string; os: string }
    pack?: PackSummary
    packs: PackSummary[]
    activePack?: string
    mode?: WindowMode
  }
  import: { state: 'idle' | 'picking' | 'running' | 'done' | 'failed'; done: number; total: number; step: string; lines: ReportLine[] }
  heard?: { text: string; at: number }
  memory: { facts: Fact[]; episodes: Episode[]; diary: string[]; lastDigestDay: string | null }
}

export interface ApiRuntime {
  state(): StateView
  saveCharacter(patch: Partial<Character>): Character
  expandPersona(input: { name: string; idea: string; callYou: string; pronoun: string }): Promise<string>
  tryPersona(input: { name: string; persona: string; callYou: string; pronoun: string; history: Array<{ who: 'you' | 'her'; text: string }>; message: string }): Promise<string>
  previewVoice(sid: number, speed: number, text: string): Promise<{ wav: string; durationMs: number } | undefined>
  startBody(): string
  setMode(mode: WindowMode): void
  pickPack(): void
  usePack(packId: string): void
  memoryRemove(ids: string[]): number
  memoryConfirm(ids: string[]): number
  digest(): Promise<string>
  exportMemory(): string
}

type Body = Record<string, unknown>
type Handler = (body: Body) => Promise<Record<string, unknown>>

class ApiError extends Error {}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string') throw new ApiError(`${name} 不对`)
  return v
}
const num = (v: unknown, name: string): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new ApiError(`${name} 不对`)
  return n
}
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : [])

const MODES = new Set<WindowMode>(['overlay', 'wallpaper', 'window'])

export function apiHandlers(rt: ApiRuntime): Record<string, Handler> {
  const withState = (extra: Record<string, unknown> = {}) => ({ ...extra, state: rt.state() })
  return {
    '/state': async () => withState(),
    '/character': async body => {
      const patch: Partial<Character> = {}
      if (body.name !== undefined) patch.name = str(body.name, '名字').trim()
      if (body.persona !== undefined) patch.persona = str(body.persona, '人设').trim()
      if (body.callYou !== undefined) patch.callYou = str(body.callYou, '称呼').trim()
      if (body.pronoun !== undefined) {
        const p = str(body.pronoun, '人称')
        if (p !== '他' && p !== '她' && p !== 'TA') throw new ApiError('人称只能是 他 / 她 / TA')
        patch.pronoun = p
      }
      if (body.sid !== undefined || body.speed !== undefined) {
        const current = rt.state().character.voice
        patch.voice = { sid: body.sid === undefined ? current.sid : num(body.sid, '音色'), speed: body.speed === undefined ? current.speed : num(body.speed, '语速') }
      }
      if (body.onboarded !== undefined) patch.onboarded = body.onboarded === true
      rt.saveCharacter(patch)
      return withState()
    },
    '/persona/expand': async body => ({
      persona: await rt.expandPersona({ name: str(body.name, '名字'), idea: str(body.idea, '描述'), callYou: str(body.callYou ?? '', '称呼'), pronoun: str(body.pronoun ?? '他', '人称') }),
    }),
    '/persona/try': async body => ({
      reply: await rt.tryPersona({
        name: str(body.name, '名字'), persona: str(body.persona, '人设'), callYou: str(body.callYou ?? '', '称呼'), pronoun: str(body.pronoun ?? '他', '人称'),
        history: Array.isArray(body.history) ? (body.history as Array<{ who: 'you' | 'her'; text: string }>).slice(-6) : [],
        message: str(body.message, '消息'),
      }),
    }),
    '/voice/preview': async body => {
      const audio = await rt.previewVoice(num(body.sid, '音色'), num(body.speed ?? 1, '语速'), str(body.text ?? '你好呀，我在你桌面上等你好久啦。', '试听的话'))
      if (audio === undefined) throw new ApiError('她的声音还没准备好（语音模型可能还在下载）')
      return audio
    },
    '/body/start': async () => withState({ message: rt.startBody() }),
    '/body/mode': async body => {
      const mode = str(body.mode, '模式') as WindowMode
      if (!MODES.has(mode)) throw new ApiError('模式不对')
      rt.setMode(mode)
      return withState()
    },
    '/pack/pick': async () => {
      rt.pickPack()
      return withState()
    },
    '/pack/use': async body => {
      rt.usePack(str(body.packId, '外形包'))
      return withState()
    },
    '/memory/remove': async body => withState({ removed: rt.memoryRemove(ids(body.ids)) }),
    '/memory/confirm': async body => withState({ confirmed: rt.memoryConfirm(ids(body.ids)) }),
    '/memory/digest': async () => withState({ report: await rt.digest() }),
    '/memory/export': async () => ({ markdown: rt.exportMemory() }),
  }
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function handle(handler: Handler, request: Request): Promise<Response> {
  let body: Body = {}
  try {
    const text = await request.text()
    body = text === '' ? {} : JSON.parse(text) as Body
  } catch {
    return json(400, { ok: false, message: '请求不是 JSON' })
  }
  try {
    return json(200, { ok: true, ...(await handler(body)) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json(error instanceof ApiError ? 400 : 500, { ok: false, message })
  }
}
