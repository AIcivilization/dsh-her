/**
 * Body protocol v1: the messages between the brain (this plugin) and a body
 * (the Electron desktop app, later Unity or a phone). Design: docs/身体协议.md.
 *
 * Text frames carry one JSON message each. Binary frames carry audio: a 4-byte
 * big-endian header holding the stream id, then the payload. The audio frame
 * is sent first, then the `speak.seg` or `user.utterance` naming its stream.
 *
 * This file has no runtime dependencies so the body can import the same source.
 */

export const PROTOCOL_VERSION = 1

export type AvatarState = 'idle' | 'listen' | 'think' | 'talk' | 'sleep'
export type WindowMode = 'overlay' | 'wallpaper' | 'window'
export type AudioFormat = 'wav' | 'mp3' | 'opus'

export interface CharMark {
  /** Character offset in the segment text. */
  i: number
  /** Milliseconds from the start of the segment audio. */
  ms: number
}

/** A performance cue riding on a sentence: applied when that sentence starts playing. */
export interface Cue {
  kind: 'emotion' | 'act'
  name: string
}

export interface PackAction {
  id: string
  desc: string
  durationMs?: number
  hasAudio?: boolean
  transcript?: string
}

export interface PackSummary {
  packId: string
  kind: 'video'
  name: string
  layer: 'overlay' | 'scene'
  states: AvatarState[]
  emotions: string[]
  actions: PackAction[]
  hitParts: string[]
}

/**
 * A look on the body: one character in several scenes and how they switch
 * (docs/形象工坊与多场景.md §5). Its pack id in `pack.list` is `look:<id>`.
 */
export interface LookView {
  id: string
  name: string
  scenes: Array<{ id: string; name: string; when: string; on: boolean }>
  current: string
  /** Switching by time of day and by whether you are around. */
  auto: boolean
  /** Held in the current scene until asked to move. */
  locked: boolean
  /** It has a desk-pet version ("浮在最上层" shows that instead of the scene). */
  desk: boolean
}

export interface BodyCaps {
  audioOut: AudioFormat[]
  micIn?: { formats: string[]; vad?: string }
  asrLocal: boolean
  ttsLocal: string[]
  modes: WindowMode[]
  screens: Array<{ id: number; w: number; h: number; scale: number }>
}

export interface CharacterView {
  cid: string
  name: string
  packId?: string
  mode: WindowMode
  subtitle?: { color?: string }
}

// ── body → brain ────────────────────────────────────────────────────────────

export interface Hello {
  t: 'hello'
  v: number
  token: string
  body: { kind: 'video' | 'vrm' | 'unity' | 'web'; app: string; version: string; os: string }
  caps: BodyCaps
  packs: PackSummary[]
}

export type BodyMessage =
  | Hello
  | { t: 'ping'; at: number }
  | { t: 'user.text'; cid?: string; text: string }
  | { t: 'user.utterance'; cid?: string; uttId: string; format: string; durationMs: number; stream?: number; text?: string }
  | { t: 'user.speechStart'; cid?: string }
  | { t: 'interrupt'; cid: string; uid: string; seq: number; playedMs: number }
  | { t: 'speak.progress'; cid: string; uid: string; seq: number; phase: 'start' | 'end' }
  | { t: 'act.done'; cid: string; id: string; ok: boolean; reason?: string }
  | { t: 'answer'; cid: string; id: string; option?: string; text?: string }
  | { t: 'touch'; cid: string; part: string; kind: 'tap' | 'double' | 'long' }
  | { t: 'drag'; cid: string; phase: 'start' | 'end'; pos: { x: number; y: number } }
  | { t: 'presence'; state: 'active' | 'idle' | 'away'; fullscreen: boolean; locked: boolean }
  /** The body's menu: she should (not) speak first for a while. */
  | { t: 'focus.set'; on: boolean }
  /** The body's menu: switch her off, or call her back. */
  | { t: 'off.set'; off: boolean }
  /** The talk bar (docs/对话入口设计.md): its lines, a new conversation, an earlier one, the whole conversation in dsh. */
  | { t: 'talk.get' }
  | { t: 'talk.new' }
  | { t: 'talk.resume'; id: string }
  | { t: 'talk.open' }
  | { t: 'posture'; cid: string; anchor: string }
  | { t: 'mode.changed'; cid: string; mode: WindowMode; pos?: { x: number; y: number; screen?: number } }
  /** Where this body shows her on the desktop and what else it has on (four places, docs/设置页与编排设计.md §13). */
  | { t: 'body.prefs'; places: DeskPlaces; tray: boolean; holdKey: boolean }
  | { t: 'pack.progress'; id: string; done: number; total: number; step: string }
  | { t: 'pack.report'; id: string; ok: boolean; pack?: PackSummary; lines: Array<{ level: 'ok' | 'warn' | 'error'; text: string }> }
  /** The body's menu: open her settings in dsh, on one of its pages (主界面 when none). The body then brings dsh to the front. */
  | { t: 'settings.open'; page?: SettingsPage }
  /** The packs this body has imported, and the one on screen. */
  | { t: 'pack.list'; packs: PackSummary[]; active?: string }
  /** The look on screen and its scenes (null: a single pack, no look). */
  | { t: 'look.state'; look: LookView | null }
  /** Answer to `folder.pick`: what the user chose (none: cancelled). */
  | { t: 'folder.picked'; id: string; path?: string }
  | { t: 'error'; code: string; message: string }

// ── brain → body ────────────────────────────────────────────────────────────

export interface Welcome {
  t: 'welcome'
  v: number
  sessionId: string
  characters: CharacterView[]
  /** `focus`: she is not speaking first, for the body's menu. `off`: she is switched off (no window, no listening). */
  config: { mic: 'push-to-talk' | 'always'; bargeIn: boolean; focus?: boolean; off?: boolean; places?: DeskPlaces; tray?: boolean; holdKey?: boolean }
}

/** The two places of the desktop: in the wallpaper, floating on top. Both on: both at once. */
export interface DeskPlaces {
  wallpaper: boolean
  overlay: boolean
}

/** The pages of her settings in dsh (docs/设置页与编排设计.md §1). */
export const SETTINGS_PAGES = ['home', 'engine', 'her', 'stage'] as const
export type SettingsPage = typeof SETTINGS_PAGES[number]

/** What the talk bar shows: the last lines, the conversation they are in, and the earlier ones. */
export interface TalkView {
  /** Her name, for her lines. */
  name: string
  lines: Array<{ who: 'you' | 'her'; text: string }>
  segment?: { id: string; title: string }
  /** Newest first. */
  segments: Array<{ id: string; title: string; createdAt: string }>
  /** How big the conversation is, in plain words. */
  size?: string
}

export type BrainMessage =
  | Welcome
  | ({ t: 'talk' } & TalkView)
  | { t: 'reject'; reason: 'version' | 'token'; message: string }
  | { t: 'pong'; at: number }
  | { t: 'character.load'; cid: string; name: string; packId?: string; mode: WindowMode; subtitle?: { color?: string } }
  | { t: 'character.unload'; cid: string }
  | { t: 'state'; cid: string; state: AvatarState }
  | { t: 'emotion'; cid: string; emotion: string; intensity?: number }
  | { t: 'speak.begin'; cid: string; uid: string; emotion?: string }
  | { t: 'speak.seg'; cid: string; uid: string; seq: number; text: string; durationMs: number; format?: AudioFormat; stream?: number; marks?: CharMark[]; cues?: Cue[] }
  | { t: 'speak.end'; cid: string; uid: string }
  | { t: 'speak.cancel'; cid: string; uid: string }
  | { t: 'act'; cid: string; id: string; action: string; args?: unknown }
  | { t: 'bubble'; cid: string; text: string; ttlMs?: number }
  /**
   * What the brain recognized in a `user.utterance` (empty: nothing understood).
   * `ignored`: right after a barge-in it was her own voice (echo) or only a
   * filler sound, so it was dropped and does not count as your turn.
   */
  | { t: 'heard'; cid: string; uttId: string; text: string; ignored?: 'echo' | 'filler' }
  | { t: 'ask'; cid: string; id: string; question: string; options: string[] }
  | { t: 'mode'; cid: string; mode: WindowMode; screen?: number; pos?: { x: number; y: number }; scale?: number }
  | { t: 'config'; mic?: 'push-to-talk' | 'always'; bargeIn?: boolean; focus?: boolean; off?: boolean; places?: DeskPlaces; tray?: boolean; holdKey?: boolean }
  /** Let the user choose a folder on the body's computer and import it (progress and report follow). */
  | { t: 'pack.pick'; id: string; ffmpeg?: string }
  | { t: 'pack.import'; id: string; dir: string }
  /** Show this imported pack (or `look:<id>`) from now on. */
  | { t: 'pack.use'; packId: string }
  /** Change how the look on screen switches scenes, or go to one now. */
  | { t: 'look.set'; auto?: boolean; locked?: boolean; go?: string; on?: Record<string, boolean> }
  /**
   * Import a 形象工坊 project (folders on the body's computer): each part with
   * clips becomes a pack, tied together as look `id`, and shown. Progress and
   * the report come back as `pack.progress` / `pack.report`.
   */
  | {
    t: 'look.import'; id: string; name: string; dir: string; desk?: string; default?: string
    /** The ffmpeg the brain found, for a body that has none of its own and was started with a bare PATH. */
    ffmpeg?: string
    scenes: Array<{ id: string; name: string; folder: string; when?: { hours?: string; user?: 'active' | 'idle' } }>
  }
  /**
   * Let the user choose a folder (or, with `file`, also a file of that
   * extension) on the body's computer; answered with `folder.picked`.
   */
  | { t: 'folder.pick'; id: string; title: string; button: string; file?: string }
  /** Play her opening clip once (a file on this computer): she comes out (§4.5). */
  | { t: 'intro'; path: string }

export type AnyMessage = BodyMessage | BrainMessage

/** Parse one text frame. Unknown `t` values pass through so newer peers degrade instead of failing. */
export function parseMessage<T extends { t: string } = AnyMessage>(raw: string): T | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const t = (value as { t?: unknown }).t
  return typeof t === 'string' && t !== '' ? value as T : undefined
}

/** Prefix an audio payload with its stream id. */
export function encodeAudioFrame(stream: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + payload.byteLength)
  new DataView(frame.buffer).setUint32(0, stream >>> 0)
  frame.set(payload, 4)
  return frame
}

/** Split a binary frame into its stream id and payload; undefined when it is too short. */
export function decodeAudioFrame(frame: Uint8Array): { stream: number; payload: Uint8Array } | undefined {
  if (frame.byteLength < 4) return undefined
  const stream = new DataView(frame.buffer, frame.byteOffset, 4).getUint32(0)
  return { stream, payload: frame.subarray(4) }
}
