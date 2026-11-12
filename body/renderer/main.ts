/**
 * Body page: her clips (player.ts), her voice (speech-player.ts), the speech
 * bubble (bubble.ts), the microphone (mic.ts), the input box, and overlay
 * click-through and dragging.
 *
 * Talking: the shortcut listens for one utterance; "always listening" keeps
 * the microphone open. When you start talking while she speaks, she stops at
 * once and the brain is told how far she got (barge-in). If that keeps firing
 * on her own voice (speakers, no headphones: speech starts while she talks but
 * nothing is understood), barge-in turns off for the session and she finishes
 * before listening; she says so once.
 *
 * Performing: the brain asks for actions (`act`, answered with `act.done`) and
 * emotions; cues riding on a sentence fire when that sentence starts. Stored
 * lines play their own audio and show their words.
 *
 * Click-through: main keeps the window ignoring the mouse but forwarding moves.
 * On each move (throttled) the current clip's click mask (made at import)
 * decides whether the pointer is on her; packs without masks fall back to the
 * frame's alpha read from a 64-px canvas. Main then stops ignoring the mouse so
 * she can be clicked and dragged. No screen recording permission is involved.
 *
 * With `--her-debug`, `window.__her` offers test hooks (inject a recording, read
 * timings).
 */

import type { BrainMessage, Cue } from '../../src/protocol/index.ts'
import type { BodyConfig, HerBridge, LinkStatus, MicMode, PackClipInfo, PackLayout, SceneLayout } from '../shared/types.ts'
import { fitScene } from '../../src/pack/fit.ts'
import { touchPart, type TouchKind, type TouchPart } from '../../src/core/touch.ts'
import { Bubble } from './bubble.ts'
import { Mic } from './mic.ts'
import { Player } from './player.ts'
import { SpeechPlayer } from './speech-player.ts'
import { SAMPLE_RATE, toPcm16 } from './vad.ts'

declare global {
  interface Window {
    her: HerBridge
    __her?: unknown
    __herTap?: (x: number, y: number) => void
  }
}

const HIT_ALPHA = 40
const HIT_EVERY_MS = 50
/** Barge-ins that heard nothing, within this window, before barge-in is turned off. */
const FALSE_BARGE_LIMIT = 2
const FALSE_BARGE_WINDOW_MS = 30_000

const stage = document.getElementById('stage') as HTMLDivElement
const bubble = new Bubble(document.getElementById('bubble')!)
const micDot = document.getElementById('mic') as HTMLDivElement
let player: Player | undefined
let speech: SpeechPlayer | undefined
let linkStatus: LinkStatus = 'connecting'
let bargeIn = true
let micMode: MicMode = 'push-to-talk'
/** The floating window beside the wallpaper one: it shows her and is touched; the other window listens and speaks. */
let companion = false
let lastHeard: string | undefined
/** When the last barge-in happened, until its utterance is understood (or not). */
let bargedAt: number | undefined
const falseBarges: number[] = []
let uttCounter = 0

/** Timings for tests and tuning: from the end of your utterance to her first sound. */
const stats: { utteranceEndAt?: number; firstAudioAt?: number; turns: Array<{ endToVoiceMs: number }> } = { turns: [] }

const mic = new Mic({
  listening: on => micDot.classList.toggle('on', on),
  speechStart: () => {
    micDot.classList.add('speech')
    player?.touch()
    if (speech?.speaking !== true) return
    const at = speech.cut()
    if (at === undefined) return
    bargedAt = Date.now()
    void window.her.send({ t: 'interrupt', cid: '', ...at })
    bubble.cancel(at.uid)
    player?.setState('listen')
  },
  utterance: samples => {
    micDot.classList.remove('speech')
    sendUtterance(samples)
  },
  nothing: () => {
    micDot.classList.remove('speech')
    noteFalseBarge()
  },
})

function sendUtterance(samples: Float32Array): void {
  const pcm = toPcm16(samples)
  const durationMs = Math.round((samples.length / SAMPLE_RATE) * 1000)
  stats.utteranceEndAt = performance.now()
  stats.firstAudioAt = undefined
  bubble.thinking()
  void window.her.utterance(`u${++uttCounter}`, pcm.buffer as ArrayBuffer, durationMs).then(sent => {
    if (!sent) bubble.note('（我现在连不上 dsh，等它开起来再说吧）')
  })
}

/** A barge-in that turned out to be nothing (her own voice through the speakers, most likely). */
function noteFalseBarge(): void {
  if (bargedAt === undefined || Date.now() - bargedAt > 10_000) return
  bargedAt = undefined
  const now = Date.now()
  falseBarges.push(now)
  while (falseBarges.length > 0 && now - falseBarges[0]! > FALSE_BARGE_WINDOW_MS) falseBarges.shift()
  if (bargeIn && falseBarges.length >= FALSE_BARGE_LIMIT) {
    bargeIn = false
    bubble.note('（外放的回声太大，我老是把自己的声音当成你在说话。我改成说完再听你的了，戴耳机会好很多。）', 8000)
  }
}

const masks = new Map<string, Uint8Array | 'loading'>()

function loadMask(clip: PackClipInfo): void {
  if (clip.mask === undefined || masks.has(clip.id)) return
  masks.set(clip.id, 'loading')
  fetch(clip.mask.url).then(r => r.arrayBuffer()).then(b => masks.set(clip.id, new Uint8Array(b)), () => masks.delete(clip.id))
}

/** The current clip's mask value (0–255) at a point given as fractions of the frame, if its mask is loaded. */
function maskAt(clip: PackClipInfo | undefined, time: number, fx: number, fy: number): number | undefined {
  const mask = clip?.mask
  if (clip === undefined || mask === undefined) return undefined
  const data = masks.get(clip.id)
  if (data === undefined) {
    loadMask(clip)
    return undefined
  }
  if (data === 'loading') return undefined
  const index = Math.min(mask.frames - 1, Math.floor(time * mask.fps))
  const px = Math.min(mask.width - 1, Math.floor(fx * mask.width))
  const py = Math.min(mask.height - 1, Math.floor(fy * mask.height))
  return data[index * mask.width * mask.height + py * mask.width + px]
}

/** Where her picture is in the window: how big a clip's frame shows, and where. */
function frameBox(layout: PackLayout): { left: number; top: number; w: number; h: number } | undefined {
  const video = player?.current.video
  if (video === undefined || video.videoWidth === 0) return undefined
  const frameW = video.videoWidth
  const frameH = layout === 'stacked' ? video.videoHeight / 2 : video.videoHeight
  const box = stage.getBoundingClientRect()
  const scale = Math.min(box.width / frameW, box.height / frameH)
  const w = frameW * scale
  const h = frameH * scale
  return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, w, h }
}

/** Her figure's top and bottom in the current frame, as fractions of it, from the click mask. */
function figureExtent(clip: PackClipInfo | undefined, time: number): { top: number; bottom: number } {
  const mask = clip?.mask
  const data = clip === undefined ? undefined : masks.get(clip.id)
  if (mask === undefined || data === undefined || data === 'loading') return { top: 0, bottom: 1 }
  const index = Math.min(mask.frames - 1, Math.floor(time * mask.fps))
  const start = index * mask.width * mask.height
  let top = -1
  let bottom = -1
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (data[start + y * mask.width + x]! <= HIT_ALPHA) continue
      if (top === -1) top = y
      bottom = y
      break
    }
  }
  return top === -1 ? { top: 0, bottom: 1 } : { top: top / mask.height, bottom: (bottom + 1) / mask.height }
}

/** Which part of her a window point is on. */
function partAt(layout: PackLayout, x: number, y: number): TouchPart {
  const box = frameBox(layout)
  if (box === undefined) return 'body'
  const { top, bottom } = figureExtent(player?.current.clip, player?.current.video.currentTime ?? 0)
  const fy = (y - box.top) / box.h
  return touchPart(Math.max(0, Math.min(1, (fy - top) / Math.max(0.01, bottom - top))))
}

/** Whether a window point is on her: inside the shown frame and not transparent there. */
function makeHitTest(layout: PackLayout): (x: number, y: number) => boolean {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return (x, y) => {
    if (player === undefined) {
      // The placeholder (no look yet) is what you can click and drag.
      const box = document.querySelector('#empty .face')?.getBoundingClientRect()
      return box !== undefined && x >= box.left && x < box.right && y >= box.top && y < box.bottom
    }
    const video = player?.current.video
    const shownBox = frameBox(layout)
    if (video === undefined || shownBox === undefined) return false
    const frameW = video.videoWidth
    const frameH = layout === 'stacked' ? video.videoHeight / 2 : video.videoHeight
    const { left, top, w, h } = shownBox
    if (x < left || x >= left + w || y < top || y >= top + h) return false
    if (layout === 'opaque') return true
    const fromMask = maskAt(player?.current.clip, video.currentTime, (x - left) / w, (y - top) / h)
    if (fromMask !== undefined) return fromMask > HIT_ALPHA
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

/** Typing to her: the talk bar, in its own window (desktop) or on the page (web). */
function openInput(): void {
  player?.touch()
  window.her.openBar()
}

/** The talk shortcut: cut her off if she is talking, then listen for one utterance. */
function talk(): void {
  player?.touch()
  const at = speech?.cut()
  if (at !== undefined) {
    void window.her.send({ t: 'interrupt', cid: '', ...at })
    bubble.cancel(at.uid)
  }
  player?.setState('listen')
  mic.listenOnce().catch(error => bubble.note(`（打不开麦克风：${(error as Error).message}）`, 6000))
}

/** A soft sound of being touched, made here: no file to ship. */
let touchAudio: AudioContext | undefined
function touchSound(part: TouchPart, kind: TouchKind): void {
  if (muted) return
  try {
    touchAudio ??= new AudioContext()
    void touchAudio.resume()
    const now = touchAudio.currentTime
    const notes = kind === 'long' ? [520, 620, 720] : part === 'head' ? [660, 880] : [440]
    notes.forEach((frequency, i) => {
      const oscillator = touchAudio!.createOscillator()
      const gain = touchAudio!.createGain()
      const start = now + i * 0.07
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.05, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
      oscillator.connect(gain).connect(touchAudio!.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.18)
    })
  } catch {
    // no sound here: the movement is enough
  }
}

/** She moves at once, whatever else is going on; a clip of hers can follow. */
function touchMove(part: TouchPart, kind: TouchKind): void {
  const name = kind === 'long' ? 'touch-long' : part === 'head' ? 'touch-head' : 'touch-body'
  stage.classList.remove('touch-head', 'touch-body', 'touch-long')
  // Restart the animation when she is touched again before it ends.
  void stage.offsetWidth
  stage.classList.add(name)
}
stage.addEventListener('animationend', event => {
  if (event.animationName.startsWith('touch-')) stage.classList.remove('touch-head', 'touch-body', 'touch-long')
})

/** A second press this soon makes it a double click (which opens the input box): she does not speak for the first. */
const TAP_WAIT_MS = 260
const LONG_PRESS_MS = 700
const MOVE_LIMIT_PX = 4
let tapTimer: number | undefined

function reactToTouch(layout: PackLayout, x: number, y: number, kind: TouchKind): void {
  const part = partAt(layout, x, y)
  touchMove(part, kind)
  touchSound(part, kind)
  player?.touch()
  window.clearTimeout(tapTimer)
  tapTimer = window.setTimeout(() => { void window.her.send({ t: 'touch', cid: '', part, kind }) }, kind === 'long' ? 0 : TAP_WAIT_MS)
}

/** A press on her that does not become a drag is a touch: short, or held. */
function wireTouch(config: BodyConfig, hitTest: (x: number, y: number) => boolean): void {
  const { layout } = config.pack
  let press: { x: number; y: number; at: number; timer: number; held: boolean } | undefined
  const end = () => {
    if (press !== undefined) window.clearTimeout(press.timer)
    press = undefined
  }
  window.addEventListener('mousedown', event => {
    if (event.button !== 0 || !hitTest(event.clientX, event.clientY)) return
    end()
    const { clientX: x, clientY: y } = event
    const timer = window.setTimeout(() => {
      if (press === undefined) return
      press.held = true
      reactToTouch(layout, x, y, 'long')
    }, LONG_PRESS_MS)
    press = { x, y, at: performance.now(), timer, held: false }
  })
  window.addEventListener('mousemove', event => {
    if (press !== undefined && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_LIMIT_PX) end()
  })
  window.addEventListener('mouseup', event => {
    if (press === undefined) return
    const { held, x, y } = press
    end()
    if (!held && event.button === 0) reactToTouch(layout, x, y, 'tap')
  })
  window.addEventListener('dblclick', () => {
    window.clearTimeout(tapTimer)
    end()
  })
  // A finger on a phone: the page outside has no mouse to hand over, so it asks here.
  window.__herTap = (x: number, y: number) => {
    if (hitTest(x, y)) reactToTouch(layout, x, y, 'tap')
  }
}

/**
 * The two small buttons at her feet while the pointer is on her: hold the
 * microphone to talk (her answer comes over her head), or open the talk bar
 * to type (her answer comes there).
 */
function wireControls(): (x: number, y: number) => boolean {
  const box = document.getElementById('ctl')!
  const micButton = document.getElementById('ctl-mic') as HTMLButtonElement
  const typeButton = document.getElementById('ctl-type') as HTMLButtonElement
  // A page without HTTPS has no microphone.
  if (!window.isSecureContext) micButton.style.display = 'none'
  let hideTimer: number | undefined
  let held = false
  const over = (x: number, y: number): boolean => {
    if (!box.classList.contains('show')) return false
    const b = box.getBoundingClientRect()
    return x >= b.left - 8 && x <= b.right + 8 && y >= b.top - 8 && y <= b.bottom + 8
  }
  const release = () => {
    if (!held) return
    held = false
    micButton.classList.remove('on')
    window.her.hold(false)
  }
  micButton.addEventListener('pointerdown', event => {
    event.preventDefault()
    event.stopPropagation()
    micButton.setPointerCapture(event.pointerId)
    held = true
    micButton.classList.add('on')
    window.her.hold(true)
  })
  for (const end of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) micButton.addEventListener(end, release)
  typeButton.addEventListener('click', event => {
    event.stopPropagation()
    openInput()
  })
  // A press on a button is not a press on her: no drag, no touch.
  for (const type of ['mousedown', 'mouseup', 'dblclick'] as const) box.addEventListener(type, event => event.stopPropagation())
  showControls = () => {
    window.clearTimeout(hideTimer)
    box.classList.add('show')
    hideTimer = window.setTimeout(() => { if (!held) box.classList.remove('show') }, 1800)
  }
  return over
}
let showControls = (): void => {}

function wireOverlay(config: BodyConfig): void {
  const figure = makeHitTest(config.pack.layout)
  const overControls = wireControls()
  const hitTest = (x: number, y: number) => overControls(x, y) || figure(x, y)
  wireTouch(config, figure)
  let onHer = false
  let lastCheck = 0
  let drag: { x: number; y: number; moved: boolean } | undefined
  const setOnHer = (value: boolean) => {
    if (value === onHer) return
    onHer = value
    // While the input box is open the window keeps the mouse.
    window.her.hit(value)
    document.body.style.cursor = value ? 'grab' : 'default'
  }
  window.addEventListener('mousemove', event => {
    if (drag !== undefined) {
      // A hand is never still: a press only becomes a drag once it has really moved.
      if (!drag.moved && Math.hypot(event.screenX - drag.x, event.screenY - drag.y) <= MOVE_LIMIT_PX) return
      window.her.drag(event.screenX - drag.x, event.screenY - drag.y)
      drag = { x: event.screenX, y: event.screenY, moved: true }
      return
    }
    const now = performance.now()
    if (now - lastCheck < HIT_EVERY_MS) return
    lastCheck = now
    setOnHer(hitTest(event.clientX, event.clientY))
    if (onHer) showControls()
  })
  window.addEventListener('mouseleave', () => { if (drag === undefined) setOnHer(false) })
  window.addEventListener('mousedown', event => {
    if (event.button === 0 && onHer) {
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

/** Holding the talk button or key: cut her off, listen until let go, send it all. */
function holdStart(): void {
  player?.touch()
  const at = speech?.cut()
  if (at !== undefined) {
    void window.her.send({ t: 'interrupt', cid: '', ...at })
    bubble.cancel(at.uid)
  }
  player?.setState('listen')
  mic.holdStart().catch(error => bubble.note(`（打不开麦克风：${(error as Error).message}）`, 6000))
}

function holdEnd(): void {
  mic.holdEnd()
}

function setMicMode(mode: MicMode): void {
  if (companion) return
  micMode = mode
  mic.setAlways(mode === 'always').catch(error => bubble.note(`（打不开麦克风：${(error as Error).message}）`, 6000))
}

/** Act out a sentence's cues as it starts. */
function perform(cues: Cue[]): void {
  for (const cue of cues) {
    if (cue.kind === 'emotion') player?.emote(cue.name)
    else void player?.act(cue.name)
  }
}

/** A clip came on screen: stored lines speak, and the brain hears where she stands. */
let lastAnchor: string | undefined
let lineAudio: HTMLAudioElement | undefined
let muted = false
/** Clips as they came on screen, with when (for tests and tuning). */
const played: Array<{ id: string; at: number }> = []
function clipStarted(clip: PackClipInfo): void {
  // Ready before the first touch: a finger has no hover to fetch it on the way.
  loadMask(clip)
  played.push({ id: clip.id, at: Math.round(performance.now()) })
  if (played.length > 200) played.shift()
  if (clip.role === 'line') {
    if (clip.audioUrl !== undefined) {
      lineAudio?.pause()
      lineAudio = new Audio(clip.audioUrl)
      lineAudio.muted = muted
      void lineAudio.play()
    }
    if (clip.transcript !== undefined) bubble.note(clip.transcript, clip.durationMs + 800)
  }
  if (clip.to !== lastAnchor) {
    lastAnchor = clip.to
    void window.her.send({ t: 'posture', cid: '', anchor: clip.to })
  }
}

function onBrain(message: BrainMessage, audio?: Uint8Array): void {
  switch (message.t) {
    case 'act':
      if (player === undefined) {
        void window.her.send({ t: 'act.done', cid: '', id: message.id, ok: false, reason: 'not ready' })
        break
      }
      player.act(message.action).then(result => window.her.send({ t: 'act.done', cid: '', id: message.id, ...result }), console.error)
      break
    case 'emotion':
      player?.emote(message.emotion)
      break
    case 'welcome':
      bargeIn = message.config.bargeIn && falseBarges.length < FALSE_BARGE_LIMIT
      if (message.config.mic !== micMode) setMicMode(message.config.mic)
      break
    case 'state':
      player?.setState(message.state)
      if (message.state === 'think') {
        bubble.thinking(lastHeard)
        lastHeard = undefined
      }
      break
    case 'heard':
      if (message.text === '') {
        const barged = bargedAt !== undefined
        noteFalseBarge()
        if (!barged && message.ignored === undefined && micMode === 'push-to-talk') bubble.note('（没听清，再说一遍？）', 2500)
      } else {
        bargedAt = undefined
        lastHeard = message.text
      }
      break
    case 'speak.begin':
      speech?.begin(message.uid)
      bubble.begin(message.uid)
      break
    case 'speak.seg':
      speech?.seg(message.uid, {
        seq: message.seq, text: message.text, durationMs: message.durationMs,
        ...(audio === undefined ? {} : { audio }), ...(message.cues === undefined ? {} : { cues: message.cues }),
      })
      break
    case 'speak.end':
      speech?.end(message.uid)
      break
    case 'speak.cancel':
      speech?.cancel(message.uid)
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

function installDebugHooks(): void {
  window.__her = {
    stats,
    played,
    get clip(): string | undefined { return player?.current.clip?.id },
    get anchor(): string | undefined { return player?.director.at },
    act: (action: string) => player?.act(action),
    emote: (emotion: string) => player?.emote(emotion),
    /** Play a recording into the pipeline as if you had said it. */
    async injectWav(url: string): Promise<number> {
      const bytes = await (await fetch(url)).arrayBuffer()
      const decoded = await new AudioContext().decodeAudioData(bytes)
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE)
      const source = offline.createBufferSource()
      source.buffer = decoded
      source.connect(offline.destination)
      source.start()
      const rendered = await offline.startRendering()
      sendUtterance(rendered.getChannelData(0))
      return rendered.duration
    },
    /** As if you started talking right now (barge-in path). */
    speechStart(): boolean {
      const speaking = speech?.speaking === true
      if (speaking) {
        const at = speech!.cut()
        if (at !== undefined) {
          bargedAt = Date.now()
          void window.her.send({ t: 'interrupt', cid: '', ...at })
          bubble.cancel(at.uid)
        }
      }
      return speaking
    },
    get speaking(): boolean { return speech?.speaking === true },
    get bargeIn(): boolean { return bargeIn },
  }
}

// Listeners first: the shortcut may fire while the config loads.
window.her.onShowInput(openInput)
window.her.onHold(on => { if (on) holdStart(); else holdEnd() })
// "Answer where you asked": with the talk bar open the conversation is there, so nothing over her head.
window.her.onBar(open => document.body.classList.toggle('bar-open', open))
window.her.onTalk(talk)
window.her.onMicMode(setMicMode)
window.her.onBrain(onBrain)
window.her.onStatus(status => { linkStatus = status })

/**
 * A full-screen photo with her clips over one region of it: the photo covers
 * the window the way a wallpaper does (scaled to fill, centred, the overflow
 * cut), and the stage takes the same transform, so the clips sit on exactly
 * the pixels they were cut from. Her bubble floats just above her.
 */
function layoutScene(scene: SceneLayout, plateUrl: string): void {
  document.body.classList.add('region')
  const plate = document.getElementById('plate') as HTMLImageElement
  const fill = document.getElementById('plate-fill') as HTMLImageElement
  plate.src = plateUrl
  fill.src = plateUrl
  const stage = document.getElementById('stage')!
  const bubble = document.getElementById('bubble')!
  const place = () => {
    const { innerWidth: w, innerHeight: h } = window
    const fit = fitScene(scene, w, h)
    document.body.classList.toggle('fill', !fit.covers)
    Object.assign(plate.style, { left: `${fit.left}px`, top: `${fit.top}px`, width: `${scene.width * fit.scale}px`, height: `${scene.height * fit.scale}px` })
    const box = fit.region
    Object.assign(stage.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` })
    Object.assign(bubble.style, { left: `${Math.max(16, Math.min(box.x + box.width * 0.05, w - w * 0.3 - 16))}px`, bottom: `${Math.max(16, h - box.y - box.height * 0.15)}px` })
  }
  place()
  window.addEventListener('resize', place)
}

async function main(): Promise<void> {
  const config = await window.her.config()
  document.body.classList.add(config.mode)
  if (config.pack.layer === 'scene') {
    document.body.classList.add('scene')
    if (config.pack.plateUrl !== undefined) {
      document.body.classList.add('plate')
      document.documentElement.style.setProperty('--plate', `url("${config.pack.plateUrl}")`)
    }
  }
  if (config.pack.scene !== undefined && config.pack.plateUrl !== undefined) layoutScene(config.pack.scene, config.pack.plateUrl)
  document.documentElement.style.setProperty('--her-w', `${config.her.width}px`)
  document.documentElement.style.setProperty('--her-h', `${config.her.height}px`)
  document.documentElement.style.setProperty('--her-aspect', String(config.her.width / config.her.height))
  muted = config.mute
  companion = config.pet === true
  if (config.bubble === false) document.body.classList.add('no-bubble')
  // Nobody sees this window (both desktop places are off): no clips to decode, only her voice and the microphone.
  if (config.pack.clips.length === 0 || config.unseen === true) document.body.classList.add('empty')
  else player = new Player(stage, config.pack, { started: clipStarted })
  speech = new SpeechPlayer({
    sentence: (uid, seq, text, durationMs, cues) => {
      perform(cues)
      if (seq === 0 && stats.utteranceEndAt !== undefined && stats.firstAudioAt === undefined) {
        stats.firstAudioAt = performance.now()
        stats.turns.push({ endToVoiceMs: Math.round(stats.firstAudioAt - stats.utteranceEndAt) })
      }
      bubble.seg(uid, text, durationMs)
      player?.setState('talk')
    },
    progress: (uid, seq, phase) => { void window.her.send({ t: 'speak.progress', cid: '', uid, seq, phase }) },
    done: uid => {
      bubble.end(uid)
      player?.setState('idle')
    },
  }, config.mute)
  // While she talks and barge-in is off, the microphone ignores what it hears.
  window.setInterval(() => { mic.paused = !bargeIn && speech?.speaking === true }, 100)
  window.her.onFadeOut(() => document.body.classList.add('leaving'))
  if (config.debug) installDebugHooks()
  await player?.start()
  if (config.mode === 'overlay') wireOverlay(config)
  else {
    window.addEventListener('contextmenu', () => window.her.menu())
    if (config.mode === 'window') wireTouch(config, makeHitTest(config.pack.layout))
  }
}

main().catch(error => console.error(error))
