import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface HerPaths {
  root: string
  /** brain.json: where the brain listens and its token, for a body the user started by hand. */
  discovery: string
  characters: string
  packs: string
  models: string
  logs: string
}

/** Everything dsh-her writes lives under one home outside DSH (`~` expands). */
export function herPaths(home: string): HerPaths {
  const root = resolve(home.replace(/^~(?=$|[\\/])/, homedir()))
  return {
    root,
    discovery: join(root, 'brain.json'),
    characters: join(root, 'characters'),
    packs: join(root, 'packs'),
    models: join(root, 'models'),
    logs: join(root, 'logs'),
  }
}
