/**
 * 像素动画 (docs/像素动画设计.md §8): the list (drafts not done first), where
 * they are used (the opening clip, the chat background: each one line with
 * its switch, the rest folded), and, last, uploading one a model wrote and
 * the instructions to give that model. A file is tried in a sandbox before it
 * is kept; what is wrong is said in words to paste back to the model.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { herApi, type PixelsView } from './api.ts'
import type { Apply } from './parts.tsx'
import { inkOf, PixelFrame, probePixel, type Rgb } from './pixel/host.ts'
import { pixelSpec } from '../core/pixel-spec.ts'
import { PixelWorkshop } from './PixelWorkshop.tsx'
import { PixelExport } from './PixelExport.tsx'
import { showIntro } from './intro-show.ts'
import { STYLE_NAME, PIXEL_STYLES, type PixelInfo, type PixelLook, type PixelStyle } from '../core/pixel.ts'

type Note = { kind: 'ok' | 'error'; text: string }
type Item = PixelsView['items'][number]

/** Stills and infos of the ones without (those that come with her), made once in a sandbox. */
const tried = new Map<string, { thumb?: string; info?: PixelInfo }>()

const brandInk = (): Rgb => inkOf('theme', '--dsw-alias-brand-primary')
const describe = (info: PixelInfo | undefined) =>
  info === undefined ? '' : `${info.grid[0]} × ${info.grid[1]} · ${info.seconds > 0 ? `${info.seconds} 秒` : '一直循环'} · ${info.color === 'mono' ? '单色' : '彩色'}`

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

/** A 像素动画 playing in a box on this page, in its sandbox. */
function Preview({ code, look, loop, round }: { code: string; look: PixelLook; loop: boolean; round: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [problem, setProblem] = useState<string>()
  useEffect(() => {
    const frame = new PixelFrame()
    box.current?.append(frame.el)
    frame.on(event => { if (event.t === 'problem') setProblem(event.problems.join('；')) })
    setProblem(undefined)
    frame.play(code, look, inkOf(look.color, '--dsw-alias-label-primary'), loop ? { mode: 'loop', fade: true } : { mode: 'once', cap: 30, fade: true })
    return () => frame.destroy()
  }, [code, look.style, look.color, look.size, look.fit, loop, round])
  return (
    <>
      <div ref={box} className="her-pixel-stage" />
      {problem !== undefined && <p className="her-danger">{problem}</p>}
    </>
  )
}

function StylePick({ value, onPick, disabled }: { value: PixelStyle; onPick: (style: PixelStyle) => void; disabled?: boolean }) {
  return (
    <span className="her-seg" role="group" aria-label="画法">
      {PIXEL_STYLES.map(style => <button key={style} className={value === style ? 'on' : ''} disabled={disabled} onClick={() => onPick(style)}>{STYLE_NAME[style]}</button>)}
    </span>
  )
}

function ColorPick({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  const own = value !== 'theme'
  return (
    <span className="her-row" style={{ margin: 0, flexWrap: 'nowrap' }}>
      <select className="her-select" style={{ width: 'auto' }} value={own ? 'own' : 'theme'} onChange={e => onPick(e.target.value === 'theme' ? 'theme' : '#5b9cf0')}>
        <option value="theme">跟着 dsh 的颜色</option>
        <option value="own">自己选</option>
      </select>
      {own && <input type="color" value={value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value} onChange={e => onPick(e.target.value)} />}
    </span>
  )
}

export function PixelCard({ onSkin, pixel, apply }: { onSkin: () => void; pixel: number | undefined; apply: Apply }) {
  const [view, setView] = useState<PixelsView>()
  const [note, setNote] = useState<Note>()
  const [modelNote, setModelNote] = useState<Note>()
  const [thumbs, setThumbs] = useState<Record<string, { thumb?: string; info?: PixelInfo }>>(() => Object.fromEntries(tried))
  const [preview, setPreview] = useState<{ id: string; code: string; look: PixelLook; loop: boolean; round: number }>()
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>()
  const [workshop, setWorkshop] = useState<string>()
  /** Pictures or a video chosen here, handed to the workshop it opens. */
  const [bring, setBring] = useState<File[]>()
  const [exporting, setExporting] = useState<{ id: string; code: string; name: string; look: PixelLook }>()
  const file = useRef<HTMLInputElement>(null)
  const photos = useRef<HTMLInputElement>(null)
  const previewBox = useRef<HTMLDivElement>(null)

  const take = useCallback((result: Awaited<ReturnType<typeof herApi.pixelsGet>>, text?: string) => {
    if (!result.ok) return setNote({ kind: 'error', text: result.message })
    setView(result)
    if (text !== undefined) setNote({ kind: 'ok', text })
  }, [])
  useEffect(() => { void herApi.pixelsGet().then(r => take(r)) }, [take])

  // A still for each one that has none yet, one at a time.
  useEffect(() => {
    if (view === undefined) return
    let cancelled = false
    void (async () => {
      for (const item of view.items) {
        if (cancelled) return
        if (item.thumb !== undefined || tried.has(item.id)) continue
        const code = await herApi.pixelsCode(item.id)
        if (!code.ok) continue
        const result = await probePixel(code.code, brandInk())
        tried.set(item.id, { ...(result.thumb === undefined ? {} : { thumb: result.thumb }), ...(result.info === undefined ? {} : { info: result.info }) })
        if (!cancelled) setThumbs(Object.fromEntries(tried))
      }
      // Drafts not done: a still of the version they are on.
      for (const d of view.drafts) {
        const key = `draft:${d.id}:${d.changed}`
        if (cancelled) return
        if (tried.has(key)) continue
        const got = await herApi.draftGet(d.id)
        if (!got.ok || got.draft.code === '') continue
        const result = await probePixel(got.draft.code, brandInk())
        tried.set(key, { ...(result.thumb === undefined ? {} : { thumb: result.thumb }), ...(result.info === undefined ? {} : { info: result.info }) })
        if (!cancelled) setThumbs(Object.fromEntries(tried))
      }
    })()
    return () => { cancelled = true }
  }, [view])

  if (workshop !== undefined) {
    return <PixelWorkshop id={workshop} {...(bring === undefined ? {} : { files: bring })} onClose={() => {
      setWorkshop(undefined)
      setBring(undefined)
      void herApi.pixelsGet().then(r => take(r))
    }} />
  }
  if (view === undefined) return null
  const items = view.items
  /** 像素工坊 on a new draft: empty, or from one of the list. */
  const make = async (from?: string) => {
    // One's own that already has a draft goes on in it, not in another.
    const going = from === undefined ? undefined : view.drafts.find(d => d.saved === from)
    if (going !== undefined) return setWorkshop(going.id)
    const r = await herApi.draftNew(from)
    if (!r.ok) return setNote({ kind: 'error', text: r.message })
    setWorkshop(r.draft.id)
  }
  /** A new draft, opened on the pictures or video chosen. */
  const makeFrom = async (list: File[]) => {
    if (list.length === 0) return
    const r = await herApi.draftNew()
    if (!r.ok) return setNote({ kind: 'error', text: r.message })
    setBring(list)
    setWorkshop(r.draft.id)
  }
  const exportOf = async (item: Item) => {
    if (exporting?.id === item.id) return setExporting(undefined)
    const code = await herApi.pixelsCode(item.id)
    if (!code.ok) return setNote({ kind: 'error', text: code.message })
    const used = bg.id === item.id ? bg.look : introId === item.id ? intro.look : undefined
    setExporting({ id: item.id, code: code.code, name: item.name, look: used ?? { style: infoOf(item)?.color === 'color' ? 'blocks' : 'dots', color: 'theme', size: 1, fit: 'contain' } })
  }
  const infoOf = (item: Item) => item.info ?? thumbs[item.id]?.info
  const thumbOf = (item: Item) => item.thumb ?? thumbs[item.id]?.thumb
  const bg = view.background
  const setBg = (change: Record<string, unknown>) => void herApi.pixelsBackground(change).then(r => take(r))
  const setTrigger = (key: string, value: boolean | number) => setBg({ triggers: { [key]: value } })
  const intro = view.intro
  const introId = intro.source.startsWith('pixel:') ? intro.source.slice('pixel:'.length) : ''
  const setIntro = (change: Record<string, unknown>) => void herApi.introSet(change).then(async r => {
    if (!r.ok) return setNote({ kind: 'error', text: r.message })
    take(await herApi.pixelsGet())
  })

  const show = async (id: string, look: PixelLook, loop = false) => {
    const code = await herApi.pixelsCode(id)
    if (!code.ok) return setNote({ kind: 'error', text: code.message })
    setPreview(p => ({ id, code: code.code, look, loop, round: (p?.round ?? 0) + 1 }))
    setTimeout(() => previewBox.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50)
  }

  /** Try a file a model wrote; keep it when it runs. */
  const add = async (code: string, name: string) => {
    setBusy(true)
    setProblems(undefined)
    setNote(undefined)
    const result = await probePixel(code, brandInk())
    if (!result.ok || result.info === undefined) {
      setBusy(false)
      setProblems(result.problems)
      return
    }
    const saved = await herApi.pixelsAdd({ name: name || result.info.name, code, info: result.info, ...(result.thumb === undefined ? {} : { thumb: result.thumb }), ...(result.frameMs === undefined ? {} : { frameMs: result.frameMs }) })
    setBusy(false)
    if (!saved.ok) return setProblems([saved.message])
    setPaste('')
    take(saved, `收好了：「${result.info.name}」。${result.warnings.length > 0 ? result.warnings.join('；') : ''}`)
    void show(saved.id, { style: result.info.color === 'color' ? 'blocks' : 'dots', color: 'theme', size: 1, fit: 'contain' })
  }
  const pickFile = async (list: FileList | null) => {
    const f = [...(list ?? [])][0]
    if (f === undefined) return
    if (f.size > 400_000) return setProblems(['文件太大了：最多 200 KB'])
    void add(await f.text(), f.name.replace(/\.(m?js|txt)$/i, ''))
  }

  const triggerNames = ([['click', '点一下空白处'], ['send', '你发出消息'], ['reply', 'dsh 回答完'], ['open', '打开 dsh 页面']] as const)
  const bgWhen = bg.triggers.loop ? '一直在播' : [...triggerNames.filter(([key]) => bg.triggers[key]).map(([, label]) => label), ...(bg.triggers.everyMin > 0 ? [`每 ${bg.triggers.everyMin} 分钟`] : [])].join('、') || '什么时候都不播'
  const nameOf = (id: string) => items.find(item => item.id === id)?.name ?? id

  const fixText = (list: string[]) => `我写的 dsh-her 像素动画文件运行不了，引擎报的问题是：\n${list.map(p => `- ${p}`).join('\n')}\n请按「dsh-her 像素动画」的格式改好，给我完整的文件。`

  return (
    <>
      <section className="her-card">
        <div className="her-card-head">
          <h2>像素动画</h2>
          <span className="her-row" style={{ margin: 0 }}>
            <button className="her-btn small primary" onClick={() => photos.current?.click()}>🖼 用照片或视频做</button>
            <button className="her-btn small" onClick={() => void make()}>🎲 做一个</button>
          </span>
          <input ref={photos} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,video/mp4,video/webm,video/quicktime" hidden onChange={e => { const list = [...(e.target.files ?? [])]; e.target.value = ''; void makeFrom(list) }} />
        </div>
        <p className="her-muted">把你、你的猫、一段视频变成会动的像素画，或者进像素工坊掷骰子、跟 AI 说。做好了当开机动画、当 dsh 对话的背景，或者导出 GIF 做微信表情。</p>
        <div className="her-grid her-pixels">
          {view.drafts.filter(d => d.saved === undefined).map(d => (
            <div key={d.id} className="her-pixel draft">
              <button className="her-pixel-thumb" title="接着做" onClick={() => setWorkshop(d.id)}>{thumbs[`draft:${d.id}:${d.changed}`]?.thumb === undefined ? <span>✏️</span> : <img src={thumbs[`draft:${d.id}:${d.changed}`]!.thumb} alt="" />}</button>
              <b>{d.name}</b>
              <small>没做完 · {d.versions} 版</small>
              <button className="her-btn small" onClick={() => setWorkshop(d.id)}>接着做</button>
            </div>
          ))}
          {items.map(item => {
            const thumb = thumbOf(item)
            const uses = [introId === item.id && intro.on ? '开机动画' : '', bg.on && bg.id === item.id ? '对话背景' : ''].filter(Boolean)
            return (
              <div key={item.id} className={`her-pixel${preview?.id === item.id ? ' on' : ''}`}>
                <button className="her-pixel-thumb" title="试播" onClick={() => void show(item.id, { style: infoOf(item)?.color === 'color' ? 'blocks' : 'dots', color: 'theme', size: 1, fit: 'contain' }, infoOf(item)?.seconds === 0)}>
                  {thumb === undefined ? <span>…</span> : <img src={thumb} alt="" />}
                </button>
                <b>{item.name}</b>
                <small>{uses.length > 0 ? `✓ ${uses.join('、')}` : item.builtin ? '自带' : describe(infoOf(item))}</small>
                <span className="her-row" style={{ margin: 0 }}>
                  <button className="her-btn small" onClick={() => void make(item.id)}>{item.builtin ? '照着做' : '改一改'}</button>
                  <button className={`her-btn small${exporting?.id === item.id ? ' on' : ''}`} onClick={() => void exportOf(item)}>导出 GIF</button>
                  {!item.builtin && (
                    <button className="her-btn small" title="移走" onClick={() => {
                      if (window.confirm(`移走「${item.name}」？它会放进 pixels/.removed，不会直接删掉；用着它的地方改回自带的。`)) void herApi.pixelsRemove(item.id).then(r => take(r, '移走了。'))
                    }}>移走</button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
        {exporting !== undefined && <PixelExport key={exporting.id} code={exporting.code} name={exporting.name} look={exporting.look} onClose={() => setExporting(undefined)} />}
        <div ref={previewBox}>
          {preview !== undefined && (
            <div className="her-pixel-preview">
              <Preview code={preview.code} look={preview.look} loop={preview.loop} round={preview.round} />
              <div className="her-row">
                <StylePick value={preview.look.style} onPick={style => setPreview({ ...preview, look: { ...preview.look, style }, round: preview.round + 1 })} />
                <ColorPick value={preview.look.color} onPick={color => setPreview({ ...preview, look: { ...preview.look, color }, round: preview.round + 1 })} />
                <button className="her-btn small" onClick={() => setPreview({ ...preview, round: preview.round + 1 })}>再播一遍</button>
                <label className="her-muted"><input type="checkbox" checked={preview.loop} onChange={e => setPreview({ ...preview, loop: e.target.checked, round: preview.round + 1 })} /> 循环</label>
                <button className="her-btn small" onClick={() => setPreview(undefined)}>关掉</button>
              </div>
            </div>
          )}
        </div>
        {note !== undefined && <p className={note.kind === 'ok' ? 'her-ok' : 'her-danger'}>{note.text}</p>}
      </section>

      <section className="her-card">
        <h2>用在哪儿</h2>
        <div className="her-setrow">
          <div><b>开机动画</b><span>{introId === '' ? '现在用的是视频（在「皮肤」页里选）。' : intro.on ? `「${nameOf(introId)}」，她在桌面上出场${intro.dsh ? '、打开 dsh 网页' : ''}时播，${intro.when === 'every' ? '每次都播' : '每天第一次'}。` : `选了「${nameOf(introId)}」，但开机动画关着。`}</span></div>
          <span className="her-row" style={{ margin: 0, flexWrap: 'nowrap' }}>
            <select className="her-select" style={{ width: 'auto' }} value={introId} onChange={e => setIntro(e.target.value === '' ? { source: 'skin' } : { source: `pixel:${e.target.value}`, on: true })}>
              <option value="">不用像素动画</option>
              {items.map(item => <option key={item.id} value={item.id}>{item.name}{item.builtin ? '（自带）' : ''}</option>)}
            </select>
            <input type="checkbox" aria-label="开机动画开着" checked={intro.on} onChange={e => setIntro({ on: e.target.checked })} />
          </span>
        </div>
        {introId !== '' && (
          <details className="her-more">
            <summary>开机动画的更多设置</summary>
            <div className="her-setrow">
              <div><b>多久播一次</b></div>
              <span className="her-seg" role="group" aria-label="多久播一次">
                <button className={intro.when === 'daily' ? 'on' : ''} onClick={() => setIntro({ when: 'daily' })}>每天第一次</button>
                <button className={intro.when === 'every' ? 'on' : ''} onClick={() => setIntro({ when: 'every' })}>每次</button>
              </span>
            </div>
            <div className="her-setrow">
              <div><b>打开 dsh 网页时也播</b><span>只装了 dsh 版的，要开着这个才看得到。</span></div>
              <input type="checkbox" checked={intro.dsh} onChange={e => setIntro({ dsh: e.target.checked })} />
            </div>
            <div className="her-setrow">
              <div><b>画法</b></div>
              <StylePick value={intro.look.style} onPick={style => setIntro({ look: { ...intro.look, style } })} />
            </div>
            <div className="her-setrow">
              <div><b>颜色</b><span>跟着 dsh 的颜色时，桌面上用浅海蓝。</span></div>
              <ColorPick value={intro.look.color} onPick={color => setIntro({ look: { ...intro.look, color } })} />
            </div>
            <div className="her-setrow">
              <div><b>多大</b><span>占屏幕的多少。</span></div>
              <span className="her-range"><input type="range" min={30} max={100} value={Math.round(intro.look.size * 100)} onChange={e => setIntro({ look: { ...intro.look, size: Number(e.target.value) / 100 } })} /><i>{Math.round(intro.look.size * 100)}%</i></span>
            </div>
            <span className="her-row">
              <button className="her-btn" onClick={() => showIntro({ pixel: { id: introId, look: intro.look }, when: 'every' })}>现在放一遍</button>
              <button className="her-btn" onClick={() => void herApi.introPlay().then(r => setNote(r.ok ? { kind: 'ok', text: '在桌面上播了（桌面程序要是新版才会画像素动画）。' } : { kind: 'error', text: r.message }))}>桌面上播一次</button>
              <button className="her-btn" onClick={onSkin}>去皮肤页</button>
            </span>
          </details>
        )}

        <div className="her-setrow">
          <div><b>dsh 对话背景</b><span>{bg.on ? `「${nameOf(bg.id)}」，在对话后面淡淡地播：${bgWhen}。` : '关着。打开以后，对话后面会有很淡的一层像素动画，不挡点击。'}</span></div>
          <span className="her-row" style={{ margin: 0, flexWrap: 'nowrap' }}>
            <select className="her-select" style={{ width: 'auto' }} value={bg.id} onChange={e => setBg({ id: e.target.value })}>
              {items.map(item => <option key={item.id} value={item.id}>{item.name}{item.builtin ? '（自带）' : ''}</option>)}
            </select>
            <input type="checkbox" aria-label="对话背景开着" checked={bg.on} onChange={e => setBg({ on: e.target.checked })} />
          </span>
        </div>
        <details className="her-more">
          <summary>对话背景的更多设置</summary>
          <div className="her-setrow">
            <div><b>什么时候播</b><span>遇到勾上的事就播一遍；正在播的时候再遇到不会打断。</span></div>
            <div className="her-pixel-triggers">
              {triggerNames.map(([key, label]) => (
                <label key={key}><input type="checkbox" disabled={bg.triggers.loop} checked={bg.triggers[key]} onChange={e => setTrigger(key, e.target.checked)} />{label}</label>
              ))}
              <label>
                <input type="checkbox" disabled={bg.triggers.loop} checked={bg.triggers.everyMin > 0} onChange={e => setTrigger('everyMin', e.target.checked ? 10 : 0)} />每隔
                <input className="her-input her-pixel-min" type="number" min={1} max={240} disabled={bg.triggers.loop || bg.triggers.everyMin === 0} value={bg.triggers.everyMin || 10} onChange={e => setTrigger('everyMin', Math.max(1, Number(e.target.value) || 1))} />分钟
              </label>
              <label><input type="checkbox" checked={bg.triggers.loop} onChange={e => setTrigger('loop', e.target.checked)} />一直循环（更耗电）</label>
            </div>
          </div>
          <div className="her-setrow">
            <div><b>浓淡</b><span>越淡越不打扰你看字。</span></div>
            <span className="her-range"><input type="range" min={3} max={60} value={Math.round(bg.opacity * 100)} onChange={e => setBg({ opacity: Number(e.target.value) / 100 })} /><i>{Math.round(bg.opacity * 100)}%</i></span>
          </div>
          <div className="her-setrow">
            <div><b>画法</b><span>彩色动画只能画成方块。</span></div>
            <StylePick value={bg.look.style} onPick={style => setBg({ look: { style } })} />
          </div>
          <div className="her-setrow">
            <div><b>颜色</b><span>跟着 dsh 的颜色，浅色深色模式和皮肤都会跟着变。</span></div>
            <ColorPick value={bg.look.color} onPick={color => setBg({ look: { color } })} />
          </div>
          <div className="her-setrow">
            <div><b>大小</b></div>
            <span className="her-row" style={{ margin: 0, flexWrap: 'nowrap' }}>
              <span className="her-seg" role="group" aria-label="大小">
                <button className={bg.look.fit === 'contain' ? 'on' : ''} onClick={() => setBg({ look: { fit: 'contain' } })}>放中间</button>
                <button className={bg.look.fit === 'cover' ? 'on' : ''} onClick={() => setBg({ look: { fit: 'cover' } })}>铺满</button>
              </span>
              {bg.look.fit === 'contain' && <span className="her-range"><input type="range" min={30} max={100} value={Math.round(bg.look.size * 100)} onChange={e => setBg({ look: { size: Number(e.target.value) / 100 } })} /><i>{Math.round(bg.look.size * 100)}%</i></span>}
            </span>
          </div>
          <span className="her-row"><button className="her-btn" onClick={() => void show(bg.id, bg.look, bg.triggers.loop)}>在上面试播</button></span>
          <p className="her-faint">手机上不播；电脑开了"减少动态效果"时不播；标签页在后台时暂停。</p>
        </details>
      </section>

      <section className="her-card">
        <h2>像素化显示（她自己）</h2>
        <div className="her-setrow">
          <div><b>把她画成整齐的像素格</b><span>给像素风形象用：她的视频先缩小到下面这个高度，再放大、不做平滑。生图生视频工具做出来的像素画有点糊、格子会跳，打开以后在屏幕上都是干净的方格。跟着人物走：只对现在这个人物生效。</span></div>
          <input type="checkbox" checked={pixel !== undefined} onChange={e => void apply(herApi.saveCharacter({ pixel: e.target.checked ? 128 : 0 }))} />
        </div>
        {pixel !== undefined && (
          <div className="her-setrow">
            <div><b>多少格高</b><span>越少格子越大、越复古；96–160 比较像 16-bit 游戏。</span></div>
            <span className="her-seg" role="group" aria-label="多少格高">
              {[64, 96, 128, 160, 220].map(n => <button key={n} className={pixel === n ? 'on' : ''} onClick={() => void apply(herApi.saveCharacter({ pixel: n }))}>{n}</button>)}
            </span>
          </div>
        )}
        <p className="her-faint">桌面上的她和 dsh 网页里的她都会换；桌面程序要是新版才会画。</p>
      </section>

      <section className="her-card">
        <h2>让别的大模型写，或者传一个进来</h2>
        <p className="her-muted">不用像素工坊也行：把说明贴给 DeepSeek、ChatGPT，让它写一个 .js 传上来。</p>
        <span className="her-row">
          <button className="her-btn" onClick={() => void copy(pixelSpec()).then(ok => setModelNote(ok ? { kind: 'ok', text: '说明复制好了：贴给大模型，把第一行【】里换成你想要的画面。' } : { kind: 'error', text: '没能复制，展开下面的说明自己复制吧。' }))}>复制给大模型的说明</button>
          <button className="her-btn" disabled={busy} onClick={() => file.current?.click()}>上传 .js…</button>
        </span>
        <input ref={file} type="file" accept=".js,.mjs,.txt,text/javascript" hidden onChange={e => { void pickFile(e.target.files); e.target.value = '' }} />
        <details className="her-more">
          <summary>直接粘贴代码</summary>
          <textarea className="her-textarea" spellCheck={false} placeholder="把大模型给你的整段代码粘贴到这里" value={paste} onChange={e => setPaste(e.target.value)} />
          <div className="her-row">
            <button className="her-btn primary" disabled={busy || paste.trim() === ''} onClick={() => void add(paste, '')}>{busy ? '正在试跑…' : '试跑并收下'}</button>
          </div>
        </details>
        {busy && <p className="her-muted">正在隔离环境里试跑……</p>}
        {problems !== undefined && (
          <div className="her-pixel-problems">
            <p className="her-danger">这个文件还不能用：</p>
            <ul className="her-warnlist">{problems.map(p => <li key={p}>{p}</li>)}</ul>
            <button className="her-btn small" onClick={() => void copy(fixText(problems)).then(ok => setModelNote(ok ? { kind: 'ok', text: '复制好了：贴给大模型，让它改好再传上来。' } : { kind: 'error', text: '没能复制，自己选中上面的文字复制吧。' }))}>复制给大模型</button>
          </div>
        )}
        <details className="her-more">
          <summary>看看说明全文</summary>
          <pre className="her-pixel-spec">{pixelSpec()}</pre>
        </details>
        {modelNote !== undefined && <p className={modelNote.kind === 'ok' ? 'her-ok' : 'her-danger'}>{modelNote.text}</p>}
        <p className="her-faint">传进来的代码在隔离的环境里运行：连不了网，读不到你的文件和 dsh 里的任何东西；太慢或者写成死循环会被自动停掉。</p>
      </section>
    </>
  )
}
