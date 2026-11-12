/** Shapes shared by the body's main process, preload and page. */

import type { BodyMessage, BrainMessage } from '../../src/protocol/index.ts'
import type { BodyConfig } from '../../src/pack/types.ts'
import type { LinkStatus } from '../main/brain-link.ts'

export type { BodyConfig, ClipsView, ClipUse, PackClipInfo, PackInfo, PackLayout, SceneLayout, ScenePlate } from '../../src/pack/types.ts'

export type { Mode } from '../../src/pack/types.ts'
import type { Mode } from '../../src/pack/types.ts'
export type MicMode = 'push-to-talk' | 'always'

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
  /** She is moving to another scene: fade out (the next scene loads after). */
  onFadeOut(listener: () => void): void
  /** Open the talk bar (docs/对话入口设计.md). */
  openBar(): void
  /** The talk bar: you hold (true) or let go of (false) the talk button or key. */
  hold(on: boolean): void
  /** Her window: listen while held. */
  onHold(listener: (on: boolean) => void): void
  /** The talk bar opened or closed: while it is open her answer shows there, not over her head. */
  onBar(listener: (open: boolean) => void): void
  /** Bring dsh to the front (its page then opens her conversation). */
  openDsh(): void
}
