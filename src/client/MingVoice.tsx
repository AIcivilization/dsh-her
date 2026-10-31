/**
 * The local Ming voice in the voice picker (docs/Ming本地声音设计.md): install
 * it, pick a built-in voice or one of her own, and make her own voice in one
 * of two ways: design it from a description, or clone it from a recording.
 */

import { useState } from 'react'
import { OWN_PREFIX, SERVICE_NAMES, VOICES } from '../core/voices.ts'
import { herApi, playAudio, type MingDraft, type StateView } from './api.ts'
import type { Apply } from './parts.tsx'
import { choiceClass, choiceNote } from './choice.tsx'

const DESIGN_EXAMPLE = '二十多岁的年轻女性，声音温柔甜美、略带慵懒，语速适中，像在深夜轻声和恋人聊天。'

type Make = 'design' | 'clone'

export function MingSection({ state, apply, inUse, trying, playing, onListen }: { state: StateView; apply: Apply; inUse: string; trying: string; playing?: string; onListen: (id: string) => void }) {
  const ming = state.voice.ming
  const [make, setMake] = useState<Make>()
  if (ming.state === 'unsupported') {
    return (
      <div>
        <label className="her-label">{SERVICE_NAMES.ming}</label>
        <p className="her-faint">{ming.error}</p>
      </div>
    )
  }
  if (!ming.installed) {
    const busy = ming.state === 'installing'
    return (
      <div>
        <label className="her-label">{SERVICE_NAMES.ming}</label>
        <p className="her-muted">完全在你的电脑上运行，不联网、不花钱，能跟着她的情绪变声，还能设计或克隆她自己的声音。要下载约 2 GB，说话时占约 2 GB 内存。</p>
        {busy && (
          <>
            <p className="her-muted">{ming.step}{ming.total ? `：${Math.round(((ming.done ?? 0) / ming.total) * 100)}%` : '…'}</p>
            {ming.total !== undefined && <div className="her-progress"><div style={{ width: `${Math.round(((ming.done ?? 0) / ming.total) * 100)}%` }} /></div>}
          </>
        )}
        {ming.state === 'failed' && <p className="her-warn">{ming.error}</p>}
        <div className="her-row"><button className="her-btn" disabled={busy} onClick={() => void apply(herApi.mingInstall())}>{busy ? '正在安装…' : ming.state === 'failed' ? '再试一次' : '安装本机声音'}</button></div>
      </div>
    )
  }
  const settings = ming.settings
  const remove = (id: string, name: string) => {
    if (window.confirm(`删掉「${name}」这个声音？`)) void apply(herApi.mingRemove(id))
  }
  return (
    <div>
      <label className="her-label">{SERVICE_NAMES.ming}</label>
      <p className="her-muted">{mingStateText(ming.state)}{ming.state === 'failed' && <> {ming.error} <button className="her-btn small" onClick={() => void apply(herApi.mingRestart())}>重启</button></>}</p>
      <div className="her-grid">
        {VOICES.filter(v => v.service === 'ming').map(v => (
          <button key={v.id} className={choiceClass(v.id, inUse, trying)} onClick={() => onListen(v.id)}>
            {v.name}<small>{choiceNote(v.id, inUse, `${v.desc}${v.id === inUse ? '' : ' · 点一下试听'}`, playing)}</small>
          </button>
        ))}
        {ming.own.map(v => (
          <div key={v.id} className={choiceClass(`${OWN_PREFIX}${v.id}`, inUse, trying)} role="button" tabIndex={0} onClick={() => onListen(`${OWN_PREFIX}${v.id}`)}>
            {v.name}<small>{choiceNote(`${OWN_PREFIX}${v.id}`, inUse, `${v.kind === 'design' ? '我设计的' : '我克隆的'}${`${OWN_PREFIX}${v.id}` === inUse ? '' : ' · 点一下试听'}`, playing)}</small>
            <button className="her-btn link" onClick={e => { e.stopPropagation(); remove(v.id, v.name) }}>删掉</button>
          </div>
        ))}
      </div>
      <div className="her-row">
        <button className={`her-btn ${make === 'design' ? 'primary' : ''}`} onClick={() => setMake(make === 'design' ? undefined : 'design')}>设计一个声音</button>
        <button className={`her-btn ${make === 'clone' ? 'primary' : ''}`} onClick={() => setMake(make === 'clone' ? undefined : 'clone')}>克隆一个声音</button>
      </div>
      {make === 'design' && <DesignVoice apply={apply} onDone={() => setMake(undefined)} />}
      {make === 'clone' && <CloneVoice apply={apply} onDone={() => setMake(undefined)} />}
      <div className="her-row">
        <select className="her-select" style={{ width: 'auto' }} value={settings.quality} onChange={e => void apply(herApi.mingSettings({ quality: e.target.value as 'quality' | 'speed' }))}>
          <option value="quality">音质优先（一句话约 2–3 秒）</option>
          <option value="speed">速度优先（约快一倍，音质略差）</option>
        </select>
        <label><input type="checkbox" checked={settings.moods} onChange={e => void apply(herApi.mingSettings({ moods: e.target.checked }))} /> 跟着她的情绪变声</label>
        <select className="her-select" style={{ width: 'auto' }} value={settings.idleMinutes ?? ''} onChange={e => void apply(herApi.mingSettings({ idleMinutes: e.target.value === '' ? -1 : Number(e.target.value) }))}>
          <option value="">不说话时自动省内存（按内存大小）</option>
          <option value="10">不说话 10 分钟后省内存</option>
          <option value="30">不说话 30 分钟后省内存</option>
          <option value="0">一直开着（占约 2 GB 内存）</option>
        </select>
      </div>
      <p className="her-faint">
        省内存时会停掉声音程序，你一开口就重新启动（约 8 秒）。不用了可以
        <button className="her-btn link" onClick={() => { if (window.confirm('卸载本机声音？会删掉约 2 GB 的程序和模型；你自己的声音会保留。')) void apply(herApi.mingUninstall()) }}>卸载本机声音</button>。
      </p>
    </div>
  )
}

function mingStateText(state: string): string {
  switch (state) {
    case 'ready': return '已就绪'
    case 'loading': return '正在加载声音模型…'
    case 'stopped': return '已安装（为了省内存现在没在运行，说话时会自动启动）'
    case 'failed': return '出错了：'
    default: return ''
  }
}

function DesignVoice({ apply, onDone }: { apply: Apply; onDone: () => void }) {
  const [description, setDescription] = useState(DESIGN_EXAMPLE)
  const [drafts, setDrafts] = useState<MingDraft[]>()
  const [chosen, setChosen] = useState<string>()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const generate = async () => {
    setBusy(true)
    setError(undefined)
    setDrafts(undefined)
    const result = await herApi.mingDesign(description)
    setBusy(false)
    if (!result.ok) return setError(result.message)
    setDrafts(result.drafts)
    setChosen(result.drafts[0]?.id)
  }
  const keep = async () => {
    if (chosen === undefined) return
    const result = await herApi.mingKeep(chosen, name)
    if (!result.ok) return setError(result.message)
    if (await apply(herApi.saveCharacter({ voice: `${OWN_PREFIX}${result.voice.id}` }))) onDone()
  }
  return (
    <div className="her-card" style={{ background: 'none', padding: '4px 0' }}>
      <label className="her-label">用一句话描述她的声音：年龄、音色、语气、语速，像什么场合说话</label>
      <textarea className="her-textarea" style={{ minHeight: 60 }} value={description} onChange={e => setDescription(e.target.value)} />
      <div className="her-row"><button className="her-btn" disabled={busy} onClick={() => void generate()}>{busy ? '正在生成 3 个（约 10 秒）…' : '生成 3 个试听'}</button></div>
      <p className="her-faint">同一句描述，每次生成的声音都会有点不同。挑一个最喜欢的留下来，她以后就一直用这一个。</p>
      {drafts !== undefined && (
        <>
          <div className="her-row">
            {drafts.map((d, i) => (
              <button key={d.id} className={`her-btn ${chosen === d.id ? 'primary' : ''}`} onClick={() => { setChosen(d.id); playAudio(d.audio, 'wav') }}>▶ 第 {i + 1} 个</button>
            ))}
          </div>
          <div className="her-row">
            <input className="her-input" style={{ flex: 1 }} placeholder="给这个声音起个名字" value={name} onChange={e => setName(e.target.value)} />
            <button className="her-btn primary" disabled={chosen === undefined || name.trim() === ''} onClick={() => void keep()}>留下选中的，让她用这个声音</button>
          </div>
        </>
      )}
      {error !== undefined && <p className="her-danger">{error}</p>}
    </div>
  )
}

function CloneVoice({ apply, onDone }: { apply: Apply; onDone: () => void }) {
  const [draft, setDraft] = useState<MingDraft & { text: string }>()
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const upload = async (file: File | undefined) => {
    if (file === undefined) return
    setBusy(true)
    setError(undefined)
    setDraft(undefined)
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const result = await herApi.mingClone(btoa(binary), file.name)
    setBusy(false)
    if (!result.ok) return setError(result.message)
    setDraft(result.draft)
    setText(result.draft.text)
  }
  const keep = async () => {
    if (draft === undefined) return
    const result = await herApi.mingKeep(draft.id, name, { text, consent })
    if (!result.ok) return setError(result.message)
    if (await apply(herApi.saveCharacter({ voice: `${OWN_PREFIX}${result.voice.id}` }))) onDone()
  }
  return (
    <div className="her-card" style={{ background: 'none', padding: '4px 0' }}>
      <p className="her-muted">选一段 5–15 秒的录音：一个人清楚地说话，没有背景音乐和杂音（手机"语音备忘录"录的 m4a 就行，也可以是 wav、mp3）。超过 15 秒只用前 15 秒。录音只留在你的电脑上。</p>
      <input type="file" accept="audio/*,.m4a,.wav,.mp3,.aiff,.caf" disabled={busy} onChange={e => void upload(e.target.files?.[0])} />
      {busy && <p className="her-muted">正在处理录音、听它说了什么…</p>}
      {draft !== undefined && (
        <>
          <div className="her-row"><button className="her-btn" onClick={() => playAudio(draft.audio, 'wav')}>▶ 听一下（{(draft.durationMs / 1000).toFixed(1)} 秒）</button></div>
          <label className="her-label">录音里说的话（自动听出来的，有错字要改对：克隆要用到它）</label>
          <textarea className="her-textarea" style={{ minHeight: 50 }} value={text} onChange={e => setText(e.target.value)} />
          <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> 这是我本人的声音，或者我得到了声音主人的同意（不能用明星或其他人未经同意的声音）</label>
          <div className="her-row">
            <input className="her-input" style={{ flex: 1 }} placeholder="给这个声音起个名字" value={name} onChange={e => setName(e.target.value)} />
            <button className="her-btn primary" disabled={!consent || name.trim() === '' || text.trim() === ''} onClick={() => void keep()}>保存，让她用这个声音</button>
          </div>
        </>
      )}
      {error !== undefined && <p className="her-danger">{error}</p>}
    </div>
  )
}
