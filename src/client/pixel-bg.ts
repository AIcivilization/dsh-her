/**
 * A 像素动画 behind dsh's conversation (docs/像素动画设计.md §7): a layer in
 * the conversation (inside its root, the way dsh's own home whale is: the
 * root paints an opaque background, so a layer outside it is never seen),
 * under its content, taking no clicks. While it is worn, dsh's own whale is
 * hidden: a click on blank space plays ours instead. It plays once when something happens (a click on blank space, a
 * message sent, dsh done answering, the page opening, every few minutes), or
 * over and over. Not on phones, not with reduced motion, paused while the tab
 * is hidden. Plain DOM: it lives in dsh's page, outside our React tree.
 */

import type { PixelBackground } from '../core/pixel.ts'
import { herApi } from './api.ts'
import { inkOf, PixelFrame } from './pixel/host.ts'

const CHAT_COLUMN = '[class*="_centerCol"]'
/** The conversation's root (its class is a hash; its phase attribute is not): hero, settling or active. */
const CONVERSATION = '[class*="_root"][data-phase]'
/** dsh's own home whale. */
const DSH_WHALE_HIDDEN = '[data-home-whale]{visibility:hidden!important}'
const COMPOSER = '[class*="_composerSeat"]'
/** dsh's "still answering" mark. */
const RUNNING = '[class*="_runningIcon"]'
/** Clicks on these belong to the control, not to blank space. */
const CONTROLS = 'button, a, input, textarea, select, label, summary, video, iframe, [contenteditable], [role="button"], [role="dialog"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="tab"], [data-composer-card]'
const SEND_LABEL = /发送|send|submit/i

let worn: PixelBackground | undefined
let wornKey = ''
let layer: HTMLDivElement | undefined
let frame: PixelFrame | undefined
let playing = false
let opened = false
/** To play once as soon as a conversation is on screen: just chosen in 像素工坊, or the page opened. */
let shown = false
let wasRunning = false
let watchTimer: ReturnType<typeof setInterval> | undefined
let everyTimer: ReturnType<typeof setInterval> | undefined
let themeWatch: MutationObserver | undefined
let whaleHider: HTMLStyleElement | undefined
const codes = new Map<string, string>()

const phone = () => matchMedia('(hover: none) and (pointer: coarse)').matches
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
/** Code letters read better a little stronger than dots, as in dsh's own whale. */
const inkNow = () => inkOf(worn?.look.color ?? 'theme', worn?.look.style === 'code' ? '--dsw-alias-label-primary' : '--dsw-alias-label-secondary')

async function codeOf(id: string): Promise<string | undefined> {
  const known = codes.get(id)
  if (known !== undefined) return known
  const result = await herApi.pixelsCode(id)
  if (!result.ok) return undefined
  codes.set(id, result.code)
  return result.code
}

/** The layer in the conversation there is now (dsh draws a new one for each); the chat column it is in. */
function attach(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>(CHAT_COLUMN)
  if (column === null || worn === undefined) return undefined
  // In the conversation's root, over its opaque background; the column itself when there is none (her own page).
  const host = column.querySelector<HTMLElement>(CONVERSATION) ?? column
  if (layer !== undefined && layer.parentElement !== host) {
    // A new conversation (dsh drew a new root): a new layer there. Moving the old one would reload its frame mid-play.
    frame?.destroy()
    layer.remove()
    layer = frame = undefined
    playing = false
  }
  if (layer === undefined) {
    layer = document.createElement('div')
    layer.className = 'dsh-her-pixel-bg'
    layer.style.cssText = 'position:absolute;inset:0;z-index:-1;pointer-events:none;overflow:hidden'
    frame = new PixelFrame()
    frame.on(event => {
      if (event.t === 'ended') playing = false
      else if (event.t === 'problem') {
        playing = false
        console.warn('[dsh-her] 背景像素动画没能播放：', event.problems.join('；'))
      }
    })
    layer.append(frame.el)
  }
  if (layer.parentElement !== host) {
    // Its own stacking: -1 lands over the host's background and under its content (dsh isolates the root only on the home).
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
    host.style.isolation = 'isolate'
    host.append(layer)
  }
  layer.style.opacity = String(worn.opacity)
  return column
}

async function play(): Promise<void> {
  const bg = worn
  if (bg === undefined || playing || still() || document.hidden) return
  if (attach() === undefined || frame === undefined) return
  const code = await codeOf(bg.id)
  if (code === undefined || worn !== bg) return
  playing = true
  frame.play(code, bg.look, inkNow(), bg.triggers.loop ? { mode: 'loop', fade: true } : { mode: 'once', cap: 30, fade: true })
}

const onClick = (event: MouseEvent) => {
  if (worn?.triggers.click !== true || event.button !== 0) return
  const target = event.target instanceof Element ? event.target : (event.target as Node | null)?.parentElement
  const column = document.querySelector(CHAT_COLUMN)
  if (target === null || target === undefined || column === null || !column.contains(target) || target.closest(CONTROLS) !== null) return
  const selection = window.getSelection()
  if (selection !== null && !selection.isCollapsed) return
  void play()
}

const onKey = (event: KeyboardEvent) => {
  if (worn?.triggers.send !== true || event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  const target = event.target instanceof Element ? event.target : undefined
  if (target?.closest(COMPOSER) == null) return
  const text = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target.value : target.textContent ?? ''
  if (text.trim() !== '') setTimeout(() => void play(), 60)
}

const onSendClick = (event: MouseEvent) => {
  if (worn?.triggers.send !== true) return
  const button = event.target instanceof Element ? event.target.closest('button') : null
  if (button === null || button.closest(COMPOSER) === null) return
  const label = `${button.getAttribute('aria-label') ?? ''} ${button.getAttribute('title') ?? ''} ${button.textContent ?? ''}`
  if (button.type === 'submit' || SEND_LABEL.test(label)) setTimeout(() => void play(), 60)
}

/** Once a second: still in the column dsh shows now, and whether dsh just finished answering. */
function watch(): void {
  // Her own page sits in the same column: wait for a conversation, one with a message box.
  const column = attach()
  if (shown && column?.querySelector(COMPOSER) != null) {
    // From the start, even when it was already playing (behind her page, unseen).
    shown = false
    playing = false
    void play()
  }
  const running = document.querySelector(RUNNING) !== null
  if (wasRunning && !running && worn?.triggers.reply === true) void play()
  wasRunning = running
}

function start(): void {
  if (watchTimer !== undefined) return
  document.addEventListener('click', onClick)
  document.addEventListener('click', onSendClick, true)
  document.addEventListener('keydown', onKey, true)
  watchTimer = setInterval(watch, 1000)
  whaleHider = document.createElement('style')
  whaleHider.dataset.dshHer = 'hide-home-whale'
  whaleHider.textContent = DSH_WHALE_HIDDEN
  document.head.append(whaleHider)
  // Light and dark: the theme's colour again.
  themeWatch = new MutationObserver(() => { if (worn?.look.color === 'theme') frame?.setInk(inkNow()) })
  themeWatch.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-theme-source', 'style', 'class'] })
}

function stopAll(): void {
  document.removeEventListener('click', onClick)
  document.removeEventListener('click', onSendClick, true)
  document.removeEventListener('keydown', onKey, true)
  clearInterval(watchTimer)
  clearInterval(everyTimer)
  watchTimer = everyTimer = undefined
  themeWatch?.disconnect()
  themeWatch = undefined
  whaleHider?.remove()
  whaleHider = undefined
  frame?.destroy()
  frame = undefined
  layer?.remove()
  layer = undefined
  playing = false
}

/** What the brain says the chat background is (from web/status); undefined: none. */
export function wearPixelBackground(bg: PixelBackground | undefined): void {
  const key = bg === undefined || phone() ? '' : JSON.stringify(bg)
  if (key === wornKey) return
  wornKey = key
  stopAll()
  worn = key === '' ? undefined : bg
  if (worn === undefined) return
  start()
  attach()
  if (worn.triggers.everyMin > 0) everyTimer = setInterval(() => void play(), worn.triggers.everyMin * 60_000)
  if (worn.triggers.loop) void play()
  else if (worn.triggers.open && !opened) {
    // Once, when a conversation is first on screen (dsh may open on her page or the home page).
    opened = true
    shown = true
  }
}

/**
 * Just chosen in 像素工坊: worn now (not at the next status), and played
 * once the next time a conversation is on screen, whatever its triggers.
 * Whether this page can show it (not on phones, not with reduced motion).
 */
export function showPixelBackground(bg: PixelBackground): boolean {
  wearPixelBackground(bg)
  if (worn === undefined || still()) return false
  shown = true
  watch()
  return true
}
