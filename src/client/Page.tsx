/**
 * The "她" page. Until she is set up it shows the seven-step wizard; after
 * that, the management page. It polls the brain every two seconds (the body
 * connecting, an import running, a sentence heard all show up on their own),
 * and every change shows the state the brain answers with.
 */

import { useCallback, useEffect, useState } from 'react'
import { herApi, type StateView } from './api.ts'
import { BodyStatus, Dot, MemoryView, MicCheck, ModePicker, PackPicker, PersonaEditor, VoicePicker, type Apply } from './parts.tsx'

const POLL_MS = 2000

export function HerPage() {
  const [state, setState] = useState<StateView>()
  const [error, setError] = useState<string>()
  const [wizard, setWizard] = useState<boolean>()

  const refresh = useCallback(async () => {
    const result = await herApi.state()
    if (result.ok) {
      setState(result.state)
      setError(undefined)
    } else setError(result.message)
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const apply: Apply = useCallback(async call => {
    const result = await call
    if (result.ok) {
      setState(result.state)
      setError(undefined)
      return true
    }
    setError(result.message)
    return false
  }, [])

  if (state === undefined) {
    return <div className="her-page">{error === undefined ? <p className="her-muted">正在连接她的大脑…</p> : <p className="her-error">连不上：{error}</p>}</div>
  }
  const showWizard = wizard ?? !state.character.onboarded
  return (
    <div className="her-page">
      {showWizard
        ? <Wizard state={state} apply={apply} onDone={() => setWizard(false)} />
        : <Manage state={state} apply={apply} onWizard={() => setWizard(true)} />}
      {error !== undefined && <p className="her-error">{error}</p>}
    </div>
  )
}

const STEPS = ['检查', '身体', '外形', '人格', '声音', '麦克风', '放到桌面'] as const

function Wizard({ state, apply, onDone }: { state: StateView; apply: Apply; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1))
  const finish = async () => {
    if (await apply(herApi.saveCharacter({ onboarded: true }))) onDone()
  }
  const body = state.body
  const nav = (canNext: boolean, hint?: string) => (
    <div className="her-row">
      {step > 0 && <button className="her-btn" onClick={() => setStep(step - 1)}>上一步</button>}
      {step < STEPS.length - 1
        ? <button className="her-btn primary" disabled={!canNext} onClick={next}>下一步</button>
        : <button className="her-btn primary" onClick={() => void finish()}>完成</button>}
      {hint !== undefined && <span className="her-muted">{hint}</span>}
    </div>
  )

  return (
    <>
      <div className="her-head">
        <h1>让她住到你的桌面上</h1>
        {state.character.onboarded && <button className="her-btn link" onClick={onDone}>回到管理页</button>}
      </div>
      <div className="her-steps">
        {STEPS.map((name, i) => (
          <button key={name} className={`her-step ${i === step ? 'on' : i < step ? 'done' : ''}`} onClick={() => setStep(i)}>{i + 1}. {name}</button>
        ))}
      </div>

      {step === 0 && (
        <div className="her-card">
          <h2>先看看准备好了没有</h2>
          <p>{state.model === null ? <><Dot tone="bad" />dsh 还没有可用的模型。请先在 dsh 设置里配好一个模型（比如 DeepSeek），再回来。</> : <><Dot tone="ok" />大脑用的模型：{state.model.provider} / {state.model.model}</>}</p>
          <p><Dot tone={state.voice.status === 'ready' ? 'ok' : state.voice.status === 'off' ? 'off' : 'warn'} />本地语音：{voiceText(state.voice.status)}</p>
          <p><Dot tone="ok" />系统：{platformText(state.platform)}</p>
          {nav(state.model !== null, state.model === null ? '没有模型她没法说话' : undefined)}
        </div>
      )}
      {step === 1 && (
        <div className="her-card">
          <h2>她的身体</h2>
          <p className="her-muted">她的样子和声音在一个单独的桌面程序里（"身体"），这里的 dsh 是她的大脑。两边连上她才能出现在桌面上。</p>
          <BodyStatus state={state} apply={apply} />
          {nav(body.connected, body.connected ? undefined : '也可以先跳过，之后在管理页再连')}
          {!body.connected && <div className="her-row"><button className="her-btn link" onClick={next}>先跳过</button></div>}
        </div>
      )}
      {step === 2 && (
        <div className="her-card">
          <h2>选一个外形</h2>
          <p className="her-muted">外形包是一组短视频：待机、说话、几个动作。点一下就换上；也可以导入你自己生成的素材。</p>
          <PackPicker state={state} apply={apply} />
          {nav(true)}
        </div>
      )}
      {step === 3 && (
        <div className="her-card">
          <h2>她是谁</h2>
          <PersonaEditor state={state} apply={apply} onSaved={next} saveLabel="保存，下一步" />
          {nav(true)}
        </div>
      )}
      {step === 4 && (
        <div className="her-card">
          <h2>她的声音</h2>
          <VoicePicker state={state} apply={apply} onSaved={next} saveLabel="用这个声音，下一步" />
          {nav(true)}
        </div>
      )}
      {step === 5 && (
        <div className="her-card">
          <h2>试试和她说话</h2>
          {body.connected ? <MicCheck state={state} /> : <p className="her-muted">身体连上之后才能用麦克风。</p>}
          {nav(true)}
        </div>
      )}
      {step === 6 && (
        <div className="her-card">
          <h2>把她放到桌面上</h2>
          <p className="her-muted">随时可以在管理页改。</p>
          <ModePicker state={state} apply={apply} />
          {!body.connected && <p className="her-muted">身体连上之后才能切换。</p>}
          {nav(true)}
        </div>
      )}
    </>
  )
}

type Tab = 'overview' | 'look' | 'persona' | 'voice' | 'memory'
const TABS: Array<[Tab, string]> = [['overview', '概况'], ['look', '外形'], ['persona', '人格'], ['voice', '声音'], ['memory', '她记得的事']]

function Manage({ state, apply, onWizard }: { state: StateView; apply: Apply; onWizard: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  return (
    <>
      <div className="her-head">
        <h1>{state.character.name}</h1>
        <button className="her-btn link" onClick={onWizard}>重新走一遍向导</button>
      </div>
      <div className="her-tabs">
        {TABS.map(([id, label]) => <button key={id} className={`her-tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'overview' && (
        <>
          <div className="her-card">
            <h2>身体</h2>
            <BodyStatus state={state} apply={apply} />
          </div>
          <div className="her-card">
            <h2>放在哪里</h2>
            <ModePicker state={state} apply={apply} />
          </div>
          <div className="her-card">
            <h2>大脑</h2>
            <p>{state.model === null ? <><Dot tone="bad" />没有可用的模型</> : <><Dot tone="ok" />{state.model.provider} / {state.model.model}</>}</p>
            <p><Dot tone={state.voice.status === 'ready' ? 'ok' : 'warn'} />本地语音：{voiceText(state.voice.status)}（音色 {state.character.voice.sid}）</p>
            <p className="her-muted">记得 {state.memory.facts.length} 件关于你的事、{state.memory.episodes.length} 个事件，写了 {state.memory.diary.length} 天日记。</p>
            {state.heard !== undefined && <p className="her-faint">最近听到：「{state.heard.text}」</p>}
          </div>
        </>
      )}
      {tab === 'look' && <div className="her-card"><h2>外形</h2><PackPicker state={state} apply={apply} /></div>}
      {tab === 'persona' && <div className="her-card"><h2>人格</h2><PersonaEditor state={state} apply={apply} /></div>}
      {tab === 'voice' && <div className="her-card"><h2>声音</h2><VoicePicker state={state} apply={apply} saveLabel="保存" /></div>}
      {tab === 'memory' && <MemoryView state={state} apply={apply} />}
    </>
  )
}

function voiceText(status: string): string {
  switch (status) {
    case 'ready': return '已就绪'
    case 'downloading': return '正在下载语音模型（约 400 MB，只下一次）'
    case 'loading': return '正在加载'
    case 'off': return '已关闭，只用文字'
    case 'failed': return '出错了，暂时只用文字'
    default: return status
  }
}

function platformText(platform: string): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  return platform
}
