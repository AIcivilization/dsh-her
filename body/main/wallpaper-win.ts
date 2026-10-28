/**
 * Windows wallpaper layer: parent a window into the desktop behind the icons
 * (the "WorkerW" technique wallpaper apps use), through user32 via koffi so no
 * native module has to be compiled.
 *
 * Asking Progman with the undocumented message 0x052C makes Explorer split the
 * desktop into the icon view (SHELLDLL_DefView) and a WorkerW behind it.
 * - Before Windows 11 24H2 that WorkerW is a top-level window right after the
 *   one hosting SHELLDLL_DefView; the window is parented into it.
 * - From 24H2 the WorkerW and SHELLDLL_DefView are children of Progman; the
 *   window is parented into Progman and placed right below the icon view.
 *
 * M0: written from the documented technique, not yet run on a Windows machine.
 */

import { createRequire } from 'node:module'

const SMTO_NORMAL = 0x0000
const SPAWN_WORKERW = 0x052c
const SWP_NOMOVE = 0x0002
const SWP_NOSIZE = 0x0001
const SWP_NOACTIVATE = 0x0010

export type AttachResult = { ok: true; layout: 'workerw' | 'progman' } | { ok: false; reason: string }

export function attachToWallpaper(handle: Buffer): AttachResult {
  if (process.platform !== 'win32') return { ok: false, reason: 'not Windows' }
  try {
    const koffi = createRequire(__filename)('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    const FindWindowW = user32.func('intptr __stdcall FindWindowW(str16 cls, str16 name)')
    const FindWindowExW = user32.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 name)')
    const SendMessageTimeoutW = user32.func('intptr __stdcall SendMessageTimeoutW(intptr hwnd, uint32 msg, uintptr wp, intptr lp, uint32 flags, uint32 timeout, _Out_ uintptr *result)')
    const SetParent = user32.func('intptr __stdcall SetParent(intptr child, intptr parent)')
    const SetWindowPos = user32.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint32 flags)')
    const EnumProc = koffi.proto('bool __stdcall EnumProc(intptr hwnd, intptr lp)')
    const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumProc *cb, intptr lp)')

    const hwnd = handle.byteLength >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))
    const progman = FindWindowW('Progman', null)
    if (!progman) return { ok: false, reason: 'Progman not found' }
    SendMessageTimeoutW(progman, SPAWN_WORKERW, 0xd, 0x1, SMTO_NORMAL, 1000, [0])

    // Windows 11 24H2 and later: everything lives under Progman.
    const childWorker = FindWindowExW(progman, 0, 'WorkerW', null)
    const childIcons = FindWindowExW(progman, 0, 'SHELLDLL_DefView', null)
    if (childWorker && childIcons) {
      SetParent(hwnd, progman)
      SetWindowPos(hwnd, childIcons, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
      return { ok: true, layout: 'progman' }
    }

    // Earlier versions: the WorkerW right after the top-level window hosting the icons.
    let worker: number | bigint = 0
    const callback = koffi.register((top: number | bigint) => {
      if (FindWindowExW(top, 0, 'SHELLDLL_DefView', null)) worker = FindWindowExW(0, top, 'WorkerW', null)
      return true
    }, koffi.pointer(EnumProc))
    try {
      EnumWindows(callback, 0)
    } finally {
      koffi.unregister(callback)
    }
    if (!worker) return { ok: false, reason: 'WorkerW not found' }
    SetParent(hwnd, worker)
    return { ok: true, layout: 'workerw' }
  } catch (error) {
    return { ok: false, reason: (error as Error).message }
  }
}
