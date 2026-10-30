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

export interface SceneLayout {
  width: number
  height: number
  region: { x: number; y: number; width: number; height: number }
  /**
   * The same scene as photos of other shapes (for example 16:9 and 21:9 next
   * to a 16:10 one), each with where her region sits on it. The body shows
   * the one closest to the screen's shape.
   */
  plates?: ScenePlate[]
}

export interface ScenePlate {
  file: string
  width: number
  height: number
  region: { x: number; y: number; width: number; height: number }
}

export interface PackInfo {
  id: string
  name: string
  layer: 'overlay' | 'scene'
  layout: PackLayout
  start: string
  clips: PackClipInfo[]
  macros: Array<{ action: string; desc: string; goTo: string; then?: string; jump?: boolean }>
  /** Scene packs: the full-screen photo, shown behind her in the wallpaper layer. */
  plateUrl?: string
  /**
   * Scene packs made of a full-screen photo and small clips: the photo's size
   * and the region of it her clips cover (photo pixels). The photo fills the
   * screen; the clips play exactly over that region.
   */
  scene?: SceneLayout
  /** Width / height of her picture; the window takes this shape so nothing is cut off. */
  aspect?: number
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

export interface ScreenInfo {
  /** Logical size (points / CSS pixels). */
  width: number
  height: number
  /** Device pixels per logical pixel. */
  scale: number
  primary: boolean
}

export type { LinkStatus }

/** What the preload exposes to the page as `window.her`. */
/** What a clip of a development pack is used for, as the "画面" tab offers it. */
export type ClipUse = 'idle' | 'listen' | 'talk' | 'think' | 'shy' | 'happy' | 'fall-asleep' | 'sleep' | 'none'

export interface ClipsView {
  packId: string
  name: string
  /** Only development packs (clips.json) can be laid out here; imported packs go by their file names. */
  editable: boolean
  clips: Array<{ id: string; url: string; desc: string; use: ClipUse; durationMs: number }>
}

export interface HerBridge {
  config(): Promise<BodyConfig>
  /** The current pack's clips and what each is used for. */
  clips(): Promise<ClipsView>
  /** 做场景: choose the full-screen photo (undefined when cancelled). */
  pickScenePhoto(): Promise<{ path: string; url: string; width: number; height: number } | undefined>
  /** 做场景 on a 形象工坊 scene folder: its photo (plate.png). */
  scenePhotoIn(dir: string): Promise<{ ok: boolean; photo?: { path: string; url: string; width: number; height: number }; message?: string }>
  /** 做场景: write the scene folder (photo, scene.json, crop.png) and show it in the file manager; `dir`: frame that 形象工坊 folder. */
  saveScene(input: { path: string; name: string; region: SceneLayout['region']; dir?: string }): Promise<{ ok: boolean; dir?: string; message?: string }>
  /** The screens, for the 做场景 tab's advice (logical size and scale factor). */
  screens(): Promise<ScreenInfo[]>
  /** Save what each clip is used for (and its description); she picks it up at once. */
  saveClips(changes: Array<{ id: string; use: ClipUse; desc: string }>): Promise<{ ok: boolean; message?: string }>
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
  /** She is moving to another scene: fade out (the next scene loads after). */
  onFadeOut(listener: () => void): void
}
