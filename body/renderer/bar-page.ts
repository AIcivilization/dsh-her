/**
 * The desktop body's talk bar window: the shared bar (talk-bar.ts) wired to the
 * body. Holding to talk is passed to her window, where the microphone is.
 */

import type { HerBridge } from '../shared/types.ts'
import { TalkBar } from './talk-bar.ts'

declare global {
  interface Window {
    her: HerBridge
  }
}

const bar = new TalkBar({
  say: text => window.her.say(text),
  newConversation: () => { void window.her.send({ t: 'talk.new' }) },
  resume: id => { void window.her.send({ t: 'talk.resume', id }) },
  openFull: () => {
    void window.her.send({ t: 'talk.open' })
    window.her.openDsh()
  },
  hold: on => window.her.hold(on),
  close: () => window.close(),
})
document.body.append(bar.element)
bar.focus()
window.her.onBrain(message => {
  if (message.t === 'talk') bar.show(message)
  if (message.t === 'bubble' && message.text.startsWith('（新开了一段')) bar.showNote(message.text.slice(1, -1))
})
void window.her.send({ t: 'talk.get' })
window.addEventListener('focus', () => bar.focus())
// Clicking elsewhere puts it away, unless something is typed or held.
window.addEventListener('blur', () => { if (bar.idle) window.close() })
