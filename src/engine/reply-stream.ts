/**
 * Her reply as it streams in, cut into sentences for her voice — the same for
 * every front brain (src/engine/front-brain.ts). A brain reports a reply's
 * start, each piece of its text and its end; an interruption drops the rest
 * of the reply. Reasoning and tool calls never come through here: only the
 * words she says.
 */

import { SentenceSplitter } from '../core/sentences.ts'
import type { ReplyEvents } from './front-brain.ts'

export class ReplyStream {
  private readonly events: ReplyEvents
  private readonly splitter = new SentenceSplitter()
  /** Set by interrupt(): the rest of the current reply is not spoken. */
  private dropping = false
  private replyId: string | undefined

  constructor(events: ReplyEvents) {
    this.events = events
  }

  /** A new reply begins (`replyId` unique across turns). */
  start(replyId: string): void {
    this.splitter.reset()
    this.dropping = false
    this.replyId = replyId
    this.events.start(replyId)
  }

  /** More of what she says. */
  delta(text: string): void {
    const id = this.replyId
    if (id === undefined || this.dropping) return
    for (const sentence of this.splitter.push(text)) this.events.sentence(id, sentence)
  }

  /** The reply ended; what is left is said unless it was cut off or `abandoned`. */
  end(outcome: string): void {
    const id = this.replyId
    if (id === undefined) return
    if (!this.dropping && outcome !== 'abandoned') for (const sentence of this.splitter.flush()) this.events.sentence(id, sentence)
    this.splitter.reset()
    this.replyId = undefined
    this.events.end(id, outcome)
  }

  /** Barge-in: nothing more of this reply is spoken. */
  interrupt(): void {
    this.splitter.reset()
    this.dropping = true
  }

  /** A reply is streaming now. */
  get active(): boolean {
    return this.replyId !== undefined
  }
}
