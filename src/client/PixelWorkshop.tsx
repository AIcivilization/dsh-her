/**
 * 像素工坊 (docs/像素工坊设计.md): a draft of a 像素动画, playing all the
 * time; its look (style, colour, size) changed at once without touching the
 * code; grid, frame rate and length written into the file as one line; a
 * version for each change, any of them a click away; the die, the AI and a
 * picture to start from. Kept simple: three ways in, two ways to use it.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { herApi, type ChatView, type DraftView } from './api.ts'
import { inkOf, PixelFrame, probePixel } from './pixel/host.ts'
import { FACES, hslHex, rollDice, type DiceRoll } from '../core/pixel-dice.ts'
import { cleanLook, codeBytes, PIXEL_SIZES, sizeText, STYLE_NAME, PIXEL_STYLES, type PixelInfo, type PixelLook } from '../core/pixel.ts'
import { describeChange, infoOverride, withInfo, withoutInfo, WORKSHOP_FPS, WORKSHOP_GRIDS, type InfoChange } from '../core/pixel-workshop.ts'
import type { Picture } from '../core/pixel-picture.ts'
import { MOTIONS, pictureCode, readPictureFile, type Motion } from '../core/pixel-motion.ts'
import { PICTURE_ACCEPT, PicturePixel, sortSources, VIDEO_ACCEPT, type SourceKind } from './PicturePixel.tsx'
import { PixelExport } from './PixelExport.tsx'
import { readGifSource, type GifSource } from '../core/pixel-gif.ts'
import { withBrand } from '../core/pixel-brand.ts'
import { showIntro } from './intro-show.ts'
import { showPixelBackground } from './pixel-bg.ts'

type Note = { kind: 'ok' | 'error'; text: string; chat?: boolean }

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
function Stage({ code, look, round, empty }: { code: string; look: PixelLook; round: number; empty: ReactNode }) {
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
      {code === '' && <div className="her-ws-empty">{empty}</div>}
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

export function PixelWorkshop({ id, onClose, files }: { id: string; onClose: () => void; files?: File[] }) {
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
  const [pictureFiles, setPictureFiles] = useState<File[]>()
  const [gifOffer, setGifOffer] = useState<{ source: GifSource; files: File[] }>()
  const [exporting, setExporting] = useState(false)
  const [dropping, setDropping] = useState(false)
  const picturePick = useRef<HTMLInputElement>(null)
  const videoPick = useRef<HTMLInputElement>(null)
  const [pictureLeft, setPictureLeft] = useState<string>()
  const sayBox = useRef<HTMLTextAreaElement>(null)
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

  /** Pictures or a video to turn; a GIF made here (its file inside) is offered as its file first. */
  const pickFiles = useCallback(async (list: File[]) => {
    const { files: chosen, left } = sortSources(list)
    if (chosen.length === 0) return
    setGifOffer(undefined)
    setPictureLeft(left)
    if (chosen.length === 1 && chosen[0]!.type === 'image/gif' && chosen[0]!.size < 30 * 1024 * 1024) {
      const source = readGifSource(new Uint8Array(await chosen[0]!.arrayBuffer()))
      if (source !== undefined) return setGifOffer({ source, files: chosen })
    }
    setPictureFiles(chosen)
  }, [])
  const brought = useRef(false)
  useEffect(() => {
    if (brought.current || files === undefined || files.length === 0) return
    brought.current = true
    void pickFiles(files)
  }, [files, pickFiles])

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
    const url = URL.createObjectURL(new Blob([withBrand(draft.code)], { type: 'text/javascript' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${(name.trim() || draft.name).replace(/[\\/:*?"<>|]/g, '')}.js`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /** The opening clip: on, also when a dsh page opens, and shown right now. */
  const useAsIntro = () => saveAnd(async pixel => {
    const r = await herApi.introSet({ source: `pixel:${pixel}`, look, on: true, dsh: true })
    if (!r.ok) return { kind: 'error', text: r.message }
    showIntro({ pixel: { id: pixel, look }, when: 'every' })
    const big = size > PIXEL_SIZES.intro ? `这个动画约 ${sizeText(size)}，当开机动画建议 200 KB 以内：她每次出场都要先把它读进来、跑起来，小一点开得快（格子矮一点、帧少一点就小了）。` : ''
    return { kind: 'ok', text: `开机动画换成「${name.trim() || draft.name}」了，刚才先放了一遍。以后她在桌面上出场、打开 dsh 网页时都会播（${r.intro.when === 'every' ? '每次' : '每天第一次'}）。多久播一次在「像素动画」页里改。${big}` }
  })
  /** The chat background: on, and when it was off, played at more times than a click, so it is seen. */
  const useAsBackground = () => saveAnd(async pixel => {
    const before = await herApi.pixelsGet()
    const wasOff = !before.ok || !before.background.on
    const r = await herApi.pixelsBackground({ on: true, id: pixel, look, ...(wasOff ? { triggers: { click: true, open: true, reply: true } } : {}) })
    if (!r.ok) return { kind: 'error', text: r.message }
    const shown = showPixelBackground(r.background)
    const when = [r.background.triggers.loop ? '一直在播' : '', r.background.triggers.open ? '打开 dsh 时' : '', r.background.triggers.reply ? 'dsh 回答完' : '', r.background.triggers.click ? '点一下对话空白处' : '', r.background.triggers.send ? '你发出消息' : ''].filter(Boolean)
    return {
      kind: 'ok',
      chat: shown,
      text: `dsh 对话背景换成「${name.trim() || draft.name}」了。它在对话的后面淡淡地播：${when.join('、') || '现在什么时候都不播，去「像素动画」页勾上'}。${shown ? '打开任何一个对话就会先放一遍。' : '手机上、开了"减少动态效果"时不播。'}`,
    }
  })

  /** A picture made into a pixel picture: a new version with it floating, and a word in the chat. */
  const takePicture = async (picture: Picture, kind: SourceKind) => {
    const label = (pictureFiles?.[0]?.name ?? '图片').replace(/\.[^.]+$/, '').slice(0, 30) || '图片'
    const pictureLook: PixelLook = picture.palette === undefined ? look : { ...look, style: 'blocks' }
    const many = picture.frames.length > 1 ? `，${picture.frames.length} 帧` : ''
    const from = kind === 'video' ? '🎬 视频转的像素动画' : kind === 'gif' ? '🖼 动图转的像素动画' : kind === 'pictures' ? '🖼 几张图转的像素动画' : '🖼 图片转的像素图'
    const added = take(await herApi.draftAdd(id, pictureCode(picture, label), `${from}（${picture.w} × ${picture.h}${many}）`, pictureLook))
    if (added === undefined) return
    setLook(pictureLook)
    setPictureFiles(undefined)
    if (autoName.current) {
      setName(label)
      take(await herApi.draftSet(id, { name: label, auto: true }))
    }
    const r = await herApi.chatNote(id, `${kind === 'video' ? '🎬 视频' : '🖼'}转成了像素${many === '' ? '图' : '动画'}（${picture.w} × ${picture.h} 格${many}），放进了 v${added.current}，现在轻轻浮着。点画面下面「动起来」换个动作；想要别的，在下面说，比如：眨眨眼、挥挥手。`)
    if (r.ok) setChat(r.chat)
  }

  /** The file a GIF made here carried: a new version, with the look it was made with. */
  const openGifSource = async (source: GifSource) => {
    setGifOffer(undefined)
    const sourceLook = source.look === undefined ? look : cleanLook(source.look, look)
    const added = take(await herApi.draftAdd(id, source.code, `📥 从 GIF${source.name === '' ? '' : `「${source.name}」`}里取出的动画文件`, sourceLook))
    if (added === undefined) return
    setLook(sourceLook)
    if (autoName.current && source.name !== '') {
      setName(source.name)
      take(await herApi.draftSet(id, { name: source.name, auto: true }))
    }
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
  const at = draft.versions.findIndex(v => v.n === draft.current)
  const pickVersion = (n: number) => {
    clearTimeout(lookTimer.current)
    void herApi.draftPick(id, n).then(r => { const d = take(r); if (d !== undefined) setLook(d.look) })
  }
  // A file made from pictures: its picture, to move it another way with a click.
  const read = draft.code === '' ? undefined : readPictureFile(draft.code)
  const pic = read === undefined ? undefined : {
    ...read,
    // Not as made here: the AI (or a person) has changed it since.
    changed: read.motion === undefined || pictureCode(read.picture, read.name, read.motion).trimEnd() !== withoutInfo(draft.code),
  }
  const move = (motion: Motion, each?: number) => {
    if (read === undefined) return
    const picture = each === undefined ? read.picture : { ...read.picture, each }
    const made = pictureCode(picture, read.name || draft.name, motion)
    // The workshop's own settings (grid, frame rate, length) stay.
    const over = infoOverride(draft.code)
    clearTimeout(lookTimer.current)
    const note = each === undefined ? `🕺 动起来：${MOTIONS.find(m => m.id === motion)!.name}` : `🕺 每帧 ${each} 秒`
    void herApi.draftAdd(id, Object.keys(over).length > 0 ? withInfo(made, over) : made, note, look).then(take)
  }
  const start = (
    <div className="her-ws-start">
      <p>从哪儿开始？<span>图片、视频也可以直接拖进来</span></p>
      <div className="her-ws-tiles">
        <button className="main" onClick={() => picturePick.current?.click()}><i>🖼</i><b>用图片</b><small>照片、几张图或动图</small></button>
        <button className="main" onClick={() => videoPick.current?.click()}><i>🎬</i><b>用视频</b><small>选其中几秒</small></button>
        <button onClick={roll}><i>🎲</i><b>掷骰子</b><small>随机出一个</small></button>
        <button onClick={() => sayBox.current?.focus()}><i>💬</i><b>跟 AI 说</b><small>说你想要的画面</small></button>
      </div>
    </div>
  )
  // What sits on top: a GIF made here to open, a picture or video being turned, the start, or the draft playing.
  const top = gifOffer !== undefined ? (
    <div className="her-ws-picture">
      <div className="her-ws-picture-head">
        <b>这张 GIF 是用 dsh-her 做的{gifOffer.source.name === '' ? '' : `「${gifOffer.source.name}」`}</b>
        <button className="her-btn small" onClick={() => setGifOffer(undefined)}>不用了</button>
      </div>
      <span className="her-muted">里面带着它的动画文件，可以接着改。文件是别人写的代码，也只在隔离的环境里跑。</span>
      <span className="her-row" style={{ margin: 0 }}>
        <button className="her-btn primary" onClick={() => void openGifSource(gifOffer.source)}>打开它的文件接着改</button>
        <button className="her-btn" onClick={() => { setPictureFiles(gifOffer.files); setGifOffer(undefined) }}>当普通动图转像素</button>
      </span>
    </div>
  ) : pictureFiles !== undefined
    ? <PicturePixel files={pictureFiles} {...(pictureLeft === undefined ? {} : { left: pictureLeft })} onUse={takePicture} onCancel={() => setPictureFiles(undefined)} />
    : draft.code === '' ? start : undefined
  const grid = info?.grid
  const mono = info === undefined || info.color === 'mono'
  const size = codeBytes(draft.code)
  // Why the buttons at the bottom cannot be used yet: said, not just greyed out.
  const waiting = pictureFiles !== undefined
    ? '上面转好的还没放进草稿：先点「放进草稿」，才能保存、当开机动画、当背景、导出。'
    : gifOffer !== undefined ? '先选上面那张 GIF 怎么用。'
      : draft.code === '' ? '还没有画面：先用图片、视频、骰子或者跟 AI 说做一个，才能保存、当开机动画、当背景、导出。' : undefined

  return (
    <section
      className={`her-card${dropping ? ' her-dropping' : ''}`}
      onDragOver={e => {
        if (![...e.dataTransfer.items].some(item => item.kind === 'file')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDropping(false) }}
      onDrop={e => {
        e.preventDefault()
        setDropping(false)
        void pickFiles([...e.dataTransfer.files])
      }}
    >
      <div className="her-card-head">
        <h2>像素工坊</h2>
        <button className="her-btn small" onClick={onClose}>← 返回像素动画</button>
      </div>
      <div className="her-ws">
        <div className="her-ws-main">
          {top}
          {draft.code !== '' && <div hidden={top !== undefined}><Stage code={draft.code} look={look} round={round} empty={null} /></div>}
          {draft.versions.length > 0 && (
            <>
              <div className="her-vnav" role="group" aria-label="版本">
                <button title="上一版" disabled={at <= 0} onClick={() => pickVersion(draft.versions[at - 1]!.n)}>‹</button>
                <select className="her-select" aria-label="第几版" value={draft.current} onChange={e => pickVersion(Number(e.target.value))}>
                  {draft.versions.map(v => <option key={v.n} value={v.n}>v{v.n}　{v.note.slice(0, 40)}</option>)}
                </select>
                <button title="下一版" disabled={at >= draft.versions.length - 1} onClick={() => pickVersion(draft.versions[at + 1]!.n)}>›</button>
                <button title="从头再播一遍" onClick={() => setRound(r => r + 1)}>↻</button>
              </div>
              <p className="her-faint">v{draft.current}：{current?.note || '—'}{info === undefined ? '' : ` · ${info.grid[0]} × ${info.grid[1]} · 每秒 ${info.fps} 帧 · ${info.seconds > 0 ? `${info.seconds} 秒一遍` : '一直循环'} · ${sizeText(size)}`}</p>
            </>
          )}
          {pic !== undefined && (
            <div className="her-ws-move">
              <b>动起来</b>
              <span className="her-seg wrap" role="group" aria-label="动起来">
                {MOTIONS.map(m => <button key={m.id} title={m.about} className={pic.motion === m.id ? 'on' : ''} onClick={() => move(m.id)}>{m.name}</button>)}
              </span>
              {pic.picture.frames.length > 1 && (
                <span className="her-row" style={{ margin: 0 }}>
                  <span className="her-muted">{pic.picture.frames.length} 帧，每帧 {pic.picture.each ?? 0.1} 秒</span>
                  <span className="her-seg" role="group" aria-label="换帧快慢">
                    <button onClick={() => move(pic.motion ?? 'still', Math.min(2, Math.round((pic.picture.each ?? 0.1) * 1.4 * 1000) / 1000))}>慢一点</button>
                    <button onClick={() => move(pic.motion ?? 'still', Math.max(0.03, Math.round((pic.picture.each ?? 0.1) / 1.4 * 1000) / 1000))}>快一点</button>
                  </span>
                </span>
              )}
              {pic.changed && <span className="her-faint">这一版 AI 改过：换动作会从原图重新做，AI 改的地方要再跟它说一次（也可以用 ‹ 回到这一版）。</span>}
            </div>
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
              ref={sayBox}
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
          {size > PIXEL_SIZES.aiHeavy && (
            <p className="her-ws-heavy">
              这一版约 {sizeText(size)}。{size > PIXEL_SIZES.aiTooBig ? 'AI 改不了这么大的文件' : 'AI 改起来会又贵又慢'}：它要先读完整个文件，改完再整个写回来；100 多 KB 的文件光读就要几万个 token，写回来超过了模型一次能写的长度。换动作用左边的「动起来」，不经过 AI；想让 AI 改，把格子调矮、帧数调少再转一次。
            </p>
          )}
          <p className="her-faint">用的是你在 dsh 里选的模型。AI 交来的代码先在隔离的环境里试跑，通过了才存成新的一版。</p>
        </div>

        <div className="her-ws-side">
          <div className="her-ws-dice">
            <button className={`her-die${die.rolling ? ' rolling' : ''}`} onClick={roll} disabled={die.rolling} aria-label="掷骰子">{die.face}</button>
            <div>
              <b>掷骰子</b>
              <span className="her-muted">{die.said ?? '六个面，六个方向，每次都不一样。'}</span>
            </div>
            <span className="her-row" style={{ margin: 0, marginLeft: 'auto', flex: 'none' }}>
              <button className="her-btn small" onClick={() => picturePick.current?.click()}>🖼 用图片</button>
              <button className="her-btn small" onClick={() => videoPick.current?.click()}>🎬 用视频</button>
            </span>
            <input ref={picturePick} type="file" multiple accept={PICTURE_ACCEPT} hidden onChange={e => { const list = [...(e.target.files ?? [])]; e.target.value = ''; void pickFiles(list) }} />
            <input ref={videoPick} type="file" accept={VIDEO_ACCEPT} hidden onChange={e => { const list = [...(e.target.files ?? [])]; e.target.value = ''; void pickFiles(list) }} />
          </div>

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
          <details className="her-more her-ws-fold">
            <summary>更多设置：格子、时长、快慢、大小</summary>
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
          </details>
        </div>
      </div>

      {exporting && draft.code !== '' && <PixelExport code={draft.code} name={name.trim() || draft.name} look={look} onClose={() => setExporting(false)} />}
      <div className="her-ws-foot">
        <input className="her-input" aria-label="名字" value={name} maxLength={40} onChange={e => setName(e.target.value)} onBlur={e => rename(e.target.value)} />
        <button className="her-btn primary" disabled={busy || waiting !== undefined} title={waiting ?? '存进像素动画列表；以后再存就是更新它'} onClick={() => void saveAnd()}>{busy ? '正在试跑…' : draft.saved === undefined ? '💾 保存' : '💾 保存（更新）'}</button>
        <button className="her-btn" disabled={busy || waiting !== undefined} title={waiting} onClick={() => void useAsIntro()}>当开机动画</button>
        <button className="her-btn" disabled={busy || waiting !== undefined} title={waiting} onClick={() => void useAsBackground()}>当 dsh 对话背景</button>
        <button className={`her-btn${exporting ? ' on' : ''}`} disabled={waiting !== undefined} title={waiting} onClick={() => setExporting(x => !x)}>📤 导出 GIF</button>
        <details className="her-ws-menu">
          <summary className="her-btn">更多</summary>
          <div>
            <button className="her-btn small" disabled={draft.code === ''} onClick={exportJs}>导出 .js</button>
            <button className="her-btn small" onClick={() => {
              if (window.confirm('扔掉这个草稿？它的所有版本会放进 pixel-drafts/.removed，不会直接删掉；已经存进像素动画的不受影响。')) void herApi.draftRemove(id).then(onClose)
            }}>扔掉草稿</button>
          </div>
        </details>
      </div>
      {waiting !== undefined && <p className="her-muted her-ws-waiting">{waiting}</p>}
      {note !== undefined && (
        <p className={note.kind === 'ok' ? 'her-ok' : 'her-danger'}>
          {note.text}
          {note.chat === true && window.__herOpenSession !== undefined && <> <button className="her-btn small" onClick={() => void openInDsh()}>去对话里看看</button></>}
        </p>
      )}
      <p className="her-faint">草稿会自己存着，每一次改动都是新的一版，用 ‹ › 回到任意一版。</p>
    </section>
  )
}
