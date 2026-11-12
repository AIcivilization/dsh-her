/**
 * The picture on 总览 (docs/设置页与编排设计.md §15): one scene with
 * everything of hers as it really is now — the clip in the wallpaper, her
 * floating on top, her bubble, the talk bar, dsh's window in its skin with
 * her in the page and her small picture on the chat box — and a line from
 * each to a label saying what it is and how it is set. A label is a button
 * to where that is set. Places that are switched off show faded.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { StackedView } from '../../body/renderer/stacked.ts'
import type { ShowMedia } from '../dsh/web-body.ts'
import { desktopHere, desktopOffered, type StateView } from './api.ts'

type Tone = 'ok' | 'warn' | 'off'
export type ShowTarget = 'body' | 'stage' | 'look' | 'library' | 'skin' | 'voice' | 'speak' | 'guide'

/** A clip whose transparency is a mask below the colour: drawn through a canvas. */
function Stacked({ url, className }: { url: string; className: string }) {
  const holder = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const box = holder.current
    if (box === null) return
    const video = document.createElement('video')
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none'
    let view: StackedView
    try {
      video.src = new URL(url, document.baseURI).href
      view = new StackedView(video)
    } catch {
      return
    }
    view.canvas.className = 'her-show-canvas'
    box.append(video, view.canvas)
    void video.play().catch(() => {})
    return () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
      box.replaceChildren()
    }
  }, [url])
  return <span ref={holder} className={className} />
}

function Media({ media, className }: { media: ShowMedia; className: string }) {
  if (media.kind === 'image') return <img className={className} src={media.url} alt="" draggable={false} />
  if (media.layout === 'stacked') return <Stacked url={media.url} className={className} />
  return <video className={className} src={media.url} muted loop autoPlay playsInline />
}

interface Callout {
  key: string
  n: number
  title: string
  tone: Tone
  text: string
  to: ShowTarget
  /** The thing itself, in % of the screen. */
  at: { x: number; y: number }
  /** The label: which edge of the picture it sits on, and how far along it (% of the picture). */
  side: 'left' | 'right' | 'top' | 'bottom'
  pos: number
}

/** The screen inside the picture, in % of the picture. */
const SCREEN = { left: 20, top: 10, width: 60, height: 76 }
const px = (x: number) => SCREEN.left + SCREEN.width * x / 100
const py = (y: number) => SCREEN.top + SCREEN.height * y / 100

export function Showcase({ state, onGo }: { state: StateView; onGo: (target: ShowTarget) => void }) {
  const body = state.body
  const places = state.places
  const offered = desktopOffered(body)
  const desk = desktopHere(body)
  const off = state.off
  const { desktop, pet } = state.show
  const avatar = body.web.avatar
  const voiceOk = state.voice.speaking.status === 'ready'
  const lastLine = [...state.talk.lines].reverse().find(line => line.who === 'her')?.text
  const said = lastLine === undefined ? '你回来啦～' : [...lastLine].length > 30 ? `${[...lastLine].slice(0, 30).join('')}…` : lastLine
  const mac = state.platform === 'darwin'

  const wallpaperOn = offered && places.wallpaper && !off
  const overlayOn = offered && places.overlay && !off
  const webOn = places.web && !off
  const avatarOn = places.avatar && !off
  const trayOn = offered && places.tray

  const place = (on: boolean, has: boolean, name: string | undefined, none: string): { tone: Tone; text: string } =>
    off ? { tone: 'off', text: '她关着' }
      : !on ? { tone: 'off', text: '关着，点一下去打开' }
      : !has ? { tone: 'warn', text: none }
      : { tone: 'ok', text: name ?? '显示着' }
  const noDesk = { tone: 'off' as const, text: '这台设备上没有桌面程序' }

  const callouts: Callout[] = [
    { key: 'web', n: 1, title: 'dsh 网页里的她', side: 'top', pos: px(54), at: { x: 54, y: 40 }, to: 'body',
      ...place(places.web, pet !== undefined || desktop !== undefined, body.web.place === 'background' ? '作背景，铺在页面后面' : desk && !places.webAlways ? '桌面上有她时不出现' : '桌宠，能拖、能点', '还没有形象') },
    { key: 'tray', n: 2, title: mac ? '菜单栏上的「她」' : '托盘图标', side: 'top', pos: px(90), at: { x: 90, y: 2.4 }, to: 'body',
      ...(offered ? { tone: trayOn ? 'ok' as const : 'off' as const, text: trayOn ? '点它出菜单' : '关着' } : noDesk) },
    { key: 'dsh', n: 3, title: 'dsh 的皮肤', side: 'left', pos: 20, at: { x: 5, y: 15 }, to: 'skin',
      tone: state.skin === null ? 'off' : 'ok', text: state.skin ?? 'dsh 原样，可以换' },
    { key: 'avatar', n: 4, title: '对话框上的头像', side: 'left', pos: 55, at: { x: 44.5, y: 61 }, to: avatarOn && avatar === undefined ? 'library' : 'body',
      ...place(places.avatar, avatar !== undefined, '点它打开对话小条', '还没有头像素材') },
    { key: 'bar', n: 5, title: '对话小条', side: 'bottom', pos: px(46), at: { x: 46, y: 90.5 }, to: 'speak',
      tone: off ? 'off' : 'ok', text: off ? '她关着' : `${mac ? '⌃⌥↩' : 'Ctrl+Alt+Enter'} 叫出来：打字、按住说` },
    { key: 'desktop', n: 6, title: '壁纸里的桌面', side: 'right', pos: 16, at: { x: 84, y: 11 }, to: wallpaperOn && desktop === undefined ? 'library' : offered && !places.wallpaper ? 'body' : state.stagePlaying ? 'stage' : 'look',
      ...(offered ? place(places.wallpaper, desktop !== undefined, desktop?.name, '还没有桌面的图或视频') : noDesk) },
    { key: 'bubble', n: 7, title: '头顶气泡', side: 'right', pos: 36, at: { x: 95, y: 30 }, to: 'voice',
      tone: off ? 'off' : voiceOk ? 'ok' : 'warn', text: off ? '她关着' : voiceOk ? '她的回答：出声，字在头顶' : '声音没准备好，只出字' },
    { key: 'pet', n: 8, title: '浮在桌面上的她', side: 'right', pos: 63, at: { x: 91.5, y: 68 }, to: overlayOn && pet === undefined ? 'library' : offered && !places.overlay ? 'body' : state.stagePlaying ? 'stage' : 'look',
      ...(offered ? place(places.overlay, pet !== undefined, pet?.name, '还没有宠物的图或视频') : noDesk) },
  ]
  /** Where a label's line leaves it, in % of the picture. */
  const from = (c: Callout): { x: number; y: number } =>
    c.side === 'left' ? { x: SCREEN.left - 1.4, y: c.pos } : c.side === 'right' ? { x: SCREEN.left + SCREEN.width + 1.4, y: c.pos }
      : c.side === 'top' ? { x: c.pos, y: SCREEN.top - 2.4 } : { x: c.pos, y: SCREEN.top + SCREEN.height + 2.4 }
  const figure = (className: string, on: boolean): ReactNode => (pet !== undefined
    ? <span className={`${className}${on ? '' : ' off'}`}><Media media={pet} className="her-show-fill" /></span>
    : <span className={`${className} none${on ? '' : ' off'}`} />)

  return (
    <section className="her-card her-show">
      <div className="her-row her-show-head">
        <h2>她现在的样子</h2>
        <span className="her-faint">这是现在真正在显示的图和视频。每条线指着一样东西，点文字去设置；淡掉的是关着的。</span>
      </div>
      <div className="her-show-stage">
        <div className="her-show-screen">
          {desktop !== undefined && <span className={`her-show-desk${wallpaperOn || !offered ? '' : ' off'}`}><Media media={desktop} className="her-show-fill cover" /></span>}
          <div className="her-show-menubar"><i /><i /><i /><span className="her-grow" /><b className={trayOn ? '' : 'off'}>她</b><em>9:41</em></div>
          <div className="her-show-dsh">
            <div className="her-show-side"><i /><i className="on" /><i /><i /></div>
            <div className="her-show-chat">
              <p className="you" /><p /><p className="short" /><p className="you short" />
              {figure('her-show-webher', webOn)}
              <div className="her-show-box">
                <span>想和她说点什么…</span>
                <span className={`her-show-ava${avatarOn ? '' : ' off'}${avatar === undefined ? ' none' : ''}`}>
                  {avatar?.videoUrl !== undefined ? <video src={avatar.videoUrl} muted loop autoPlay playsInline />
                    : avatar?.clipUrl !== undefined ? <Stacked url={avatar.clipUrl} className="her-show-fill" />
                    : avatar !== undefined && avatar.url !== '' ? <img src={avatar.url} alt="" draggable={false} /> : null}
                </span>
              </div>
            </div>
          </div>
          <div className={`her-show-bubble${overlayOn || !offered ? '' : ' off'}`}>{said}</div>
          {figure('her-show-pet', overlayOn || !offered)}
          <div className={`her-show-bar${off ? ' off' : ''}`}><span>打字，或按住话筒说</span><i /><i className="send" /></div>
          {callouts.map(c => <span key={c.key} className={`her-show-mark ${c.tone}`} style={{ left: `${c.at.x}%`, top: `${c.at.y}%` }}>{c.n}</span>)}
        </div>
        <svg className="her-show-lines" aria-hidden="true">
          {callouts.map(c => {
            const a = from(c)
            return <line key={c.key} className={c.tone} x1={`${a.x}%`} y1={`${a.y}%`} x2={`${px(c.at.x)}%`} y2={`${py(c.at.y)}%`} />
          })}
        </svg>
        {callouts.map(c => (
          <button key={c.key} className={`her-show-label ${c.side} ${c.tone}`} style={c.side === 'left' || c.side === 'right' ? { top: `${c.pos}%` } : { left: `${c.pos}%` }} onClick={() => onGo(c.to)}>
            <b><i>{c.n}</i>{c.title}</b>
            <small><span className={`her-dot ${c.tone}`} />{c.text}</small>
          </button>
        ))}
      </div>
    </section>
  )
}

/** Her 三视图 on 总览: the one picture every other picture and clip of her is made from. */
export function SheetCard({ state, onGo }: { state: StateView; onGo: (target: ShowTarget) => void }) {
  const sheet = state.sheet
  return (
    <section className="her-card her-sheet">
      <div className="her-sheet-pic">
        {sheet === null
          ? <button className="her-sheet-none" onClick={() => onGo('guide')}><b>还没有三视图</b><span>正面、侧面、背面，画在一张图里。照着「素材指南」做一张，传到素材库。</span></button>
          : <a href={sheet.url} target="_blank" rel="noreferrer" title="点开看大图"><img src={sheet.url} alt={`${state.character.name} 的三视图`} /></a>}
      </div>
      <div className="her-sheet-text">
        <h2>{state.character.name} 的三视图</h2>
        <p className="her-muted">她的基础形象。头像、桌面、宠物的每一张图、每一段视频，都拿这张当参考来做，所以她在哪儿都是同一个人。</p>
        <div className="her-sheet-flow" aria-hidden="true"><span>定妆照</span><i /><span className="on">三视图</span><i /><span>头像</span><span>桌面</span><span>宠物</span><span>开机动画</span></div>
        <div className="her-row">
          <button className="her-btn primary" onClick={() => onGo('guide')}>素材指南：尺寸和提示词</button>
          <button className="her-btn" onClick={() => onGo('library')}>{sheet === null ? '上传三视图' : '换一张'}</button>
        </div>
      </div>
    </section>
  )
}
