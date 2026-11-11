/**
 * The picture on 主界面 (docs/设置页与编排设计.md §1): a small desktop with
 * everything of hers on it — the desktop behind, her floating, her bubble,
 * the talk bar, dsh's window with its skin and her small picture on the chat
 * box. Each has a dot (green: set, yellow: still to set, grey: off or not
 * here); a click goes to where it is set.
 */

import type { StateView } from './api.ts'
import { desktopHere } from './api.ts'

type Tone = 'ok' | 'warn' | 'off'
export type MapTarget = 'stage' | 'skin' | 'voice' | 'place' | 'talk' | 'model' | 'body'

interface Spot {
  key: string
  label: string
  tone: Tone
  hint: string
  target: MapTarget
  /** Where on the picture, in % of its width and height. */
  at: { left: number; top: number }
}

export function StageMap({ state, onGo }: { state: StateView; onGo: (target: MapTarget) => void }) {
  const body = state.body
  const here = desktopHere(body) || body.web.connected
  const pack = body.packs.find(p => p.packId === body.activePack)
  const off = state.off
  const voiceOk = state.voice.speaking.status === 'ready'
  const spots: Spot[] = [
    { key: 'desktop', label: '桌面', target: 'stage', at: { left: 12, top: 12 },
      tone: off || !here ? 'off' : body.mode === 'wallpaper' || body.web.place === 'background' ? 'ok' : 'warn',
      hint: off ? '她关着' : body.mode === 'wallpaper' ? `壁纸：${pack?.name ?? '—'}` : '她现在不在壁纸里（浮在最上层或普通窗口）' },
    { key: 'pet', label: '她', target: 'stage', at: { left: 18, top: 62 },
      tone: off || !here ? 'off' : pack === undefined ? 'warn' : 'ok',
      hint: off ? '她关着：页面顶上点"叫她出来"' : !here ? '身体没连上' : pack === undefined ? '还没有形象：到编排里选一个' : `${pack.name}${state.stagePlaying ? '（按编排）' : ''}` },
    { key: 'bubble', label: '气泡和声音', target: 'voice', at: { left: 22, top: 36 },
      tone: off ? 'off' : voiceOk ? 'ok' : 'warn',
      hint: voiceOk ? `她的声音：${state.voice.speaking.service}` : '声音还没准备好，现在只出字' },
    { key: 'bar', label: '对话小条', target: 'talk', at: { left: 38, top: 86 },
      tone: off ? 'off' : 'ok',
      hint: `${state.platform === 'darwin' ? '⌃⌥↩' : 'Ctrl+Alt+Enter'} 叫出来；现在这段：${state.talk.segment?.title ?? '还没有'}` },
    { key: 'dsh', label: 'dsh 和皮肤', target: 'skin', at: { left: 62, top: 14 },
      tone: state.skin === null ? 'off' : 'ok',
      hint: state.skin === null ? 'dsh 原样（可以换皮肤）' : `皮肤：${state.skin}` },
    { key: 'avatar', label: '小头像', target: 'stage', at: { left: 80, top: 58 },
      tone: off ? 'off' : body.web.avatar === undefined ? 'warn' : 'ok',
      hint: body.web.avatar === undefined ? '还没有小头像：在编排的"头像"一行放一个' : '在 dsh 的对话框上，点它就能说话' },
    { key: 'brain', label: '大脑', target: 'model', at: { left: 62, top: 40 },
      tone: state.model === null || state.problem !== undefined ? 'warn' : 'ok',
      hint: state.model === null ? '没有可用的模型' : `${state.model.provider} / ${state.model.model}${state.problem === undefined ? '' : '：上一次回答失败了'}` },
  ]
  const todo = spots.filter(s => s.tone === 'warn')
  return (
    <div className="her-card">
      <h2>她在哪儿</h2>
      <div className="her-map" role="group" aria-label="她在桌面和 dsh 里的样子">
        <div className="her-map-desk" />
        <div className="her-map-dsh"><div className="her-map-chat"><div className="her-map-ava" /></div></div>
        <div className="her-map-pet" />
        <div className="her-map-bubble">…</div>
        <div className="her-map-bar" />
        {spots.map(s => (
          <button key={s.key} className={`her-map-spot ${s.tone}`} style={{ left: `${s.at.left}%`, top: `${s.at.top}%` }} title={s.hint} onClick={() => onGo(s.target)}>
            <span className={`her-dot ${s.tone}`} />{s.label}
          </button>
        ))}
      </div>
      <p className="her-faint">绿色：设好了；黄色：还要设一下；灰色：关着或没连上。点一下去设置。{todo.length > 0 ? ` 还要设：${todo.map(s => s.label).join('、')}。` : ''}</p>
    </div>
  )
}
