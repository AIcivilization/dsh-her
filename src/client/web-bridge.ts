/**
 * `window.her` for the web body (docs/网页身体设计.md): what the preload gives
 * the renderer in the desktop body, over DSH's own `/api` channel instead.
 * This runs inside the iframe, next to the unchanged body renderer; the
 * floating window around it (web-float.ts, in DSH's page) is its "main process".
 */

import { isRemotePage } from '../core/where.ts'
import type { BodyMessage, BrainMessage } from '../protocol/index.ts'
import type { BodyConfig, HerBridge, LinkStatus, MicMode } from '../../body/shared/types.ts'
import type { WebConfig } from '../dsh/web-body.ts'

const API = '/api/dsh-her'

/** What the floating window does for her (same origin, so a plain call). */
export interface FloatHost {
  frame(size: { width: number; height: number }): void
  hit(onHer: boolean): void
  drag(dx: number, dy: number): void
  /** The mouse button went up inside her window. */
  dragEnd(): void
  menu(): void
  interactive(on: boolean): void
  /** She has something to say but the browser keeps sound off until a click. */
  needsGesture(): void
  /** Another tab took her over. */
  replaced(): void
  /** Open the talk bar (double-clicking her). */
  openBar(): void
  /** The "她" page: is she shown here, show or hide her, look at the brain's choices again. */
  hidden(): boolean
  setHidden(hidden: boolean): void
  refresh(): void
}

/** What the floating window can ask of her. */
export interface FloatGuest {
  talk(): void
  showInput(): void
  /** Say something to her, from outside her window (it takes no clicks as a background). */
  say(text: string): Promise<boolean>
  /** A user gesture in the page: let her sound start (browsers keep audio off until one). */
  unlockAudio(): void
  audioStates(): string[]
  /** A finger on a phone, at a point in her window. */
  tap(x: number, y: number): void
  /** The talk bar's button or key: listen while held. */
  hold(on: boolean): void
}

declare global {
  interface Window {
    __herFloat?: FloatHost
    __herGuest?: FloatGuest
    __herTap?: (x: number, y: number) => void
    /** Open one of her conversations in dsh (set by the client plugin when dsh lets it). */
    __herOpenSession?: (sessionId: string) => void
  }
}

const host = (): FloatHost | undefined => {
  try {
    return window.parent.__herFloat
  } catch {
    return undefined
  }
}

// Every AudioContext the renderer makes, so a gesture in the page can start them.
const audioContexts: AudioContext[] = []
const RealAudioContext = window.AudioContext
window.AudioContext = class extends RealAudioContext {
  constructor(options?: AudioContextOptions) {
    super(options)
    audioContexts.push(this)
  }
}

async function post<T>(path: string, body: unknown): Promise<T | undefined> {
  try {
    const res = await fetch(`${API}${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const value = await res.json() as { ok: boolean } & T
    return value.ok ? value : undefined
  } catch {
    return undefined
  }
}

const brainListeners: Array<(message: BrainMessage, audio?: Uint8Array) => void> = []
const statusListeners: Array<(status: LinkStatus, detail?: string) => void> = []
const talkListeners: Array<() => void> = []
const inputListeners: Array<() => void> = []
const holdListeners: Array<(on: boolean) => void> = []
let events: EventSource | undefined

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function connect(): void {
  if (events !== undefined) return
  events = new EventSource(`${API}/web/events`)
  events.onopen = () => {
    for (const listener of statusListeners) listener('connected')
  }
  events.onerror = () => {
    for (const listener of statusListeners) listener('waiting')
  }
  events.onmessage = event => {
    const { m, a } = JSON.parse(event.data as string) as { m: BrainMessage | { t: 'web.reload' | 'web.replaced' }; a?: string }
    if (m.t === 'web.reload') {
      location.reload()
      return
    }
    if (m.t === 'web.replaced') {
      events?.close()
      host()?.replaced()
      return
    }
    const audio = a === undefined ? undefined : decodeBase64(a)
    if (audio !== undefined && audioContexts.some(context => context.state === 'suspended')) host()?.needsGesture()
    for (const listener of brainListeners) listener(m as BrainMessage, audio)
  }
}

const notHere = { ok: false, message: '网页身体里还不能做这个' }

window.her = {
  config: async (): Promise<BodyConfig> => {
    const answer = await post<{ config: WebConfig }>('/web/config', { remote: isRemotePage(location.protocol, location.hostname) })
    if (answer === undefined) throw new Error('读不到她的外形')
    host()?.frame(answer.config.frame)
    return answer.config
  },
  clips: async () => ({ packId: '', name: '', editable: false, clips: [] }),
  pickScenePhoto: async () => undefined,
  scenePhotoIn: async () => notHere,
  saveScene: async () => notHere,
  screens: async () => [],
  saveClips: async () => notHere,
  hit: onHer => host()?.hit(onHer),
  drag: (dx, dy) => host()?.drag(dx, dy),
  menu: () => host()?.menu(),
  say: async text => (await post('/web/send', { message: { t: 'user.text', text } })) !== undefined,
  send: async (message: BodyMessage) => (await post('/web/send', { message })) !== undefined,
  utterance: async (uttId, pcm, durationMs) => {
    try {
      const res = await fetch(`${API}/web/utterance?uttId=${encodeURIComponent(uttId)}&durationMs=${durationMs}`, { method: 'POST', credentials: 'same-origin', body: pcm })
      return res.ok
    } catch {
      return false
    }
  },
  interactive: on => host()?.interactive(on),
  onBrain: listener => {
    brainListeners.push(listener)
    // The renderer is ready for messages: only now open the stream.
    connect()
  },
  onStatus: listener => {
    statusListeners.push(listener)
  },
  onShowInput: listener => {
    inputListeners.push(listener)
  },
  onTalk: listener => {
    talkListeners.push(listener)
  },
  onMicMode: (_listener: (mode: MicMode) => void) => {},
  onFadeOut: () => {},
  openBar: () => host()?.openBar(),
  // Held from the bar on the page outside: it calls `__herGuest.hold`, which lands in onHold.
  hold: () => {},
  onHold: listener => {
    holdListeners.push(listener)
  },
  // The page is dsh already.
  openDsh: () => {},
} satisfies HerBridge

window.addEventListener('mouseup', () => host()?.dragEnd())

window.__herGuest = {
  talk: () => {
    for (const listener of talkListeners) listener()
  },
  showInput: () => {
    for (const listener of inputListeners) listener()
  },
  say: text => window.her.say(text),
  unlockAudio: () => {
    for (const context of audioContexts) {
      if (context.state === 'suspended') void context.resume()
    }
  },
  audioStates: () => audioContexts.map(context => context.state),
  tap: (x, y) => window.__herTap?.(x, y),
  hold: on => {
    for (const listener of holdListeners) listener(on)
  },
}
