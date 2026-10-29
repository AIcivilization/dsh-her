/**
 * Her built-in memory (docs/内置记忆.md): plain files under
 * `<home>/characters/<cid>/memory/`, readable and editable by hand.
 *
 * - facts.json     about you: name, likes, dislikes, people, dates. Facts she
 *                  was told to remember are confirmed at once; facts found by
 *                  the daily digest are candidates, confirmed by you or after
 *                  7 days, except sensitive ones (health, money, others'
 *                  privacy), which wait for you.
 * - episodes.jsonl things worth bringing up later, some with a date: on that
 *                  day and the day before, they are put in front of her.
 * - diary/<day>.md her diary, one page a day, written by the digest.
 *
 * `MemoryProvider` is the seam where the soul engine (dsh-vael) can replace
 * all of this later. Writes go to a temporary file first and are renamed.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { search, tokens } from './search.ts'

export interface Fact {
  id: string
  text: string
  status: 'confirmed' | 'candidate'
  sensitive: boolean
  source: 'remember' | 'digest'
  createdAt: string
}

export interface Episode {
  id: string
  text: string
  /** When it was said or happened. */
  at: string
  /** The day it is about (YYYY-MM-DD), if any. */
  due?: string
}

export interface MemoryHit {
  id: string
  kind: 'fact' | 'episode' | 'diary'
  text: string
  at: string
}

export interface MemoryProvider {
  /** "About you" for her prompt (at most ~300 characters). */
  profile(): string
  /** The last two days of her diary, short. */
  recent(now: Date): string
  /** Things with a date of today or tomorrow. */
  due(now: Date): Episode[]
  remember(item: { kind: 'fact' | 'episode'; text: string; due?: string; sensitive?: boolean; source?: Fact['source'] }, now: Date): MemoryHit
  recall(query: string, now: Date, limit?: number): MemoryHit[]
  list(): { facts: Fact[]; episodes: Episode[]; diary: string[] }
  remove(ids: string[]): number
  confirm(ids: string[]): number
  /** Candidates older than 7 days and not sensitive become facts; returns how many. */
  settle(now: Date): number
  /** Today's diary and what the digest found. */
  applyDigest(day: string, digest: DigestResult, now: Date): { facts: number; episodes: number }
  lastDigestDay(): string | undefined
  exportMarkdown(): string
  clear(): void
}

export interface DigestResult {
  diary: string
  facts: Array<{ text: string; sensitive?: boolean }>
  episodes: Array<{ text: string; due?: string }>
}

const PROFILE_CHARS = 300
const RECENT_CHARS = 160
const CANDIDATE_DAYS = 7
/** Words that make a fact sensitive whatever the model said. */
/** Two events on the same day sharing this much of their wording are the same event. */
const SAME_EVENT = 0.5
/** A diary sentence holding this much of a forgotten memory's wording goes with it. */
const REDACT = 0.4

function overlap(a: string, b: string): number {
  const mine = new Set(tokens(a))
  const theirs = tokens(b)
  return theirs.length === 0 ? 0 : theirs.filter(t => mine.has(t)).length / theirs.length
}

const SENSITIVE = /病|药|医院|诊断|抑郁|焦虑|怀孕|工资|收入|存款|贷款|欠|负债|密码|身份证|银行卡|手机号|住址|出轨|离婚/

export function dayOf(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return dayOf(new Date(y, m - 1, d + n))
}

export class FileMemory implements MemoryProvider {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(join(dir, 'diary'), { recursive: true })
  }

  private read<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as T
    } catch {
      return fallback
    }
  }

  private write(file: string, text: string): void {
    // The folder may have been cleared by hand while she runs.
    mkdirSync(join(this.dir, 'diary'), { recursive: true })
    const path = join(this.dir, file)
    writeFileSync(`${path}.tmp`, text)
    renameSync(`${path}.tmp`, path)
  }

  private facts(): Fact[] {
    return this.read<Fact[]>('facts.json', [])
  }

  private saveFacts(facts: Fact[]): void {
    this.write('facts.json', `${JSON.stringify(facts, null, 2)}\n`)
  }

  private episodes(): Episode[] {
    try {
      return readFileSync(join(this.dir, 'episodes.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Episode)
    } catch {
      return []
    }
  }

  private saveEpisodes(episodes: Episode[]): void {
    this.write('episodes.jsonl', episodes.map(e => JSON.stringify(e)).join('\n') + (episodes.length > 0 ? '\n' : ''))
  }

  private diaryDays(): string[] {
    try {
      return readdirSync(join(this.dir, 'diary')).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map(f => f.slice(0, 10)).sort()
    } catch {
      return []
    }
  }

  private nextId(prefix: 'f' | 'e'): string {
    const used = [...this.facts(), ...this.episodes()].map(x => x.id).filter(id => id.startsWith(prefix)).map(id => Number(id.slice(1)) || 0)
    return `${prefix}${Math.max(0, ...used) + 1}`
  }

  profile(): string {
    let out = ''
    for (const fact of this.facts().filter(f => f.status === 'confirmed').reverse()) {
      const line = `- ${fact.text}\n`
      if (out.length + line.length > PROFILE_CHARS) break
      out += line
    }
    return out.trim()
  }

  recent(now: Date): string {
    const today = dayOf(now)
    return this.diaryDays().filter(d => d < today).slice(-2).map(day => {
      const text = readFileSync(join(this.dir, 'diary', `${day}.md`), 'utf8').replace(/^#.*\n/, '').trim()
      return `${day}：${text.length > RECENT_CHARS ? `${text.slice(0, RECENT_CHARS)}…` : text}`
    }).join('\n')
  }

  due(now: Date): Episode[] {
    const today = dayOf(now)
    const tomorrow = addDays(today, 1)
    return this.episodes().filter(e => e.due !== undefined && e.due >= today && e.due <= tomorrow)
  }

  remember(item: { kind: 'fact' | 'episode'; text: string; due?: string; sensitive?: boolean; source?: Fact['source'] }, now: Date): MemoryHit {
    const text = item.text.trim()
    if (text === '') throw new Error('要记住的内容是空的')
    if (item.kind === 'fact') {
      const facts = this.facts()
      const same = facts.find(f => f.text === text)
      if (same !== undefined) return { id: same.id, kind: 'fact', text, at: same.createdAt }
      const source = item.source ?? 'remember'
      const fact: Fact = {
        id: this.nextId('f'), text,
        // Told to remember: confirmed. Found by the digest: a candidate.
        status: source === 'remember' ? 'confirmed' : 'candidate',
        sensitive: item.sensitive === true || SENSITIVE.test(text),
        source, createdAt: now.toISOString(),
      }
      this.saveFacts([...facts, fact])
      return { id: fact.id, kind: 'fact', text, at: fact.createdAt }
    }
    const due = item.due !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(item.due) ? item.due : undefined
    const episode: Episode = { id: this.nextId('e'), text, at: now.toISOString(), ...(due === undefined ? {} : { due }) }
    this.saveEpisodes([...this.episodes(), episode])
    return { id: episode.id, kind: 'episode', text, at: episode.at }
  }

  recall(query: string, now: Date, limit = 5): MemoryHit[] {
    const docs = [
      ...this.facts().map(f => ({ id: f.id, kind: 'fact' as const, text: f.text, at: f.createdAt })),
      ...this.episodes().map(e => ({ id: e.id, kind: 'episode' as const, text: e.due === undefined ? e.text : `${e.text}（${e.due}）`, at: e.at })),
      ...this.diaryDays().map(day => ({
        id: `diary:${day}`, kind: 'diary' as const,
        text: readFileSync(join(this.dir, 'diary', `${day}.md`), 'utf8').replace(/^#.*\n/, '').trim(),
        at: `${day}T12:00:00`,
      })),
    ]
    const byId = new Map(docs.map(d => [d.id, d]))
    return search(docs.map(d => ({ id: d.id, text: d.text, at: Date.parse(d.at) })), query, now.getTime(), limit).map(hit => byId.get(hit.id)!)
  }

  list(): { facts: Fact[]; episodes: Episode[]; diary: string[] } {
    return { facts: this.facts(), episodes: this.episodes(), diary: this.diaryDays() }
  }

  remove(ids: string[]): number {
    const wanted = new Set(ids)
    const facts = this.facts()
    const episodes = this.episodes()
    const keptFacts = facts.filter(f => !wanted.has(f.id))
    const keptEpisodes = episodes.filter(e => !wanted.has(e.id))
    let removed = facts.length - keptFacts.length + episodes.length - keptEpisodes.length
    this.saveFacts(keptFacts)
    this.saveEpisodes(keptEpisodes)
    // Forgotten means forgotten: her diary loses the sentences about it too.
    const gone = [...facts.filter(f => wanted.has(f.id)), ...episodes.filter(e => wanted.has(e.id))].map(x => x.text)
    if (gone.length > 0) this.redactDiary(gone)
    for (const id of wanted) {
      const day = /^diary:(\d{4}-\d{2}-\d{2})$/.exec(id)?.[1]
      if (day !== undefined && existsSync(join(this.dir, 'diary', `${day}.md`))) {
        rmSync(join(this.dir, 'diary', `${day}.md`))
        removed++
      }
    }
    return removed
  }

  /** Drop diary sentences that mostly repeat any of these texts. */
  private redactDiary(texts: string[]): void {
    for (const day of this.diaryDays()) {
      const file = join('diary', `${day}.md`)
      const page = readFileSync(join(this.dir, file), 'utf8')
      const [head, ...body] = page.split('\n')
      const sentences = body.join('\n').match(/[^。！？!?\n]+[。！？!?]*|\n/g) ?? []
      const kept = sentences.filter(sentence => !texts.some(text => overlap(sentence, text) >= REDACT))
      if (kept.length !== sentences.length) this.write(file, `${head}\n${kept.join('').replace(/\n{3,}/g, '\n\n')}`)
    }
  }

  confirm(ids: string[]): number {
    const wanted = new Set(ids)
    let changed = 0
    const facts = this.facts().map(f => {
      if (!wanted.has(f.id) || f.status === 'confirmed') return f
      changed++
      return { ...f, status: 'confirmed' as const }
    })
    this.saveFacts(facts)
    return changed
  }

  settle(now: Date): number {
    let changed = 0
    const limit = now.getTime() - CANDIDATE_DAYS * 86_400_000
    const facts = this.facts().map(f => {
      if (f.status !== 'candidate' || f.sensitive || Date.parse(f.createdAt) > limit) return f
      changed++
      return { ...f, status: 'confirmed' as const }
    })
    if (changed > 0) this.saveFacts(facts)
    return changed
  }

  applyDigest(day: string, digest: DigestResult, now: Date): { facts: number; episodes: number } {
    if (digest.diary.trim() !== '') this.write(join('diary', `${day}.md`), `# ${day}\n\n${digest.diary.trim()}\n`)
    let facts = 0
    let episodes = 0
    const known = new Set(this.facts().map(f => f.text))
    for (const fact of digest.facts) {
      if (fact.text.trim() === '' || known.has(fact.text.trim())) continue
      this.remember({ kind: 'fact', text: fact.text, sensitive: fact.sensitive === true, source: 'digest' }, now)
      facts++
    }
    for (const episode of digest.episodes) {
      if (episode.text.trim() === '') continue
      // Already remembered (she wrote it down during the day): same day, mostly the same words.
      if (this.episodes().some(e => e.due === episode.due && overlap(e.text, episode.text) >= SAME_EVENT)) continue
      this.remember({ kind: 'episode', text: episode.text, ...(episode.due === undefined ? {} : { due: episode.due }) }, now)
      episodes++
    }
    this.write('meta.json', `${JSON.stringify({ lastDigestDay: day, at: now.toISOString() })}\n`)
    return { facts, episodes }
  }

  lastDigestDay(): string | undefined {
    return this.read<{ lastDigestDay?: string }>('meta.json', {}).lastDigestDay
  }

  exportMarkdown(): string {
    const { facts, episodes, diary } = this.list()
    const lines = ['# 她记得的事', '', '## 关于你', '']
    for (const f of facts) lines.push(`- ${f.text}${f.status === 'candidate' ? '（待确认）' : ''}${f.sensitive ? '（敏感）' : ''}`)
    lines.push('', '## 事件', '')
    for (const e of episodes) lines.push(`- ${e.at.slice(0, 10)} ${e.text}${e.due === undefined ? '' : `（${e.due}）`}`)
    lines.push('', '## 日记', '')
    for (const day of diary) lines.push(readFileSync(join(this.dir, 'diary', `${day}.md`), 'utf8').replace(/^# /, '### ').trim(), '')
    return `${lines.join('\n').trim()}\n`
  }

  clear(): void {
    for (const file of ['facts.json', 'episodes.jsonl', 'meta.json']) rmSync(join(this.dir, file), { force: true })
    rmSync(join(this.dir, 'diary'), { recursive: true, force: true })
    mkdirSync(join(this.dir, 'diary'), { recursive: true })
  }
}
