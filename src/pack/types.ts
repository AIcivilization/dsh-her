/** The shapes of an appearance pack, shared by the brain and the body. */

export type Mode = 'overlay' | 'wallpaper' | 'window'

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

/** What a clip of a development pack is used for, as the "画面" tab offers it. */
export type ClipUse = 'idle' | 'listen' | 'talk' | 'think' | 'shy' | 'happy' | 'fall-asleep' | 'sleep' | 'none'

export interface ClipsView {
  packId: string
  name: string
  /** Only development packs (clips.json) can be laid out here; imported packs go by their file names. */
  editable: boolean
  clips: Array<{ id: string; url: string; desc: string; use: ClipUse; durationMs: number }>
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
  /** The second window of two (she floats on top while the scene is in the wallpaper): it shows and is touched, the other one speaks and listens. */
  pet?: boolean
  /** False: no bubble here (the floating window beside this one shows it). */
  bubble?: boolean
  /** Nothing to see: this window only speaks and listens (both desktop places are off). */
  unseen?: boolean
}
