/**
 * The front brain (docs/大脑与手设计.md, docs/实施计划.md step 9): the model
 * she talks with. DSH's session (src/dsh/her-session.ts) is the first one;
 * Claude Code, a plain API key and Codex come next. Who she is, her voice, her
 * memory and her body stay on our side; a brain only gets her prompt and her
 * tools, and streams back what she says.
 */

/** What her stream produces, per reply: one `start`, any number of `sentence`s, one `end`. `replyId` is unique across turns. */
export interface ReplyEvents {
  start(replyId: string): void
  sentence(replyId: string, text: string): void
  end(replyId: string, outcome: string): void
}

export interface FrontBrain {
  /** Send what you said (typed or recognized) as a new turn; her reply comes through the ReplyEvents. */
  say(text: string, via: 'voice' | 'text' | 'command'): Promise<unknown>
  /** Tell her something for her next turn without making her answer. */
  note(text: string): Promise<void>
  /** Stop the reply in progress (barge-in): the rest of it is not spoken. */
  interrupt(): void
  /** The conversation going on now, if there is one yet. */
  readonly sessionId: string | undefined
  /** Why the last reply had no words, in plain words, when the brain knows (a login that expired, no model…). */
  readonly lastError?: string | undefined
  dispose(): Promise<void>
}
