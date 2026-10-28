/**
 * Start the body app when no body is connected. M1 knows only the development
 * layout (the repository's `body/` next to this package, built with
 * `npm run build` there); the installed app comes with the wizard in M5.
 *
 * The Electron binary is found through `node_modules/electron/path.txt`, not
 * `require('electron')`: inside the DSH desktop app that require returns
 * Electron's API instead of the binary path. The body is detached so it
 * outlives DSH (she sleeps until DSH is back), and ELECTRON_RUN_AS_NODE is
 * removed or the body would start as plain Node.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LaunchPlan {
  binary: string
  args: string[]
  cwd: string
}

/** The development body next to this package, if it is built. */
export function findDevBody(packageRoot = fileURLToPath(new URL('../../', import.meta.url))): LaunchPlan | { missing: string } {
  const bodyDir = join(packageRoot, 'body')
  const pathFile = join(bodyDir, 'node_modules', 'electron', 'path.txt')
  if (!existsSync(join(bodyDir, 'dist', 'main.cjs'))) return { missing: `${bodyDir}/dist（在 body/ 里运行 npm run build）` }
  if (!existsSync(pathFile)) return { missing: `${pathFile}（在 body/ 里运行 npm install）` }
  const binary = join(bodyDir, 'node_modules', 'electron', 'dist', readFileSync(pathFile, 'utf8').trim())
  return { binary, args: [bodyDir], cwd: bodyDir }
}

/** A body that is running but not connected yet (still backing off) has its pid in `<home>/body.json`. */
export function bodyRunning(home: string): boolean {
  try {
    const { pid } = JSON.parse(readFileSync(join(home, 'body.json'), 'utf8')) as { pid?: number }
    if (typeof pid !== 'number') return false
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: alive, owned by someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function launchBody(plan: LaunchPlan, env: { url: string; token: string; home: string; pack: string }): number | undefined {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, DSH_HER_URL: env.url, DSH_HER_TOKEN: env.token, DSH_HER_HOME: env.home }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const args = env.pack === '' ? plan.args : [...plan.args, '--pack', env.pack]
  const child = spawn(plan.binary, args, { cwd: plan.cwd, env: childEnv, detached: true, stdio: 'ignore' })
  child.unref()
  return child.pid
}
