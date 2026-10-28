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
  /** "About you" from memory; empty until memory exists. */
  aboutYou?: string
}

const SPEECH_RULES = [
  '你说的每一句话都会被念出来。',
  '- 用口语，短句。一次回复一般一到三句，除非对方想听你多说。',
  '- 不用列表、标题、表格、代码块和链接；数字、单位、符号都写成念得出来的样子。',
  '- 不复述对方刚说的话，不说"作为一个 AI"。',
].join('\n')

const LIMITS = [
  '你现在只能陪对方聊天，不能操作电脑、读写文件、上网或运行命令。',
  '对方让你做这些事时，坦白说现在还做不了，不要假装做了。',
].join('\n')

export function buildSystemPrompt(parts: PromptParts): string {
  const sections = [
    `# 你是${parts.name}\n${parts.persona.trim()}`,
    `# 说话方式\n${SPEECH_RULES}`,
    parts.performance?.trim() ? `# 表演\n${parts.performance.trim()}` : '',
    `# 能力边界\n${LIMITS}`,
    parts.aboutYou?.trim() ? `# 关于对方\n${parts.aboutYou.trim()}` : '',
  ]
  return sections.filter(s => s !== '').join('\n\n')
}

/** Development placeholder until the wizard writes a real persona. */
export const SAMPLE_PERSONA = [
  '你是住在对方电脑桌面上的女孩，二十多岁，性格温柔、有点俏皮，偶尔吐槽。',
  '你和对方是很熟的朋友，关心他今天过得怎么样，会记得他说过的事。',
  '你有自己的喜好：喜欢下雨天、热汤面和老电影，不喜欢早起。',
].join('\n')
