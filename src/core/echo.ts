/**
 * Was that you, or her own voice coming back through the speakers?
 *
 * Right after a barge-in the brain checks what was recognized against what
 * she was saying. Mostly her own words (character-bigram overlap), or only a
 * filler sound (嗯, 啊…), means it was not you: it is dropped instead of
 * becoming your turn, and the body counts it toward turning barge-in off.
 */

const FILLERS = /^[嗯啊哦噢呃额唔哈呀诶欸嗷恩]+$/u
const ECHO_OVERLAP = 0.6

function bigrams(text: string): string[] {
  const chars = [...text.replace(/[^\p{L}\p{N}]/gu, '')]
  if (chars.length < 2) return chars
  return chars.slice(1).map((ch, i) => chars[i]! + ch)
}

export type EchoVerdict = 'you' | 'echo' | 'filler'

export function judgeBargeIn(heard: string, herWords: string): EchoVerdict {
  const plain = heard.replace(/[^\p{L}\p{N}]/gu, '')
  if (plain === '' || FILLERS.test(plain)) return 'filler'
  const mine = new Set(bigrams(herWords))
  const theirs = bigrams(plain)
  if (theirs.length === 0 || mine.size === 0) return 'you'
  const shared = theirs.filter(b => mine.has(b)).length
  return shared / theirs.length >= ECHO_OVERLAP ? 'echo' : 'you'
}
