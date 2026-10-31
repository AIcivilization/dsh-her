// Merge body-latest.json files of one version (one per platform, as each
// platform's packaging writes it) into one: the release has a single
// body-latest.json listing every platform's zip.
//
//   node scripts/merge-body-manifest.mjs out.json a.json b.json …

import { readFileSync, writeFileSync } from 'node:fs'

const [out, ...inputs] = process.argv.slice(2)
if (out === undefined || inputs.length === 0) throw new Error('usage: merge-body-manifest.mjs out.json a.json [b.json …]')
const manifests = inputs.map(file => JSON.parse(readFileSync(file, 'utf8')))
const versions = new Set(manifests.map(m => m.version))
if (versions.size !== 1) throw new Error(`版本号不一致：${[...versions].join('、')}`)
const merged = { format: 'dsh-her-body@1', version: manifests[0].version, assets: Object.assign({}, ...manifests.map(m => m.assets)) }
writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`)
console.log(`${merged.version}: ${Object.keys(merged.assets).join(', ')}`)
