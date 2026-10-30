/**
 * The Model Studio (百炼) API key, never kept in a file: the environment
 * variable `DASHSCOPE_API_KEY`, or on macOS the keychain item the user adds with
 *
 *   security add-generic-password -a dsh-her -s dsh-her-dashscope -w
 *
 * Read on every connection, so a key added later works without restarting DSH.
 */

import { execFile } from 'node:child_process'

export const KEYCHAIN_SERVICE = 'dsh-her-dashscope'

export function readCloudKey(): Promise<string | undefined> {
  const fromEnv = process.env.DASHSCOPE_API_KEY?.trim()
  if (fromEnv) return Promise.resolve(fromEnv)
  if (process.platform !== 'darwin') return Promise.resolve(undefined)
  return new Promise(resolve => {
    execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { timeout: 10_000 }, (error, stdout) => {
      const key = stdout.trim()
      resolve(error === null && key !== '' ? key : undefined)
    })
  })
}
