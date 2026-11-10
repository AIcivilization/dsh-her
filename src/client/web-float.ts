/**
 * The web body's floating window, in DSH's page (docs/网页身体设计.md §3): an
 * iframe with her in it, on every page of DSH, draggable. It asks the brain
 * whether to show (not while a desktop body is here, unless asked).
 *
 * Plain DOM rather than React: it lives outside DSH's tree, on `document.body`.
 *
 * Click-through works as in the desktop body: while the pointer is not on her
 * the iframe ignores the mouse and this window hands it each move, so the
 * renderer's own hit test (click mask, alpha) still decides when she takes it.
 *
 * As a background the scene goes behind DSH's page: DSH paints its surfaces from
 * theme variables, so emptying those lets her show through, with a light veil to
 * keep the text readable. Her window takes no mouse there, so a small button
 * gives the way to her.
 */

import { isRemotePage } from '../core/where.ts'
import { StackedView } from '../../body/renderer/stacked.ts'
import type { AvatarView } from '../dsh/api.ts'
import type { FloatHost } from './web-bridge.ts'
import { TalkBar } from '../../body/renderer/talk-bar.ts'
import type { SettingsPage, TalkView } from '../protocol/index.ts'

const STATUS_EVERY_MS = 5000
const POS_KEY = 'dsh-her.web.pos'
const HIDDEN_KEY = 'dsh-her.web.hidden'
const DEFAULT_POS = { right: 24, bottom: 24 }

type Pos = { right: number; bottom: number }
type Place = 'pet' | 'background'
type Scope = 'page' | 'chat'

const CHAT_COLUMN = '[class*="_centerCol"]'
const AVATAR_SIZE = 80
/** As far in from the chat box's right edge as other apps' mascots sit. */
const AVATAR_INSET = 42
const PLACE_EVERY_MS = 400
/** The talk bar reads her last lines this often while it is open. */
const BAR_EVERY_MS = 2000
/** How often the page says whether you are here, and when still means idle or away. */
const PRESENCE_EVERY_MS = 30_000
const IDLE_AFTER_MS = 2 * 60_000
const AWAY_AFTER_MS = 10 * 60_000

/** The chat box: the first rounded, painted card around the text being typed, whatever DSH calls it. */
function chatBox(): Element | undefined {
  const inSeat = document.querySelector('[class*="_composerSeat"] [contenteditable="true"], [class*="_composerSeat"] textarea')
  for (let at = inSeat?.parentElement; at !== null && at !== undefined; at = at.parentElement) {
    const style = getComputedStyle(at)
    if (parseFloat(style.borderTopLeftRadius) >= 12 && style.backgroundColor !== 'rgba(0, 0, 0, 0)') return at
  }
  return undefined
}

const backgroundStyle = (scope: Scope) => `
body { --her-base: var(--dsw-alias-bg-base); }
#root { position: relative; z-index: 1; --dsw-alias-bg-base: transparent; --dsh-boot-bg: transparent; }
${CHAT_COLUMN} { background: color-mix(in srgb, var(--her-base) 45%, transparent); }
${scope === 'chat' ? '' : `[class*="_sidebarCol"] { background: color-mix(in srgb, var(--her-base) 62%, transparent) !important; }
[class*="_sidebarCol"] > *, [class*="_sidebarCol"] > * > * { background: transparent !important; }`}`

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private window: not remembered
  }
}

export function mountWebFloat(): () => void {
  let frame: HTMLIFrameElement | undefined
  let pill: HTMLButtonElement | undefined
  let menu: HTMLDivElement | undefined
  let shield: HTMLDivElement | undefined
  let endDrag = () => {}
  let soundHint: HTMLButtonElement | undefined
  const clearSoundHint = () => {
    soundHint?.remove()
    soundHint = undefined
  }
  let takenOver = false
  let hidden = stored<boolean>(HIDDEN_KEY, false)
  let pos = stored<Pos>(POS_KEY, DEFAULT_POS)
  let size = { width: 300, height: 490 }
  let shown = false
  let wanted: Place = 'pet'
  let scope: Scope = 'page'
  let style: HTMLStyleElement | undefined
  let avatar: AvatarView | undefined
  let avatarVideo: HTMLVideoElement | undefined
  let pillTimer: ReturnType<typeof setInterval> | undefined
  let focus = false
  let lastInput = Date.now()
  const post = (path: string, body: unknown) => fetch(`/api/dsh-her${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  /** Whether you are here, for her speaking first: this tab showing, and how long since you last moved in it. */
  const reportPresence = () => {
    if (frame === undefined) return
    const still = Date.now() - lastInput
    const state = document.hidden || still >= AWAY_AFTER_MS ? 'away' : still >= IDLE_AFTER_MS ? 'idle' : 'active'
    void post('/web/send', { message: { t: 'presence', state, fullscreen: false, locked: false } }).catch(() => {})
  }
  const noteInput = () => {
    const wasStill = Date.now() - lastInput >= IDLE_AFTER_MS
    lastInput = Date.now()
    if (wasStill) reportPresence()
  }
  const background = () => wanted === 'background'
  const chatColumn = () => (scope === 'chat' ? document.querySelector(CHAT_COLUMN) ?? undefined : undefined)

  const guest = () => {
    try {
      return frame?.contentWindow?.__herGuest
    } catch {
      return undefined
    }
  }

  const place = () => {
    if (frame === undefined) return
    if (background()) {
      const box = chatColumn()?.getBoundingClientRect()
      Object.assign(frame.style, { left: `${box?.left ?? 0}px`, top: `${box?.top ?? 0}px`, right: '', bottom: '', width: box === undefined ? '100vw' : `${box.width}px`, height: box === undefined ? '100vh' : `${box.height}px` })
      return
    }
    frame.style.left = ''
    frame.style.top = ''
    // Always wholly on screen: a place saved on a wide screen must not lose her on a narrow one.
    pos = {
      right: Math.max(0, Math.min(pos.right, innerWidth - size.width)),
      bottom: Math.max(0, Math.min(pos.bottom, innerHeight - size.height)),
    }
    frame.style.right = `${pos.right}px`
    frame.style.bottom = `${pos.bottom}px`
    frame.style.width = `${size.width}px`
    frame.style.height = `${size.height}px`
  }

  const closeMenu = () => {
    menu?.remove()
    menu = undefined
  }

  /** Drag with a full-page shield, so a fast move cannot leave the iframe and lose the mouse. */
  const startDrag = () => {
    if (shield !== undefined) return
    shield = document.createElement('div')
    shield.style.cssText = 'position:fixed;inset:0;z-index:1001;cursor:grabbing'
    const move = (event: MouseEvent) => {
      // The button went up somewhere nobody heard (outside the page, say).
      if (event.buttons === 0) return endDrag()
      pos = { right: pos.right - event.movementX, bottom: pos.bottom - event.movementY }
      place()
    }
    const up = () => endDrag()
    endDrag = () => {
      shield?.remove()
      shield = undefined
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mouseup', up, true)
      endDrag = () => {}
      store(POS_KEY, pos)
      // The renderer never saw the button go up.
      frame?.contentWindow?.dispatchEvent(new MouseEvent('mouseup'))
    }
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mouseup', up, true)
    document.body.appendChild(shield)
  }

  let menuFromPill = false
  const hostApi: FloatHost = {
    frame: next => {
      size = next
      place()
    },
    hit: onHer => {
      if (frame !== undefined && shield === undefined && !background()) frame.style.pointerEvents = onHer ? 'auto' : 'none'
    },
    // Moves the shield misses (the first, before it is up) still count.
    drag: (dx, dy) => {
      if (background()) return
      if (shield === undefined) startDrag()
      pos = { right: pos.right - dx, bottom: pos.bottom - dy }
      place()
    },
    dragEnd: () => endDrag(),
    menu: () => {
      if (frame === undefined) return
      closeMenu()
      const box = frame.getBoundingClientRect()
      menu = document.createElement('div')
      const from = menuFromPill ? pill?.getBoundingClientRect() : undefined
      menuFromPill = false
      const at = from !== undefined ? `right:${Math.max(8, innerWidth - from.right)}px;bottom:${Math.max(8, innerHeight - from.top + 6)}px` : `left:${Math.max(8, box.left)}px;top:${Math.max(8, box.top + 40)}px`
      menu.style.cssText = `position:fixed;z-index:1002;${at};min-width:170px;padding:4px;border-radius:10px;font:13px system-ui,sans-serif;background:Canvas;color:CanvasText;border:1px solid rgba(127,127,127,.35);box-shadow:0 8px 28px rgba(0,0,0,.28)`
      const item = (label: string, action: () => void, disabled = false) => {
        const button = document.createElement('button')
        button.textContent = label
        button.disabled = disabled
        button.style.cssText = `display:block;width:100%;padding:7px 10px;border:none;background:none;color:inherit;font:inherit;text-align:left;border-radius:6px;cursor:${disabled ? 'default' : 'pointer'};opacity:${disabled ? 0.5 : 1}`
        button.onclick = () => {
          closeMenu()
          action()
        }
        menu!.appendChild(button)
      }
      item(window.isSecureContext ? '和她说话（Ctrl+Alt+空格）' : '和她说话（要 HTTPS 才能用麦克风）', () => guest()?.talk(), !window.isSecureContext)
      item('打字给她', () => openTyping())
      item(focus ? '结束专注（她可以主动说话了）' : '专注一会儿（2 小时不主动说话）', () => {
        focus = !focus
        void post('/web/send', { message: { t: 'focus.set', on: focus } }).catch(() => {})
      })
      item(background() ? '暂时关掉背景' : '藏起来', () => hostApi.setHidden(true))
      document.body.appendChild(menu)
      // Pressing outside closes it; a press on an item must live to become its click.
      const outside = (event: MouseEvent) => {
        if (menu?.contains(event.target as Node) === true) return
        window.removeEventListener('mousedown', outside)
        closeMenu()
      }
      setTimeout(() => window.addEventListener('mousedown', outside), 0)
    },
    interactive: on => {
      if (frame === undefined || background()) return
      frame.style.pointerEvents = on ? 'auto' : 'none'
      if (on) frame.focus()
    },
    needsGesture: () => {
      if (soundHint !== undefined || frame === undefined) return
      const box = frame.getBoundingClientRect()
      soundHint = document.createElement('button')
      soundHint.textContent = '🔊 点一下开声音'
      soundHint.style.cssText = `position:fixed;z-index:1001;left:${Math.max(8, box.left + box.width / 2 - 70)}px;top:${Math.max(8, box.bottom - 44)}px;width:140px;padding:6px 0;border:none;border-radius:999px;cursor:pointer;color:#fff;font:600 12px system-ui,sans-serif;background:#8b5cf6;box-shadow:0 4px 14px rgba(0,0,0,.3)`
      // The page's own gesture listener lets her sound start; this only has to be clicked.
      soundHint.onclick = clearSoundHint
      document.body.appendChild(soundHint)
    },
    replaced: () => {
      takenOver = true
      void sync()
    },
    hidden: () => hidden,
    setHidden: next => {
      hidden = next
      if (!next) takenOver = false
      store(HIDDEN_KEY, next)
      void sync()
    },
    refresh: () => void sync(),
    openBar: () => openTyping(),
  }

  /**
   * The talk bar (docs/对话入口设计.md), over the page: above her small picture
   * when it is there, else at the bottom. It sends through the brain directly,
   * so it works whether or not her window is on this page; holding to talk
   * needs her window (the microphone is in it).
   */
  let bar: { element: HTMLElement; view?: TalkView; timer: ReturnType<typeof setInterval>; outside: (event: MouseEvent) => void } | undefined
  const closeBar = () => {
    if (bar === undefined) return
    if (frame !== undefined) guest()?.hold(false)
    clearInterval(bar.timer)
    window.removeEventListener('mousedown', bar.outside, true)
    bar.element.remove()
    bar = undefined
  }
  const openTyping = () => {
    if (bar !== undefined) return (bar.element.querySelector('input') as HTMLInputElement | null)?.focus()
    const holder = document.createElement('div')
    const ui: TalkBar = new TalkBar({
      say: async text => (await post('/web/send', { message: { t: 'user.text', text } }).then(r => r.ok, () => false)),
      newConversation: () => void post('/talk/new', {}).then(refreshBar),
      resume: id => void post('/talk/resume', { id }).then(refreshBar),
      openFull: () => {
        const id = bar?.view?.segment?.id
        if (id !== undefined && window.__herOpenSession !== undefined) {
          window.__herOpenSession(id)
          closeBar()
        } else ui.showNote('在左侧的"她"工作区里点开这段对话')
      },
      ...(frame === undefined ? {} : { hold: (on: boolean) => guest()?.hold(on) }),
      close: closeBar,
      more: () => {
        if (frame === undefined) return hostApi.setHidden(false)
        menuFromPill = true
        hostApi.menu()
      },
    })
    holder.append(ui.element)
    const anchor = pill?.getBoundingClientRect()
    const width = Math.min(440, innerWidth - 24)
    const at = anchor !== undefined && anchor.width > 0
      ? `right:${Math.max(12, innerWidth - anchor.right)}px;bottom:${Math.max(12, innerHeight - anchor.top + 8)}px`
      : `left:${Math.round((innerWidth - width) / 2)}px;bottom:24px`
    holder.style.cssText = `position:fixed;z-index:1003;width:${width}px;${at}`
    document.body.appendChild(holder)
    const refreshBar = async () => {
      try {
        const value = await (await post('/talk/state', {})).json() as { ok: boolean; talk?: TalkView }
        if (value.ok && value.talk !== undefined && bar !== undefined) {
          bar.view = value.talk
          ui.show(value.talk)
        }
      } catch {
        // the brain is restarting
      }
    }
    // A press outside puts it away, unless something is typed or held.
    const outside = (event: MouseEvent) => {
      if (holder.contains(event.target as Node) || menu?.contains(event.target as Node) === true || pill?.contains(event.target as Node) === true) return
      if (ui.idle) closeBar()
    }
    window.addEventListener('mousedown', outside, true)
    bar = { element: holder, timer: setInterval(() => void refreshBar(), BAR_EVERY_MS), outside }
    void refreshBar()
    ui.focus()
  }

  /** Follow the chat column when DSH's layout moves it (the sidebar folded, say). */
  const column = new ResizeObserver(() => place())

  /** Hand each move over her rectangle to the renderer's hit test, while the iframe ignores the mouse. */
  const forwardMove = (event: MouseEvent) => {
    if (frame === undefined || frame.style.pointerEvents !== 'none' || background()) return
    const box = frame.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return
    frame.contentWindow?.dispatchEvent(new MouseEvent('mousemove', { clientX: event.clientX - box.left, clientY: event.clientY - box.top, screenX: event.screenX, screenY: event.screenY }))
  }

  const onKey = (event: KeyboardEvent) => {
    noteInput()
    guest()?.unlockAudio()
    if (event.ctrlKey && event.altKey && event.code === 'Space' && window.isSecureContext) {
      event.preventDefault()
      guest()?.talk()
    }
  }
  const onGesture = (event: PointerEvent) => {
    noteInput()
    guest()?.unlockAudio()
    clearSoundHint()
    // A finger has no hover to hand the iframe the mouse first, so she hears of it from out here.
    if (event.pointerType !== 'touch' || frame === undefined || background() || frame.style.pointerEvents !== 'none') return
    const box = frame.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return
    guest()?.tap(event.clientX - box.left, event.clientY - box.top)
  }

  const showFrame = () => {
    if (frame !== undefined) return arrange()
    frame = document.createElement('iframe')
    frame.title = '她'
    frame.src = '/api/dsh-her/web/page'
    frame.allow = 'autoplay; microphone'
    frame.setAttribute('allowtransparency', 'true')
    frame.style.cssText = 'position:fixed;z-index:1000;border:none;background:transparent;color-scheme:normal;pointer-events:none'
    arrange()
    document.body.appendChild(frame)
  }

  /** Put her in front of the page or behind it, as chosen. */
  const arrange = () => {
    if (frame === undefined) return
    frame.style.zIndex = background() ? '0' : '1000'
    if (background()) frame.style.pointerEvents = 'none'
    const css = background() ? backgroundStyle(scope) : undefined
    if (css === undefined) {
      style?.remove()
      style = undefined
    } else {
      style ??= document.head.appendChild(document.createElement('style'))
      style.textContent = css
    }
    column.disconnect()
    const seen = chatColumn()
    if (background() && seen !== undefined) column.observe(seen)
    place()
  }

  const showPill = (on: boolean) => {
    if (!on) {
      pill?.remove()
      pill = undefined
      clearInterval(pillTimer)
      return
    }
    if (pill === undefined) {
      pill = document.createElement('button')
      // The way to her: the talk bar (as a background she takes no clicks herself). When she is away, this brings her back too.
      pill.onclick = () => {
        if (frame === undefined && hidden) hostApi.setHidden(false)
        if (bar === undefined) openTyping()
        else closeBar()
      }
      document.body.appendChild(pill)
      pillTimer = setInterval(placePill, PLACE_EVERY_MS)
    }
    drawPill()
    placePill()
  }

  /** Her small picture when she has one, else a round button with her name. */
  const drawPill = () => {
    if (pill === undefined) return
    const url = avatar?.clipUrl ?? avatar?.url ?? ''
    if (pill.dataset.url === url) return
    pill.dataset.url = url
    pill.textContent = ''
    avatarVideo = undefined
    pill.title = '她'
    pill.style.cssText = avatar === undefined
      ? 'position:fixed;z-index:1000;width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;color:#fff;font:600 14px system-ui,sans-serif;background:#8b5cf6;box-shadow:0 4px 14px rgba(0,0,0,.25)'
      : `position:fixed;z-index:1000;width:${AVATAR_SIZE}px;height:${AVATAR_SIZE}px;padding:0;border:none;cursor:pointer;background:none`
    if (avatar === undefined) {
      pill.textContent = '她'
      return
    }
    const image = document.createElement('img')
    image.src = avatar.url
    image.alt = '她'
    image.draggable = false
    image.style.cssText = 'display:block;width:100%;height:100%'
    pill.appendChild(image)
    if (avatar.clipUrl !== undefined) playAvatar(avatar.clipUrl, image)
  }

  /** Her picture moving: it takes the picture's place once it plays, so a clip that cannot play leaves the picture. */
  const playAvatar = (url: string, image: HTMLImageElement) => {
    const video = document.createElement('video')
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.preload = 'auto'
    video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none'
    let view: StackedView
    try {
      video.src = new URL(url, document.baseURI).href
      view = new StackedView(video)
    } catch {
      return
    }
    view.canvas.style.cssText = 'display:none;width:100%;height:100%'
    pill?.append(video, view.canvas)
    video.addEventListener('playing', () => {
      image.style.display = 'none'
      view.canvas.style.display = 'block'
    }, { once: true })
    avatarVideo = video
    if (!document.hidden) void video.play().catch(() => {})
  }

  /** Not seen, no need to decode. */
  const onVisibility = () => {
    if (document.hidden) avatarVideo?.pause()
    else void avatarVideo?.play().catch(() => {})
    void sync()
    reportPresence()
  }

  /** On the chat box's top edge, as if it were a table; with no chat box on the page, on the window's bottom edge. */
  const placePill = () => {
    if (pill === undefined) return
    const box = chatBox()?.getBoundingClientRect()
    const size = avatar === undefined ? 34 : AVATAR_SIZE
    const hang = avatar === undefined ? (box === undefined ? -96 : -6) : avatar.overhang * AVATAR_SIZE
    pill.style.right = `${box === undefined ? 18 : Math.max(0, innerWidth - box.right + AVATAR_INSET)}px`
    pill.style.top = `${(box?.top ?? innerHeight) - size + hang}px`
    // Without a chat box it would stand in her way when she floats in the same corner.
    pill.style.display = box === undefined && frame !== undefined && !background() ? 'none' : ''
  }

  const apply = () => {
    const visible = shown && !hidden && !takenOver
    if (visible) showFrame()
    else {
      frame?.remove()
      frame = undefined
      closeMenu()
      column.disconnect()
      style?.remove()
      style = undefined
    }
    showPill(shown)
    window.dispatchEvent(new Event('dsh-her:float'))
  }

  const sync = async () => {
    if (document.hidden) return
    try {
      const res = await fetch('/api/dsh-her/web/status', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ screen: { w: screen.width, h: screen.height, scale: devicePixelRatio }, remote: isRemotePage(location.protocol, location.hostname) }) })
      const value = await res.json() as { ok: boolean; show?: boolean; place?: Place; scope?: Scope; avatar?: AvatarView; focus?: boolean; open?: string; page?: SettingsPage }
      if (value.ok) {
        focus = value.focus === true
        // "完整对话" from the desktop's talk bar: this page opens her conversation.
        if (value.open !== undefined) window.__herOpenSession?.(value.open)
        // "设置…" from the desktop's menu: this page shows her settings.
        if (value.page !== undefined) window.__herOpenPage?.(value.page)
        shown = value.show === true
        avatar = value.avatar
        wanted = value.place === 'background' ? 'background' : 'pet'
        scope = value.scope === 'chat' ? 'chat' : 'page'
      }
    } catch {
      // The brain is restarting: keep what is on screen.
    }
    apply()
  }

  window.__herFloat = hostApi
  window.addEventListener('mousemove', forwardMove, { passive: true })
  window.addEventListener('mousemove', noteInput, { passive: true })
  window.addEventListener('wheel', noteInput, { passive: true })
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onGesture, { passive: true })
  window.addEventListener('resize', place)
  document.addEventListener('visibilitychange', onVisibility)
  const timer = setInterval(() => void sync(), STATUS_EVERY_MS)
  const presenceTimer = setInterval(reportPresence, PRESENCE_EVERY_MS)
  void sync()

  return () => {
    clearInterval(timer)
    clearInterval(presenceTimer)
    clearInterval(pillTimer)
    window.removeEventListener('mousemove', noteInput)
    window.removeEventListener('wheel', noteInput)
    column.disconnect()
    style?.remove()
    closeBar()
    window.removeEventListener('mousemove', forwardMove)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('pointerdown', onGesture)
    window.removeEventListener('resize', place)
    document.removeEventListener('visibilitychange', onVisibility)
    avatarVideo?.pause()
    frame?.remove()
    pill?.remove()
    closeMenu()
    shield?.remove()
    clearSoundHint()
    delete window.__herFloat
  }
}
