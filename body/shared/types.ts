/** Shapes shared by the body's main process, preload and page. */

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
  clips: Array<{ id: string; url: string }>
}

export interface BodyConfig {
  mode: Mode
  platform: string
  pack: PackInfo
}

/** What the preload exposes to the page as `window.her`. */
export interface HerBridge {
  config(): Promise<BodyConfig>
  /** Tell main whether the pointer is over her (overlay click-through). */
  hit(onHer: boolean): void
  drag(dx: number, dy: number): void
  menu(): void
}
