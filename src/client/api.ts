// Calls to the plugin's endpoints on DSH's own authenticated `/api` channel.

import type { StateView } from '../dsh/api.ts'

export type { StateView }

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
  previewVoice: (sid: number, speed: number, text?: string) => post<{ wav: string; durationMs: number }>('/voice/preview', { sid, speed, ...(text === undefined ? {} : { text }) }),
  startBody: () => post<WithState & { message: string }>('/body/start'),
  setMode: (mode: string) => post<WithState>('/body/mode', { mode }),
  pickPack: () => post<WithState>('/pack/pick'),
  usePack: (packId: string) => post<WithState>('/pack/use', { packId }),
  memoryRemove: (ids: string[]) => post<WithState & { removed: number }>('/memory/remove', { ids }),
  memoryConfirm: (ids: string[]) => post<WithState & { confirmed: number }>('/memory/confirm', { ids }),
  digest: () => post<WithState & { report: string }>('/memory/digest'),
  exportMemory: () => post<{ markdown: string }>('/memory/export'),
}

/** Play a WAV given as base64. */
export function playWav(base64: string): void {
  void new Audio(`data:audio/wav;base64,${base64}`).play()
}
