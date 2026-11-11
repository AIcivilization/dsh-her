/**
 * Pieces shared by the wizard and the management page. Each takes the latest
 * state and `apply`, which sends a change and takes the state the brain
 * answers with (the page never shows a local guess).
 */

import { useEffect, useState } from 'react'
import { serviceOf, SERVICE_NAMES, VOICES, type VoiceService } from '../core/voices.ts'
import { choiceClass, choiceNote, SERVICE_SHORT, voiceLabel } from './choice.tsx'
import { desktopHere, desktopOffered, herApi, modelCatalog, playAudio, remotePage, type ModelGroup, type Result, type StateView } from './api.ts'
import { BodyManual } from './BodyManual.tsx'
import { MingSection } from './MingVoice.tsx'
import { insideFolder, uploadFiles, worthSending, type UploadProgress } from './upload.ts'
import { cardFromPng } from '../core/persona-card.ts'

export type Apply = (call: Promise<Result<{ state: StateView }>>) => Promise<boolean>

export const MODE_TEXT: Record<string, { title: string; desc: string }> = {
  overlay: { title: '浮在最上层', desc: '像桌宠一样在所有窗口上面，可以拖动、点她' },
  wallpaper: { title: '住在壁纸里', desc: '在桌面图标和所有窗口下面，只看不点；按快捷键叫她出来' },
  window: { title: '普通窗口', desc: '一个可以关掉的窗口' },
}

export function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'off' }) {
  return <span className={`her-dot ${tone === 'off' ? '' : tone}`} />
}

export function BodyStatus({ state, apply }: { state: StateView; apply: Apply }) {
  const [message, setMessage] = useState<string>()
  const [manual, setManual] = useState(false)
  const body = state.body
  const install = body.install
  const start = async () => {
    const result = await herApi.startBody()
    if (result.ok) setMessage(result.message)
    await apply(Promise.resolve(result))
  }
  const busy = install.state === 'checking' || install.state === 'downloading' || install.state === 'installing'
  const progress = busy && (
    <div>
      <div className="her-progress"><div style={{ width: `${install.total ? Math.round(((install.done ?? 0) / install.total) * 100) : 0}%` }} /></div>
      <p className="her-muted">{install.state === 'checking' ? '正在看有没有新版本…' : install.state === 'installing' ? '正在安装…' : `正在下载身体程序 ${install.latest ?? ''}（${mb(install.done)} / ${mb(install.total)} MB）`}</p>
      {install.state === 'downloading' && (
        <div className="her-row">
          <button className="her-btn small" onClick={() => void apply(herApi.bodyCancel())}>取消</button>
          <button className="her-btn link" onClick={() => { setManual(true); void apply(herApi.bodyCancel()) }}>太慢？换成用下载软件下载</button>
        </div>
      )}
    </div>
  )
  const failed = install.state === 'failed' && <p className="her-danger">下载安装没成功：{install.error}</p>
  // Nothing to install for whoever is looking: she is in this page.
  if (!desktopOffered(body)) {
    return (
      <div>
        {body.web.connected
          ? <p><Dot tone="ok" />她住在这个 dsh 网页里（{webWhere(body.web)}）。不用安装任何东西，用手机或别的电脑打开这个网页，她也在。</p>
          : body.web.mode === 'off'
            ? <p><Dot tone="off" />你把她从网页里关了：在"放在哪里"可以打开。</p>
            : <p><Dot tone="warn" />她正在进到这个网页里…</p>}
        <p className="her-muted">{remotePage ? `dsh 跑在另一台电脑（${platformName(state.platform)}）上，你是从别的设备打开这个网页的，所以这里不需要桌面程序。` : `dsh 跑在 ${platformName(state.platform)} 上，这个系统没有桌面程序，她就住在网页里。`}</p>
      </div>
    )
  }
  if (body.connected) {
    return (
      <div>
        <p><Dot tone="ok" />身体已连上（{body.info?.os}，版本 {body.info?.version}）{body.pack === undefined ? '' : `，外形：${body.pack.name}`}</p>
        {install.restart === true && (
          <div className="her-row">
            <span>新版本 {install.installed} 已经装好，重启一下身体就用上了。</span>
            <button className="her-btn primary" onClick={() => void apply(herApi.restartBody())}>重启身体</button>
          </div>
        )}
        {progress}
        {failed}
        {manual && <BodyManual apply={apply} onInstalled={() => setManual(false)} />}
      </div>
    )
  }
  return (
    <div>
      {body.web.connected
        ? <p><Dot tone="ok" />她现在住在这个网页里（{webWhere(body.web)}）。也可以装桌面程序，让她住在桌面上：</p>
        : <p><Dot tone={body.running ? 'warn' : 'bad'} />{body.running ? '身体在运行，正在连接…' : '身体还没运行'}</p>}
      {!body.running && (
        <div className="her-row">
          {body.canStart
            ? <button className="her-btn primary" onClick={() => void start()}>启动身体</button>
            : <>
                <button className="her-btn primary" disabled={busy} onClick={() => { setManual(false); void apply(herApi.installBody()) }}>直接下载安装</button>
                <button className={`her-btn ${manual ? 'primary' : ''}`} onClick={() => setManual(!manual)}>用下载软件下载</button>
                <span className="her-muted">她在桌面上的样子是一个单独的小程序（150–220 MB），装在 dsh-her 自己的文件夹里，装好就自动启动。直接下载慢的话，可以复制链接用下载软件下。</span>
              </>}
        </div>
      )}
      {progress}
      {failed}
      {manual && !body.canStart && <BodyManual apply={apply} onInstalled={() => setManual(false)} />}
      {message !== undefined && <p className="her-muted">{message}</p>}
    </div>
  )
}

const webWhere = (web: StateView['body']['web']) => (web.place === 'pet' ? '右下角，能拖动' : web.scope === 'page' ? '整个页面的背景' : '对话窗口的背景')

const mb = (bytes: number | undefined) => ((bytes ?? 0) / 1e6).toFixed(0)

/** The name of the system dsh runs on. */
export function platformName(platform: string): string {
  return platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform
}

export function PackPicker({ state, apply }: { state: StateView; apply: Apply }) {
  const body = state.body
  const imp = state.import
  if (!body.connected && !body.web.connected) return <p className="her-muted">身体连上之后才能选外形。</p>
  return (
    <div>
      <Presets state={state} apply={apply} />
      <div className="her-grid">
        {body.packs.map(pack => (
          <button key={pack.packId} className={`her-choice ${pack.packId === body.activePack ? 'on' : ''}`} onClick={() => void apply(herApi.usePack(pack.packId))}>
            {pack.name}
            <small>{choiceNote(pack.packId, body.activePack ?? '', `${pack.packId.startsWith('look:') ? '多场景形象' : pack.layer === 'scene' ? '壁纸场景' : '桌宠'} · ${pack.actions.filter(a => !a.id.startsWith('scene_')).length} 个动作${pack.emotions.length > 0 ? ` · ${pack.emotions.length} 种情绪` : ''}`)}</small>
          </button>
        ))}
        {body.packs.length === 0 && state.presets.list.length === 0 && <p className="her-muted">还没有导入过外形包。</p>}
      </div>
      <div className="her-row">
        {desktopHere(body)
          ? <button className="her-btn" disabled={imp.state === 'picking' || imp.state === 'running'} onClick={() => void apply(herApi.pickPack())}>导入我的素材…</button>
          : <UploadPack apply={apply} busy={imp.state === 'running'} />}
        <span className="her-muted">{desktopHere(body) ? '会在身体那台电脑上弹出选择文件夹的窗口。' : '选一个素材文件夹，传上去就导入。'}素材怎么做、怎么命名，见<a href="https://github.com/AIcivilization/dsh-her/blob/main/docs/素材生成提示词.md" target="_blank" rel="noreferrer">素材规格</a>。</span>
      </div>
      {imp.state === 'picking' && <p className="her-muted">请在桌面上弹出的窗口里选择素材文件夹…</p>}
      {imp.state === 'running' && (
        <div>
          <div className="her-progress"><div style={{ width: `${imp.total === 0 ? 0 : Math.round((imp.done / imp.total) * 100)}%` }} /></div>
          <p className="her-muted">{imp.step}（{imp.done}/{imp.total}）</p>
        </div>
      )}
      {(imp.state === 'done' || imp.state === 'failed') && (
        <ul className="her-report">
          {imp.lines.map((line, i) => <li key={i} className={line.level === 'error' ? 'her-danger' : line.level === 'warn' ? 'her-warn' : ''}>{line.level === 'ok' ? '✅' : line.level === 'warn' ? '⚠️' : '❌'} {line.text}</li>)}
        </ul>
      )}
    </div>
  )
}

/**
 * Ready-made looks from the release: nothing is shown until one is offered, so
 * the way in stays making her from your own pictures and clips.
 */
function Presets({ state, apply }: { state: StateView; apply: Apply }) {
  const { list, active } = state.presets
  const [error, setError] = useState<string>()
  useEffect(() => {
    void herApi.presetsList().then(result => { if (!result.ok) setError(result.message) })
  }, [])
  if (list.length === 0) return error === undefined ? null : <p className="her-faint">现成的形象暂时读不到：{error}</p>
  const here = (id: string, kind: string) => state.body.packs.some(p => p.packId === (kind === 'look' ? `look:${id}` : id))
  return (
    <div>
      <label className="her-label">现成的形象（点一下就用，不用自己做）</label>
      <div className="her-grid">
        {list.map(preset => {
          const installed = here(preset.id, preset.kind)
          const fetching = active?.id === preset.id && active.state === 'downloading'
          return (
            <button key={preset.id} className="her-choice" disabled={active?.state === 'downloading'} onClick={() => void apply(installed ? herApi.usePack(preset.kind === 'look' ? `look:${preset.id}` : preset.id) : herApi.presetUse(preset.id))}>
              {preset.preview !== undefined && <img src={`/api/dsh-her/web/preset-preview?id=${preset.id}`} alt="" style={{ display: 'block', width: '100%', borderRadius: 6, marginBottom: 6 }} />}
              {preset.name}
              <small>{fetching ? `正在下载 ${Math.round((active.done / Math.max(1, active.total)) * 100)}%` : installed ? '已经有了，点一下换上' : `${preset.desc ?? ''}（${Math.max(1, Math.round(preset.size / 1e6))} MB）`}</small>
            </button>
          )
        })}
      </div>
      {active?.state === 'downloading' && <button className="her-btn small" onClick={() => void apply(herApi.presetCancel())}>取消下载</button>}
      {active?.state === 'failed' && <p className="her-error">没能下载：{active.error}</p>}
    </div>
  )
}


/**
 * Her conversations: all kept in her workspace in dsh. Which one you are in,
 * a new one, an earlier one; when a new one starts by itself (off by default).
 */
export function TalkCard({ state, apply }: { state: StateView; apply: Apply }) {
  const { talk } = state
  const open = (id: string) => window.__herOpenSession?.(id)
  const canOpen = window.__herOpenSession !== undefined
  const others = talk.segments.filter(s => s.id !== talk.current)
  const { split } = talk
  return (
    <>
      <section className="her-card">
        <div className="her-setrow">
          <div><b>{talk.segment?.title ?? '还没有对话'}</b><span>现在这一段{talk.size === undefined ? '' : `，${talk.size}`}。你在哪儿和她说（桌面、网页、打字、说话），都进这一段，存在 dsh 左侧的"她"工作区里。</span></div>
          <span className="her-row" style={{ margin: 0, flexWrap: 'nowrap' }}>
            {canOpen && talk.current !== null && <button className="her-btn" onClick={() => open(talk.current!)}>在 dsh 里看</button>}
            <button className="her-btn primary" onClick={() => void apply(herApi.talkNew())}>新开一段</button>
          </span>
        </div>
        <p className="her-faint">她记得的事每一段都能用上，新开一段不会让她忘了你。</p>
      </section>
      {others.length > 0 && (
        <section className="her-card">
          <h2>之前的对话</h2>
          <ul className="her-list">
            {others.slice(0, 8).map(s => (
              <li key={s.id}>
                <span className="grow">{s.title}</span>
                {canOpen && <button className="her-btn small" onClick={() => open(s.id)}>看</button>}
                <button className="her-btn small" title="之后说的话就进这一段" onClick={() => void apply(herApi.talkResume(s.id))}>接着这段聊</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="her-card">
        <h2>自动新开一段</h2>
        <div className="her-setrow">
          <div><b>隔了很久没说话</b><span>再开口时就是新的一段。</span></div>
          <select className="her-select" style={{ width: 130 }} value={split.idleHours ?? ''} onChange={e => void apply(herApi.talkSplit({ idleHours: e.target.value === '' ? null : Number(e.target.value) }))}>
            <option value="">不按时间</option>
            {[2, 6, 12, 24].map(h => <option key={h} value={h}>隔 {h} 小时</option>)}
          </select>
        </div>
        <div className="her-setrow">
          <div><b>这一段太长了</b><span>越长，她每次回答越慢、越贵。</span></div>
          <select className="her-select" style={{ width: 130 }} value={split.maxTokens ?? ''} onChange={e => void apply(herApi.talkSplit({ maxTokens: e.target.value === '' ? null : Number(e.target.value) }))}>
            <option value="">不按长度</option>
            {[30_000, 60_000, 100_000].map(n => <option key={n} value={n}>约 {n / 10_000} 万字</option>)}
          </select>
        </div>
        <div className="her-setrow">
          <div><b>每天一段</b><span>每天第一次说话时新开一段。</span></div>
          <input type="checkbox" checked={split.daily} onChange={e => void apply(herApi.talkSplit({ daily: e.target.checked }))} />
        </div>
        <p className="her-faint">默认都关着：一直接着同一段说。打开的几条里，满足任何一条就新开。</p>
      </section>
    </>
  )
}

const QUIET_CHOICES: Array<[string, number, number]> = [['23:30 到 8:30', 1410, 510], ['22:00 到 9:00', 1320, 540], ['一直可以', 0, 0]]

/** Her speaking first: whether, how often, when not; focus; why she is quiet right now; a try. */
export function InitiativeCard({ state, apply }: { state: StateView; apply: Apply }) {
  const { settings, focus, why, today, last } = state.initiative
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const here = state.body.connected || state.body.web.connected
  const tryNow = async () => {
    setBusy(true)
    setError(undefined)
    const result = await herApi.initiativeTry()
    setBusy(false)
    if (!result.ok) setError(result.message)
  }
  return (
    <>
      <section className="her-card">
        <div className="her-setrow">
          <div><b>让她主动说话</b><span>你回到电脑前、有日子的事快到了、或者你们很久没说话时，她会自己说一句。你连着几次没回，她就慢慢少说，直到你先开口。</span></div>
          <input type="checkbox" checked={settings.on} onChange={e => void apply(herApi.initiativeSet({ on: e.target.checked }))} />
        </div>
        {settings.on && (
          <>
            <div className="her-setrow">
              <div><b>每天最多几次</b><span>今天已经主动说了 {today} 次。</span></div>
              <select className="her-select" style={{ width: 110 }} value={settings.perDay} onChange={e => void apply(herApi.initiativeSet({ perDay: Number(e.target.value) }))}>
                {[1, 2, 3, 5, 8].map(n => <option key={n} value={n}>{n} 次</option>)}
              </select>
            </div>
            <div className="her-setrow">
              <div><b>安静时段</b><span>这段时间里她不先开口。</span></div>
              <select className="her-select" style={{ width: 150 }} value={`${settings.quietFrom}-${settings.quietTo}`} onChange={e => { const [from, to] = e.target.value.split('-').map(Number); void apply(herApi.initiativeSet({ quietFrom: from!, quietTo: to! })) }}>
                {QUIET_CHOICES.map(([label, from, to]) => <option key={label} value={`${from}-${to}`}>{label === '一直可以' ? '没有安静时段' : label}</option>)}
                {!QUIET_CHOICES.some(([, from, to]) => from === settings.quietFrom && to === settings.quietTo) && <option value={`${settings.quietFrom}-${settings.quietTo}`}>自定义</option>}
              </select>
            </div>
          </>
        )}
      </section>
      {settings.on && (
        <section className="her-card">
          <h2>专注</h2>
          <div className="her-setrow">
            <div><b>{focus.on ? (focus.until === -1 ? '专注中，到你关掉为止' : `专注中，到 ${new Date(focus.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`) : '先别打扰我'}</b><span>开会、打游戏时用：她不先开口；你找她说话不受影响。</span></div>
            <span className="her-row" style={{ margin: 0, flexWrap: 'nowrap' }}>
              {focus.on
                ? <button className="her-btn" onClick={() => void apply(herApi.initiativeSet({ focus: 'off' }))}>结束专注</button>
                : <><button className="her-btn" onClick={() => void apply(herApi.initiativeSet({ focus: 'span' }))}>2 小时</button><button className="her-btn" onClick={() => void apply(herApi.initiativeSet({ focus: 'always' }))}>到我关掉</button></>}
            </span>
          </div>
        </section>
      )}
      <section className="her-card">
        <h2>现在</h2>
        <div className="her-setrow">
          <div><b>{why === undefined ? '她现在可以开口' : `她现在不会开口：${why}`}</b><span>{last === undefined ? '还没有主动说过话。' : `最近一次：「${last.text}」`}</span></div>
          <button className="her-btn" disabled={busy || !here} title={here ? undefined : '身体连上之后才能试'} onClick={() => void tryNow()}>{busy ? '她在想…' : '让她说一句'}</button>
        </div>
        {error !== undefined && <p className="her-error">{error}</p>}
      </section>
    </>
  )
}

/** A materials folder from the browser to the brain, imported there (no desktop body to pick it on). */
function UploadPack({ apply, busy }: { apply: Apply; busy: boolean }) {
  const [progress, setProgress] = useState<UploadProgress>()
  const [error, setError] = useState<string>()
  const send = async (chosen: File[]) => {
    const files = chosen.filter(worthSending)
    if (files.length === 0) return setError('这个文件夹里没有素材（视频、图片）')
    setError(undefined)
    const created = await herApi.webNewBatch()
    if (!created.ok) return setError(created.message)
    try {
      await uploadFiles(files, file => `/api/dsh-her/web/upload?batch=${encodeURIComponent(created.batch)}&path=${encodeURIComponent(insideFolder(file))}`, setProgress)
    } catch (failure) {
      setProgress(undefined)
      return setError((failure as Error).message)
    }
    setProgress(undefined)
    const top = (chosen[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0]
    const result = await herApi.webImportBatch(created.batch, top)
    if (!result.ok) setError(result.message)
    else await apply(Promise.resolve(result))
  }
  return (
    <>
      <label className={`her-btn ${busy || progress !== undefined ? 'her-disabled' : ''}`}>
        {progress === undefined ? '上传素材文件夹…' : `正在上传 ${progress.file}（${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%）`}
        <input type="file" hidden disabled={busy || progress !== undefined} {...{ webkitdirectory: '', directory: '' }} onChange={e => { void send([...(e.target.files ?? [])]); e.target.value = '' }} />
      </label>
      {error !== undefined && <p className="her-danger">{error}</p>}
    </>
  )
}

export function PersonaEditor({ state, apply, onSaved, saveLabel = '保存' }: { state: StateView; apply: Apply; onSaved?: () => void; saveLabel?: string }) {
  const c = state.character
  const [name, setName] = useState(c.name)
  const [callYou, setCallYou] = useState(c.callYou)
  const [pronoun, setPronoun] = useState<string>(c.pronoun)
  const [persona, setPersona] = useState(c.persona)
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState<'expand' | 'try' | 'save' | 'card'>()
  const [error, setError] = useState<string>()
  const [chat, setChat] = useState<Array<{ who: 'you' | 'her'; text: string }>>([])
  const [line, setLine] = useState('')
  const dirty = name !== c.name || callYou !== c.callYou || pronoun !== c.pronoun || persona !== c.persona

  const [card, setCard] = useState('')
  const readCard = async () => {
    setBusy('card')
    setError(undefined)
    const result = await herApi.personaCard(card)
    setBusy(undefined)
    if (!result.ok) return setError(result.message)
    setName(result.card.name)
    setPersona(result.card.persona)
    if (result.card.callYou !== '') setCallYou(result.card.callYou)
    setCard('')
  }
  /** A card as a file: text or JSON as it is, a card PNG for the character inside. */
  const cardFile = async (file: File) => {
    setError(undefined)
    if (/\.png$/i.test(file.name)) {
      const inside = cardFromPng(new Uint8Array(await file.arrayBuffer()))
      if (inside === undefined) return setError('这张图片里没有人设卡的内容')
      return setCard(inside)
    }
    setCard(await file.text())
  }

  const expand = async () => {
    setBusy('expand')
    setError(undefined)
    const result = await herApi.expandPersona({ name, idea, callYou, pronoun })
    setBusy(undefined)
    if (result.ok) setPersona(result.persona)
    else setError(result.message)
  }
  const tryOne = async () => {
    const message = line.trim()
    if (message === '') return
    setBusy('try')
    setLine('')
    const history = [...chat, { who: 'you' as const, text: message }]
    setChat(history)
    const result = await herApi.tryPersona({ name, persona, callYou, pronoun, history: chat, message })
    setBusy(undefined)
    setChat(result.ok ? [...history, { who: 'her', text: result.reply }] : history)
    if (!result.ok) setError(result.message)
  }
  const save = async () => {
    setBusy('save')
    const ok = await apply(herApi.saveCharacter({ name, persona, callYou, pronoun }))
    setBusy(undefined)
    if (ok) onSaved?.()
  }
  return (
    <div>
      <div className="her-row">
        <div style={{ flex: 1, minWidth: 140 }}><label className="her-label">她的名字</label><input className="her-input" value={name} onChange={e => setName(e.target.value)} /></div>
        <div style={{ flex: 1, minWidth: 140 }}><label className="her-label">她怎么称呼你</label><input className="her-input" value={callYou} placeholder="比如：阿文" onChange={e => setCallYou(e.target.value)} /></div>
        <div style={{ width: 120 }}>
          <label className="her-label">提到你时用</label>
          <select className="her-select" value={pronoun} onChange={e => setPronoun(e.target.value)}>
            <option value="他">他</option><option value="她">她</option><option value="TA">TA</option>
          </select>
        </div>
      </div>
      <label className="her-label">一句话描述她（可选），让模型帮你写成完整人设</label>
      <div className="her-row">
        <input className="her-input" style={{ flex: 1 }} value={idea} placeholder="比如：二十五岁的编剧，爱吐槽，喜欢猫和火锅" onChange={e => setIdea(e.target.value)} />
        <button className="her-btn" disabled={busy !== undefined || idea.trim() === ''} onClick={() => void expand()}>{busy === 'expand' ? '正在写…' : '帮我写'}</button>
      </div>
      <label className="her-label">已经有人设卡？贴进来或选文件（文字、JSON、带卡的 PNG），模型会拆成名字和人设，你看过再保存</label>
      <textarea className="her-textarea" style={{ minHeight: 64 }} value={card} placeholder="把人设卡的内容贴在这里" onChange={e => setCard(e.target.value)} />
      <div className="her-row">
        <button className="her-btn" disabled={busy !== undefined || card.trim() === ''} onClick={() => void readCard()}>{busy === 'card' ? '正在拆…' : '拆成人设'}</button>
        <label className="her-btn">选文件<input type="file" accept=".txt,.md,.json,.png" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file !== undefined) void cardFile(file) }} /></label>
      </div>
      <label className="her-label">人设（可以直接改）</label>
      <textarea className="her-textarea" value={persona} onChange={e => setPersona(e.target.value)} />
      <label className="her-label">先试聊几句（不会进她的记忆）</label>
      {chat.length > 0 && (
        <div className="her-chat">{chat.map((m, i) => <div key={i} className={m.who}>{m.who === 'you' ? '你：' : `${name}：`}{m.text}</div>)}</div>
      )}
      <div className="her-row">
        <input className="her-input" style={{ flex: 1 }} value={line} placeholder="说一句试试" onChange={e => setLine(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void tryOne() }} />
        <button className="her-btn" disabled={busy !== undefined || persona.trim() === ''} onClick={() => void tryOne()}>{busy === 'try' ? '…' : '发送'}</button>
      </div>
      {error !== undefined && <p className="her-error">{error}</p>}
      <div className="her-row">
        <button className="her-btn primary" disabled={busy !== undefined || (!dirty && onSaved === undefined)} onClick={() => void save()}>{saveLabel}</button>
        {dirty ? <span className="her-warn">有改动还没保存</span> : onSaved === undefined && <span className="her-muted">✓ 已保存，她正在用这份人设</span>}
      </div>
    </div>
  )
}

/** Shown when her cloud voice has no key (how to add one; never typed into this page) or no quota left. */
export function KeyHelp({ state }: { state: StateView }) {
  if (state.voice.speaking.status === 'no-quota') {
    return (
      <div className="her-warn">
        <p>百炼账号的额度用完了，她现在只用文字回答。</p>
        <p>到阿里云百炼控制台开通按量付费；如果已经开通，把"仅使用免费额度"关掉。弄好后最多半分钟她就能说话，不用重启。</p>
        <p className="her-faint">{state.voice.speaking.error}</p>
      </div>
    )
  }
  return (
    <div className="her-warn">
      <p>她的声音用阿里云百炼（CosyVoice），还没有找到 API key，现在只用文字回答。</p>
      {state.platform === 'darwin'
        ? <p>在终端运行下面这条命令，按提示粘贴 key（两次，屏幕上不显示），不用重启：<br /><code>security add-generic-password -a dsh-her -s dsh-her-dashscope -w</code></p>
        : <p>把 key 设成环境变量 <code>DASHSCOPE_API_KEY</code>，然后重启 dsh。</p>}
      <p className="her-faint">key 不会存进任何文件，也不要贴到聊天里。</p>
    </div>
  )
}

export function VoicePicker({ state, apply, onSaved, saveLabel = '用这个声音' }: { state: StateView; apply: Apply; onSaved?: () => void; saveLabel?: string }) {
  const inUse = state.character.voice
  // Clicking a voice plays it and marks it to try; she only switches when you say so.
  const [trying, setTrying] = useState(inUse.id)
  const [speed, setSpeed] = useState(inUse.speed)
  const [error, setError] = useState<string>()
  const [playing, setPlaying] = useState<string>()
  // One service at a time (tabs), starting on the one she uses.
  const [service, setService] = useState<VoiceService>(serviceOf(inUse.id))
  const { status: speaking, error: speakingError } = state.voice.speaking
  const listen = async (which: string) => {
    setTrying(which)
    setPlaying(which)
    setError(undefined)
    const result = await herApi.previewVoice(which, speed, `你好呀，我是${state.character.name}，我在你桌面上等你好久啦。今天过得怎么样？`)
    setPlaying(undefined)
    if (result.ok) playAudio(result.audio, result.format)
    else setError(result.message)
  }
  const save = async () => {
    if (await apply(herApi.saveCharacter({ voice: trying, speed }))) onSaved?.()
  }
  const changed = trying !== inUse.id || speed !== inUse.speed
  return (
    <div>
      <p className="her-now">正在用：<b>{voiceLabel(state, inUse.id)}</b>（{SERVICE_SHORT[serviceOf(inUse.id)]}，语速 {inUse.speed.toFixed(1)}）<Dot tone={speakingTone(speaking)} />{speakingShort(speaking)}</p>
      {(speaking === 'no-key' || speaking === 'no-quota') && <KeyHelp state={state} />}
      {speaking === 'off' && <p className="her-warn">她的声音已关闭（插件设置里 voice.enabled 是 false），只用文字回答。</p>}
      {speaking === 'installing' && state.voice.speaking.service === 'edge' && <p className="her-muted">第一次用，正在准备 Edge 语音组件（一两分钟）…</p>}
      {speaking === 'failed' && <p className="her-warn">她的声音出错了：{speakingError ?? '未知原因'}。{state.voice.speaking.service === 'ming' ? '' : '会自动重试。'}</p>}
      <div className="her-tabs her-subtabs">
        {(['edge', 'cosyvoice', 'ming'] as VoiceService[]).map(id => (
          <button key={id} className={`her-tab ${service === id ? 'on' : ''}`} onClick={() => setService(id)}>
            {SERVICE_SHORT[id]}{serviceOf(inUse.id) === id && <span className="her-badge her-badge-inline">在用</span>}
          </button>
        ))}
      </div>
      {service === 'ming'
        ? <MingSection state={state} apply={apply} inUse={inUse.id} trying={trying} {...(playing === undefined ? {} : { playing })} onListen={id => void listen(id)} />
        : (
          <div>
            <label className="her-label">{SERVICE_NAMES[service]}</label>
            <div className="her-grid">
              {VOICES.filter(v => v.service === service).map(v => (
                <button key={v.id} className={choiceClass(v.id, inUse.id, trying)} disabled={speaking === 'off'} onClick={() => void listen(v.id)}>
                  {v.name}<small>{choiceNote(v.id, inUse.id, `${v.desc}${v.id === inUse.id ? '' : ' · 点一下试听'}`, playing)}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      <div className="her-row">
        <span className="her-muted">语速 {speed.toFixed(1)}</span>
        <input type="range" min={0.7} max={1.4} step={0.1} value={speed} onChange={e => setSpeed(Number(e.target.value))} />
        <button className="her-btn" disabled={speaking === 'off'} onClick={() => void listen(trying)}>用这个语速试听</button>
      </div>
      {changed && (
        <div className="her-pending">
          <span>你在试「{voiceLabel(state, trying)}」{speed !== inUse.speed ? `，语速 ${speed.toFixed(1)}` : ''}，还没换上。</span>
          <button className="her-btn primary" onClick={() => void save()}>{onSaved === undefined ? `换成「${voiceLabel(state, trying)}」` : saveLabel}</button>
          <button className="her-btn" onClick={() => { setTrying(inUse.id); setSpeed(inUse.speed) }}>不换了</button>
        </div>
      )}
      {!changed && onSaved !== undefined && <div className="her-row"><button className="her-btn primary" onClick={() => onSaved()}>{saveLabel}</button></div>}
      <p className="her-faint">Edge 的声音免费，但不是微软公开的正式接口，可能哪天失效；百炼的声音更稳，要 key 和付费额度；本机 Ming 不联网、免费、能表达情绪，还能设计或克隆她自己的声音，但要先装（约 2 GB）。</p>
      {error !== undefined && <p className="her-error">{error}</p>}
    </div>
  )
}

function speakingTone(status: string): 'ok' | 'warn' | 'bad' | 'off' {
  if (status === 'ready') return 'ok'
  if (status === 'off') return 'off'
  return status === 'checking' || status === 'installing' ? 'warn' : 'bad'
}

function speakingShort(status: string): string {
  switch (status) {
    case 'ready': return '正常'
    case 'checking': return '正在准备'
    case 'installing': return '正在安装'
    case 'no-key': return '缺 key'
    case 'no-quota': return '额度用完'
    case 'off': return '已关闭'
    default: return '出错了'
  }
}

const DEFAULT_CHOICE = ''

export function ModelPicker({ state, apply }: { state: StateView; apply: Apply }) {
  const chosen = state.character.model
  const [groups, setGroups] = useState<ModelGroup[]>()
  const [loadError, setLoadError] = useState<string>()
  const [choice, setChoice] = useState(chosen === undefined ? DEFAULT_CHOICE : `${chosen.provider}/${chosen.model}`)
  const [effort, setEffort] = useState(chosen?.effort ?? '')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    void modelCatalog().then(result => {
      if (result.ok) setGroups(result.groups)
      else setLoadError(result.message)
    })
  }, [])
  const [provider, model] = choice === DEFAULT_CHOICE ? [undefined, undefined] : [choice.slice(0, choice.indexOf('/')), choice.slice(choice.indexOf('/') + 1)]
  const efforts = groups?.find(g => g.id === provider)?.models.find(m => m.id === model)?.reasoning?.efforts ?? []
  const nameOf = (p: string, m: string) => {
    const group = groups?.find(g => g.id === p)
    return `${group?.name ?? p} · ${group?.models.find(x => x.id === m)?.name ?? m}`
  }
  const save = async () => {
    setSaved(false)
    const value = provider === undefined ? null : { provider, model, ...(effort === '' ? {} : { effort }) }
    if (await apply(herApi.saveCharacter({ model: value }))) setSaved(true)
  }
  const changed = choice !== (chosen === undefined ? DEFAULT_CHOICE : `${chosen.provider}/${chosen.model}`) || effort !== (chosen?.effort ?? '')
  return (
    <div>
      <p className="her-now">
        正在用：{state.model === null ? <b>没有可用的模型</b> : <b>{nameOf(state.model.provider, state.model.model)}</b>}
        {state.model?.effort ? `（思考：${state.model.effort}）` : ''}
        {state.model !== null && !state.model.chosen && '（跟随 dsh 的默认模型）'}
        <Dot tone={state.model === null || state.problem !== undefined ? 'bad' : 'ok'} />{state.model === null ? '她没法说话' : state.problem !== undefined ? '上一次回答失败了' : '正常'}
      </p>
      {state.problem !== undefined && <p className="her-alert">{state.problem.text}</p>}
      {loadError !== undefined && <p className="her-error">拿不到 dsh 的模型列表：{loadError}</p>}
      <div className="her-row">
        <select className="her-select" style={{ flex: 1, minWidth: 220 }} value={choice} disabled={groups === undefined} onChange={e => { setChoice(e.target.value); setEffort('') }}>
          <option value={DEFAULT_CHOICE}>跟随 dsh 的默认模型</option>
          {chosen !== undefined && groups !== undefined && !groups.some(g => g.id === chosen.provider && g.models.some(m => m.id === chosen.model)) && (
            <option value={`${chosen.provider}/${chosen.model}`}>{chosen.provider} / {chosen.model}（不在 dsh 的模型列表里）</option>
          )}
          {groups?.map(g => (
            <optgroup key={g.id} label={g.name}>
              {g.models.map(m => <option key={m.id} value={`${g.id}/${m.id}`}>{m.name}</option>)}
            </optgroup>
          ))}
        </select>
        <select className="her-select" style={{ width: 150 }} value={effort} disabled={efforts.length === 0} onChange={e => setEffort(e.target.value)}>
          <option value="">思考：默认</option>
          {efforts.map(x => <option key={x.id} value={x.id}>思考：{x.name}</option>)}
        </select>
        <button className="her-btn primary" disabled={groups === undefined || !changed} onClick={() => void save()}>{changed ? '换成这个模型' : '正在用这个'}</button>
      </div>
      {changed && <p className="her-warn">选了新的模型，还没换上：点"换成这个模型"。</p>}
      {saved && !changed && <p className="her-ok">已换好，从她的下一句话开始生效；之前聊过的都还在。</p>}
      <p className="her-faint">聊天要的是快：选 Flash 一类的快模型、思考选 Low（或 Off），她开口会快很多。模型的账号和价格在 dsh 的设置里管。</p>
    </div>
  )
}

export function MicCheck({ state }: { state: StateView }) {
  if (!desktopHere(state.body) && !window.isSecureContext) {
    return (
      <div>
        <p className="her-warn">浏览器只在 HTTPS 或 localhost 下才让网页用麦克风，所以这样打开时只能打字给她（双击她，或者右键菜单）。</p>
        <p className="her-muted">想说话：用 SSH 隧道从 localhost 打开（<code>ssh -L 3000:127.0.0.1:3000 你的VPS</code>，再开 http://localhost:3000），或者给 dsh 配 HTTPS。见<a href="https://github.com/AIcivilization/dsh-her/blob/main/docs/VPS部署.md" target="_blank" rel="noreferrer">VPS 部署</a>。</p>
      </div>
    )
  }
  const shortcut = state.platform === 'darwin' ? '⌃⌥空格' : 'Ctrl+Alt+空格'
  const fresh = state.heard !== undefined && Date.now() - state.heard.at < 120_000
  return (
    <div>
      <p>按 <b>{shortcut}</b>，对着麦克风说一句话（比如"你好呀"）。第一次会弹出麦克风权限请求，请允许。</p>
      <p>她脚下的小圆点亮起表示在听，变绿表示听到了声音。</p>
      <p>{fresh ? <><Dot tone="ok" />我听到了：「{state.heard!.text}」</> : <span className="her-muted">还没听到……</span>}</p>
      <p className="her-faint">听不清时：换个安静的地方，或者检查系统设置里选的麦克风。外放时她的声音可能被当成你在说话，戴耳机效果最好。</p>
    </div>
  )
}

/** The scenes of the look on screen: which one she is in, when each comes up, switching on or off. */
export function ScenePicker({ state, apply }: { state: StateView; apply: Apply }) {
  const look = state.body.look
  if (look === undefined) return null
  return (
    <div className="her-scenes">
      <p><b>{look.name}</b> 的场景{look.desk ? '（"浮在最上层"时显示桌宠，换场景在其他两种模式下看得到）' : ''}</p>
      <div className="her-row">
        <label><input type="checkbox" checked={look.auto} onChange={e => void apply(herApi.setLook({ auto: e.target.checked }))} /> 自动换场景</label>
        <label><input type="checkbox" checked={look.locked} onChange={e => void apply(herApi.setLook({ locked: e.target.checked }))} /> 待在现在这里不动</label>
      </div>
      {look.scenes.map(scene => (
        <div key={scene.id} className="her-row her-scene">
          <label><input type="checkbox" checked={scene.on} disabled={scene.id === look.current} onChange={e => void apply(herApi.setLook({ on: { [scene.id]: e.target.checked } }))} /> {scene.name}</label>
          {scene.id === look.current && <span className="her-tag ok">现在在这</span>}
          <span className="her-muted">{scene.when}</span>
          <button className="her-btn" disabled={scene.id === look.current || !scene.on} onClick={() => void apply(herApi.setLook({ go: scene.id }))}>现在去这里</button>
        </div>
      ))}
      <p className="her-muted">自动换场景时，每个场景至少待 20 分钟，你们说话的时候不换。跟她说"去卧室吧""就待在这"也行。</p>
    </div>
  )
}

export function ModePicker({ state, apply }: { state: StateView; apply: Apply }) {
  const current = state.body.mode
  return (
    <div className="her-grid">
      {(['overlay', 'wallpaper', 'window'] as const).map(mode => (
        <button key={mode} className={`her-choice ${current === mode ? 'on' : ''}`} disabled={!state.body.connected} onClick={() => void apply(herApi.setMode(mode))}>
          {MODE_TEXT[mode]!.title}<small>{choiceNote(mode, current ?? '', MODE_TEXT[mode]!.desc)}</small>
        </button>
      ))}
    </div>
  )
}

const WEB_MODES: Array<['auto' | 'on' | 'off', string, string]> = [
  ['auto', '自动', '桌面程序没在运行时，住在 dsh 网页里'],
  ['on', '一直在网页里', '也显示在 dsh 网页里（有桌面身体时不出声）'],
  ['off', '不在网页里', '只用桌面身体'],
]

/** Whether she also lives in DSH's own page (for a computer with no desktop, or no desktop body). */
export function WebModePicker({ state, apply }: { state: StateView; apply: Apply }) {
  // With no desktop body in reach, "auto" and "always" are the same thing.
  const offered = desktopOffered(state.body)
  const current = !offered && state.body.web.mode === 'on' ? 'auto' : state.body.web.mode
  const modes = offered ? WEB_MODES : WEB_MODES.filter(([mode]) => mode !== 'on').map(([mode, title, desc]): typeof WEB_MODES[number] => (mode === 'auto' ? [mode, '住在网页里', '在 dsh 的每个页面上，能拖动'] : [mode, title, '这个网页里不显示她，打字和说话都用不了']))
  return (
    <div>
      <label className="her-label">dsh 网页里的她</label>
      <div className="her-grid">
        {modes.map(([mode, title, desc]) => (
          <button key={mode} className={choiceClass(mode, current)} onClick={() => void apply(herApi.webSet(mode))}>
            {title}<small>{choiceNote(mode, current, desc)}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * How she shows in this page: a figure on it or the scene behind it, how much
 * of the page, and a switch for now (kept per browser, so it can be turned off
 * here at work and stay on at home).
 */
export function WebPlaceCard({ state, apply }: { state: StateView; apply: Apply }) {
  const web = state.body.web
  const [, redraw] = useState(0)
  useEffect(() => {
    const again = () => redraw(n => n + 1)
    window.addEventListener('dsh-her:float', again)
    return () => window.removeEventListener('dsh-her:float', again)
  }, [])
  const float = window.__herFloat
  const choose = async (change: { place?: 'pet' | 'background'; scope?: 'page' | 'chat' }) => {
    if (await apply(herApi.webPlace(change))) float?.refresh()
  }
  if (!web.show && !web.connected && !remotePage) return null
  const hidden = float?.hidden() === true
  return (
    <div className="her-card">
      <h2>她在网页里的样子</h2>
      <div className="her-row">
        <span>{hidden ? <><Dot tone="off" />暂时关掉了</> : <><Dot tone="ok" />正在显示</>}</span>
        <button className="her-btn small" onClick={() => float?.setHidden(!hidden)}>{hidden ? '打开' : '暂时关掉'}</button>
        <span className="her-muted">只影响这个浏览器。</span>
      </div>
      <div className="her-grid">
        <button className={choiceClass('pet', web.place)} onClick={() => void choose({ place: 'pet' })}>桌宠<small>{choiceNote('pet', web.place, '浮在页面上，能拖动、点她')}</small></button>
        <button className={choiceClass('background', web.place)} disabled={!web.canBackground} onClick={() => void choose({ place: 'background' })}>背景<small>{choiceNote('background', web.place, web.canBackground ? '场景铺在页面后面，文字浮在上面' : '这个形象还没有场景：到形象工坊加一个再导入')}</small></button>
      </div>
      {web.place === 'background' && (
        <div className="her-grid">
          <button className={choiceClass('page', web.scope)} onClick={() => void choose({ scope: 'page' })}>整个页面<small>{choiceNote('page', web.scope, '连左边的列表一起')}</small></button>
          <button className={choiceClass('chat', web.scope)} onClick={() => void choose({ scope: 'chat' })}>只在对话窗口<small>{choiceNote('chat', web.scope, '左边的列表不变')}</small></button>
        </div>
      )}
      {web.place === 'background' && <p className="her-muted">背景不能点：对话框上的她（或者"她"按钮）可以打字、说话或者暂时关掉。</p>}
    </div>
  )
}

export function MemoryView({ state, apply }: { state: StateView; apply: Apply }) {
  const [report, setReport] = useState<string>()
  const { diary, lastDigestDay } = state.memory
  // Newest first, so what she just noted is on top.
  const facts = [...state.memory.facts].reverse()
  const episodes = [...state.memory.episodes].reverse()
  const today = new Date().toDateString()
  const isNew = (at: string) => new Date(at).toDateString() === today
  const digest = async () => {
    setReport('正在整理…')
    const result = await herApi.digest()
    setReport(result.ok ? result.report : result.message)
    if (result.ok) await apply(Promise.resolve(result))
  }
  const download = async () => {
    const result = await herApi.exportMemory()
    if (!result.ok) return
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([result.markdown], { type: 'text/markdown' }))
    link.download = `她记得的事-${new Date().toISOString().slice(0, 10)}.md`
    link.click()
    URL.revokeObjectURL(link.href)
  }
  const forget = (id: string, text: string) => {
    if (window.confirm(`让她忘掉这条？\n\n${text}`)) void apply(herApi.memoryRemove([id]))
  }
  return (
    <div>
      <div className="her-card">
        <h2>关于你（{facts.length}）</h2>
        <p className="her-muted">她聊天时自己记下的直接生效；聊完一分钟后她会把刚才的话过一遍，挑出来的先"待确认"，7 天后自动确认，敏感的要你点确认。</p>
        <ul className="her-list">
          {facts.map(f => (
            <li key={f.id}>
              <span className="grow">{f.text}</span>
              {isNew(f.createdAt) && <span className="her-tag ok">今天</span>}
              {f.status === 'candidate' && <span className="her-tag warn">待确认</span>}
              {f.sensitive && <span className="her-tag bad">敏感</span>}
              {f.status === 'candidate' && <button className="her-btn small" onClick={() => void apply(herApi.memoryConfirm([f.id]))}>确认</button>}
              <button className="her-btn small" onClick={() => forget(f.id, f.text)}>忘掉</button>
            </li>
          ))}
          {facts.length === 0 && <li className="her-muted">还没有</li>}
        </ul>
      </div>
      <div className="her-card">
        <h2>事件（{episodes.length}）</h2>
        <p className="her-muted">有日期的事，在当天和前一天她会自然地提起。</p>
        <ul className="her-list">
          {episodes.map(e => (
            <li key={e.id}>
              <span className="her-faint">{e.at.slice(0, 10)}</span>
              <span className="grow">{e.text}</span>
              {isNew(e.at) && <span className="her-tag ok">今天</span>}
              {e.due !== undefined && <span className="her-tag">{e.due}</span>}
              <button className="her-btn small" onClick={() => forget(e.id, e.text)}>忘掉</button>
            </li>
          ))}
          {episodes.length === 0 && <li className="her-muted">还没有</li>}
        </ul>
      </div>
      <div className="her-card">
        <h2>她的日记（{diary.length} 天）</h2>
        <p className="her-muted">日记每天写一篇：你最后一次和她说话 30 分钟后（或 23:30 以后）。上次写到：{lastDigestDay ?? '还没有'}</p>
        <p>{diary.length === 0 ? <span className="her-muted">还没有</span> : diary.join('、')}</p>
        <div className="her-row">
          <button className="her-btn" onClick={() => void digest()}>现在整理今天</button>
          <button className="her-btn" onClick={() => void download()}>导出全部（Markdown）</button>
        </div>
        {report !== undefined && <p className="her-muted">{report}</p>}
      </div>
    </div>
  )
}
