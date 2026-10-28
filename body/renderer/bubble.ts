/**
 * The speech bubble above her. A reply (`speak.begin` … `speak.end`) fills it
 * sentence by sentence; it stays up as long as the sentences take to say, then
 * fades. A reply that is cut off is marked and fades quickly. Short notes
 * (`bubble`) and the "thinking" dots share the same bubble.
 */

const MIN_HOLD_MS = 1500

export class Bubble {
  private readonly box: HTMLElement
  private readonly text: HTMLElement
  private uid: string | undefined
  /** When the sentences shown so far will have been said. */
  private doneAt = 0
  private hideTimer: number | undefined

  constructor(box: HTMLElement) {
    this.box = box
    this.text = box.querySelector('p')!
  }

  thinking(): void {
    this.uid = undefined
    this.text.replaceChildren()
    this.box.classList.add('show', 'thinking')
    this.clearHide()
  }

  begin(uid: string): void {
    this.uid = uid
    this.text.replaceChildren()
    this.doneAt = Date.now()
    this.clearHide()
  }

  seg(uid: string, sentence: string, durationMs: number): void {
    if (uid !== this.uid) return
    this.box.classList.remove('thinking')
    this.box.classList.add('show')
    const span = document.createElement('span')
    span.textContent = sentence
    // column-reverse keeps the newest sentence at the bottom and lets old ones scroll off the top.
    this.text.prepend(span)
    this.doneAt = Math.max(this.doneAt, Date.now()) + durationMs
  }

  end(uid: string): void {
    if (uid !== this.uid) return
    this.uid = undefined
    if (this.text.childElementCount === 0) {
      this.hide(0)
      return
    }
    this.hide(Math.max(MIN_HOLD_MS, this.doneAt - Date.now()))
  }

  cancel(uid: string): void {
    if (uid !== this.uid) return
    this.uid = undefined
    const first = this.text.firstElementChild
    if (first !== null) {
      first.textContent = `${first.textContent ?? ''}——`
      first.classList.add('cut')
    }
    this.hide(800)
  }

  note(message: string, ttlMs = 4000): void {
    this.uid = undefined
    this.box.classList.remove('thinking')
    const span = document.createElement('span')
    span.textContent = message
    this.text.replaceChildren(span)
    this.box.classList.add('show')
    this.hide(ttlMs)
  }

  /** Is a reply on screen right now? */
  get busy(): boolean {
    return this.box.classList.contains('show')
  }

  private hide(afterMs: number): void {
    this.clearHide()
    this.hideTimer = window.setTimeout(() => this.box.classList.remove('show', 'thinking'), afterMs)
  }

  private clearHide(): void {
    if (this.hideTimer !== undefined) window.clearTimeout(this.hideTimer)
    this.hideTimer = undefined
  }
}
