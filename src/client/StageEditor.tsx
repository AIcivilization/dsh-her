/**
 * 编排 (docs/设置页与编排设计.md §2, §3): the table of rows × scenes with a
 * picture of each scene on top, what each column is and when it comes up,
 * and the 素材库 below. Changes stay in the page until 保存; every save keeps
 * the one before as a version.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { herApi, type StageView } from './api.ts'
import { uploadFiles, type UploadProgress } from './upload.ts'
import { openDesign } from './design.ts'
import { Icon } from './icons.tsx'
import type { Cell, Hold, Scene, Stage, When, WhenKind } from '../pack/stage.ts'

type Row = 'skin' | 'avatar' | 'desktop' | 'pet'
const ROW_LABEL: Record<Row, string> = { skin: '皮肤', avatar: '头像', desktop: '桌面', pet: '宠物' }
const LIBRARY: Array<Exclude<Row, 'skin'>> = ['avatar', 'desktop', 'pet']
/** A row of the 素材库: the three of 编排, and her 三视图 (reference pictures). */
type LibRow = Exclude<Row, 'skin'> | 'sheet'
const LIB_LABEL: Record<LibRow, string> = { avatar: '头像', desktop: '桌面', pet: '宠物', sheet: '三视图' }

const WHEN_LABEL: Record<WhenKind, string> = {
  'her-speaking': '她开口', 'you-speaking': '你在说', thinking: '她在想', touched: '被碰', back: '你回来了', opening: '她先开口时',
  active: '你在用电脑', idle: '你很久没动', hours: '时间段', 'quiet-hours': '安静时段', random: '隔一会儿随机',
  'she-chooses': '她自己选', 'you-ask': '你说了', all: '同时满足',
}
const ADDABLE: WhenKind[] = ['her-speaking', 'you-speaking', 'thinking', 'touched', 'back', 'opening', 'active', 'idle', 'hours', 'quiet-hours', 'random', 'she-chooses', 'you-ask']

export function whenText(when: When): string {
  switch (when.on) {
    case 'touched': return `被碰${when.part === 'head' ? '头' : when.part === 'body' ? '身体' : ''}${when.kind === 'long' ? '（按住）' : ''}`
    case 'hours': return `${when.hours.replace(/\s/g, '').replace('-', '–')} 点`
    case 'random': return `每 ${when.everyMinutes[0]}–${when.everyMinutes[1]} 分钟随机`
    case 'all': return when.of.map(whenText).join(' 并且 ')
    default: return WHEN_LABEL[when.on]
  }
}
const holdText = (hold: Hold | undefined) => hold === 'once' ? '播一遍' : hold === 'while' || hold === undefined ? '条件满足时一直在' : `持续 ${hold.minutes} 分钟`

const fileUrl = (row: string, name: string) => `/api/dsh-her/web/library-file?row=${encodeURIComponent(row)}&name=${encodeURIComponent(name)}`

/** `part`: the table of scenes (编排), or the 素材库; each is a page of its own. */
export function StageEditor({ part = 'table', onLibrary, onGuide, sheet, onSheet }: { part?: 'table' | 'library'; onLibrary?: () => void; onGuide?: () => void; sheet?: string; onSheet?: (name: string | null) => void }) {
  const [view, setView] = useState<StageView>()
  const [draft, setDraft] = useState<Stage>()
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string }>()
  const [column, setColumn] = useState<string>()
  const [cell, setCell] = useState<{ scene: string; row: Row }>()
  const [big, setBig] = useState(false)

  const take = useCallback((result: Awaited<ReturnType<typeof herApi.stageGet>>, saved?: string) => {
    if (!result.ok) {
      setNote({ kind: 'error', text: result.message })
      return false
    }
    setView(result)
    setDraft(result.stage === undefined ? undefined : structuredClone(result.stage))
    setDirty(false)
    if (saved !== undefined) setNote({ kind: 'ok', text: saved })
    return true
  }, [])
  useEffect(() => { void herApi.stageGet().then(r => take(r)) }, [take])

  if (view === undefined) return <p className="her-muted">正在读编排…</p>
  if (draft === undefined) return <div><p className="her-danger">编排文件用不了：{view.problems.join('；')}</p></div>

  const edit = (change: (stage: Stage) => void) => {
    const next = structuredClone(draft)
    change(next)
    setDraft(next)
    setDirty(true)
    setNote(undefined)
  }
  const sceneOf = (stage: Stage, id: string) => stage.scenes.find(s => s.id === id)!
  const save = async () => take(await herApi.stageSave(draft), '已保存。之前的样子留成了一个版本，可以退回。')
  const cancel = () => {
    setDraft(view.stage === undefined ? undefined : structuredClone(view.stage))
    setDirty(false)
    setNote(undefined)
  }
  const addScene = () => {
    const id = `s${Date.now().toString(36)}`
    edit(stage => { stage.scenes.push({ id, name: `场景${stage.scenes.length}`, when: [{ on: 'she-chooses' }], hold: { minutes: 10 }, cells: {} }) })
    setColumn(id)
    setCell(undefined)
  }
  const selected = column === undefined ? undefined : draft.scenes.find(s => s.id === column)
  const rows = (draft.rows.filter(r => r in ROW_LABEL) as Row[])

  if (part === 'library') {
    return (
      <div className="her-stage">
        <section className="her-card">
          <p className="her-muted">文件名就是素材的名字（"打麻将.mp4"就叫"打麻将"）。可以一次选好多个，也可以选一整个文件夹。传上来的每个文件都会对照规格看一遍，不合适的地方标出来，但照样能用。</p>
          <details className="her-more"><summary>每一行要什么样的文件</summary>
            <ul>
              <li><b>三视图</b>：她的正面、侧面、背面在一张图里，2048×1152 左右。别的图和视频都拿它当参考来做。</li>
              <li><b>头像</b>：正方形，512×512 左右；图片（PNG、WebP、SVG）或 15 秒以内的视频。</li>
              <li><b>桌面</b>：和屏幕一样的横版比例（16:9 或 16:10），宽 1920 以上，最好和屏幕一样大；视频或图片。</li>
              <li><b>宠物</b>：透明背景，竖版，高 1280 左右；视频 5–10 秒，首尾能接上就能无缝循环。纯绿背景的传上来点"抠掉背景"。</li>
              <li>SVG 里能运行的东西（脚本、点击事件、外部链接）上传时会去掉，画面不受影响。</li>
            </ul>
          </details>
          {onGuide !== undefined && (
            <button className="her-linkrow" onClick={onGuide}>
              <Icon name="guide" />
              <span><b>不知道该做哪些、怎么做？</b><small>「素材指南」里每一样都写了尺寸、要求，和能直接复制的提示词。</small></span>
              <Icon name="arrow" size={16} />
            </button>
          )}
        </section>
        <LibraryRow row="sheet" view={view} stage={draft} onView={r => take(r)} {...(sheet === undefined ? {} : { sheet })} {...(onSheet === undefined ? {} : { onSheet })} />
        {LIBRARY.map(row => <LibraryRow key={row} row={row} view={view} stage={draft} onView={r => take(r)} />)}
      </div>
    )
  }

  return (
    <div className="her-stage">
      <section className={`her-card her-playcard${view.playing ? ' on' : ''}`}>
        <div className="her-setrow">
          <div><b>让她按这份编排来</b><span>{view.playing ? '保存以后她马上换。关掉就回到原来用的形象。' : '现在她还按「形象」里选的来；打开后按这张表，关掉就回去。'}</span></div>
          <input type="checkbox" checked={view.playing} onChange={e => {
            const on = e.target.checked
            void herApi.stagePlay(on).then(r => take(r, on ? '她现在按这份编排来。' : '回到了原来的形象。'))
          }} />
        </div>
      </section>
      {view.playing && view.playNotes.length > 0 && <ul className="her-warnlist">{view.playNotes.map(n => <li key={n}>{n}</li>)}</ul>}
      <section className="her-card">
      <div className="her-row her-toolbar">
        <button className="her-btn primary" disabled={!dirty} onClick={() => void save()}>保存</button>
        {dirty && <button className="her-btn" onClick={cancel}>不保存，回到原样</button>}
        {view.versions.length > 0 && (
          <select className="her-select" style={{ width: 'auto' }} value="" onChange={e => { if (e.target.value !== '' && window.confirm('退回到这个版本？现在的样子也会留成一个版本。')) void herApi.stageRestore(e.target.value).then(r => take(r, '已退回。')) }}>
            <option value="">退回到之前的版本…</option>
            {view.versions.map(v => <option key={v.id} value={v.id}>{new Date(v.at).toLocaleString()}{v.name === '' ? '' : ` · ${v.name}`}</option>)}
          </select>
        )}
        <button className="her-btn small her-ai" title="让 dsh 的模型帮你改：打开设计会话，说你想怎么改" onClick={() => void openDesign('整份编排').then(m => m !== undefined && setNote({ kind: 'error', text: m }))}>+AI 改编排</button>
        <span className="her-grow" />
        <button className="her-btn small" onClick={() => { setBig(!big); setCell(undefined); setColumn(undefined) }}>{big ? '收起大舞台' : '宠物的位置和大小'}</button>
      </div>
      {note !== undefined && <p className={note.kind === 'ok' ? 'her-ok' : 'her-danger'}>{note.text}</p>}
      <p className="her-faint">点格子选素材，点列头改这个场景什么时候出现。格子空着就沿用下面一层的，最后落到"初始"。</p>
      {[...view.problems, ...view.missing].length > 0 && (
        <ul className="her-warnlist">{[...view.problems, ...view.missing].map(p => <li key={p}>{p}</li>)}</ul>
      )}

      <div className="her-stage-scroll">
        <table className="her-stage-table">
          <thead>
            <tr>
              <th />
              {draft.scenes.map((scene, i) => (
                <th key={scene.id} className={`${column === scene.id ? 'on' : ''}${scene.off === true ? ' off' : ''}`} onClick={() => { setColumn(column === scene.id ? undefined : scene.id); setCell(undefined) }}>
                  <Thumb view={view} stage={draft} scene={scene} />
                  <div className="her-stage-name">{scene.name}</div>
                  <div className="her-faint">{i === 0 ? '平时' : scene.off === true ? '暂时不用' : (scene.when ?? []).map(whenText).join(' / ') || '没有时机'}</div>
                </th>
              ))}
              <th className="her-stage-add"><button className="her-btn" title="加一列场景" onClick={addScene}>＋</button></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row}>
                <td className="her-stage-row">{ROW_LABEL[row]}</td>
                {draft.scenes.map(scene => {
                  const c = scene.cells[row]
                  const open = cell?.scene === scene.id && cell.row === row
                  if (row === 'skin') return <td key={scene.id} className="her-faint">{c?.use.join('、') ?? (scene === draft.scenes[0] ? '在「皮肤」里选' : '沿用')}</td>
                  return (
                    <td key={scene.id} className={`her-stage-cell${open ? ' on' : ''}`} onClick={() => { setCell(open ? undefined : { scene: scene.id, row }); setColumn(undefined) }}>
                      {c === undefined || c.use.length === 0
                        ? <span className="her-faint">沿用</span>
                        : <>{c.use.map(u => <span key={u} className={`her-chip${missingIn(view, row, u) ? ' bad' : ''}`}>{u.startsWith('pack:') ? `外形·${packName(view, u)}` : u}</span>)}{c.use.length > 1 && <span className="her-faint"> · {c.pick === 'random' ? '随机' : '轮换'}</span>}</>}
                    </td>
                  )
                })}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      </section>
      {big && <BigStage view={view} stage={draft} onPlace={pet => edit(stage => { stage.place = { ...(stage.place as object | undefined), pet } })} />}
      {cell !== undefined && cell.row !== 'skin' && (
        <CellPicker view={view} row={cell.row} scene={sceneOf(draft, cell.scene)} isBase={draft.scenes[0]!.id === cell.scene}
          onChange={next => edit(stage => {
            const scene = sceneOf(stage, cell.scene)
            if (next === undefined) delete scene.cells[cell.row]
            else scene.cells[cell.row] = next
          })} onClose={() => setCell(undefined)} />
      )}
      {selected !== undefined && (
        <ColumnEditor scene={selected} index={draft.scenes.indexOf(selected)} count={draft.scenes.length}
          onChange={change => edit(stage => change(sceneOf(stage, selected.id)))}
          onMove={step => edit(stage => {
            const i = stage.scenes.findIndex(s => s.id === selected.id)
            const j = i + step
            if (i <= 0 || j <= 0 || j >= stage.scenes.length) return
            const [moved] = stage.scenes.splice(i, 1)
            stage.scenes.splice(j, 0, moved!)
          })}
          onRemove={() => { edit(stage => { stage.scenes = stage.scenes.filter(s => s.id !== selected.id) }); setColumn(undefined) }}
          onClose={() => setColumn(undefined)} />
      )}

      {onLibrary !== undefined && (
        <button className="her-linkrow" onClick={onLibrary}>
          <Icon name="library" />
          <span><b>素材库</b><small>格子里能选的图片、视频和 SVG，都在素材库里上传。</small></span>
          <Icon name="arrow" size={16} />
        </button>
      )}
    </div>
  )
}

const packName = (view: StageView, use: string) => view.packs.find(p => `pack:${p.id}` === use)?.name ?? use.slice(5)
function missingIn(view: StageView, row: Row, use: string): boolean {
  if (use.startsWith('pack:')) return !view.packs.some(p => `pack:${p.id}` === use)
  return !(view.library[row as Exclude<Row, 'skin'>] ?? []).some(m => m.name === use)
}

/** A small screen: the desktop behind, the pet in front, dsh on the right with her small picture on its chat box. */
function Thumb({ view, stage, scene }: { view: StageView; stage: Stage; scene: Scene }) {
  const first = stage.scenes[0]!
  const pick = (row: Row) => scene.cells[row]?.use[0] ?? first.cells[row]?.use[0]
  const show = (row: Exclude<Row, 'skin'>, className: string) => {
    const use = pick(row)
    if (use === undefined) return null
    // A whole look: its name on the desktop, her mark elsewhere (no picture of it here).
    if (use.startsWith('pack:')) return row === 'desktop' ? <div className={`${className} her-thumb-text`}>{packName(view, use)}</div> : <div className="her-thumb-her">她</div>
    const material = view.library[row].find(m => m.name === use)
    if (material === undefined) return null
    return material.kind === 'video'
      ? <video className={className} src={`${fileUrl(row, use)}#t=0.1`} muted preload="metadata" playsInline />
      : <img className={className} alt="" src={fileUrl(row, use)} />
  }
  return (
    <div className="her-thumb">
      {show('desktop', 'her-thumb-desk')}
      <div className="her-thumb-dsh"><div className="her-thumb-ava">{show('avatar', 'her-thumb-fill')}</div></div>
      <div className="her-thumb-pet">{show('pet', 'her-thumb-fill')}</div>
    </div>
  )
}

type PetPlace = { x: number; y: number; height: number }
const DEFAULT_PLACE: PetPlace = { x: 0.85, y: 1, height: 0.42 }

/**
 * The screen, big: drag her to where she should float, pull the corner to
 * make her bigger or smaller. Kept as fractions of the screen (§3.9).
 */
function BigStage({ view, stage, onPlace }: { view: StageView; stage: Stage; onPlace: (pet: PetPlace) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const saved = (stage.place as { pet?: PetPlace } | undefined)?.pet
  const [place, setPlace] = useState<PetPlace>(saved ?? DEFAULT_PLACE)
  const base = stage.scenes[0]!
  const petUse = base.cells.pet?.use[0]
  const petInfo = petUse === undefined ? undefined : view.library.pet.find(m => m.name === petUse)?.info
  const aspect = petInfo?.width !== undefined && petInfo.height !== undefined ? petInfo.width / petInfo.height : 0.6
  const drag = (event: ReactPointerEvent, how: 'move' | 'size') => {
    event.preventDefault()
    const area = box.current!.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY, place }
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - start.x) / area.width
      const dy = (e.clientY - start.y) / area.height
      const next = how === 'move'
        ? { ...start.place, x: Math.min(1, Math.max(0, start.place.x + dx)), y: Math.min(1, Math.max(0.1, start.place.y + dy)) }
        : { ...start.place, height: Math.min(0.95, Math.max(0.1, start.place.height - dy)) }
      setPlace(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setPlace(current => {
        onPlace(current)
        return current
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const heightPx = `${place.height * 100}%`
  return (
    <div className="her-card her-stage-panel">
      <p className="her-muted">拖动她换位置，拉右上角的点改大小。保存后，她浮在最上层时就站在这里（换了屏幕也按比例放）。</p>
      <div ref={box} className="her-bigstage">
        <Thumb view={view} stage={stage} scene={base} />
        <div className="her-bigpet" style={{ left: `${place.x * 100}%`, top: `${place.y * 100}%`, height: heightPx, aspectRatio: String(aspect) }} onPointerDown={e => drag(e, 'move')}>
          <span>她</span>
          <i className="her-bigpet-size" onPointerDown={e => { e.stopPropagation(); drag(e, 'size') }} />
        </div>
      </div>
      <div className="her-row">
        <span className="her-faint">位置：左右 {Math.round(place.x * 100)}%，脚在 {Math.round(place.y * 100)}%，高 {Math.round(place.height * 100)}% 屏幕</span>
        <button className="her-btn small" onClick={() => { setPlace(DEFAULT_PLACE); onPlace(DEFAULT_PLACE) }}>回到右下角</button>
      </div>
    </div>
  )
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="her-card her-stage-panel">
      <div className="her-row"><h2 style={{ flex: 1, margin: 0 }}>{title}</h2><button className="her-btn small" onClick={onClose}>收起</button></div>
      {children}
    </div>
  )
}

function CellPicker({ view, row, scene, isBase, onChange, onClose }: { view: StageView; row: Exclude<Row, 'skin'>; scene: Scene; isBase: boolean; onChange: (cell: Cell | undefined) => void; onClose: () => void }) {
  const cell = scene.cells[row]
  const used = cell?.use ?? []
  const toggle = (name: string) => {
    const use = used.includes(name) ? used.filter(u => u !== name) : [...used, name]
    onChange(use.length === 0 ? undefined : { ...(cell ?? {}), use })
  }
  const packs = view.packs.filter(p => (row === 'desktop' ? p.layer === 'scene' : row === 'pet' ? p.layer === 'overlay' : false))
  const materials = view.library[row]
  return (
    <Panel title={`${scene.name} · ${ROW_LABEL[row]}`} onClose={onClose}>
      {materials.length === 0 && packs.length === 0 && <p className="her-muted">{ROW_LABEL[row]}的素材库还是空的：先在下面上传。</p>}
      <div className="her-choices">
        {materials.map(m => <label key={m.name} className={`her-pick${used.includes(m.name) ? ' on' : ''}`}><input type="checkbox" checked={used.includes(m.name)} onChange={() => toggle(m.name)} /> {m.name}</label>)}
        {packs.map(p => <label key={p.id} className={`her-pick${used.includes(`pack:${p.id}`) ? ' on' : ''}`} title="整套外形：说话、听、睡这些由它自己处理"><input type="checkbox" checked={used.includes(`pack:${p.id}`)} onChange={() => toggle(`pack:${p.id}`)} /> 外形·{p.name}</label>)}
        {used.filter(u => missingIn(view, row, u)).map(u => <label key={u} className="her-pick on bad"><input type="checkbox" checked onChange={() => toggle(u)} /> {u}（不在了）</label>)}
      </div>
      {used.length > 1 && (
        <div className="her-row">
          <span className="her-muted">选了 {used.length} 个：</span>
          <label><input type="radio" checked={cell?.pick !== 'random'} onChange={() => onChange({ ...cell!, pick: 'rotate' })} /> 轮换</label>
          <label><input type="radio" checked={cell?.pick === 'random'} onChange={() => onChange({ ...cell!, pick: 'random' })} /> 随机</label>
        </div>
      )}
      <p className="her-faint">{isBase ? '"初始"里空着，这一行平时就什么都不显示。' : '一个都不选，就沿用下面一层的。'}</p>
    </Panel>
  )
}

function ColumnEditor({ scene, index, count, onChange, onMove, onRemove, onClose }: { scene: Scene; index: number; count: number; onChange: (change: (scene: Scene) => void) => void; onMove: (step: number) => void; onRemove: () => void; onClose: () => void }) {
  const [adding, setAdding] = useState<WhenKind>('she-chooses')
  const base = index === 0
  const whens = scene.when ?? []
  const setWhen = (next: When[]) => onChange(s => { s.when = next })
  const fresh = (kind: WhenKind): When => kind === 'hours' ? { on: 'hours', hours: '22-7' } : kind === 'random' ? { on: 'random', everyMinutes: [10, 30] } : kind === 'touched' ? { on: 'touched' } : { on: kind } as When
  const hold = scene.hold
  return (
    <Panel title={`列：${scene.name}`} onClose={onClose}>
      <div className="her-row">
        <label className="her-muted" style={{ width: 56 }}>名字</label>
        <input className="her-input" style={{ flex: 1 }} value={scene.name} onChange={e => onChange(s => { s.name = e.target.value })} />
      </div>
      {!base && (
        <>
          <div className="her-row">
            <label className="her-muted" style={{ width: 56 }}>说明</label>
            <input className="her-input" style={{ flex: 1 }} value={scene.about ?? ''} placeholder="给她看的一句话，比如：陪你打麻将，手里摸着牌" onChange={e => onChange(s => { if (e.target.value === '') delete s.about; else s.about = e.target.value })} />
          </div>
          <p className="her-muted" style={{ marginBottom: 4 }}>什么时候出现（满足任何一个就出现）：</p>
          {whens.map((when, i) => (
            <div key={i} className="her-row">
              <span style={{ minWidth: 96 }}>{whenText(when)}</span>
              {when.on === 'hours' && <input className="her-input" style={{ width: 90 }} value={when.hours} onChange={e => setWhen(whens.map((w, j) => j === i ? { on: 'hours', hours: e.target.value } : w))} title="比如 23-7（跨过半夜）" />}
              {when.on === 'random' && <>
                <input className="her-input" style={{ width: 60 }} type="number" min={1} value={when.everyMinutes[0]} onChange={e => setWhen(whens.map((w, j) => j === i ? { on: 'random', everyMinutes: [Number(e.target.value) || 1, when.everyMinutes[1]] } : w))} />
                <span>到</span>
                <input className="her-input" style={{ width: 60 }} type="number" min={1} value={when.everyMinutes[1]} onChange={e => setWhen(whens.map((w, j) => j === i ? { on: 'random', everyMinutes: [when.everyMinutes[0], Number(e.target.value) || 1] } : w))} />
                <span>分钟</span>
              </>}
              {when.on === 'touched' && (
                <select className="her-select" style={{ width: 'auto' }} value={when.part ?? ''} onChange={e => setWhen(whens.map((w, j) => j === i ? { on: 'touched', ...(e.target.value === '' ? {} : { part: e.target.value as 'head' | 'body' }) } : w))}>
                  <option value="">头或身体</option><option value="head">头</option><option value="body">身体</option>
                </select>
              )}
              <button className="her-btn small" onClick={() => setWhen(whens.filter((_, j) => j !== i))}>去掉</button>
            </div>
          ))}
          <div className="her-row">
            <select className="her-select" style={{ width: 'auto' }} value={adding} onChange={e => setAdding(e.target.value as WhenKind)}>
              {ADDABLE.map(k => <option key={k} value={k}>{WHEN_LABEL[k]}</option>)}
            </select>
            <button className="her-btn small" onClick={() => setWhen([...whens, fresh(adding)])}>加上</button>
          </div>
          <div className="her-row">
            <label className="her-muted" style={{ width: 56 }}>播多久</label>
            <select className="her-select" style={{ width: 'auto' }} value={hold === 'once' ? 'once' : hold === 'while' || hold === undefined ? 'while' : 'minutes'} onChange={e => onChange(s => { s.hold = e.target.value === 'once' ? 'once' : e.target.value === 'while' ? 'while' : { minutes: 10 } })}>
              <option value="once">播一遍就回去</option><option value="while">条件满足时一直在</option><option value="minutes">持续几分钟</option>
            </select>
            {typeof hold === 'object' && <><input className="her-input" style={{ width: 70 }} type="number" min={1} value={hold.minutes} onChange={e => onChange(s => { s.hold = { minutes: Number(e.target.value) || 1 } })} /><span>分钟</span></>}
          </div>
          <div className="her-row">
            <label><input type="checkbox" checked={scene.off === true} onChange={e => onChange(s => { if (e.target.checked) s.off = true; else delete s.off })} /> 暂时不用这一列</label>
            <span style={{ flex: 1 }} />
            <button className="her-btn small" disabled={index <= 1} onClick={() => onMove(-1)}>← 左移</button>
            <button className="her-btn small" disabled={index >= count - 1} onClick={() => onMove(1)}>右移 →</button>
            <button className="her-btn small" onClick={() => { if (window.confirm(`删掉"${scene.name}"这一列？保存后才算数。`)) onRemove() }}>删掉这一列</button>
            <button className="her-btn small her-ai" onClick={() => void openDesign(`编排里的「${scene.name}」这一列（id ${scene.id}）`)}>+AI</button>
          </div>
          <p className="her-faint">几个场景同时满足时：一下子的事（开口、被碰）＞她自己选的、你说了的＞持续的条件（时间段、你在不在）＞初始；同一层里右边的列优先。现在：{holdText(hold)}。</p>
        </>
      )}
      {base && <p className="her-faint">"初始"是平时的样子，一直都在，别的列空着的格子都落到这里。</p>}
    </Panel>
  )
}

function LibraryRow({ row, view, stage, onView, sheet, onSheet }: { row: LibRow; view: StageView; stage: Stage; onView: (result: Awaited<ReturnType<typeof herApi.stageGet>>) => void; sheet?: string; onSheet?: (name: string | null) => void }) {
  const [keying, setKeying] = useState<string>()
  const files = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<UploadProgress>()
  const [error, setError] = useState<string>()
  const materials = view.library[row] ?? []
  const usedIn = (name: string) => (row === 'sheet' ? [] : stage.scenes.filter(s => s.cells[row]?.use.includes(name)).map(s => s.name))
  /** "抠掉背景": a transparent copy beside the original. */
  const keyOut = async (name: string) => {
    setKeying(name)
    setError(undefined)
    const result = await herApi.libraryKey(row, name)
    setKeying(undefined)
    if (result.ok) onView(result)
    else setError(result.message)
  }
  const send = async (list: FileList | null) => {
    const chosen = [...(list ?? [])].filter(f => /\.(mp4|webm|mov|m4v|png|jpe?g|webp|gif|svg)$/i.test(f.name) && !f.name.startsWith('.'))
    if (chosen.length === 0) return setError('没有能用的文件：素材库只收图片（png、jpg、webp、gif、svg）和视频（mp4、webm、mov）')
    setError(undefined)
    try {
      await uploadFiles(chosen, f => `/api/dsh-her/web/upload?library=${row}&path=${encodeURIComponent(f.name)}`, setProgress)
    } catch (failure) {
      setError((failure as Error).message)
    }
    setProgress(undefined)
    onView(await herApi.stageGet())
  }
  return (
    <div className="her-card">
      <div className="her-row">
        <h2 style={{ flex: 1, margin: 0 }}>{LIB_LABEL[row]}（{materials.length}）</h2>
        <button className="her-btn small" onClick={() => files.current?.click()}>上传文件…</button>
        <button className="her-btn small" onClick={() => folder.current?.click()}>上传文件夹…</button>
        <input ref={files} type="file" multiple accept="video/*,image/*,.svg" hidden onChange={e => { void send(e.target.files); e.target.value = '' }} />
        <input ref={folder} type="file" hidden {...{ webkitdirectory: '' }} onChange={e => { void send(e.target.files); e.target.value = '' }} />
      </div>
      {progress !== undefined && <p className="her-muted">正在上传 {progress.file}（{Math.round(progress.done / Math.max(progress.total, 1) * 100)}%）</p>}
      {error !== undefined && <p className="her-danger">{error}</p>}
      {row === 'sheet' && <p className="her-muted">她的正面、侧面、背面。它显示在「总览」里；做别的图和视频时，把它传给工具当参考，她才一直是同一个人。定妆照、表情表也可以放这儿存着。</p>}
      {materials.length === 0 ? <p className="her-faint">还没有。</p> : (
        <div className={`her-clips ${row}`}>
          {materials.map(m => {
            const used = usedIn(m.name)
            return (
              <div key={m.name} className="her-clip">
                {m.kind === 'video'
                  ? <video src={fileUrl(row, m.name)} muted loop preload="metadata" playsInline onMouseEnter={e => void e.currentTarget.play().catch(() => {})} onMouseLeave={e => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }} />
                  : <img src={fileUrl(row, m.name)} alt={m.name} className="her-clip-img" />}
                <div><b>{m.name}</b></div>
                <div className="her-faint">{m.info === undefined ? '正在看规格…' : [m.info.width === undefined ? undefined : `${m.info.width}×${m.info.height}`, m.info.durationMs === undefined ? undefined : `${(m.info.durationMs / 1000).toFixed(1)} 秒`, m.info.alpha === true ? '透明背景' : undefined].filter(Boolean).join(' · ')}</div>
                <div className="her-faint">{row === 'sheet' ? (sheet === m.name ? <span className="her-tag ok">她的三视图</span> : '参考图') : used.length === 0 ? '还没用上' : `用在：${used.join('、')}`} · {(m.size / 1024 / 1024).toFixed(1)} MB</div>
                {(m.warnings ?? []).map(w => <div key={w} className="her-warn" style={{ fontSize: 12 }}>⚠ {w}</div>)}
                <div className="her-row">
                  <button className="her-btn small" onClick={() => {
                    const to = window.prompt('新名字', m.name)
                    if (to !== null && to.trim() !== '' && to.trim() !== m.name) void herApi.libraryRename(row, m.name, to.trim()).then(onView)
                  }}>改名</button>
                  {row === 'sheet' && m.kind === 'image' && onSheet !== undefined && (sheet === m.name
                    ? <button className="her-btn small" onClick={() => onSheet(null)}>不用这张</button>
                    : <button className="her-btn small primary" onClick={() => onSheet(m.name)}>设为她的三视图</button>)}
                  {row !== 'sheet' && row !== 'desktop' && !m.file.endsWith('.svg') && m.info !== undefined && m.info.alpha !== true && (
                    <button className="her-btn small" disabled={keying !== undefined} title="把纯色背景（绿幕、蓝幕、白底）去掉，另存一个带透明的；原来的留着" onClick={() => void keyOut(m.name)}>{keying === m.name ? '正在抠…' : '抠掉背景'}</button>
                  )}
                  {m.file.endsWith('.svg') && <button className="her-btn small her-ai" title="让 dsh 的模型改这张图：比如把衣服换成墨绿色" onClick={() => void openDesign(`素材库 ${row} 里的「${m.name}」（${m.file}）`)}>+AI</button>}
                  {m.file.endsWith('.svg') && <button className="her-btn small" onClick={() => void herApi.libraryUndo(row, m.name).then(r => onView(r))}>退回上一版</button>}
                  <button className="her-btn small" onClick={() => {
                    if (window.confirm(`把"${m.name}"移出素材库？${used.length === 0 ? '' : `\n它用在：${used.join('、')}，那些格子会显示"不在了"。`}\n文件会放进 素材库/.removed，不会直接删掉。`)) void herApi.libraryRemove(row, m.name).then(onView)
                  }}>移走</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
