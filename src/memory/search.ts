/**
 * Recall without embeddings (docs/内置记忆.md §3): Chinese is cut into
 * character bigrams (single characters for one-character runs), Latin text
 * into lowercase words, scored with BM25, and newer memories weigh a little
 * more. DeepSeek offers no embedding API and a local embedding model would
 * add hundreds of MB, so this is enough for one person's memories.
 */

export interface SearchDoc {
  id: string
  text: string
  /** When it was written or happened (ms). */
  at: number
}

const K1 = 1.2
const B = 0.75
/** A memory this many days old counts half as much as one from today. */
const HALF_LIFE_DAYS = 60

export function tokens(text: string): string[] {
  const out: string[] = []
  for (const run of text.toLowerCase().match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? []) {
    if (/^\p{Script=Han}+$/u.test(run)) {
      const chars = [...run]
      if (chars.length === 1) out.push(run)
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]! + chars[i + 1]!)
    } else {
      out.push(run)
    }
  }
  return out
}

export function search(docs: SearchDoc[], query: string, now: number, limit = 5): Array<SearchDoc & { score: number }> {
  const terms = [...new Set(tokens(query))]
  if (terms.length === 0 || docs.length === 0) return []
  const docTokens = docs.map(d => tokens(d.text))
  const avg = docTokens.reduce((sum, t) => sum + t.length, 0) / docs.length || 1
  const df = new Map(terms.map(t => [t, docTokens.filter(toks => toks.includes(t)).length]))
  const scored = docs.map((doc, i) => {
    const toks = docTokens[i]!
    let score = 0
    for (const term of terms) {
      const n = df.get(term)!
      if (n === 0) continue
      const tf = toks.filter(t => t === term).length
      if (tf === 0) continue
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))
      score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * toks.length) / avg)))
    }
    const ageDays = Math.max(0, (now - doc.at) / 86_400_000)
    return { ...doc, score: score * (0.5 + 0.5 * 2 ** (-ageDays / HALF_LIFE_DAYS)) }
  })
  return scored.filter(d => d.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
}
