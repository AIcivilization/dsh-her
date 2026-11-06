#!/usr/bin/env node
/**
 * Make a ready-made look for a release (docs/预设形象.md): one archive, and its
 * entry in presets.json next to it. Attach both (and the picture) to the release;
 * the "她" page offers it from then on. Nothing here goes into the repository.
 *
 *   node scripts/make-preset.mjs --look pmvv3stkn --id xiaohe --name 小禾 --desc "二十五岁的插画师" \
 *     [--home ~/.dsh-her] [--project "<形象工坊 folder>"] [--preview 图.png] [--out release/presets]
 *
 * --project: her small picture for the chat box is taken from there.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'

const arg = name => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}
const expand = path => (path.startsWith('~') ? join(homedir(), path.slice(1)) : resolve(path))
const fail = message => {
  console.error(message)
  process.exit(1)
}

const lookId = arg('look') ?? fail('要 --look <形象 id>（<home>/looks 下的文件夹名）')
const id = arg('id') ?? lookId
const name = arg('name') ?? fail('要 --name <显示的名字>')
if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) fail('--id 只能用小写字母、数字和横线')
const home = expand(arg('home') ?? '~/.dsh-her')
const out = expand(arg('out') ?? 'release/presets')

const look = JSON.parse(readFileSync(join(home, 'looks', lookId, 'look.json'), 'utf8'))
const rename = pack => (pack === lookId ? id : pack.startsWith(`${lookId}-`) ? `${id}${pack.slice(lookId.length)}` : fail(`形象里的 ${pack} 不是这个形象自己的外形包`))
const packs = [...new Set([...look.scenes.map(s => s.pack), ...(look.desk === undefined ? [] : [look.desk])])]

const stage = mkdtempSync(join(tmpdir(), 'her-preset-'))
try {
  for (const pack of packs) {
    const to = join(stage, 'packs', rename(pack))
    cpSync(join(home, 'packs', pack), to, { recursive: true, filter: from => basename(from) !== '.DS_Store' })
    const manifest = join(to, 'pack.json')
    if (existsSync(manifest)) {
      const value = JSON.parse(readFileSync(manifest, 'utf8'))
      if (value.id !== undefined) writeFileSync(manifest, `${JSON.stringify({ ...value, id: rename(pack) }, null, 2)}\n`)
    }
  }
  const lookDir = join(stage, 'looks', id)
  mkdirSync(lookDir, { recursive: true })
  writeFileSync(join(lookDir, 'look.json'), `${JSON.stringify({
    ...look, id, name,
    scenes: look.scenes.map(s => ({ ...s, pack: rename(s.pack) })),
    ...(look.desk === undefined ? {} : { desk: rename(look.desk) }),
  }, null, 2)}\n`)
  const project = arg('project')
  if (project !== undefined) {
    for (const file of ['头像.png', '头像.json', '头像.mp4']) {
      if (existsSync(join(expand(project), file))) cpSync(join(expand(project), file), join(lookDir, file))
    }
  }

  mkdirSync(out, { recursive: true })
  const describe = file => ({ file: basename(file), size: statSync(file).size, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') })
  const archive = join(out, `${id}.tar.gz`)
  // COPYFILE_DISABLE: no macOS "._" files inside.
  execFileSync('tar', ['-czf', archive, '-C', stage, 'packs', 'looks'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  const entry = { id, name, ...(arg('desc') === undefined ? {} : { desc: arg('desc') }), kind: 'look', ...describe(archive) }
  const preview = arg('preview')
  if (preview !== undefined) {
    const copy = join(out, `${id}-preview${extname(preview).toLowerCase()}`)
    cpSync(expand(preview), copy)
    entry.preview = describe(copy)
  }

  const listFile = join(out, 'presets.json')
  const list = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')) : { presets: [] }
  list.presets = [...list.presets.filter(p => p.id !== id), entry]
  writeFileSync(`${listFile}.tmp`, `${JSON.stringify(list, null, 2)}\n`)
  renameSync(`${listFile}.tmp`, listFile)
  console.log(`${archive}（${(entry.size / 1e6).toFixed(1)} MB）`)
  console.log(`把 ${readdirSync(out).join('、')} 传到 release 上，页面就会列出它。`)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
