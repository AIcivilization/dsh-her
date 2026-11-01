// Calls to the plugin's endpoints on DSH's own authenticated `/api` channel.

import type { StateView } from '../dsh/api.ts'
import type { ManualInstall } from '../dsh/body-install.ts'
import type { LookProject, WorkshopCard } from '../core/workshop.ts'
import type { ProjectStatus } from '../dsh/workshop.ts'

export type { StateView }

/** A take of a Ming voice to listen to before keeping it (WAV, base64). */
export interface MingDraft {
  id: string
  audio: string
  durationMs: number
}

export type Result<T> = ({ ok: true } & T) | { ok: false; message: string }

async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<Result<T>> {
  try {
    const res = await fetch(new URL(`/api/dsh-her${path}`, document.baseURI), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const value = await res.json().catch(() => null) as Result<T> | null
    if (value === null) return { ok: false, message: `HTTP ${res.status}` }
    return value
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

type WithState = { state: StateView }

export const herApi = {
  state: () => post<WithState>('/state'),
  saveCharacter: (patch: Record<string, unknown>) => post<WithState>('/character', patch),
  expandPersona: (input: { name: string; idea: string; callYou: string; pronoun: string }) => post<{ persona: string }>('/persona/expand', input),
  tryPersona: (input: { name: string; persona: string; callYou: string; pronoun: string; history: Array<{ who: 'you' | 'her'; text: string }>; message: string }) =>
    post<{ reply: string }>('/persona/try', input),
  previewVoice: (voice: string, speed: number, text?: string) => post<{ audio: string; format: 'wav' | 'mp3'; durationMs: number }>('/voice/preview', { voice, speed, ...(text === undefined ? {} : { text }) }),
  bodyManual: () => post<{ manual: ManualInstall }>('/body/manual'),
  bodyInstallDownloaded: () => post<WithState>('/body/install-downloaded'),
  bodyCancel: () => post<WithState>('/body/cancel'),
  bodyOpenFolder: () => post<Record<string, never>>('/body/open-folder'),
  webSet: (mode: 'auto' | 'on' | 'off') => post<WithState>('/web/set', { mode }),
  pluginLatest: () => post<{ latest: string; updateAvailable: boolean }>('/update/plugin-latest'),
  mingInstall: () => post<WithState>('/voice/ming/install'),
  mingUninstall: () => post<WithState>('/voice/ming/uninstall'),
  mingRestart: () => post<WithState>('/voice/ming/restart'),
  mingSettings: (patch: { quality?: 'quality' | 'speed'; moods?: boolean; idleMinutes?: number }) => post<WithState>('/voice/ming/settings', patch),
  mingDesign: (description: string) => post<{ drafts: MingDraft[] }>('/voice/ming/design', { description }),
  mingClone: (audio: string, name: string) => post<{ draft: MingDraft & { text: string } }>('/voice/ming/clone', { audio, name }),
  mingKeep: (draft: string, name: string, change: { text?: string; consent?: boolean } = {}) => post<WithState & { voice: { id: string } }>('/voice/ming/keep', { draft, name, ...change }),
  mingRemove: (id: string) => post<WithState>('/voice/ming/remove', { id }),
  startBody: () => post<WithState & { message: string }>('/body/start'),
  installBody: () => post<WithState>('/body/install'),
  restartBody: () => post<WithState>('/body/restart'),
  setMode: (mode: string) => post<WithState>('/body/mode', { mode }),
  pickPack: () => post<WithState>('/pack/pick'),
  usePack: (packId: string) => post<WithState>('/pack/use', { packId }),
  workshopList: () => post<{ projects: Array<{ project: LookProject; status: ProjectStatus }> }>('/workshop/list'),
  workshopNew: (name: string) => post<{ project: LookProject; status: ProjectStatus }>('/workshop/new', { name }),
  workshopSave: (project: LookProject) => post<{ project: LookProject; status: ProjectStatus }>('/workshop/save', { project }),
  workshopExport: (id: string, media: boolean) => post<{ dir: string; files: number } | { cancelled: true }>('/workshop/export', { id, media }),
  workshopImportProject: () => post<{ project: LookProject; status: ProjectStatus } | { cancelled: true }>('/workshop/import-project'),
  workshopExamples: () => post<{ examples: Array<{ card: WorkshopCard; file: string; label: string; ready: boolean }> }>('/workshop/examples'),
  workshopOpen: (id: string) => post<Record<string, never>>('/workshop/open', { id }),
  workshopFrame: (id: string, scene: string) => post<Record<string, never>>('/workshop/frame', { id, scene }),
  workshopImport: (id: string) => post<WithState>('/workshop/import', { id }),
  setLook: (change: { auto?: boolean; locked?: boolean; go?: string; on?: Record<string, boolean> }) => post<WithState>('/look/set', change),
  memoryRemove: (ids: string[]) => post<WithState & { removed: number }>('/memory/remove', { ids }),
  memoryConfirm: (ids: string[]) => post<WithState & { confirmed: number }>('/memory/confirm', { ids }),
  digest: () => post<WithState & { report: string }>('/memory/digest'),
  exportMemory: () => post<{ markdown: string }>('/memory/export'),
}

export interface ModelGroup {
  id: string
  name: string
  models: Array<{ id: string; name: string; reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string } }>
}

/** The models DSH can route to, grouped by provider: the same call DSH's own model picker makes. */
export async function modelCatalog(): Promise<Result<{ default?: { provider: string; model: string }; groups: ModelGroup[] }>> {
  try {
    const res = await fetch(new URL('/api/session/modelCatalog', document.baseURI), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/modelCatalog', payload: { args: {} } }),
    })
    const reply = await res.json() as { result?: { ok: boolean; value?: { default?: { provider: string; model: string }; routableProviders?: string[]; groups?: ModelGroup[] }; error?: { message?: string } } }
    const value = reply.result?.value
    if (reply.result?.ok !== true || value === undefined) return { ok: false, message: reply.result?.error?.message ?? `HTTP ${res.status}` }
    const routable = value.routableProviders
    const groups = (value.groups ?? []).filter(g => routable === undefined || routable.includes(g.id))
    return { ok: true, groups, ...(value.default === undefined ? {} : { default: value.default }) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** Play audio (WAV or MP3) given as base64. */
export function playAudio(base64: string, format: 'wav' | 'mp3'): void {
  void new Audio(`data:audio/${format === 'mp3' ? 'mpeg' : 'wav'};base64,${base64}`).play()
}
