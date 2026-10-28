/**
 * dsh-her — a desktop companion for DSH.
 *
 * The brain lives here: her own DSH session, voice, memory, and the body
 * protocol server. The body (the Electron desktop app) lives in `body/`.
 * `src/core` never imports DSH; `src/dsh` is the only layer that does.
 */

export const name = 'dsh-her'

export const usage = 'dsh-her: a desktop companion who lives on your real desktop, talks by voice and remembers you. /her talks to her.'

export { Config, type HerConfig } from './dsh/config.ts'
export { apply } from './dsh/plugin.ts'
