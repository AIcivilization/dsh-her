/**
 * The talk bar (docs/对话入口设计.md): the last few lines, a box to type in, a
 * button to hold while you talk, and the way to the whole conversation in dsh.
 * Plain DOM, used by the desktop body's bar window and by the web page alike;
 * the host says what each button does.
 *
 * Holding to talk: the 🎙 button with the mouse (or a finger), or the right
 * Option / Alt key while the bar has the keyboard. Released, what you said goes.
 */

import type { TalkView } from '../../src/protocol/index.ts'

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
.her-bar { box-sizing: border-box; width: 100%; padding: 10px 12px 12px; border-radius: 14px; background: rgba(28, 26, 34, 0.96); color: #f4f0fa;
  font: 14px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif; box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35); border: 1px solid rgba(182, 156, 255, 0.45); }
.her-bar * { box-sizing: border-box; }
.her-bar-lines { display: flex; flex-direction: column; gap: 4px; max-height: 132px; overflow: hidden; margin-bottom: 8px; }
.her-bar-lines:empty { display: none; }
.her-bar-line { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; color: #d9d2ea; }
.her-bar-line b { color: #b69cff; font-weight: 600; margin-right: 4px; }
.her-bar-line.you b { color: #8fd3c4; }
.her-bar-row { display: flex; align-items: center; gap: 8px; }
.her-bar-input { flex: 1; min-width: 0; padding: 9px 12px; border-radius: 10px; border: 1px solid #5d4f86; background: #16141b; color: #fff; font: inherit; outline: none; }
.her-bar-input:focus { border-color: #b69cff; }
.her-bar-mic { flex: none; width: 38px; height: 38px; border-radius: 50%; border: none; background: #3a3150; color: #fff; font-size: 17px; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }
.her-bar-mic.on { background: #e5484d; box-shadow: 0 0 0 4px rgba(229, 72, 77, 0.3); }
.her-bar-foot { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; color: #a69bbd; }
.her-bar-foot .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.her-bar-link { border: none; background: none; color: #c9b8ff; font: inherit; cursor: pointer; padding: 2px 4px; border-radius: 6px; white-space: nowrap; }
.her-bar-link:hover { background: rgba(182, 156, 255, 0.15); }
.her-bar-select { max-width: 150px; border: 1px solid #4a405f; border-radius: 6px; background: #16141b; color: #d9d2ea; font: inherit; padding: 2px 4px; }
.her-bar-note { margin-top: 6px; font-size: 12px; color: #ffb4b4; }
.her-bar-note:empty { display: none; }
`

export class TalkBar {
  readonly element: HTMLDivElement
  private readonly lines: HTMLDivElement
  private readonly input: HTMLInputElement
  private readonly mic: HTMLButtonElement | undefined
  private readonly where: HTMLSpanElement
  private readonly earlier: HTMLSelectElement
  private readonly note: HTMLDivElement
  private readonly host: BarHost
  private holding = false

  constructor(host: BarHost, doc: Document = document) {
    this.host = host
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
    this.input.placeholder = host.hold === undefined ? '想和她说点什么…（回车发送，Esc 关闭）' : '打字，或按住 🎙 / 右边的 Option 说话'
    this.input.autocomplete = 'off'
    if (host.hold !== undefined) {
      this.mic = make('button', 'her-bar-mic', '🎙')
      this.mic.title = '按住说话，松开发出去'
      this.mic.type = 'button'
      this.mic.addEventListener('pointerdown', event => {
        event.preventDefault()
        this.mic?.setPointerCapture(event.pointerId)
        this.setHolding(true)
      })
      for (const end of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.mic.addEventListener(end, () => this.setHolding(false))
      row.append(this.mic)
    }
    row.append(this.input)
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
    this.note.textContent = ''
    if (!await this.host.say(text)) {
      this.input.value = text
      this.note.textContent = '她现在连不上 dsh，等一下再试'
    }
  }

  /** Nothing typed and nothing held: clicking elsewhere may close it. */
  get idle(): boolean {
    return !this.holding && this.input.value.trim() === ''
  }

  focus(): void {
    this.input.focus()
  }

  show(view: TalkView): void {
    const name = view.name
    this.lines.replaceChildren(...view.lines.slice(-3).map(line => {
      const el = this.element.ownerDocument.createElement('div')
      el.className = `her-bar-line ${line.who}`
      const who = this.element.ownerDocument.createElement('b')
      who.textContent = line.who === 'you' ? '你' : name
      el.append(who, line.text)
      el.title = line.text
      return el
    }))
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
