/**
 * 纯聊模式 (docs/设置页与编排设计.md §19): the whole screen is hers. Her
 * scene fills it and goes round her scenes on a timer (‹ › to change by
 * hand), she stands on the right, and the conversation is on the left: the
 * talk bar, large, with typing, holding to talk and the way to the whole
 * conversation. For a phone too (open dsh at `#her-chat`, or add it to the
 * home screen). Plain DOM, over dsh's page, like the rest of web-float.
 */

import { StackedView } from '../../body/renderer/stacked.ts'
import { TalkBar } from '../../body/renderer/talk-bar.ts'
import type { ShowMedia } from '../dsh/web-body.ts'
import type { BrainMessage, TalkView } from '../protocol/index.ts'

export interface ChatHost {
  post(path: string, body: unknown): Promise<Response>
  /** Her window in this page, when it is here: holding to talk, hiding her bubble, what she says as she says it. */
  guest(): { hold(on: boolean): void; bar?(open: boolean): void; listen?(listener: (message: BrainMessage) => void): () => void } | undefined
  /** Open one of her conversations in dsh. */
  openSession?: (id: string) => void
  closed(): void
}

interface ChatPrefs {
  /** Minutes between scenes; 0: stays. */
  every: number
  showHer: boolean
  /** How much the scene is dimmed behind the words (%). */
  dim: number
  scene: number
}

const PREFS_KEY = 'dsh-her.chat'
const DEFAULT_PREFS: ChatPrefs = { every: 10, showHer: true, dim: 25, scene: 0 }
const EVERY = [0, 2, 5, 10, 30]

function loadPrefs(): ChatPrefs {
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<ChatPrefs>
    return {
      every: EVERY.includes(value.every as number) ? value.every as number : DEFAULT_PREFS.every,
      showHer: value.showHer !== false,
      dim: typeof value.dim === 'number' ? Math.min(80, Math.max(0, value.dim)) : DEFAULT_PREFS.dim,
      scene: typeof value.scene === 'number' ? value.scene : 0,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function savePrefs(prefs: ChatPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // private window: for this time only
  }
}

const STYLE = `
.her-cm { position: fixed; inset: 0; z-index: 2147482000; overflow: hidden; background: #0d1522; color: #f2f3f8;
  font: 14px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif; }
.her-cm * { box-sizing: border-box; }
.her-cm-scene, .her-cm-scene > * { position: absolute; inset: 0; width: 100%; height: 100%; }
.her-cm-scene > * { object-fit: cover; transition: opacity 1.2s ease; }
.her-cm-scene > .entering { opacity: 0; }
.her-cm-empty { display: flex; align-items: center; justify-content: center; padding: 0 20%; text-align: center; color: rgba(242,243,248,.6);
  background: radial-gradient(ellipse at 30% 20%, #27527e, #0d1522 70%); }
.her-cm-veil { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(90deg, rgba(0,0,0,calc(var(--dim) * 1.6)) 0, rgba(0,0,0,var(--dim)) 45%, rgba(0,0,0,calc(var(--dim) * .4)) 100%); }
.her-cm-her { position: absolute; right: 4vw; bottom: 0; height: 82vh; aspect-ratio: 9 / 16; pointer-events: none; filter: drop-shadow(0 12px 30px rgba(0,0,0,.35)); }
.her-cm-her > * { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; object-position: 50% 100%; }
.her-cm-top { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 8px; padding: 14px 18px;
  background: linear-gradient(rgba(0,0,0,.45), transparent); }
.her-cm-top b { font-size: 16px; }
.her-cm-top .name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: rgba(242,243,248,.7); font-size: 12.5px; }
.her-cm-btn { flex: none; height: 34px; min-width: 34px; padding: 0 10px; border: none; border-radius: 999px; cursor: pointer; color: #f2f3f8; font: inherit;
  background: rgba(255,255,255,.14); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.her-cm-btn:hover { background: rgba(255,255,255,.24); }
.her-cm-panel { position: absolute; left: 4vw; top: 70px; bottom: 24px; width: min(560px, 46vw); display: flex; }
.her-cm-panel .her-bar { display: flex; flex-direction: column; height: 100%; padding: 14px; border-radius: 20px;
  background: color-mix(in srgb, var(--her-bar-bg, rgba(24,26,38,.94)) 72%, transparent); }
.her-cm-panel .her-bar-lines { flex: 1; max-height: none; overflow-y: auto; justify-content: flex-start; margin-bottom: 12px; padding-right: 4px; scrollbar-width: thin; }
.her-cm-panel .her-bar-lines::before { content: ''; flex: 1; }
.her-cm-panel .her-bar-line { display: block; -webkit-line-clamp: unset; max-width: 84%; font-size: 15px; padding: 8px 13px; }
.her-cm-panel .her-bar-input { font-size: 15px; }
.her-cm-menu { position: absolute; right: 18px; top: 60px; width: 260px; padding: 10px; border-radius: 14px; background: rgba(20,22,32,.94);
  box-shadow: 0 12px 34px rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.12); }
.her-cm-menu[hidden] { display: none; }
.her-cm-menu label { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 6px; font-size: 13px; }
.her-cm-menu select, .her-cm-menu input[type=range] { max-width: 130px; }
.her-cm-menu select { background: rgba(255,255,255,.1); color: inherit; border: 1px solid rgba(255,255,255,.2); border-radius: 8px; padding: 3px 6px; font: inherit; }
.her-cm-menu p { margin: 6px 6px 2px; font-size: 12px; color: rgba(242,243,248,.55); }
@media (max-width: 760px) {
  .her-cm-her { right: 50%; translate: 50% 0; bottom: 40vh; height: 52vh; }
  .her-cm-panel { left: 10px; right: 10px; width: auto; top: auto; bottom: 10px; height: 50vh; }
  .her-cm-top { padding: 10px; }
  .her-cm-veil { background: linear-gradient(rgba(0,0,0,var(--dim)) 0, rgba(0,0,0,calc(var(--dim) * 1.6)) 100%); }
}
@media (prefers-reduced-motion: reduce) { .her-cm-scene > * { transition: none; } }
`

/** A picture or clip, as it plays: video, picture, or a stacked clip drawn through a canvas. */
function mediaElement(media: ShowMedia, cover: boolean): { element: HTMLElement; stop: () => void } {
  const url = new URL(media.url, document.baseURI).href
  if (media.kind === 'image') {
    const image = document.createElement('img')
    image.src = url
    image.alt = ''
    image.draggable = false
    return { element: image, stop: () => {} }
  }
  const video = document.createElement('video')
  video.muted = true
  video.loop = true
  video.playsInline = true
  video.autoplay = true
  video.src = url
  if (media.layout === 'stacked') {
    try {
      const view = new StackedView(video)
      const box = document.createElement('div')
      video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0'
      view.canvas.style.cssText = `width:100%;height:100%;object-fit:${cover ? 'cover' : 'contain'};object-position:50% 100%`
      box.append(video, view.canvas)
      void video.play().catch(() => {})
      return { element: box, stop: () => video.pause() }
    } catch {
      // no WebGL: the clip as it is
    }
  }
  void video.play().catch(() => {})
  return { element: video, stop: () => video.pause() }
}

/** Open 纯聊模式 over the page; returns how to close it. */
export function openChatMode(host: ChatHost): () => void {
  if (document.getElementById('her-cm-style') === null) {
    const style = document.createElement('style')
    style.id = 'her-cm-style'
    style.textContent = STYLE
    document.head.append(style)
  }
  const prefs = loadPrefs()
  const root = document.createElement('div')
  root.className = 'her-cm'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', '纯聊模式')
  const sceneBox = document.createElement('div')
  sceneBox.className = 'her-cm-scene'
  const veil = document.createElement('div')
  veil.className = 'her-cm-veil'
  const herBox = document.createElement('div')
  herBox.className = 'her-cm-her'
  const top = document.createElement('header')
  top.className = 'her-cm-top'
  const title = document.createElement('b')
  title.textContent = '她'
  const sceneName = document.createElement('span')
  sceneName.className = 'name'
  const button = (text: string, label: string, action: () => void) => {
    const b = document.createElement('button')
    b.className = 'her-cm-btn'
    b.type = 'button'
    b.textContent = text
    b.title = label
    b.setAttribute('aria-label', label)
    b.onclick = action
    return b
  }
  const panel = document.createElement('div')
  panel.className = 'her-cm-panel'
  const menu = document.createElement('div')
  menu.className = 'her-cm-menu'
  menu.hidden = true

  let scenes: ShowMedia[] = []
  let pet: ShowMedia | undefined
  let current: { element: HTMLElement; stop: () => void } | undefined
  let herMedia: { element: HTMLElement; stop: () => void } | undefined
  let rotate: ReturnType<typeof setInterval> | undefined
  let closed = false

  const applyDim = () => veil.style.setProperty('--dim', String(prefs.dim / 100))
  const showScene = (index: number) => {
    if (scenes.length === 0) {
      sceneBox.replaceChildren(Object.assign(document.createElement('div'), { className: 'her-cm-empty', textContent: '还没有场景：在「她 → 素材库」的「桌面」里传图片或视频，这里就会轮着换。' }))
      sceneName.textContent = ''
      return
    }
    prefs.scene = ((index % scenes.length) + scenes.length) % scenes.length
    savePrefs(prefs)
    const media = scenes[prefs.scene]!
    const next = mediaElement(media, true)
    next.element.classList.add('entering')
    sceneBox.append(next.element)
    const old = current
    current = next
    requestAnimationFrame(() => requestAnimationFrame(() => next.element.classList.remove('entering')))
    setTimeout(() => {
      old?.stop()
      old?.element.remove()
    }, 1300)
    sceneName.textContent = scenes.length > 1 ? `${media.name} · ${prefs.scene + 1}/${scenes.length}` : media.name
  }
  const restartRotation = () => {
    clearInterval(rotate)
    rotate = prefs.every > 0 && scenes.length > 1 ? setInterval(() => showScene(prefs.scene + 1), prefs.every * 60_000) : undefined
  }
  const showHer = () => {
    herMedia?.stop()
    herBox.replaceChildren()
    herMedia = undefined
    if (!prefs.showHer || pet === undefined) return
    herMedia = mediaElement(pet, false)
    herBox.append(herMedia.element)
  }

  // The conversation: the talk bar, large.
  const guest = host.guest()
  const hold = window.isSecureContext && guest !== undefined ? (on: boolean) => guest.hold(on) : undefined
  let view: TalkView | undefined
  const ui: TalkBar = new TalkBar({
    say: async text => (await host.post('/web/send', { message: { t: 'user.text', text } }).then(r => r.ok, () => false)),
    newConversation: () => void host.post('/talk/new', {}).then(refresh),
    resume: id => void host.post('/talk/resume', { id }).then(refresh),
    openFull: () => {
      const id = view?.segment?.id
      if (id !== undefined && host.openSession !== undefined) {
        close()
        host.openSession(id)
      } else ui.showNote('在左侧的"她"工作区里点开这段对话')
    },
    ...(hold === undefined ? {} : { hold }),
    close: () => close(),
    more: () => { menu.hidden = !menu.hidden },
  }, document, { lines: 40 })
  panel.append(ui.element)
  const refresh = async () => {
    try {
      const value = await (await host.post('/talk/state', {})).json() as { ok: boolean; talk?: TalkView }
      if (value.ok && value.talk !== undefined && !closed) {
        view = value.talk
        title.textContent = value.talk.name
        ui.show(value.talk)
      }
    } catch {
      // the brain is restarting
    }
  }
  const unlisten = guest?.listen?.(message => ui.live(message))
  guest?.bar?.(true)
  const poll = setInterval(() => void refresh(), 2000)

  // Settings: how often the scene changes, whether she stands there, how dim the scene is.
  const every = document.createElement('select')
  for (const minutes of EVERY) every.append(new Option(minutes === 0 ? '不换' : `每 ${minutes} 分钟`, String(minutes), false, minutes === prefs.every))
  every.onchange = () => {
    prefs.every = Number(every.value)
    savePrefs(prefs)
    restartRotation()
  }
  const herToggle = Object.assign(document.createElement('input'), { type: 'checkbox', checked: prefs.showHer })
  herToggle.onchange = () => {
    prefs.showHer = herToggle.checked
    savePrefs(prefs)
    showHer()
  }
  const dim = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '80', step: '5', value: String(prefs.dim) })
  dim.oninput = () => {
    prefs.dim = Number(dim.value)
    savePrefs(prefs)
    applyDim()
  }
  const row = (label: string, control: HTMLElement) => {
    const l = document.createElement('label')
    l.append(label, control)
    return l
  }
  const hint = document.createElement('p')
  hint.textContent = '场景来自她穿的形象和素材库的「桌面」；站着的她来自「宠物」。'
  menu.append(row('换场景', every), row('显示她', herToggle), row('场景暗一点', dim), hint)

  const fullscreen = button('⤢', '全屏', () => {
    if (document.fullscreenElement === null) void root.requestFullscreen?.().catch(() => {})
    else void document.exitFullscreen?.().catch(() => {})
  })
  if (!document.fullscreenEnabled) fullscreen.style.display = 'none'
  top.append(title, sceneName, button('‹', '上一个场景', () => { showScene(prefs.scene - 1); restartRotation() }), button('›', '下一个场景', () => { showScene(prefs.scene + 1); restartRotation() }),
    button('⚙', '设置', () => { menu.hidden = !menu.hidden }), fullscreen, button('×', '退出纯聊模式（Esc）', () => close()))
  root.append(sceneBox, veil, herBox, top, panel, menu)
  applyDim()
  document.body.append(root)
  ui.focus()

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !menu.hidden) {
      menu.hidden = true
      event.stopPropagation()
    }
  }
  root.addEventListener('keydown', onKey)
  root.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target as Node) && !(event.target as HTMLElement).classList.contains('her-cm-btn')) menu.hidden = true
  })

  void refresh()
  void host.post('/chat/scenes', {}).then(r => r.json()).then((value: { ok: boolean; name?: string; scenes?: ShowMedia[]; pet?: ShowMedia }) => {
    if (closed || !value.ok) return
    scenes = value.scenes ?? []
    pet = value.pet
    if (value.name !== undefined) title.textContent = value.name
    showScene(prefs.scene)
    restartRotation()
    showHer()
  }).catch(() => showScene(0))

  function close(): void {
    if (closed) return
    closed = true
    clearInterval(poll)
    clearInterval(rotate)
    unlisten?.()
    guest?.bar?.(false)
    guest?.hold(false)
    current?.stop()
    herMedia?.stop()
    if (document.fullscreenElement === root) void document.exitFullscreen?.().catch(() => {})
    root.remove()
    host.closed()
  }
  return close
}
