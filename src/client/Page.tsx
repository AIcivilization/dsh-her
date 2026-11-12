/**
 * The "她" page. Until she is set up it shows the seven-step wizard; after
 * that, the management page. It polls the brain every two seconds (the body
 * connecting, an import running, a sentence heard all show up on their own),
 * and every change shows the state the brain answers with.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { desktopHere, desktopOffered, herApi, remotePage, type StateView } from './api.ts'
import { serviceOf } from '../core/voices.ts'
import { UpdateBar } from './UpdateBar.tsx'
import { Workshop } from './Workshop.tsx'
import { Icon } from './icons.tsx'
import { ClipsCard } from './ClipsCard.tsx'
import { StageEditor } from './StageEditor.tsx'
import { SkinCard } from './SkinCard.tsx'
import { Showcase, SheetCard } from './Showcase.tsx'
import { VoiceServices } from './VoiceServices.tsx'
import { CharacterStrip, onChanging, switchCharacter, type Changing } from './Characters.tsx'
import { PlacesCard } from './Places.tsx'
import { MaterialGuide } from './MaterialGuide.tsx'
import { onPageRequest, takePage } from './open-page.ts'
import type { SettingsPage } from '../protocol/index.ts'
import { SERVICE_SHORT, voiceLabel } from './choice.tsx'
import { BodyStatus, Dot, InitiativeCard, KeyHelp, TalkCard, MemoryView, MicCheck, ModelPicker, MODE_TEXT, ModePicker, PackPicker, PersonaEditor, platformName, ScenePicker, VoicePicker, WebModePicker, WebPlaceCard, type Apply } from './parts.tsx'

const POLL_MS = 2000

export function HerPage() {
  const [state, setState] = useState<StateView>()
  const [error, setError] = useState<string>()
  const [wizard, setWizard] = useState<boolean>()

  // Another character was chosen: the brain is away for a moment, then comes back as her.
  const [changing, setChanging] = useState<Changing>()
  const changingRef = useRef<Changing>()
  useEffect(() => onChanging(next => {
    changingRef.current = next
    setChanging(next)
  }), [])

  const refresh = useCallback(async () => {
    const result = await herApi.state()
    const waiting = changingRef.current
    if (result.ok) {
      setState(result.state)
      setError(undefined)
      if (waiting !== undefined && (result.state.cid === waiting.cid || Date.now() - waiting.at > 20_000)) {
        changingRef.current = undefined
        setChanging(undefined)
      }
    } else if (waiting === undefined || Date.now() - waiting.at > 20_000) {
      changingRef.current = undefined
      setChanging(undefined)
      setError(result.message)
    }
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
      {changing !== undefined && <div className="her-changing" role="status"><i />正在换成 <b>{changing.name}</b>：她的声音、形象和记忆一起换过来，几秒就好。</div>}
      {state.off && (
        <div className="her-banner off">
          <Icon name="power" />
          <span><b>她关着。</b>桌面上、网页里都不显示，不听麦克风，不说话，也不会先开口。你在 dsh 里打字给她，她还是会用文字回。</span>
          <button className="her-btn primary" onClick={() => void apply(herApi.setOff(false))}>叫她出来</button>
        </div>
      )}
      {showWizard
        ? <div className="her-wizard"><Wizard state={state} apply={apply} onDone={() => setWizard(false)} /></div>
        : <Manage key={state.cid} state={state} apply={apply} onWizard={() => setWizard(true)} />}
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
          <button key={name} className={`her-step ${i === step ? 'on' : i < step ? 'done' : ''}`} aria-label={`${i + 1}. ${name}`} aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}><i>{i < step ? <Icon name="check" size={12} /> : i + 1}</i>{name}</button>
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
          {nav(ready, ready ? undefined : '也可以先跳过，之后在「住在哪儿」里再连')}
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
          <p className="her-muted">随时可以在「住在哪儿」里改。</p>
          {offered && <ModePicker state={state} apply={apply} />}
          {offered && !body.connected && <p className="her-muted">桌面程序连上之后才能切换这几种。</p>}
          <WebModePicker state={state} apply={apply} />
          {nav(true)}
        </div>
      )}
    </>
  )
}

/**
 * Her settings, the way system settings are laid out everywhere: who she is
 * on top, a list on the left in four groups, one thing on the right at a
 * time. Nothing folds; what needs doing shows on 总览 and as a dot in the list.
 */
type Section = 'home' | 'persona' | 'voice' | 'memory' | 'look' | 'stage' | 'library' | 'guide' | 'skin' | 'workshop' | 'speak' | 'initiative' | 'talk' | 'model' | 'body' | 'voices' | 'about'
type Tone = 'ok' | 'warn' | 'bad' | 'off'

const GROUPS: Array<{ title?: string; items: Array<{ id: Section; label: string; icon: string }> }> = [
  { items: [{ id: 'home', label: '总览', icon: 'home' }] },
  { title: '她', items: [{ id: 'persona', label: '人设', icon: 'persona' }, { id: 'voice', label: '声音', icon: 'voice' }, { id: 'memory', label: '记忆', icon: 'memory' }] },
  { title: '外观', items: [{ id: 'look', label: '形象', icon: 'look' }, { id: 'stage', label: '编排', icon: 'stage' }, { id: 'library', label: '素材库', icon: 'library' }, { id: 'guide', label: '素材指南', icon: 'guide' }, { id: 'skin', label: '皮肤', icon: 'skin' }, { id: 'workshop', label: '形象工坊', icon: 'workshop' }] },
  { title: '相处', items: [{ id: 'speak', label: '说话和聆听', icon: 'speak' }, { id: 'initiative', label: '主动说话', icon: 'initiative' }, { id: 'talk', label: '对话', icon: 'talk' }] },
  { title: '系统', items: [{ id: 'model', label: '模型', icon: 'model' }, { id: 'body', label: '住在哪儿', icon: 'body' }, { id: 'voices', label: '外接语音', icon: 'voices' }, { id: 'about', label: '关于', icon: 'about' }] },
]

/** What each page is for, in one line under its title. */
const ABOUT: Record<Section, string> = {
  home: '',
  persona: '可以设好几个人物，想用哪个点哪个。下面是现在这位：叫什么、是谁、怎么说话、怎么称呼你。',
  voice: '她用哪个声音说话、说多快。',
  memory: '她记得的关于你的事。聊天时她会自己记；这里可以确认、让她忘掉。',
  look: '她长什么样：选一个现成的形象，或者导入你自己做的。',
  stage: '什么时候显示什么：一行一类东西，一列一个场景。',
  library: '编排用的图片、视频和 SVG 都放在这里，还有她的三视图。',
  guide: '要做哪些图和视频、多大、有什么要求，每一样都有能直接复制的提示词。',
  skin: '换整个 dsh 的样子，和她出场时播的开机动画。',
  workshop: '从头做一个自己的形象：照着每一步准备图片和视频，再导入。',
  speak: '怎么叫她、怎么跟她说话，还有麦克风好不好用。',
  initiative: '她什么时候可以先开口，什么时候不要打扰你。',
  talk: '你们的对话存在哪儿、什么时候新开一段。',
  model: '她的大脑用哪个模型。',
  body: '她住在桌面上，还是住在 dsh 的网页里。',
  voices: '接讯飞、OpenAI 兼容的服务、你自己的 GPT-SoVITS，或别的 dsh 插件。',
  about: '版本、更新，和重新走一遍向导。',
}

/** The pages that are one character's own (the others are shared by all of them). */
const OWN = new Set<Section>(['voice', 'memory', 'look', 'stage', 'initiative', 'talk', 'model'])

/** "设置…" on the body's menu names one of the four old pages: where each lands now. */
const FROM_MENU: Record<SettingsPage, Section> = { home: 'home', engine: 'model', her: 'persona', stage: 'stage' }

/** The page open now: kept when the whole page starts over for another character. */
let lastSection: Section = 'home'

function Manage({ state, apply, onWizard }: { state: StateView; apply: Apply; onWizard: () => void }) {
  const [section, setSectionState] = useState<Section>(() => {
    const asked = takePage()
    return asked === undefined ? lastSection : FROM_MENU[asked]
  })
  const setSection = (next: Section) => {
    lastSection = next
    setSectionState(next)
  }
  // "设置…" on the desktop body's menu.
  useEffect(() => onPageRequest(() => {
    const asked = takePage()
    if (asked !== undefined) setSection(FROM_MENU[asked])
  }), [])
  const go = (next: Section) => {
    setSection(next)
    document.querySelector('.her-page')?.scrollTo({ top: 0 })
  }
  const c = state.character
  const body = state.body
  const here = desktopHere(body) || body.web.connected
  const speaking = state.voice.speaking.status
  const pack = body.packs.find(p => p.packId === body.activePack)
  const tucked = tuckedAway(state)

  /** A dot in the list where something wants attention. */
  const dots: Partial<Record<Section, Tone>> = {
    ...(state.model === null || state.problem !== undefined ? { model: 'bad' as const } : {}),
    ...(speaking === 'no-key' || speaking === 'no-quota' || speaking === 'failed' ? { voice: 'bad' as const } : {}),
    ...(!here && !state.off && !tucked ? { body: 'warn' as const } : {}),
    ...(here && pack === undefined ? { look: 'warn' as const } : {}),
    ...(state.voice.status === 'failed' ? { speak: 'warn' as const } : {}),
  }
  const title = GROUPS.flatMap(g => g.items).find(i => i.id === section)!

  return (
    <div className="her-shell">
      <Hero state={state} apply={apply} />
      <div className="her-layout">
        <nav className="her-nav" aria-label="她的设置">
          {GROUPS.map((group, i) => (
            <div key={i} className="her-nav-group">
              {group.title !== undefined && <div className="her-nav-title">{group.title}</div>}
              {group.items.map(item => (
                <button key={item.id} className={`her-nav-item${section === item.id ? ' on' : ''}`} aria-current={section === item.id ? 'page' : undefined} onClick={() => go(item.id)}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {dots[item.id] !== undefined && <i className={`her-dot ${dots[item.id]}`} />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <main className="her-main">
          {section !== 'home' && (
            <header className="her-title">
              <h1>{title.label}{state.characters.length > 1 && OWN.has(section) && <span className="her-title-who">{c.name} 的</span>}</h1>
              <p>{ABOUT[section]}</p>
            </header>
          )}

          {section === 'home' && <Home state={state} apply={apply} go={go} />}

          {section === 'persona' && (
            <>
              <CharacterStrip state={state} apply={apply} />
              <Card title={`${c.name} 的人设`}><PersonaEditor state={state} apply={apply} /></Card>
            </>
          )}
          {section === 'voice' && (
            <>
              <Card><VoicePicker state={state} apply={apply} saveLabel="用这个声音" /></Card>
              <LinkRow icon="voices" title="想用别家的声音？" text="讯飞、OpenAI 兼容的服务、GPT-SoVITS 或别的插件，在「外接语音」里接。" onClick={() => go('voices')} />
            </>
          )}
          {section === 'memory' && <MemoryView state={state} apply={apply} />}

          {section === 'look' && (
            <>
              {state.stagePlaying && <Banner tone="ok" text="她现在按「编排」来。这里选的形象，在关掉编排以后才用。" action="去编排" onClick={() => go('stage')} />}
              <Card title="选一个形象"><PackPicker state={state} apply={apply} /></Card>
              {body.look !== undefined && <Card title="场景"><ScenePicker state={state} apply={apply} /></Card>}
              <Card title="每段画面用在哪里" fold><ClipsCard /></Card>
              <LinkRow icon="workshop" title="想要一个自己的形象？" text="形象工坊带你一步步准备图片和视频，再导入。" onClick={() => go('workshop')} />
            </>
          )}
          {section === 'stage' && <StageEditor part="table" onLibrary={() => go('library')} />}
          {section === 'library' && <StageEditor part="library" onGuide={() => go('guide')} {...(state.sheet?.chosen === true ? { sheet: state.sheet.name } : {})} onSheet={name => void apply(herApi.sheetSet(name))} />}
          {section === 'guide' && <MaterialGuide cid={state.cid} onLibrary={() => go('library')} onSkin={() => go('skin')} />}
          {section === 'skin' && <SkinCard />}
          {section === 'workshop' && <Workshop state={state} apply={apply} />}

          {section === 'speak' && (
            <>
              <Card title="怎么跟她说话">
                <ul className="her-ways">
                  <li><Keys keys={state.platform === 'darwin' ? ['⌃', '⌥', '↩'] : ['Ctrl', 'Alt', 'Enter']} /><div><b>对话小条</b><span>在哪儿都能叫出来：打字，或按住 🎙 说。双击她、点 dsh 对话框上她的小头像也行。</span></div></li>
                  <li><Keys keys={state.platform === 'darwin' ? ['⌃', '⌥', '空格'] : ['Ctrl', 'Alt', '空格']} /><div><b>说一句</b><span>按一下开始说，说完自动发出去。她说话时你开口，就能打断她。</span></div></li>
                  <li><Keys keys={[state.platform === 'darwin' ? '右 ⌥' : '右 Alt']} /><div><b>按住说话</b><span>小条打开时按住就能说；鼠标移到她身上，脚边的话筒按住也能说。</span></div></li>
                  <li><span className="her-keys"><kbd>右键她</kbd></span><div><b>一直在听</b><span>在她的右键菜单里勾上，戴耳机长聊时用。</span></div></li>
                </ul>
                {desktopOffered(body) && (
                  <div className="her-setrow">
                    <div><b>在任何程序里按住{state.platform === 'darwin' ? '右边的 Option' : '右 Alt'} 说话</b><span>不用先叫出小条。{state.platform === 'darwin' ? '第一次打开，macOS 会让你在"隐私与安全性 → 辅助功能"里允许 dsh-her；她只听这一个键。' : '她只听这一个键。'}{body.connected ? '' : '桌面程序连上后生效。'}</span></div>
                    <input type="checkbox" aria-label="在任何程序里按住说话" checked={state.places.holdKey} onChange={e => void apply(herApi.places({ holdKey: e.target.checked }))} />
                  </div>
                )}
              </Card>
              <Card title="她在哪儿回答">
                <ul className="her-ways">
                  <li><span className="her-keys"><kbd>说话</kbd></span><div><b>在她头顶回答</b><span>用快捷键、按住话筒或"一直在听"说的话，她出声回答，字幕在头顶的气泡里，上面一小行是她听到的。</span></div></li>
                  <li><span className="her-keys"><kbd>打字</kbd></span><div><b>在小条里回答</b><span>小条开着的时候，对话都在小条里（她照样出声），头顶不再重复显示。关掉小条，回到头顶。</span></div></li>
                  <li><span className="her-keys"><kbd>她先开口</kbd></span><div><b>在她头顶</b><span>她自己想说的、被你碰到时说的，都在头顶。看完整的对话：小条里点"完整对话"。</span></div></li>
                </ul>
              </Card>
              <Card title="听你说话" badge={<><Dot tone={toneOf(state.voice.status)} />{listeningText(state.voice.status)}</>}>
                {here ? <MicCheck state={state} /> : <p className="her-muted">身体连上之后才能用麦克风。</p>}
              </Card>
              <LinkRow icon="voices" title="换一家来听" text="讯飞听写、OpenAI 兼容的识别，在「外接语音」里选。" onClick={() => go('voices')} />
            </>
          )}
          {section === 'initiative' && <InitiativeCard state={state} apply={apply} />}
          {section === 'talk' && <TalkCard state={state} apply={apply} />}

          {section === 'model' && (
            <>
              {state.problem !== undefined && <Banner tone="bad" text={`她刚才没能回答：${state.problem.text}`} />}
              <Card><ModelPicker state={state} apply={apply} /></Card>
            </>
          )}
          {section === 'body' && (
            <>
              <Card title="桌面程序" badge={<><Dot tone={here ? 'ok' : body.running ? 'warn' : 'off'} />{desktopHere(body) ? '已连上' : body.web.connected ? '她在网页里' : body.running ? '正在连' : '没连上'}</>}>
                <BodyStatus state={state} apply={apply} />
              </Card>
              <PlacesCard state={state} apply={apply} />
              <WebPlaceCard state={state} apply={apply} />
            </>
          )}
          {section === 'voices' && <Card><VoiceServices state={state} apply={apply} /></Card>}
          {section === 'about' && (
            <>
              <Card title="版本和更新"><UpdateBar state={state} apply={apply} /></Card>
              <Card title="重新设置">
                <div className="her-setrow">
                  <div><b>重新走一遍向导</b><span>七步：检查、身体、外形、人设、声音、麦克风、放在哪里。现有的设置都留着。</span></div>
                  <button className="her-btn" onClick={onWizard}>打开向导</button>
                </div>
              </Card>
              <Card title="她的东西放在哪儿">
                <p className="her-muted">人设、记忆、对话、素材、皮肤都在这台电脑上的 <code>~/.dsh-her</code>，不上传。key 在系统钥匙串里。</p>
                <p className="her-muted">跑在 {platformName(state.platform)} 上{remotePage ? '，你是从别的设备打开这个网页的' : ''}。</p>
                <div className="her-row">
                  <a className="her-btn" href="https://github.com/AIcivilization/dsh-her#readme" target="_blank" rel="noreferrer">使用说明</a>
                  <a className="her-btn" href="https://github.com/AIcivilization/dsh-her/blob/main/docs/素材规格与提示词.md" target="_blank" rel="noreferrer">素材规格</a>
                  <a className="her-btn" href="https://github.com/AIcivilization/dsh-her/issues" target="_blank" rel="noreferrer">反馈问题</a>
                </div>
              </Card>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/** You put her away in this browser yourself (the switch on 总览): not a fault, so no warning. */
const tuckedAway = (state: StateView) => !desktopHere(state.body) && !state.body.web.connected && window.__herFloat?.hidden() === true

/** Who she is and how she is, always on top: her picture, name, one line of state, and the switch. */
function Hero({ state, apply }: { state: StateView; apply: Apply }) {
  const body = state.body
  const avatar = body.web.avatar
  const where: { tone: Tone; text: string } = state.off
    ? { tone: 'off', text: '关着：不显示、不听、不说话' }
    : desktopHere(body) ? { tone: 'ok', text: `在桌面上 · ${body.mode === undefined ? '' : MODE_TEXT[body.mode]?.title ?? body.mode}` }
    : body.web.connected ? { tone: 'ok', text: `在 dsh 网页里 · ${body.web.place === 'pet' ? '桌宠' : '背景'}` }
    : body.running ? { tone: 'warn', text: '桌面程序正在连…' }
    : tuckedAway(state) ? { tone: 'off', text: '在这个网页里收起来了' }
    : { tone: 'warn', text: '身体没连上' }
  const c = state.character
  return (
    <header className={`her-hero${state.off ? ' off' : ''}`}>
      <div className="her-hero-ava">
        {avatar?.videoUrl !== undefined ? <video src={avatar.videoUrl} muted loop autoPlay playsInline />
          : avatar !== undefined && avatar.url !== '' ? <img src={avatar.url} alt="" />
          : <span>{[...c.name][0] ?? '她'}</span>}
      </div>
      <div className="her-hero-text">
        <h1>
          <span className="her-hero-name">{c.name}</span>
          {state.characters.length > 1 && (
            <select className="her-hero-who" aria-label="换一个人物" title="换一个人物" value={state.cid} onChange={e => {
              const next = state.characters.find(p => p.cid === e.target.value)
              if (next !== undefined && next.cid !== state.cid) void switchCharacter(next.cid, next.name)
            }}>
              {state.characters.map(p => <option key={p.cid} value={p.cid}>{p.cid === state.cid ? `换人物（${state.characters.length}）` : p.name}</option>)}
            </select>
          )}
        </h1>
        <p><Dot tone={where.tone} />{where.text}{state.initiative.focus.on && !state.off ? ' · 专注中' : ''}</p>
      </div>
      <label className="her-power" title={state.off ? '叫她出来' : '关掉她：桌面上、网页里都收起来，不听、不说话；重启后也还关着'}>
        <span>{state.off ? '关着' : '她在'}</span>
        <input type="checkbox" checked={!state.off} onChange={e => void apply(herApi.setOff(!e.target.checked))} />
      </label>
    </header>
  )
}

/** 总览: what needs doing, where she is, a few things at hand, and everything she is set to. */
function Home({ state, apply, go }: { state: StateView; apply: Apply; go: (section: Section) => void }) {
  const [said, setSaid] = useState<string>()
  const [, redraw] = useState(0)
  useEffect(() => {
    const again = () => redraw(n => n + 1)
    window.addEventListener('dsh-her:float', again)
    return () => window.removeEventListener('dsh-her:float', again)
  }, [])
  const c = state.character
  const body = state.body
  const here = desktopHere(body) || body.web.connected
  const pack = body.packs.find(p => p.packId === body.activePack)
  const speaking = state.voice.speaking.status
  const float = window.__herFloat
  const todo: Array<{ tone: Tone; text: string; action: string; to: Section }> = [
    ...(state.model === null ? [{ tone: 'bad' as const, text: 'dsh 还没有可用的模型，她没法回答。', action: '选模型', to: 'model' as const }] : []),
    ...(state.problem !== undefined ? [{ tone: 'bad' as const, text: `她刚才没能回答：${state.problem.text}`, action: '换模型', to: 'model' as const }] : []),
    ...(!here && !state.off && !tuckedAway(state) ? [{ tone: 'warn' as const, text: '她的身体没连上，现在看不到她。', action: '去看看', to: 'body' as const }] : []),
    ...(here && pack === undefined ? [{ tone: 'warn' as const, text: '她还没有形象。', action: '选一个', to: 'look' as const }] : []),
    ...(speaking === 'no-key' || speaking === 'no-quota' || speaking === 'failed' ? [{ tone: 'bad' as const, text: `她的声音：${speakingText(speaking, state.voice.speaking.service)}`, action: '看声音', to: 'voice' as const }] : []),
    ...(state.voice.status === 'failed' ? [{ tone: 'warn' as const, text: '听你说话出错了，暂时只能打字。', action: '去看看', to: 'speak' as const }] : []),
    ...(here && !state.off && body.web.avatar === undefined ? [{ tone: 'off' as const, text: '她还没有小头像（dsh 对话框上的那个）。', action: '去素材库', to: 'library' as const }] : []),
  ]
  const focus = state.initiative.focus.on
  const tiles: Array<{ icon: string; label: string; value: string; to: Section }> = [
    { icon: 'persona', label: '人设', value: `${c.name}，叫你「${c.callYou || '（没设）'}」`, to: 'persona' },
    { icon: 'voice', label: '声音', value: `${voiceLabel(state, c.voice.id)} · ${SERVICE_SHORT[serviceOf(c.voice.id)]}`, to: 'voice' },
    { icon: 'look', label: '形象', value: !here ? '身体没连上' : pack?.name ?? '还没有', to: 'look' },
    { icon: 'stage', label: '编排', value: state.stagePlaying ? '她按编排来' : '没开', to: 'stage' },
    { icon: 'skin', label: '皮肤', value: state.skin ?? 'dsh 原样', to: 'skin' },
    { icon: 'body', label: '住在哪儿', value: desktopHere(body) ? (body.mode === undefined ? '桌面上' : MODE_TEXT[body.mode]?.title ?? body.mode) : body.web.connected ? 'dsh 网页里' : '没连上', to: 'body' },
    { icon: 'initiative', label: '主动说话', value: initiativeText(state), to: 'initiative' },
    { icon: 'talk', label: '对话', value: `${state.talk.segment?.title ?? '还没有'}${state.talk.size === undefined ? '' : ` · ${state.talk.size}`}`, to: 'talk' },
    { icon: 'model', label: '模型', value: state.model === null ? '没有可用的' : state.model.model, to: 'model' },
  ]
  return (
    <>
      <UpdateBar state={state} apply={apply} />
      {todo.length > 0 && (
        <section className={`her-card${todo.some(item => item.tone !== 'off') ? ' her-todo' : ''}`}>
          <h2>{todo.some(item => item.tone !== 'off') ? '要处理的事' : '还可以做的事'}</h2>
          {todo.map(item => (
            <div key={item.text} className="her-todo-row">
              <Dot tone={item.tone} />
              <span>{item.text}</span>
              <button className="her-btn small" onClick={() => go(item.to)}>{item.action}</button>
            </div>
          ))}
        </section>
      )}
      <Showcase state={state} onGo={go} />
      <SheetCard state={state} onGo={go} />
      <div>
        <section className="her-card her-quick">
          <h2>顺手的事</h2>
          <div className="her-setrow">
            <div><b>专注一会儿</b><span>2 小时里她不先开口；你找她不受影响。</span></div>
            <input type="checkbox" checked={focus} disabled={state.off} onChange={e => void apply(herApi.initiativeSet({ focus: e.target.checked ? 'span' : 'off' }))} />
          </div>
          {float !== undefined && (
            <div className="her-setrow">
              <div><b>在这个网页里显示她</b><span>只影响这个浏览器。</span></div>
              <input type="checkbox" checked={!float.hidden()} disabled={state.off} onChange={e => float.setHidden(!e.target.checked)} />
            </div>
          )}
          <div className="her-setrow">
            <div><b>让她现在说一句</b><span>{said ?? '看看她的声音和主动说话好不好用。'}</span></div>
            <button className="her-btn" disabled={state.off} onClick={() => void herApi.initiativeTry().then(r => setSaid(r.ok ? `她说：「${r.said}」` : r.message))}>说一句</button>
          </div>
          {state.heard !== undefined && <p className="her-faint">最近听到：「{state.heard.text}」</p>}
        </section>
      </div>
      <section className="her-card">
        <h2>现在的设置</h2>
        <div className="her-tiles">
          {tiles.map(tile => (
            <button key={tile.label} className="her-tile" onClick={() => go(tile.to)}>
              <Icon name={tile.icon} />
              <span className="her-tile-label">{tile.label}</span>
              <span className="her-tile-value">{tile.value}</span>
            </button>
          ))}
        </div>
        <p className="her-faint">记得 {state.memory.facts.length} 件关于你的事、{state.memory.episodes.length} 个事件，写了 {state.memory.diary.length} 天日记。</p>
      </section>
    </>
  )
}

/** A card with an optional title, a small note on the right of it, or folded away until asked for. */
function Card({ title, badge, fold = false, children }: { title?: string; badge?: ReactNode; fold?: boolean; children: ReactNode }) {
  if (fold) {
    return (
      <details className="her-card her-details">
        <summary><h2>{title}</h2><Icon name="arrow" size={16} /></summary>
        <div className="her-details-body">{children}</div>
      </details>
    )
  }
  return (
    <section className="her-card">
      {title !== undefined && <div className="her-card-head"><h2>{title}</h2>{badge !== undefined && <span className="her-card-badge">{badge}</span>}</div>}
      {children}
    </section>
  )
}

function Banner({ tone, text, action, onClick }: { tone: Tone; text: string; action?: string; onClick?: () => void }) {
  return (
    <div className={`her-banner ${tone}`}>
      <Icon name={tone === 'ok' ? 'check' : 'alert'} />
      <span>{text}</span>
      {action !== undefined && <button className="her-btn small" onClick={onClick}>{action}</button>}
    </div>
  )
}

/** A way on to a related page. */
function LinkRow({ icon, title, text, onClick }: { icon: string; title: string; text: string; onClick: () => void }) {
  return (
    <button className="her-linkrow" onClick={onClick}>
      <Icon name={icon} />
      <span><b>{title}</b><small>{text}</small></span>
      <Icon name="arrow" size={16} />
    </button>
  )
}

function Keys({ keys }: { keys: string[] }) {
  return <span className="her-keys">{keys.map(k => <kbd key={k}>{k}</kbd>)}</span>
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

