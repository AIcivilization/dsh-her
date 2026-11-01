/**
 * The bar on top of the "她" page: which versions she runs, and a button to
 * update them.
 *
 * - The plugin goes through dshmarket's public update API (see its
 *   UPDATE-API-V1.md): it checks, runs pnpm, verifies what landed and reports
 *   whether a restart is needed. Without dshmarket the brain looks at npm, and
 *   the bar shows the command to run.
 * - The body updates itself through the brain (download, checksum, install);
 *   a newly installed one waits for "重启身体".
 * - A plugin linked from a repository (development) never updates here.
 */

import { useCallback, useEffect, useState } from 'react'
import { herApi, type StateView } from './api.ts'
import type { Apply } from './parts.tsx'

const MARKET = '/dsh-market/api/v1'
const NAME = 'dsh-her'

const marketUrl = (path: string) => new URL(`${MARKET}${path}`, document.baseURI).href

interface Capabilities {
  restart: { supported: boolean }
}

interface Operation {
  operationId: string
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'rolled-back'
  installedVersion: string | null
  progress: { percent?: number | null; detail?: string | null } | null
  outcome: { restartRequired: boolean; refreshRequired: boolean }
  failure: { code: string; message: string; retryable: boolean } | null
}

type Plugin =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'dev' }
  /** A newer plugin; `market`: dshmarket can install it, else the command is shown. */
  | { kind: 'available'; latest: string; market: boolean }
  | { kind: 'updating'; percent?: number; detail?: string }
  | { kind: 'done'; version: string; restart: boolean; canRestart: boolean; refresh: boolean }
  | { kind: 'failed'; message: string; force: boolean }

async function marketJson<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  try {
    const res = await fetch(marketUrl(path), init)
    if (res.status === 404 && path === '/capabilities') return undefined
    return await res.json() as T
  } catch {
    return undefined
  }
}

async function capabilities(): Promise<Capabilities | undefined> {
  return marketJson<Capabilities>('/capabilities')
}

/** What the plugin can update to; `force` asks the registry again instead of a recent answer. */
async function checkPlugin(force: boolean): Promise<Plugin> {
  if (await capabilities() !== undefined) {
    const answer = await marketJson<{ package?: { source: string; latestVersion: string | null; updateAvailable: boolean }; error?: string }>(`/updates?name=${NAME}${force ? '&force=1' : ''}`)
    const found = answer?.package
    if (found !== undefined) {
      if (found.source === 'linked') return { kind: 'dev' }
      return found.updateAvailable && found.latestVersion !== null ? { kind: 'available', latest: found.latestVersion, market: true } : { kind: 'latest' }
    }
    // A market that does not know the plugin (not installed through the profile): ask npm below.
  }
  const result = await herApi.pluginLatest()
  if (!result.ok) return { kind: 'failed', message: result.message, force: false }
  return result.updateAvailable ? { kind: 'available', latest: result.latest, market: false } : { kind: 'latest' }
}

const FAILURES: Record<string, string> = {
  AGENTS_RUNNING: '有会话正在运行，等它结束再更新。',
  OPERATION_BUSY: '另一个插件正在更新，等一下再试。',
  RELEASE_TOO_FRESH: '这个版本刚发布不久，npm 的镜像或安全等待期还没过。可以稍后再试，或者点"仍然更新"。',
  VERSION_UNCHANGED: '更新没有换到新版本（镜像可能还没同步）。可以稍后再试，或者点"仍然更新"。',
  DOWNGRADE_DETECTED: '更新后的版本反而更旧，已经退回原来的版本。',
  RESOLVED_VERSION_MISMATCH: 'npm 镜像还没同步到最新版本，已经退回原来的版本，稍后再试。',
}

export function UpdateBar({ state, apply }: { state: StateView; apply: Apply }) {
  const [plugin, setPlugin] = useState<Plugin>({ kind: 'idle' })
  const install = state.body.install
  const web = !state.body.connected && state.body.web.connected
  const bodyVersion = web ? '网页里' : install.dev ? `${state.body.info?.version ?? ''} 开发版`.trim() : state.body.info?.version ?? install.installed ?? '未安装'
  const bodyBusy = install.state === 'checking' || install.state === 'downloading' || install.state === 'installing'

  // A quiet look when the page opens (a recent answer is fine); the button asks again.
  useEffect(() => {
    let live = true
    void checkPlugin(false).then(found => {
      if (live && (found.kind === 'available' || found.kind === 'dev')) setPlugin(found)
    })
    return () => { live = false }
  }, [])

  const check = useCallback(async () => {
    setPlugin({ kind: 'checking' })
    // The body checks too, and installs a newer one in the background (not a first install: that is its own button).
    if (!install.dev && install.installed !== undefined) await apply(herApi.installBody())
    setPlugin(await checkPlugin(true))
  }, [apply, install.dev, install.installed])

  const update = useCallback(async (force: boolean) => {
    setPlugin({ kind: 'updating' })
    const started = await marketJson<{ operation?: Operation; error?: string; failure?: { code: string; message: string } }>('/updates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packageName: NAME, ...(force ? { force: true } : {}) }),
    })
    if (started?.operation === undefined) {
      setPlugin({ kind: 'failed', message: failureText(started?.failure?.code, started?.failure?.message ?? started?.error), force: false })
      return
    }
    const id = started.operation.operationId
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const answer = await marketJson<{ operation?: Operation }>(`/operations?operationId=${encodeURIComponent(id)}`)
      const operation = answer?.operation
      // The host restarted while updating: the page reloads with the new version.
      if (operation === undefined) return setPlugin({ kind: 'done', version: '', restart: false, canRestart: false, refresh: true })
      if (operation.state === 'queued' || operation.state === 'running') {
        setPlugin({ kind: 'updating', ...(operation.progress?.percent == null ? {} : { percent: operation.progress.percent }), ...(operation.progress?.detail == null ? {} : { detail: operation.progress.detail }) })
        continue
      }
      if (operation.state === 'succeeded') {
        const caps = await capabilities()
        return setPlugin({ kind: 'done', version: operation.installedVersion ?? '', restart: operation.outcome.restartRequired, canRestart: caps?.restart.supported === true, refresh: operation.outcome.refreshRequired })
      }
      const code = operation.failure?.code
      return setPlugin({ kind: 'failed', message: failureText(code, operation.failure?.message), force: code === 'RELEASE_TOO_FRESH' || code === 'VERSION_UNCHANGED' })
    }
  }, [])

  const restart = useCallback(async () => {
    await marketJson('/restart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    setPlugin({ kind: 'done', version: '', restart: false, canRestart: false, refresh: true })
  }, [])

  const busy = plugin.kind === 'checking' || plugin.kind === 'updating' || bodyBusy
  return (
    <div className="her-versions">
      <span>dsh-her <b>{state.version}{plugin.kind === 'dev' ? ' 开发版' : ''}</b></span>
      <span className="her-faint">·</span>
      <span>身体 <b>{bodyVersion}</b></span>
      <button className="her-btn small" disabled={busy} onClick={() => void check()}>{plugin.kind === 'checking' ? '正在检查…' : '检查更新'}</button>

      {plugin.kind === 'latest' && !install.restart && !bodyBusy && install.state !== 'failed' && <span className="her-ok">✓ 已是最新</span>}
      {plugin.kind === 'dev' && <span className="her-muted">插件链接到代码仓库，不用更新</span>}
      {plugin.kind === 'available' && plugin.market && (
        <>
          <span className="her-warn">插件有新版本 {plugin.latest}</span>
          <button className="her-btn small primary" onClick={() => void update(false)}>更新插件</button>
        </>
      )}
      {plugin.kind === 'available' && !plugin.market && (
        <span className="her-warn">插件有新版本 {plugin.latest}：在终端运行 <code>dsh plugin add dsh-her@latest</code>，再重启 dsh</span>
      )}
      {plugin.kind === 'updating' && (
        <span className="her-muted">正在更新插件{plugin.percent === undefined ? '…' : `（${plugin.percent}%）`}</span>
      )}
      {plugin.kind === 'done' && plugin.restart && plugin.canRestart && (
        <>
          <span className="her-ok">插件已更新到 {plugin.version}，重启 dsh 后生效</span>
          <button className="her-btn small primary" onClick={() => void restart()}>重启 dsh</button>
        </>
      )}
      {plugin.kind === 'done' && plugin.restart && !plugin.canRestart && <span className="her-ok">插件已更新到 {plugin.version}：退出并重新打开 DSH 后生效</span>}
      {plugin.kind === 'done' && !plugin.restart && <span className="her-ok">插件已更新，刷新页面后生效</span>}
      {plugin.kind === 'failed' && (
        <>
          <span className="her-danger">{plugin.message}</span>
          {plugin.force && <button className="her-btn small" onClick={() => void update(true)}>仍然更新</button>}
        </>
      )}

      {install.state === 'downloading' && <span className="her-muted">正在下载身体 {install.latest ?? ''}（{install.total ? Math.round(((install.done ?? 0) / install.total) * 100) : 0}%）</span>}
      {install.state === 'installing' && <span className="her-muted">正在安装身体…</span>}
      {install.state === 'failed' && <span className="her-danger">身体更新没成功：{install.error}</span>}
      {install.restart === true && (
        <>
          <span className="her-ok">身体 {install.installed} 已装好</span>
          <button className="her-btn small primary" onClick={() => void apply(herApi.restartBody())}>重启身体</button>
        </>
      )}
    </div>
  )
}

function failureText(code: string | undefined, message: string | undefined): string {
  return (code === undefined ? undefined : FAILURES[code]) ?? `更新没成功：${(message ?? '未知原因').slice(0, 200)}`
}
