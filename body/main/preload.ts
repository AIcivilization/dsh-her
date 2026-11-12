import { contextBridge, ipcRenderer } from 'electron'
import type { HerBridge } from '../shared/types.ts'

const bridge: HerBridge = {
  config: () => ipcRenderer.invoke('config'),
  hit: onHer => ipcRenderer.send('hit', onHer),
  drag: (dx, dy) => ipcRenderer.send('drag', { dx, dy }),
  menu: () => ipcRenderer.send('menu'),
  say: text => ipcRenderer.invoke('say', text),
  send: message => ipcRenderer.invoke('send', message),
  utterance: (uttId, pcm, durationMs) => ipcRenderer.invoke('utterance', uttId, pcm, durationMs),
  interactive: on => ipcRenderer.send('interactive', on),
  onBrain: listener => { ipcRenderer.on('brain', (_event, message, audio) => listener(message, audio)) },
  onStatus: listener => { ipcRenderer.on('status', (_event, status, detail) => listener(status, detail)) },
  onShowInput: listener => { ipcRenderer.on('show-input', () => listener()) },
  onTalk: listener => { ipcRenderer.on('talk', () => listener()) },
  onMicMode: listener => { ipcRenderer.on('mic-mode', (_event, mode) => listener(mode)) },
  onFadeOut: listener => { ipcRenderer.on('fade-out', () => listener()) },
  openBar: () => ipcRenderer.send('bar'),
  hold: on => ipcRenderer.send('hold', on),
  onHold: listener => { ipcRenderer.on('hold', (_event, on: boolean) => listener(on)) },
  onBar: listener => { ipcRenderer.on('bar-open', (_event, open: boolean) => listener(open)) },
  openDsh: () => ipcRenderer.send('open-dsh'),
}

contextBridge.exposeInMainWorld('her', bridge)
