/**
 * 形象工坊 (docs/形象工坊与多场景.md §4): make a look of your own. Pick who
 * she is on a character card, the scenes she lives in and the clips she
 * needs; the brain writes a folder with every prompt (and a clip list, as a
 * task file for MiniMax Code or a JSON list for ComfyUI). Once pictures and clips are in, frame each scene's photo
 * on the body and import the whole look.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  AVATAR_CLIP_PROMPT, avatarPrompt, CARD_CHOICES, CARD_LABELS, clipPrompt, customClip, describe, DESK_DIR, GENERATORS, generatorInfo, MANUAL_LABEL, newScene, POSE_WORDS, referencePrompt, sceneDir, scenePhotoPrompt,
  type CharacterCard, type ClipPlan, type Generator, type LookProject, type Pose, type ProjectScene, type WorkshopCard,
} from '../core/workshop.ts'
import type { ProjectStatus } from '../dsh/workshop.ts'
import { desktopHere, herApi, type StateView } from './api.ts'
import type { Apply } from './parts.tsx'
import { Fold, useFolds } from './fold.tsx'
import { FrameScene } from './FrameScene.tsx'
import { projectFileUrl, ProjectUpload } from './ProjectUpload.tsx'

type Item = { project: LookProject; status: ProjectStatus }

const OWN = '__own__'
const NEEDS_DESKTOP = '要选文件夹的窗口，现在只有桌面身体能弹出来'

const copy = (text: string) => void navigator.clipboard?.writeText(text)

export function Workshop({ state, apply }: { state: StateView; apply: Apply }) {
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState<string>()
  const [draft, setDraft] = useState<LookProject>()
  const [dirty, setDirty] = useState(false)
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string }>()
  /** The scene being framed in the page. */
  const [framing, setFraming] = useState<string>()

  const reload = useCallback(async () => {
    const result = await herApi.workshopList()
    if (result.ok) setItems(result.projects)
  }, [])
  // Pictures and clips arrive in the folder while the page is open.
  useEffect(() => {
    void reload()
    const timer = setInterval(() => void reload(), 4000)
    return () => clearInterval(timer)
  }, [reload])

  const status = items.find(i => i.project.id === open)?.status
  const choose = (item: Item) => {
    setOpen(item.project.id)
    setDraft(structuredClone(item.project))
    setDirty(false)
    setNote(undefined)
  }
  const edit = (change: (p: LookProject) => void) => {
    setDraft(current => {
      if (current === undefined) return current
      const next = structuredClone(current)
      change(next)
      return next
    })
    setDirty(true)
  }
  const report = (result: { ok: true } | { ok: false; message: string }, done: string) => {
    setNote(result.ok ? { kind: 'ok', text: done } : { kind: 'error', text: result.message })
    return result.ok
  }

  const create = async () => {
    const result = await herApi.workshopNew(newName.trim())
    if (report(result, '建好了，文件夹在「文稿 / dsh-her 素材」里') && result.ok) {
      setNewName('')
      await reload()
      choose(result)
    }
  }
  const save = async () => {
    if (draft === undefined) return false
    const result = await herApi.workshopSave(draft)
    if (!report(result, '已保存：提示词都写进文件夹了。她要换上这个形象，还要在第 5 步点"导入这个形象"')) return false
    setDirty(false)
    await reload()
    return true
  }
  const frame = async (scene: ProjectScene) => {
    if (dirty && !(await save())) return
    setFraming(scene.id)
  }
  const makeAvatar = async () => {
    report(await herApi.workshopAvatar(draft!.id), '头像处理好了')
    await reload()
  }
  const makeAvatarClip = async () => {
    setNote({ kind: 'ok', text: '正在处理头像视频，大约半分钟…' })
    report(await herApi.workshopAvatarClip(draft!.id), '会动的头像处理好了')
    await reload()
  }
  const frameWhole = async (scene: ProjectScene) => {
    if (dirty && !(await save())) return
    const info = await herApi.workshopFrameInfo(draft!.id, scene.id)
    if (!report(info, '') || !info.ok) return
    report(await herApi.workshopFrameSave(draft!.id, scene.id, { x: 0, y: 0, width: info.width, height: info.height }), `「${scene.name}」用整张画面：视频盖满照片，不用框了`)
    await reload()
  }
  const assignClip = async (folder: string, file: string, clip: string) => {
    if (dirty && !(await save())) return
    const result = await herApi.workshopAssignClip(draft!.id, folder, file, clip)
    if (report(result, `${file} 现在是 ${clip}`) && result.ok) {
      setDraft(structuredClone(result.project))
      setDirty(false)
    }
    await reload()
  }
  const removeStray = async (folder: string, file: string) => {
    report(await herApi.workshopRemoveStray(draft!.id, folder, file), `已删掉 ${file}`)
    await reload()
  }
  const importLook = async () => {
    if (dirty && !(await save())) return
    if (await apply(herApi.workshopImport(draft!.id))) setNote({ kind: 'ok', text: '开始导入，进度在下面' })
  }

  // Cards fold; "保存这一步" saves, folds the card and opens the next.
  const [unfolded, toggle] = useFolds<WorkshopCard>(FOLDS_KEY, Object.fromEntries(CARDS.map(c => [c, true])) as Record<WorkshopCard, boolean>)
  const saveStep = async (card: WorkshopCard) => {
    if (dirty && !(await save())) return
    const at = CARDS.indexOf(card)
    toggle(card, false)
    if (at + 1 < CARDS.length) toggle(CARDS[at + 1]!, true)
    if (!dirty) setNote({ kind: 'ok', text: '这一步已经保存过了' })
  }

  const [examples, setExamples] = useState<Example[]>([])
  useEffect(() => { void herApi.workshopExamples().then(r => { if (r.ok) setExamples(r.examples) }) }, [])

  const [withMedia, setWithMedia] = useState(false)
  const exportProject = async () => {
    if (dirty && !(await save())) return
    setNote({ kind: 'ok', text: '在桌面上弹出的窗口里选一个文件夹…' })
    const result = await herApi.workshopExport(draft!.id, withMedia)
    if (!result.ok) report(result, '')
    else if ('cancelled' in result) setNote(undefined)
    else setNote({ kind: 'ok', text: `已导出 ${result.files} 个文件到 ${result.dir}` })
  }
  const importProject = async () => {
    setNote({ kind: 'ok', text: '在桌面上弹出的窗口里选一个形象项目的文件夹（或里面的 形象.json）…' })
    const result = await herApi.workshopImportProject()
    if (!result.ok) report(result, '')
    else if ('cancelled' in result) setNote(undefined)
    else {
      await reload()
      choose(result)
      setNote({ kind: 'ok', text: `已导入「${result.project.name}」，放在 ${result.status.dir}` })
    }
  }

  const screen = state.body.screens?.[0]
  const screenPx = screen === undefined ? undefined : { width: Math.round(screen.w * screen.scale), height: Math.round(screen.h * screen.scale) }
  const desk = status?.parts.find(p => p.folder === DESK_DIR)
  const lookId = draft === undefined ? '' : `look:${draft.id}`
  const imported = state.body.packs.some(p => p.packId === lookId)
  const inUse = imported && state.body.activePack === lookId
  const fold = (card: WorkshopCard, title: string, summary: string, done: boolean, body: ReactNode, saveLabel: string | null = '保存这一步') => (
    <Fold title={title} summary={summary} summaryClass={done ? 'her-ok' : 'her-muted'} open={unfolded[card]} onToggle={() => toggle(card)}>
      {body}
      <ExampleStrip examples={examples.filter(e => e.card === card)} />
      {saveLabel !== null && (
        <div className="her-row">
          <button className="her-btn primary" onClick={() => void saveStep(card)}>{saveLabel}</button>
          {dirty && <span className="her-warn">有改动还没保存</span>}
        </div>
      )}
    </Fold>
  )

  return (
    <>
      <div className="her-card">
        <h2>形象工坊</h2>
        <p className="her-muted">做一个你自己的她：选好她的样子、她住在哪些场景里，这里会把每一张图、每一段视频的提示词都写好，放进「文稿 / dsh-her 素材」里的一个文件夹。你用即梦、可灵、MiniMax、ComfyUI 这些工具生成，放回文件夹，再一键导入。</p>
        <div className="her-grid">
          {items.map(item => (
            <button key={item.project.id} className={`her-choice ${item.project.id === open ? 'on' : ''}`} onClick={() => choose(item)}>
              {item.project.name}
              <small>{progressText(item.status)}</small>
            </button>
          ))}
        </div>
        <div className="her-row">
          <input className="her-input" style={{ flex: 1, minWidth: 160 }} value={newName} placeholder="新形象的名字，比如：居家眼镜" onChange={e => setNewName(e.target.value)} />
          <button className="her-btn" disabled={newName.trim() === ''} onClick={() => void create()}>新建</button>
          <button className="her-btn" disabled={!desktopHere(state.body)} title={desktopHere(state.body) ? undefined : NEEDS_DESKTOP} onClick={() => void importProject()}>导入已有项目…</button>
        </div>
        {draft !== undefined && (
          <div className="her-row">
            <button className="her-btn" disabled={!desktopHere(state.body)} title={desktopHere(state.body) ? undefined : NEEDS_DESKTOP} onClick={() => void exportProject()}>把「{draft.name}」导出到文件夹…</button>
            <label><input type="checkbox" checked={withMedia} onChange={e => setWithMedia(e.target.checked)} /> 连同图片和视频</label>
            <span className="her-muted">不勾只导出设置（形象.json 和所有提示词），很小；导出的文件夹在别的电脑上用"导入已有项目"打开。</span>
          </div>
        )}
        {draft === undefined && note !== undefined && <p className={note.kind === 'error' ? 'her-danger' : 'her-ok'}>{note.text}</p>}
      </div>

      {draft !== undefined && status !== undefined && (
        <>
          {fold('look', '1. 她长什么样', describe(draft.card), true, <>
            <div className="her-row">
              <div style={{ flex: 1, minWidth: 160 }}>
                <label className="her-label">形象名字</label>
                <input className="her-input" value={draft.name} onChange={e => edit(p => { p.name = e.target.value })} />
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label className="her-label">用什么生成视频</label>
                <select className="her-select" value={draft.generator} onChange={e => edit(p => {
                  p.generator = e.target.value as Generator
                  if (p.generator === 'manual') p.custom ??= { name: '', settings: '', prefix: '' }
                })}>
                  {(Object.keys(GENERATORS) as Array<keyof typeof GENERATORS>).map(id => <option key={id} value={id}>{GENERATORS[id].label}</option>)}
                  <option value="manual">{MANUAL_LABEL}</option>
                </select>
              </div>
            </div>
            {draft.generator === 'manual' && draft.custom !== undefined && (
              <div className="her-row">
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label className="her-label">工具名字</label>
                  <input className="her-input" value={draft.custom.name} placeholder="比如 Runway、PixVerse、自己的工作流" onChange={e => edit(p => { p.custom!.name = e.target.value })} />
                </div>
                <div style={{ flex: 2, minWidth: 220 }}>
                  <label className="her-label">统一设置（写进每个提示词文件的开头）</label>
                  <input className="her-input" value={draft.custom.settings} placeholder={generatorInfo({ generator: 'manual' }).settings} onChange={e => edit(p => { p.custom!.settings = e.target.value })} />
                </div>
                <div style={{ flex: '1 1 100%' }}>
                  <label className="her-label">每段提示词前面加（可以不填；比如 LoRA 触发词、画风词）</label>
                  <input className="her-input" value={draft.custom.prefix} onChange={e => edit(p => { p.custom!.prefix = e.target.value })} />
                </div>
              </div>
            )}
            <p className="her-muted">统一设置：{generatorInfo(draft).settings}</p>
            <CardEditor card={draft.card} onChange={card => edit(p => { p.card = card })} />
            <label className="her-label">角色描述（每张图、每段视频都用这一句，她才是同一个人；可以直接改）</label>
            <textarea className="her-textarea" style={{ minHeight: 60 }} value={draft.card.sentence} placeholder={describe({ ...draft.card, sentence: '' })} onChange={e => edit(p => { p.card.sentence = e.target.value })} />
          </>)}

          {fold('reference', '2. 参考图（她的"身份证"）', status.reference ? '✓ 已有 参考图.png' : '还没有 参考图.png', status.reference, <>
            <p>{status.reference ? <span className="her-ok">✓ 已有 参考图.png</span> : <span className="her-warn">还没有 参考图.png</span>}：纯色背景、全身、正面站立。用文生图工具按下面的提示词生成，存成「参考图.png」放进项目文件夹。之后每个场景的照片都要用它当参考图。</p>
            <PromptBox text={referencePrompt(draft)} />
            <div className="her-row">
              <ProjectUpload projectId={draft.id} named="参考图" accept="image/png,image/jpeg" label="上传参考图…" onDone={() => void reload()} />
              {status.reference && <a className="her-btn link" href={projectFileUrl(draft.id, '参考图.png')} download>下载参考图（生成片段要用）</a>}
            </div>
          </>)}

          {fold('avatar', '头像（可选）', status.avatarClip ? '✓ 已有，会动' : status.avatar ? '✓ 已有' : status.avatarSource ? '上传了，还没处理' : '还没有', status.avatar, <>
            <p>她扒在 dsh 对话框上的小图，点它可以和她说话。没有头像时显示一个"她"字。</p>
            <p className="her-muted">用文生图工具，把她的头像放进"参考图 / 保持人物一致"，粘贴下面的提示词。参考图穿得少可能被拒绝，裁到只剩头再传。生成好不用改图，绿幕和桌子会自动去掉。</p>
            <PromptBox text={avatarPrompt(draft)} />
            <div className="her-row">
              <ProjectUpload projectId={draft.id} named="头像原图" accept="image/png,image/jpeg,image/webp" label={status.avatarSource ? '换一张…' : '上传头像图…'} onDone={() => void makeAvatar()} />
              {status.avatar && <img src={projectFileUrl(draft.id, '头像.png')} alt="头像" style={{ height: 72, background: 'rgba(127,127,127,.25)', borderRadius: 8 }} />}
            </div>
            <p className="her-muted">想让她动起来：用这张头像图（绿幕、带桌子的原图）当首帧，生成一段 5–10 秒的视频。手不要动，否则和对话框的接缝会跳。上传后自动做成循环。</p>
            <PromptBox text={AVATAR_CLIP_PROMPT} />
            <div className="her-row">
              <ProjectUpload projectId={draft.id} named="头像原视频" accept="video/*,.mp4,.webm,.mov" label={status.avatarClip ? '换一段视频…' : '上传头像视频…'} onDone={() => void makeAvatarClip()} />
              {status.avatarClip && <span className="her-ok">✓ 已有会动的头像</span>}
            </div>
          </>)}

          {fold('desk', '3. 桌宠（浮在最上层时的她）', !draft.desk.on ? '不要桌宠' : desk === undefined ? '还没保存' : `${desk.made}/${desk.planned} 段${desk.enough ? '，够导入了' : ''}`, !draft.desk.on || desk?.enough === true, <>
            <label><input type="checkbox" checked={draft.desk.on} onChange={e => edit(p => { p.desk.on = e.target.checked })} /> 要桌宠：绿幕全身视频，导入时抠掉背景，她浮在所有窗口上面</label>
            {draft.desk.on && (
              <>
                <PartStatusLine status={desk} />
                <p className="her-muted">首帧用「参考图.png」，生成竖版 9:16、1080P、5–6 秒。</p>
                <div className="her-row">
                  <ProjectUpload projectId={draft.id} folder={DESK_DIR} accept="video/*,.mp4,.webm,.mov" label="上传片段…" onDone={() => void reload()} />
                  <span className="her-muted">一次传多个时，文件名对不上清单的会问你是哪一段；也可以在下面每一段旁边单独上传。</span>
                </div>
                <StrayClips part={desk} clips={draft.desk.clips} onAssign={(file, clip) => void assignClip(DESK_DIR, file, clip)} onRemove={file => void removeStray(DESK_DIR, file)} />
                <ClipList project={draft} kind="desk" clips={draft.desk.clips} pose="stand" folder={DESK_DIR} have={desk?.have ?? []} onUploaded={() => void reload()} onChange={clips => edit(p => { p.desk.clips = clips })} />
              </>
            )}
          </>)}

          {fold('scene', '4. 场景（住在壁纸里、普通窗口时的她）', draft.scenes.length === 0 ? '还没有场景' : draft.scenes.map(sc => {
            const part = status.parts.find(p => p.folder === sceneDir(sc))
            return `${sc.name} ${part === undefined ? '未保存' : `${part.made}/${part.planned}${part.framed === true ? '' : part.photo === true ? '·未框' : '·缺照片'}`}`
          }).join(' · '), draft.scenes.length > 0 && draft.scenes.every(sc => { const part = status.parts.find(p => p.folder === sceneDir(sc)); return part?.enough === true && part.framed === true }), <>
            <p className="her-muted">每个场景是一张全屏照片，她在照片里的一块地方动。自动换场景按下面的时间和"你在不在"来选。{screenPx === undefined ? '' : `你的屏幕是 ${screenPx.width}×${screenPx.height}，照片就做这么大。`}</p>
            {draft.scenes.map((scene, i) => (
              <SceneEditor
                key={scene.id} project={draft} scene={scene} isDefault={(draft.default ?? draft.scenes[0]?.id) === scene.id}
                status={status.parts.find(p => p.folder === sceneDir(scene))} screen={screenPx}
                onChange={change => edit(p => { change(p.scenes[i]!) })}
                onDefault={() => edit(p => { p.default = scene.id })}
                onRemove={() => edit(p => { p.scenes.splice(i, 1) })}
                onFrame={() => void frame(scene)} onFrameWhole={() => void frameWhole(scene)}
                onAssign={(file, clip) => void assignClip(sceneDir(scene), file, clip)} onRemoveStray={file => void removeStray(sceneDir(scene), file)}
                framing={framing === scene.id} onFramed={() => { setFraming(undefined); void reload() }} onUploaded={() => void reload()}
              />
            ))}
            <button className="her-btn" onClick={() => edit(p => { p.scenes.push(newScene(`s${Date.now().toString(36)}`, `场景${p.scenes.length + 1}`)) })}>加一个场景</button>
          </>)}

          {fold('import', '5. 生成、导入', importSummary(status, state.import.state === 'running', imported, inUse), imported, <>
            <ol className="her-muted" style={{ margin: '4px 0', paddingLeft: 18 }}>
              <li>每一步填完点"保存这一步"：提示词写进项目文件夹，所有片段列在「生成清单.md」{draft.generator === 'minimax' ? '，还有给 MiniMax Code 的「MiniMax生成任务.md」' : draft.generator === 'comfyui' ? '，还有给脚本用的「ComfyUI生成清单.json」' : ''}。</li>
              <li>{generatorInfo(draft).how}</li>
              <li>场景的照片放好后点"框人物区"（视频是全屏的就点"用整张画面"）；然后"导入这个形象"，她才会换上。每部分最少一段待机就能导入；没有说话片段时，她说话嘴不会动。其他的以后补，再导入一次就会更新。</li>
            </ol>
            <div className="her-row">
              {desktopHere(state.body)
                ? <button className="her-btn" onClick={() => void herApi.workshopOpen(draft.id).then(r => report(r, '已打开文件夹'))}>打开文件夹</button>
                : <span className="her-muted">项目在 dsh 所在电脑的 {status.dir}</span>}
              <button className="her-btn primary" disabled={!status.importable || state.import.state === 'running'} onClick={() => void importLook()}>{imported ? '再导入一次（更新她）' : '导入这个形象'}</button>
              {inUse && <span className="her-ok">✓ 她正在用这个形象</span>}
              {imported && !inUse && <span className="her-muted">已导入，在上面的「外形」里可以换上。</span>}
            </div>
            <ImportChecklist status={status} />
            <ImportProgress state={state} />
          </>, null)}
          {note !== undefined && <p className={`her-card ${note.kind === 'error' ? 'her-danger' : 'her-ok'}`} style={{ position: 'sticky', bottom: 8, zIndex: 1 }}>{note.text}</p>}
        </>
      )}
    </>
  )
}

const CARDS: readonly WorkshopCard[] = ['look', 'reference', 'avatar', 'desk', 'scene', 'import']
const FOLDS_KEY = 'dsh-her.workshop.open'

type Example = { card: WorkshopCard; file: string; label: string; ready: boolean }

/** A card's examples: the picture or clip once it is in examples/workshop/, else a placeholder naming the file. */
function ExampleStrip({ examples }: { examples: Example[] }) {
  if (examples.length === 0) return null
  const src = (file: string) => new URL(`/api/dsh-her/example?f=${encodeURIComponent(file)}`, document.baseURI).href
  return (
    <div className="her-examples">
      <span className="her-label">示例</span>
      <div className="her-example-row">
        {examples.map(e => (
          <figure key={e.file} className="her-example">
            {!e.ready
              ? <div className="her-example-empty">示例待放<br /><code>examples/workshop/{e.file}</code></div>
              : e.file.endsWith('.mp4')
                ? <video src={src(e.file)} muted loop playsInline onMouseEnter={ev => void ev.currentTarget.play()} onMouseLeave={ev => ev.currentTarget.pause()} />
                : <img src={src(e.file)} alt={e.label} />}
            <figcaption>{e.label}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}

function progressText(status: ProjectStatus): string {
  if (status.parts.length === 0) return '还没开始'
  return status.parts.map(p => `${p.name} ${p.made}/${p.planned}${p.framed === false ? (p.photo === true ? '·未框' : '·缺照片') : ''}`).join(' · ')
}

/** What a part still needs before it can be imported. */
function partMissing(status: ProjectStatus, part: ProjectStatus['parts'][number]): string[] {
  return [
    ...(part.folder === DESK_DIR && !status.reference ? ['参考图'] : []),
    ...(part.photo === false ? ['照片 plate.png'] : []),
    ...(part.photo === true && part.framed === false ? ['框人物区（或者"用整张画面"）'] : []),
    ...(part.enough ? [] : ['一段待机片段']),
  ]
}

/** The import card, folded: has she got this look yet, and if not, what would come along. */
function importSummary(status: ProjectStatus, running: boolean, imported: boolean, inUse: boolean): string {
  if (running) return '正在导入…'
  if (inUse) return '✓ 已导入，她正在用这个形象'
  if (imported) return '已导入'
  const ready = status.parts.filter(part => partMissing(status, part).length === 0).map(part => part.name)
  return ready.length === 0 ? '还差素材，点开看缺什么' : `还没导入：点开，点"导入这个形象"（会导入 ${ready.join('、')}）`
}

/** Each part: what importing it still needs, or that it will come along. */
function ImportChecklist({ status }: { status: ProjectStatus }) {
  const lines = status.parts.map(part => {
    const missing = partMissing(status, part)
    const talks = part.have.some(file => /_talk_\d+$/.test(file))
    return missing.length > 0
      ? <li key={part.folder} className="her-warn">{part.name}：这次不会导入，还差{missing.join('、')}{part.strays.length > 0 ? `（有 ${part.strays.length} 个视频还没说是哪一段）` : ''}</li>
      : <li key={part.folder} className="her-ok">{part.name}：可以导入{talks ? '' : '（没有说话片段，她说话时嘴不会动）'}</li>
  })
  return <ul className="her-report">{lines}</ul>
}

/** Videos whose names match no clip: which clip is each? */
function StrayClips({ part, clips, onAssign, onRemove }: { part: ProjectStatus['parts'][number] | undefined; clips: ClipPlan[]; onAssign: (file: string, clip: string) => void; onRemove: (file: string) => void }) {
  if (part === undefined || part.strays.length === 0) return null
  const free = clips.filter(clip => !part.have.includes(clip.file))
  return (
    <div className="her-scenes">
      <p className="her-warn">这些视频的文件名和清单对不上，还没算进去。选一下每个是哪一段：</p>
      {part.strays.map(file => <StrayRow key={file} file={file} free={free} onAssign={clip => onAssign(file, clip)} onRemove={() => onRemove(file)} />)}
    </div>
  )
}

function StrayRow({ file, free, onAssign, onRemove }: { file: string; free: ClipPlan[]; onAssign: (clip: string) => void; onRemove: () => void }) {
  const [clip, setClip] = useState('')
  const [sure, setSure] = useState(false)
  const chosen = free.some(c => c.file === clip) ? clip : free[0]?.file ?? ''
  return (
    <div className="her-row" style={{ margin: '3px 0' }}>
      <span style={{ flex: 1, minWidth: 180, wordBreak: 'break-all' }}>{file}</span>
      <select className="her-select" style={{ width: 200 }} value={chosen} onChange={e => setClip(e.target.value)}>
        {free.map(c => <option key={c.file} value={c.file}>{clipLabel(c)}</option>)}
      </select>
      <button className="her-btn small primary" disabled={chosen === ''} onClick={() => onAssign(chosen)}>就是这一段</button>
      {sure
        ? <button className="her-btn small" onClick={onRemove}>确定删掉</button>
        : <button className="her-btn small" onClick={() => setSure(true)}>不用了</button>}
    </div>
  )
}

const ROLE_WORDS: Record<string, string> = { idle: '待机', talk: '说话', listen: '倾听', think: '思考', happy: '开心', shy: '害羞', wave: '挥手', touched: '被戳', sleepy: '犯困' }

/** "待机 1（stand_idle_01）" */
function clipLabel(clip: ClipPlan): string {
  const match = /_([a-z]+)_(\d+)$/.exec(clip.file)
  const word = match === null ? undefined : ROLE_WORDS[match[1]!]
  return word === undefined ? clip.file : `${word} ${Number(match![2])}（${clip.file}）`
}

function PartStatusLine({ status }: { status: ProjectStatus['parts'][number] | undefined }) {
  if (status === undefined) return <p className="her-muted">保存后会建好这部分的文件夹。</p>
  return (
    <p>
      已有 {status.made}/{status.planned} 段{status.enough ? <span className="her-ok">，够导入了</span> : <span className="her-warn">，最少要一段待机</span>}
      {status.photo === false && <span className="her-warn">；还没有照片 plate.png</span>}
      {status.photo === true && status.framed === false && <span className="her-warn">；照片有了，还没框人物区</span>}
      {status.framed === true && <span className="her-ok">；人物区已框好</span>}
    </p>
  )
}

function PromptBox({ text }: { text: string }) {
  return (
    <div className="her-row" style={{ alignItems: 'flex-start' }}>
      <div className="her-chat" style={{ flex: 1, margin: 0, whiteSpace: 'pre-wrap' }}>{text}</div>
      <button className="her-btn small" onClick={() => copy(text)}>复制</button>
    </div>
  )
}

/** Each card field: a choice, or "自己写" and a text box. */
function CardEditor({ card, onChange }: { card: CharacterCard; onChange: (card: CharacterCard) => void }) {
  const fields = Object.keys(CARD_CHOICES) as Array<keyof typeof CARD_CHOICES>
  return (
    <div className="her-grid">
      {fields.map(field => {
        const choices = CARD_CHOICES[field]
        const own = !choices.includes(card[field])
        return (
          <div key={field}>
            <label className="her-label">{CARD_LABELS[field]}</label>
            <select className="her-select" value={own ? OWN : card[field]} onChange={e => onChange({ ...card, [field]: e.target.value === OWN ? '' : e.target.value })}>
              {choices.map(c => <option key={c} value={c}>{c}</option>)}
              <option value={OWN}>自己写…</option>
            </select>
            {own && <input className="her-input" style={{ marginTop: 4 }} value={card[field]} placeholder={field === 'age' ? '要写成年的，比如 26 岁' : '写你想要的'} onChange={e => onChange({ ...card, [field]: e.target.value })} />}
          </div>
        )
      })}
      <div style={{ gridColumn: '1 / -1' }}>
        <label className="her-label">{CARD_LABELS.extra}（可不填）</label>
        <input className="her-input" value={card.extra} placeholder="比如：左眼下有颗小痣，笑起来有酒窝" onChange={e => onChange({ ...card, extra: e.target.value })} />
      </div>
    </div>
  )
}

function SceneEditor({ project, scene, isDefault, status, screen, onChange, onDefault, onRemove, onFrame, onFrameWhole, onAssign, onRemoveStray, framing, onFramed, onUploaded }: {
  project: LookProject; scene: ProjectScene; isDefault: boolean; status: ProjectStatus['parts'][number] | undefined
  screen: { width: number; height: number } | undefined
  onChange: (change: (s: ProjectScene) => void) => void; onDefault: () => void; onRemove: () => void; onFrame: () => void; onFrameWhole: () => void
  onAssign: (file: string, clip: string) => void; onRemoveStray: (file: string) => void
  framing: boolean; onFramed: () => void; onUploaded: () => void
}) {
  return (
    <div className="her-scenes">
      <div className="her-row">
        <input className="her-input" style={{ width: 140 }} value={scene.name} onChange={e => onChange(s => { s.name = e.target.value })} />
        <select className="her-select" style={{ width: 90 }} value={scene.pose} onChange={e => onChange(s => {
          const pose = e.target.value as Pose
          // The clip names start with the pose.
          s.clips = s.clips.map(c => ({ ...c, file: c.file.replace(/^(stand|sit|lie)_/, `${pose}_`), action: c.action.replace(POSE_WORDS[s.pose], POSE_WORDS[pose]) }))
          s.pose = pose
        })}>
          {(Object.keys(POSE_WORDS) as Pose[]).map(p => <option key={p} value={p}>{POSE_WORDS[p]}</option>)}
        </select>
        <label><input type="radio" checked={isDefault} onChange={onDefault} /> 默认场景</label>
        <button className="her-btn small" onClick={onRemove}>删掉这个场景</button>
      </div>
      <label className="her-label">这个地方什么样（写进照片的提示词）</label>
      <input className="her-input" value={scene.place} placeholder="比如：温馨的卧室，木质床头柜和台灯，暖色灯光，窗帘半拉" onChange={e => onChange(s => { s.place = e.target.value })} />
      <div className="her-row">
        <span className="her-muted">什么时候在这：</span>
        <input className="her-input" style={{ width: 90 }} value={scene.hours ?? ''} placeholder="21-24" onChange={e => onChange(s => { if (e.target.value.trim() === '') delete s.hours; else s.hours = e.target.value.trim() })} />
        <span className="her-muted">点，</span>
        <select className="her-select" style={{ width: 150 }} value={scene.user ?? ''} onChange={e => onChange(s => { if (e.target.value === '') delete s.user; else s.user = e.target.value as 'active' | 'idle' })}>
          <option value="">不管你在不在</option>
          <option value="active">你在用电脑时</option>
          <option value="idle">你很久没动时</option>
        </select>
      </div>
      <p className="her-muted">照片：用参考图生成（{screen === undefined ? '横版，和屏幕一样的比例' : `${screen.width}×${screen.height}`}），存成 plate.png 放进「{sceneDir(scene)}」文件夹。</p>
      <PromptBox text={scenePhotoPrompt(project, scene, screen)} />
      <PartStatusLine status={status} />
      <div className="her-row">
        <ProjectUpload projectId={project.id} folder={sceneDir(scene)} named="plate" accept="image/png,image/jpeg" label="上传照片…" onDone={onUploaded} />
        <ProjectUpload projectId={project.id} folder={sceneDir(scene)} accept="video/*,.mp4,.webm,.mov" label="上传片段…" onDone={onUploaded} />
        {status?.framed === true && <a className="her-btn link" href={projectFileUrl(project.id, `${sceneDir(scene)}/crop.png`)} download>下载 crop.png（生成片段的首帧）</a>}
      </div>
      {framing && <FrameScene projectId={project.id} sceneId={scene.id} sceneName={scene.name} onDone={onFramed} />}
      <div className="her-row"><button className="her-btn" disabled={status?.photo !== true} onClick={onFrame}>框人物区</button><span className="her-muted">就在这里框出她活动的那一块；之后用 crop.png 当首帧生成视频。</span></div>
      <div className="her-row"><button className="her-btn" disabled={status?.photo !== true} onClick={onFrameWhole}>用整张画面</button><span className="her-muted">你的视频就是整张照片动起来（海浪也会动），就点这个，不用框。视频和照片比例要一样，文件也大一些。</span></div>
      <StrayClips part={status} clips={scene.clips} onAssign={onAssign} onRemove={onRemoveStray} />
      <ClipList project={project} kind="scene" scene={scene} clips={scene.clips} pose={scene.pose} folder={sceneDir(scene)} have={status?.have ?? []} onUploaded={onUploaded} onChange={clips => onChange(s => { s.clips = clips })} />
    </div>
  )
}

/** The clips of one part: tick which to make, edit what she does, copy the full prompt, add your own. */
function ClipList({ project, kind, scene, clips, pose, folder, have, onUploaded, onChange }: {
  project: LookProject; kind: 'desk' | 'scene'; scene?: ProjectScene; clips: ClipPlan[]; pose: Pose; folder: string; have: string[]; onUploaded: () => void; onChange: (clips: ClipPlan[]) => void
}) {
  const [own, setOwn] = useState('')
  const set = (i: number, change: Partial<ClipPlan>) => onChange(clips.map((c, j) => (j === i ? { ...c, ...change } : c)))
  return (
    <div>
      {clips.map((clip, i) => (
        <div key={clip.file} className="her-row" style={{ margin: '3px 0' }}>
          <label style={{ width: 170 }} className={have.includes(clip.file) ? 'her-ok' : undefined}>
            <input type="checkbox" checked={clip.off !== true} disabled={clip.required === true} onChange={e => set(i, { off: !e.target.checked })} /> {have.includes(clip.file) ? '✓ ' : ''}{clip.file}
          </label>
          <input className="her-input" style={{ flex: 1, minWidth: 200 }} value={clip.action} disabled={clip.off === true} onChange={e => set(i, { action: e.target.value })} />
          <button className="her-btn small" disabled={clip.off === true} onClick={() => copy(clipPrompt(project, kind, clip, scene))}>复制提示词</button>
          {clip.off !== true && <ProjectUpload projectId={project.id} folder={folder} named={clip.file} small accept="video/*,.mp4,.webm,.mov" label={have.includes(clip.file) ? '换一段' : '上传'} onDone={onUploaded} />}
        </div>
      ))}
      <div className="her-row">
        <input className="her-input" style={{ flex: 1 }} value={own} placeholder="加一段自己的动作，比如：端起咖啡喝一口，再放下" onChange={e => setOwn(e.target.value)} />
        <button className="her-btn small" disabled={own.trim() === ''} onClick={() => { onChange([...clips, customClip(pose, clips, own)]); setOwn('') }}>加上</button>
      </div>
    </div>
  )
}

function ImportProgress({ state }: { state: StateView }) {
  const imp = state.import
  if (imp.state === 'running') {
    return (
      <div>
        <div className="her-progress"><div style={{ width: `${imp.total === 0 ? 0 : Math.round((imp.done / imp.total) * 100)}%` }} /></div>
        <p className="her-muted">{imp.step}</p>
      </div>
    )
  }
  if (imp.state !== 'done' && imp.state !== 'failed') return null
  return (
    <ul className="her-report">
      {imp.lines.map((line, i) => <li key={i} className={line.level === 'error' ? 'her-danger' : line.level === 'warn' ? 'her-warn' : ''}>{line.level === 'ok' ? '✅' : line.level === 'warn' ? '⚠️' : '❌'} {line.text}</li>)}
    </ul>
  )
}
