/**
 * Her own Ming voices (docs/Ming本地声音设计.md §4), in `<home>/voices/ming/`:
 * `<id>.wav` (the reference recording) and `<id>.json`. Ming says every
 * sentence in such a voice by cloning that recording.
 *
 * - designed: made from a description. The same description gives a
 *   slightly different voice every time, so a few candidates are made, one is
 *   kept, and from then on she clones it;
 * - cloned: from a recording you add, only with your word that it is your
 *   own voice or that you may use it. It never leaves this computer.
 *
 * Candidates not kept yet wait in `drafts/` and are cleared after a day.
 * The voice settings (quality, moods, idle minutes) are in `settings.json`.
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { wavFromPcm16 } from '../core/index.ts'

const run = promisify(execFile)

export interface OwnVoice {
  id: string
  name: string
  kind: 'design' | 'clone'
  /** What the recording says (Ming needs it to clone). */
  text: string
  /** A designed voice: the description it was made from. */
  description?: string
  createdAt: string
}

export interface MingSettings {
  /** quality: 10 steps (about 2.9 s for 25 characters on an M1 Pro); speed: 5 steps (about 1.7 s). */
  quality: 'quality' | 'speed'
  /** Her moods change the voice. */
  moods: boolean
  /** Minutes without a sentence before Ming stops to free its memory; 0: never. Unset: by the Mac's memory. */
  idleMinutes?: number
}

export const DEFAULT_MING_SETTINGS: MingSettings = { quality: 'quality', moods: true }
export const MING_STEPS: Record<MingSettings['quality'], number> = { quality: 10, speed: 5 }

const DRAFT_TTL_MS = 24 * 3_600_000
/** A clone reference: long enough to carry the voice, short enough to keep each sentence quick. */
export const CLONE_MIN_S = 3
export const CLONE_MAX_S = 15

interface Draft {
  kind: OwnVoice['kind']
  text: string
  description?: string
}

export class OwnVoices {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  list(): OwnVoice[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter(f => f.endsWith('.json') && f !== 'settings.json')
      .flatMap(f => {
        try {
          const voice = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as OwnVoice
          return existsSync(join(this.dir, `${voice.id}.wav`)) ? [voice] : []
        } catch {
          return []
        }
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** The recording Ming clones for a voice. */
  ref(id: string): { wav: string; text: string } | undefined {
    const voice = this.list().find(v => v.id === id)
    return voice === undefined ? undefined : { wav: join(this.dir, `${voice.id}.wav`), text: voice.text }
  }

  /** Keep a candidate for a while (until it is kept, or a day). */
  addDraft(wav: Uint8Array, draft: Draft): string {
    const drafts = join(this.dir, 'drafts')
    mkdirSync(drafts, { recursive: true })
    for (const f of readdirSync(drafts)) {
      if (Date.now() - statSync(join(drafts, f)).mtimeMs > DRAFT_TTL_MS) rmSync(join(drafts, f), { force: true })
    }
    const id = randomUUID()
    writeFileSync(join(drafts, `${id}.wav`), wav)
    writeFileSync(join(drafts, `${id}.json`), JSON.stringify(draft))
    return id
  }

  /** Keep a candidate as one of her voices. A clone needs your consent and what the recording says. */
  keep(draftId: string, name: string, change: { text?: string; consent?: boolean } = {}): OwnVoice {
    if (!/^[0-9a-f-]{36}$/.test(draftId)) throw new Error('找不到这个试听')
    const drafts = join(this.dir, 'drafts')
    if (!existsSync(join(drafts, `${draftId}.wav`))) throw new Error('这个试听已经过期了，再生成一次吧')
    const draft = JSON.parse(readFileSync(join(drafts, `${draftId}.json`), 'utf8')) as Draft
    if (draft.kind === 'clone' && change.consent !== true) throw new Error('要先确认这是你本人的声音，或者你有授权')
    const text = (change.text ?? draft.text).trim()
    if (text === '') throw new Error('要写上录音里说的话')
    if (name.trim() === '') throw new Error('给这个声音起个名字')
    const voice: OwnVoice = {
      id: `v${Date.now().toString(36)}`, name: name.trim().slice(0, 20), kind: draft.kind, text,
      ...(draft.description === undefined ? {} : { description: draft.description }), createdAt: new Date().toISOString(),
    }
    copyFileSync(join(drafts, `${draftId}.wav`), join(this.dir, `${voice.id}.wav`))
    writeFileSync(join(this.dir, `${voice.id}.json`), `${JSON.stringify(voice, null, 2)}\n`)
    return voice
  }

  remove(id: string): void {
    if (!/^v[0-9a-z]+$/.test(id)) return
    rmSync(join(this.dir, `${id}.wav`), { force: true })
    rmSync(join(this.dir, `${id}.json`), { force: true })
  }

  settings(): MingSettings {
    try {
      return { ...DEFAULT_MING_SETTINGS, ...JSON.parse(readFileSync(join(this.dir, 'settings.json'), 'utf8')) as Partial<MingSettings> }
    } catch {
      return { ...DEFAULT_MING_SETTINGS }
    }
  }

  saveSettings(patch: Partial<MingSettings>): MingSettings {
    const next = { ...this.settings(), ...patch }
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, 'settings.json'), `${JSON.stringify(next, null, 2)}\n`)
    return next
  }
}

/**
 * A recording you add, made ready to clone: converted by macOS's afconvert
 * (wav, m4a from Voice Memos, mp3, aiff …) to 44.1 kHz mono, quiet start and
 * end cut off, at most CLONE_MAX_S. Also at 16 kHz, to recognize what it says.
 */
export async function prepareRecording(bytes: Uint8Array, name: string): Promise<{ wav: Uint8Array; pcm16k: Uint8Array; seconds: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-her-clone-'))
  try {
    const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? 'wav'
    const input = join(dir, `in.${ext}`)
    await writeFile(input, bytes)
    const full = join(dir, 'full.wav')
    try {
      await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', input, full], { timeout: 60_000 })
    } catch {
      throw new Error('读不了这个录音文件（试试 wav、m4a 或 mp3）')
    }
    const samples = trimSilence(pcmOf(new Uint8Array(await readFile(full))), 44_100)
    const seconds = samples.length / 44_100
    if (seconds < CLONE_MIN_S) throw new Error(`录音太短了（${seconds.toFixed(1)} 秒），至少要 ${CLONE_MIN_S} 秒清楚的说话`)
    const clip = samples.subarray(0, CLONE_MAX_S * 44_100)
    const pcm = new Uint8Array(clip.buffer, clip.byteOffset, clip.byteLength)
    const wav = wavFromPcm16(pcm, 44_100)
    const trimmed = join(dir, 'trimmed.wav')
    await writeFile(trimmed, wav)
    const small = join(dir, 'small.wav')
    await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', trimmed, small], { timeout: 60_000 })
    const pcm16 = pcmOf(new Uint8Array(await readFile(small)))
    return { wav, pcm16k: new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength), seconds: clip.length / 44_100 }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The 16-bit samples of a WAV file (its `data` chunk). */
function pcmOf(wav: Uint8Array): Int16Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  let at = 12
  while (at + 8 <= wav.byteLength) {
    const id = String.fromCharCode(...wav.subarray(at, at + 4))
    const size = view.getUint32(at + 4, true)
    if (id === 'data') {
      const bytes = wav.slice(at + 8, at + 8 + Math.min(size, wav.byteLength - at - 8))
      return new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2))
    }
    at += 8 + size + (size % 2)
  }
  throw new Error('录音文件里没有声音')
}

/** Cut quiet 10 ms frames off both ends, keeping 0.1 s around the speech. */
export function trimSilence(samples: Int16Array, rate: number): Int16Array {
  const frame = Math.round(rate / 100)
  const loud = (i: number) => {
    let sum = 0
    for (let j = i; j < Math.min(i + frame, samples.length); j++) sum += samples[j]! * samples[j]!
    return Math.sqrt(sum / frame) > 0.01 * 32768
  }
  let start = 0
  while (start < samples.length && !loud(start)) start += frame
  let end = samples.length - frame
  while (end > start && !loud(end)) end -= frame
  const pad = rate / 10
  return samples.subarray(Math.max(0, start - pad), Math.min(samples.length, end + frame + pad))
}
