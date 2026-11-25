/**
 * 真人桌宠 putting a new version in place of itself, or going back to the
 * one before (src/standalone/player-update.ts finds, downloads and checks it).
 *
 * - macOS: the running app is moved aside into `<home>/updates/previous/`
 *   (a running program can be moved), the new one is moved to where it was,
 *   and the program starts again from that place.
 * - Windows: a running program's files are locked, so a small PowerShell
 *   script does it once this program has quit: waits for it to end, copies
 *   the folder aside, puts the new one in, and starts it. If anything fails
 *   it puts the old one back and starts that, and says why in
 *   `<home>/updates/update-error.txt`.
 *
 * Paths reach the script as base64 JSON, never as part of its code.
 */

import { app } from 'electron'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PlayerUpdates } from '../../src/standalone/player-update.ts'
import { DESIGN_FILE, translocated } from './standalone-where.ts'
import { PACKAGED } from './packaged.ts'

/** The app bundle (macOS) or folder (Windows) this program runs from. */
export function runningApp(exe: string = process.execPath, platform: string = process.platform): string {
  // …/真人桌宠.app/Contents/MacOS/Electron, or …\真人桌宠\真人桌宠.exe
  return platform === 'darwin' ? dirname(dirname(dirname(exe))) : dirname(exe)
}

/** Why this program cannot replace itself here, if it cannot. */
export function cannotReplace(): string | undefined {
  if (!PACKAGED) return '开发版不会更新自己（打成包以后才会）'
  if (translocated()) return '请先退出，把「真人桌宠」拖进"应用程序"文件夹，再从那里打开，然后再更新'
  return undefined
}

/** Move a folder, across disks too. */
function move(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  rmSync(to, { recursive: true, force: true })
  try {
    renameSync(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    cpSync(from, to, { recursive: true, verbatimSymlinks: true })
    rmSync(from, { recursive: true, force: true })
  }
}

/** What it starts again with: the same arguments, without a 设计包 it was opened with (that is in already). */
const againArgs = (): string[] => process.argv.slice(1).filter(a => !DESIGN_FILE.test(a))

/**
 * Put `next` (the folder of a new, checked program) in place of the running
 * one, keeping the running one as `version`, and start again.
 */
export function replaceWith(updates: PlayerUpdates, next: string, version: string): void {
  const why = cannotReplace()
  if (why !== undefined) throw new Error(why)
  const current = runningApp()
  const aside = updates.previousSlot()
  if (process.platform === 'darwin') {
    move(current, aside)
    try {
      move(next, current)
    } catch (error) {
      // The new one would not go in: the old one goes back where it was.
      move(aside, current)
      throw new Error(`没能换上新版本：${(error as Error).message}`)
    }
    updates.putAside(version)
    app.relaunch({ args: againArgs() })
    app.exit(0)
    return
  }
  updates.putAside(version)
  const job = {
    pid: process.pid, current, next, aside,
    exe: join(current, '真人桌宠.exe'),
    args: againArgs(),
    errorFile: join(dirname(dirname(aside)), 'update-error.txt'),
  }
  const data = Buffer.from(JSON.stringify(job)).toString('base64')
  const script = `$ErrorActionPreference = 'Stop'
$job = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
Wait-Process -Id $job.pid -Timeout 60 -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
try {
  if (Test-Path -LiteralPath $job.aside) { Remove-Item -LiteralPath $job.aside -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $job.aside) | Out-Null
  Copy-Item -LiteralPath $job.current -Destination $job.aside -Recurse -Force
  Remove-Item -LiteralPath $job.current -Recurse -Force
  Copy-Item -LiteralPath $job.next -Destination $job.current -Recurse -Force
  Remove-Item -LiteralPath $job.next -Recurse -Force -ErrorAction SilentlyContinue
} catch {
  Set-Content -LiteralPath $job.errorFile -Value $_.Exception.Message -Encoding UTF8
  if (-not (Test-Path -LiteralPath $job.exe) -and (Test-Path -LiteralPath $job.aside)) {
    if (Test-Path -LiteralPath $job.current) { Remove-Item -LiteralPath $job.current -Recurse -Force -ErrorAction SilentlyContinue }
    Copy-Item -LiteralPath $job.aside -Destination $job.current -Recurse -Force
  }
}
if ($job.args.Count -gt 0) { Start-Process -FilePath $job.exe -ArgumentList $job.args } else { Start-Process -FilePath $job.exe }`
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  app.quit()
}

/** Go back to the version kept aside (the running one is kept aside in its place). */
export function goBack(updates: PlayerUpdates): void {
  const previous = updates.state().previous
  if (previous === undefined || !existsSync(previous.path)) throw new Error('没有上一版可以退回')
  // Out of the slot first: the running one goes into it.
  const back = join(dirname(dirname(previous.path)), 'back', previous.path.split(/[/\\]/).pop()!)
  move(previous.path, back)
  replaceWith(updates, back, app.getVersion())
}
