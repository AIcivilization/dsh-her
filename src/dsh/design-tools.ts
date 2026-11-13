/**
 * "+AI" (docs/设置页与编排设计.md §6): tools for changing 编排, skins and SVG
 * pictures by talking. dsh's model writes text only, and these three are
 * text, so it can change them. Every change can be taken back: 编排 keeps
 * versions, an SVG keeps the one before in `.history`, a skin is a new
 * folder of your own (switching to it stays yours to do, or hers when you ask).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanSvg } from '../pack/material-check.ts'
import { parseStage, type Stage } from '../pack/stage.ts'
import { parseSkin } from '../core/skin.ts'
import type { Library, LibraryRow } from './library.ts'
import { safeSkinCss, type Skins } from './skins.ts'
import type { StageStore } from './stage-store.ts'

export interface DesignDeps {
  home: string
  library: Library
  skins: Skins
  stages: StageStore
  /** After 编排 or the library changed: she shows it (when she plays 编排). */
  applied: () => void
  /** Put a skin on every dsh page and keep it (undefined: dsh as it is). */
  wear?: (id: string | undefined) => void
  /** Where a skin's zip is saved for the user to keep or send (this computer's Downloads). */
  exportDir?: () => string
  log: (entry: Record<string, unknown>) => void
}

/** A tool in DSH's native shape (plain JSON Schema). */
export interface NativeTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>; render: (args: unknown, value: { text: string }) => Array<{ type: 'text'; text: string }> }
  execute: (args: Record<string, unknown>) => Promise<{ text: string }>
}

const textOutput = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  render: (_args: unknown, value: { text: string }) => [{ type: 'text' as const, text: value.text }],
}
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], run: (args: Record<string, unknown>) => string | Promise<string>): NativeTool => ({
  name, description,
  parameters: { type: 'object', properties, required, additionalProperties: false },
  output: textOutput,
  execute: async args => {
    try {
      return { text: await run(args) }
    } catch (error) {
      return { text: `没做成：${(error as Error).message}` }
    }
  },
})
const text = (v: unknown, what: string) => {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`缺少 ${what}`)
  return v.trim()
}
const ROWS = ['avatar', 'desktop', 'pet', 'intro', 'sheet']

/** Keep the SVG as it is now before it is written over, so it can be taken back. */
export function keepSvgVersion(home: string, row: string, file: string, path: string): void {
  const dir = join(home, 'library', '.history', row)
  mkdirSync(dir, { recursive: true })
  copyFileSync(path, join(dir, `${file}.${Date.now()}`))
}

/** Put back the SVG from before the last change; whether there was one. */
export function undoSvg(home: string, library: Library, row: string, name: string): boolean {
  const path = library.path(row, name)
  if (path === undefined || !path.endsWith('.svg')) return false
  const file = path.split(/[/\\]/).pop()!
  const dir = join(home, 'library', '.history', row)
  if (!existsSync(dir)) return false
  const versions = readdirSync(dir).filter(f => f.startsWith(`${file}.`)).sort((a, b) => Number(b.slice(file.length + 1)) - Number(a.slice(file.length + 1)))
  if (versions[0] === undefined) return false
  renameSync(join(dir, versions[0]), path)
  return true
}

/** Write an SVG into the 素材库 (made safe first); the one before it is kept. */
export function writeSvg(deps: DesignDeps, row: string, name: string, svg: string): string {
  if (!ROWS.includes(row)) throw new Error(`没有 ${row} 这一行`)
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(svg)) throw new Error('这不是一张 SVG（要以 <svg 开头）')
  if (svg.length > 400_000) throw new Error('SVG 太大了（超过 400 KB）')
  const { svg: clean, removed } = cleanSvg(svg)
  const target = deps.library.target(row, `${name}.svg`)
  if (target === undefined) throw new Error('名字不能有 / \\ : * ? " < > |，也不能以 . 开头')
  const file = target.split(/[/\\]/).pop()!
  if (existsSync(target)) keepSvgVersion(deps.home, row, file, target)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, clean)
  void deps.library.examine(row as LibraryRow, name).catch(() => undefined)
  deps.applied()
  deps.log({ event: 'design', what: 'svg', row, name })
  return `已经写好 ${row}/${name}.svg${removed ? '（里面能运行的东西去掉了）' : ''}。要退回，在素材库这张图上点"退回上一版"。`
}

/** The tools of the design session: read and change 编排, skins and SVG pictures. */
export function designTools(deps: DesignDeps): NativeTool[] {
  return [
    tool('stage_get', '读现在的编排（JSON）和素材库里每一行有哪些素材。改编排前先读。', {}, [], () => {
      const { stage, problems } = deps.stages.load()
      const library = Object.fromEntries(Object.entries(deps.library.all()).map(([row, list]) => [row, list.map(m => `${m.name}（${m.kind}${m.file.endsWith('.svg') ? '，svg' : ''}）`)]))
      return JSON.stringify({ stage, problems, library }, null, 1)
    }),
    tool('stage_set', '保存改好的整份编排（和 stage_get 读到的格式一样，format 是 dsh-her-stage@1）。旧的会留成一个版本，用户可以在编排页退回。', { stage: { type: 'object', description: '整份编排' } }, ['stage'], args => {
      const { stage, problems } = parseStage(args.stage)
      if (stage === undefined) throw new Error(problems.join('；') || '编排用不了')
      deps.stages.save(stage as Stage)
      deps.applied()
      deps.log({ event: 'design', what: 'stage', scenes: stage.scenes.length })
      return `已保存（之前的留成了一个版本）。${problems.length > 0 ? `要注意：${problems.join('；')}` : ''}`
    }),
    tool('skin_get', '读一套皮肤的 skin.json 和它文件夹里的文件；不给 id 就列出所有皮肤。自带的皮肤（builtin）只能参考，不能改。', { id: { type: 'string' } }, [], args => {
      if (typeof args.id !== 'string' || args.id === '') return JSON.stringify(deps.skins.list().map(e => ({ id: e.skin.id, name: e.skin.name, builtin: e.skin.builtin === true })), null, 1)
      const entry = deps.skins.get(args.id)
      if (entry === undefined) throw new Error('没有这套皮肤')
      if (entry.skin.builtin === true) return JSON.stringify({ skin: entry.skin }, null, 1)
      // Its files too, and the text of its SVGs and CSS, so they can be changed rather than drawn again.
      const dir = join(deps.home, 'skins', args.id)
      const files = existsSync(dir) ? readdirSync(dir).filter(name => !name.startsWith('.')) : []
      const texts = Object.fromEntries(files.filter(name => /\.(svg|css)$/i.test(name)).map(name => [name, readFileSync(join(dir, name), 'utf8').slice(0, 20_000)]))
      return JSON.stringify({ skin: entry.skin, problems: entry.problems, files, texts }, null, 1)
    }),
    tool('skin_set', '写一套皮肤的 skin.json（新的或用户自己的；自带的不能改，换个 id 复制一份）。颜色写 dsh 的 --dsw-… 名字，每个给 light 和 dark；背景图写 background.file（先用 skin_file_set 写好那个文件）。写好后用户在「她 → 皮肤」里点它试，或者让你用 skin_wear 换上。', {
      id: { type: 'string', description: '文件夹名：字母、数字、中文、-' },
      skin: { type: 'object', description: 'skin.json 的内容：name、colors、bar、background、font…' },
    }, ['id', 'skin'], args => {
      const id = text(args.id, 'id')
      const target = deps.skins.target(id, 'skin.json')
      if (target === undefined) throw new Error('这个 id 不行（自带的皮肤不能改，id 只能用字母、数字、中文和 -）')
      const dir = join(target, '..')
      mkdirSync(dir, { recursive: true })
      const files = readdirSync(dir)
      const { skin, problems } = parseSkin(args.skin, id, [...files, 'skin.json'])
      if (skin === undefined) throw new Error(problems.join('；'))
      writeFileSync(target, `${JSON.stringify(args.skin, null, 2)}\n`)
      deps.log({ event: 'design', what: 'skin', id })
      return `写好了皮肤「${skin.name}」（${id}）。${problems.length > 0 ? `没用上的：${problems.join('；')}。` : ''}用户在「她」页面的「皮肤」里点它就能看。`
    }),
    tool('skin_file_set', '往一套皮肤的文件夹里写一个文本文件：SVG 背景或装饰（比如 background.svg），或者一个 .css。SVG 里能运行的东西会去掉；CSS 不能有 url() 和 @import。写完要在 skin.json 里引用它（background.file 或 css）。', {
      id: { type: 'string', description: '皮肤的 id（文件夹名）' },
      file: { type: 'string', description: '文件名，比如 background.svg' },
      text: { type: 'string', description: '文件内容' },
    }, ['id', 'file', 'text'], args => {
      const id = text(args.id, 'id')
      const file = text(args.file, 'file')
      if (!/\.(svg|css)$/i.test(file)) throw new Error('这里只能写 .svg 和 .css')
      const target = deps.skins.target(id, file)
      if (target === undefined) throw new Error('这个 id 或文件名不行（自带的皮肤不能改；只用字母、数字、中文和 -）')
      const body = typeof args.text === 'string' ? args.text : ''
      if (body.length > 400_000) throw new Error('文件太大了（超过 400 KB）')
      mkdirSync(join(target, '..'), { recursive: true })
      if (/\.svg$/i.test(file)) {
        if (!/<svg[\s>]/i.test(body)) throw new Error('这不是一张 SVG')
        writeFileSync(target, cleanSvg(body).svg)
      } else {
        if (!safeSkinCss(body)) throw new Error('CSS 里不能有 url()、@import')
        writeFileSync(target, body)
      }
      deps.log({ event: 'design', what: 'skin-file', id, file })
      return `写好了 ${id}/${file}。记得在 skin.json 里引用它。`
    }),
    ...(deps.wear === undefined ? [] : [tool('skin_wear', '把一套皮肤换上并保存（整个 dsh 立刻换）；不给 id 就换回 dsh 原样。用户明确说要换上时才用。', { id: { type: 'string' } }, [], args => {
      const id = typeof args.id === 'string' && args.id !== '' ? args.id : undefined
      if (id !== undefined && deps.skins.get(id) === undefined) throw new Error('没有这套皮肤')
      deps.wear!(id)
      deps.log({ event: 'design', what: 'skin-wear', id: id ?? null })
      return id === undefined ? '换回了 dsh 原样。' : `换上并保存了「${deps.skins.get(id)?.skin.name ?? id}」，每个 dsh 页面几秒内都会换。不喜欢就在「她 → 皮肤」里换回去。`
    })]),
    tool('skin_export', '把一套皮肤打成 zip，存到这台电脑的"下载"文件夹（用户要下载、要发给别人时用）。别人在「她 → 皮肤」里点"上传 zip"就能用。把存好的位置原样告诉用户。', { id: { type: 'string' } }, ['id'], args => {
      const id = text(args.id, 'id')
      const entry = deps.skins.get(id)
      if (entry === undefined) throw new Error('没有这套皮肤')
      if (entry.skin.builtin === true) throw new Error('自带的皮肤不用下载')
      const dir = deps.exportDir?.() ?? join(deps.home, 'exports')
      mkdirSync(dir, { recursive: true })
      const base = entry.skin.name.replace(/[/\\:*?"<>|]/g, '').trim() || id
      let path = join(dir, `${base}.zip`)
      for (let n = 2; existsSync(path); n++) path = join(dir, `${base}-${n}.zip`)
      writeFileSync(path, deps.skins.zip(id))
      deps.log({ event: 'design', what: 'skin-export', id })
      return `存好了：${path}。也可以在「她 → 皮肤」里选中「${entry.skin.name}」，点"下载"。`
    }),
    tool('svg_get', '读素材库里的一张 SVG（头像、宠物等）。改颜色、改部件前先读，找到对应的 <g id="衣服"> 之类的部分。', { row: { type: 'string', enum: ROWS }, name: { type: 'string' } }, ['row', 'name'], args => {
      const path = deps.library.path(text(args.row, 'row'), text(args.name, 'name'))
      if (path === undefined || !path.endsWith('.svg')) throw new Error('素材库里没有这张 SVG')
      return readFileSync(path, 'utf8')
    }),
    tool('svg_set', '把改好的 SVG 写回素材库（同名就替换，之前的留着可以退回；新名字就是新的一张）。只改要改的部分，其他照原样。', { row: { type: 'string', enum: ROWS }, name: { type: 'string' }, svg: { type: 'string' } }, ['row', 'name', 'svg'], args => writeSvg(deps, text(args.row, 'row'), text(args.name, 'name'), text(args.svg, 'svg'))),
  ]
}

/** Her own few (§6.4): she can put on a skin, or change an SVG of herself, when you ask. */
export function herLookTools(deps: DesignDeps & { wear: (id: string | undefined) => void }): NativeTool[] {
  const all = designTools(deps)
  return [
    tool('wear_skin', '换一套皮肤（整个 dsh 的样子），对方让你换时用；不给 id 就是换回 dsh 原样。能用的：先用 skin_get 看。', { id: { type: 'string' } }, [], args => {
      const id = typeof args.id === 'string' && args.id !== '' ? args.id : undefined
      deps.wear(id)
      return id === undefined ? '换回了 dsh 原样。' : `换上了「${deps.skins.get(id)?.skin.name ?? id}」。对方不喜欢可以在「皮肤」里换回去。`
    }),
    ...all.filter(t => t.name === 'skin_get' || t.name === 'svg_get' || t.name === 'svg_set'),
  ]
}
