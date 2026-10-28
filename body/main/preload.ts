import { contextBridge, ipcRenderer } from 'electron'
import type { HerBridge } from '../shared/types.ts'

const bridge: HerBridge = {
  config: () => ipcRenderer.invoke('config'),
  hit: onHer => ipcRenderer.send('hit', onHer),
  drag: (dx, dy) => ipcRenderer.send('drag', { dx, dy }),
  menu: () => ipcRenderer.send('menu'),
}

contextBridge.exposeInMainWorld('her', bridge)
