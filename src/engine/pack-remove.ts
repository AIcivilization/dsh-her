/**
 * Taking 外形包 and 形象 out of the list (the 形象 page's "移走"): moved into a
 * hidden `.removed` folder beside them, never deleted, so a mistake can be
 * put back by hand. Not what she wears now, not what 编排 made (that goes
 * when 编排 is switched off), not one part of a 形象 on its own.
 */

import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { listLooks } from '../pack/looks.ts'
import type { Look } from '../pack/look.ts'
import { listPacks } from '../pack/settings.ts'

const STAGE_LOOK = 'stage'

/** A look's own packs: the ones it uses that were made for it (a 形象工坊 import names them `<look>-<part>`). Packs it only borrows stay. */
const ownPacks = (look: Look): string[] => [...new Set([look.desk, ...look.scenes.flatMap(s => [s.pack, s.desk])])]
  .filter((id): id is string => id !== undefined && id.startsWith(`${look.id}-`))

function moveAside(dir: string, parent: string, name: string): void {
  const bin = join(parent, '.removed')
  mkdirSync(bin, { recursive: true })
  renameSync(dir, join(bin, `${Date.now()}-${name}`))
}

/**
 * Move a pack (`id`) or a look (`look:<id>`) aside. `active`: what she wears
 * now (a desktop body's, and the page's). The name of what went, and the
 * pack ids that went with it.
 */
export function removePackOrLook(home: string, packsDir: string, id: string, active: ReadonlyArray<string | undefined>): { name: string; gone: string[] } {
  const looks = listLooks(home, packsDir)
  if (id.startsWith('look:')) {
    const lookId = id.slice('look:'.length)
    if (lookId === STAGE_LOOK) throw new Error('这是「编排」生成的：在编排页关掉"让她按这份编排来"，它就没了')
    const look = looks.find(l => l.id === lookId)
    if (look === undefined || !/^[\w-]+$/.test(lookId)) throw new Error('没有这个形象')
    if (active.includes(id)) throw new Error(`她正在用「${look.name}」：先换一个形象，再移走它`)
    moveAside(join(home, 'looks', lookId), join(home, 'looks'), lookId)
    // Its own packs go with it, unless another look uses them too.
    const gone = [id]
    for (const pack of ownPacks(look)) {
      if (looks.some(other => other.id !== lookId && ownPacks(other).includes(pack)) || !existsSync(join(packsDir, pack))) continue
      moveAside(join(packsDir, pack), packsDir, pack)
      gone.push(pack)
    }
    return { name: look.name, gone }
  }
  if (!/^[\w-]+$/.test(id)) throw new Error('没有这个外形包')
  if (id.startsWith(`${STAGE_LOOK}-`)) throw new Error('这是「编排」生成的：在编排页关掉"让她按这份编排来"，它就没了')
  const pack = listPacks(packsDir).find(p => p.packId === id)
  if (pack === undefined) throw new Error('没有这个外形包')
  const owner = looks.find(l => ownPacks(l).includes(id))
  if (owner !== undefined) throw new Error(`这是形象「${owner.name}」的一部分：移走那个形象，它就一起走了`)
  if (active.includes(id)) throw new Error(`她正在用「${pack.name}」：先换一个，再移走它`)
  moveAside(join(packsDir, id), packsDir, id)
  return { name: pack.name, gone: [id] }
}
