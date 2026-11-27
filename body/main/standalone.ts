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
import type { BrainChoice } from '../../src/standalone/pet-chat.ts'
import { FIRST_CHECK_AFTER_MS, PlayerUpdates, type UpdateState } from '../../src/standalone/player-update.ts'
import { Autoloop, type AutoloopState } from '../../src/standalone/autoloop.ts'
import { cannotReplace, goBack, replaceWith } from './update.ts'
import { PACKAGED } from './packaged.ts'
import { DESIGN_FILE, translocated } from './standalone-where.ts'

export { designArg, designBeside, insideZip, translocated } from './standalone-where.ts'

export const APP_NAME = '真人桌宠'

function packagedAsPet(): boolean {
  try {
    return (JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { standalone?: unknown }).standalone === true
  } catch {
    return false
  }
}

export { PACKAGED }

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
  /** Open her talk bar. */
  talk(): void
}

/** What the settings window shows. */
export interface PetView extends PetState {
  /** A 设计包 looked at and not put in yet. */
  pending?: DesignPreview
  places: DeskPlaces
  petScale: number
  app: { name: string; version: string; packaged: boolean; autostart: boolean; translocated: boolean }
  /** The loop she lives by (agent-autoloop): on or off, and which one. */
  loop: AutoloopState & { on: boolean }
  /** Updates: what was found, the download under way, why this copy cannot replace itself. */
  update: UpdateState & { progress?: { done: number; total: number }; busy: boolean; cannot?: string }
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
  /** Look for a new version once a day. */
  autoUpdate?: boolean
  /** Who she talks with (pet-chat.ts), and whether out loud. */
  brain?: BrainChoice
  voice?: boolean
  /** She takes on work (agent-autoloop); and which one, when the user was asked. */
  loop?: boolean
  loopUse?: 'own' | 'bundled'
}

/** How often the daily look is considered (it goes out only once a day). */
const UPDATE_TICK_MS = 3_600_000

export class Standalone {
  readonly brain: PetBrain
  readonly updates: PlayerUpdates
  readonly loop: Autoloop
  private updateTimer: NodeJS.Timeout | undefined
  private readonly hooks: BodyHooks
  private window: BrowserWindow | undefined
  private pending: DesignPreview | undefined
  private error: string | undefined

  constructor(home: string, hooks: BodyHooks) {
    this.hooks = hooks
    this.brain = new PetBrain({ home, version: app.getVersion(), log: entry => console.log(JSON.stringify(entry)) })
    this.updates = new PlayerUpdates({ home, version: app.getVersion() })
    // Ours runs in this program's own Node (Electron as Node); its code is in the app, or in body/vendor while developing.
    this.loop = new Autoloop({
      home,
      root: PACKAGED ? join(process.resourcesPath, 'agent-autoloop') : join(app.getAppPath(), 'vendor', 'agent-autoloop'),
      node: process.execPath,
      nodeEnv: { ELECTRON_RUN_AS_NODE: '1' },
      log: entry => console.log(JSON.stringify(entry)),
    })
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
    ipcMain.handle('pet:update-check', () => answer(() => this.updates.check())())
    ipcMain.handle('pet:update-get', () => answer(() => this.update())())
    ipcMain.handle('pet:update-back', () => answer(() => goBack(this.updates))())
    // Her API key: from the settings window straight to where keys are kept (never into a file of hers or a log).
    ipcMain.handle('pet:key', (_event, key: string) => answer(() => this.brain.setKey(typeof key === 'string' ? key : ''))())
    ipcMain.on('pet:talk', () => this.hooks.talk())
    ipcMain.on('pet:quit', () => app.quit())
  }

  /** Download the version offered, check it, put it in and start again (the window shows how far it is). */
  async update(): Promise<void> {
    const why = cannotReplace()
    if (why !== undefined) throw new Error(why)
    const { app: next } = await this.updates.download(() => this.refresh())
    replaceWith(this.updates, next, app.getVersion())
  }

  /** The daily look, when it is on and due; a newer version shows in the tray. */
  private async lookForUpdate(): Promise<void> {
    if (!this.updates.due()) return
    try {
      await this.updates.check()
    } catch (error) {
      console.log(JSON.stringify({ event: 'update-check', error: (error as Error).message }))
    }
    this.hooks.changed()
  }

  async start(): Promise<void> {
    await this.brain.start()
    if (PACKAGED && process.platform === 'win32') registerDesignFiles()
    this.updates.tidy()
    // Windows put the new version in after this program quit: what went wrong, if anything.
    const failed = this.updates.takeWindowsError()
    if (failed !== undefined) this.error = `上次没能换上新版本：${failed}`
    setTimeout(() => void this.lookForUpdate(), FIRST_CHECK_AFTER_MS).unref()
    this.updateTimer = setInterval(() => void this.lookForUpdate(), UPDATE_TICK_MS)
    this.updateTimer.unref()
    if (this.brain.state().settings.loop) void this.loop.start().then(() => this.hooks.changed())
  }

  async stop(): Promise<void> {
    clearInterval(this.updateTimer)
    await this.loop.stop()
    await this.brain.stop()
  }

  view(): PetView {
    return {
      ...this.brain.state(),
      ...(this.pending === undefined ? {} : { pending: this.pending }),
      places: this.hooks.places(),
      petScale: this.hooks.petScale(),
      app: {
        name: APP_NAME, version: app.getVersion(), packaged: PACKAGED,
        autostart: PACKAGED && app.getLoginItemSettings().openAtLogin,
        translocated: translocated(),
      },
      loop: { ...this.loop.state(), on: this.brain.state().settings.loop },
      update: {
        ...this.updates.state(),
        ...(this.updates.progress === undefined ? {} : { progress: this.updates.progress }),
        busy: this.updates.busyNow(),
        ...(cannotReplace() === undefined ? {} : { cannot: cannotReplace() }),
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
    if (change.autostart !== undefined && PACKAGED) app.setLoginItemSettings({ openAtLogin: change.autostart })
    if (change.autoUpdate !== undefined) this.updates.setAuto(change.autoUpdate)
    if (change.brain !== undefined) await this.brain.setBrain(change.brain)
    if (change.voice !== undefined) this.brain.setVoice(change.voice)
    if (change.loop !== undefined) {
      this.brain.setLoop(change.loop)
      if (change.loop) await this.loop.start()
      else await this.loop.off()
    }
    if (change.loopUse !== undefined) await this.loop.choose(change.loopUse)
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
