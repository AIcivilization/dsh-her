/**
 * Several characters (docs/设置页与编排设计.md §12): each is a folder under
 * `<home>/characters/<cid>/` with her own persona, voice, model, memory,
 * conversations, look and 编排. One is active (`<home>/active.json`); the
 * brain runs for her alone and starts again when another is chosen.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveCharacter, type Character } from '../core/character.ts'

export interface CharacterCard {
  cid: string
  name: string
  /** The first line of who she is, for her card. */
  line: string
  active: boolean
  /** The character of the plugin config: always there, cannot be removed. */
  first: boolean
}

const VALID = /^[a-z0-9][a-z0-9_-]{0,39}$/

export class Characters {
  private readonly home: string
  private readonly dir: string
  /** The character of the plugin config, there before there were several. */
  readonly first: string
  private readonly firstName: string

  constructor(home: string, charactersDir: string, first: { cid: string; name: string }) {
    this.home = home
    this.dir = charactersDir
    this.first = first.cid
    this.firstName = first.name
  }

  private state(): { cid?: string; dress?: string[] } {
    try {
      const value = JSON.parse(readFileSync(join(this.home, 'active.json'), 'utf8')) as { cid?: unknown; dress?: unknown }
      return { ...(typeof value.cid === 'string' ? { cid: value.cid } : {}), ...(Array.isArray(value.dress) ? { dress: value.dress.filter((d): d is string => typeof d === 'string') } : {}) }
    } catch {
      return {}
    }
  }

  private write(state: { cid: string; dress: string[] }): void {
    mkdirSync(this.home, { recursive: true })
    writeFileSync(join(this.home, 'active.json'), `${JSON.stringify(state)}\n`)
  }

  /** After a change of character: whether this body ('desktop' | 'web') still wears the one before. */
  needsDress(body: 'desktop' | 'web'): boolean {
    return this.state().dress?.includes(body) === true
  }

  /** This body now wears what she wears. */
  dressed(body: 'desktop' | 'web'): void {
    const state = this.state()
    if (state.dress?.includes(body) !== true) return
    this.write({ cid: this.active(), dress: state.dress.filter(d => d !== body) })
  }

  /** The one the brain runs for. */
  active(): string {
    const cid = this.state().cid
    if (cid !== undefined && VALID.test(cid) && existsSync(join(this.dir, cid, 'character.json'))) return cid
    return this.first
  }

  list(): CharacterCard[] {
    const active = this.active()
    const ids = existsSync(this.dir) ? readdirSync(this.dir).filter(id => VALID.test(id) && existsSync(join(this.dir, id, 'character.json'))) : []
    // The first one first, the others as they were made (their ids go up with time).
    const order = [this.first, ...ids.filter(id => id !== this.first).sort()]
    return order.map(cid => {
      let name = cid === this.first ? this.firstName : cid
      let line = ''
      try {
        const saved = JSON.parse(readFileSync(join(this.dir, cid, 'character.json'), 'utf8')) as Partial<Character>
        if (typeof saved.name === 'string' && saved.name !== '') name = saved.name
        if (typeof saved.persona === 'string') line = saved.persona.split(/[。\n]/)[0]!.slice(0, 40)
      } catch {
        // not saved yet: her id is her name
      }
      return { cid, name, line, active: cid === active, first: cid === this.first }
    })
  }

  /** A new character, set up enough to talk; returns her id. */
  create(character: Character): string {
    const cid = `c${Date.now().toString(36)}`
    saveCharacter(join(this.dir, cid), { ...character, onboarded: true })
    return cid
  }

  /** Choose who the brain runs for (it starts again for her). */
  use(cid: string): void {
    if (cid !== this.first && (!VALID.test(cid) || !existsSync(join(this.dir, cid, 'character.json')))) throw new Error('没有这个人物')
    this.write({ cid, dress: ['desktop', 'web'] })
  }

  /** Out of the list, into `characters/.removed` (her memory and conversations are kept there). */
  remove(cid: string): void {
    if (cid === this.active()) throw new Error('正在用的人物不能删：先换成另一个')
    if (cid === this.first) throw new Error('第一个人物是插件设置里的，不能删；可以改她的名字和人设')
    if (!VALID.test(cid) || !existsSync(join(this.dir, cid))) throw new Error('没有这个人物')
    mkdirSync(join(this.dir, '.removed'), { recursive: true })
    renameSync(join(this.dir, cid), join(this.dir, '.removed', `${Date.now()}-${cid}`))
  }
}
