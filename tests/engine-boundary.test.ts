import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * The body engine runs without DSH (docs/实施计划.md, step 2): everything
 * outside src/dsh/ and src/client/ must load on a computer that has no DSH.
 */
const src = fileURLToPath(new URL('../src/', import.meta.url))
const WITHOUT_DSH = ['core', 'engine', 'pack', 'server', 'voice', 'memory', 'protocol', 'standalone']

function files(dir: string): string[] {
  let out: string[] = []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out = out.concat(files(path))
    else if (/\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

test('the engine does not reach into DSH', () => {
  const offenders: string[] = []
  const sources = [...WITHOUT_DSH.flatMap(dir => files(join(src, dir))), join(src, 'net.ts'), join(src, 'platform.ts')]
  assert.ok(sources.length > 50, 'the folders are there')
  for (const path of sources) {
    const text = readFileSync(path, 'utf8')
    for (const match of text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
      const from = match[1]!
      if (/(^|\/)dsh\//.test(from) || from.startsWith('@deepseek-ai/')) offenders.push(`${path.slice(src.length)} ← ${from}`)
    }
  }
  assert.deepEqual(offenders, [])
})
