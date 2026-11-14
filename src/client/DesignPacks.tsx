/**
 * 设计包 (docs/设计包格式.md): the one way designs come into the body
 * engine and go out of it. Choose a zip and see what it is first — name,
 * author, licence, what is inside — then choose which parts to put in. What
 * came in is listed with its author and licence. The character of now can
 * go out as one too.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { herApi, type DesignChoice, type DesignPreview, type DesignsList, type StateView } from './api.ts'
import { uploadFile, type UploadProgress } from './upload.ts'
import type { Apply } from './parts.tsx'

const SPEC = 'https://github.com/AIcivilization/dsh-her/blob/main/docs/设计包格式.md'
const LICENSES = ['仅个人使用，不许转发', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC 4.0', 'CC BY-NC-SA 4.0', 'MIT']
const ROW_LABEL: Record<string, string> = { avatar: '头像', desktop: '桌面', pet: '宠物', intro: '开机动画', sheet: '三视图' }
const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

export function DesignPacks({ state, apply }: { state: StateView; apply: Apply }) {
  const [list, setList] = useState<DesignsList>()
  const [preview, setPreview] = useState<DesignPreview>()
  const [choice, setChoice] = useState<DesignChoice>({ character: true, switchTo: true, skin: true, wearSkin: false, intro: true, setIntro: true, materials: true })
  const [read, setRead] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<UploadProgress>()
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string }>()
  const file = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const result = await herApi.designsList()
    if (result.ok) setList(result)
  }, [])
  useEffect(() => { void load() }, [load, state.cid])

  const choose = async (files: FileList | null) => {
    const zip = [...(files ?? [])].find(f => /\.zip$/i.test(f.name))
    if (zip === undefined) return setNote({ kind: 'error', text: '要选一个 .zip 文件' })
    setNote(undefined)
    setPreview(undefined)
    setRead(false)
    try {
      const answer = await uploadFile(zip, `/api/dsh-her/web/upload?design=1&path=${encodeURIComponent(zip.name)}`, setProgress) as { preview?: DesignPreview }
      if (answer.preview !== undefined) {
        setPreview(answer.preview)
        setChoice({ character: answer.preview.character !== undefined, switchTo: true, skin: answer.preview.skin !== undefined, wearSkin: answer.preview.character === undefined, intro: answer.preview.intro !== undefined, setIntro: true, materials: true })
      }
    } catch (error) {
      setNote({ kind: 'error', text: (error as Error).message })
    }
    setProgress(undefined)
  }
  const install = async () => {
    if (preview === undefined) return
    setBusy(true)
    const result = await herApi.designApply(preview.token, choice)
    setBusy(false)
    if (!result.ok) return setNote({ kind: 'error', text: result.message })
    const r = result.record
    const done = [r.character === undefined ? '' : `人物「${r.character}」`, r.skinId === undefined ? '' : '皮肤', r.materials > 0 ? `${r.materials} 个素材` : ''].filter(Boolean).join('、')
    setNote({ kind: 'ok', text: `装好了：${done || '（没有勾任何部分）'}。${result.notes.join('；')}${choice.switchTo && r.cid !== undefined ? ' 正在换成她…' : ''}` })
    setPreview(undefined)
    void load()
    void apply(herApi.state())
  }
  const toggle = (key: keyof DesignChoice) => (e: { target: { checked: boolean } }) => setChoice(c => ({ ...c, [key]: e.target.checked }))
  const p = preview
  const materialCount = p === undefined ? 0 : Object.values(p.materials).reduce((a, b) => a + b, 0)

  return (
    <>
      <section className="her-card">
        <div className="her-card-head">
          <h2>装一个设计包</h2>
          <span className="her-row" style={{ margin: 0 }}>
            <a className="her-btn small" href={SPEC} target="_blank" rel="noreferrer">设计包格式（标准文档）</a>
            <button className="her-btn small primary" onClick={() => file.current?.click()}>选一个 zip…</button>
          </span>
          <input ref={file} type="file" accept=".zip,application/zip" hidden onChange={e => { void choose(e.target.files); e.target.value = '' }} />
        </div>
        <p className="her-muted">dsh-her 是她的身体引擎：角色、皮肤、开机动画这些设计，别人照着<a href={SPEC} target="_blank" rel="noreferrer">设计包格式</a>做好，你在这里装进来就能用。先看一眼里面有什么、是谁做的、什么许可，再决定装哪几部分；不会覆盖你已有的东西。</p>
        {progress !== undefined && <p className="her-muted">正在读 {progress.file}（{Math.round(progress.done / Math.max(progress.total, 1) * 100)}%）</p>}
        {p !== undefined && (
          <div className="her-design">
            <div className="her-design-head">
              {p.cover !== undefined && <img className="her-design-cover" src={p.cover} alt="" />}
              <div>
                <h3>{p.manifest.name} <small>{p.manifest.version}</small></h3>
                <p className="her-muted">作者：{p.manifest.author}{p.manifest.homepage !== undefined && <> · <a href={p.manifest.homepage} target="_blank" rel="noreferrer">主页</a></>} · {mb(p.bytes)}</p>
                {p.manifest.description !== undefined && <p>{p.manifest.description}</p>}
                <p className="her-design-license"><b>许可</b>{p.manifest.license}</p>
              </div>
            </div>
            {p.newer !== undefined && <p className="her-warn">这个设计包是给 dsh-her {p.newer} 以上做的，你装的是 {state.version}：有的地方可能用不上，最好先更新。</p>}
            <div className="her-design-parts">
              {p.character !== undefined && (
                <label className="her-setrow"><div><b>人物「{p.character.name}」</b><span>{p.stage === undefined ? '' : `带编排（${p.stage.scenes} 个场景）和 ${materialCount - (p.materials.intro ?? 0)} 个素材。`}装成一个新人物，你现在的人物不变。「{p.character.persona}…」</span></div><input type="checkbox" checked={choice.character} onChange={toggle('character')} /></label>
              )}
              {p.character !== undefined && choice.character && (
                <label className="her-setrow sub"><div><b>装好就换成她</b><span>不换的话，在「人设」顶上的人物卡里点她。</span></div><input type="checkbox" checked={choice.switchTo} onChange={toggle('switchTo')} /></label>
              )}
              {p.character === undefined && materialCount - (p.materials.intro ?? 0) > 0 && (
                <label className="her-setrow"><div><b>素材</b><span>{Object.entries(p.materials).filter(([row, n]) => n > 0 && row !== 'intro').map(([row, n]) => `${ROW_LABEL[row]} ${n} 个`).join('、')}，放进素材库，在编排里用。</span></div><input type="checkbox" checked={choice.materials} onChange={toggle('materials')} /></label>
              )}
              {p.skin !== undefined && (
                <label className="her-setrow"><div><b>皮肤「{p.skin.name}」</b><span>变成一套新皮肤。</span></div><input type="checkbox" checked={choice.skin} onChange={toggle('skin')} /></label>
              )}
              {p.skin !== undefined && choice.skin && (
                <label className="her-setrow sub"><div><b>马上换上这套皮肤</b><span>不换的话，在「皮肤」里点它试。</span></div><input type="checkbox" checked={choice.wearSkin} onChange={toggle('wearSkin')} /></label>
              )}
              {p.intro !== undefined && (
                <label className="her-setrow"><div><b>开机动画「{p.intro.name}」</b><span>放进素材库。</span></div><input type="checkbox" checked={choice.intro} onChange={toggle('intro')} /></label>
              )}
              {p.intro !== undefined && choice.intro && (
                <label className="her-setrow sub"><div><b>设成开机动画</b><span>{p.intro.when === 'every' ? '每次她出场都播' : '每天第一次出场时播'}。</span></div><input type="checkbox" checked={choice.setIntro} onChange={toggle('setIntro')} /></label>
              )}
            </div>
            {(p.problems.length > 0 || p.skipped.length > 0) && (
              <ul className="her-warnlist">
                {p.problems.map(x => <li key={x}>{x}</li>)}
                {p.skipped.length > 0 && <li>不收的文件：{p.skipped.slice(0, 8).join('、')}{p.skipped.length > 8 ? ` 等 ${p.skipped.length} 个` : ''}</li>}
              </ul>
            )}
            <label className="her-check her-design-read"><input type="checkbox" checked={read} onChange={e => setRead(e.target.checked)} />我看过许可（{p.manifest.license}），会按它来用</label>
            <div className="her-row">
              <button className="her-btn" onClick={() => setPreview(undefined)}>不装了</button>
              <button className="her-btn primary" disabled={!read || busy} onClick={() => void install()}>{busy ? '正在装…' : '装进来'}</button>
            </div>
          </div>
        )}
        {note !== undefined && <p className={note.kind === 'ok' ? 'her-ok' : 'her-danger'}>{note.text}</p>}
      </section>

      {list !== undefined && list.installed.length > 0 && (
        <section className="her-card">
          <h2>已装的设计包</h2>
          <p className="her-muted">别人的设计，用的时候请按它的许可注明出处。</p>
          <table className="her-table">
            <thead><tr><th>名字</th><th>作者</th><th>许可</th><th>装了什么</th></tr></thead>
            <tbody>{list.installed.map(d => (
              <tr key={`${d.id}-${d.at}`}>
                <td>{d.homepage === undefined ? d.name : <a href={d.homepage} target="_blank" rel="noreferrer">{d.name}</a>} <span className="her-faint">{d.version}</span></td>
                <td>{d.author}</td>
                <td>{d.license}</td>
                <td>{[d.character === undefined ? '' : `人物「${d.character}」`, d.skinId === undefined ? '' : '皮肤', d.materials > 0 ? `${d.materials} 个素材` : ''].filter(Boolean).join('、') || '—'}<br /><span className="her-faint">{new Date(d.at).toLocaleDateString()}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {list !== undefined && <ExportCard list={list} state={state} />}
    </>
  )
}

/** The character of now as a 设计包: choose the parts, say who made it and under what licence. */
function ExportCard({ list, state }: { list: DesignsList; state: StateView }) {
  const e = list.exportable
  const [parts, setParts] = useState<Record<string, boolean>>({ character: true, stage: true, sheet: true, skin: false, intro: false })
  const [form, setForm] = useState({ name: e.character, id: '', author: '', version: '1.0.0', license: LICENSES[0]!, description: '' })
  useEffect(() => setForm(f => ({ ...f, name: e.character })), [e.character])
  const available: Array<{ key: string; label: string; text: string; ok: boolean }> = [
    { key: 'character', label: `人设：${e.character}`, text: '名字、人设、称呼、声音。不带模型、记忆和对话。', ok: true },
    { key: 'stage', label: '编排和它用到的素材', text: e.stage === undefined ? '这个人物还没有编排。' : `${e.stage.scenes} 个场景、${e.stage.materials} 个素材。${e.stage.skipped.length > 0 ? `带不走的：${e.stage.skipped.slice(0, 3).join('、')}${e.stage.skipped.length > 3 ? '…' : ''}` : ''}`, ok: e.stage !== undefined },
    { key: 'sheet', label: '三视图', text: e.sheet === undefined ? '素材库里还没有她的三视图。' : `「${e.sheet}」`, ok: e.sheet !== undefined },
    { key: 'skin', label: '现在的皮肤', text: e.skin === undefined ? '现在用的不是你自己的皮肤。' : `「${e.skin}」`, ok: e.skin !== undefined },
    { key: 'intro', label: '开机动画', text: e.intro === undefined ? '开机动画不是素材库里的。' : `「${e.intro}」`, ok: e.intro !== undefined },
  ]
  const chosen = available.filter(a => a.ok && parts[a.key]).map(a => a.key)
  const id = (form.id || form.name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const href = `/api/dsh-her/web/design-export?${new URLSearchParams({ parts: chosen.join(','), id: id.length >= 2 ? id : `her-${Date.now().toString(36)}`, name: form.name, author: form.author, version: form.version, license: form.license, description: form.description })}`
  return (
    <section className="her-card">
      <h2>把现在的她导出成设计包</h2>
      <p className="her-muted">从现在这个人物（{state.character.name}）导出一个 zip：别人在自己的「设计包」里装进来，就是一个一样的她。图片、视频如果是别人的，要有对方的许可才能发出去。</p>
      {available.map(a => (
        <label key={a.key} className={`her-setrow${a.ok ? '' : ' her-off'}`}>
          <div><b>{a.label}</b><span>{a.text}</span></div>
          <input type="checkbox" disabled={!a.ok} checked={a.ok && parts[a.key] === true} onChange={ev => setParts(x => ({ ...x, [a.key]: ev.target.checked }))} />
        </label>
      ))}
      <div className="her-design-form">
        <label>名字<input className="her-input" value={form.name} maxLength={40} onChange={ev => setForm(f => ({ ...f, name: ev.target.value }))} /></label>
        <label>id（英文、数字、-）<input className="her-input" value={form.id} placeholder={id || 'my-her'} maxLength={40} onChange={ev => setForm(f => ({ ...f, id: ev.target.value }))} /></label>
        <label>作者<input className="her-input" value={form.author} maxLength={60} onChange={ev => setForm(f => ({ ...f, author: ev.target.value }))} /></label>
        <label>版本<input className="her-input" value={form.version} maxLength={20} onChange={ev => setForm(f => ({ ...f, version: ev.target.value }))} /></label>
        <label>许可<select className="her-select" value={form.license} onChange={ev => setForm(f => ({ ...f, license: ev.target.value }))}>{LICENSES.map(l => <option key={l} value={l}>{l}</option>)}</select></label>
        <label className="wide">说明<input className="her-input" value={form.description} maxLength={400} placeholder="一两句话：这是一个什么样的她" onChange={ev => setForm(f => ({ ...f, description: ev.target.value }))} /></label>
      </div>
      <div className="her-row">
        <a className={`her-btn primary${chosen.length === 0 ? ' disabled' : ''}`} aria-disabled={chosen.length === 0} href={chosen.length === 0 ? undefined : href} download={`${form.name || 'her'}.zip`}>导出（zip）</a>
        <span className="her-faint">之后可以照着标准文档再改 design.json，比如加一张封面 cover.png。</span>
      </div>
    </section>
  )
}
