/**
 * The "她" page. Until she is set up it shows the seven-step wizard; after
 * that, the management page. It polls the brain every two seconds (the body
 * connecting, an import running, a sentence heard all show up on their own),
 * and every change shows the state the brain answers with.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { desktopHere, desktopOffered, herApi, remotePage, type StateView } from './api.ts'
import { serviceOf } from '../core/voices.ts'
import { UpdateBar } from './UpdateBar.tsx'
import { Workshop } from './Workshop.tsx'
import { Fold, useFolds } from './fold.tsx'
import { ClipsCard } from './ClipsCard.tsx'
import { StageEditor } from './StageEditor.tsx'
import { SkinCard } from './SkinCard.tsx'
import { StageMap } from './StageMap.tsx'
import { VoiceServices } from './VoiceServices.tsx'
import { onPageRequest, takePage } from './open-page.ts'
import type { SettingsPage } from '../protocol/index.ts'
import { SERVICE_SHORT, voiceLabel } from './choice.tsx'
import { BodyStatus, Dot, InitiativeCard, KeyHelp, TalkCard, MemoryView, MicCheck, ModelPicker, MODE_TEXT, ModePicker, PackPicker, PersonaEditor, platformName, ScenePicker, VoicePicker, WebModePicker, WebPlaceCard, type Apply } from './parts.tsx'

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
      <UpdateBar state={state} apply={apply} />
      {state.off && (
        <div className="her-offbar">
          <b>她关着</b>
          <span>桌面上、网页里都不显示，不听麦克风，不说话，也不会先开口。你在 dsh 里打字给她，她还是会用文字回。</span>
          <button className="her-btn primary" onClick={() => void apply(herApi.setOff(false))}>叫她出来</button>
        </div>
      )}
      {showWizard
        ? <Wizard state={state} apply={apply} onDone={() => setWizard(false)} />
        : <Manage state={state} apply={apply} onWizard={() => setWizard(true)} />}
      {error !== undefined && <p className="her-error">{error}</p>}
    </div>
  )
}

const STEPS = ['检查', '身体', '外形', '人设', '声音', '麦克风', '放在哪里'] as const

function Wizard({ state, apply, onDone }: { state: StateView; apply: Apply; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1))
  const finish = async () => {
    if (await apply(herApi.saveCharacter({ onboarded: true }))) onDone()
  }
  const body = state.body
  const offered = desktopOffered(body)
  const ready = desktopHere(body) || body.web.connected
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
        <h1>{offered ? '让她住到你身边' : '让她住到 dsh 网页里'}</h1>
        {state.character.onboarded && <button className="her-btn link" onClick={onDone}>回到设置</button>}
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
          <p><Dot tone={toneOf(state.voice.speaking.status)} />她的声音：{speakingText(state.voice.speaking.status, state.voice.speaking.service)}</p>
          {(state.voice.speaking.status === 'no-key' || state.voice.speaking.status === 'no-quota') && <KeyHelp state={state} />}
          <p><Dot tone={toneOf(state.voice.status)} />听你说话：{listeningText(state.voice.status)}</p>
          <p><Dot tone="ok" />dsh 跑在 {platformName(state.platform)} 上{remotePage ? '，你是从别的设备打开这个网页的' : ''}。{offered ? '她可以住在桌面上，也可以住在 dsh 网页里。' : '她住在 dsh 网页里，不用安装桌面程序。'}</p>
          {nav(state.model !== null, state.model === null ? '没有模型她没法说话' : undefined)}
        </div>
      )}
      {step === 1 && (
        <div className="her-card">
          <h2>她的身体</h2>
          <p className="her-muted">{offered ? '她可以住在 dsh 网页里（什么都不用装），也可以装一个桌面程序，住到桌面上，选哪个都可以。' : '她在 dsh 的每个页面上都在。'}</p>
          <BodyStatus state={state} apply={apply} />
          {nav(ready, ready ? undefined : '也可以先跳过，之后在 引擎 → 身体 里再连')}
          {!ready && <div className="her-row"><button className="her-btn link" onClick={next}>先跳过</button></div>}
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
          {ready ? <MicCheck state={state} /> : <p className="her-muted">身体连上之后才能用麦克风。</p>}
          {nav(true)}
        </div>
      )}
      {step === 6 && (
        <div className="her-card">
          <h2>{offered ? '把她放在哪里' : '她在网页里'}</h2>
          <p className="her-muted">随时可以在 引擎 → 放在哪里 改。</p>
          {offered && <ModePicker state={state} apply={apply} />}
          {offered && !body.connected && <p className="her-muted">桌面程序连上之后才能切换这几种。</p>}
          <WebModePicker state={state} apply={apply} />
          {nav(true)}
        </div>
      )}
    </>
  )
}

/** Her settings in four pages (docs/设置页与编排设计.md §1). */
const PAGES: Array<[SettingsPage, (name: string) => string]> = [['home', () => '主界面'], ['engine', () => '引擎'], ['her', name => name || '她'], ['stage', () => '编排']]

type Section = 'persona' | 'voice' | 'memory' | 'look' | 'clips' | 'model' | 'body' | 'place' | 'listen' | 'voices' | 'initiative' | 'talk'
/** Which page each part of the settings is on. */
const PAGE_OF: Record<Section, SettingsPage> = {
  persona: 'her', voice: 'her', memory: 'her',
  look: 'stage', clips: 'stage',
  model: 'engine', body: 'engine', place: 'engine', listen: 'engine', voices: 'engine', initiative: 'engine', talk: 'engine',
}
const FOLDS: Record<Section, boolean> = { persona: false, voice: false, memory: false, look: false, clips: false, model: false, body: false, place: false, listen: false, voices: false, initiative: false, talk: false }

function Manage({ state, apply, onWizard }: { state: StateView; apply: Apply; onWizard: () => void }) {
  const [page, setPage] = useState<SettingsPage>(() => takePage() ?? 'home')
  const [open, toggle] = useFolds<Section>('dsh-her.settings.open', FOLDS)
  // "设置…" on the desktop body's menu.
  useEffect(() => onPageRequest(() => {
    const asked = takePage()
    if (asked !== undefined) setPage(asked)
  }), [])
  /** Show one part of the settings: its page, the part opened and scrolled to. */
  const go = (section: Section) => {
    setPage(PAGE_OF[section])
    toggle(section, true)
    // After the page and the card are shown.
    setTimeout(() => document.getElementById(`her-set-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  const card = (id: Section, title: string, summary: string, tone: 'ok' | 'warn' | 'bad' | 'off', children: ReactNode) => (
    <Fold id={`her-set-${id}`} title={title} summary={summary} tone={tone} open={open[id]} onToggle={() => toggle(id)}>{children}</Fold>
  )
  const c = state.character
  const body = state.body
  const here = body.connected || body.web.connected
  const speaking = state.voice.speaking.status
  const pack = body.packs.find(p => p.packId === body.activePack)
  return (
    <>
      <div className="her-head">
        <h1>{c.name}</h1>
        <div className="her-head-right">
          <button className="her-btn link" onClick={onWizard}>重新走一遍向导</button>
          {!state.off && <button className="her-btn her-off" title="桌面上、网页里都收起来，不听、不说话；随时在这里叫她出来" onClick={() => void apply(herApi.setOff(true))}>⏻ 关掉她</button>}
        </div>
      </div>
      <div className="her-tabs">
        {PAGES.map(([id, label]) => <button key={id} className={`her-tab ${page === id ? 'on' : ''}`} onClick={() => setPage(id)}>{label(c.name)}</button>)}
      </div>

      {page === 'home' && (
        <>
          <p className="her-intro">这里是她的设置。<b>引擎</b>管大脑、身体、听你说话、她先开口和对话；<b>{c.name || '她'}</b>管她是谁、她的声音、她记得的事；<b>编排</b>管她长什么样、什么时候播哪段。</p>
          {state.problem !== undefined && (
            <div className="her-card her-alert">
              <h2>她刚才没能回答</h2>
              <p>{state.problem.text}</p>
              <div className="her-row"><button className="her-btn primary" onClick={() => go('model')}>去换模型</button></div>
            </div>
          )}
          <StageMap state={state} onGo={target => {
            if (target === 'stage') { setPage('stage'); return }
            if (target === 'skin') { document.getElementById('her-skin')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
            go(target === 'voice' ? 'voice' : target === 'talk' ? 'talk' : target === 'model' ? 'model' : target === 'place' ? 'place' : 'body')
          }} />
          <NowCard state={state} onChange={go} />
          <div id="her-skin"><SkinCard /></div>
          <WebPlaceCard state={state} apply={apply} />
          <div className="her-card">
            <h2>状态</h2>
            <p>{state.model === null ? <><Dot tone="bad" />没有可用的模型</> : <><Dot tone={state.problem === undefined ? 'ok' : 'bad'} />大脑：{state.model.provider} / {state.model.model}{state.model.chosen ? '' : '（dsh 默认）'}{state.problem === undefined ? '' : '：上一次回答失败了'}</>}</p>
            <p><Dot tone={toneOf(speaking)} />她的声音：{speakingText(speaking, state.voice.speaking.service)}（{voiceLabel(state, c.voice.id)}）</p>
            {(speaking === 'no-key' || speaking === 'no-quota') && <KeyHelp state={state} />}
            <p><Dot tone={toneOf(state.voice.status)} />听你说话：{listeningText(state.voice.status)}</p>
            <p><Dot tone={here ? 'ok' : 'off'} />身体：{desktopHere(body) ? '桌面上' : body.web.connected ? 'dsh 网页里' : '没连上'}</p>
            <p className="her-muted">记得 {state.memory.facts.length} 件关于你的事、{state.memory.episodes.length} 个事件，写了 {state.memory.diary.length} 天日记。</p>
            {state.heard !== undefined && <p className="her-faint">最近听到：「{state.heard.text}」</p>}
          </div>
        </>
      )}

      {page === 'engine' && (
        <>
          {card('model', '模型', state.model === null ? '没有可用的模型' : `${state.model.provider} / ${state.model.model}${state.model.chosen ? '' : '（dsh 默认）'}${state.problem === undefined ? '' : ' · 上一次回答失败了'}`,
            state.model === null || state.problem !== undefined ? 'bad' : 'ok', <ModelPicker state={state} apply={apply} />)}
          {card('body', '身体', desktopHere(body) ? '桌面程序已连上' : body.web.connected ? '在 dsh 网页里' : body.running ? '正在连' : '没连上', here ? 'ok' : body.running ? 'warn' : 'off',
            <BodyStatus state={state} apply={apply} />)}
          {card('place', '放在哪里', desktopHere(body) ? (body.mode === undefined ? '—' : MODE_TEXT[body.mode]?.title ?? body.mode) : body.web.connected ? 'dsh 网页里' : '身体没连上', here ? 'ok' : 'off',
            <>{desktopOffered(body) && <ModePicker state={state} apply={apply} />}<WebModePicker state={state} apply={apply} /></>)}
          {card('listen', '听你说话', listeningText(state.voice.status), toneOf(state.voice.status),
            here ? <MicCheck state={state} /> : <p className="her-muted">身体连上之后才能用麦克风。</p>)}
          {card('voices', '外接语音', state.character.voice.id.startsWith('ext:') ? `她在用外接的声音（${state.character.voice.id.split(':')[1]}）` : '讯飞、OpenAI 兼容、GPT-SoVITS、别的插件', state.character.voice.id.startsWith('ext:') ? 'ok' : 'off',
            <VoiceServices state={state} apply={apply} />)}
          {card('initiative', '主动说话', initiativeText(state), state.initiative.settings.on ? 'ok' : 'off', <InitiativeCard state={state} apply={apply} />)}
          {card('talk', '对话', `${state.talk.segment?.title ?? '还没有'}${state.talk.size === undefined ? '' : ` · ${state.talk.size}`}`, 'ok', <TalkCard state={state} apply={apply} />)}
        </>
      )}

      {page === 'her' && (
        <>
          {card('persona', '人设', `${c.name}，叫你「${c.callYou || '（没设）'}」`, 'ok', <PersonaEditor state={state} apply={apply} />)}
          {card('voice', '声音', `${voiceLabel(state, c.voice.id)} · ${SERVICE_SHORT[serviceOf(c.voice.id)]} · ${speakingText(speaking, state.voice.speaking.service)}`, toneOf(speaking),
            <VoicePicker state={state} apply={apply} saveLabel="用这个声音" />)}
          {card('memory', '她记得的事', `${state.memory.facts.length} 件关于你的事 · ${state.memory.episodes.length} 个事件 · ${state.memory.diary.length} 天日记`, 'ok',
            <div className="her-nested"><MemoryView state={state} apply={apply} /></div>)}
        </>
      )}

      {page === 'stage' && (
        <>
          <StageEditor />
          <h3 className="her-sub">原来的外形设置（"让她按这份编排来"关着时，她按这里的来）</h3>
          {card('look', '外形', here ? `${pack?.name ?? '还没有外形'}${body.look === undefined ? '' : ` · ${body.look.scenes.length} 个场景`}` : '身体没连上', here ? (pack === undefined ? 'warn' : 'ok') : 'off',
            <><PackPicker state={state} apply={apply} /><ScenePicker state={state} apply={apply} /></>)}
          {card('clips', '画面', '每一段视频用在哪里', 'ok', <ClipsCard />)}
          <Workshop state={state} apply={apply} />
        </>
      )}
    </>
  )
}

/** What she is set to right now, each with a way to change it. */
function NowCard({ state, onChange }: { state: StateView; onChange: (section: Section) => void }) {
  const c = state.character
  const body = state.body
  const here = body.connected || body.web.connected
  const pack = body.packs.find(p => p.packId === body.activePack)
  const scene = body.look?.scenes.find(s => s.id === body.look?.current)
  const onDesk = body.mode === 'overlay' && body.look?.desk === true
  const row = (label: string, value: string, section: Section) => (
    <div className="her-row" style={{ margin: '4px 0' }}>
      <span className="her-muted" style={{ width: 72, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{value}</span>
      <button className="her-btn small" onClick={() => onChange(section)}>改</button>
    </div>
  )
  return (
    <div className="her-card">
      <h2>现在的她</h2>
      {row('人物', `${c.name}，叫你「${c.callYou || '（没设）'}」`, 'persona')}
      {row('形象', !here ? '身体没连上' : pack?.name ?? '还没有形象：到"编排"选一个或做一个', 'look')}
      {body.look !== undefined && row('场景', onDesk ? '桌宠（浮在最上层时用）' : `${scene?.name ?? '—'}${body.look.locked ? '（锁定）' : body.look.auto && body.look.scenes.length > 1 ? '（自动换）' : ''}`, 'look')}
      {row('放在哪里', desktopHere(body) ? (body.mode === undefined ? '—' : MODE_TEXT[body.mode]?.title ?? body.mode) : body.web.connected ? `dsh 网页里 · ${body.web.place === 'pet' ? '桌宠' : body.web.scope === 'page' ? '整个页面的背景' : '对话窗口的背景'}` : '身体没连上', 'place')}
      {row('声音', `${voiceLabel(state, c.voice.id)} · ${SERVICE_SHORT[serviceOf(c.voice.id)]}${c.voice.speed === 1 ? '' : ` · 语速 ${c.voice.speed}`}`, 'voice')}
      {row('模型', state.model === null ? '没有可用的模型' : `${state.model.provider} / ${state.model.model}`, 'model')}
      {row('主动说话', initiativeText(state), 'initiative')}
      {row('对话', `${state.talk.segment?.title ?? '还没有'}${state.talk.size === undefined ? '' : ` · ${state.talk.size}`}`, 'talk')}
    </div>
  )
}

function initiativeText(state: StateView): string {
  const { settings, focus } = state.initiative
  if (!settings.on) return '关着'
  return focus.on ? '专注中' : `每天最多 ${settings.perDay} 次`
}

function toneOf(status: string): 'ok' | 'warn' | 'bad' | 'off' {
  if (status === 'ready') return 'ok'
  if (status === 'off') return 'off'
  if (status === 'no-key' || status === 'no-quota' || status === 'failed') return 'bad'
  return 'warn'
}

function speakingText(status: string, service: string): string {
  const name = service === 'edge' ? '微软 Edge' : service === 'ming' ? '本机 Ming' : '阿里云百炼'
  switch (status) {
    case 'ready': return `已就绪（${name}）`
    case 'checking': return service === 'ming' ? '正在加载本机 Ming（约 8 秒）' : `正在连接${name}`
    case 'installing': return service === 'ming' ? '正在安装本机 Ming（在「声音」里看进度）' : '正在准备 Edge 语音组件（第一次用，一两分钟）'
    case 'no-key': return '还没有百炼的 API key，现在只用文字回答'
    case 'no-quota': return '百炼的额度用完了，现在只用文字回答'
    case 'failed': return service === 'ming' ? '本机 Ming 用不了，暂时只用文字（在「声音」里看原因、重启）' : `${name}的语音出错了，暂时只用文字（会自动重试）`
    case 'off': return '已关闭，只用文字'
    default: return status
  }
}

function listeningText(status: string): string {
  switch (status) {
    case 'ready': return '已就绪（本地识别）'
    case 'downloading': return '正在下载识别模型（约 170 MB，只下一次）'
    case 'loading': return '正在加载'
    case 'failed': return '出错了，暂时只能打字'
    default: return status
  }
}

