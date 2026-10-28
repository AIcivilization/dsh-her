import { contextBridge, ipcRenderer } from 'electron'
import type { HerBridge } from '../shared/types.ts'

const bridge: HerBridge = {
  config: () => ipcRenderer.invoke('config'),
  hit: onHer => ipcRenderer.send('hit', onHer),
  drag: (dx, dy) => ipcRenderer.send('drag', { dx, dy }),
  menu: () => ipcRenderer.send('menu'),
  say: text => ipcRenderer.invoke('say', text),
  interactive: on => ipcRenderer.send('interactive', on),
  onBrain: listener => { ipcRenderer.on('brain', (_event, message) => listener(message)) },
  onStatus: listener => { ipcRenderer.on('status', (_event, status, detail) => listener(status, detail)) },
  onShowInput: listener => { ipcRenderer.on('show-input', () => listener()) },
}

contextBridge.exposeInMainWorld('her', bridge)
