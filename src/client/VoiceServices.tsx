/**
 * 外接的语音服务, on the 声音 page (docs/设置页与编排设计.md §7, §20): 讯飞, an OpenAI-style
 * service, a GPT-SoVITS server of your own, or another dsh plugin's voice.
 * Keys go to the keychain (or a file only you can read) and are never shown
 * again; the page only knows whether one is set.
 */

import { useEffect, useState } from 'react'
import { herApi, type StateView, type VoicesView } from './api.ts'
import type { Apply } from './parts.tsx'
import type { ProviderConfig, ProviderKind } from '../voice/external.ts'

const KIND: Record<ProviderKind, string> = { xfyun: '讯飞', openai: 'OpenAI 兼容', sovits: 'GPT-SoVITS', plugin: '别的 dsh 插件' }
const SECRET: Record<ProviderKind, string[]> = { xfyun: ['apiKey', 'apiSecret'], openai: ['apiKey'], sovits: [], plugin: [] }
const FIELDS: Record<ProviderKind, Array<[keyof ProviderConfig, string, string]>> = {
  xfyun: [['appId', 'APPID', '讯飞控制台里的 APPID']],
  openai: [['baseUrl', '地址', 'https://api.openai.com/v1，或本地的 http://127.0.0.1:8000/v1'], ['model', '合成模型', 'tts-1'], ['asrModel', '识别模型', 'whisper-1']],
  sovits: [['baseUrl', '地址', 'http://127.0.0.1:9880'], ['refAudio', '参考音频（服务器上的路径）', '/path/参考.wav'], ['promptText', '参考音频里说的话', ''], ['promptLang', '参考语言', 'zh']],
  plugin: [],
}
const VOICE_HINT: Record<ProviderKind, string> = { xfyun: '发音人，比如 xiaoyan、aisjiuxu', openai: '音色，比如 alloy、nova', sovits: '（用参考音频，不用填）', plugin: '插件提供的音色' }

export function VoiceServices({ state, apply }: { state: StateView; apply: Apply }) {
  const [view, setView] = useState<VoicesView>()
  const [draft, setDraft] = useState<ProviderConfig[]>([])
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [voiceOf, setVoiceOf] = useState<Record<string, string>>({})
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string }>()
  const take = (result: Awaited<ReturnType<typeof herApi.voicesGet>>, text?: string) => {
    if (!result.ok) return setNote({ kind: 'error', text: result.message })
    setView(result)
    setDraft(result.providers.map(p => ({ ...p })))
    if (text !== undefined) setNote({ kind: 'ok', text })
  }
  useEffect(() => { void herApi.voicesGet().then(r => take(r)) }, [])
  if (view === undefined) return <p className="her-muted">正在读…</p>

  const save = async (providers = draft, listen = view.listen) => take(await herApi.voicesSave({ providers, ...(listen === undefined ? {} : { listen }) }), '已保存。')
  const add = (kind: ProviderKind) => {
    const id = `${kind}${draft.filter(p => p.kind === kind).length + 1}`
    setDraft([...draft, { id, kind, name: KIND[kind] }])
  }
  const voiceId = (p: ProviderConfig) => `ext:${p.id}:${(voiceOf[p.id] ?? '').trim()}`
  const test = async (p: ProviderConfig) => {
    setNote({ kind: 'ok', text: `${p.name}：正在试…` })
    const result = await herApi.voicesTest(voiceId(p))
    if (!result.ok) return setNote({ kind: 'error', text: result.message })
    setNote({ kind: 'ok', text: `${p.name}：${result.ms} 毫秒合成好，${(result.durationMs / 1000).toFixed(1)} 秒` })
    void new Audio(`data:audio/${result.format};base64,${result.audio}`).play().catch(() => {})
  }
  const use = async (p: ProviderConfig) => {
    if (await apply(herApi.saveCharacter({ voice: voiceId(p), speed: state.character.voice.speed }))) setNote({ kind: 'ok', text: `她现在用 ${p.name} 的声音。储备台词还是原来的音色。` })
  }
  const all: ProviderConfig[] = [...draft, ...view.plugins.filter(pl => !draft.some(d => d.id === pl.provider)).map((pl): ProviderConfig => ({ id: pl.provider, kind: 'plugin', name: `插件 ${pl.provider}` }))]

  return (
    <div>
      <p className="her-muted">接你自己的语音服务。她的口型和动作只看声音多长，换哪家都行。key 存进系统钥匙串（Mac）或只有你能读的文件，填完就不再显示。</p>
      {all.map((p, i) => {
        const mine = draft.includes(p)
        const using = state.character.voice.id.startsWith(`ext:${p.id}:`)
        return (
          <div key={p.id} className="her-card her-voice-provider">
            <div className="her-row">
              <b style={{ flex: 1 }}>{p.name} <span className="her-faint">· {KIND[p.kind]}{using ? ' · 她正在用' : ''}</span></b>
              {mine && <button className="her-btn small" onClick={() => { const next = draft.filter((_, j) => j !== i); setDraft(next); void save(next, view.listen === p.id ? undefined : view.listen) }}>去掉</button>}
            </div>
            {mine && (
              <div className="her-row">
                <label className="her-muted" style={{ width: 110 }}>名字</label>
                <input className="her-input" style={{ flex: 1 }} value={p.name} onChange={e => setDraft(draft.map((d, j) => j === i ? { ...d, name: e.target.value } : d))} />
              </div>
            )}
            {mine && FIELDS[p.kind].map(([field, label, hint]) => (
              <div key={field} className="her-row">
                <label className="her-muted" style={{ width: 110 }}>{label}</label>
                <input className="her-input" style={{ flex: 1 }} placeholder={hint} value={String(p[field] ?? '')} onChange={e => setDraft(draft.map((d, j) => j === i ? { ...d, [field]: e.target.value } : d))} />
              </div>
            ))}
            {mine && SECRET[p.kind].map(field => {
              const name = `${p.id}.${field}`
              return (
                <div key={field} className="her-row">
                  <label className="her-muted" style={{ width: 110 }}>{field === 'apiKey' ? 'API Key' : field === 'apiSecret' ? 'API Secret' : field}</label>
                  <input className="her-input" style={{ flex: 1 }} type="password" autoComplete="off" placeholder={view.keys[name] === true ? '已填（要换就再填一次）' : '还没填'} value={keys[name] ?? ''} onChange={e => setKeys({ ...keys, [name]: e.target.value })} />
                  <button className="her-btn small" disabled={(keys[name] ?? '') === ''} onClick={() => void herApi.voicesSecret(p.id, field, keys[name] ?? '').then(r => { setKeys({ ...keys, [name]: '' }); take(r, '已存好。') })}>存好</button>
                </div>
              )
            })}
            <div className="her-row">
              <label className="her-muted" style={{ width: 110 }}>音色</label>
              <input className="her-input" style={{ flex: 1 }} placeholder={VOICE_HINT[p.kind]} value={voiceOf[p.id] ?? (using ? state.character.voice.id.split(':').slice(2).join(':') : '')} onChange={e => setVoiceOf({ ...voiceOf, [p.id]: e.target.value })} />
              <button className="her-btn small" onClick={() => void test(p)}>试听</button>
              <button className="her-btn small" onClick={() => void use(p)}>让她用这个</button>
            </div>
            {p.kind === 'plugin' && (view.plugins.find(pl => pl.provider === p.id)?.voices ?? []).length > 0 && (
              <p className="her-faint">这个插件的音色：{view.plugins.find(pl => pl.provider === p.id)!.voices.map(v => `${v.name}（${v.id}）`).join('、')}</p>
            )}
          </div>
        )
      })}
      <div className="her-row">
        <span className="her-muted">加一个：</span>
        {(['xfyun', 'openai', 'sovits'] as const).map(k => <button key={k} className="her-btn small" onClick={() => add(k)}>{KIND[k]}</button>)}
        <button className="her-btn primary" onClick={() => void save()}>保存</button>
      </div>
      <div className="her-row">
        <span className="her-muted">听你说话用：</span>
        <select className="her-select" style={{ width: 'auto' }} value={view.listen ?? ''} onChange={e => void save(draft, e.target.value === '' ? undefined : e.target.value)}>
          <option value="">本机识别（离线）</option>
          {all.filter(p => p.kind === 'xfyun' || p.kind === 'openai' || p.kind === 'plugin').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="her-faint">外接的出错时，自动退回本机识别。</span>
      </div>
      <p className="her-faint">别的 dsh 插件可以给她提供声音：在插件里 <code>ctx.inject(['herVoices'], c =&gt; c.herVoices.register(…))</code>，提供 synthesize（和可选的 recognize）。克隆真人的声音要本人同意。</p>
      {note !== undefined && <p className={note.kind === 'ok' ? 'her-ok' : 'her-danger'}>{note.text}</p>}
    </div>
  )
}
