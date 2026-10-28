/**
 * dsh-her body, main process (M0 spike): one character window in one of three
 * modes, playing a development pack.
 *
 * - overlay: transparent, frameless, always on top; clicks pass through
 *   everywhere except on her (the page reports hits, see renderer/main.ts).
 * - wallpaper: on macOS an Electron `desktop` window (below the icons); on
 *   Windows the window is parented into the desktop's WorkerW layer. If that
 *   fails it falls back to overlay at the bottom of the screen.
 * - window: an ordinary window (debugging, fallback).
 *
 *   npm start -- --mode overlay --pack ~/dsh-her-dev-assets/bg2-alpha
 */

import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BodyConfig, Mode, PackInfo, PackLayout } from '../shared/types.ts'
import { attachToWallpaper } from './wallpaper-win.ts'

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at > 0 ? process.argv[at + 1] : undefined
}

const expand = (p: string) => p.replace(/^~(?=$|[\\/])/, homedir())
const packDir = expand(arg('pack') ?? process.env.DSH_HER_PACK ?? '~/dsh-her-dev-assets/bg2-alpha')
let mode: Mode = (arg('mode') as Mode | undefined) ?? 'overlay'

function loadPack(dir: string): PackInfo {
  const manifest = JSON.parse(readFileSync(join(dir, 'clips.json'), 'utf8')) as { name: string; layout?: PackLayout; clips: Array<{ id: string; file: string }> }
  return {
    name: manifest.name,
    layout: manifest.layout ?? 'opaque',
    clips: manifest.clips.map(c => ({ id: c.id, url: pathToFileURL(join(dir, c.file)).href })),
  }
}

const pack = loadPack(packDir)
let win: BrowserWindow | undefined
let tray: Tray | undefined
/** Where the overlay window was dragged to, kept across mode switches. */
let overlayPos: { x: number; y: number } | undefined

/** Her size on screen: a third of the work area's height, in the clip's 3:4 portrait shape. */
function herSize(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workArea
  const height = Math.round(area.height * 0.42)
  return { width: Math.round(height * 0.75), height }
}

function createWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const area = display.workArea
  const size = herSize()
  const webPreferences = { preload: join(__dirname, 'preload.cjs'), backgroundThrottling: true }
  let created: BrowserWindow
  if (mode === 'window') {
    created = new BrowserWindow({ width: size.width, height: size.height, title: '她', backgroundColor: '#1b1b1f', webPreferences })
  } else if (mode === 'wallpaper' && process.platform === 'darwin') {
    const { x, y, width, height } = display.bounds
    created = new BrowserWindow({ type: 'desktop', x, y, width, height, transparent: true, frame: false, hasShadow: false, enableLargerThanScreen: true, webPreferences })
    created.setVisibleOnAllWorkspaces(true)
  } else if (mode === 'wallpaper') {
    const { x, y, width, height } = display.bounds
    created = new BrowserWindow({ x, y, width, height, frame: false, skipTaskbar: true, show: false, backgroundColor: '#000000', webPreferences })
    const attached = attachToWallpaper(created.getNativeWindowHandle())
    if (!attached.ok) {
      console.warn(`wallpaper layer failed (${attached.reason}); falling back to overlay`)
      created.destroy()
      mode = 'overlay'
      return createWindow()
    }
    created.show()
  } else {
    const pos = overlayPos ?? { x: area.x + area.width - size.width - 24, y: area.y + area.height - size.height }
    created = new BrowserWindow({
      ...pos, ...size,
      transparent: true, frame: false, hasShadow: false, resizable: false, skipTaskbar: true,
      alwaysOnTop: true, backgroundColor: '#00000000', webPreferences,
    })
    created.setAlwaysOnTop(true, 'floating')
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
    created.setIgnoreMouseEvents(true, { forward: true })
  }
  void created.loadFile(join(__dirname, 'index.html'))
  return created
}

function switchMode(next: Mode): void {
  if (next === mode && win !== undefined) return
  mode = next
  const old = win
  win = createWindow()
  old?.destroy()
  refreshTray()
}

function menuTemplate(): Electron.MenuItemConstructorOptions[] {
  const item = (label: string, value: Mode): Electron.MenuItemConstructorOptions =>
    ({ label, type: 'radio', checked: mode === value, click: () => switchMode(value) })
  return [
    { label: `外形：${pack.name}`, enabled: false },
    { type: 'separator' },
    item('浮在最上层', 'overlay'),
    item('住在壁纸里', 'wallpaper'),
    item('普通窗口', 'window'),
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]
}

function refreshTray(): void {
  tray?.setContextMenu(Menu.buildFromTemplate(menuTemplate()))
}

ipcMain.handle('config', (): BodyConfig => ({ mode, platform: process.platform, pack }))
ipcMain.on('hit', (event, onHer: boolean) => {
  BrowserWindow.fromWebContents(event.sender)?.setIgnoreMouseEvents(!onHer, { forward: true })
})
ipcMain.on('drag', (event, delta: { dx: number; dy: number }) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (target === undefined || target === null || mode !== 'overlay') return
  const [x = 0, y = 0] = target.getPosition()
  target.setPosition(Math.round(x + delta.dx), Math.round(y + delta.dy))
  overlayPos = { x: x + delta.dx, y: y + delta.dy }
})
ipcMain.on('menu', (event) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (target !== null) Menu.buildFromTemplate(menuTemplate()).popup({ window: target })
})

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide()
  tray = new Tray(nativeImage.createEmpty())
  if (process.platform === 'darwin') tray.setTitle('她')
  tray.setToolTip('dsh-her')
  refreshTray()
  win = createWindow()
}).catch(error => {
  console.error(error)
  app.quit()
})

app.on('window-all-closed', () => app.quit())
