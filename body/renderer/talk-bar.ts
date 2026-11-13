/**
 * The talk bar (docs/对话入口设计.md): the last few lines, a box to type in, a
 * button to hold while you talk, and the way to the whole conversation in dsh.
 * Plain DOM, used by the desktop body's bar window and by the web page alike;
 * the host says what each button does.
 *
 * Holding to talk: the 🎙 button with the mouse (or a finger), or the right
 * Option / Alt key while the bar has the keyboard. Released, what you said goes.
 */

import type { BrainMessage, TalkView } from '../../src/protocol/index.ts'

export interface BarHost {
  say(text: string): Promise<boolean>
  newConversation(): void
  resume(id: string): void
  /** The whole conversation in dsh. */
  openFull(): void
  /** Hold to talk: true when pressed, false when released. Undefined: no microphone here. */
  hold?: (on: boolean) => void
  close(): void
  /** More choices (the web page's menu); not shown when undefined. */
  more?: () => void
}

/** The key you hold to talk while the bar has the keyboard. */
export const HOLD_KEY = 'AltRight'

const STYLE = `
.her-bar { --bar-bg: var(--her-bar-bg, rgba(24, 26, 38, 0.94)); --bar-text: var(--her-bar-text, #f2f3f8); --bar-accent: var(--her-bar-accent, #7fb2ff);
  box-sizing: border-box; width: 100%; padding: 12px 12px 10px; border-radius: 18px; background: var(--bar-bg); color: var(--bar-text);
  font: 14px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.38), 0 0 0 1px color-mix(in srgb, var(--bar-accent) 38%, transparent); backdrop-filter: blur(18px) saturate(1.3); -webkit-backdrop-filter: blur(18px) saturate(1.3); }
.her-bar * { box-sizing: border-box; }
.her-bar-lines { display: flex; flex-direction: column; gap: 6px; max-height: 190px; overflow: hidden; justify-content: flex-end; margin-bottom: 10px; }
.her-bar-lines:empty { display: none; }
.her-bar-line { align-self: flex-start; max-width: 88%; padding: 6px 11px; border-radius: 14px 14px 14px 4px; font-size: 13.5px; line-height: 1.5;
  background: color-mix(in srgb, var(--bar-accent) 18%, transparent); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.her-bar-line b { display: none; }
.her-bar-line.you { align-self: flex-end; border-radius: 14px 14px 4px 14px; background: color-mix(in srgb, var(--bar-text) 12%, transparent); }
.her-bar-line.live { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bar-accent) 45%, transparent); }
.her-bar-line.heard { opacity: 0.75; font-style: italic; }
.her-bar-dots { align-self: flex-start; display: inline-flex; gap: 4px; padding: 10px 12px; border-radius: 14px 14px 14px 4px; background: color-mix(in srgb, var(--bar-accent) 18%, transparent); }
.her-bar-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--bar-accent); animation: her-bar-dot 1.1s ease-in-out infinite; }
.her-bar-dots i:nth-child(2) { animation-delay: 0.15s; }
.her-bar-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes her-bar-dot { 0%, 60%, 100% { opacity: 0.3; transform: none; } 30% { opacity: 1; transform: translateY(-3px); } }
.her-bar-row { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 6px; border-radius: 999px; background: color-mix(in srgb, var(--bar-text) 8%, transparent); border: 1px solid color-mix(in srgb, var(--bar-text) 14%, transparent); transition: border-color 0.12s, box-shadow 0.12s; }
.her-bar-row:focus-within { border-color: var(--bar-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--bar-accent) 22%, transparent); }
.her-bar-input { flex: 1; min-width: 0; padding: 7px 6px; border: none; background: none; color: inherit; font: inherit; outline: none; }
.her-bar-input::placeholder { color: color-mix(in srgb, var(--bar-text) 45%, transparent); }
.her-bar-mic, .her-bar-send { flex: none; width: 34px; height: 34px; border-radius: 50%; border: none; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--bar-text); background: color-mix(in srgb, var(--bar-text) 12%, transparent); transition: background 0.12s, transform 0.12s; touch-action: none; user-select: none; -webkit-user-select: none; }
.her-bar-mic:hover, .her-bar-send:hover { background: color-mix(in srgb, var(--bar-text) 20%, transparent); }
.her-bar-mic svg, .her-bar-send svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.her-bar-mic.on { background: #e5484d; color: #fff; transform: scale(1.08); box-shadow: 0 0 0 5px rgba(229, 72, 77, 0.28); }
.her-bar-send { background: var(--bar-accent); color: #10131c; }
.her-bar-send:hover { background: var(--bar-accent); filter: brightness(1.1); }
.her-bar-send:disabled { opacity: 0.35; cursor: default; filter: none; }
.her-bar-foot { display: flex; align-items: center; gap: 4px; margin-top: 8px; padding: 0 4px; font-size: 12px; color: color-mix(in srgb, var(--bar-text) 55%, transparent); }
.her-bar-foot .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.her-bar-link { border: none; background: none; color: color-mix(in srgb, var(--bar-accent) 85%, var(--bar-text)); font: inherit; cursor: pointer; padding: 2px 6px; border-radius: 6px; white-space: nowrap; }
.her-bar-link:hover { background: color-mix(in srgb, var(--bar-accent) 16%, transparent); }
.her-bar-select { max-width: 140px; border: none; border-radius: 6px; background: color-mix(in srgb, var(--bar-text) 8%, transparent); color: inherit; font: inherit; padding: 2px 4px; }
.her-bar-note { margin: 6px 4px 0; font-size: 12px; color: #ffb4b4; }
.her-bar-note:empty { display: none; }
`

const MIC_ICON = '<svg viewBox="0 0 20 20"><rect x="7.5" y="3" width="5" height="9" rx="2.5"/><path d="M5 10a5 5 0 0 0 10 0M10 15v2.5"/></svg>'
const SEND_ICON = '<svg viewBox="0 0 20 20"><path d="M10 16V4.5M5 9l5-5 5 5"/></svg>'
/** A line not in the conversation as read back yet: what you just said, what she is saying. */
interface PendingLine {
  who: 'you' | 'her'
  text: string
  at: number
  uid?: string
  heard?: boolean
}

export class TalkBar {
  readonly element: HTMLDivElement
  private readonly lines: HTMLDivElement
  private readonly input: HTMLInputElement
  private readonly mic: HTMLButtonElement | undefined
  private readonly where: HTMLSpanElement
  private readonly earlier: HTMLSelectElement
  private readonly note: HTMLDivElement
  private readonly host: BarHost
  private readonly sendButton: HTMLButtonElement
  private holding = false
  private view: TalkView | undefined
  /** Said or heard since the conversation was last read back. */
  private pending: PendingLine[] = []
  private thinking = false
  /** How many lines it shows: a few in the small bar, many in 纯聊模式. */
  private readonly keep: number

  constructor(host: BarHost, doc: Document = document, options: { lines?: number } = {}) {
    this.host = host
    this.keep = options.lines ?? 4
    if (doc.getElementById('her-bar-style') === null) {
      const style = doc.createElement('style')
      style.id = 'her-bar-style'
      style.textContent = STYLE
      doc.head.append(style)
    }
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
      const el = doc.createElement(tag)
      el.className = className
      if (text !== undefined) el.textContent = text
      return el
    }
    this.element = make('div', 'her-bar')
    this.lines = make('div', 'her-bar-lines')
    const row = make('div', 'her-bar-row')
    this.input = make('input', 'her-bar-input')
    this.input.placeholder = host.hold === undefined ? '想和她说点什么…' : '打字，或按住话筒说'
    this.input.autocomplete = 'off'
    if (host.hold !== undefined) {
      this.mic = make('button', 'her-bar-mic')
      this.mic.innerHTML = MIC_ICON
      this.mic.title = '按住说话，松开发出去'
      this.mic.setAttribute('aria-label', '按住说话')
      this.mic.type = 'button'
      this.mic.addEventListener('pointerdown', event => {
        event.preventDefault()
        this.mic?.setPointerCapture(event.pointerId)
        this.setHolding(true)
      })
      for (const end of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.mic.addEventListener(end, () => this.setHolding(false))
    }
    this.sendButton = make('button', 'her-bar-send')
    this.sendButton.innerHTML = SEND_ICON
    this.sendButton.type = 'button'
    this.sendButton.title = '发出去（回车）'
    this.sendButton.setAttribute('aria-label', '发出去')
    this.sendButton.disabled = true
    this.sendButton.addEventListener('click', () => void this.send())
    this.input.addEventListener('input', () => { this.sendButton.disabled = this.input.value.trim() === '' })
    row.append(this.input)
    if (this.mic !== undefined) row.append(this.mic)
    row.append(this.sendButton)
    const foot = make('div', 'her-bar-foot')
    this.where = make('span', 'grow')
    this.earlier = make('select', 'her-bar-select')
    this.earlier.title = '接着之前的一段说'
    this.earlier.addEventListener('change', () => {
      if (this.earlier.value !== '') host.resume(this.earlier.value)
      this.earlier.value = ''
    })
    const fresh = make('button', 'her-bar-link', '新开一段')
    fresh.type = 'button'
    fresh.addEventListener('click', () => host.newConversation())
    const full = make('button', 'her-bar-link', '完整对话 ↗')
    full.type = 'button'
    full.addEventListener('click', () => host.openFull())
    foot.append(this.where, this.earlier, fresh, full)
    if (host.more !== undefined) {
      const more = make('button', 'her-bar-link', '⋯')
      more.type = 'button'
      more.title = '更多'
      more.addEventListener('click', () => host.more?.())
      foot.append(more)
    }
    this.note = make('div', 'her-bar-note')
    this.element.append(this.lines, row, foot, this.note)

    this.input.addEventListener('keydown', event => {
      if (event.key === 'Escape') host.close()
      if (event.key === 'Enter' && !event.isComposing) void this.send()
    })
    // Holding the key works anywhere in the bar; letting go anywhere ends it.
    this.element.addEventListener('keydown', event => {
      if (event.code === HOLD_KEY && !event.repeat && host.hold !== undefined) {
        event.preventDefault()
        this.setHolding(true)
      }
    })
    this.element.addEventListener('keyup', event => {
      if (event.code === HOLD_KEY) this.setHolding(false)
    })
    doc.defaultView?.addEventListener('blur', () => this.setHolding(false))
  }

  private setHolding(on: boolean): void {
    if (on === this.holding || this.host.hold === undefined) return
    this.holding = on
    this.mic?.classList.toggle('on', on)
    this.host.hold(on)
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim()
    if (text === '') return
    this.input.value = ''
    this.sendButton.disabled = true
    this.note.textContent = ''
    // What you said shows at once; her answer follows here, not over her head.
    const mine: PendingLine = { who: 'you', text, at: Date.now() }
    this.pending.push(mine)
    this.thinking = true
    this.draw()
    if (!await this.host.say(text)) {
      this.pending = this.pending.filter(line => line !== mine)
      this.thinking = false
      this.draw()
      this.input.value = text
      this.sendButton.disabled = false
      this.note.textContent = '她现在连不上 dsh，等一下再试'
    }
  }

  /**
   * What the brain says as it happens, so the bar is the conversation while
   * it is open: what it heard you say, her thinking, her answer sentence by
   * sentence. The conversation read back (`talk`) then takes their place.
   */
  live(message: BrainMessage): void {
    switch (message.t) {
      case 'talk':
        this.show(message)
        return
      case 'state':
        if (message.state === 'think') this.thinking = true
        else if (message.state === 'idle') this.thinking = false
        break
      case 'heard':
        if (message.text === '') return
        this.pending.push({ who: 'you', text: message.text, at: Date.now(), heard: true })
        this.thinking = true
        break
      case 'speak.begin':
        this.pending.push({ who: 'her', text: '', at: Date.now(), uid: message.uid })
        break
      case 'speak.seg': {
        const line = this.pending.find(l => l.uid === message.uid)
        if (line === undefined || message.text === '') return
        line.text += message.text
        this.thinking = false
        break
      }
      case 'speak.cancel': {
        const line = this.pending.find(l => l.uid === message.uid)
        if (line === undefined) return
        line.text = line.text === '' ? '' : `${line.text}——`
        this.thinking = false
        break
      }
      case 'speak.end':
        this.thinking = false
        break
      default:
        return
    }
    this.draw()
  }

  /** Pending lines the conversation as read back does not have yet (her answer may be read back before she has finished saying it). */
  private fresh(): PendingLine[] {
    const said = (text: string) => text.replace(/[\s—]+/g, '')
    const recent = (this.view?.lines ?? []).slice(-6).map(line => ({ who: line.who, text: said(line.text) }))
    return this.pending.filter(line => line.text === '' || !recent.some(r => r.who === line.who && (r.text.includes(said(line.text)) || said(line.text).includes(r.text))))
  }

  private draw(): void {
    const doc = this.element.ownerDocument
    const name = this.view?.name ?? '她'
    const all: Array<{ who: 'you' | 'her'; text: string; live?: boolean; heard?: boolean }> = [
      ...(this.view?.lines ?? []),
      ...this.fresh().filter(line => line.text !== '').map(line => ({ who: line.who, text: line.text, live: true, ...(line.heard === true ? { heard: true } : {}) })),
    ]
    const nodes: HTMLElement[] = all.slice(-this.keep).map(line => {
      const el = doc.createElement('div')
      el.className = `her-bar-line ${line.who}${line.live === true && line.who === 'her' ? ' live' : ''}${line.heard === true ? ' heard' : ''}`
      const who = doc.createElement('b')
      who.textContent = line.who === 'you' ? '你' : name
      el.append(who, line.text)
      el.title = line.text
      el.setAttribute('aria-label', `${line.who === 'you' ? '你' : name}：${line.text}`)
      return el
    })
    // Dots while she has not answered what was last said (an answer already read back needs none).
    if (this.thinking && all.at(-1)?.who !== 'her') {
      const dots = doc.createElement('div')
      dots.className = 'her-bar-dots'
      dots.setAttribute('aria-label', `${name}在想`)
      dots.append(doc.createElement('i'), doc.createElement('i'), doc.createElement('i'))
      nodes.push(dots)
    }
    this.lines.replaceChildren(...nodes)
    // The newest line in sight (纯聊模式 scrolls).
    this.lines.scrollTop = this.lines.scrollHeight
  }

  /** Nothing typed and nothing held: clicking elsewhere may close it. */
  get idle(): boolean {
    return !this.holding && this.input.value.trim() === ''
  }

  focus(): void {
    this.input.focus()
  }

  show(view: TalkView): void {
    this.view = view
    // What was pending and is in the conversation now is shown from there (see `fresh`); old leftovers go.
    this.pending = this.pending.filter(line => Date.now() - line.at < 90_000)
    this.draw()
    this.where.textContent = `${view.segment?.title ?? '还没有对话'}${view.size === undefined ? '' : ` · ${view.size}`}`
    const doc = this.element.ownerDocument
    const placeholder = doc.createElement('option')
    placeholder.value = ''
    placeholder.textContent = '接着之前那段…'
    const others = view.segments.filter(s => s.id !== view.segment?.id).map(s => {
      const option = doc.createElement('option')
      option.value = s.id
      option.textContent = s.title
      return option
    })
    this.earlier.replaceChildren(placeholder, ...others)
    this.earlier.style.display = others.length === 0 ? 'none' : ''
  }

  showNote(text: string): void {
    this.note.textContent = text
  }
}
