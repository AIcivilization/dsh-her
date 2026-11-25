/** What 真人桌宠's settings window can ask the main process (main/standalone.ts). */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PetChange, PetView } from './standalone.ts'

export interface PetBridge {
  state(): Promise<PetView>
  /** Choose a 设计包 with the system's file dialog and look at it. */
  pick(): Promise<PetView>
  /** Look at a 设计包 dropped on the window. */
  drop(file: File): Promise<PetView>
  install(): Promise<PetView>
  dismiss(): Promise<PetView>
  use(cid: string): Promise<PetView>
  remove(cid: string): Promise<PetView>
  set(change: PetChange): Promise<PetView>
  /** Look for a new version now. */
  checkUpdate(): Promise<PetView>
  /** Download the version offered and start again with it. */
  getUpdate(): Promise<PetView>
  /** Go back to the version before. */
  goBack(): Promise<PetView>
  quit(): void
  /** Something changed outside the window (the tray, a file double-clicked). */
  onChanged(listener: () => void): void
}

const bridge: PetBridge = {
  state: () => ipcRenderer.invoke('pet:state'),
  pick: () => ipcRenderer.invoke('pet:pick'),
  drop: file => ipcRenderer.invoke('pet:open', webUtils.getPathForFile(file)),
  install: () => ipcRenderer.invoke('pet:install'),
  dismiss: () => ipcRenderer.invoke('pet:dismiss'),
  use: cid => ipcRenderer.invoke('pet:use', cid),
  remove: cid => ipcRenderer.invoke('pet:remove', cid),
  set: change => ipcRenderer.invoke('pet:set', change),
  checkUpdate: () => ipcRenderer.invoke('pet:update-check'),
  getUpdate: () => ipcRenderer.invoke('pet:update-get'),
  goBack: () => ipcRenderer.invoke('pet:update-back'),
  quit: () => ipcRenderer.send('pet:quit'),
  onChanged: listener => { ipcRenderer.on('pet:changed', () => listener()) },
}

contextBridge.exposeInMainWorld('pet', bridge)
