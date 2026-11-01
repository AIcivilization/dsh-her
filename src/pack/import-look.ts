/**
 * Importing a 形象工坊 project as a look: each part with clips becomes a pack
 * (`<id>-desk`, `<id>-<scene>`), tied together in `<home>/looks/<id>/look.json`.
 * Runs in whichever has the project's files: the desktop body, or the brain
 * when she lives in the web page.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { importPack, type ImportOptions, type ReportLine } from './import.ts'
import type { Look } from './look.ts'

export interface LookRequest {
  id: string
  name: string
  dir: string
  desk?: string
  default?: string
  scenes: Array<{ id: string; name: string; folder: string; when?: { hours?: string; user?: 'active' | 'idle' } }>
}

export interface LookImportOptions {
  home: string
  packsDir: string
  screen?: ImportOptions['screen']
  onProgress(done: number, total: number, step: string): void
}

/** `look`: it was written (show it). Without one, nothing could be imported; `lines` says why. */
export async function importLook(request: LookRequest, options: LookImportOptions): Promise<{ lines: ReportLine[]; look?: Look }> {
  const parts = [
    ...(request.desk === undefined ? [] : [{ key: 'desk', name: '桌宠', folder: request.desk }]),
    ...request.scenes.map(s => ({ key: s.id, name: s.name, folder: s.folder })),
  ]
  const lines: ReportLine[] = []
  const imported = new Set<string>()
  mkdirSync(options.packsDir, { recursive: true })
  for (const [i, part] of parts.entries()) {
    const result = await importPack(join(request.dir, part.folder), options.packsDir, {
      id: `${request.id}-${part.key}`,
      name: `${request.name}·${part.name}`,
      ...(options.screen === undefined ? {} : { screen: options.screen }),
      onProgress: (done, total, step) => options.onProgress(i * 100 + Math.round((done / total) * 100), parts.length * 100, `${part.name}：${step}`),
    })
    lines.push({ level: result.pack === undefined ? 'error' : 'ok', text: `—— ${part.name} ——` }, ...result.report)
    if (result.pack !== undefined) imported.add(part.key)
  }
  const scenes = request.scenes.filter(s => imported.has(s.id))
  if (scenes.length === 0 && !imported.has('desk')) {
    return { lines: [...lines, { level: 'error', text: '一个部分都没导入成功，看上面的原因' }] }
  }
  // A look with only a desk pet still needs a "scene": the desk pet itself.
  const look: Look = {
    format: 'dsh-her-look@1',
    id: request.id,
    name: request.name,
    ...(imported.has('desk') ? { desk: `${request.id}-desk` } : {}),
    scenes: scenes.length > 0
      ? scenes.map(s => ({ id: s.id, name: s.name, pack: `${request.id}-${s.id}`, ...(s.when === undefined ? {} : { when: s.when }) }))
      : [{ id: 'desk', name: '桌宠', pack: `${request.id}-desk` }],
    default: scenes.some(s => s.id === request.default) ? request.default! : scenes[0]?.id ?? 'desk',
  }
  const lookDir = join(options.home, 'looks', request.id)
  mkdirSync(lookDir, { recursive: true })
  writeFileSync(join(lookDir, 'look.json'), `${JSON.stringify(look, null, 2)}\n`)
  lines.push({ level: 'ok', text: `形象「${request.name}」：${imported.has('desk') ? '桌宠 + ' : ''}${scenes.length} 个场景` })
  return { lines, look }
}
