/**
 * Clip player on two slots, driven by the pose-graph director (director.ts).
 *
 * Joins: when the outgoing clip's end and the incoming clip's start both line
 * up with their anchor (seam "cut"), the next clip is preloaded on its first
 * frame and swapped in on the last frame: no blend, no jump. Otherwise the
 * two crossfade for 0.3 s. Cutting a clip short (a request arrived, the state
 * changed) is always a crossfade, and only for interruptible clips.
 *
 * Rest: playing video costs CPU on every frame (M0: about 17% of one core on
 * an M1 Pro, against 0.4% for a still frame). After REST_AFTER_MS without any
 * interaction she rests: an idle clip runs to its end and stays on its last
 * frame (which is the anchor pose), and one idle clip plays every 20–40 s.
 * Any interaction wakes her at once.
 *
 * Sleep: a pack with a sleep state (at its own place, reached by a falling-
 * asleep clip) has her fall asleep after SLEEP_AFTER_MS without interaction;
 * any interaction wakes her.
 *
 * For "stacked" packs each video stays hidden and a WebGL canvas shows it
 * (see stacked.ts).
 */

import type { PackClipInfo, PackInfo, PackLayout } from '../shared/types.ts'
import { Director } from './director.ts'
import { StackedView } from './stacked.ts'

const FADE_S = 0.3
/** Seconds before a clip's end at which the next one is chosen (and preloaded or faded in). */
const LEAD_S = 0.45
export const REST_AFTER_MS = 2 * 60_000
const REST_GAP_MS: [number, number] = [20_000, 40_000]
export const SLEEP_AFTER_MS = 10 * 60_000

export interface Slot {
  video: HTMLVideoElement
  /** The element on screen: the video itself, or its WebGL canvas. */
  shown: HTMLElement
  view?: StackedView
  clip?: PackClipInfo
}

export interface PlayerEvents {
  /** A clip is now on screen. */
  started(clip: PackClipInfo): void
}

export class Player {
  readonly slots: Slot[]
  readonly director: Director<PackClipInfo>
  private active = 0
  /** The next clip, chosen and loaded on the other slot, waiting for a hard cut. */
  private queued: PackClipInfo | undefined
  private switching = false
  private lastInteraction = Date.now()
  private restTimer: number | undefined
  private readonly byId: Map<string, PackClipInfo>
  private readonly events: PlayerEvents

  constructor(stage: HTMLElement, pack: PackInfo, events: PlayerEvents) {
    this.byId = new Map(pack.clips.map(c => [c.id, c]))
    this.director = new Director(pack.clips, pack.macros, pack.start)
    this.events = events
    if (pack.clips.some(c => c.role === 'state' && c.name === 'sleep')) {
      window.setInterval(() => {
        if (this.director.wanted === 'idle' && Date.now() - this.lastInteraction > SLEEP_AFTER_MS) this.director.setState('sleep')
      }, 30_000)
    }
    this.slots = [0, 1].map(() => makeSlot(stage, pack.layout))
    for (const slot of this.slots) {
      slot.video.addEventListener('timeupdate', () => this.nearEnd(slot))
      slot.video.addEventListener('ended', () => this.ended(slot))
    }
  }

  get current(): Slot {
    return this.slots[this.active]!
  }

  get resting(): boolean {
    const quiet = this.director.wanted === 'idle' || (this.director.wanted === 'sleep' && this.director.at !== this.director.start)
    return Date.now() - this.lastInteraction > REST_AFTER_MS && !this.director.urgent && quiet
  }

  async start(): Promise<void> {
    await this.show(this.director.next(), 'fade')
  }

  /** Something happened (talk, touch, typing): stay awake; leave a still frame now. */
  touch(): void {
    this.lastInteraction = Date.now()
    if (this.director.wanted === 'sleep') this.director.setState('idle')
    if (this.restTimer !== undefined || this.current.video.ended) {
      window.clearTimeout(this.restTimer)
      this.restTimer = undefined
      this.advance('fade')
    }
  }

  setState(state: string): void {
    const changed = state !== this.director.wanted
    this.director.setState(state)
    this.touch()
    if (changed) this.cutShort()
  }

  /** Queue an action; resolves when it has played. */
  act(action: string): Promise<{ ok: boolean; reason?: string }> {
    const done = this.director.act(action)
    this.touch()
    this.cutShort()
    return done
  }

  emote(emotion: string): void {
    this.director.emote(emotion)
    this.touch()
    this.cutShort()
  }

  /** Leave an interruptible loop now if something else is wanted. */
  private cutShort(): void {
    const clip = this.current.clip
    if (clip === undefined || this.switching || !clip.interruptible || clip.from !== clip.to) return
    const wantsLoop = clip.role === 'state' && clip.name === this.director.wanted
    if (wantsLoop && !this.director.urgent) return
    this.queued = undefined
    this.advance('fade')
  }

  private advance(join: 'cut' | 'fade'): void {
    if (this.switching) return
    const next = this.queued ?? this.director.next()
    this.queued = undefined
    this.show(next, join).catch(console.error)
  }

  private async show(clip: PackClipInfo, join: 'cut' | 'fade'): Promise<void> {
    this.switching = true
    try {
      const incoming = this.slots[1 - this.active]!
      const outgoing = this.slots[this.active]!
      const ov = outgoing.video
      const finished = ov.ended || !Number.isFinite(ov.duration) || ov.duration - ov.currentTime <= LEAD_S + 0.1
      if (incoming.clip?.id !== clip.id || incoming.video.ended || incoming.video.currentTime > 0.05) await load(incoming, clip)
      for (const slot of this.slots) slot.shown.classList.toggle('cut', join === 'cut')
      await incoming.video.play()
      incoming.shown.classList.add('on')
      outgoing.shown.classList.remove('on')
      this.active = 1 - this.active
      if (outgoing.clip !== undefined) this.director.played(outgoing.clip, finished)
      this.events.started(clip)
      window.setTimeout(() => { if (this.slots[1 - this.active] === outgoing) outgoing.video.pause() }, FADE_S * 1000 + 100)
    } finally {
      this.switching = false
    }
  }

  private nearEnd(slot: Slot): void {
    const video = slot.video
    const clip = slot.clip
    if (slot !== this.current || clip === undefined || this.switching || this.queued !== undefined || !Number.isFinite(video.duration)) return
    if (video.duration - video.currentTime > LEAD_S) return
    // Resting on an idle loop: let it end on its last frame.
    if (this.resting && clip.role === 'state' && clip.from === clip.to) return
    const next = this.director.next()
    if (clip.seam.out === 'cut' && next.seam.in === 'cut' && clip.to === next.from) {
      this.queued = next
      load(this.slots[1 - this.active]!, next).catch(console.error)
    } else {
      this.show(next, 'fade').catch(console.error)
    }
  }

  private ended(slot: Slot): void {
    if (slot !== this.current || this.switching) return
    if (this.queued !== undefined) {
      this.advance('cut')
      return
    }
    if (!this.resting) {
      this.advance('fade')
      return
    }
    if (this.restTimer !== undefined) return
    const [min, max] = REST_GAP_MS
    this.restTimer = window.setTimeout(() => {
      this.restTimer = undefined
      // Still on the anchor pose: the next loop starts there, so a cut is seamless.
      this.advance(slot.clip?.seam.out === 'cut' ? 'cut' : 'fade')
    }, min + Math.random() * (max - min))
  }

  clipById(id: string): PackClipInfo | undefined {
    return this.byId.get(id)
  }
}

/** Load a clip on a slot, paused on its first frame (drawn, for stacked packs). */
async function load(slot: Slot, clip: PackClipInfo): Promise<void> {
  slot.clip = clip
  slot.video.src = clip.url
  slot.video.currentTime = 0
  await new Promise<void>((resolve, reject) => {
    if (slot.video.readyState >= 2) return resolve()
    slot.video.addEventListener('loadeddata', () => resolve(), { once: true })
    slot.video.addEventListener('error', () => reject(new Error(`cannot play ${clip.url}`)), { once: true })
  })
  slot.view?.drawNow()
}

function makeSlot(stage: HTMLElement, layout: PackLayout): Slot {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  stage.append(video)
  if (layout !== 'stacked') return { video, shown: video }
  video.classList.add('source')
  const view = new StackedView(video)
  stage.append(view.canvas)
  return { video, shown: view.canvas, view }
}
