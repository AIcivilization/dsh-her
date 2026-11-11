/**
 * 皮肤和开机动画, on 主界面 (docs/设置页与编排设计.md §4): pick a skin from the
 * list and the whole of dsh puts it on at once; 保存 keeps it, 取消 (or
 * leaving the page) puts the one before back. Skins of your own come as a
 * folder (skin.json and its files). Her opening clip below.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { herApi, type SkinsView } from './api.ts'
import { stopTrying, tryOn } from './skin-wear.ts'
import { uploadFiles, type UploadProgress } from './upload.ts'
import { openDesign } from './design.ts'

export function SkinCard() {
  const [view, setView] = useState<SkinsView>()
  const [choice, setChoice] = useState<string | null>()
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string }>()
  const [progress, setProgress] = useState<UploadProgress>()
  const folder = useRef<HTMLInputElement>(null)
  const clip = useRef<HTMLInputElement>(null)

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

  return (
    <div className="her-card">
      <h2>皮肤</h2>
      <p className="her-muted">一整套样子：dsh 的颜色、背景图、字体、她的对话小条。选一个，整个 dsh 马上换给你看；点保存才算数，不保存就回到原来的。</p>
      <div className="her-row">
        <select className="her-select" style={{ width: 'auto', minWidth: 180 }} value={selected ?? ''} onChange={e => pick(e.target.value === '' ? null : e.target.value)}>
          <option value="">dsh 原样</option>
          {view.skins.map(s => <option key={s.id} value={s.id}>{s.name}{s.builtin === true ? '（自带）' : ''}</option>)}
        </select>
        <button className="her-btn primary" disabled={!trying} onClick={() => void save()}>保存</button>
        {trying && <button className="her-btn" onClick={cancel}>取消</button>}
        <button className="her-btn small" onClick={() => folder.current?.click()}>上传皮肤文件夹…</button>
        <button className="her-btn small her-ai" title="让 dsh 的模型做一套：说你想要的样子" onClick={() => void openDesign(`皮肤（现在选的：${skin?.name ?? 'dsh 原样'}${skin === undefined ? '' : `，id ${skin.id}`}）`).then(m => m !== undefined && setNote({ kind: 'error', text: m }))}>+AI 做一套</button>
        {skin !== undefined && skin.builtin !== true && <button className="her-btn small" onClick={() => {
          if (window.confirm(`移走皮肤「${skin.name}」？文件夹会放进 skins/.removed，不会直接删掉。`)) void herApi.skinsRemove(skin.id).then(r => take(r, '移走了。'))
        }}>移走这套</button>}
        <input ref={folder} type="file" hidden {...{ webkitdirectory: '' }} onChange={e => { void sendSkin(e.target.files); e.target.value = '' }} />
      </div>
      {skin !== undefined && skin.problems.length > 0 && <ul className="her-warnlist">{skin.problems.map(p => <li key={p}>{p}</li>)}</ul>}
      {skin?.author !== undefined && <p className="her-faint">作者：{skin.author}</p>}
      <details className="her-muted"><summary>自己做一套皮肤</summary>
        <p>一个文件夹，里面一个 <code>skin.json</code>，再放要用的图片、字体、视频。文件夹名就是皮肤的名字。<code>skin.json</code> 可以写：</p>
        <ul>
          <li><code>name</code>：显示的名字；<code>author</code>：作者。</li>
          <li><code>colors</code>：dsh 的颜色，比如 <code>{'{"--dsw-alias-bg-base": {"light": "#f3f8fe", "dark": "#0b1626"}}'}</code>，每个颜色写浅色和深色两个值。</li>
          <li><code>background</code>：<code>{'{"file": "背景.webp", "dim": 0.35}'}</code>，dim 是盖在上面的暗度（0–0.9）。</li>
          <li><code>font</code>：<code>{'{"file": "字体.woff2"}'}</code>，或 <code>{'{"name": "霞鹜文楷"}'}</code>（电脑上装好的）。要分享的皮肤，只放可以自由分发的字体。</li>
          <li><code>bar</code>：对话小条的 <code>background</code>、<code>text</code>、<code>accent</code>，也是浅色、深色各一个。</li>
          <li><code>intro</code>：开机动画，文件夹里的一段视频；<code>css</code>：再加一个 .css 文件（dsh 改版时可能要改）。</li>
        </ul>
      </details>
      {progress !== undefined && <p className="her-muted">正在上传 {progress.file}（{Math.round(progress.done / Math.max(progress.total, 1) * 100)}%）</p>}
      {note !== undefined && <p className={note.kind === 'ok' ? 'her-ok' : 'her-danger'}>{note.text}</p>}

      <h2 style={{ marginTop: 18 }}>开机动画</h2>
      <p className="her-muted">她出场时播一段：电脑开机、桌面程序启动、或者"叫她出来"时。dsh 自己的启动画面换不了；可以选在 dsh 页面打开后也播一次。点一下就跳过。</p>
      <div className="her-row">
        <label><input type="checkbox" checked={intro.on} onChange={e => void herApi.introSet({ on: e.target.checked }).then(r => take(r))} /> 播开机动画</label>
        <select className="her-select" style={{ width: 'auto' }} value={intro.source} onChange={e => void herApi.introSet({ source: e.target.value }).then(r => take(r))}>
          <option value="skin">{view.skinIntro ? '用皮肤自带的' : '用皮肤自带的（现在这套没有）'}</option>
          {view.introClips.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <select className="her-select" style={{ width: 'auto' }} value={intro.when} onChange={e => void herApi.introSet({ when: e.target.value as 'every' | 'daily' }).then(r => take(r))}>
          <option value="daily">每天第一次</option>
          <option value="every">每次</option>
        </select>
        <label><input type="checkbox" checked={intro.dsh} onChange={e => void herApi.introSet({ dsh: e.target.checked }).then(r => take(r))} /> 打开 dsh 页面时也播</label>
      </div>
      <div className="her-row">
        <button className="her-btn small" onClick={() => clip.current?.click()}>上传一段开机动画…</button>
        <button className="her-btn small" onClick={() => void herApi.introPlay().then(r => setNote(r.ok ? { kind: 'ok', text: '在桌面上播了。' } : { kind: 'error', text: r.message }))}>在桌面上播一次</button>
        <input ref={clip} type="file" accept="video/*" hidden onChange={e => { void sendClip(e.target.files); e.target.value = '' }} />
        <span className="her-faint">建议 2–5 秒；透明背景用 WebM，她就像从桌面上冒出来。</span>
      </div>
    </div>
  )
}
