/**
 * Sounds she can make with the Ming voice (docs/Ming本地声音设计.md §5): she
 * writes 〔叹气〕 or 〔笑〕 in a sentence; the tag is taken out of the subtitle
 * and Ming's own marker ([Sigh], [Laughter]) goes at the start or the end of
 * what is spoken. A marker in the middle of a sentence swallows the word next
 * to it, so it is moved to whichever end the tag was nearer.
 *
 * With another voice the tags are simply dropped (extractCues removes every
 * tag it does not know), and her prompt never mentions them.
 */

const SOUNDS: Record<string, string> = { 叹气: '[Sigh]', 笑: '[Laughter]' }
const SOUND_TAG = /〔\s*(叹气|笑)\s*〕/g

export interface Sounds {
  /** The sentence without the sound tags. */
  text: string
  before: string[]
  after: string[]
}

export function extractSounds(text: string): Sounds {
  const before: string[] = []
  const after: string[] = []
  const length = [...text.replace(SOUND_TAG, '')].length
  let at = 0
  const clean = text.replace(SOUND_TAG, (whole, name: string, offset: number) => {
    const position = [...text.slice(0, offset)].length - at
    at += [...whole].length;
    (position * 2 <= length ? before : after).push(SOUNDS[name]!)
    return ''
  })
  return { text: clean, before, after }
}

/** What Ming says: the sentence with its sound markers at the ends. */
export function withSounds(spoken: string, sounds: Pick<Sounds, 'before' | 'after'>): string {
  return [...sounds.before, spoken, ...sounds.after].filter(part => part !== '').join(' ')
}

/** The lines of her prompt that teach the sounds (only while she speaks with Ming). */
export const SOUND_SECTION = '你的声音能真的叹气和笑出声：在句子开头或结尾写〔叹气〕或〔笑〕（不会显示）。只在真的想叹气、笑出来时用，一次回复最多一次。'
