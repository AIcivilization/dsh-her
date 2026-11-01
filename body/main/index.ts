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
 * Only one body runs per home (`--home`); a second start just quits.
 *
 *   npm start -- --mode overlay --pack ~/dsh-her-dev-assets/bg2-stacked [--home ~/.dsh-her-dev] [--her-debug] [--her-mute]
 */

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, session, systemPreferences, Tray } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { BodyMessage, BrainMessage, PackSummary } from '../../src/protocol/index.ts'
import { pickScene, shouldSwitch, type Look, type LookPrefs } from '../../src/pack/look.ts'
import type { BodyConfig, LinkStatus, MicMode, Mode, PackInfo, ScreenInfo } from '../shared/types.ts'
import { BrainLink } from './brain-link.ts'
import { idleLookSummary, listLooks, lookPackId, lookSummary, lookView } from '../../src/pack/looks.ts'
import { importPack } from '../../src/pack/import.ts'
import { clipsView, loadPack, saveClipUses, summarize } from '../../src/pack/load.ts'
import { pickScenePhoto, saveScene, scenePhotoIn } from './scene-maker.ts'
import { hasFfmpeg, useFfmpeg } from '../../src/pack/media.ts'
import { listPacks, loadSettings, saveSettings, type BodySettings } from '../../src/pack/settings.ts'
import { iconPixels } from '../shared/icon.ts'
import { importLook } from '../../src/pack/import-look.ts'
import { attachToWallpaper } from './wallpaper-win.ts'

/** ⌃⌥Space / Ctrl+Alt+Space: talk to her. Alt+Space alone is taken by Windows' window menu. */
const TALK_SHORTCUT = 'Control+Alt+Space'
/** Room above her for the bubble, as a share of her height. */
const BUBBLE_ROOM = 0.38
/** A scene change fades out this long before the next scene comes in. */
const FADE_MS = 700
/** Within this long of anything said (by either of you), she does not move to another scene. */
const TALK_QUIET_MS = 60_000

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at > 0 ? process.argv[at + 1] : undefined
}

const expand = (p: string) => p.replace(/^~(?=$|[\\/])/, homedir())
const home = arg('home') ?? process.env.DSH_HER_HOME ?? '~/.dsh-her'
const packsDir = join(expand(home), 'packs')
let settings: BodySettings = loadSettings(expand(home))
/** The pack chosen on the "她" page wins; `--pack` is only the first default. */
const packDir = settings.pack !== undefined && listPacks(packsDir).some(p => p.packId === settings.pack)
  ? join(packsDir, settings.pack)
  : expand(arg('pack') ?? process.env.DSH_HER_PACK ?? '~/dsh-her-dev-assets/bg2-stacked')
const debug = process.argv.includes('--her-debug')
const mute = process.argv.includes('--her-mute')
/** From the brain's welcome; the menu can switch it. */
let micMode: MicMode = 'push-to-talk'

// Her voice must play without a click first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

/** A scene pack belongs in the wallpaper; she alone floats on top. */
const layerMode = (p: { layer?: string }): Mode => (p.layer === 'scene' ? 'wallpaper' : 'overlay')
/** A mode the user chose (argument or menu/page) wins over the pack's default. */
const chosenMode = (): Mode | undefined => (arg('mode') as Mode | undefined) ?? settings.mode

/** Looks: one character in several scenes (docs/形象工坊与多场景.md). When one is chosen, it decides the pack. */
let looks: Look[] = listLooks(expand(home), packsDir)
let look: Look | undefined = settings.look === undefined ? undefined : looks.find(l => l.id === settings.look)
const lookPrefs = (): LookPrefs => (look === undefined ? {} : settings.looks?.[look.id] ?? {})
function setLookPrefs(next: LookPrefs): void {
  if (look === undefined) return
  settings = { ...settings, looks: { ...settings.looks, [look.id]: next } }
  saveSettings(expand(home), settings)
}
/** The pack a look shows: the desk pet when she floats on top (if it has one), else the scene she is in. */
function lookPack(l: Look, m: Mode): string {
  if (m === 'overlay' && l.desk !== undefined) return l.desk
  const scene = settings.looks?.[l.id]?.scene
  return (l.scenes.find(s => s.id === scene) ?? l.scenes.find(s => s.id === l.default)!).pack
}
/** The scene the rules want now. */
const wantedScene = (l: Look) => pickScene(l, { hour: new Date().getHours(), idleSeconds: powerMonitor.getSystemIdleTime() }, settings.looks?.[l.id]?.off)

/**
 * Nothing to show yet (a new install has no looks, and the default pack is a
 * development folder): she appears as a drawn placeholder until one is
 * imported, and talking works as usual.
 */
const NO_PACK: PackInfo = { id: '', name: '还没有外形', layer: 'overlay', layout: 'opaque', start: 'stand', clips: [], macros: [], aspect: 0.75 }
function loadOrNothing(dir: string, aspect?: number): PackInfo {
  try {
    return loadPack(dir, aspect)
  } catch (error) {
    console.warn(`no pack at ${dir} (${(error as Error).message}); showing the placeholder`)
    return NO_PACK
  }
}

let packPath = look === undefined ? packDir : join(packsDir, lookPack(look, chosenMode() ?? 'wallpaper'))
let pack = loadOrNothing(packPath)
let mode: Mode = chosenMode() ?? (look === undefined ? layerMode(pack) : 'wallpaper')
/** When either of you last said something: no scene changes mid-conversation. */
let lastTalkAt = 0
let win: BrowserWindow | undefined
let tray: Tray | undefined
let link: BrainLink | undefined
let status: { status: LinkStatus; detail?: string } = { status: 'connecting' }
let cid: string | undefined
/** Where the overlay window was dragged to, kept across mode switches. */
let overlayPos: { x: number; y: number } | undefined

/** Width / height of the main screen: a scene with photos of several shapes shows the closest one. */
const screenAspect = () => {
  const { width, height } = screen.getPrimaryDisplay().size
  return width / height
}

/** Her size on screen: 42% of the screen's height, in her picture's own shape (never wider than 60% of it). */
function herSize(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workArea
  const aspect = pack.aspect ?? 0.75
  let height = Math.round(area.height * 0.42)
  if (height * aspect > area.width * 0.6) height = Math.round((area.width * 0.6) / aspect)
  return { width: Math.round(height * aspect), height }
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
  settings = { ...settings, mode }
  saveSettings(expand(home), settings)
  // A look shows its desk pet on top and its scene elsewhere.
  if (look !== undefined) showLookPack()
  const old = win
  win = createWindow()
  old?.destroy()
  refreshTray()
  reportMode()
  if (look !== undefined) {
    reportPacks()
    reportLook()
  }
}

/** Load the pack the look shows now (for the mode, the scene). */
function showLookPack(): void {
  if (look === undefined) return
  packPath = join(packsDir, lookPack(look, mode))
  pack = loadPack(packPath, screenAspect())
}

/** Show what is chosen again: a fresh window with the pack reloaded (after its layout changed). */
function reshow(): void {
  if (look !== undefined) showLookPack()
  else pack = loadOrNothing(packPath, screenAspect())
  const old = win
  win = createWindow()
  old?.destroy()
  refreshTray()
  reportPacks()
}

/** Every pack and look, for the brain and the menu; looks first. */
function packList(): PackSummary[] {
  looks = listLooks(expand(home), packsDir)
  const own = looks.map(l => (l.id === look?.id ? lookSummary(l, pack, lookPrefs()) : idleLookSummary(l, packsDir)))
  // The packs a 形象工坊 import made for a look (`<look>-<part>`) are shown as that look only.
  const parts = (id: string) => looks.some(l => id.startsWith(`${l.id}-`))
  return [...own.filter((p): p is PackSummary => p !== undefined), ...listPacks(packsDir).filter(p => !parts(p.packId))]
}

function reportLook(): void {
  link?.send({ t: 'look.state', look: look === undefined ? null : lookView(look, lookPrefs()) })
}

/** Show a look: its scene for now (kept from last time unless the rules may move her), in the wallpaper unless a mode was chosen. */
function useLook(id: string): void {
  looks = listLooks(expand(home), packsDir)
  const next = looks.find(l => l.id === id)
  if (next === undefined) throw new Error(`没有这个形象：${id}`)
  look = next
  const { pack: _pack, ...rest } = settings
  settings = { ...rest, look: id }
  const prefs = lookPrefs()
  const keep = prefs.scene !== undefined && next.scenes.some(s => s.id === prefs.scene) && (prefs.locked === true || prefs.auto === false)
  setLookPrefs({ ...prefs, scene: keep ? prefs.scene : wantedScene(next), switchedAt: Date.now() })
  const nextMode = chosenMode() ?? 'wallpaper'
  if (nextMode !== mode) {
    mode = nextMode
    reportMode()
  }
  showLookPack()
  const old = win
  win = createWindow()
  old?.destroy()
  refreshTray()
  reportPacks()
  reportLook()
}

/** Move her to another scene of the look: fade out, then the scene's pack comes in. False when there is no such scene. */
function switchScene(sceneId: string): boolean {
  if (look === undefined || !look.scenes.some(s => s.id === sceneId)) return false
  const prefs = lookPrefs()
  if (prefs.scene === sceneId) return true
  setLookPrefs({ ...prefs, scene: sceneId, switchedAt: Date.now() })
  const nextPath = join(packsDir, lookPack(look, mode))
  if (nextPath === packPath) {
    // Floating on top as the desk pet: the scene changed, what shows did not.
    refreshTray()
    reportPacks()
    reportLook()
    return true
  }
  win?.webContents.send('fade-out')
  setTimeout(() => {
    showLookPack()
    if (mode === 'wallpaper' && win !== undefined) win.webContents.reload()
    else {
      // Another scene may have another shape: a window of its own.
      const old = win
      win = createWindow()
      old?.destroy()
    }
    refreshTray()
    reportPacks()
    reportLook()
  }, FADE_MS)
  return true
}

/** Once a minute: move to the scene the rules want, if she may. */
function lookTick(): void {
  if (look === undefined) return
  const prefs = lookPrefs()
  const wanted = wantedScene(look)
  if (shouldSwitch(look, prefs, prefs.scene ?? look.default, wanted, Date.now(), Date.now() - lastTalkAt < TALK_QUIET_MS)) switchScene(wanted)
}

/** Changes from the "她" page or the menu: switching on or off, held, scenes left out, or go somewhere now. */
function setLook(change: { auto?: boolean; locked?: boolean; go?: string; on?: Record<string, boolean> }): void {
  if (look === undefined) return
  const prefs = { ...lookPrefs() }
  if (change.auto !== undefined) prefs.auto = change.auto
  if (change.locked !== undefined) prefs.locked = change.locked
  if (change.on !== undefined) {
    const off = new Set(prefs.off ?? [])
    for (const [id, on] of Object.entries(change.on)) {
      if (on) off.delete(id)
      else off.add(id)
    }
    prefs.off = [...off]
  }
  setLookPrefs(prefs)
  if (change.go === undefined || !switchScene(change.go)) {
    refreshTray()
    reportPacks()
    reportLook()
  }
}

/** Her scene actions, from the brain: move, stay, or switch on her own again. */
function sceneAct(action: string): boolean {
  if (look === undefined) return false
  if (action === 'scene_stay') setLook({ locked: true })
  else if (action === 'scene_auto') setLook({ locked: false, auto: true })
  else return switchScene(action.slice('scene_'.length))
  return true
}

function reportMode(): void {
  link?.send({ t: 'mode.changed', cid: cid ?? '', mode })
}

/** Tell the brain which packs (and looks) there are and which one is on screen. */
function reportPacks(): void {
  link?.send({ t: 'pack.list', packs: packList(), ...(look === undefined && pack.id === '' ? {} : { active: look === undefined ? pack.id : lookPackId(look) }) })
}

/** Show another imported pack (or a look, `look:<id>`): reload the window with it, and remember the choice. */
function usePack(packId: string): void {
  if (packId.startsWith('look:')) {
    useLook(packId.slice('look:'.length))
    return
  }
  const leftLook = look !== undefined
  look = undefined
  packPath = join(packsDir, packId)
  pack = loadPack(packPath, screenAspect())
  const { look: _look, ...rest } = settings
  settings = { ...rest, pack: packId }
  saveSettings(expand(home), settings)
  const nextMode = chosenMode() ?? layerMode(pack)
  if (nextMode !== mode) {
    mode = nextMode
    reportMode()
  }
  const old = win
  win = createWindow()
  old?.destroy()
  refreshTray()
  reportPacks()
  if (leftLook) reportLook()
}

/** Let the user pick a folder here, import it, show it. Progress and the report go to the brain. */
/** The brain's ffmpeg, when this body has none it can run (development: no copy of its own, a bare PATH). */
async function ffmpegFromBrain(path: string | undefined): Promise<void> {
  if (path !== undefined && !await hasFfmpeg()) useFfmpeg(path)
}

async function pickAndImport(ffmpeg?: string): Promise<void> {
  await ffmpegFromBrain(ffmpeg)
  const send = (message: BodyMessage) => link?.send(message)
  if (process.platform === 'darwin') app.focus({ steal: true })
  const choice = await dialog.showOpenDialog({ title: '选择素材文件夹', buttonLabel: '导入', properties: ['openDirectory'] })
  const dir = choice.filePaths[0]
  if (choice.canceled || dir === undefined) {
    send({ t: 'pack.report', id: '', ok: false, lines: [{ level: 'warn', text: '没有选择文件夹' }] })
    return
  }
  mkdirSync(packsDir, { recursive: true })
  const { size, scaleFactor } = screen.getPrimaryDisplay()
  const result = await importPack(dir, packsDir, {
    screen: { width: size.width, height: size.height, scale: scaleFactor },
    onProgress: (done, total, step) => send({ t: 'pack.progress', id: '', done, total, step }),
  })
  const ok = result.pack !== undefined
  send({ t: 'pack.report', id: '', ok, ...(ok ? { pack: summarize(loadPack(join(packsDir, result.pack!.id))) } : {}), lines: result.report })
  if (ok) usePack(result.pack!.id)
  else reportPacks()
}

/**
 * Import a 形象工坊 project: each part (desk pet, scenes) that has clips
 * becomes a pack `<id>-desk` / `<id>-<scene>`, then look.json ties them
 * together and she shows it. One report for all of it.
 */
async function importLookHere(request: Extract<BrainMessage, { t: 'look.import' }>): Promise<void> {
  await ffmpegFromBrain(request.ffmpeg)
  const { size, scaleFactor } = screen.getPrimaryDisplay()
  const result = await importLook(request, {
    home: expand(home), packsDir,
    screen: { width: size.width, height: size.height, scale: scaleFactor },
    onProgress: (done, total, step) => link?.send({ t: 'pack.progress', id: '', done, total, step }),
  })
  link?.send({ t: 'pack.report', id: '', ok: result.look !== undefined, lines: result.lines })
  if (result.look === undefined) reportPacks()
  else useLook(request.id)
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
    {
      label: `外形：${look?.name ?? pack.name}`,
      submenu: packList().map(p => ({ label: p.name, type: 'radio' as const, checked: p.packId === (look === undefined ? pack.id : lookPackId(look)), click: () => usePack(p.packId) })),
    },
    ...(look === undefined ? [] : [sceneMenu(look)]),
    { type: 'separator' },
    { label: `和她说话（${process.platform === 'darwin' ? '⌃⌥空格' : 'Ctrl+Alt+空格'}）`, click: talk },
    { label: '打字和她说', click: showInput },
    { label: '人设…', click: () => openPanel('persona') },
    { label: '她记得的事…', click: () => openPanel('memory') },
    { label: '画面编排…', click: () => openPanel('clips') },
    { label: '做场景…', click: () => openPanel('scene') },
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

function sceneMenu(l: Look): Electron.MenuItemConstructorOptions {
  const prefs = lookPrefs()
  const current = prefs.scene ?? l.default
  return {
    label: `场景：${l.scenes.find(s => s.id === current)?.name ?? current}`,
    submenu: [
      ...l.scenes.map(s => ({ label: s.name, type: 'radio' as const, checked: s.id === current, enabled: !(prefs.off ?? []).includes(s.id), click: () => switchScene(s.id) })),
      { type: 'separator' as const },
      { label: '自动换场景', type: 'checkbox' as const, checked: prefs.auto !== false, click: (item: Electron.MenuItem) => setLook({ auto: item.checked }) },
      { label: '待在这里不动', type: 'checkbox' as const, checked: prefs.locked === true, click: (item: Electron.MenuItem) => setLook({ locked: item.checked }) },
    ],
  }
}

function refreshTray(): void {
  if (tray === undefined) return
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()))
  if (process.platform === 'darwin') tray.setTitle(status.status === 'connected' ? '她' : '她·睡')
  tray.setToolTip(`dsh-her · ${statusLabel()}`)
}

let typingWindow: BrowserWindow | undefined

/** A wallpaper window takes no keys: typing gets a small window of its own, and she stays where she is. */
function openTyping(): void {
  if (process.platform === 'darwin') app.focus({ steal: true })
  if (typingWindow !== undefined && !typingWindow.isDestroyed()) {
    typingWindow.show()
    typingWindow.focus()
    return
  }
  const area = screen.getPrimaryDisplay().workArea
  const size = { width: 480, height: 96 }
  typingWindow = new BrowserWindow({
    ...size, x: Math.round(area.x + (area.width - size.width) / 2), y: area.y + area.height - size.height - 40,
    frame: false, transparent: true, hasShadow: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: join(__dirname, 'preload.cjs') },
  })
  typingWindow.setAlwaysOnTop(true, 'floating')
  typingWindow.once('ready-to-show', () => typingWindow?.show())
  typingWindow.on('closed', () => { typingWindow = undefined })
  void typingWindow.loadFile(join(__dirname, 'input.html'))
}

/** Send to her page, except typing to her in the wallpaper. */
function toHer(channel: 'show-input' | 'talk'): void {
  if (mode === 'wallpaper' && channel === 'show-input') openTyping()
  else win?.webContents.send(channel)
}

let panelWindow: BrowserWindow | undefined

/** Her settings window (人设, 她记得的事); one at a time, brought to the front if already open. `extra`: more query (做场景 on a folder). */
function openPanel(tab: 'persona' | 'memory' | 'clips' | 'scene', extra: Record<string, string> = {}): void {
  const query = { tab, ...extra }
  if (panelWindow !== undefined && !panelWindow.isDestroyed()) {
    void panelWindow.loadFile(join(__dirname, 'panel.html'), { query })
    panelWindow.show()
    panelWindow.focus()
    return
  }
  panelWindow = new BrowserWindow({
    width: 560, height: 680, minWidth: 420, minHeight: 400, title: '她', show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs') },
  })
  panelWindow.once('ready-to-show', () => panelWindow?.show())
  panelWindow.on('closed', () => { panelWindow = undefined })
  void panelWindow.loadFile(join(__dirname, 'panel.html'), { query })
  if (process.platform === 'darwin') app.focus({ steal: true })
}

function showInput(): void {
  toHer('show-input')
}
if (debug) Object.assign(globalThis, { herShowInput: showInput })

function talk(): void {
  toHer('talk')
}

function toPage(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, ...args)
}

ipcMain.handle('config', (): BodyConfig => ({ mode, platform: process.platform, pack, her: herSize(), debug, mute }))
ipcMain.handle('pack-clips', () => clipsView(join(packsDir, pack.id), pack))
ipcMain.handle('screens', (): ScreenInfo[] => {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map(d => ({ width: d.size.width, height: d.size.height, scale: d.scaleFactor, primary: d.id === primary }))
})
ipcMain.handle('scene-pick-photo', () => pickScenePhoto())
ipcMain.handle('scene-photo-in', (_event, dir: string) => {
  try {
    return { ok: true, photo: scenePhotoIn(dir) }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
})
ipcMain.handle('scene-save', (_event, input: Parameters<typeof saveScene>[0]) => {
  try {
    return { ok: true, ...saveScene(input) }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
})
ipcMain.handle('pack-clips-save', (_event, changes: Parameters<typeof saveClipUses>[1]) => {
  try {
    saveClipUses(join(packsDir, pack.id), changes)
    // Reload the pack so she uses the new layout at once (and the brain hears of new emotions).
    reshow()
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
})
ipcMain.handle('say', (_event, text: string) => (lastTalkAt = Date.now(), link?.send({ t: 'user.text', ...(cid === undefined ? {} : { cid }), text }) ?? false))
ipcMain.handle('send', (_event, message: BodyMessage) => {
  const withCid = 'cid' in message && typeof message.cid === 'string' && message.cid !== '' ? message : { ...message, cid: cid ?? '' }
  return link?.send(withCid as BodyMessage) ?? false
})
ipcMain.handle('utterance', (_event, uttId: string, pcm: ArrayBuffer, durationMs: number) =>
  (lastTalkAt = Date.now(), link?.sendWithAudio(new Uint8Array(pcm), stream => ({ t: 'user.utterance', ...(cid === undefined ? {} : { cid }), uttId, format: 'pcm16@16k', durationMs, stream })) ?? false))
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

// One body per home: a test home (~/.dsh-her-dev) gets its own Electron profile, so it can run beside the real one.
if (expand(home) !== expand('~/.dsh-her')) app.setPath('userData', `${app.getPath('userData')}-${basename(expand(home)).replace(/^\./, '')}`)

/** Her icon at 32 px, drawn for a 16 px tray slot (sharper on high-density screens). */
function trayIcon(): Electron.NativeImage {
  return nativeImage.createFromBitmap(Buffer.from(iconPixels(32, true)), { width: 32, height: 32, scaleFactor: 2 })
}

/**
 * `--smoke` (CI): start as usual, and once her window has loaded print
 * "dsh-her smoke ok" and quit; exit code 1 if that has not happened in 60 s.
 */
const SMOKE = process.argv.includes('--smoke')

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
    // macOS shows "她" as the tray title; Windows and Linux need a picture.
    tray = new Tray(process.platform === 'darwin' ? nativeImage.createEmpty() : trayIcon())
    refreshTray()
    if (look !== undefined) {
      // Started again later: in the scene the rules want now, unless she was told to stay.
      const prefs = lookPrefs()
      if (prefs.locked !== true && prefs.auto !== false) setLookPrefs({ ...prefs, scene: wantedScene(look), switchedAt: Date.now() })
      showLookPack()
    } else {
      pack = loadOrNothing(packPath, screenAspect())
    }
    win = createWindow()
    if (SMOKE) {
      const timer = setTimeout(() => app.exit(1), 60_000)
      win.webContents.once('did-finish-load', () => {
        clearTimeout(timer)
        console.log(`dsh-her smoke ok (${process.platform}-${process.arch}, electron ${process.versions.electron})`)
        setTimeout(() => app.exit(0), 1500)
      })
    }
    globalShortcut.register(TALK_SHORTCUT, talk)
    setInterval(lookTick, 60_000)
    link = new BrainLink({
      home,
      hello: () => ({
        body: { kind: 'video', app: 'dsh-her-body', version: app.getVersion(), os: `${process.platform}-${process.arch}` },
        caps: {
          audioOut: ['wav', 'mp3'],
          micIn: { formats: ['pcm16@16k'], vad: 'energy' },
          asrLocal: false,
          ttsLocal: [],
          modes: ['overlay', 'wallpaper', 'window'],
          screens: screen.getAllDisplays().map(d => ({ id: d.id, w: d.size.width, h: d.size.height, scale: d.scaleFactor })),
        },
        packs: [look === undefined ? summarize(pack) : lookSummary(look, pack, lookPrefs())],
      }),
      onMessage: (message: BrainMessage, audio?: Uint8Array) => {
        if (message.t === 'welcome') {
          cid = message.characters[0]?.cid
          micMode = message.config.mic
          refreshTray()
          reportPacks()
          reportMode()
          reportLook()
        } else if (message.t === 'mode') {
          switchMode(message.mode)
          return
        } else if (message.t === 'pack.use') {
          try {
            usePack(message.packId)
          } catch (error) {
            link?.send({ t: 'error', code: 'pack', message: (error as Error).message })
          }
          return
        } else if (message.t === 'folder.pick') {
          if (process.platform === 'darwin') app.focus({ steal: true })
          const properties: Array<'openDirectory' | 'openFile' | 'createDirectory'> = ['openDirectory', 'createDirectory', ...(message.file === undefined ? [] : ['openFile' as const])]
          void dialog.showOpenDialog({ title: message.title, buttonLabel: message.button, properties, ...(message.file === undefined ? {} : { filters: [{ name: message.file, extensions: [message.file.replace(/^.*\./, '')] }] }) })
            .then(choice => link?.send({ t: 'folder.picked', id: message.id, ...(choice.canceled || choice.filePaths[0] === undefined ? {} : { path: choice.filePaths[0] }) }))
          return
        } else if (message.t === 'scene.frame') {
          openPanel('scene', { dir: message.dir, name: message.name })
          return
        } else if (message.t === 'look.import') {
          importLookHere(message).catch(error => link?.send({ t: 'pack.report', id: '', ok: false, lines: [{ level: 'error', text: (error as Error).message }] }))
          return
        } else if (message.t === 'look.set') {
          setLook(message)
          return
        } else if (message.t === 'act' && message.action.startsWith('scene_')) {
          const ok = sceneAct(message.action)
          link?.send({ t: 'act.done', cid: message.cid, id: message.id, ok, ...(ok ? {} : { reason: 'no such scene' }) })
          return
        } else if (message.t === 'pack.pick') {
          pickAndImport(message.ffmpeg).catch(error => link?.send({ t: 'pack.report', id: '', ok: false, lines: [{ level: 'error', text: (error as Error).message }] }))
          return
        }
        if (message.t.startsWith('speak.')) lastTalkAt = Date.now()
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
