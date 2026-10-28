/**
 * Body page (M0 spike): an idle pool of clips on two players that crossfade,
 * plus overlay click-through and dragging.
 *
 * Each player is a <video>; for "stacked" packs the video stays hidden and a
 * WebGL canvas shows it (see stacked.ts). The crossfade toggles whichever
 * element is visible.
 *
 * Click-through: main keeps the window ignoring the mouse but forwarding moves.
 * On each move (throttled) the current frame's alpha under the pointer, read
 * from a 64-px-wide canvas, decides whether the pointer is on her; main then
 * stops ignoring the mouse so she can be clicked and dragged. No screen
 * recording permission is involved. M3 replaces the live sampling with masks
 * precomputed at import.
 */

import type { BodyConfig, HerBridge, PackLayout } from '../shared/types.ts'
import { StackedView } from './stacked.ts'

declare global {
  interface Window { her: HerBridge }
}

const FADE_LEAD_S = 0.6
const HIT_ALPHA = 40
const HIT_EVERY_MS = 50

interface Player {
  video: HTMLVideoElement
  /** The element on screen: the video itself, or its WebGL canvas. */
  shown: HTMLElement
}

const stage = document.getElementById('stage') as HTMLDivElement
let players: Player[] = []
let active = 0
let lastClip = -1
let switching = false

function makePlayers(layout: PackLayout): Player[] {
  return [0, 1].map(() => {
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
  })
}

async function playNext(config: BodyConfig): Promise<void> {
  const clips = config.pack.clips
  let pick = Math.floor(Math.random() * clips.length)
  if (clips.length > 1 && pick === lastClip) pick = (pick + 1) % clips.length
  lastClip = pick
  const incoming = players[1 - active]!
  const outgoing = players[active]!
  incoming.video.src = clips[pick]!.url
  incoming.video.currentTime = 0
  await incoming.video.play()
  incoming.shown.classList.add('on')
  outgoing.shown.classList.remove('on')
  active = 1 - active
  setTimeout(() => { if (players[1 - active] === outgoing) outgoing.video.pause() }, 700)
}

function watchForEnd(config: BodyConfig): void {
  for (const { video } of players) {
    video.addEventListener('timeupdate', () => {
      if (video !== players[active]!.video || switching || !Number.isFinite(video.duration)) return
      if (video.duration - video.currentTime > FADE_LEAD_S) return
      switching = true
      playNext(config).catch(console.error).finally(() => { switching = false })
    })
  }
}

/** Whether a window point is on her: inside the shown frame and not transparent there. */
function makeHitTest(layout: PackLayout): (x: number, y: number) => boolean {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return (x, y) => {
    const video = players[active]!.video
    if (video.videoWidth === 0) return false
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

function wireOverlay(config: BodyConfig): void {
  const hitTest = makeHitTest(config.pack.layout)
  let onHer = false
  let lastCheck = 0
  let drag: { x: number; y: number } | undefined
  const setOnHer = (value: boolean) => {
    if (value === onHer) return
    onHer = value
    window.her.hit(value)
    document.body.style.cursor = value ? 'grab' : 'default'
  }
  window.addEventListener('mousemove', event => {
    if (drag !== undefined) {
      window.her.drag(event.screenX - drag.x, event.screenY - drag.y)
      drag = { x: event.screenX, y: event.screenY }
      return
    }
    const now = performance.now()
    if (now - lastCheck < HIT_EVERY_MS) return
    lastCheck = now
    setOnHer(hitTest(event.clientX, event.clientY))
  })
  window.addEventListener('mouseleave', () => { if (drag === undefined) setOnHer(false) })
  window.addEventListener('mousedown', event => {
    if (event.button === 0 && onHer) drag = { x: event.screenX, y: event.screenY }
  })
  window.addEventListener('mouseup', () => { drag = undefined })
  window.addEventListener('contextmenu', event => {
    event.preventDefault()
    if (onHer) window.her.menu()
  })
}

async function main(): Promise<void> {
  const config = await window.her.config()
  document.body.classList.add(config.mode)
  players = makePlayers(config.pack.layout)
  watchForEnd(config)
  await playNext(config)
  if (config.mode === 'overlay') wireOverlay(config)
  else window.addEventListener('contextmenu', () => window.her.menu())
}

main().catch(error => console.error(error))
