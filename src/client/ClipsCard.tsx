/**
 * 画面 (was a tab of the body's own settings window): the clips of one look,
 * and, in a development pack (clips.json), what each is used for. An imported
 * pack goes by its file names, so it is only shown here. Saving shows her the
 * new layout at once.
 */

import { useCallback, useEffect, useState } from 'react'
import { herApi } from './api.ts'
import type { ClipUse, ClipsView } from '../pack/types.ts'

const USES: Array<[ClipUse, string]> = [
  ['idle', '待机（同类的轮流播）'], ['listen', '听你说话'], ['talk', '她说话'], ['think', '她在想'],
  ['shy', '害羞'], ['happy', '开心'], ['fall-asleep', '趴下睡着（进入睡觉）'], ['sleep', '睡着（循环）'], ['none', '不用'],
]

export function ClipsCard() {
  const [packs, setPacks] = useState<Array<{ id: string; name: string }>>([])
  const [view, setView] = useState<ClipsView>()
  const [edits, setEdits] = useState<Record<string, { use: ClipUse; desc: string }>>({})
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string }>()

  const load = useCallback(async (pack?: string) => {
    const result = await herApi.lookClips(pack)
    if (!result.ok) return setNote({ kind: 'error', text: result.message })
    setPacks(result.packs)
    setView(result.view)
    setEdits({})
  }, [])
  useEffect(() => { void load() }, [load])

  if (packs.length === 0) return <p className="her-muted">还没有外形：先在上面选一个现成的，或者导入你自己的素材。</p>
  const value = (id: string, use: ClipUse, desc: string) => edits[id] ?? { use, desc }
  const change = (id: string, current: { use: ClipUse; desc: string }, patch: Partial<{ use: ClipUse; desc: string }>) => setEdits(e => ({ ...e, [id]: { ...current, ...patch } }))
  const save = async () => {
    if (view === undefined) return
    const changes = view.clips.map(c => ({ id: c.id, ...value(c.id, c.use, c.desc) }))
    const result = await herApi.lookClipsSave(view.packId, changes)
    setNote(result.ok ? { kind: 'ok', text: '已保存，她马上换成新的编排。' } : { kind: 'error', text: result.message })
    if (result.ok) await load(view.packId)
  }
  const dirty = Object.keys(edits).length > 0
  return (
    <div>
      <div className="her-row">
        <select className="her-select" style={{ width: 'auto', maxWidth: 280 }} value={view?.packId ?? ''} onChange={e => void load(e.target.value)}>
          {packs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {view?.editable === true && <button className="her-btn primary" disabled={!dirty} onClick={() => void save()}>保存</button>}
        {note !== undefined && <span className={note.kind === 'ok' ? 'her-ok' : 'her-danger'}>{note.text}</span>}
      </div>
      {view !== undefined && (
        <p className="her-muted">
          {view.editable
            ? `「${view.name}」的每一段用在哪里，由你来定。同一类的几段会轮流播；"趴下睡着"在你 10 分钟没理她时播一次，接着播"睡着"；你一开口或点她就醒。鼠标移到画面上预览。`
            : `「${view.name}」是导入的外形包，片段的用途由文件名决定（见 docs/素材生成提示词.md），这里只能看。`}
        </p>
      )}
      <div className="her-clips">
        {view?.clips.map(c => {
          const current = value(c.id, c.use, c.desc)
          return (
            <div key={c.id} className={`her-clip${current.use === 'none' ? ' off' : ''}`}>
              <video src={c.url} muted loop preload="metadata" playsInline
                onMouseEnter={e => void e.currentTarget.play().catch(() => {})}
                onMouseLeave={e => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }} />
              {view.editable
                ? <>
                  <select className="her-input" value={current.use} onChange={e => change(c.id, current, { use: e.target.value as ClipUse })}>
                    {USES.map(([use, label]) => <option key={use} value={use}>{label}</option>)}
                  </select>
                  <input className="her-input" value={current.desc} placeholder="说明（可不填）" onChange={e => change(c.id, current, { desc: e.target.value })} />
                </>
                : <div className="her-faint">{c.desc}</div>}
              <div className="her-faint">{c.id} · {(c.durationMs / 1000).toFixed(1)} 秒</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
