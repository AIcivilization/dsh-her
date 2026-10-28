/**
 * Clip player: two players that crossfade, choosing clips from the pool of the
 * current state (talk, think, …; idle when the pack has none for it).
 *
 * Rest: playing video costs CPU on every frame (M0: about 17% of one core on
 * an M1 Pro, against 0.4% for a still frame). After REST_AFTER_MS without any
 * interaction she rests: the clip runs to its end and stays on its last frame,
 * and one idle clip plays every 20–40 s. Any interaction wakes her at once.
 *
 * For "stacked" packs each video stays hidden and a WebGL canvas shows it
 * (see stacked.ts).
 */

import type { PackInfo, PackLayout } from '../shared/types.ts'
import { StackedView } from './stacked.ts'

const FADE_LEAD_S = 0.6
export const REST_AFTER_MS = 2 * 60_000
const REST_GAP_MS: [number, number] = [20_000, 40_000]

export interface Slot {
  video: HTMLVideoElement
  /** The element on screen: the video itself, or its WebGL canvas. */
  shown: HTMLElement
}

export class Player {
  readonly slots: Slot[]
  private active = 0
  private lastClip: string | undefined
  private switching = false
  private state = 'idle'
  private lastInteraction = Date.now()
  private restTimer: number | undefined
  private readonly pools = new Map<string, PackInfo['clips']>()

  constructor(stage: HTMLElement, private readonly pack: PackInfo) {
    for (const clip of pack.clips) this.pools.set(clip.role, [...(this.pools.get(clip.role) ?? []), clip])
    this.slots = [0, 1].map(() => makeSlot(stage, pack.layout))
    for (const { video } of this.slots) {
      video.addEventListener('timeupdate', () => this.nearEnd(video))
      video.addEventListener('ended', () => this.ended(video))
    }
  }

  get current(): Slot {
    return this.slots[this.active]!
  }

  get resting(): boolean {
    return Date.now() - this.lastInteraction > REST_AFTER_MS
  }

  start(): Promise<void> {
    return this.playNext()
  }

  /** Something happened (talk, touch, typing): stay awake; leave a still frame now. */
  touch(): void {
    this.lastInteraction = Date.now()
    if (this.restTimer !== undefined || this.current.video.ended) {
      window.clearTimeout(this.restTimer)
      this.restTimer = undefined
      this.playNext().catch(console.error)
    }
  }

  setState(state: string): void {
    const changed = state !== this.state
    this.state = state
    this.touch()
    // A new state shows at once when the pack has clips for it.
    if (changed && this.pools.has(state) && !this.switching) this.playNext().catch(console.error)
  }

  private pick(): PackInfo['clips'][number] {
    const pool = this.pools.get(this.state) ?? this.pools.get('idle') ?? this.pack.clips
    const options = pool.length > 1 ? pool.filter(c => c.id !== this.lastClip) : pool
    const clip = options[Math.floor(Math.random() * options.length)]!
    this.lastClip = clip.id
    return clip
  }

  private async playNext(): Promise<void> {
    if (this.switching) return
    this.switching = true
    try {
      const incoming = this.slots[1 - this.active]!
      const outgoing = this.slots[this.active]!
      incoming.video.src = this.pick().url
      incoming.video.currentTime = 0
      await incoming.video.play()
      incoming.shown.classList.add('on')
      outgoing.shown.classList.remove('on')
      this.active = 1 - this.active
      window.setTimeout(() => { if (this.slots[1 - this.active] === outgoing) outgoing.video.pause() }, 700)
    } finally {
      this.switching = false
    }
  }

  private nearEnd(video: HTMLVideoElement): void {
    if (video !== this.current.video || this.switching || this.resting || !Number.isFinite(video.duration)) return
    if (video.duration - video.currentTime > FADE_LEAD_S) return
    this.playNext().catch(console.error)
  }

  /** Resting: the clip ended on its last frame; play the next one after a pause. */
  private ended(video: HTMLVideoElement): void {
    if (video !== this.current.video || this.restTimer !== undefined) return
    if (!this.resting) {
      this.playNext().catch(console.error)
      return
    }
    const [min, max] = REST_GAP_MS
    this.restTimer = window.setTimeout(() => {
      this.restTimer = undefined
      this.playNext().catch(console.error)
    }, min + Math.random() * (max - min))
  }
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
  return { video, shown: view.canvas }
}
