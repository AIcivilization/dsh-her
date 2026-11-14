/**
 * Several characters (docs/设置页与编排设计.md §12): a row of cards at the
 * top of 人设. Click one and the brain starts again for her: her persona,
 * voice, model, look and 编排, memory and conversations all come with her.
 */

import { useState } from 'react'
import { herApi, type StateView } from './api.ts'
import { Icon } from './icons.tsx'
import type { Apply } from './parts.tsx'

/** The page waits for the brain to come back as her (it is away for a moment). */
export interface Changing {
  cid: string
  name: string
  at: number
}
let listener: ((changing: Changing) => void) | undefined
export const onChanging = (fn: (changing: Changing) => void): (() => void) => {
  listener = fn
  return () => { if (listener === fn) listener = undefined }
}

/** Choose another character from anywhere on the page; the message when it could not be done. */
export async function switchCharacter(cid: string, name: string): Promise<string | undefined> {
  const result = await herApi.characterUse(cid)
  if (!result.ok) return result.message
  listener?.({ cid, name, at: Date.now() })
  return undefined
}

export function CharacterStrip({ state, apply }: { state: StateView; apply: Apply }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [copy, setCopy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [asking, setAsking] = useState<string>()
  const avatar = state.body.web.avatar

  const use = async (cid: string, label: string) => {
    if (cid === state.cid || busy) return
    setBusy(true)
    setError(undefined)
    const problem = await switchCharacter(cid, label)
    setBusy(false)
    if (problem !== undefined) setError(problem)
  }
  const add = async () => {
    setBusy(true)
    setError(undefined)
    const result = await herApi.characterNew(name, copy)
    setBusy(false)
    if (!result.ok) return setError(result.message)
    setAdding(false)
    setName('')
    listener?.({ cid: result.cid, name: name.trim() === '' ? '新人物' : name.trim(), at: Date.now() })
  }

  return (
    <section className="her-people-box">
      <div className="her-people" role="list" aria-label="人物">
        {state.characters.map(c => (
          <div key={c.cid} role="listitem" className={`her-person${c.active ? ' on' : ''}`}>
            <button className="her-person-main" disabled={busy} aria-current={c.active ? 'true' : undefined} onClick={() => void use(c.cid, c.name)} title={c.active ? '正在用她' : `换成 ${c.name}`}>
              <span className="her-person-ava">
                {c.active && avatar?.videoUrl !== undefined ? <video src={avatar.videoUrl} muted loop autoPlay playsInline />
                  : c.active && avatar !== undefined && avatar.url !== '' ? <img src={avatar.url} alt="" />
                  : <i>{[...c.name][0] ?? '她'}</i>}
              </span>
              <b>{c.name}</b>
              <small>{c.active ? '正在用' : c.line === '' ? '点一下换成她' : c.line}</small>
            </button>
            {!c.active && !c.first && (
              asking === c.cid
                ? <span className="her-person-ask">删掉她？<button className="her-btn small" onClick={() => void apply(herApi.characterRemove(c.cid)).then(() => setAsking(undefined))}>删</button><button className="her-btn small" onClick={() => setAsking(undefined)}>不删</button></span>
                : <button className="her-person-x" aria-label={`删掉 ${c.name}`} title="删掉这个人物（她的记忆和对话会留在 characters/.removed 里）" onClick={() => setAsking(c.cid)}>×</button>
            )}
          </div>
        ))}
        {!adding && state.characters.length < 12 && (
          <button className="her-person add" onClick={() => setAdding(true)}>
            <span className="her-person-ava"><Icon name="plus" /></span>
            <b>新人物</b>
            <small>再设一个不同的她</small>
          </button>
        )}
      </div>
      {adding && (
        <div className="her-people-new">
          <input className="her-input" autoFocus value={name} maxLength={20} placeholder="她叫什么（可以先空着）" onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add() }} />
          <label className="her-check"><input type="checkbox" checked={copy} onChange={e => setCopy(e.target.checked)} />照着 {state.character.name} 复制一份（人设、模型、形象）</label>
          <span className="her-grow" />
          <button className="her-btn" onClick={() => setAdding(false)}>算了</button>
          <button className="her-btn primary" disabled={busy} onClick={() => void add()}>建好，换成她</button>
        </div>
      )}
      {error !== undefined && <p className="her-error">{error}</p>}
      <p className="her-muted her-people-note">人设、声音、模型、形象和编排、记忆、对话都跟着人物走。素材库、皮肤、外接的语音服务是大家共用的。</p>
    </section>
  )
}
