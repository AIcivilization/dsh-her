/**
 * Streaming sentence splitter for speech: the reply is spoken sentence by
 * sentence, so synthesis starts on the first sentence while the model is
 * still writing the rest.
 *
 * A sentence ends at a terminator (。！？!?… or a line break); closing quotes
 * and brackets right after it stay with the sentence. A long run with no
 * terminator is cut at the last soft pause (，、；：,;) so the first audio is
 * never held back by one endless clause. Fragments with no letters or digits
 * (a lone "！", stray markdown) are dropped: they must never reach the TTS.
 */

const TERMINATORS = new Set(['。', '！', '？', '!', '?', '…', '\n'])
const CLOSERS = new Set(['”', '’', '"', "'", '）', ')', '】', ']', '」', '』', '》'])
const SOFT_PAUSES = new Set(['，', '、', '；', '：', ',', ';'])

/** Characters after which a run without a terminator is cut at its last soft pause. */
export const SOFT_CUT_AT = 48

function isSpeakable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

export class SentenceSplitter {
  private buffer = ''
  /** A terminated sentence held until the next character shows whether a closer follows. */
  private pending: string | undefined

  /** Feed a streamed delta; returns the sentences it completed, in order. */
  push(delta: string): string[] {
    const out: string[] = []
    for (const ch of delta) {
      if (this.pending !== undefined) {
        if (CLOSERS.has(ch)) {
          this.pending += ch
          continue
        }
        this.release(out)
      }
      this.buffer += ch
      if (TERMINATORS.has(ch)) {
        this.pending = this.buffer
        this.buffer = ''
      } else if ([...this.buffer].length >= SOFT_CUT_AT) {
        this.cutAtSoftPause(out)
      }
    }
    return out
  }

  /** The held sentence and the unterminated rest, once the reply has ended. */
  flush(): string[] {
    const out: string[] = []
    this.release(out)
    this.pending = this.buffer
    this.buffer = ''
    this.release(out)
    return out
  }

  /** Forget everything (the reply was interrupted). */
  reset(): void {
    this.buffer = ''
    this.pending = undefined
  }

  private release(out: string[]): void {
    const sentence = this.pending?.trim() ?? ''
    this.pending = undefined
    if (isSpeakable(sentence)) out.push(sentence)
  }

  private cutAtSoftPause(out: string[]): void {
    const chars = [...this.buffer]
    for (let i = chars.length - 1; i > 0; i--) {
      if (SOFT_PAUSES.has(chars[i]!)) {
        const head = chars.slice(0, i + 1).join('').trim()
        this.buffer = chars.slice(i + 1).join('')
        if (isSpeakable(head)) out.push(head)
        return
      }
    }
  }
}
