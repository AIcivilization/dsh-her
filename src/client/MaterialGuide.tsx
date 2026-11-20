/**
 * 素材指南 (docs/设置页与编排设计.md §14): what to make for her, each with
 * its size, its rules and a prompt to copy. The same entries as
 * docs/素材规格与提示词.md (src/core/material-guide.ts). Your character's
 * description is typed once here and goes into every prompt.
 */

import { useEffect, useState } from 'react'
import { adapt, DEFAULT_WHO, GUIDE, GUIDE_GROUPS, GUIDE_STYLES, guideMarkdown, isWhale, MUST, promptFor, purposeLine, STYLE_LABEL, VIDEO_RULES, type GuideGroup, type GuideItem, type GuideStyle } from '../core/material-guide.ts'
import { Icon } from './icons.tsx'

/** Copy text, also on a page without HTTPS (no clipboard API there). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the old way
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

function CopyButton({ text, label = '复制提示词', primary = true }: { text: string; label?: string; primary?: boolean }) {
  const [done, setDone] = useState<'ok' | 'no'>()
  useEffect(() => {
    if (done === undefined) return
    const timer = setTimeout(() => setDone(undefined), 1800)
    return () => clearTimeout(timer)
  }, [done])
  return (
    <button className={`her-btn small${primary ? ' primary' : ''}`} onClick={() => void copyText(text).then(ok => setDone(ok ? 'ok' : 'no'))}>
      <Icon name={done === 'ok' ? 'check' : 'copy'} size={15} />{done === 'ok' ? '已复制' : done === 'no' ? '复制不了，请手动选中' : label}
    </button>
  )
}

/** The character's description, per character and template (each template's is kept apart). */
const whoKey = (cid: string, style: GuideStyle) => `dsh-her.guide.who.${cid}${style === 'anime' ? '' : `.${style}`}`
const STYLE_KEY = 'dsh-her.guide.style'
const readWho = (cid: string, style: GuideStyle) => {
  try {
    return localStorage.getItem(whoKey(cid, style)) ?? DEFAULT_WHO[style]
  } catch {
    return DEFAULT_WHO[style]
  }
}

export function MaterialGuide({ cid, onLibrary, onSkin, onPixels }: { cid: string; onLibrary: () => void; onSkin: () => void; onPixels?: () => void }) {
  const [style, setStyle] = useState<GuideStyle>(() => {
    try {
      const kept = localStorage.getItem(STYLE_KEY)
      return GUIDE_STYLES.find(st => st === kept) ?? 'anime'
    } catch {
      return 'anime'
    }
  })
  const [who, setWho] = useState(() => readWho(cid, style))
  const chooseStyle = (next: GuideStyle) => {
    setStyle(next)
    setWho(readWho(cid, next))
    try {
      localStorage.setItem(STYLE_KEY, next)
    } catch {
      // kept until the page closes
    }
  }
  const [group, setGroup] = useState<GuideGroup>('base')
  const [purpose, setPurpose] = useState(() => {
    try {
      return localStorage.getItem('dsh-her.guide.purpose') !== 'off'
    } catch {
      return true
    }
  })
  const choosePurpose = (on: boolean) => {
    setPurpose(on)
    try {
      localStorage.setItem('dsh-her.guide.purpose', on ? 'on' : 'off')
    } catch {
      // kept until the page closes
    }
  }
  const save = (text: string) => {
    setWho(text)
    try {
      if (text === DEFAULT_WHO[style]) localStorage.removeItem(whoKey(cid, style))
      else localStorage.setItem(whoKey(cid, style), text)
    } catch {
      // private window: kept until the page closes
    }
  }
  const current = GUIDE_GROUPS.find(g => g.id === group)!
  return (
    <div className="her-guide">
      <section className="her-card">
        <h2>她的样子由你来做</h2>
        <p className="her-muted">我们不替你生成图片和视频，只告诉你要做哪些、多大、有什么要求。把提示词复制到你常用的工具里（生图：Gemini、ChatGPT、即梦；图生视频：可灵、即梦、海螺、Vidu，要支持首尾帧），做好后传到素材库。</p>
        <ol className="her-flow">
          <li><b>先定人</b><span>做「定妆照」，多抽几次，挑最满意的一张。</span></li>
          <li><b>做三视图</b><span>正面、侧面、背面。传到素材库，它会出现在总览里。</span></li>
          <li><b>其余都从三视图派生</b><span>做图时把三视图传给工具当参考；做视频时先有图，再用它当首帧和尾帧。</span></li>
          <li><b>传到素材库，在编排里摆好</b><span>每条下面写了传到哪儿、放进哪个场景。</span></li>
        </ol>
        <p className="her-faint">不用一次做完。最少只要一张「头像·站姿图」和一张「宠物·站姿图」（或「桌面·场景图」），她就能出现。</p>
        <p className="her-faint">想找灵感：去 <a href="https://treapgogo.github.io/deepseek-whale-girl/" target="_blank" rel="noreferrer">鲸鱼娘开源资产库</a> 看看（社区资源，不是我们做的；每件作品的许可不一样，用之前先看清楚）。</p>
      </section>

      <section className="her-card">
        <div className="her-row">
          <h2 style={{ flex: 1, margin: 0 }}>你的人物</h2>
          <span className="her-seg wrap" role="group" aria-label="模版">
            {GUIDE_STYLES.map(st => <button key={st} className={style === st ? 'on' : ''} aria-pressed={style === st} onClick={() => chooseStyle(st)}>{STYLE_LABEL[st]}</button>)}
          </span>
          {who !== DEFAULT_WHO[style] && <button className="her-btn small" onClick={() => save(DEFAULT_WHO[style])}>换回默认的{STYLE_LABEL[style]}</button>}
        </div>
        <p className="her-muted">六套初始模版：二次元、真人（Cosplay 摄影）、Q版、像素四种鲸鱼娘，加真人女友和真人男友，各有自己的场景和开机画面，下面每条提示词跟着切换。选一套最接近的，再把人物设定改成你的。写一次，每条提示词里的人物设定都会换成它；派生的图只写动作和场景，外貌交给参考图，所以这段主要用在定妆照和三视图上。</p>
        <textarea className="her-textarea" rows={9} value={who} onChange={e => save(e.target.value)} aria-label="你的人物设定" />
        {style === 'pixel' && (
          <div className="her-setrow">
            <div><b>像素风记得打开「像素化显示」</b><span>生图、生视频工具做出来的像素画常常有点糊、格子会跳。在「像素动画」页打开「像素化显示」，她在屏幕上就是干净整齐的像素格；开机动画也可以直接用自带的「鲸尾出水」像素动画。</span></div>
            {onPixels !== undefined && <button className="her-btn" onClick={onPixels}>去设置</button>}
          </div>
        )}
        {isWhale(style) && <p className="her-faint"><b>鲸鱼娘的每条提示词都带着：</b>{MUST.replace('必须保留这三样：', '')}{who === DEFAULT_WHO[style] ? '' : '（换成你自己的人物后就不再加，按你的设定来）'}</p>}
        <div className="her-setrow">
          <div><b>提示词前面加一句用途说明</b><span>「{purposeLine(who, style)}」：让生图、生视频的工具知道这是做什么用的。每条提示词后面都已经带上了尺寸（视频还有时长）。</span></div>
          <input type="checkbox" aria-label="提示词前面加一句用途说明" checked={purpose} onChange={e => choosePurpose(e.target.checked)} />
        </div>
        <div className="her-row">
          <CopyButton text={guideMarkdown(who === DEFAULT_WHO[style] ? undefined : who, style)} label="复制整份文档（Markdown）" primary={false} />
          <a className="her-btn small" href="https://github.com/AIcivilization/dsh-her/blob/main/docs/素材规格与提示词.md" target="_blank" rel="noreferrer">在网上看这份文档</a>
        </div>
      </section>

      <div className="her-choices her-guide-tabs" role="tablist" aria-label="素材的种类">
        {GUIDE_GROUPS.map(g => (
          <button key={g.id} role="tab" aria-selected={g.id === group} className={`her-pick${g.id === group ? ' on' : ''}`} onClick={() => setGroup(g.id)}>
            {g.title.replace(/^.、/, '').replace(/（.*$/, '')}<small>{GUIDE.filter(i => i.group === g.id).length}</small>
          </button>
        ))}
      </div>
      <p className="her-muted her-guide-about">{adapt(current.about, style)}</p>

      {GUIDE.filter(item => item.group === group).map(item => <GuideCard key={item.id} item={item} who={who} style={style} purpose={purpose} onGo={item.group === 'skin' || item.group === 'intro' ? onSkin : onLibrary} />)}

      <section className="her-card">
        <h2>每一段视频都要遵守</h2>
        <ul className="her-guide-rules">{VIDEO_RULES.map(rule => <li key={rule}>{rule}</li>)}</ul>
        <h2>透明背景怎么来</h2>
        <p className="her-muted">视频工具一般出不了透明视频。生成时用纯绿色背景（提示词里已经写了），人物身上不要有绿色；传到素材库后，在那个素材上点「抠掉背景」，程序会另存一个带透明的，原来的留着。</p>
      </section>
    </div>
  )
}

function GuideCard({ item, who, style, purpose, onGo }: { item: GuideItem; who: string; style: GuideStyle; purpose: boolean; onGo: () => void }) {
  const prompt = promptFor(item, who, purpose, style)
  const text = (s: string) => adapt(s, style)
  return (
    <section className="her-card her-guide-item">
      <div className="her-row her-guide-head">
        <h2>{text(item.title)}</h2>
        <span className={`her-tag${item.tool === '生图' ? '' : ' ok'}`}>{item.tool}</span>
      </div>
      <p className="her-muted">{text(item.where)}</p>
      <dl className="her-spec">
        <div><dt>尺寸</dt><dd>{item.size}</dd></div>
        <div><dt>格式</dt><dd>{item.format}</dd></div>
        {item.length !== undefined && <div><dt>时长</dt><dd>{item.length}</dd></div>}
      </dl>
      <ul className="her-guide-rules">{item.rules.map(rule => <li key={rule}>{text(rule)}</li>)}</ul>
      <p><b>怎么做：</b>{text(item.how)}</p>
      <div className="her-prompt">
        <pre>{prompt}</pre>
        <CopyButton text={prompt} />
      </div>
      <div className="her-row her-guide-foot">
        <span className="her-muted"><b>做好后：</b>{text(item.upload)}{item.stage === undefined ? '' : ` 然后：${text(item.stage)}`}</span>
        <span className="her-grow" />
        <button className="her-btn small" onClick={onGo}>{item.group === 'skin' || item.group === 'intro' ? '去皮肤' : '去素材库'}</button>
      </div>
    </section>
  )
}
