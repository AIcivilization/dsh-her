/**
 * What of a sentence can be said aloud. Her system prompt asks for plain
 * spoken text, but models still slip in markdown, links and code; those are
 * dropped or reduced before synthesis. The subtitle keeps the original text.
 */

const URL = /\bhttps?:\/\/\S+/g
const INLINE_CODE = /`[^`]*`/g
const MARKDOWN_MARKS = /[*_~#>|`]+/g
const LIST_BULLET = /^\s*(?:[-+•]|\d+[.)、])\s+/
/** Performance tags such as 〔开心〕 or 〔动作:wave〕 drive the body and are never spoken (M3). */
const PERFORMANCE_TAG = /〔[^〕]*〕/g

export function speakable(text: string): string {
  return text
    .replace(PERFORMANCE_TAG, '')
    // A markdown link keeps its words; this must run before bare URLs are dropped.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(URL, '')
    .replace(INLINE_CODE, '')
    .replace(LIST_BULLET, '')
    .replace(MARKDOWN_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim()
}
