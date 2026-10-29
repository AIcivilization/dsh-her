/**
 * Pieces shared by the wizard and the management page. Each takes the latest
 * state and `apply`, which sends a change and takes the state the brain
 * answers with (the page never shows a local guess).
 */

import { useState } from 'react'
import { herApi, playWav, type Result, type StateView } from './api.ts'

export type Apply = (call: Promise<Result<{ state: StateView }>>) => Promise<boolean>

const MODE_TEXT: Record<string, { title: string; desc: string }> = {
  overlay: { title: '浮在最上层', desc: '像桌宠一样在所有窗口上面，可以拖动、点她' },
  wallpaper: { title: '住在壁纸里', desc: '在桌面图标和所有窗口下面，只看不点；按快捷键叫她出来' },
  window: { title: '普通窗口', desc: '一个可以关掉的窗口' },
}

export function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'off' }) {
  return <span className={`her-dot ${tone === 'off' ? '' : tone}`} />
}

export function BodyStatus({ state, apply }: { state: StateView; apply: Apply }) {
  const [message, setMessage] = useState<string>()
  const body = state.body
  const start = async () => {
    const result = await herApi.startBody()
    if (result.ok) setMessage(result.message)
    await apply(Promise.resolve(result))
  }
  if (body.connected) {
    return (
      <p><Dot tone="ok" />身体已连上（{body.info?.os}，版本 {body.info?.version}）{body.pack === undefined ? '' : `，外形：${body.pack.name}`}</p>
    )
  }
  return (
    <div>
      <p><Dot tone={body.running ? 'warn' : 'bad'} />{body.running ? '身体在运行，正在连接…' : '身体还没运行'}</p>
      {!body.running && (
        <div className="her-row">
          {body.canStart
            ? <button className="her-btn primary" onClick={() => void start()}>启动身体</button>
            : <span className="her-muted">这台电脑上还没有安装身体程序。正式版会在这里一键下载安装（M6）。</span>}
        </div>
      )}
      {message !== undefined && <p className="her-muted">{message}</p>}
    </div>
  )
}

export function PackPicker({ state, apply }: { state: StateView; apply: Apply }) {
  const body = state.body
  const imp = state.import
  if (!body.connected) return <p className="her-muted">身体连上之后才能选外形。</p>
  return (
    <div>
      <div className="her-grid">
        {body.packs.map(pack => (
          <button key={pack.packId} className={`her-choice ${pack.packId === body.activePack ? 'on' : ''}`} onClick={() => void apply(herApi.usePack(pack.packId))}>
            {pack.name}
            <small>{pack.layer === 'scene' ? '壁纸场景' : '桌宠'} · {pack.actions.length} 个动作{pack.emotions.length > 0 ? ` · ${pack.emotions.length} 种情绪` : ''}</small>
          </button>
        ))}
        {body.packs.length === 0 && <p className="her-muted">还没有导入过外形包。</p>}
      </div>
      <div className="her-row">
        <button className="her-btn" disabled={imp.state === 'picking' || imp.state === 'running'} onClick={() => void apply(herApi.pickPack())}>导入我的素材…</button>
        <span className="her-muted">会在身体那台电脑上弹出选择文件夹的窗口。素材怎么做、怎么命名，见 docs/素材生成提示词.md。</span>
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

export function PersonaEditor({ state, apply, onSaved, saveLabel = '保存' }: { state: StateView; apply: Apply; onSaved?: () => void; saveLabel?: string }) {
  const c = state.character
  const [name, setName] = useState(c.name)
  const [callYou, setCallYou] = useState(c.callYou)
  const [pronoun, setPronoun] = useState<string>(c.pronoun)
  const [persona, setPersona] = useState(c.persona)
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState<'expand' | 'try' | 'save'>()
  const [error, setError] = useState<string>()
  const [chat, setChat] = useState<Array<{ who: 'you' | 'her'; text: string }>>([])
  const [line, setLine] = useState('')

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
      <div className="her-row"><button className="her-btn primary" disabled={busy !== undefined} onClick={() => void save()}>{saveLabel}</button></div>
    </div>
  )
}

/** Speaker ids worth trying first (Kokoro v1.1 has 103; the rest are reachable by number). */
const SUGGESTED = [3, 8, 13, 20, 28, 35, 45, 55, 62, 75]

export function VoicePicker({ state, apply, onSaved, saveLabel = '用这个声音' }: { state: StateView; apply: Apply; onSaved?: () => void; saveLabel?: string }) {
  const [sid, setSid] = useState(state.character.voice.sid)
  const [speed, setSpeed] = useState(state.character.voice.speed)
  const [error, setError] = useState<string>()
  const [playing, setPlaying] = useState<number>()
  const ready = state.voice.status === 'ready'
  const listen = async (which: number) => {
    setSid(which)
    setPlaying(which)
    setError(undefined)
    const result = await herApi.previewVoice(which, speed, `你好呀，我是${state.character.name}，我在你桌面上等你好久啦。`)
    setPlaying(undefined)
    if (result.ok) playWav(result.wav)
    else setError(result.message)
  }
  const save = async () => {
    if (await apply(herApi.saveCharacter({ sid, speed }))) onSaved?.()
  }
  return (
    <div>
      {!ready && <p className="her-warn">她的本地语音还没准备好（{state.voice.status === 'downloading' ? '模型下载中' : state.voice.status}）。准备好之前，她只用文字回答。</p>}
      <div className="her-grid">
        {SUGGESTED.map(n => (
          <button key={n} className={`her-choice ${n === sid ? 'on' : ''}`} disabled={!ready} onClick={() => void listen(n)}>
            音色 {n}<small>{playing === n ? '正在合成…' : '点一下试听'}</small>
          </button>
        ))}
      </div>
      <div className="her-row">
        <span className="her-muted">或者输入编号（0–102）：</span>
        <input className="her-input" style={{ width: 80 }} type="number" min={0} max={102} value={sid} onChange={e => setSid(Number(e.target.value))} />
        <button className="her-btn" disabled={!ready} onClick={() => void listen(sid)}>试听</button>
        <span className="her-muted">语速 {speed.toFixed(1)}</span>
        <input type="range" min={0.7} max={1.4} step={0.1} value={speed} onChange={e => setSpeed(Number(e.target.value))} />
      </div>
      <p className="her-faint">想要更像真人、或者用你自己的声音：云端克隆音色（阿里云百炼）还没接上，之后会加在这里。</p>
      {error !== undefined && <p className="her-error">{error}</p>}
      <div className="her-row"><button className="her-btn primary" onClick={() => void save()}>{saveLabel}</button></div>
    </div>
  )
}

export function MicCheck({ state }: { state: StateView }) {
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

export function ModePicker({ state, apply }: { state: StateView; apply: Apply }) {
  const current = state.body.mode
  return (
    <div className="her-grid">
      {(['overlay', 'wallpaper', 'window'] as const).map(mode => (
        <button key={mode} className={`her-choice ${current === mode ? 'on' : ''}`} disabled={!state.body.connected} onClick={() => void apply(herApi.setMode(mode))}>
          {MODE_TEXT[mode]!.title}<small>{MODE_TEXT[mode]!.desc}</small>
        </button>
      ))}
    </div>
  )
}

export function MemoryView({ state, apply }: { state: StateView; apply: Apply }) {
  const [report, setReport] = useState<string>()
  const { facts, episodes, diary, lastDigestDay } = state.memory
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
        <p className="her-muted">她自己记下的直接生效；每天整理时发现的先"待确认"，7 天后自动确认，敏感的要你点确认。</p>
        <ul className="her-list">
          {facts.map(f => (
            <li key={f.id}>
              <span className="grow">{f.text}</span>
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
              {e.due !== undefined && <span className="her-tag">{e.due}</span>}
              <button className="her-btn small" onClick={() => forget(e.id, e.text)}>忘掉</button>
            </li>
          ))}
          {episodes.length === 0 && <li className="her-muted">还没有</li>}
        </ul>
      </div>
      <div className="her-card">
        <h2>她的日记（{diary.length} 天）</h2>
        <p className="her-muted">每天你最后一次和她说话 30 分钟后（或 23:30 以后）她会整理一次。上次整理：{lastDigestDay ?? '还没有'}</p>
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
