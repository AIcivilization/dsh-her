/**
 * A 像素动画 behind dsh's conversation (docs/像素动画设计.md §7): a layer in
 * the chat column, under its content and over its own background, taking no
 * clicks. It plays once when something happens (a click on blank space, a
 * message sent, dsh done answering, the page opening, every few minutes), or
 * over and over. Not on phones, not with reduced motion, paused while the tab
 * is hidden. Plain DOM: it lives in dsh's page, outside our React tree.
 */

import type { PixelBackground } from '../core/pixel.ts'
import { herApi } from './api.ts'
import { inkOf, PixelFrame } from './pixel/host.ts'

const CHAT_COLUMN = '[class*="_centerCol"]'
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
let wasRunning = false
let watchTimer: ReturnType<typeof setInterval> | undefined
let everyTimer: ReturnType<typeof setInterval> | undefined
let themeWatch: MutationObserver | undefined
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

/** The layer in the chat column there is now (dsh may have drawn a new one). */
function attach(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>(CHAT_COLUMN)
  if (column === null || worn === undefined) return undefined
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
  if (layer.parentElement !== column) {
    // Its own stacking: -1 lands over the column's background and under its content.
    if (getComputedStyle(column).position === 'static') column.style.position = 'relative'
    column.style.isolation = 'isolate'
    column.append(layer)
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
  attach()
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
    opened = true
    setTimeout(() => void play(), 1200)
  }
}
