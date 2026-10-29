/**
 * Inline performance tags (docs/大脑与dsh会话.md §6): she writes 〔开心〕 or
 * 〔动作:wave〕 in her reply; they are taken out of the text (never shown,
 * never spoken) and sent as cues with the sentence, so the body acts them out
 * when that sentence starts. Only what the connected pack can do is kept.
 *
 * The prompt section that teaches her the tags is generated from the same
 * pack summary, so she only ever hears of moves her body has.
 */

import type { Cue, PackSummary } from '../protocol/index.ts'

/** Chinese names for the emotions a pack may have. */
export const EMOTION_WORDS: Record<string, string> = {
  happy: '开心', shy: '害羞', pout: '嘟嘴', sad: '难过', angry: '生气', surprised: '惊讶', sleepy: '困',
}

const TAG = /〔([^〕]{1,24})〕/g

/** Light actions are acted inline; heavy ones (outfits, stored lines) go through the play_action tool. */
export function isHeavy(action: PackSummary['actions'][number]): boolean {
  return action.id.startsWith('outfit_') || action.id.startsWith('line_') || (action.durationMs ?? 0) > 6000
}

export function extractCues(text: string, pack: PackSummary | undefined): { text: string; cues: Cue[] } {
  const cues: Cue[] = []
  const clean = text.replace(TAG, (_whole, inner: string) => {
    if (pack === undefined) return ''
    const body = inner.trim()
    const action = /^动作\s*[:：]\s*(.+)$/.exec(body)?.[1]?.trim()
    if (action !== undefined) {
      const found = pack.actions.find(a => !isHeavy(a) && (a.id === action || a.desc === action))
      if (found !== undefined) cues.push({ kind: 'act', name: found.id })
      return ''
    }
    const emotion = pack.emotions.find(e => e === body || EMOTION_WORDS[e] === body)
    if (emotion !== undefined) cues.push({ kind: 'emotion', name: emotion })
    return ''
  })
  return { text: clean.replace(/\s{2,}/g, ' ').trim(), cues }
}

/** The "表演" section of her system prompt, for what this pack can do; empty without a pack. */
export function performanceSection(pack: PackSummary | undefined): string {
  if (pack === undefined) return ''
  const lines: string[] = []
  const emotions = pack.emotions.map(e => EMOTION_WORDS[e] ?? e)
  const light = pack.actions.filter(a => !isHeavy(a))
  const heavy = pack.actions.filter(isHeavy)
  if (emotions.length > 0 || light.length > 0) {
    lines.push('你在对方桌面上有一个身体。可以在句子里加标记，让身体做出来（标记不会被念出来，也不会显示）：')
    if (emotions.length > 0) lines.push(`- 情绪：${emotions.map(e => `〔${e}〕`).join(' ')}`)
    for (const action of light) lines.push(`- 〔动作:${action.id}〕：${action.desc}`)
    lines.push('标记放在对应那句话的开头，偶尔用，不要每句都加。')
  }
  if (heavy.length > 0) {
    lines.push('需要较长时间的表演（离开画面、换衣服、说准备好的话），调用 play_action 工具，等它做完再接着说。调用前先简短说一句，比如"好，等我一下"：')
    for (const action of heavy) lines.push(`- ${action.id}：${action.desc}`)
  }
  lines.push('只有上面列出的表演能做；没列出的，用说的。')
  return lines.join('\n')
}
