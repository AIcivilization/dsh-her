// Before publishing to npm (prepack): put this version's GitHub release
// manifest (body-latest.json) into the package as lib/body-release.json, so
// the plugin knows the body's checksums even where GitHub cannot be reached
// (src/dsh/body-install.ts bundledRelease). The GitHub release must exist
// first; publishing without it fails here.

import { readFileSync, writeFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const base = `https://github.com/AIcivilization/dsh-her/releases/download/v${version}/`
const res = await fetch(`${base}body-latest.json`, { redirect: 'follow', signal: AbortSignal.timeout(60_000) })
if (!res.ok) throw new Error(`GitHub 上还没有 v${version} 的发布（${res.status}）：先发布 GitHub Release，再发 npm`)
const manifest = await res.json()
if (manifest.version === undefined || typeof manifest.assets !== 'object') throw new Error('body-latest.json 不对')
writeFileSync('lib/body-release.json', `${JSON.stringify({ base, manifest }, null, 2)}\n`)
console.log(`lib/body-release.json: body ${manifest.version} (${Object.keys(manifest.assets).join(', ')})`)
