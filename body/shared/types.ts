/** Shapes shared by the body's main process, preload and page. */

import type { BrainMessage } from '../../src/protocol/index.ts'
import type { LinkStatus } from '../main/brain-link.ts'

export type Mode = 'overlay' | 'wallpaper' | 'window'

/**
 * How a pack's clips carry transparency:
 * - opaque: none (scene packs, window mode);
 * - alpha: VP9 WebM with an alpha channel (software decoded on macOS);
 * - stacked: H.264 with the colour on top and the alpha mask below, hardware
 *   decoded and composited in WebGL.
 */
export type PackLayout = 'opaque' | 'alpha' | 'stacked'

export interface PackInfo {
  name: string
  layout: PackLayout
  /** `role` is the state or action a clip shows; clips without one are idle. */
  clips: Array<{ id: string; url: string; role: string }>
}

export interface BodyConfig {
  mode: Mode
  platform: string
  pack: PackInfo
  /** Her size in the window, in CSS pixels; the overlay window adds room above her for the bubble. */
  her: { width: number; height: number }
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
  /** The input box is open: take the mouse and keyboard focus (or give them back). */
  interactive(on: boolean): void
  onBrain(listener: (message: BrainMessage) => void): void
  onStatus(listener: (status: LinkStatus, detail?: string) => void): void
  /** The global shortcut asks for the input box. */
  onShowInput(listener: () => void): void
}
