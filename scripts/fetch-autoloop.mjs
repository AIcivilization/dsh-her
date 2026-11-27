// Fetch the pinned agent-autoloop (third_party/agent-autoloop.json) into body/vendor/agent-autoloop, for 真人桌宠
// to run (docs/实施计划.md step 12). Only what it needs to run is kept; what was downloaded is checked against the
// pin by hashing those files (GitHub's generated archives are not byte-stable, their contents are).
//
//   node scripts/fetch-autoloop.mjs            fetch and check (does nothing when it is there already)
//   node scripts/fetch-autoloop.mjs --pin      fetch, and write the files' hash into the pin (after changing its commit)
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pinFile = join(root, 'third_party', 'agent-autoloop.json')
const pin = JSON.parse(readFileSync(pinFile, 'utf8'))
const target = join(root, 'body', 'vendor', 'agent-autoloop')
const repin = process.argv.includes('--pin')

/** Every file under the kept paths, sorted, with its SHA-256: one hash for all of them. */
export function contentHash(dir, keep) {
  const files = []
  const walk = (path) => {
    if (statSync(path).isDirectory()) for (const entry of readdirSync(path)) walk(join(path, entry))
    else files.push(relative(dir, path).split('\\').join('/'))
  }
  for (const name of keep) if (existsSync(join(dir, name))) walk(join(dir, name))
  files.sort()
  const hash = createHash('sha256')
  for (const file of files) hash.update(`${file}\0${createHash('sha256').update(readFileSync(join(dir, file))).digest('hex')}\n`)
  return { hash: hash.digest('hex'), files: files.length }
}

const stamp = join(target, '.pinned.json')
if (!repin && existsSync(stamp) && JSON.parse(readFileSync(stamp, 'utf8')).commit === pin.commit) {
  const { hash } = contentHash(target, pin.keep)
  if (hash === pin.contentSha256) {
    console.log(`agent-autoloop ${pin.tag} 已经在 ${target}`)
    process.exit(0)
  }
}

const work = mkdtempSync(join(tmpdir(), 'agent-autoloop-'))
try {
  const url = `https://codeload.github.com/${pin.repo}/tar.gz/${pin.commit}`
  console.log(`下载 agent-autoloop ${pin.tag}（${pin.commit.slice(0, 12)}）`)
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`下载失败（${res.status}）：${url}`)
  const archive = join(work, 'src.tar.gz')
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
  const unpacked = join(work, 'src')
  mkdirSync(unpacked)
  execFileSync(process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xzf', archive, '-C', unpacked, '--strip-components=1'])
  const { hash, files } = contentHash(unpacked, pin.keep)
  if (repin) {
    writeFileSync(pinFile, `${JSON.stringify({ ...pin, contentSha256: hash }, null, 2)}\n`)
    console.log(`写进了钉住的校验值：${hash}（${files} 个文件）`)
  } else if (hash !== pin.contentSha256) {
    throw new Error(`下载的 agent-autoloop 和钉住的不一样（${hash}），没有放进去`)
  }
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  for (const name of pin.keep) if (existsSync(join(unpacked, name))) cpSync(join(unpacked, name), join(target, name), { recursive: true })
  writeFileSync(stamp, `${JSON.stringify({ tag: pin.tag, commit: pin.commit }, null, 2)}\n`)
  console.log(`agent-autoloop ${pin.tag} → ${target}（${files} 个文件）`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
