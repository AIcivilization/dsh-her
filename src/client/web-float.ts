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
import type { FloatHost } from './web-bridge.ts'

const STATUS_EVERY_MS = 5000
const POS_KEY = 'dsh-her.web.pos'
const HIDDEN_KEY = 'dsh-her.web.hidden'
const DEFAULT_POS = { right: 24, bottom: 24 }

type Pos = { right: number; bottom: number }
type Place = 'pet' | 'background'
type Scope = 'page' | 'chat'

const CHAT_COLUMN = '[class*="_centerCol"]'

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
  let typing: HTMLFormElement | undefined
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
      const at = background() ? `right:18px;bottom:136px` : `left:${Math.max(8, box.left)}px;top:${Math.max(8, box.top + 40)}px`
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
      item('打字给她', () => (background() ? openTyping() : guest()?.showInput()))
      item(background() ? '暂时关掉背景' : '藏起来', () => hostApi.setHidden(true))
      document.body.appendChild(menu)
      setTimeout(() => window.addEventListener('mousedown', closeMenu, { once: true }), 0)
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
  }

  /** Typing to her as a background: her window is behind the page, so the box is out here. */
  const openTyping = () => {
    if (typing !== undefined) return typing.querySelector('input')?.focus()
    const form = document.createElement('form')
    form.style.cssText = 'position:fixed;z-index:1002;left:50%;bottom:28px;width:min(90vw,460px);transform:translateX(-50%)'
    const input = document.createElement('input')
    input.placeholder = '想和她说点什么…（回车发送，Esc 关闭）'
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:11px 14px;border-radius:12px;border:1px solid #b69cff;background:rgba(28,26,34,.96);color:#fff;font:14px system-ui,sans-serif;outline:none'
    const close = () => {
      form.remove()
      typing = undefined
    }
    form.onsubmit = event => {
      event.preventDefault()
      const text = input.value.trim()
      close()
      if (text !== '') void guest()?.say(text)
    }
    input.onkeydown = event => {
      if (event.key === 'Escape') close()
    }
    form.appendChild(input)
    document.body.appendChild(form)
    typing = form
    input.focus()
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
    guest()?.unlockAudio()
    if (event.ctrlKey && event.altKey && event.code === 'Space' && window.isSecureContext) {
      event.preventDefault()
      guest()?.talk()
    }
  }
  const onGesture = () => {
    guest()?.unlockAudio()
    clearSoundHint()
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
      return
    }
    if (pill !== undefined) return
    pill = document.createElement('button')
    pill.textContent = '她'
    pill.title = '让她出来'
    pill.style.cssText = 'position:fixed;z-index:1000;right:18px;bottom:96px;width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;color:#fff;font:600 14px system-ui,sans-serif;background:#8b5cf6;box-shadow:0 4px 14px rgba(0,0,0,.25)'
    pill.onclick = () => {
      // As a background she takes no clicks: this is the way to her. Otherwise she is away, and this brings her back.
      if (frame !== undefined && background()) hostApi.menu()
      else hostApi.setHidden(false)
    }
    document.body.appendChild(pill)
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
    showPill(shown && (!visible || background()))
    window.dispatchEvent(new Event('dsh-her:float'))
  }

  const sync = async () => {
    if (document.hidden) return
    try {
      const res = await fetch('/api/dsh-her/web/status', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ screen: { w: screen.width, h: screen.height, scale: devicePixelRatio }, remote: isRemotePage(location.protocol, location.hostname) }) })
      const value = await res.json() as { ok: boolean; show?: boolean; place?: Place; scope?: Scope }
      if (value.ok) {
        shown = value.show === true
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
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onGesture, { passive: true })
  window.addEventListener('resize', place)
  document.addEventListener('visibilitychange', sync)
  const timer = setInterval(() => void sync(), STATUS_EVERY_MS)
  void sync()

  return () => {
    clearInterval(timer)
    column.disconnect()
    style?.remove()
    typing?.remove()
    window.removeEventListener('mousemove', forwardMove)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('pointerdown', onGesture)
    window.removeEventListener('resize', place)
    document.removeEventListener('visibilitychange', sync)
    frame?.remove()
    pill?.remove()
    closeMenu()
    shield?.remove()
    clearSoundHint()
    delete window.__herFloat
  }
}
