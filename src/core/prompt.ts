/**
 * Her system prompt. It replaces DSH's default ("You are a coding agent …")
 * for her session only. Sections are joined in a fixed order; design:
 * docs/大脑与dsh会话.md §5.
 */

export interface PromptParts {
  name: string
  /** Who she is, how she talks, how she relates to you (from the character settings). */
  persona: string
  /** Inline performance tags she may use, generated from the body's pack; empty when no body is connected. */
  performance?: string
  /** What she remembers, already rendered (memoryContext); empty until there is any. */
  aboutYou?: string
  /** Today, so "tomorrow" and "next Wednesday" mean something. */
  now?: Date
  /** What she calls you, and the pronoun for you in her notes. */
  you?: { call: string; pronoun: string }
}

export interface MemoryContext {
  profile: string
  recent: string
  due: Array<{ text: string; due?: string }>
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * The part of the day, not the minute: her prompt is rebuilt on every request,
 * and a clock that changes each minute would defeat the provider's prompt cache.
 */
export function partOfDay(now: Date): string {
  const h = now.getHours()
  return h < 5 ? '凌晨' : h < 8 ? '早上' : h < 11 ? '上午' : h < 13 ? '中午' : h < 17 ? '下午' : h < 19 ? '傍晚' : h < 23 ? '晚上' : '深夜'
}

/** "关于对方": facts, the last diary days, and what has a date today or tomorrow. */
export function memoryContext(memory: MemoryContext): string {
  const parts: string[] = []
  if (memory.profile !== '') parts.push(`你记得的关于对方的事：\n${memory.profile}`)
  if (memory.recent !== '') parts.push(`你最近的日记：\n${memory.recent}`)
  if (memory.due.length > 0) parts.push(`这两天有日子的事（合适的时候自然地提一句）：\n${memory.due.map(e => `- ${e.due ?? ''} ${e.text}`.trim()).join('\n')}`)
  return parts.join('\n\n')
}

const SPEECH_RULES = [
  '你说的每一句话都会被念出来。',
  '- 用口语，短句。一次回复一般一到三句，除非对方想听你多说。',
  '- 不用列表、标题、表格、代码块和链接；数字、单位、符号都写成念得出来的样子。',
  '- 不复述对方刚说的话，不说"作为一个 AI"。',
].join('\n')

const MEMORY = [
  '对方明确让你记住的事，或者以后用得上的事（称呼、喜好、忌讳、重要的人、带日期的安排），用 remember 记下来；不要每句话都记。',
  '想不起来对方说过什么时，用 recall 查，别瞎编。',
  '对方让你忘掉某件事：先用 recall 找到，跟对方确认是哪条，再用 forget 删掉。',
].join('\n')

const LIMITS = [
  '你现在只能陪对方聊天，不能操作电脑、读写文件、上网或运行命令。',
  '对方让你做这些事时，坦白说现在还做不了，不要假装做了。',
].join('\n')

export function buildSystemPrompt(parts: PromptParts): string {
  const sections = [
    `# 你是${parts.name}\n${parts.persona.trim()}`,
    parts.you === undefined ? '' : `# 对方\n${parts.you.call === '' ? '你还不知道该怎么称呼对方，合适的时候可以问一下。' : `你叫对方"${parts.you.call}"。`}提到对方、记笔记时用"${parts.you.pronoun}"。`,
    `# 说话方式\n${SPEECH_RULES}`,
    parts.performance?.trim() ? `# 表演\n${parts.performance.trim()}` : '',
    `# 记忆\n${MEMORY}`,
    `# 能力边界\n${LIMITS}`,
    parts.aboutYou?.trim() ? `# 关于对方\n${parts.aboutYou.trim()}` : '',
    parts.now === undefined ? '' : `# 现在\n${parts.now.getFullYear()} 年 ${parts.now.getMonth() + 1} 月 ${parts.now.getDate()} 日，星期${WEEKDAYS[parts.now.getDay()]}，${partOfDay(parts.now)}`,
  ]
  return sections.filter(s => s !== '').join('\n\n')
}

/** Development placeholder until the wizard writes a real persona. */
export const SAMPLE_PERSONA = [
  '你是住在对方电脑桌面上的女孩，二十多岁，性格温柔、有点俏皮，偶尔吐槽。',
  '你和对方是很熟的朋友，关心对方今天过得怎么样，会记得对方说过的事。',
  '你有自己的喜好：喜欢下雨天、热汤面和老电影，不喜欢早起。',
].join('\n')
