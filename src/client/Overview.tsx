/**
 * 总览's own cards (docs/设置页与编排设计.md "总览"): her opening clip and
 * dsh's chat background, both playing, each with its switch and choice;
 * and every page in one place, what it is set to, the simple switches
 * right on it. So most things are seen, and the common ones changed,
 * without going into a page.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { herApi, type PixelsView, type SkinsView, type StateView } from './api.ts'
import { Icon } from './icons.tsx'
import { inkOf, PixelFrame } from './pixel/host.ts'
import { showIntro } from './intro-show.ts'
import { showPixelBackground } from './pixel-bg.ts'
import type { PixelLook } from '../core/pixel.ts'

/** A 像素动画 playing over and over in a box. */
function Loop({ id, look, opacity = 1 }: { id: string; look: PixelLook; opacity?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [problem, setProblem] = useState(false)
  useEffect(() => {
    const frame = new PixelFrame()
    frame.el.style.opacity = String(opacity)
    box.current?.append(frame.el)
    frame.on(event => { if (event.t === 'problem') setProblem(true) })
    setProblem(false)
    let gone = false
    void herApi.pixelsCode(id).then(r => {
      if (!gone && r.ok) frame.play(r.code, look, inkOf(look.color, '--dsw-alias-label-primary'), { mode: 'loop', fade: true })
    })
    return () => {
      gone = true
      frame.destroy()
    }
  }, [id, look.style, look.color, look.size, look.fit, opacity])
  return <div ref={box} className="her-ov-play">{problem && <span className="her-danger">播不了</span>}</div>
}

/** The opening clip as dsh's page plays it: a 像素动画, a skin's clip, or one from the 素材库. */
function introOf(skins: SkinsView): { pixel?: string; url?: string } {
  const source = skins.intro.source
  if (source.startsWith('pixel:')) return { pixel: source.slice('pixel:'.length) }
  if (source === 'skin') {
    const skin = skins.skins.find(s => s.id === skins.current)
    return skin?.intro === undefined ? {} : { url: `/api/dsh-her/web/skin-file?id=${encodeURIComponent(skin.id)}&f=${encodeURIComponent(skin.intro)}` }
  }
  return { url: `/api/dsh-her/web/library-file?row=intro&name=${encodeURIComponent(source)}` }
}

export function IntroAndBackground({ state, go }: { state: StateView; go: (section: 'pixels' | 'skin') => void }) {
  const [pixels, setPixels] = useState<PixelsView>()
  const [skins, setSkins] = useState<SkinsView>()
  const [note, setNote] = useState<string>()
  const load = useCallback(async () => {
    const [p, s] = await Promise.all([herApi.pixelsGet(), herApi.skinsGet()])
    if (p.ok) setPixels(p)
    if (s.ok) setSkins(s)
  }, [])
  useEffect(() => { void load() }, [load])
  if (pixels === undefined || skins === undefined) return null

  const intro = skins.intro
  const clip = introOf(skins)
  const bg = pixels.background
  const nameOf = (id: string) => pixels.items.find(i => i.id === id)?.name ?? id
  const setIntro = (change: Record<string, unknown>) => void herApi.introSet(change).then(() => load())
  const setBg = (change: Record<string, unknown>) => void herApi.pixelsBackground(change).then(r => {
    if (r.ok) setPixels(r)
  })
  const conversation = state.talk.current
  const where = intro.dsh ? '她在桌面上出场、打开 dsh 网页时' : '她在桌面上出场时'

  return (
    <section className="her-card">
      <div className="her-card-head">
        <h2>开机和背景</h2>
        <button className="her-btn small" onClick={() => go('pixels')}>去像素动画页</button>
      </div>
      <div className="her-ov-two">
        <div className="her-ov-box">
          <div className={`her-ov-stage${intro.on ? '' : ' off'}`}>
            {clip.pixel !== undefined
              ? <Loop id={clip.pixel} look={intro.look} />
              : clip.url !== undefined ? <video src={clip.url} muted loop autoPlay playsInline /> : <span className="her-faint">这套皮肤没有开机动画</span>}
            {!intro.on && <span className="her-ov-offmark">关着</span>}
          </div>
          <div className="her-setrow">
            <div><b>开机动画</b><span>{intro.on ? `${where}播，${intro.when === 'every' ? '每次' : '每天第一次'}` : '关着，她出场时不播'}</span></div>
            <input type="checkbox" aria-label="开机动画开着" checked={intro.on} onChange={e => setIntro({ on: e.target.checked })} />
          </div>
          <div className="her-row" style={{ margin: 0 }}>
            <select className="her-select" aria-label="用哪个开机动画" value={intro.source} onChange={e => setIntro({ source: e.target.value, on: true })}>
              <option value="skin">{skins.skinIntro ? '皮肤自带的视频' : '皮肤自带的（这套没有）'}</option>
              {skins.introClips.map(c => <option key={c.name} value={c.name}>视频：{c.name}</option>)}
              {pixels.items.map(item => <option key={item.id} value={`pixel:${item.id}`}>像素：{item.name}</option>)}
            </select>
            <button className="her-btn small" disabled={clip.pixel === undefined && clip.url === undefined} onClick={() => showIntro(clip.pixel !== undefined ? { pixel: { id: clip.pixel, look: intro.look }, when: 'every' } : { url: clip.url!, when: 'every' })}>▶ 放一遍</button>
          </div>
        </div>

        <div className="her-ov-box">
          <div className={`her-ov-stage her-ov-chat${bg.on ? '' : ' off'}`}>
            <Loop id={bg.id} look={bg.look} opacity={bg.opacity} />
            <div className="her-ov-lines" aria-hidden="true"><i /><i className="me" /><i /><i className="short" /></div>
            {!bg.on && <span className="her-ov-offmark">关着</span>}
          </div>
          <div className="her-setrow">
            <div><b>dsh 对话背景</b><span>{bg.on ? `「${nameOf(bg.id)}」在对话后面淡淡地播（浓度 ${Math.round(bg.opacity * 100)}%）` : '关着'}</span></div>
            <input type="checkbox" aria-label="对话背景开着" checked={bg.on} onChange={e => setBg(e.target.checked && !bg.on && !bg.triggers.open && !bg.triggers.reply && !bg.triggers.loop ? { on: true, triggers: { click: true, open: true, reply: true } } : { on: e.target.checked })} />
          </div>
          <div className="her-row" style={{ margin: 0 }}>
            <select className="her-select" aria-label="用哪个对话背景" value={bg.id} onChange={e => setBg({ id: e.target.value })}>
              {pixels.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="her-btn small" disabled={!bg.on || conversation === null || window.__herOpenSession === undefined} title={conversation === null ? '还没有和她的对话' : '打开和她的对话，背景先放一遍'} onClick={() => {
              if (!showPixelBackground(bg)) return setNote('这个浏览器不播背景（手机上、开了"减少动态效果"时不播）。')
              window.__herOpenSession?.(conversation!)
            }}>▶ 去对话里看</button>
          </div>
        </div>
      </div>
      {note !== undefined && <p className="her-muted">{note}</p>}
      <p className="her-faint">想要自己的：去「像素动画」点「🎲 做一个」，掷骰子、跟 AI 说，或者用一张图、一段视频。</p>
    </section>
  )
}

type Section = 'persona' | 'voice' | 'memory' | 'look' | 'stage' | 'library' | 'guide' | 'skin' | 'pixels' | 'designs' | 'workshop' | 'speak' | 'initiative' | 'talk' | 'model' | 'about'

export interface Tile {
  to: Section
  icon: string
  label: string
  value: string
  /** A plain on/off this page has, changed right here. */
  toggle?: { on: boolean; set: (on: boolean) => void; disabled?: boolean }
}

/** Every page, grouped as the menu is, with what it is set to now. */
export function AllSettings({ groups, go, foot }: { groups: Array<{ title: string; tiles: Tile[] }>; go: (to: Section) => void; foot?: string }) {
  return (
    <section className="her-card">
      <h2>全部设置</h2>
      {groups.map(group => (
        <div key={group.title} className="her-ov-group">
          <div className="her-ov-title">{group.title}</div>
          <div className="her-tiles">
            {group.tiles.map(tile => (
              <div key={tile.label} className={`her-tile her-ov-tile${tile.toggle === undefined ? '' : ' has-toggle'}`}>
                <button className="her-ov-go" onClick={() => go(tile.to)} aria-label={`${tile.label}：${tile.value}`}>
                  <Icon name={tile.icon} />
                  <span className="her-tile-label">{tile.label}</span>
                  <span className="her-tile-value" title={tile.value}>{tile.value}</span>
                </button>
                {tile.toggle !== undefined && (
                  <input type="checkbox" aria-label={`${tile.label}开关`} checked={tile.toggle.on} disabled={tile.toggle.disabled} onChange={e => tile.toggle!.set(e.target.checked)} />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {foot !== undefined && <p className="her-faint">{foot}</p>}
    </section>
  )
}
