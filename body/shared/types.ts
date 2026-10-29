/** Shapes shared by the body's main process, preload and page. */

import type { BodyMessage, BrainMessage } from '../../src/protocol/index.ts'
import type { LinkStatus } from '../main/brain-link.ts'

export type Mode = 'overlay' | 'wallpaper' | 'window'
export type MicMode = 'push-to-talk' | 'always'

/**
 * How a pack's clips carry transparency:
 * - opaque: none (scene packs, window mode);
 * - alpha: VP9 WebM with an alpha channel (software decoded on macOS);
 * - stacked: H.264 with the colour on top and the alpha mask below, hardware
 *   decoded and composited in WebGL.
 */
export type PackLayout = 'opaque' | 'alpha' | 'stacked'

export interface PackClipInfo {
  id: string
  url: string
  from: string
  to: string
  role: 'state' | 'emotion' | 'action' | 'transition' | 'line'
  /** State name, emotion name, or action id. */
  name: string
  interruptible: boolean
  durationMs: number
  /** Whether each end lines up with its anchor (hard cut) or needs a crossfade. */
  seam: { in: 'cut' | 'fade'; out: 'cut' | 'fade' }
  /** Click mask: one byte per pixel, `width`×`height` per frame, `fps` frames a second. */
  mask?: { url: string; width: number; height: number; fps: number; frames: number }
  /** Stored lines: their audio and words. */
  audioUrl?: string
  transcript?: string
}

export interface PackInfo {
  id: string
  name: string
  layer: 'overlay' | 'scene'
  layout: PackLayout
  start: string
  clips: PackClipInfo[]
  macros: Array<{ action: string; desc: string; goTo: string; then?: string }>
  /** Scene packs: the empty scene, shown behind her in the wallpaper layer. */
  plateUrl?: string
}

export interface BodyConfig {
  mode: Mode
  platform: string
  pack: PackInfo
  /** Her size in the window, in CSS pixels; the overlay window adds room above her for the bubble. */
  her: { width: number; height: number }
  /** Development: expose `window.__her` test hooks. */
  debug: boolean
  /** Development: play her voice silently (everything else as usual). */
  mute: boolean
}

export type { LinkStatus }

/** What the preload exposes to the page as `window.her`. */
export interface HerBridge {
  config(): Promise<BodyConfig>
  /** Tell main whether the pointer is over her (overlay click-through). */
  hit(onHer: boolean): void
  drag(dx: number, dy: number): void
  menu(): void
  /** Send what you typed to the brain; false when not connected. */
  say(text: string): Promise<boolean>
  /** Any other message to the brain (main fills in the character id); false when not connected. */
  send(message: BodyMessage): Promise<boolean>
  /** What you said, as 16-bit mono PCM at 16 kHz; false when not connected. */
  utterance(uttId: string, pcm: ArrayBuffer, durationMs: number): Promise<boolean>
  /** The input box is open: take the mouse and keyboard focus (or give them back). */
  interactive(on: boolean): void
  onBrain(listener: (message: BrainMessage, audio?: Uint8Array) => void): void
  onStatus(listener: (status: LinkStatus, detail?: string) => void): void
  /** Open the input box (menu). */
  onShowInput(listener: () => void): void
  /** The talk shortcut: listen for one utterance (and cut her off if she is talking). */
  onTalk(listener: () => void): void
  /** The menu switched how the microphone listens. */
  onMicMode(listener: (mode: MicMode) => void): void
}
