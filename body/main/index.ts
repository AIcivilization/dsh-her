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

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, session, shell, systemPreferences, Tray } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { BodyMessage, BrainMessage, DeskPlaces, PackSummary } from '../../src/protocol/index.ts'
import { cleanPlace, pickScene, shouldSwitch, type Look, type LookPrefs } from '../../src/pack/look.ts'
import type { BodyConfig, LinkStatus, MicMode, Mode, PackInfo } from '../shared/types.ts'
import { BrainLink } from './brain-link.ts'
import { idleLookSummary, listLooks, lookPackId, lookSummary, lookView } from '../../src/pack/looks.ts'
import { importPack } from '../../src/pack/import.ts'
import { loadPack, summarize } from '../../src/pack/load.ts'
import { hasFfmpeg, useFfmpeg } from '../../src/pack/media.ts'
import { listPacks, loadSettings, saveSettings, type BodySettings } from '../../src/pack/settings.ts'
import { iconPixels } from '../shared/icon.ts'
import { importLook } from '../../src/pack/import-look.ts'
import { attachToWallpaper } from './wallpaper-win.ts'

/** ⌃⌥Space / Ctrl+Alt+Space: talk to her. Alt+Space alone is taken by Windows' window menu. */
const TALK_SHORTCUT = 'Control+Alt+Space'
/** ⌃⌥↩ / Ctrl+Alt+Enter: the talk bar. */
const BAR_SHORTCUT = 'Control+Alt+Enter'
/** The right Option (macOS) / right Alt key, in uiohook's codes: hold it anywhere to talk. */
const HOLD_KEYCODE = 3640
const HOLD_KEY_NAME = process.platform === 'darwin' ? '右边的 Option' : '右边的 Alt'
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
  const chosen = settings.looks?.[l.id]?.scene
  const scene = l.scenes.find(s => s.id === chosen) ?? l.scenes.find(s => s.id === l.default)!
  // Floating on top: the scene's own desk pet, else the look's.
  const desk = scene.desk ?? l.desk
  if (m === 'overlay' && desk !== undefined) return desk
  return scene.pack
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
/** She is not speaking first for a while (from the brain; the menu can change it). */
let focus = false
/** Switched off on her page or here: no window, no listening, until she is called back. Remembered, so she does not flash up at the next start. */
let off = settings.off === true
/** When either of you last said something: no scene changes mid-conversation. */
let lastTalkAt = 0
let win: BrowserWindow | undefined
let tray: Tray | undefined
/**
 * Where she shows on the desktop (docs/设置页与编排设计.md §13): in the
 * wallpaper, floating on top, each on its own. Both: the scene in the
 * wallpaper and, in a second window, the look's desk pet floating over it.
 * Neither: a window nobody sees, so she still speaks and listens.
 * Not set (before 0.8): one window, by `mode`.
 */
let places: DeskPlaces | undefined = settings.places
  // A new install shows her in both; one that chose a mode before 0.8 keeps its one window.
  ?? (settings.mode === undefined && settings.pack === undefined && settings.look === undefined && arg('mode') === undefined ? { wallpaper: true, overlay: true } : undefined)
const shownPlaces = (): DeskPlaces => places ?? { wallpaper: mode === 'wallpaper', overlay: mode !== 'wallpaper' }
const unseen = () => places !== undefined && !places.wallpaper && !places.overlay
/** The floating window beside the wallpaper one, and what it shows. */
let petWin: BrowserWindow | undefined
let petPack: PackInfo | undefined
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
/** Where 编排 puts her when she floats on top (its look's place), if it says. */
const petPlace = () => (look === undefined || mode !== 'overlay' ? undefined : cleanPlace(look.place?.pet))

/** How big she floats, from her page (half to 1.6 times). */
const petScale = () => (typeof settings.petScale === 'number' && Number.isFinite(settings.petScale) ? Math.min(1.6, Math.max(0.5, settings.petScale)) : 1)

function herSize(of: PackInfo = pack, place = petPlace()): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workArea
  const aspect = of.aspect ?? 0.75
  let height = Math.round(Math.min(area.height * 0.92, area.height * (place?.height ?? 0.42) * petScale()))
  if (height * aspect > area.width * 0.6) height = Math.round((area.width * 0.6) / aspect)
  return { width: Math.round(height * aspect), height }
}

/** A window for her floating on top: transparent, above everything, taking the mouse only on her. */
function floatingWindow(her: { width: number; height: number }, place: ReturnType<typeof petPlace>, show: boolean): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea
  const size = { width: Math.max(her.width, 340), height: Math.round(her.height * (1 + BUBBLE_ROOM)) }
  const pos = overlayPos ?? (place === undefined
    ? { x: area.x + area.width - size.width - 24, y: area.y + area.height - size.height }
    : { x: Math.round(area.x + area.width * place.x - size.width / 2), y: Math.round(area.y + area.height * place.y - size.height) })
  const created = new BrowserWindow({
    ...pos, ...size, show,
    transparent: true, frame: false, hasShadow: false, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, backgroundColor: '#00000000',
    // Unseen, she still has to speak and listen: no slowing down in the background.
    webPreferences: { preload: join(__dirname, 'preload.cjs'), backgroundThrottling: show },
  })
  created.setAlwaysOnTop(true, 'floating')
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  created.setIgnoreMouseEvents(true, { forward: true })
  return created
}

/** The look's desk pet for the scene she is in, when both places are on and the wallpaper shows the scene. */
function petPackId(): string | undefined {
  if (off || places === undefined || !places.wallpaper || !places.overlay || look === undefined || mode !== 'wallpaper') return undefined
  const desk = lookPack(look, 'overlay')
  return desk === lookPack(look, 'wallpaper') ? undefined : desk
}

/** The floating window beside the wallpaper one: there when it should be, with what it should show. */
function syncPet(): void {
  const id = petPackId()
  const old = petWin
  petWin = undefined
  petPack = undefined
  if (id !== undefined) {
    try {
      petPack = loadPack(join(packsDir, id), screenAspect())
      const place = look === undefined ? undefined : cleanPlace(look.place?.pet)
      petWin = floatingWindow(herSize(petPack, place), place, true)
      void petWin.loadFile(join(__dirname, 'index.html'))
    } catch (error) {
      console.warn(`no floating window (${(error as Error).message})`)
      petPack = undefined
    }
  }
  old?.destroy()
}

function createWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay()
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
    created = floatingWindow(her, petPlace(), !unseen())
  }
  void created.loadFile(join(__dirname, 'index.html'))
  return created
}

/** Her opening clip: a window of its own over where she floats, gone when the clip ends or is clicked. */
function playIntro(path: string): void {
  if (off || !existsSync(path)) return
  const area = screen.getPrimaryDisplay().workArea
  const size = { width: Math.round(area.width * 0.5), height: Math.round(area.height * 0.6) }
  const intro = new BrowserWindow({
    ...size, x: Math.round(area.x + (area.width - size.width) / 2), y: Math.round(area.y + (area.height - size.height) / 2),
    frame: false, transparent: true, hasShadow: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false, backgroundColor: '#00000000',
  })
  intro.setAlwaysOnTop(true, 'screen-saver')
  intro.once('ready-to-show', () => intro.showInactive())
  void intro.loadFile(join(__dirname, 'intro.html'), { query: { src: pathToFileURL(path).href } })
}

/**
 * Switch her off or call her back. Off: her window and the talk bar close
 * (no picture, no microphone, no voice); the brain also stops her speaking
 * first. `tell`: the change was made here, so the brain hears of it.
 */
function setOff(next: boolean, tell: boolean): void {
  if (tell) link?.send({ t: 'off.set', off: next })
  if (next === off && (off ? win === undefined : win !== undefined)) return
  off = next
  settings = { ...settings, off }
  saveSettings(expand(home), settings)
  if (off && barWindow !== undefined && !barWindow.isDestroyed()) barWindow.close()
  replaceWindow()
  refreshTray()
}

/** A fresh window for her (after a change of mode, pack or scene); none while she is switched off. */
function replaceWindow(): void {
  const old = win
  win = off ? undefined : createWindow()
  old?.destroy()
  syncPet()
}

/** The one window's mode for the places chosen: the wallpaper when it is on, else floating (or the plain window, when that was chosen). */
const modeFor = (next: DeskPlaces): Mode => (next.wallpaper && next.overlay
  // Both: a look puts its scene in the wallpaper and its pet on top; one pack goes where it belongs.
  ? (look === undefined ? layerMode(pack) : 'wallpaper')
  : next.wallpaper ? 'wallpaper' : mode === 'window' ? 'window' : 'overlay')

/** Choose where she shows on the desktop. `tell`: chosen here, so the brain hears of it. */
function setPlaces(next: DeskPlaces, tell: boolean): void {
  const same = places !== undefined && places.wallpaper === next.wallpaper && places.overlay === next.overlay
  places = { wallpaper: next.wallpaper, overlay: next.overlay }
  const nextMode = unseen() ? 'overlay' : modeFor(places)
  settings = { ...settings, places, mode: nextMode }
  saveSettings(expand(home), settings)
  if (!same || nextMode !== mode) {
    mode = nextMode
    if (look !== undefined) showLookPack()
    replaceWindow()
    refreshTray()
    reportMode()
    if (look !== undefined) {
      reportPacks()
      reportLook()
    }
  }
  if (tell) reportPrefs()
}

/** The icon in the menu bar / tray: there unless switched away on her page. */
function setTray(on: boolean): void {
  settings = { ...settings, noTray: !on }
  saveSettings(expand(home), settings)
  if (on && tray === undefined) {
    // macOS shows "她" as the tray title; Windows and Linux need a picture.
    tray = new Tray(process.platform === 'darwin' ? nativeImage.createEmpty() : trayIcon())
    refreshTray()
  } else if (!on && tray !== undefined) {
    tray.destroy()
    tray = undefined
  }
}

function reportPrefs(): void {
  link?.send({ t: 'body.prefs', places: shownPlaces(), tray: settings.noTray !== true, holdKey: settings.holdKey === true, petScale: petScale() })
}

/** Her size, from her page or the menu: a fresh window of the new size. */
function setPetScale(next: number, tell: boolean): void {
  const scale = Math.min(1.6, Math.max(0.5, Math.round(next * 100) / 100))
  if (scale === petScale()) return
  settings = { ...settings, petScale: scale }
  saveSettings(expand(home), settings)
  replaceWindow()
  refreshTray()
  if (tell) reportPrefs()
}

function switchMode(next: Mode): void {
  if (next === mode && win !== undefined && !unseen() && (places === undefined || places.wallpaper !== places.overlay)) return
  mode = next
  // One window in this mode: the other place goes off.
  if (places !== undefined) places = { wallpaper: next === 'wallpaper', overlay: next !== 'wallpaper' }
  settings = { ...settings, mode, ...(places === undefined ? {} : { places }) }
  saveSettings(expand(home), settings)
  // A look shows its desk pet on top and its scene elsewhere.
  if (look !== undefined) showLookPack()
  replaceWindow()
  refreshTray()
  reportMode()
  reportPrefs()
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
  // The look itself may have been written again (编排 saved): read it afresh.
  if (look !== undefined) {
    const id = look.id
    const before = JSON.stringify(look.place ?? null)
    look = listLooks(expand(home), packsDir).find(l => l.id === id) ?? look
    // 编排 moved her: its place wins over where she was dragged.
    if (JSON.stringify(look.place ?? null) !== before) overlayPos = undefined
    showLookPack()
    reportLook()
  }
  else pack = loadOrNothing(packPath, screenAspect())
  replaceWindow()
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
  const nextMode = places !== undefined ? (unseen() ? 'overlay' : modeFor(places)) : chosenMode() ?? 'wallpaper'
  if (nextMode !== mode) {
    mode = nextMode
    reportMode()
  }
  showLookPack()
  replaceWindow()
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
    if (mode === 'wallpaper' && win !== undefined) {
      win.webContents.reload()
      // The scene's own desk pet floats over it.
      if (petPackId() !== petPack?.id) syncPet()
    }
    else {
      // Another scene may have another shape: a window of its own.
      replaceWindow()
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
  const nextMode = places !== undefined ? (unseen() ? 'overlay' : modeFor(places)) : chosenMode() ?? layerMode(pack)
  if (nextMode !== mode) {
    mode = nextMode
    reportMode()
  }
  replaceWindow()
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

/**
 * Whether you are at the computer, for her speaking first. Only how long the
 * keyboard and mouse have been still, and whether the screen is locked: nothing
 * about what is on the screen. Electron cannot see another app being full
 * screen, so `fullscreen` stays false; focus mode covers meetings and games.
 */
const PRESENCE_EVERY_MS = 30_000
const IDLE_AFTER_S = 120
const AWAY_AFTER_S = 600
function reportPresence(): void {
  const locked = powerMonitor.getSystemIdleState(IDLE_AFTER_S) === 'locked'
  const idle = powerMonitor.getSystemIdleTime()
  const state = locked || idle >= AWAY_AFTER_S ? 'away' : idle >= IDLE_AFTER_S ? 'idle' : 'active'
  link?.send({ t: 'presence', state, fullscreen: false, locked })
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
  if (off) {
    return [
      { label: statusLabel(), enabled: false },
      { label: '她关着', enabled: false },
      { label: '叫她出来', click: () => setOff(false, true) },
      { type: 'separator' },
      { label: '设置…', click: () => openSettings() },
      { label: '退出', click: () => app.quit() },
    ]
  }
  return [
    { label: statusLabel(), enabled: false },
    { label: '关掉她', click: () => setOff(true, true) },
    {
      label: `外形：${look?.name ?? pack.name}`,
      submenu: packList().map(p => ({ label: p.name, type: 'radio' as const, checked: p.packId === (look === undefined ? pack.id : lookPackId(look)), click: () => usePack(p.packId) })),
    },
    ...(look === undefined ? [] : [sceneMenu(look)]),
    { type: 'separator' },
    { label: `和她说话（${process.platform === 'darwin' ? '⌃⌥空格' : 'Ctrl+Alt+空格'}）`, click: talk },
    { label: `和她说话：打字或按住说（${process.platform === 'darwin' ? '⌃⌥↩' : 'Ctrl+Alt+Enter'}）`, click: showInput },
    { label: `任何程序里按住${HOLD_KEY_NAME}说话`, type: 'checkbox', checked: settings.holdKey === true, click: item => setHoldKey(item.checked) },
    { label: '设置…', click: () => openSettings() },
    { label: '纯聊模式（在 dsh 里全屏聊天）', click: () => { link?.send({ t: 'chat.open' }); openDsh() } },
    { label: '专注一会儿（2 小时不主动说话）', type: 'checkbox', checked: focus, click: item => { link?.send({ t: 'focus.set', on: item.checked }) } },
    {
      label: '一直在听', type: 'checkbox', checked: micMode === 'always',
      click: item => {
        micMode = item.checked ? 'always' : 'push-to-talk'
        toPage('mic-mode', micMode)
        refreshTray()
      },
    },
    { type: 'separator' },
    { label: '浮在桌面上', type: 'checkbox', checked: shownPlaces().overlay && mode !== 'window', click: box => setPlaces({ ...shownPlaces(), overlay: box.checked }, true) },
    { label: '住在壁纸里', type: 'checkbox', checked: shownPlaces().wallpaper, click: box => setPlaces({ ...shownPlaces(), wallpaper: box.checked }, true) },
    item('普通窗口', 'window'),
    {
      label: `大小：${Math.round(petScale() * 100)}%`,
      submenu: ([['小', 0.7], ['中', 1], ['大', 1.3], ['特大', 1.6]] as const).map(([label, value]) => ({ label, type: 'radio' as const, checked: Math.abs(petScale() - value) < 0.05, click: () => setPetScale(value, true) })),
    },
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
  if (process.platform === 'darwin') tray.setTitle(off ? '她·关' : status.status === 'connected' ? '她' : '她·睡')
  tray.setToolTip(`dsh-her · ${statusLabel()}`)
}

let barWindow: BrowserWindow | undefined
const BAR_SIZE = { width: 470, height: 340 }
/** Her windows hear whether the talk bar is open: her answer shows there then, not over her head as well. */
const tellBar = (open: boolean) => {
  for (const target of [win, petWin]) if (target !== undefined && !target.isDestroyed()) target.webContents.send('bar-open', open)
}

/** Where the talk bar goes: beside her when she floats, else at the bottom of the screen you are on. */
function barBounds(): Electron.Rectangle {
  const { width, height } = BAR_SIZE
  const floating = petWin ?? (mode === 'overlay' && !unseen() ? win : undefined)
  const her = floating !== undefined && !floating.isDestroyed() ? floating.getBounds() : undefined
  const area = (her === undefined ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : screen.getDisplayMatching(her)).workArea
  let x = her === undefined ? area.x + (area.width - width) / 2 : her.x - width + 40
  if (her !== undefined && x < area.x) x = her.x + her.width - 40
  const y = her === undefined ? area.y + area.height - height - 24 : her.y + her.height - height - 12
  return {
    x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
    width, height,
  }
}

/**
 * The talk bar (docs/对话入口设计.md), wherever she is, even over a full-screen
 * app: a window you called is allowed there; her own figure is not.
 */
function openBar(): void {
  if (off) return
  if (process.platform === 'darwin') app.focus({ steal: true })
  if (barWindow !== undefined && !barWindow.isDestroyed()) {
    barWindow.setBounds(barBounds())
    barWindow.show()
    barWindow.focus()
    tellBar(true)
    return
  }
  barWindow = new BrowserWindow({
    ...barBounds(),
    frame: false, transparent: true, hasShadow: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: '#00000000',
    fullscreenable: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs') },
  })
  barWindow.setAlwaysOnTop(true, 'screen-saver')
  barWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  barWindow.once('ready-to-show', () => {
    barWindow?.show()
    barWindow?.focus()
    tellBar(true)
  })
  barWindow.on('closed', () => {
    barWindow = undefined
    tellBar(false)
    // A held button whose window went away is let go.
    win?.webContents.send('hold', false)
  })
  void barWindow.loadFile(join(__dirname, 'bar.html'))
}

function toHer(channel: 'talk'): void {
  win?.webContents.send(channel)
}

/** Holding the key anywhere, through a keyboard hook (uiohook); off until asked for. */
let holdHook: { stop(): void } | undefined
let trustTimer: NodeJS.Timeout | undefined
function setHoldKey(on: boolean, tell = true): void {
  settings = { ...settings, holdKey: on }
  saveSettings(expand(home), settings)
  if (on) startHoldHook()
  else stopHoldHook()
  refreshTray()
  if (tell) reportPrefs()
}

function startHoldHook(): void {
  if (holdHook !== undefined) return
  // macOS lets a program see keys pressed in other programs only once it is allowed (辅助功能).
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    systemPreferences.isTrustedAccessibilityClient(true)
    toPage('brain', { t: 'bubble', cid: '', text: `（在"系统设置 → 隐私与安全性 → 辅助功能"里打开 dsh-her，就能在任何程序里按住${HOLD_KEY_NAME}说话。我只听这一个键。）`, ttlMs: 15_000 })
    clearInterval(trustTimer)
    let tries = 0
    trustTimer = setInterval(() => {
      if (systemPreferences.isTrustedAccessibilityClient(false)) {
        clearInterval(trustTimer)
        startHoldHook()
      } else if (++tries > 100 || settings.holdKey !== true) clearInterval(trustTimer)
    }, 3000)
    return
  }
  try {
    const { uIOhook } = require('uiohook-napi') as typeof import('uiohook-napi')
    let down = false
    uIOhook.on('keydown', event => {
      if (event.keycode !== HOLD_KEYCODE || down) return
      down = true
      win?.webContents.send('hold', true)
    })
    uIOhook.on('keyup', event => {
      if (event.keycode !== HOLD_KEYCODE || !down) return
      down = false
      win?.webContents.send('hold', false)
    })
    uIOhook.start()
    holdHook = {
      stop: () => {
        uIOhook.removeAllListeners()
        uIOhook.stop()
      },
    }
  } catch (error) {
    console.warn(`keyboard hook failed (${(error as Error).message})`)
    toPage('brain', { t: 'bubble', cid: '', text: `（按住${HOLD_KEY_NAME}说话打不开：${(error as Error).message}）`, ttlMs: 10_000 })
  }
}

function stopHoldHook(): void {
  clearInterval(trustTimer)
  holdHook?.stop()
  holdHook = undefined
}

/**
 * Her settings live in dsh (docs/设置页与编排设计.md): the brain remembers
 * which page was asked for, dsh comes to the front, and its page shows it.
 */
function openSettings(): void {
  link?.send({ t: 'settings.open' })
  openDsh()
}

function openDsh(): void {
  void shell.openExternal('dsh://open').catch(() => {})
}

function showInput(): void {
  openBar()
}
if (debug) Object.assign(globalThis, { herShowInput: showInput })

function talk(): void {
  toHer('talk')
}

function toPage(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, ...args)
}

ipcMain.handle('config', (event): BodyConfig => (petWin !== undefined && petPack !== undefined && event.sender === petWin.webContents
  ? { mode: 'overlay', platform: process.platform, pack: petPack, her: herSize(petPack, look === undefined ? undefined : cleanPlace(look.place?.pet)), debug, mute: true, pet: true }
  : { mode, platform: process.platform, pack, her: herSize(), debug, mute, ...(petWin !== undefined ? { bubble: false } : {}), ...(unseen() ? { unseen: true } : {}) }))
/** The floating window beside the wallpaper one only shows and is touched: the other one speaks, listens and answers the brain. */
const fromPet = (sender: Electron.WebContents) => petWin !== undefined && !petWin.isDestroyed() && sender === petWin.webContents
const PET_SENDS = new Set(['touch', 'interrupt'])
ipcMain.handle('say', (_event, text: string) => (lastTalkAt = Date.now(), link?.send({ t: 'user.text', ...(cid === undefined ? {} : { cid }), text }) ?? false))
ipcMain.handle('send', (event, message: BodyMessage) => {
  if (fromPet(event.sender) && !PET_SENDS.has(message.t)) return false
  const withCid = 'cid' in message && typeof message.cid === 'string' && message.cid !== '' ? message : { ...message, cid: cid ?? '' }
  return link?.send(withCid as BodyMessage) ?? false
})
ipcMain.handle('utterance', (event, uttId: string, pcm: ArrayBuffer, durationMs: number) =>
  fromPet(event.sender) ? false : (lastTalkAt = Date.now(), link?.sendWithAudio(new Uint8Array(pcm), stream => ({ t: 'user.utterance', ...(cid === undefined ? {} : { cid }), uttId, format: 'pcm16@16k', durationMs, stream })) ?? false))
ipcMain.on('hit', (event, onHer: boolean) => {
  BrowserWindow.fromWebContents(event.sender)?.setIgnoreMouseEvents(!onHer, { forward: true })
})
ipcMain.on('interactive', (event, on: boolean) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (target === null || (mode !== 'overlay' && target !== petWin)) return
  target.setIgnoreMouseEvents(!on, { forward: true })
  if (on) {
    if (process.platform === 'darwin') app.focus({ steal: true })
    target.focus()
  }
})
ipcMain.on('drag', (event, delta: { dx: number; dy: number }) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (target === undefined || target === null || (mode !== 'overlay' && target !== petWin)) return
  const [x = 0, y = 0] = target.getPosition()
  target.setPosition(Math.round(x + delta.dx), Math.round(y + delta.dy))
  overlayPos = { x: x + delta.dx, y: y + delta.dy }
})
ipcMain.on('bar', () => openBar())
ipcMain.on('hold', (_event, on: boolean) => { win?.webContents.send('hold', on === true) })
// dsh's desktop app comes to the front; its page then opens her conversation (the brain told it which).
ipcMain.on('open-dsh', () => openDsh())
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
    if (settings.noTray !== true) tray = new Tray(process.platform === 'darwin' ? nativeImage.createEmpty() : trayIcon())
    refreshTray()
    if (places !== undefined) mode = unseen() ? 'overlay' : modeFor(places)
    if (look !== undefined) {
      // Started again later: in the scene the rules want now, unless she was told to stay.
      const prefs = lookPrefs()
      if (prefs.locked !== true && prefs.auto !== false) setLookPrefs({ ...prefs, scene: wantedScene(look), switchedAt: Date.now() })
      showLookPack()
    } else {
      pack = loadOrNothing(packPath, screenAspect())
    }
    win = off && !SMOKE ? undefined : createWindow()
    if (!SMOKE) syncPet()
    if (SMOKE && win !== undefined) {
      const timer = setTimeout(() => app.exit(1), 60_000)
      win.webContents.once('did-finish-load', () => {
        clearTimeout(timer)
        console.log(`dsh-her smoke ok (${process.platform}-${process.arch}, electron ${process.versions.electron})`)
        setTimeout(() => app.exit(0), 1500)
      })
    }
    globalShortcut.register(TALK_SHORTCUT, talk)
    globalShortcut.register(BAR_SHORTCUT, openBar)
    if (settings.holdKey === true) startHoldHook()
    setInterval(lookTick, 60_000)
    setInterval(reportPresence, PRESENCE_EVERY_MS)
    powerMonitor.on('lock-screen', reportPresence)
    powerMonitor.on('unlock-screen', reportPresence)
    powerMonitor.on('suspend', () => { link?.send({ t: 'presence', state: 'away', fullscreen: false, locked: true }) })
    powerMonitor.on('resume', reportPresence)
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
          focus = message.config.focus === true
          setOff(message.config.off === true, false)
          // What her page chose while this body was away.
          if (message.config.places !== undefined) setPlaces(message.config.places, false)
          if (message.config.tray !== undefined && message.config.tray !== (settings.noTray !== true)) setTray(message.config.tray)
          if (message.config.holdKey !== undefined && message.config.holdKey !== (settings.holdKey === true)) setHoldKey(message.config.holdKey, false)
          if (message.config.petScale !== undefined) setPetScale(message.config.petScale, false)
          refreshTray()
          reportPacks()
          reportMode()
          reportPrefs()
          reportLook()
          reportPresence()
        } else if (message.t === 'config') {
          if (message.focus !== undefined) {
            focus = message.focus
            refreshTray()
          }
          if (message.off !== undefined) setOff(message.off, false)
          if (message.places !== undefined) setPlaces(message.places, false)
          if (message.tray !== undefined) setTray(message.tray)
          if (message.holdKey !== undefined) setHoldKey(message.holdKey, false)
          if (message.petScale !== undefined) setPetScale(message.petScale, false)
          if (message.places !== undefined || message.tray !== undefined || message.holdKey !== undefined || message.petScale !== undefined) reportPrefs()
          return
        } else if (message.t === 'intro') {
          playIntro(message.path)
          return
        } else if (message.t === 'mode') {
          switchMode(message.mode)
          return
        } else if (message.t === 'pack.use') {
          try {
            // The same choice again: its clips changed (画面 in dsh), so load it afresh without switching scenes.
            if (message.packId === (look === undefined ? pack.id : lookPackId(look))) reshow()
            else usePack(message.packId)
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
  stopHoldHook()
  link?.stop()
})
// Closing her window ends the program, unless she was switched off: then only the tray stays, to call her back.
app.on('window-all-closed', () => {
  if (!off) app.quit()
})
