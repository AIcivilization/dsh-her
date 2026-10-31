/**
 * Small differences between operating systems the plugin runs on.
 */

import { join } from 'node:path'

/**
 * The system's own bsdtar (macOS, Windows 10+). On Windows it is named by its
 * full path: a `tar` earlier on PATH (Git for Windows ships GNU tar) reads
 * `C:\…` as a remote host and fails.
 */
export function systemTar(platform: string = process.platform): string {
  return platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
}
