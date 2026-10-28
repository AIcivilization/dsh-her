/**
 * Body page: her clips (player.ts), the speech bubble (bubble.ts), the input
 * box, and overlay click-through and dragging.
 *
 * Click-through: main keeps the window ignoring the mouse but forwarding moves.
 * On each move (throttled) the current frame's alpha under the pointer, read
 * from a 64-px-wide canvas, decides whether the pointer is on her; main then
 * stops ignoring the mouse so she can be clicked and dragged. No screen
 * recording permission is involved. M3 replaces the live sampling with masks
 * precomputed at import.
 *
 * Talking to her: double-click her, or the global shortcut, opens the input
 * box; Enter sends, Esc closes.
 */

import type { BrainMessage } from '../../src/protocol/index.ts'
import type { BodyConfig, HerBridge, LinkStatus, PackLayout } from '../shared/types.ts'
import { Bubble } from './bubble.ts'
import { Player } from './player.ts'

declare global {
  interface Window { her: HerBridge }
}

const HIT_ALPHA = 40
const HIT_EVERY_MS = 50

const stage = document.getElementById('stage') as HTMLDivElement
const bubble = new Bubble(document.getElementById('bubble')!)
const ask = document.getElementById('ask') as HTMLFormElement
const askInput = document.getElementById('ask-input') as HTMLInputElement
let player: Player | undefined
let linkStatus: LinkStatus = 'connecting'

/** Whether a window point is on her: inside the shown frame and not transparent there. */
function makeHitTest(layout: PackLayout): (x: number, y: number) => boolean {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return (x, y) => {
    const video = player?.current.video
    if (video === undefined || video.videoWidth === 0) return false
    const frameW = video.videoWidth
    const frameH = layout === 'stacked' ? video.videoHeight / 2 : video.videoHeight
    const box = stage.getBoundingClientRect()
    const scale = Math.min(box.width / frameW, box.height / frameH)
    const w = frameW * scale
    const h = frameH * scale
    const left = box.left + (box.width - w) / 2
    const top = box.top + (box.height - h) / 2
    if (x < left || x >= left + w || y < top || y >= top + h) return false
    if (layout === 'opaque') return true
    canvas.width = 64
    canvas.height = Math.round(64 * frameH / frameW)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Stacked: read the mask (the lower half); alpha: read the alpha channel.
    ctx.drawImage(video, 0, layout === 'stacked' ? frameH : 0, frameW, frameH, 0, 0, canvas.width, canvas.height)
    const px = Math.floor(((x - left) / w) * canvas.width)
    const py = Math.floor(((y - top) / h) * canvas.height)
    const [r, , , a] = ctx.getImageData(px, py, 1, 1).data
    return (layout === 'stacked' ? r! : a!) > HIT_ALPHA
  }
}

function openInput(): void {
  ask.classList.add('show')
  window.her.interactive(true)
  player?.touch()
  askInput.focus()
}

function closeInput(): void {
  ask.classList.remove('show')
  askInput.value = ''
  window.her.interactive(false)
}

function wireInput(): void {
  ask.addEventListener('submit', event => {
    event.preventDefault()
    const text = askInput.value.trim()
    closeInput()
    if (text === '') return
    window.her.say(text).then(sent => {
      if (!sent) bubble.note(linkStatus === 'rejected' ? '（dsh 不认我了，得重新配对）' : '（我现在连不上 dsh，等它开起来再说吧）')
    }, console.error)
  })
  askInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeInput()
  })
  askInput.addEventListener('blur', () => { if (askInput.value.trim() === '') closeInput() })
}

function wireOverlay(config: BodyConfig): void {
  const hitTest = makeHitTest(config.pack.layout)
  let onHer = false
  let lastCheck = 0
  let drag: { x: number; y: number; moved: boolean } | undefined
  const setOnHer = (value: boolean) => {
    if (value === onHer) return
    onHer = value
    // While the input box is open the window keeps the mouse.
    if (!ask.classList.contains('show')) window.her.hit(value)
    document.body.style.cursor = value ? 'grab' : 'default'
  }
  window.addEventListener('mousemove', event => {
    if (drag !== undefined) {
      window.her.drag(event.screenX - drag.x, event.screenY - drag.y)
      drag = { x: event.screenX, y: event.screenY, moved: true }
      return
    }
    const now = performance.now()
    if (now - lastCheck < HIT_EVERY_MS) return
    lastCheck = now
    setOnHer(hitTest(event.clientX, event.clientY))
  })
  window.addEventListener('mouseleave', () => { if (drag === undefined) setOnHer(false) })
  window.addEventListener('mousedown', event => {
    if (event.button === 0 && onHer && !ask.contains(event.target as Node)) {
      drag = { x: event.screenX, y: event.screenY, moved: false }
      player?.touch()
    }
  })
  window.addEventListener('mouseup', () => { drag = undefined })
  window.addEventListener('dblclick', () => { if (onHer) openInput() })
  window.addEventListener('contextmenu', event => {
    event.preventDefault()
    if (onHer) window.her.menu()
  })
}

function onBrain(message: BrainMessage): void {
  switch (message.t) {
    case 'state':
      player?.setState(message.state)
      if (message.state === 'think') bubble.thinking()
      break
    case 'speak.begin':
      bubble.begin(message.uid)
      player?.setState('talk')
      break
    case 'speak.seg':
      bubble.seg(message.uid, message.text, message.durationMs)
      player?.touch()
      break
    case 'speak.end':
      bubble.end(message.uid)
      player?.setState('idle')
      break
    case 'speak.cancel':
      bubble.cancel(message.uid)
      player?.setState('idle')
      break
    case 'bubble':
      bubble.note(message.text, message.ttlMs)
      player?.touch()
      break
    case 'reject':
      bubble.note(`（${message.message}）`, 8000)
      break
  }
}

// Listeners first: the shortcut may ask for the input box while the config loads.
window.her.onShowInput(openInput)
window.her.onBrain(onBrain)
window.her.onStatus(status => { linkStatus = status })

async function main(): Promise<void> {
  const config = await window.her.config()
  document.body.classList.add(config.mode)
  document.documentElement.style.setProperty('--her-w', `${config.her.width}px`)
  document.documentElement.style.setProperty('--her-h', `${config.her.height}px`)
  player = new Player(stage, config.pack)
  await player.start()
  wireInput()
  if (config.mode === 'overlay') wireOverlay(config)
  else window.addEventListener('contextmenu', () => window.her.menu())
}

main().catch(error => console.error(error))
