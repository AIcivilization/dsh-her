/**
 * The daily digest: once a day, the day's conversation is read back from her
 * DSH session and a model writes her diary page and picks out what is worth
 * keeping. This file is the pure part: the transcript, the prompt, and a
 * forgiving parser for the model's JSON.
 */

import type { DigestResult } from './store.ts'

export interface TranscriptLine {
  who: 'you' | 'her'
  text: string
  time: number
}

const MAX_CHARS = 12_000

/** Events of her session within one local day, as "you" / "her" lines. Context notes and tags are left out. */
export function transcriptOf(events: Array<{ type: string; time?: number; data: unknown }>, dayStart: number, dayEnd: number): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  for (const event of events) {
    const time = event.time ?? 0
    if (time < dayStart || time >= dayEnd) continue
    if (event.type === 'user/message') {
      const data = event.data as { content?: Array<{ type: string; text?: string }>; source?: { kind?: string } }
      // Barge-in notes and other context she was given are not things you said.
      if (data.source?.kind === 'dsh-her-context') continue
      const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()
      if (text !== '') lines.push({ who: 'you', text, time })
    } else if (event.type === 'assistant/message') {
      const data = event.data as { message?: { content?: Array<{ type: string; text?: string }> } }
      const text = (data.message?.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').replace(/〔[^〕]*〕/g, '').trim()
      if (text !== '') lines.push({ who: 'her', text, time })
    }
  }
  // Keep the end of a long day.
  let total = 0
  const kept: TranscriptLine[] = []
  for (const line of [...lines].reverse()) {
    total += line.text.length + 4
    if (total > MAX_CHARS) break
    kept.unshift(line)
  }
  return kept
}

export function digestPrompt(name: string, day: string, transcript: TranscriptLine[], knownFacts: string[], knownEvents: string[] = []): { system: string; user: string } {
  const system = [
    `你是"${name}"，正在睡前整理今天和对方的聊天，写日记，并记下以后用得上的事。`,
    '只输出一个 JSON 对象，不要任何别的文字：',
    '{"diary": "第一人称、你自己的口吻，写今天和对方之间发生了什么、你的感受，100 到 200 字",',
    ' "facts": [{"text": "关于对方的新事实，一句话，比如「他不吃香菜」", "sensitive": false}],',
    ' "episodes": [{"text": "以后值得提起的具体事情，一句话", "due": "YYYY-MM-DD，有具体日期才写"}]}',
    '规则：',
    '- facts 只写关于对方的、长期成立的事（称呼、喜好、忌讳、重要的人、生日）；已经知道的不要重复；没有就给空数组。',
    '- 涉及健康、钱、证件、他人隐私的事实，sensitive 写 true。',
    '- episodes 写具体的事（比如"他下周三去面试"），把"明天""下周三"换算成具体日期；已经记下的不要重复；没有就给空数组。',
    '- 只根据聊天记录，不要编造。',
  ].join('\n')
  const user = [
    `今天是 ${day}。`,
    knownFacts.length === 0 ? '已经知道的关于对方的事：（还没有）' : `已经知道的关于对方的事：\n${knownFacts.map(f => `- ${f}`).join('\n')}`,
    knownEvents.length === 0 ? '' : `已经记下的事件：\n${knownEvents.map(e => `- ${e}`).join('\n')}`,
    '',
    '今天的聊天：',
    ...transcript.map(l => `${l.who === 'you' ? '对方' : '我'}：${l.text}`),
  ].join('\n')
  return { system, user }
}

/** The first JSON object in the model's answer, checked and cleaned; undefined if there is none. */
export function parseDigest(answer: string): DigestResult | undefined {
  const start = answer.indexOf('{')
  const end = answer.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let value: unknown
  try {
    value = JSON.parse(answer.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as { diary?: unknown; facts?: unknown; episodes?: unknown }
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null && typeof i.text === 'string') : [])
  return {
    diary: typeof v.diary === 'string' ? v.diary : '',
    facts: list(v.facts).map(f => ({ text: String(f.text).trim(), sensitive: f.sensitive === true })),
    episodes: list(v.episodes).map(e => ({
      text: String(e.text).trim(),
      ...(typeof e.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.due) ? { due: e.due } : {}),
    })),
  }
}
