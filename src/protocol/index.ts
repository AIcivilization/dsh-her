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
  | { t: 'posture'; cid: string; anchor: string }
  | { t: 'mode.changed'; cid: string; mode: WindowMode; pos?: { x: number; y: number; screen?: number } }
  | { t: 'pack.progress'; id: string; done: number; total: number; step: string }
  | { t: 'pack.report'; id: string; ok: boolean; pack?: PackSummary; lines: Array<{ level: 'ok' | 'warn' | 'error'; text: string }> }
  | { t: 'pack.list'; packs: PackSummary[] }
  | { t: 'error'; code: string; message: string }

// ── brain → body ────────────────────────────────────────────────────────────

export interface Welcome {
  t: 'welcome'
  v: number
  sessionId: string
  characters: CharacterView[]
  config: { mic: 'push-to-talk' | 'always'; bargeIn: boolean }
}

export type BrainMessage =
  | Welcome
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
  | { t: 'config'; mic?: 'push-to-talk' | 'always'; bargeIn?: boolean }
  | { t: 'pack.pick'; id: string }
  | { t: 'pack.import'; id: string; dir: string }

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
