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
import type { BodyMessage, LookView, PackSummary, TalkView, WindowMode } from '../protocol/index.ts'
import type { WebConfig, WebMode, WebPlace, WebScope } from './web-body.ts'

/** Her small picture in the page, and its moving version when she has one. */
export interface AvatarView {
  url: string
  clipUrl?: string
  /** How much of its bottom hangs below the table's edge. */
  overhang: number
}
import type { Fact, Episode } from '../memory/store.ts'
import type { ReportLine } from './import-status.ts'
import type { LookProject, WorkshopCard } from '../core/workshop.ts'
import type { ProjectStatus } from './workshop.ts'
import type { InstallState, ManualInstall } from './body-install.ts'
import type { MingStatus } from '../voice/ming.ts'
import type { MingSettings, OwnVoice } from '../voice/ming-voices.ts'

import type { InitiativeSettings, PersonaFromCard, SplitSettings } from '../core/index.ts'
import type { FocusChoice, InitiativeView } from './initiative.ts'
import type { Preset } from './presets.ts'

export const API_BASE = '/api/dsh-her'

export interface StateView {
  platform: string
  /** This plugin's version. */
  version: string
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
    /** This computer can have the desktop body; else she only lives in the web page (a VPS, Linux). */
    desktopExists: boolean
    /** The installed body app: installing, updating, a newer version waiting for a restart. */
    install: InstallState
    info?: { kind: string; version: string; os: string }
    pack?: PackSummary
    packs: PackSummary[]
    activePack?: string
    mode?: WindowMode
    /** The look on screen, with its scenes (when a look rather than a single pack is chosen). */
    look?: LookView
    /** The web body: she in DSH's own page (no desktop needed). */
    web: { mode: WebMode; connected: boolean; show: boolean; place: WebPlace; scope: WebScope; canBackground: boolean; avatar?: AvatarView }
    /** The body's screens (logical size, scale), for advice on sizes. */
    screens?: Array<{ w: number; h: number; scale: number }>
  }
  import: { state: 'idle' | 'picking' | 'running' | 'done' | 'failed'; done: number; total: number; step: string; lines: ReportLine[] }
  heard?: { text: string; at: number }
  /** Her conversations: the bar's lines, this one and the earlier ones, when a new one starts by itself. */
  talk: TalkView & { split: SplitSettings; current: string | null }
  /** Her speaking first: settings, focus, and why she is quiet right now. */
  initiative: InitiativeView
  /** Ready-made looks offered on the release, and the one being fetched. */
  presets: { list: Preset[]; active?: { id: string; state: 'downloading' | 'failed'; done: number; total: number; error?: string } }
  /** Her last reply failed with no words (the model had no key, no quota …): why, and what to do. */
  problem?: { text: string; at: number }
  memory: { facts: Fact[]; episodes: Episode[]; diary: string[]; lastDigestDay: string | null }
}

export interface ApiRuntime {
  state(): StateView
  saveCharacter(patch: Partial<Character>): Character
  expandPersona(input: { name: string; idea: string; callYou: string; pronoun: string }): Promise<string>
  tryPersona(input: { name: string; persona: string; callYou: string; pronoun: string; history: Array<{ who: 'you' | 'her'; text: string }>; message: string }): Promise<string>
  /** A persona card someone has, written up as her name and persona (not saved). */
  personaFromCard(text: string): Promise<PersonaFromCard>
  talkNew(): Promise<void>
  talkResume(id: string): Promise<void>
  /** Ask a dsh page to open this conversation (the next one that checks in). */
  talkOpen(): void
  talkSplit(change: Partial<SplitSettings>): void
  initiativeSet(change: Partial<InitiativeSettings>): void
  initiativeFocus(choice: FocusChoice): void
  /** Have her say something now; what she said. */
  initiativeTry(): Promise<string>
  /** Read the list of ready-made looks, with their pictures. */
  presetsRefresh(): Promise<Preset[]>
  /** Download a ready-made look and show it (progress in the state). */
  presetUse(id: string): void
  presetCancel(): void
  previewVoice(id: string, speed: number, text: string): Promise<{ audio: string; format: 'wav' | 'mp3'; durationMs: number }>
  /** Downloading the body by hand: the links, where the file goes, whether it is there yet. */
  bodyManual(): Promise<ManualInstall>
  /** Check and install the zip downloaded by hand. */
  bodyInstallDownloaded(): Promise<void>
  bodyCancelDownload(): void
  bodyOpenFolder(): void
  /** The web body: whether to show, her config, a message from the page, the setting. */
  /** `remote`: the page is open on another device than the one running dsh. */
  webStatus(screen: { w: number; h: number; scale: number } | undefined, remote: boolean): { show: boolean; mode: WebMode; place: WebPlace; scope: WebScope; focus: boolean; open?: string; avatar?: AvatarView }
  /** A new folder for files coming from the browser, and importing it as a pack (with no desktop body). */
  webNewBatch(): string
  importBatch(batch: string, name?: string): Promise<void>
  /** Framing a 形象工坊 scene in the page: its photo and region, and saving the region. */
  workshopFrameInfo(id: string, sceneId: string): Promise<{ width: number; height: number; file: string; region?: { x: number; y: number; width: number; height: number } }>
  workshopFrameSave(id: string, sceneId: string, region: { x: number; y: number; width: number; height: number }): Promise<ProjectStatus>
  webConfig(remote: boolean): WebConfig
  webSend(message: BodyMessage): void
  webSetPlace(change: { place?: WebPlace; scope?: WebScope }): void
  webSetMode(mode: WebMode): void
  /** The newest plugin on npm, for hosts without dshmarket (which otherwise answers this). */
  pluginLatest(): Promise<{ latest: string; updateAvailable: boolean }>
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
  /** Make her small picture from the uploaded one. */
  workshopAvatar(id: string): Promise<ProjectStatus>
  /** The same, moving, from the uploaded clip. */
  workshopAvatarClip(id: string): Promise<ProjectStatus>
  /** A video in a part's folder is this clip; or it is not wanted. */
  workshopAssignClip(id: string, folder: string, file: string, clip: string): { project: LookProject; status: ProjectStatus }
  workshopRemoveStray(id: string, folder: string, file: string): ProjectStatus
  workshopImport(id: string): void | Promise<void>
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
    '/persona/card': async body => ({ card: await rt.personaFromCard(str(body.text, '人设卡')) }),
    '/initiative/set': async body => {
      const change: Partial<InitiativeSettings> = {}
      if (body.on !== undefined) change.on = body.on === true
      if (body.perDay !== undefined) change.perDay = num(body.perDay, '次数')
      if (body.quietFrom !== undefined) change.quietFrom = num(body.quietFrom, '安静时段')
      if (body.quietTo !== undefined) change.quietTo = num(body.quietTo, '安静时段')
      rt.initiativeSet(change)
      if (body.focus !== undefined) {
        const focus = str(body.focus, '专注')
        if (focus !== 'off' && focus !== 'span' && focus !== 'always') throw new ApiError('专注的选项不对')
        rt.initiativeFocus(focus)
      }
      return withState()
    },
    '/talk/state': async () => ({ talk: rt.state().talk }),
    '/talk/new': async () => {
      await rt.talkNew()
      return withState()
    },
    '/talk/resume': async body => {
      await rt.talkResume(str(body.id, '对话'))
      return withState()
    },
    '/talk/open': async () => {
      rt.talkOpen()
      return withState()
    },
    '/talk/split': async body => {
      const hours = body.idleHours === null ? null : body.idleHours === undefined ? undefined : num(body.idleHours, '时间')
      const tokens = body.maxTokens === null ? null : body.maxTokens === undefined ? undefined : num(body.maxTokens, '长度')
      rt.talkSplit({ ...(hours === undefined ? {} : { idleHours: hours }), ...(tokens === undefined ? {} : { maxTokens: tokens }), ...(body.daily === undefined ? {} : { daily: body.daily === true }) })
      return withState()
    },
    '/initiative/try': async () => ({ said: await rt.initiativeTry(), state: rt.state() }),
    '/presets/list': async () => ({ presets: await rt.presetsRefresh(), state: rt.state() }),
    '/presets/use': async body => {
      rt.presetUse(str(body.id, '预设'))
      return withState()
    },
    '/presets/cancel': async () => {
      rt.presetCancel()
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
    '/update/plugin-latest': async () => rt.pluginLatest(),
    '/web/status': async body => {
      const s = body.screen as { w?: unknown; h?: unknown; scale?: unknown } | undefined
      const screen = typeof s?.w === 'number' && typeof s.h === 'number' && typeof s.scale === 'number' ? { w: s.w, h: s.h, scale: s.scale } : undefined
      return rt.webStatus(screen, body.remote === true)
    },
    '/web/new-batch': async () => ({ batch: rt.webNewBatch() }),
    '/web/import-batch': async body => {
      await rt.importBatch(str(body.batch, '上传'), typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : undefined)
      return withState()
    },
    '/workshop/frame-info': async body => rt.workshopFrameInfo(str(body.id, '项目'), str(body.scene, '场景')),
    '/workshop/frame-save': async body => {
      const r = body.region as Record<string, unknown> | undefined
      return { status: await rt.workshopFrameSave(str(body.id, '项目'), str(body.scene, '场景'), { x: num(r?.x, '人物区'), y: num(r?.y, '人物区'), width: num(r?.width, '人物区'), height: num(r?.height, '人物区') }) }
    },
    '/web/config': async body => ({ config: rt.webConfig(body.remote === true) }),
    '/web/send': async body => {
      const message = body.message as BodyMessage | undefined
      if (typeof message?.t !== 'string') throw new ApiError('消息不对')
      rt.webSend(message)
      return {}
    },
    '/web/place': async body => {
      const place = body.place
      const scope = body.scope
      if (place !== undefined && place !== 'pet' && place !== 'background') throw new ApiError('放置方式不对')
      if (scope !== undefined && scope !== 'page' && scope !== 'chat') throw new ApiError('背景范围不对')
      rt.webSetPlace({ ...(place === undefined ? {} : { place }), ...(scope === undefined ? {} : { scope }) })
      return withState()
    },
    '/web/set': async body => {
      const mode = str(body.mode, '显示方式')
      if (mode !== 'auto' && mode !== 'on' && mode !== 'off') throw new ApiError('显示方式不对')
      rt.webSetMode(mode)
      return withState()
    },
    '/body/manual': async () => ({ manual: await rt.bodyManual() }),
    '/body/install-downloaded': async () => {
      await rt.bodyInstallDownloaded()
      return withState()
    },
    '/body/cancel': async () => {
      rt.bodyCancelDownload()
      return withState()
    },
    '/body/open-folder': async () => {
      rt.bodyOpenFolder()
      return {}
    },
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
    '/workshop/avatar': async body => ({ status: await rt.workshopAvatar(str(body.id, '项目')) }),
    '/workshop/avatar-clip': async body => ({ status: await rt.workshopAvatarClip(str(body.id, '项目')) }),
    '/workshop/assign-clip': async body => rt.workshopAssignClip(str(body.id, '项目'), str(body.folder, '部分'), str(body.file, '文件'), str(body.clip, '片段')),
    '/workshop/remove-stray': async body => ({ status: rt.workshopRemoveStray(str(body.id, '项目'), str(body.folder, '部分'), str(body.file, '文件')) }),
    '/workshop/import': async body => {
      await rt.workshopImport(str(body.id, '项目'))
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
