/**
 * Where 编排 lives: `<home>/stages/stage.json`, and the versions saved
 * before it in `<home>/stages/history/` (the last 20), so a change can be
 * taken back.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseStage, type Stage } from '../pack/stage.ts'

export const KEEP_VERSIONS = 20

export interface StageVersion {
  id: string
  /** ms since epoch. */
  at: number
  name: string
}

export class StageStore {
  private readonly dir: string
  private readonly history: string

  constructor(home: string) {
    this.dir = join(home, 'stages')
    this.history = join(this.dir, 'history')
  }

  private get file(): string {
    return join(this.dir, 'stage.json')
  }

  get exists(): boolean {
    return existsSync(this.file)
  }

  /** The stage saved, with what is wrong in it; nothing saved yet: no stage, no problems. */
  load(): { stage?: Stage; problems: string[] } {
    if (!this.exists) return { problems: [] }
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (error) {
      return { problems: [`编排文件读不了：${(error as Error).message}`] }
    }
    return parseStage(raw)
  }

  /** Save `stage`; the one it replaces becomes a version. */
  save(stage: Stage, at = Date.now()): void {
    mkdirSync(this.history, { recursive: true })
    if (this.exists) {
      renameSync(this.file, join(this.history, `${at}.json`))
      const old = readdirSync(this.history).filter(f => /^\d+\.json$/.test(f)).sort((a, b) => Number.parseInt(b) - Number.parseInt(a))
      for (const file of old.slice(KEEP_VERSIONS)) rmSync(join(this.history, file), { force: true })
    }
    writeFileSync(`${this.file}.tmp`, `${JSON.stringify(stage, null, 2)}\n`)
    renameSync(`${this.file}.tmp`, this.file)
  }

  /** The versions there are, newest first. */
  versions(): StageVersion[] {
    if (!existsSync(this.history)) return []
    return readdirSync(this.history)
      .filter(f => /^\d+\.json$/.test(f))
      .map(f => {
        const at = Number.parseInt(f)
        let name = ''
        try {
          name = String((JSON.parse(readFileSync(join(this.history, f), 'utf8')) as { name?: unknown }).name ?? '')
        } catch {
          // a broken version still shows by its time
        }
        return { id: String(at), at, name }
      })
      .sort((a, b) => b.at - a.at)
  }

  /** Make a version the stage again (what it replaces becomes a version too). */
  restore(id: string, at = Date.now()): void {
    if (!/^\d+$/.test(id) || !existsSync(join(this.history, `${id}.json`))) throw new Error('没有这个版本')
    const { stage, problems } = parseStage(JSON.parse(readFileSync(join(this.history, `${id}.json`), 'utf8')))
    if (stage === undefined) throw new Error(problems[0] ?? '这个版本用不了')
    this.save(stage, at)
  }
}
