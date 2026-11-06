/**
 * Touching her (docs/主动与触摸设计.md). The body reacts at once by itself (a
 * small movement and a sound); the brain then picks a short line. Lines are
 * written once for her persona by her model and kept, so a touch costs nothing
 * and answers at once.
 */

export type TouchPart = 'head' | 'body'
export type TouchKind = 'tap' | 'long'
export type TouchMood = 'head' | 'body' | 'long' | 'many'
export type TouchLines = Record<TouchMood, string[]>

const MOODS: TouchMood[] = ['head', 'body', 'long', 'many']

/** Until her own lines are written: neutral enough for anyone. */
export const FALLBACK_LINES: TouchLines = {
  head: ['嗯？', '诶？'],
  body: ['嗯？', '怎么啦？'],
  long: ['嗯……'],
  many: ['好啦好啦。'],
}

/** Which part of her a point is on: `rel` is how far down her figure, 0 at the top of her head and 1 at her feet. */
export function touchPart(rel: number): TouchPart {
  return rel < 0.3 ? 'head' : 'body'
}

/** Touches closer than this together count as playing with her. */
const MANY_WITHIN_MS = 10_000
const MANY_COUNT = 5
/** She does not answer every touch. */
const LINE_EVERY_MS = 8000

/** Decides, touch by touch, whether she says something and in what mood. */
export class TouchTracker {
  private recent: number[] = []
  private lastLineAt = 0
  private lastLine: string | undefined

  /** What this touch makes her say; undefined: only the movement. */
  next(part: TouchPart, kind: TouchKind, at: number): TouchMood | undefined {
    this.recent = [...this.recent.filter(t => at - t <= MANY_WITHIN_MS), at]
    if (at - this.lastLineAt < LINE_EVERY_MS) return undefined
    this.lastLineAt = at
    if (this.recent.length >= MANY_COUNT) return 'many'
    return kind === 'long' ? 'long' : part
  }

  /** A line of this mood, not the one she said last. */
  pick(lines: string[], random: () => number = Math.random): string | undefined {
    const fresh = lines.length > 1 ? lines.filter(l => l !== this.lastLine) : lines
    const line = fresh[Math.floor(random() * fresh.length)]
    if (line !== undefined) this.lastLine = line
    return line
  }
}

/** What to ask her model for her touch lines. */
export function touchLinesPrompt(): string {
  return [
    '（对方在屏幕上碰你。写下你被碰时会脱口而出的短句，要符合你的性格和说话方式，不要色情或暧昧过头。）',
    '只输出一个 JSON 对象，四个键，每个键 6 句，每句不超过 12 个字：',
    '"head"：被点了点头；"body"：被戳了一下；"long"：被按住头摸了好一会儿；"many"：被连着戳个没完。',
    '不要括号里的动作描写，不要 emoji。',
  ].join('\n')
}

/** Her lines out of the model's answer; undefined when it is not usable. */
export function parseTouchLines(answer: string): TouchLines | undefined {
  const match = /\{[\s\S]*\}/.exec(answer)
  if (match === null) return undefined
  let value: unknown
  try {
    value = JSON.parse(match[0])
  } catch {
    return undefined
  }
  const out = {} as TouchLines
  for (const mood of MOODS) {
    const list = (value as Record<string, unknown>)[mood]
    if (!Array.isArray(list)) return undefined
    const lines = list.filter((s): s is string => typeof s === 'string').map(s => s.trim()).filter(s => s !== '' && [...s].length <= 30)
    if (lines.length === 0) return undefined
    out[mood] = lines.slice(0, 12)
  }
  return out
}

/** What the pack can do when she is touched: a clip made for it, else a reaction it has. */
export function touchClip(pack: { emotions: string[]; actions: Array<{ id: string }> } | undefined, part: TouchPart): { act: string } | { emotion: string } | undefined {
  if (pack === undefined) return undefined
  const action = pack.actions.find(a => a.id === `touch_${part}`) ?? pack.actions.find(a => a.id === 'touch')
  if (action !== undefined) return { act: action.id }
  const emotion = ['shy', 'happy', 'smile'].find(e => pack.emotions.includes(e))
  return emotion === undefined ? undefined : { emotion }
}
