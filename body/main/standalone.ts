/**
 * 真人桌宠: the body as an app of its own (docs/独立安装包设计.md,
 * docs/实施计划.md step 4). No DSH: the small brain (src/standalone/pet-brain.ts)
 * runs inside this program and the body connects to it over the same
 * protocol it speaks to DSH. Its data is in the app's own folder, never in
 * `~/.dsh-her`.
 *
 * Here: whether this is that app, the brain, the small settings window (which
 * is also where a 设计包 is dropped when there is nobody yet), opening a
 * `.her` file, and the two things to tell someone who started it from the
 * wrong place (inside a zip on Windows, before moving it to 应用程序 on macOS).
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_DESIGN_BYTES } from '../../src/core/design-pack.ts'
import type { DesignPreview } from '../../src/engine/design-packs.ts'
import type { DeskPlaces } from '../../src/protocol/index.ts'
import { PetBrain, type PetState } from '../../src/standalone/pet-brain.ts'
import { DESIGN_FILE, translocated } from './standalone-where.ts'

export { designArg, insideZip, translocated } from './standalone-where.ts'

export const APP_NAME = '真人桌宠'

function packagedAsPet(): boolean {
  try {
    return (JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { standalone?: unknown }).standalone === true
  } catch {
    return false
  }
}

/** This program is 真人桌宠: packaged as it (body/scripts/package.mjs), or started so in development (`--standalone`). */
export const STANDALONE = process.argv.includes('--standalone') || process.env.DSH_HER_STANDALONE === '1' || packagedAsPet()

/** Her data: the folder the system gives the app (`~/Library/Application Support/真人桌宠`, `%APPDATA%\真人桌宠`). */
export const standaloneHome = (): string => join(app.getPath('appData'), APP_NAME)

/** What the body lends the settings window: where she shows, how big, on or off. */
export interface BodyHooks {
  places(): DeskPlaces
  setPlaces(next: DeskPlaces): void
  petScale(): number
  setPetScale(next: number): void
  /** After anything the tray shows has changed. */
  changed(): void
}

/** What the settings window shows. */
export interface PetView extends PetState {
  /** A 设计包 looked at and not put in yet. */
  pending?: DesignPreview
  places: DeskPlaces
  petScale: number
  app: { name: string; version: string; packaged: boolean; autostart: boolean; translocated: boolean }
  /** What just went wrong, in words. */
  error?: string
}

export interface PetChange {
  wallpaper?: boolean
  overlay?: boolean
  petScale?: number
  stage?: boolean
  quietFrom?: number
  quietTo?: number
  introOn?: boolean
  introWhen?: 'every' | 'daily'
  autostart?: boolean
}

export class Standalone {
  readonly brain: PetBrain
  private readonly hooks: BodyHooks
  private window: BrowserWindow | undefined
  private pending: DesignPreview | undefined
  private error: string | undefined

  constructor(home: string, hooks: BodyHooks) {
    this.hooks = hooks
    this.brain = new PetBrain({ home, version: app.getVersion(), log: entry => console.log(JSON.stringify(entry)) })
    const answer = <T>(work: () => T | Promise<T>) => async (): Promise<PetView> => {
      this.error = undefined
      try {
        await work()
      } catch (error) {
        this.error = (error as Error).message
      }
      this.hooks.changed()
      return this.view()
    }
    ipcMain.handle('pet:state', () => this.view())
    ipcMain.handle('pet:pick', () => answer(() => this.pick())())
    ipcMain.handle('pet:open', (_event, path: string) => answer(() => this.look(path))())
    ipcMain.handle('pet:dismiss', () => answer(() => { this.pending = undefined })())
    ipcMain.handle('pet:install', () => answer(async () => {
      if (this.pending === undefined) throw new Error('没有要装的设计包（重新选一次文件）')
      const token = this.pending.token
      this.pending = undefined
      await this.brain.installDesign(token)
    })())
    ipcMain.handle('pet:use', (_event, cid: string) => answer(() => this.brain.useCharacter(cid))())
    ipcMain.handle('pet:remove', (_event, cid: string) => answer(() => this.brain.removeCharacter(cid))())
    ipcMain.handle('pet:set', (_event, change: PetChange) => answer(() => this.set(change))())
    ipcMain.on('pet:quit', () => app.quit())
  }

  async start(): Promise<void> {
    await this.brain.start()
    if (app.isPackaged && process.platform === 'win32') registerDesignFiles()
  }

  stop(): Promise<void> {
    return this.brain.stop()
  }

  view(): PetView {
    return {
      ...this.brain.state(),
      ...(this.pending === undefined ? {} : { pending: this.pending }),
      places: this.hooks.places(),
      petScale: this.hooks.petScale(),
      app: {
        name: APP_NAME, version: app.getVersion(), packaged: app.isPackaged,
        autostart: app.isPackaged && app.getLoginItemSettings().openAtLogin,
        translocated: translocated(),
      },
      ...(this.error === undefined ? {} : { error: this.error }),
    }
  }

  private async set(change: PetChange): Promise<void> {
    if (change.wallpaper !== undefined || change.overlay !== undefined) {
      const now = this.hooks.places()
      this.hooks.setPlaces({ wallpaper: change.wallpaper ?? now.wallpaper, overlay: change.overlay ?? now.overlay })
    }
    if (change.petScale !== undefined) this.hooks.setPetScale(change.petScale)
    if (change.quietFrom !== undefined || change.quietTo !== undefined) {
      const { quietFrom, quietTo } = this.brain.state().settings
      this.brain.setQuiet(change.quietFrom ?? quietFrom, change.quietTo ?? quietTo)
    }
    if (change.introOn !== undefined || change.introWhen !== undefined) this.brain.setIntro({ ...(change.introOn === undefined ? {} : { on: change.introOn }), ...(change.introWhen === undefined ? {} : { when: change.introWhen }) })
    if (change.autostart !== undefined && app.isPackaged) app.setLoginItemSettings({ openAtLogin: change.autostart })
    if (change.stage !== undefined) await this.brain.playStage(change.stage)
  }

  /** Look at a 设计包 file: nothing is put in until it is confirmed in the window. */
  private look(path: string): void {
    if (!DESIGN_FILE.test(path)) throw new Error('设计包是一个 .her 或 .zip 文件')
    if (statSync(path).size > MAX_DESIGN_BYTES) throw new Error('这个文件太大了，不像是设计包')
    this.pending = this.brain.previewDesign(readFileSync(path))
  }

  private async pick(): Promise<void> {
    const choice = await dialog.showOpenDialog({ title: '选一个设计包', buttonLabel: '看看', properties: ['openFile'], filters: [{ name: '设计包', extensions: ['her', 'zip'] }] })
    const path = choice.filePaths[0]
    if (choice.canceled || path === undefined) return
    this.look(path)
  }

  /** A 设计包 was double-clicked or dropped on the app: show what is in it. */
  openDesign(path: string): void {
    this.error = undefined
    try {
      this.look(path)
    } catch (error) {
      this.error = (error as Error).message
    }
    this.openSettings()
  }

  /** The small settings window; with nobody yet, it is where her 设计包 is dropped. */
  openSettings(): void {
    if (this.window !== undefined && !this.window.isDestroyed()) {
      this.window.webContents.send('pet:changed')
      this.window.show()
      this.window.focus()
      return
    }
    const window = new BrowserWindow({
      width: 460, height: 640, minWidth: 380, minHeight: 420, title: APP_NAME, show: false,
      backgroundColor: '#f6f7f9', autoHideMenuBar: true, fullscreenable: false,
      webPreferences: { preload: join(__dirname, 'preload-settings.cjs'), contextIsolation: true, sandbox: false },
    })
    this.window = window
    // A file dropped beside the drop zone must not replace the page.
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.once('ready-to-show', () => {
      window.show()
      if (process.platform === 'darwin') app.focus({ steal: true })
    })
    window.on('closed', () => { if (this.window === window) this.window = undefined })
    void window.loadFile(join(__dirname, 'settings.html'))
  }

  /** The window shows what is true now (after the tray changed something). */
  refresh(): void {
    if (this.window !== undefined && !this.window.isDestroyed()) this.window.webContents.send('pet:changed')
  }
}

/**
 * Windows, the packaged app: a double click on a `.her` file opens this
 * program. Written for the current user only (no administrator), again at
 * every start because the unzipped folder may have been moved.
 */
function registerDesignFiles(): void {
  const kind = 'ZhenrenZhuochong.Design'
  const add = (key: string, value: string) => new Promise<void>(resolve => execFile('reg', ['add', `HKCU\\Software\\Classes\\${key}`, '/ve', '/d', value, '/f'], { windowsHide: true }, () => resolve()))
  void (async () => {
    await add('.her', kind)
    await add(kind, `${APP_NAME} 设计包`)
    await add(`${kind}\\shell\\open\\command`, `"${process.execPath}" "%1"`)
  })()
}
