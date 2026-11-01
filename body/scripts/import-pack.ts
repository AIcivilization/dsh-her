/**
 * Import a folder of clips as an appearance pack, from the command line.
 *
 *   node body/scripts/import-pack.ts <source dir> [--packs ~/.dsh-her/packs] [--id id] [--name 名字] [--screen 1512x982@2] [--no-loop]
 *
 * `--screen` checks sizes against that screen (logical size @ scale), as an import inside the app does.
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { importPack } from '../../src/pack/import.ts'

const args = process.argv.slice(2)
const option = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const expand = (p: string) => p.replace(/^~(?=$|[\\/])/, homedir())
const source = args[0]
if (source === undefined || source.startsWith('--')) {
  console.error('usage: node body/scripts/import-pack.ts <source dir> [--packs dir] [--id id] [--name name] [--screen WxH@scale] [--no-loop]')
  process.exit(1)
}
const packs = expand(option('--packs') ?? '~/.dsh-her/packs')
mkdirSync(packs, { recursive: true })
const id = option('--id')
const name = option('--name')
const screenArg = /^(\d+)x(\d+)@([\d.]+)$/.exec(option('--screen') ?? '')
const started = Date.now()
const result = await importPack(expand(source), packs, {
  ...(id === undefined ? {} : { id }),
  ...(name === undefined ? {} : { name }),
  ...(screenArg === null ? {} : { screen: { width: Number(screenArg[1]), height: Number(screenArg[2]), scale: Number(screenArg[3]) } }),
  loop: !args.includes('--no-loop'),
  onProgress: (done, total, step) => process.stdout.write(`\r[${done}/${total}] ${step}`.padEnd(60)),
})
process.stdout.write('\n')
for (const line of result.report) console.log(`${line.level === 'ok' ? '✅' : line.level === 'warn' ? '⚠️ ' : '❌'} ${line.text}`)
console.log(result.dir === undefined ? '导入失败' : `→ ${result.dir}（${((Date.now() - started) / 1000).toFixed(1)} 秒）`)
process.exit(result.dir === undefined ? 1 : 0)
