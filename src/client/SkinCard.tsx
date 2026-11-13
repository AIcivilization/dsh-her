/**
 * 皮肤和开机动画, on 主界面 (docs/设置页与编排设计.md §4): pick a skin from the
 * list and the whole of dsh puts it on at once; 保存 keeps it, 取消 (or
 * leaving the page) puts the one before back. Skins of your own come as a
 * folder (skin.json and its files). Her opening clip below.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { herApi, type SkinsView } from './api.ts'
import { stopTrying, tryOn } from './skin-wear.ts'
import { uploadFile, uploadFiles, type UploadProgress } from './upload.ts'
import { openSkinDesign } from './design.ts'
import { SKIN_STEPS, SKIN_TOKENS } from '../core/skin-guide.ts'
import { Icon } from './icons.tsx'

export function SkinCard() {
  const [view, setView] = useState<SkinsView>()
  const [choice, setChoice] = useState<string | null>()
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string }>()
  const [progress, setProgress] = useState<UploadProgress>()
  const folder = useRef<HTMLInputElement>(null)
  const zip = useRef<HTMLInputElement>(null)
  const clip = useRef<HTMLInputElement>(null)
  const [starting, setStarting] = useState(false)

  const take = useCallback((result: Awaited<ReturnType<typeof herApi.skinsGet>>, text?: string) => {
    if (!result.ok) return setNote({ kind: 'error', text: result.message })
    setView(result)
    if (text !== undefined) setNote({ kind: 'ok', text })
  }, [])
  useEffect(() => {
    void herApi.skinsGet().then(r => take(r))
    // Leaving the page without saving: the skin worn before.
    return () => { void stopTrying() }
  }, [take])
  if (view === undefined) return null

  const trying = choice !== undefined && choice !== view.current
  const pick = (id: string | null) => {
    setChoice(id)
    setNote(undefined)
    void tryOn(id)
  }
  const save = async () => {
    const result = await herApi.skinsUse(choice ?? null)
    if (!result.ok) return setNote({ kind: 'error', text: result.message })
    const worn = result.skins.find(s => s.id === result.current)
    await stopTrying(worn === undefined ? null : { id: worn.id, rev: worn.rev })
    setChoice(undefined)
    take(result, '已保存：每个 dsh 页面都会换上。')
  }
  const cancel = () => {
    setChoice(undefined)
    setNote(undefined)
    void stopTrying()
  }
  const sendSkin = async (list: FileList | null) => {
    const files = [...(list ?? [])]
    if (!files.some(f => f.name === 'skin.json')) return setNote({ kind: 'error', text: '这个文件夹里没有 skin.json' })
    const top = ((files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? '').split('/')[0] ?? ''
    const id = top.replace(/[^\w\-一-鿿]/g, '').slice(0, 40) || `skin${Date.now().toString(36)}`
    try {
      await uploadFiles(files.filter(f => !f.name.startsWith('.')), f => `/api/dsh-her/web/upload?skin=${encodeURIComponent(id)}&path=${encodeURIComponent(f.name)}`, setProgress)
      take(await herApi.skinsGet(), `传好了：「${id}」在下拉里，选它试试。`)
    } catch (error) {
      setNote({ kind: 'error', text: (error as Error).message })
    }
    setProgress(undefined)
  }
  const sendZip = async (list: FileList | null) => {
    const file = [...(list ?? [])].find(f => /\.zip$/i.test(f.name))
    if (file === undefined) return setNote({ kind: 'error', text: '要选一个 .zip 文件' })
    try {
      const answer = await uploadFile(file, `/api/dsh-her/web/upload?skinzip=1&path=${encodeURIComponent(file.name)}`, setProgress) as { id?: string; skipped?: string[] }
      const skipped = answer.skipped ?? []
      const result = await herApi.skinsGet()
      take(result, `传好了：「${result.ok ? result.skins.find(s => s.id === answer.id)?.name ?? answer.id : answer.id}」在上面的列表里，点它试试。${skipped.length > 0 ? `没收的文件：${skipped.join('、')}。` : ''}`)
    } catch (error) {
      setNote({ kind: 'error', text: (error as Error).message })
    }
    setProgress(undefined)
  }
  /** "AI 做一套" (or change this one): a conversation in dsh where the AI asks, one question at a time. */
  const startAi = async (id?: string) => {
    setStarting(true)
    setNote(undefined)
    const message = await openSkinDesign(id)
    setStarting(false)
    if (message !== undefined) setNote({ kind: message.startsWith('对话开好了') ? 'ok' : 'error', text: message })
  }
  const sendClip = async (list: FileList | null) => {
    const files = [...(list ?? [])].filter(f => /\.(mp4|webm|mov|m4v)$/i.test(f.name))
    if (files.length === 0) return setNote({ kind: 'error', text: '开机动画要是视频（mp4、webm；透明背景用 webm）' })
    try {
      await uploadFiles(files, f => `/api/dsh-her/web/upload?library=intro&path=${encodeURIComponent(f.name)}`, setProgress)
      const name = files[0]!.name.replace(/\.[^.]+$/, '')
      take(await herApi.introSet({ source: name }), `传好了，开机动画用「${name}」。`)
    } catch (error) {
      setNote({ kind: 'error', text: (error as Error).message })
    }
    setProgress(undefined)
  }
  const selected = choice === undefined ? view.current : choice
  const skin = view.skins.find(s => s.id === selected)
  const intro = view.intro

  const dark = document.body.hasAttribute('data-ds-dark-theme')
  const mode = dark ? 'dark' : 'light'
  /** A small picture of a skin: its page, side bar, a bubble and its accent. */
  const swatch = (item: SkinsView['skins'][number] | undefined) => {
    const color = (name: string, fallback: string) => item?.colors?.[name]?.[mode] ?? fallback
    const page = color('--dsw-alias-bg-base', dark ? '#151517' : '#ffffff')
    const picture = item?.background === undefined ? undefined : `url("/api/dsh-her/web/skin-file?id=${encodeURIComponent(item.id)}&f=${encodeURIComponent(item.background.file)}")`
    return (
      <span className="her-swatch" style={{ background: picture === undefined ? page : `${picture} center / cover` }}>
        <i style={{ background: color('--dsw-specific-sidebar-fill', dark ? '#1b1b1c' : '#f9fafb') }} />
        <b style={{ background: color('--dsw-specific-bubble', dark ? '#2c2c2e' : '#edf3fe') }} />
        <em style={{ background: item?.bar?.accent?.[mode] ?? color('--dsw-alias-state-business-primary', dark ? '#7aaaff' : '#4176e6') }} />
      </span>
    )
  }
  return (
    <>
      <section className="her-card">
        <div className="her-card-head">
          <h2>皮肤</h2>
          <span className="her-row" style={{ margin: 0 }}>
            <button className="her-btn small" onClick={() => zip.current?.click()}>上传 zip…</button>
            <button className="her-btn small" onClick={() => folder.current?.click()}>上传文件夹…</button>
          </span>
          <input ref={folder} type="file" hidden {...{ webkitdirectory: '' }} onChange={e => { void sendSkin(e.target.files); e.target.value = '' }} />
          <input ref={zip} type="file" accept=".zip,application/zip" hidden onChange={e => { void sendZip(e.target.files); e.target.value = '' }} />
        </div>
        <p className="her-muted">一整套样子：dsh 的颜色、背景图、字体、她的对话小条。点一个，整个 dsh 马上换给你看；保存才算数。</p>
        <div className="her-grid her-skins">
          <button className={`her-choice${(selected ?? '') === '' ? ' on' : ''}`} onClick={() => pick(null)}>{swatch(undefined)}dsh 原样<small>不换</small></button>
          {view.skins.map(s => (
            <button key={s.id} className={`her-choice${selected === s.id ? ' on' : ''}`} onClick={() => pick(s.id)}>
              {swatch(s)}{s.name}<small>{s.builtin === true ? '自带' : s.author ?? '你的'}{s.problems.length > 0 ? ' · 有几处没用上' : ''}</small>
            </button>
          ))}
        </div>
        {trying && (
          <div className="her-pending">
            <span>正在试「{skin?.name ?? 'dsh 原样'}」：整个 dsh 已经换给你看了，还没保存。</span>
            <button className="her-btn" onClick={cancel}>取消</button>
            <button className="her-btn primary" onClick={() => void save()}>保存</button>
          </div>
        )}
        {skin !== undefined && skin.problems.length > 0 && <ul className="her-warnlist">{skin.problems.map(p => <li key={p}>{p}</li>)}</ul>}
        {skin !== undefined && skin.builtin !== true && !trying && (
          <div className="her-row">
            <a className="her-btn small" href={`/api/dsh-her/web/skin-zip?id=${encodeURIComponent(skin.id)}`} download={`${skin.name}.zip`}>下载「{skin.name}」（zip）</a>
            <button className="her-btn small her-ai" disabled={starting} onClick={() => void startAi(skin.id)}>让 AI 改这套</button>
            <button className="her-btn small" onClick={() => {
              if (window.confirm(`移走皮肤「${skin.name}」？文件夹会放进 skins/.removed，不会直接删掉。`)) void herApi.skinsRemove(skin.id).then(r => take(r, '移走了。'))
            }}>移走</button>
          </div>
        )}
        {progress !== undefined && <p className="her-muted">正在上传 {progress.file}（{Math.round(progress.done / Math.max(progress.total, 1) * 100)}%）</p>}
        {note !== undefined && <p className={note.kind === 'ok' ? 'her-ok' : 'her-danger'}>{note.text}</p>}
      </section>

      <section className="her-card">
        <h2>做一套新皮肤</h2>
        <div className="her-make">
          <div className="her-make-way ai">
            <h3><Icon name="workshop" />让 AI 带你做</h3>
            <p>在 dsh 里开一段对话，AI 一次问你一件事，你回个数字或一句话就行：</p>
            <ol className="her-make-asks">
              <li>整体色系：海蓝、樱粉、薄荷、暖杏、墨夜……或者"像夏天的海边"</li>
              <li>浅色、深色都要，还是偏哪一边</li>
              <li>强调色：按钮、选中、她的对话小条</li>
              <li>要不要装饰：淡淡的波浪、气泡、星点、花瓣……（AI 画成 SVG）</li>
              <li>字体，和这套皮肤的名字</li>
            </ol>
            <p className="her-muted">问完它先复述一遍，你说好它才做。做好后可以让它<b>直接换上</b>，或者给你<b>下载链接</b>（zip，能发给别人）；之后说"再深一点""强调色换紫的"它接着改。</p>
            <button className="her-btn primary" disabled={starting} onClick={() => void startAi()}>{starting ? '正在打开对话…' : 'AI 做一套'}</button>
          </div>
          <div className="her-make-way">
            <h3><Icon name="skin" />自己动手做</h3>
            <ol className="her-flow her-flow-one">
              {SKIN_STEPS.map(step => <li key={step.title}><b>{step.title}</b><span>{step.text}</span></li>)}
            </ol>
            <div className="her-row">
              <a className="her-btn primary" href="/api/dsh-her/web/skin-template" download="dsh-her 皮肤模板.zip">下载模板（zip）</a>
              <button className="her-btn" onClick={() => zip.current?.click()}>上传 zip…</button>
              <button className="her-btn" onClick={() => folder.current?.click()}>上传文件夹…</button>
            </div>
          </div>
        </div>
        <details className="her-more" open>
          <summary>颜色对照表：skin.json 的 colors 里每个名字管哪一块</summary>
          <table className="her-table">
            <thead><tr><th>颜色名</th><th>管哪一块</th></tr></thead>
            <tbody>{SKIN_TOKENS.map(t => <tr key={t.name}><td><code>{t.name}</code></td><td>{t.what}</td></tr>)}</tbody>
          </table>
          <p className="her-faint">每个颜色写 <code>{'{"light": "#…", "dark": "#…"}'}</code>，浅色模式和深色模式各一个；没写的保持 dsh 原样。对话小条的颜色在 <code>bar</code> 里（background、text、accent）。</p>
        </details>
      </section>

      <section className="her-card">
        <h2>开机动画</h2>
        <div className="her-setrow">
          <div><b>她出场时播一段</b><span>电脑开机、桌面程序启动，或者"叫她出来"时。点一下就跳过。</span></div>
          <input type="checkbox" checked={intro.on} onChange={e => void herApi.introSet({ on: e.target.checked }).then(r => take(r))} />
        </div>
        <div className="her-setrow">
          <div><b>播哪一段</b><span>建议 2–5 秒；透明背景用 WebM，她就像从桌面上冒出来。</span></div>
          <span className="her-row" style={{ margin: 0, flexWrap: 'nowrap' }}>
            <select className="her-select" style={{ width: 'auto' }} value={intro.source} onChange={e => void herApi.introSet({ source: e.target.value }).then(r => take(r))}>
              <option value="skin">{view.skinIntro ? '皮肤自带的' : '皮肤自带的（这套没有）'}</option>
              {view.introClips.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <button className="her-btn" onClick={() => clip.current?.click()}>上传…</button>
            <input ref={clip} type="file" accept="video/*" hidden onChange={e => { void sendClip(e.target.files); e.target.value = '' }} />
          </span>
        </div>
        <div className="her-setrow">
          <div><b>多久播一次</b><span>每次她出场都播，或者每天只播第一次。</span></div>
          <select className="her-select" style={{ width: 'auto' }} value={intro.when} onChange={e => void herApi.introSet({ when: e.target.value as 'every' | 'daily' }).then(r => take(r))}>
            <option value="daily">每天第一次</option>
            <option value="every">每次</option>
          </select>
        </div>
        <div className="her-setrow">
          <div><b>打开 dsh 页面时也播</b><span>dsh 自己的启动画面换不了，这是页面出来以后叠上去的一段。</span></div>
          <input type="checkbox" checked={intro.dsh} onChange={e => void herApi.introSet({ dsh: e.target.checked }).then(r => take(r))} />
        </div>
        <div className="her-setrow">
          <div><b>看一眼</b><span>现在就在桌面上播一次。</span></div>
          <button className="her-btn" onClick={() => void herApi.introPlay().then(r => setNote(r.ok ? { kind: 'ok', text: '在桌面上播了。' } : { kind: 'error', text: r.message }))}>播一次</button>
        </div>
      </section>
    </>
  )
}
