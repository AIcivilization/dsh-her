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
import type { LookView, PackSummary, WindowMode } from '../protocol/index.ts'
import type { Fact, Episode } from '../memory/store.ts'
import type { ReportLine } from './import-status.ts'
import type { LookProject, WorkshopCard } from '../core/workshop.ts'
import type { ProjectStatus } from './workshop.ts'
import type { InstallState } from './body-install.ts'
import type { MingStatus } from '../voice/ming.ts'
import type { MingSettings, OwnVoice } from '../voice/ming-voices.ts'

export const API_BASE = '/api/dsh-her'

export interface StateView {
  platform: string
  character: Character
  /** The model she uses now; `chosen` = picked on the "她" page (else the config's or DSH's default). */
  model: { provider: string; model: string; effort?: string; chosen: boolean } | null
  /** status: listening (local recognition); speaking: the service of her voice; ming: the local Ming voice and her own voices. */
  voice: {
    status: string
    speaking: { status: string; service: string; error?: string }
    id: string
    speed: number
    ming: MingStatus & { installed: boolean; settings: MingSettings; own: OwnVoice[] }
  }
  body: {
    connected: boolean
    /** A body process is running (it may still be connecting). */
    running: boolean
    /** There is a body to start (the development one, or the installed app). */
    canStart: boolean
    /** The installed body app: installing, updating, a newer version waiting for a restart. */
    install: InstallState
    info?: { kind: string; version: string; os: string }
    pack?: PackSummary
    packs: PackSummary[]
    activePack?: string
    mode?: WindowMode
    /** The look on screen, with its scenes (when a look rather than a single pack is chosen). */
    look?: LookView
    /** The body's screens (logical size, scale), for advice on sizes. */
    screens?: Array<{ w: number; h: number; scale: number }>
  }
  import: { state: 'idle' | 'picking' | 'running' | 'done' | 'failed'; done: number; total: number; step: string; lines: ReportLine[] }
  heard?: { text: string; at: number }
  /** Her last reply failed with no words (the model had no key, no quota …): why, and what to do. */
  problem?: { text: string; at: number }
  memory: { facts: Fact[]; episodes: Episode[]; diary: string[]; lastDigestDay: string | null }
}

export interface ApiRuntime {
  state(): StateView
  saveCharacter(patch: Partial<Character>): Character
  expandPersona(input: { name: string; idea: string; callYou: string; pronoun: string }): Promise<string>
  tryPersona(input: { name: string; persona: string; callYou: string; pronoun: string; history: Array<{ who: 'you' | 'her'; text: string }>; message: string }): Promise<string>
  previewVoice(id: string, speed: number, text: string): Promise<{ audio: string; format: 'wav' | 'mp3'; durationMs: number }>
  /** The local Ming voice: install (progress shows in the state), uninstall, start again after errors, settings. */
  mingInstall(): void
  mingUninstall(): void
  mingRestart(): Promise<void>
  mingSettings(patch: Partial<MingSettings>): void
  /** Three takes of a voice from its description, each kept as a draft to listen to. */
  mingDesign(description: string): Promise<Array<{ id: string; audio: string; durationMs: number }>>
  /** A recording to clone (base64, its file name for the format): a draft, with what it says as recognized. */
  mingClone(audio: string, name: string): Promise<{ id: string; audio: string; durationMs: number; text: string }>
  /** Keep a draft as one of her voices (a clone needs consent and the recording's words). */
  mingKeep(draft: string, name: string, change: { text?: string; consent?: boolean }): OwnVoice
  mingRemove(id: string): void
  startBody(): string
  /** Download and install the body app (or a newer one); progress shows in the state. */
  installBody(): void
  /** Stop the running body and start it again (to use a newly installed version). */
  restartBody(): Promise<void>
  setMode(mode: WindowMode): void
  pickPack(): void
  usePack(packId: string): void
  setLook(change: { auto?: boolean; locked?: boolean; go?: string; on?: Record<string, boolean> }): void
  /** 形象工坊: projects in the materials folder; create, save, open, frame a scene, import. */
  workshopList(): Array<{ project: LookProject; status: ProjectStatus }>
  workshopNew(name: string): { project: LookProject; status: ProjectStatus }
  workshopSave(project: unknown): { project: LookProject; status: ProjectStatus }
  /** Copy a project to a folder the user picks on the body (undefined: cancelled). */
  workshopExport(id: string, media: boolean): Promise<{ dir: string; files: number } | undefined>
  /** Bring in a project folder (or its 形象.json) the user picks on the body. */
  workshopImportProject(): Promise<{ project: LookProject; status: ProjectStatus } | undefined>
  workshopExamples(): Array<{ card: WorkshopCard; file: string; label: string; ready: boolean }>
  workshopOpen(id: string): void
  workshopFrame(id: string, sceneId: string): void
  workshopImport(id: string): void
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
      if (body.voice !== undefined || body.speed !== undefined) {
        const current = rt.state().character.voice
        patch.voice = { id: body.voice === undefined ? current.id : str(body.voice, '音色'), speed: body.speed === undefined ? current.speed : num(body.speed, '语速') }
      }
      if (body.onboarded !== undefined) patch.onboarded = body.onboarded === true
      if (body.model !== undefined) {
        if (body.model === null) patch.model = undefined
        else {
          const m = body.model as Record<string, unknown>
          patch.model = { provider: str(m.provider, '模型'), model: str(m.model, '模型'), ...(m.effort ? { effort: str(m.effort, '思考强度') } : {}) }
        }
      }
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
    '/voice/preview': async body => rt.previewVoice(str(body.voice, '音色'), num(body.speed ?? 1, '语速'), str(body.text ?? '你好呀，我在你桌面上等你好久啦。', '试听的话')),
    '/voice/ming/install': async () => {
      rt.mingInstall()
      return withState()
    },
    '/voice/ming/uninstall': async () => {
      rt.mingUninstall()
      return withState()
    },
    '/voice/ming/restart': async () => {
      await rt.mingRestart()
      return withState()
    },
    '/voice/ming/settings': async body => {
      const patch: Partial<MingSettings> = {}
      if (body.quality === 'quality' || body.quality === 'speed') patch.quality = body.quality
      if (typeof body.moods === 'boolean') patch.moods = body.moods
      if (body.idleMinutes !== undefined) {
        // -1: back to the default for this Mac's memory.
        const minutes = num(body.idleMinutes, '停止前的分钟数')
        if (minutes !== -1 && (minutes < 0 || minutes > 24 * 60)) throw new ApiError('停止前的分钟数不对')
        Object.assign(patch, { idleMinutes: minutes === -1 ? undefined : minutes })
      }
      rt.mingSettings(patch)
      return withState()
    },
    '/voice/ming/design': async body => {
      const description = str(body.description, '声音描述').trim()
      if (description.length < 4 || description.length > 300) throw new ApiError('声音描述写 4 到 300 个字')
      return { drafts: await rt.mingDesign(description) }
    },
    '/voice/ming/clone': async body => {
      const audio = str(body.audio, '录音')
      // About 20 MB of recording: far more than the 15 seconds that are used.
      if (audio.length > 28_000_000) throw new ApiError('录音文件太大了，剪一段 15 秒以内的')
      return { draft: await rt.mingClone(audio, str(body.name ?? 'recording.wav', '文件名')) }
    },
    '/voice/ming/keep': async body => {
      const change: { text?: string; consent?: boolean } = {}
      if (body.text !== undefined) change.text = str(body.text, '录音里说的话')
      if (body.consent !== undefined) change.consent = body.consent === true
      return withState({ voice: rt.mingKeep(str(body.draft, '试听'), str(body.name, '名字'), change) })
    },
    '/voice/ming/remove': async body => {
      rt.mingRemove(str(body.id, '声音'))
      return withState()
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
    '/look/set': async body => {
      const change: Parameters<ApiRuntime['setLook']>[0] = {}
      if (typeof body.auto === 'boolean') change.auto = body.auto
      if (typeof body.locked === 'boolean') change.locked = body.locked
      if (typeof body.go === 'string') change.go = body.go
      if (typeof body.on === 'object' && body.on !== null) {
        change.on = Object.fromEntries(Object.entries(body.on as Record<string, unknown>).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>
      }
      rt.setLook(change)
      return withState()
    },
    '/body/install': async () => {
      rt.installBody()
      return withState()
    },
    '/body/restart': async () => {
      await rt.restartBody()
      return withState()
    },
    '/workshop/list': async () => ({ projects: rt.workshopList() }),
    '/workshop/new': async body => rt.workshopNew(str(body.name, '名字').trim()),
    '/workshop/save': async body => rt.workshopSave(body.project),
    '/workshop/export': async body => (await rt.workshopExport(str(body.id, '项目'), body.media === true)) ?? { cancelled: true },
    '/workshop/import-project': async () => (await rt.workshopImportProject()) ?? { cancelled: true },
    '/workshop/examples': async () => ({ examples: rt.workshopExamples() }),
    '/workshop/open': async body => {
      rt.workshopOpen(str(body.id, '项目'))
      return {}
    },
    '/workshop/frame': async body => {
      rt.workshopFrame(str(body.id, '项目'), str(body.scene, '场景'))
      return {}
    },
    '/workshop/import': async body => {
      rt.workshopImport(str(body.id, '项目'))
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
