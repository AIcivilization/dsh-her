/**
 * dsh-her body, main process: one character window in one of three modes,
 * connected to the brain (the dsh-her plugin) over the body protocol.
 *
 * - overlay: transparent, frameless, always on top; clicks pass through
 *   everywhere except on her (the page reports hits, see renderer/main.ts).
 *   The window has room above her for the speech bubble.
 * - wallpaper: on macOS an Electron `desktop` window (below the icons); on
 *   Windows the window is parented into the desktop's WorkerW layer. If that
 *   fails it falls back to overlay. A wallpaper window takes no input, so the
 *   shortcut brings her out to overlay first.
 * - window: an ordinary window (debugging, fallback).
 *
 * Talking: the shortcut listens for one utterance (cutting her off if she is
 * talking); "always listening" in the menu keeps the microphone open. Double-
 * click her (or the menu) to type instead.
 *
 * Only one body runs at a time; a second start just quits.
 *
 *   npm start -- --mode overlay --pack ~/dsh-her-dev-assets/bg2-stacked [--home ~/.dsh-her-dev] [--her-debug] [--her-mute]
 */

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, session, systemPreferences, Tray } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BodyMessage, BrainMessage } from '../../src/protocol/index.ts'
import type { BodyConfig, LinkStatus, MicMode, Mode } from '../shared/types.ts'
import { BrainLink } from './brain-link.ts'
import { loadPack, summarize } from './pack/load.ts'
import { attachToWallpaper } from './wallpaper-win.ts'

/** ⌃⌥Space / Ctrl+Alt+Space: talk to her. Alt+Space alone is taken by Windows' window menu. */
const TALK_SHORTCUT = 'Control+Alt+Space'
/** Room above her for the bubble, as a share of her height. */
const BUBBLE_ROOM = 0.38

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at > 0 ? process.argv[at + 1] : undefined
}

const expand = (p: string) => p.replace(/^~(?=$|[\\/])/, homedir())
const packDir = expand(arg('pack') ?? process.env.DSH_HER_PACK ?? '~/dsh-her-dev-assets/bg2-stacked')
const home = arg('home') ?? process.env.DSH_HER_HOME ?? '~/.dsh-her'
const debug = process.argv.includes('--her-debug')
const mute = process.argv.includes('--her-mute')
/** From the brain's welcome; the menu can switch it. */
let micMode: MicMode = 'push-to-talk'

// Her voice must play without a click first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const pack = loadPack(packDir)
/** A scene pack belongs in the wallpaper; she alone floats on top. */
let mode: Mode = (arg('mode') as Mode | undefined) ?? (pack.layer === 'scene' ? 'wallpaper' : 'overlay')
let win: BrowserWindow | undefined
let tray: Tray | undefined
let link: BrainLink | undefined
let status: { status: LinkStatus; detail?: string } = { status: 'connecting' }
let cid: string | undefined
/** Where the overlay window was dragged to, kept across mode switches. */
let overlayPos: { x: number; y: number } | undefined

/** Her size on screen: 42% of the work area's height, in the clip's 3:4 portrait shape. */
function herSize(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workArea
  const height = Math.round(area.height * 0.42)
  return { width: Math.round(height * 0.75), height }
}

function createWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const area = display.workArea
  const her = herSize()
  const webPreferences = { preload: join(__dirname, 'preload.cjs'), backgroundThrottling: true }
  let created: BrowserWindow
  if (mode === 'window') {
    created = new BrowserWindow({ width: Math.max(her.width, 340), height: Math.round(her.height * (1 + BUBBLE_ROOM)), title: '她', backgroundColor: '#1b1b1f', webPreferences })
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
    const size = { width: Math.max(her.width, 340), height: Math.round(her.height * (1 + BUBBLE_ROOM)) }
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

function statusLabel(): string {
  switch (status.status) {
    case 'connected': return '已连上 dsh'
    case 'connecting': return '正在连 dsh…'
    case 'rejected': return `dsh 拒绝了连接：${status.detail ?? ''}`
    default: return `在等 dsh${status.detail === undefined ? '' : `（${status.detail}）`}`
  }
}

function menuTemplate(): Electron.MenuItemConstructorOptions[] {
  const item = (label: string, value: Mode): Electron.MenuItemConstructorOptions =>
    ({ label, type: 'radio', checked: mode === value, click: () => switchMode(value) })
  return [
    { label: statusLabel(), enabled: false },
    { label: `外形：${pack.name}`, enabled: false },
    { type: 'separator' },
    { label: `和她说话（${process.platform === 'darwin' ? '⌃⌥空格' : 'Ctrl+Alt+空格'}）`, click: talk },
    { label: '打字和她说', click: showInput },
    {
      label: '一直在听', type: 'checkbox', checked: micMode === 'always',
      click: item => {
        micMode = item.checked ? 'always' : 'push-to-talk'
        toPage('mic-mode', micMode)
        refreshTray()
      },
    },
    { type: 'separator' },
    item('浮在最上层', 'overlay'),
    item('住在壁纸里', 'wallpaper'),
    item('普通窗口', 'window'),
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]
}

function refreshTray(): void {
  if (tray === undefined) return
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()))
  if (process.platform === 'darwin') tray.setTitle(status.status === 'connected' ? '她' : '她·睡')
  tray.setToolTip(`dsh-her · ${statusLabel()}`)
}

/** Send to her page; a wallpaper window takes no keys, so for typing she comes out first. */
function toHer(channel: 'show-input' | 'talk'): void {
  if (mode === 'wallpaper' && channel === 'show-input') {
    switchMode('overlay')
    win?.webContents.once('did-finish-load', () => win?.webContents.send(channel))
    return
  }
  win?.webContents.send(channel)
}

function showInput(): void {
  toHer('show-input')
}

function talk(): void {
  toHer('talk')
}

function toPage(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, ...args)
}

ipcMain.handle('config', (): BodyConfig => ({ mode, platform: process.platform, pack, her: herSize(), debug, mute }))
ipcMain.handle('say', (_event, text: string) => link?.send({ t: 'user.text', ...(cid === undefined ? {} : { cid }), text }) ?? false)
ipcMain.handle('send', (_event, message: BodyMessage) => {
  const withCid = 'cid' in message && typeof message.cid === 'string' && message.cid !== '' ? message : { ...message, cid: cid ?? '' }
  return link?.send(withCid as BodyMessage) ?? false
})
ipcMain.handle('utterance', (_event, uttId: string, pcm: ArrayBuffer, durationMs: number) =>
  link?.sendWithAudio(new Uint8Array(pcm), stream => ({ t: 'user.utterance', ...(cid === undefined ? {} : { cid }), uttId, format: 'pcm16@16k', durationMs, stream })) ?? false)
ipcMain.on('hit', (event, onHer: boolean) => {
  BrowserWindow.fromWebContents(event.sender)?.setIgnoreMouseEvents(!onHer, { forward: true })
})
ipcMain.on('interactive', (event, on: boolean) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (target === null || mode !== 'overlay') return
  target.setIgnoreMouseEvents(!on, { forward: true })
  if (on) {
    if (process.platform === 'darwin') app.focus({ steal: true })
    target.focus()
  }
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

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showInput())
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.hide()
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'media'))
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
      await systemPreferences.askForMediaAccess('microphone').catch(() => false)
    }
    tray = new Tray(nativeImage.createEmpty())
    refreshTray()
    win = createWindow()
    globalShortcut.register(TALK_SHORTCUT, talk)
    link = new BrainLink({
      home,
      hello: () => ({
        body: { kind: 'video', app: 'dsh-her-body', version: app.getVersion(), os: `${process.platform}-${process.arch}` },
        caps: {
          audioOut: ['wav'],
          micIn: { formats: ['pcm16@16k'], vad: 'energy' },
          asrLocal: false,
          ttsLocal: [],
          modes: ['overlay', 'wallpaper', 'window'],
          screens: screen.getAllDisplays().map(d => ({ id: d.id, w: d.size.width, h: d.size.height, scale: d.scaleFactor })),
        },
        packs: [summarize(pack)],
      }),
      onMessage: (message: BrainMessage, audio?: Uint8Array) => {
        if (message.t === 'welcome') {
          cid = message.characters[0]?.cid
          micMode = message.config.mic
          refreshTray()
        }
        toPage('brain', message, audio)
      },
      onStatus: (next, detail) => {
        status = detail === undefined ? { status: next } : { status: next, detail }
        refreshTray()
        toPage('status', next, detail)
      },
    })
    link.start()
  }).catch(error => {
    console.error(error)
    app.quit()
  })
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  link?.stop()
})
app.on('window-all-closed', () => app.quit())
