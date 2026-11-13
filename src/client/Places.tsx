/**
 * Where she appears (docs/设置页与编排设计.md §13): four places, each with
 * a switch of its own — in the wallpaper, floating on the desktop, in dsh's
 * page, on dsh's chat box — and the icon in the menu bar.
 */

import type { ReactNode } from 'react'
import { desktopHere, desktopOffered, herApi, type StateView } from './api.ts'
import type { Apply } from './parts.tsx'

const frame = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const Her = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g fill="var(--her-ink)" stroke="none">
    <circle cx={x} cy={y} r={3.2 * s} />
    <path d={`M${x - 4.4 * s} ${y + 10 * s}c0-4 ${2 * s}-${6 * s} ${4.4 * s}-${6 * s}s${4.4 * s} ${2 * s} ${4.4 * s} ${6 * s}z`} />
  </g>
)
/** Small drawings of each place, so the row says where at a glance. */
const PICTURES: Record<string, ReactNode> = {
  wallpaper: <><rect x="2" y="3" width="52" height="34" rx="4" fill="color-mix(in srgb, var(--her-ink) 22%, transparent)" stroke="var(--her-ink)" strokeWidth="1.4" /><Her x={41} y={18} s={1.25} /><rect x="8" y="9" width="24" height="17" rx="2" {...frame} fill="var(--her-paper)" /><path d="M8 13.5h24" {...frame} /></>,
  overlay: <><rect x="2" y="3" width="52" height="34" rx="4" {...frame} /><rect x="8" y="9" width="30" height="20" rx="2" {...frame} /><path d="M8 13.5h30" {...frame} /><Her x={42} y={22} s={1.25} /></>,
  web: <><rect x="2" y="3" width="52" height="34" rx="4" {...frame} /><path d="M2 10h52" {...frame} /><circle cx="7" cy="6.5" r=".9" fill="currentColor" /><circle cx="11" cy="6.5" r=".9" fill="currentColor" /><path d="M16 10v27" {...frame} /><Her x={44} y={22} s={1.2} /></>,
  avatar: <><rect x="2" y="3" width="52" height="34" rx="4" {...frame} /><rect x="9" y="22" width="38" height="10" rx="5" {...frame} /><circle cx="39" cy="19" r="4.6" fill="var(--her-ink)" /></>,
  tray: <><rect x="2" y="3" width="52" height="34" rx="4" {...frame} /><path d="M2 11h52" {...frame} /><rect x="38" y="5" width="10" height="4" rx="2" fill="var(--her-ink)" /></>,
}
const Picture = ({ name }: { name: string }) => <svg className="her-place-pic" viewBox="0 0 56 40" aria-hidden="true">{PICTURES[name]}</svg>

/** The five switches as the page shows them, in this order. */
type PlaceKey = 'wallpaper' | 'overlay' | 'web' | 'avatar' | 'tray'

/**
 * Where she appears, a row of switches under the picture on 总览: switch one
 * on and that place shows her in the picture above (and on your screen), off
 * and it is gone. "dsh中" is shown when on, also beside a desktop body.
 */
export function PlacesRow({ state, apply }: { state: StateView; apply: Apply }) {
  const p = state.places
  const body = state.body
  const offered = desktopOffered(body)
  const desk = desktopHere(body)
  const set = (change: Partial<StateView['places']>) => void apply(herApi.places(change)).then(() => window.__herFloat?.refresh())
  /** In dsh: on means she is really in the page, beside a desktop body too. */
  const webOn = p.web && (p.webAlways || !desk)
  const tiles: Array<{ key: PlaceKey; label: string; on: boolean; disabled: boolean; note?: string; change: (on: boolean) => Partial<StateView['places']> }> = [
    { key: 'wallpaper', label: '壁纸里', on: offered && p.wallpaper, disabled: !offered, change: on => ({ wallpaper: on }) },
    { key: 'overlay', label: '桌面上', on: offered && p.overlay, disabled: !offered, change: on => ({ overlay: on }) },
    { key: 'web', label: 'dsh中', on: webOn, disabled: false, change: on => (on ? { web: true, webAlways: true } : { web: false }) },
    { key: 'avatar', label: 'dsh对话框上', on: p.avatar, disabled: false, change: on => ({ avatar: on }) },
    { key: 'tray', label: state.platform === 'win32' ? '托盘图标' : '菜单栏图标', on: offered && p.tray, disabled: !offered, change: on => ({ tray: on }) },
  ]
  const waiting = offered && !body.connected
  return (
    <section className="her-card her-places">
      <div className="her-places-row" role="group" aria-label="她出现在哪儿">
        {tiles.map(t => (
          <label key={t.key} className={`her-place-tile${t.on ? ' on' : ''}${t.disabled ? ' disabled' : ''}`} title={t.disabled ? '这台设备上没有桌面程序' : undefined}>
            <Picture name={t.key} />
            <span>{t.label}</span>
            <input type="checkbox" aria-label={t.label} checked={t.on} disabled={t.disabled || state.off} onChange={e => set(t.change(e.target.checked))} />
          </label>
        ))}
      </div>
      {state.off && <p className="her-faint">她关着：右上角打开后，这几个开关才起作用。</p>}
      {!state.off && !offered && <p className="her-faint">这台设备上没有桌面程序：壁纸里、桌面上、菜单栏图标用不了。</p>}
      {!state.off && waiting && <p className="her-faint">桌面程序还没连上：壁纸里、桌面上、菜单栏图标在它连上后生效。</p>}
      {!state.off && offered && !p.wallpaper && !p.overlay && <p className="her-warn">桌面上两处都关了：桌面上看不到她，但她还在听、还会出声，快捷键也能叫出对话小条。</p>}
    </section>
  )
}

/** As a background in the page: how clear the page reads over her. Seen at once; the same for every browser. */
export function VeilSliders({ state, apply }: { state: StateView; apply: Apply }) {
  const veil = state.body.web.veil
  const set = (change: { dim?: number; blur?: number }) => void apply(herApi.webVeil(change)).then(() => window.__herFloat?.refresh())
  return (
    <>
      <div className="her-setrow">
        <div><b>遮罩</b><span>越大，页面自己的底色盖得越多，字越清楚；越小，她越亮。</span></div>
        <span className="her-range"><input type="range" min={0} max={95} step={5} value={veil.dim} aria-label="遮罩" onChange={e => set({ dim: Number(e.target.value) })} /><i>{veil.dim}%</i></span>
      </div>
      <div className="her-setrow">
        <div><b>朦胧</b><span>把她虚化一点，像隔着毛玻璃，打字时不抢眼。</span></div>
        <span className="her-range"><input type="range" min={0} max={30} step={2} value={veil.blur} aria-label="朦胧" onChange={e => set({ blur: Number(e.target.value) })} /><i>{veil.blur === 0 ? '不虚化' : `${veil.blur}px`}</i></span>
      </div>
      <p className="her-faint">在页面上也能调：点对话框上的她 → 小条右下角的 ⋯。</p>
    </>
  )
}
