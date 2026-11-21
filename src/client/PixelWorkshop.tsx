/**
 * 像素工坊 (docs/像素工坊设计.md): a draft of a 像素动画, playing all the
 * time; its look (style, colour, size) changed at once without touching the
 * code; grid, frame rate and length written into the file as one line; a
 * version for each change, any of them a click away; and the die. Talking to
 * the AI comes next (§3).
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { herApi, type ChatView, type DraftView } from './api.ts'
import { inkOf, PixelFrame, probePixel } from './pixel/host.ts'
import { FACES, hslHex, rollDice, type DiceRoll } from '../core/pixel-dice.ts'
import { STYLE_NAME, PIXEL_STYLES, type PixelInfo, type PixelLook } from '../core/pixel.ts'
import { describeChange, withInfo, WORKSHOP_FPS, WORKSHOP_GRIDS, type InfoChange } from '../core/pixel-workshop.ts'
import { pictureCode, type Picture } from '../core/pixel-picture.ts'
import { PicturePixel } from './PicturePixel.tsx'

type Note = { kind: 'ok' | 'error'; text: string }

const RECENT = 'dsh-her.dice'
/** Things to start from, ours. */
const IDEAS = ['一只小鲸鱼从左边游到右边，一路吐泡泡', '下雪的夜晚，一盏路灯亮着', '一颗跳动的心，跳的时候冒出小星星', '海浪拍上沙滩，留下一个贝壳']
const inkFor = (color: string) => inkOf(color, '--dsw-alias-label-primary')

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string').slice(0, 50) : []
  } catch {
    return []
  }
}
function keepRecent(print: string): string[] {
  const next = [print, ...readRecent()].slice(0, 50)
  try {
    localStorage.setItem(RECENT, JSON.stringify(next))
  } catch {
    // only this page's memory then
  }
  return next
}

/** The draft playing, in one sandbox kept for it: a colour change only changes the ink. */
function Stage({ code, look, round }: { code: string; look: PixelLook; round: number }) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<PixelFrame>()
  const [problem, setProblem] = useState<string>()
  useEffect(() => {
    const f = new PixelFrame()
    frame.current = f
    box.current?.append(f.el)
    f.on(event => {
      if (event.t === 'problem') setProblem(event.problems.join('；'))
      else if (event.t === 'playing') setProblem(undefined)
    })
    return () => {
      f.destroy()
      frame.current = undefined
    }
  }, [])
  useEffect(() => {
    if (code === '') frame.current?.stop()
    else frame.current?.play(code, look, inkFor(look.color), { mode: 'loop', fade: true })
  }, [code, look.style, look.size, look.fit, round])
  useEffect(() => { frame.current?.setInk(inkFor(look.color)) }, [look.color])
  return (
    <div className="her-ws-stage">
      <div ref={box} className="her-ws-frame" />
      {code === '' && <div className="her-ws-empty">点 🎲 掷一次骰子，就有画面了</div>}
      {problem !== undefined && <p className="her-danger her-ws-problem">{problem}</p>}
    </div>
  )
}

/** #rrggbb as hue (0–360), saturation and lightness (0–1). */
function hexHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, Math.min(1, s), l]
}
/** 调色轮: the angle is the hue, the distance from the middle how strong; a slider for how light. Or dsh's own colour. */
function ColorWheel({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  const theme = value === 'theme'
  const [h, s, l] = theme ? [210, 0.7, 0.62] : hexHsl(value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value)
  const wheel = useRef<HTMLDivElement>(null)
  const pick = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = wheel.current?.getBoundingClientRect()
    if (box === undefined) return
    const dx = e.clientX - (box.left + box.width / 2), dy = e.clientY - (box.top + box.height / 2)
    const hue = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360
    const sat = Math.min(1, Math.hypot(dx, dy) / (box.width / 2))
    onPick(hslHex(hue, sat, theme ? 0.62 : l))
  }
  const stops = [0, 60, 120, 180, 240, 300, 360].map(d => `hsl(${d} 90% ${Math.round((theme ? 0.62 : l) * 100)}%)`).join(',')
  const angle = h * Math.PI / 180
  return (
    <div className="her-wheel-box">
      <div
        ref={wheel}
        className={`her-wheel${theme ? ' off' : ''}`}
        style={{ background: `radial-gradient(circle closest-side, hsl(0 0% ${Math.round((theme ? 0.62 : l) * 100)}%), transparent), conic-gradient(${stops})` }}
        role="slider"
        aria-label="颜色"
        aria-valuetext={theme ? '跟着 dsh 的颜色' : value}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pick(e) }}
        onPointerMove={e => { if (e.buttons === 1) pick(e) }}
      >
        {!theme && <i style={{ left: `${50 + Math.sin(angle) * s * 50}%`, top: `${50 - Math.cos(angle) * s * 50}%`, background: value }} />}
      </div>
      <div className="her-wheel-side">
        <label className="her-muted"><input type="checkbox" checked={theme} onChange={e => onPick(e.target.checked ? 'theme' : '#5b9cf0')} /> 跟着 dsh 的颜色</label>
        <span className="her-range"><input type="range" min={30} max={85} disabled={theme} value={Math.round(l * 100)} onChange={e => onPick(hslHex(h, s, Number(e.target.value) / 100))} /><i>亮度</i></span>
        {!theme && <span className="her-wheel-chip" style={{ background: value }}>{value}</span>}
      </div>
    </div>
  )
}

export function PixelWorkshop({ id, onClose }: { id: string; onClose: () => void }) {
  const [draft, setDraft] = useState<DraftView>()
  const [look, setLook] = useState<PixelLook>()
  const [name, setName] = useState('')
  const [info, setInfo] = useState<PixelInfo>()
  const [problems, setProblems] = useState<string[]>()
  const [note, setNote] = useState<Note>()
  const [busy, setBusy] = useState(false)
  const [die, setDie] = useState<{ face: string; rolling: boolean; said?: string }>({ face: '🎲', rolling: false })
  const [round, setRound] = useState(0)
  const lookTimer = useRef<ReturnType<typeof setTimeout>>()
  const autoName = useRef(false)
  const [chat, setChat] = useState<ChatView>()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const msgs = useRef<HTMLDivElement>(null)
  const [pictureFile, setPictureFile] = useState<File>()
  const picturePick = useRef<HTMLInputElement>(null)
  const [, tick] = useState(0)
  const thinkingSince = useRef<number>()

  const take = useCallback((result: Awaited<ReturnType<typeof herApi.draftGet>>) => {
    if (!result.ok) {
      setNote({ kind: 'error', text: result.message })
      return undefined
    }
    setDraft(result.draft)
    return result.draft
  }, [])

  useEffect(() => {
    void herApi.draftGet(id).then(r => {
      const d = take(r)
      if (d === undefined) return
      setLook(d.look)
      setName(d.name)
      autoName.current = d.autoName
    })
  }, [id, take])

  // The chat, asked for every half second while the AI works (every two otherwise). It also brings code
  // the AI handed in: tried here in a sandbox, with three frames drawn in characters, and sent back.
  useEffect(() => {
    let gone = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let draftRev = 0
    const answered = new Set<string>()
    const tick = async () => {
      const r = await herApi.chatView(id)
      if (gone) return
      if (!r.ok) {
        timer = setTimeout(() => void tick(), 3000)
        return
      }
      const c = r.chat
      setChat(prev => (prev?.rev === c.rev ? prev : c))
      if (draftRev !== 0 && c.draftRev !== draftRev) {
        const d = take(await herApi.draftGet(id))
        if (d !== undefined) setLook(d.look)
      }
      draftRev = c.draftRev
      const probe = c.probe
      if (probe !== undefined && !answered.has(probe.req)) {
        answered.add(probe.req)
        void probePixel(probe.code, inkFor('theme'), true).then(result => herApi.chatProbe(id, probe.req, result))
      }
      if (!gone) timer = setTimeout(() => void tick(), c.busy || probe !== undefined ? 500 : 2000)
    }
    void tick()
    return () => {
      gone = true
      clearTimeout(timer)
    }
  }, [id, take])

  useEffect(() => {
    const box = msgs.current
    if (box !== null) box.scrollTop = box.scrollHeight
  }, [chat?.rev])

  // How long the AI has been at it: a model may think for a minute before it answers.
  const working = sending || chat?.busy === true
  useEffect(() => {
    if (!working) {
      thinkingSince.current = undefined
      return
    }
    thinkingSince.current ??= Date.now()
    const timer = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(timer)
  }, [working])

  // What the version shown is: tried in a sandbox of its own.
  useEffect(() => {
    if (draft === undefined || draft.code === '') return setInfo(undefined)
    let gone = false
    void probePixel(draft.code, inkFor('theme')).then(r => {
      if (gone) return
      setInfo(r.info)
      setProblems(r.ok ? undefined : r.problems)
    })
    return () => { gone = true }
  }, [draft?.code])

  if (draft === undefined || look === undefined) return note === undefined ? null : <section className="her-card"><p className="her-danger">{note.text}</p><button className="her-btn" onClick={onClose}>返回</button></section>

  const changeLook = (change: Partial<PixelLook>) => {
    const next = { ...look, ...change }
    setLook(next)
    clearTimeout(lookTimer.current)
    lookTimer.current = setTimeout(() => void herApi.draftSet(id, { look: next }), 400)
  }
  const rename = (value: string) => {
    autoName.current = false
    if (value.trim() !== '' && value.trim() !== draft.name) void herApi.draftSet(id, { name: value.trim() }).then(take)
  }

  const roll = () => {
    if (die.rolling) return
    const result: DiceRoll = rollDice(readRecent())
    keepRecent(result.print)
    setDie({ face: '🎲', rolling: true })
    let k = 0
    const spin = setInterval(() => setDie({ face: FACES[k++ % FACES.length]!.emoji, rolling: true }), 90)
    setTimeout(() => {
      clearInterval(spin)
      const said = `${result.face.emoji} ${result.face.name} · ${result.recipe.name}${result.under === undefined ? '' : `，底下叠着 ${result.under.face.emoji} ${result.under.recipe.name}`}`
      setDie({ face: result.face.emoji, rolling: false, said })
      setLook(result.look)
      void (async () => {
        const added = take(await herApi.draftAdd(id, result.code, `🎲 ${said}`, result.look))
        if (added === undefined || !autoName.current) return
        setName(result.spec.name)
        take(await herApi.draftSet(id, { name: result.spec.name, auto: true }))
      })()
    }, 800)
  }

  const changeInfo = (change: InfoChange) => {
    if (draft.code === '') return
    clearTimeout(lookTimer.current)
    void herApi.draftAdd(id, withInfo(draft.code, change), describeChange(change), look).then(take)
  }

  /** Keep it as a 像素动画 (again, the same one); its id. */
  const save = async (): Promise<string | undefined> => {
    if (draft.code === '') return undefined
    setBusy(true)
    setNote(undefined)
    const tried = await probePixel(draft.code, inkFor('theme'))
    if (!tried.ok || tried.info === undefined) {
      setBusy(false)
      setProblems(tried.problems)
      return undefined
    }
    if (name.trim() !== '' && name.trim() !== draft.name) await herApi.draftSet(id, { name: name.trim() })
    await herApi.draftSet(id, { look })
    const saved = await herApi.draftSave(id, { info: tried.info, ...(tried.thumb === undefined ? {} : { thumb: tried.thumb }), ...(tried.frameMs === undefined ? {} : { frameMs: tried.frameMs }) })
    setBusy(false)
    if (!saved.ok) {
      setNote({ kind: 'error', text: saved.message })
      return undefined
    }
    setDraft(saved.draft)
    return saved.pixel
  }
  const saveAnd = async (then?: (pixel: string) => Promise<Note>) => {
    const pixel = await save()
    if (pixel === undefined) return
    setNote(then === undefined ? { kind: 'ok', text: `存好了：「${name.trim() || draft.name}」，在像素动画列表里。之后再存，就是更新它。` } : await then(pixel))
  }
  const exportJs = () => {
    const url = URL.createObjectURL(new Blob([draft.code], { type: 'text/javascript' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${(name.trim() || draft.name).replace(/[\\/:*?"<>|]/g, '')}.js`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /** A picture made into a pixel picture: a new version with it floating, and a word in the chat. */
  const takePicture = async (picture: Picture) => {
    const label = (pictureFile?.name ?? '图片').replace(/\.[^.]+$/, '').slice(0, 30) || '图片'
    const pictureLook: PixelLook = picture.palette === undefined ? look : { ...look, style: 'blocks' }
    const added = take(await herApi.draftAdd(id, pictureCode(picture, label), `🖼 图片转的像素图（${picture.w} × ${picture.h}）`, pictureLook))
    if (added === undefined) return
    setLook(pictureLook)
    setPictureFile(undefined)
    if (autoName.current) {
      setName(label)
      take(await herApi.draftSet(id, { name: label, auto: true }))
    }
    const r = await herApi.chatNote(id, `🖼 图片转成了像素图（${picture.w} × ${picture.h} 格），放进了 v${added.current}，现在轻轻浮着。想让它怎么动，在下面说，比如：跳一跳、眨眨眼、左右走。`)
    if (r.ok) setChat(r.chat)
  }

  const say = async (text: string) => {
    if (text.trim() === '' || sending) return
    setSending(true)
    setNote(undefined)
    const r = await herApi.chatSend(id, text)
    setSending(false)
    if (!r.ok) return setNote({ kind: 'error', text: r.message })
    setInput('')
    setChat(r.chat)
  }
  const thinking = sending || chat?.busy === true
  const openInDsh = async () => {
    const r = await herApi.chatSession(id)
    if (!r.ok) return setNote({ kind: 'error', text: r.message })
    if (window.__herOpenSession === undefined) setNote({ kind: 'ok', text: '在左侧她的工作区里，打开"做像素动画：…"那段对话。' })
    else window.__herOpenSession(r.sessionId)
  }

  const current = draft.versions.find(v => v.n === draft.current)
  const grid = info?.grid
  const mono = info === undefined || info.color === 'mono'

  return (
    <section className="her-card">
      <div className="her-card-head">
        <h2>像素工坊</h2>
        <button className="her-btn small" onClick={onClose}>← 返回像素动画</button>
      </div>
      <div className="her-ws">
        <div className="her-ws-main">
          <Stage code={draft.code} look={look} round={round} />
          {draft.versions.length > 0 && (
            <>
              <div className="her-vchips" role="group" aria-label="版本">
                {draft.versions.map(v => (
                  <button key={v.n} className={v.n === draft.current ? 'on' : ''} title={v.note} onClick={() => {
                    clearTimeout(lookTimer.current)
                    void herApi.draftPick(id, v.n).then(r => { const d = take(r); if (d !== undefined) setLook(d.look) })
                  }}>v{v.n}</button>
                ))}
                <button title="从头再播一遍" onClick={() => setRound(r => r + 1)}>↻</button>
              </div>
              <p className="her-faint">v{draft.current}：{current?.note || '—'}{info === undefined ? '' : ` · ${info.grid[0]} × ${info.grid[1]} · 每秒 ${info.fps} 帧 · ${info.seconds > 0 ? `${info.seconds} 秒一遍` : '一直循环'}`}</p>
            </>
          )}
          {problems !== undefined && <ul className="her-warnlist">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
        </div>

        <div className="her-ws-chat">
          <div className="her-ws-chat-head">
            <b>和 AI 一起做</b>
            {chat?.sessionId !== undefined && <button className="her-btn small" onClick={() => void openInDsh()}>在 dsh 里看这段对话</button>}
          </div>
          <div className="her-ws-msgs" ref={msgs}>
            {(chat?.items.length ?? 0) === 0 && (
              <div className="her-ws-hello">
                <p>说你想要什么画面，AI 写好代码，在左边播给你看。哪里不好看，接着说，直到满意。</p>
                <div className="her-ws-ideas">{IDEAS.map(idea => <button key={idea} disabled={thinking} onClick={() => void say(idea)}>{idea}</button>)}</div>
              </div>
            )}
            {chat?.items.map((m, i) => <div key={i} className={`her-msg ${m.who}${m.ok === false ? ' bad' : ''}`}>{m.text}</div>)}
            {thinking && <div className="her-msg note">AI 正在做……{thinkingSince.current === undefined ? '' : `${Math.round((Date.now() - thinkingSince.current) / 1000)} 秒`}</div>}
          </div>
          <div className="her-ws-say">
            <textarea
              className="her-textarea"
              rows={2}
              value={input}
              placeholder={draft.code === '' ? '比如：一只小鲸鱼从左边游到右边，吐泡泡' : '哪里不好看？比如：泡泡多一点，游得慢一点'}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void say(input)
                }
              }}
            />
            {chat?.busy === true
              ? <button className="her-btn small" onClick={() => void herApi.chatStop(id).then(r => { if (r.ok) setChat(r.chat) })}>停</button>
              : <button className="her-btn small primary" disabled={sending || input.trim() === ''} onClick={() => void say(input)}>{sending ? '…' : '发送'}</button>}
          </div>
          <p className="her-faint">用的是你在 dsh 里选的模型。AI 交来的代码先在隔离的环境里试跑，通过了才存成新的一版。</p>
        </div>

        <div className="her-ws-side">
          <div className="her-ws-dice">
            <button className={`her-die${die.rolling ? ' rolling' : ''}`} onClick={roll} disabled={die.rolling} aria-label="掷骰子">{die.face}</button>
            <div>
              <b>掷骰子</b>
              <span className="her-muted">{die.said ?? '六个面，六个方向，每次都不一样。'}</span>
            </div>
            <button className="her-btn small" onClick={() => picturePick.current?.click()}>🖼 用图片做</button>
            <input ref={picturePick} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden onChange={e => { const f = e.target.files?.[0]; if (f !== undefined) setPictureFile(f); e.target.value = '' }} />
          </div>
          {pictureFile !== undefined && <PicturePixel file={pictureFile} onUse={takePicture} onCancel={() => setPictureFile(undefined)} />}

          <div className="her-ws-set">
            <b>画法</b>
            <span className="her-seg" role="group" aria-label="画法">
              {PIXEL_STYLES.map(style => <button key={style} className={look.style === style ? 'on' : ''} disabled={!mono} onClick={() => changeLook({ style })}>{STYLE_NAME[style]}</button>)}
            </span>
          </div>
          <div className="her-ws-set">
            <b>颜色</b>
            {mono ? <ColorWheel value={look.color} onPick={color => changeLook({ color })} /> : <span className="her-muted">这是彩色动画，颜色在画面里；想换颜色，跟 AI 说。</span>}
          </div>
          <div className="her-ws-set">
            <b>格子</b>
            <span className="her-seg wrap" role="group" aria-label="格子">
              {WORKSHOP_GRIDS.map(g => <button key={g.label} disabled={draft.code === ''} className={grid?.[0] === g.grid[0] && grid[1] === g.grid[1] ? 'on' : ''} title={`${g.grid[0]} × ${g.grid[1]}`} onClick={() => changeInfo({ grid: g.grid })}>{g.label}</button>)}
            </span>
          </div>
          <div className="her-ws-set">
            <b>时长</b>
            <span className="her-row" style={{ margin: 0 }}>
              <span className="her-seg" role="group" aria-label="时长">
                <button disabled={draft.code === ''} className={info?.seconds === 0 ? 'on' : ''} onClick={() => changeInfo({ seconds: 0 })}>一直循环</button>
                <button disabled={draft.code === ''} className={info !== undefined && info.seconds > 0 ? 'on' : ''} onClick={() => changeInfo({ seconds: info !== undefined && info.seconds > 0 ? info.seconds : 5 })}>播一遍</button>
              </span>
              {info !== undefined && info.seconds > 0 && (
                <span className="her-seg" role="group" aria-label="几秒">
                  {[2, 3, 5, 8].map(sec => <button key={sec} className={info.seconds === sec ? 'on' : ''} onClick={() => changeInfo({ seconds: sec })}>{sec} 秒</button>)}
                </span>
              )}
            </span>
          </div>
          <div className="her-ws-set">
            <b>每秒几帧</b>
            <span className="her-seg" role="group" aria-label="每秒几帧">
              {WORKSHOP_FPS.map(fps => <button key={fps} disabled={draft.code === ''} className={info?.fps === fps ? 'on' : ''} onClick={() => changeInfo({ fps })}>{fps}</button>)}
            </span>
          </div>
          <div className="her-ws-set">
            <b>大小</b>
            <span className="her-row" style={{ margin: 0, flexWrap: 'nowrap' }}>
              <span className="her-seg" role="group" aria-label="大小">
                <button className={look.fit === 'contain' ? 'on' : ''} onClick={() => changeLook({ fit: 'contain' })}>放中间</button>
                <button className={look.fit === 'cover' ? 'on' : ''} onClick={() => changeLook({ fit: 'cover' })}>铺满</button>
              </span>
              {look.fit === 'contain' && <span className="her-range"><input type="range" min={30} max={100} value={Math.round(look.size * 100)} onChange={e => changeLook({ size: Number(e.target.value) / 100 })} /><i>{Math.round(look.size * 100)}%</i></span>}
            </span>
          </div>
        </div>
      </div>

      <div className="her-ws-foot">
        <input className="her-input" aria-label="名字" value={name} maxLength={40} onChange={e => setName(e.target.value)} onBlur={e => rename(e.target.value)} />
        <button className="her-btn primary" disabled={busy || draft.code === ''} onClick={() => void saveAnd()}>{busy ? '正在试跑…' : draft.saved === undefined ? '保存' : '保存（更新）'}</button>
        <button className="her-btn" disabled={busy || draft.code === ''} onClick={() => void saveAnd(async pixel => {
          const r = await herApi.introSet({ source: `pixel:${pixel}`, look })
          return r.ok ? { kind: 'ok', text: `开机动画换成「${name.trim() || draft.name}」了。开机动画的开关和多久播一次在「皮肤」页。` } : { kind: 'error', text: r.message }
        })}>设为开机动画</button>
        <button className="her-btn" disabled={busy || draft.code === ''} onClick={() => void saveAnd(async pixel => {
          const r = await herApi.pixelsBackground({ on: true, id: pixel, look })
          return r.ok ? { kind: 'ok', text: `dsh 对话背景换成「${name.trim() || draft.name}」了，浓淡和什么时候播在像素动画页里调。` } : { kind: 'error', text: r.message }
        })}>设为 dsh 背景</button>
        <button className="her-btn" disabled={draft.code === ''} onClick={exportJs}>导出 .js</button>
        <button className="her-btn" onClick={() => {
          if (window.confirm('扔掉这个草稿？它的所有版本会放进 pixel-drafts/.removed，不会直接删掉；已经存进像素动画的不受影响。')) void herApi.draftRemove(id).then(onClose)
        }}>扔掉草稿</button>
      </div>
      {note !== undefined && <p className={note.kind === 'ok' ? 'her-ok' : 'her-danger'}>{note.text}</p>}
      <p className="her-faint">每掷一次、AI 每改一次、每改一项设置，都存成新的一版，点上面的 v1、v2…… 就能回去。画法、颜色、大小不改代码，马上就变。</p>
    </section>
  )
}
