/**
 * Run the small brain by itself, for development and checks:
 *
 *   node src/standalone/main.ts --home ~/.zhenren-dev [--port 38200] [--install some-design.zip]
 *
 * In 真人桌宠 the body app starts it inside itself (docs/实施计划.md, step 4);
 * this is the same brain on a command line. A body started with
 * DSH_HER_HOME pointing at the same home finds it through `brain.json`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PetBrain } from './pet-brain.ts'

const args = process.argv.slice(2)
const option = (flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const home = option('--home')
if (home === undefined) {
  console.error('用法：node src/standalone/main.ts --home <文件夹> [--port <端口>] [--install <设计包.zip>] [--ffmpeg <ffmpeg>]')
  process.exit(2)
}
const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string }
const port = option('--port')
const ffmpeg = option('--ffmpeg')
const brain = new PetBrain({
  home, version,
  ...(port === undefined ? {} : { preferredPort: Number(port) }),
  ...(ffmpeg === undefined ? {} : { ffmpeg }),
  log: entry => console.log(JSON.stringify(entry)),
})
const design = option('--install')
if (design !== undefined) {
  const preview = brain.previewDesign(readFileSync(design))
  console.log(`设计包：${preview.manifest.name} · ${preview.manifest.author} · 许可 ${preview.manifest.license}`)
  for (const problem of preview.problems) console.log(`  注意：${problem}`)
  const { record, notes } = await brain.installDesign(preview.token)
  console.log(`装好了：${record.character === undefined ? '（没有人物）' : `人物「${record.character}」`}，${record.materials} 个素材`)
  for (const note of notes) console.log(`  ${note}`)
}
const discovery = await brain.start()
const state = brain.state()
console.log(`小大脑在 ${discovery.url}，${state.empty ? '还没有人物（用 --install 装一个设计包）' : `现在是「${state.character!.name}」`}`)
for (const note of state.stage.notes) console.log(`  编排：${note}`)
const stop = () => void brain.stop().then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
