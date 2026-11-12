/**
 * Where she appears (docs/设置页与编排设计.md §13): four places, each with
 * a switch of its own — in the wallpaper, floating on the desktop, in dsh's
 * page, on dsh's chat box — and the icon in the menu bar.
 */

import type { ReactNode } from 'react'
import { desktopOffered, herApi, type StateView } from './api.ts'
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

export function PlacesCard({ state, apply }: { state: StateView; apply: Apply }) {
  const p = state.places
  const body = state.body
  const offered = desktopOffered(body)
  const set = (change: Partial<StateView['places']>) => void apply(herApi.places(change)).then(() => window.__herFloat?.refresh())
  const row = (key: 'wallpaper' | 'overlay' | 'web' | 'avatar' | 'tray', title: string, text: string, extra?: { disabled?: boolean; note?: string }) => (
    <div className={`her-setrow her-place${p[key] ? ' on' : ''}`}>
      <Picture name={key} />
      <div><b>{title}</b><span>{text}</span>{extra?.note !== undefined && <span className="her-place-note">{extra.note}</span>}</div>
      <input type="checkbox" aria-label={title} checked={p[key]} disabled={extra?.disabled === true} onChange={e => set({ [key]: e.target.checked })} />
    </div>
  )
  const waiting = offered && !body.connected ? '桌面程序连上后生效。' : undefined
  return (
    <section className="her-card">
      <h2>她出现在哪儿</h2>
      <p className="her-muted">四个地方，各管各的：想让她在哪儿就开哪儿。</p>
      {offered && row('wallpaper', '壁纸里', '场景铺在桌面壁纸的位置，在所有窗口后面。', waiting === undefined ? undefined : { note: waiting })}
      {offered && row('overlay', '浮在桌面上', '她浮在所有窗口上面，能拖动、能点。和「壁纸里」一起开，就是场景在后、她在前（形象或编排里要有宠物）。', waiting === undefined ? undefined : { note: waiting })}
      {row('web', 'dsh 网页里', offered ? '在 dsh 的每个页面上：桌宠或背景。默认只在桌面程序没运行时出现。' : '在 dsh 的每个页面上：桌宠或背景。')}
      {offered && p.web && (
        <div className="her-setrow her-place sub">
          <span className="her-place-pic" />
          <div><b>桌面上有她时，网页里也显示</b><span>两边都看得见她；网页里的她不出声。</span></div>
          <input type="checkbox" aria-label="桌面上有她时，网页里也显示" checked={p.webAlways} onChange={e => set({ webAlways: e.target.checked })} />
        </div>
      )}
      {row('avatar', '对话框上的小头像', '坐在 dsh 对话框上沿的她。点一下打开对话小条。')}
      {offered && row('tray', state.platform === 'darwin' ? '菜单栏上的「她」' : '托盘图标', '点它出菜单：换外形、专注、退出。关掉以后，右键她也是同一个菜单。', waiting === undefined ? undefined : { note: waiting })}
      {offered && !p.wallpaper && !p.overlay && <p className="her-warn">桌面上两处都关了：桌面上看不到她，但她还在听、还会说话，快捷键也能叫出对话小条。想让她完全安静，用右上角的开关。</p>}
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
