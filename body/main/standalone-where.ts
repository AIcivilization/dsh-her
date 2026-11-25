/**
 * 真人桌宠: where the program was started from and with what (main/standalone.ts).
 * Nothing of Electron in here, so it can be tested on its own.
 */

import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A 设计包 under a name of its own, so a double click opens this app (a `.zip` is one too). */
export const DESIGN_FILE = /\.(her|zip)$/i

/** Started by a double click inside a zip (Windows shows a zip as a folder and unpacks the one file into Temp). */
export function insideZip(exe: string = process.execPath, temp: string = tmpdir(), platform: string = process.platform): boolean {
  if (platform !== 'win32') return false
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return norm(exe).startsWith(`${norm(temp)}\\`)
}

/** macOS runs a downloaded app from a random read-only place until it has been moved (App Translocation). */
export const translocated = (exe: string = process.execPath): boolean => exe.includes('/AppTranslocation/')

/** A 设计包 among what the program was started with (a double click on Windows passes its path). */
export const designArg = (argv: readonly string[]): string | undefined => argv.slice(1).find(a => !a.startsWith('-') && DESIGN_FILE.test(a))

/** The 设计包 an installer put beside the program (Windows: in its folder), when there is exactly one. */
export function designBeside(folder: string): string | undefined {
  let found: string[]
  try {
    found = readdirSync(folder).filter(name => /\.her$/i.test(name))
  } catch {
    return undefined
  }
  return found.length === 1 ? join(folder, found[0]!) : undefined
}
