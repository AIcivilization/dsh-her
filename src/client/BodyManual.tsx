/**
 * Downloading the body by hand, for when the built-in download is slow: copy a
 * link into a download manager, save the zip into the folder shown, press
 * install. The brain checks the file (size, SHA-256), unpacks and starts it;
 * there is nothing to unzip or run.
 */

import { useCallback, useEffect, useState } from 'react'
import type { ManualInstall } from '../dsh/body-install.ts'
import { herApi } from './api.ts'
import type { Apply } from './parts.tsx'

/** How often to look whether the file has arrived. */
const LOOK_MS = 3000

const mb = (bytes: number) => (bytes / 1e6).toFixed(0)
const sourceName = (url: string, i: number) => (i === 0 ? 'GitHub 原地址' : `镜像 ${new URL(url).host}`)

export function BodyManual({ apply, onInstalled }: { apply: Apply; onInstalled: () => void }) {
  const [manual, setManual] = useState<ManualInstall>()
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState<string>()
  const [installing, setInstalling] = useState(false)

  const look = useCallback(async () => {
    const result = await herApi.bodyManual()
    if (result.ok) {
      setManual(result.manual)
      setError(current => (current?.startsWith('读不到') ? undefined : current))
    } else setError(`读不到下载信息：${result.message}`)
  }, [])
  useEffect(() => {
    void look()
    const timer = setInterval(() => void look(), LOOK_MS)
    return () => clearInterval(timer)
  }, [look])

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(current => (current === text ? undefined : current)), 2000)
  }
  const install = async () => {
    setInstalling(true)
    setError(undefined)
    const result = await herApi.bodyInstallDownloaded()
    setInstalling(false)
    if (result.ok) {
      await apply(Promise.resolve(result))
      onInstalled()
    } else setError(result.message)
  }

  if (manual === undefined) return <div className="her-manual">{error === undefined ? <p className="her-muted">正在读下载信息…</p> : <p className="her-danger">{error}</p>}</div>
  return (
    <div className="her-manual">
      <p><b>1. 复制下载链接</b>，放进下载软件（迅雷、IDM、浏览器都行）。版本 {manual.version}，{mb(manual.size)} MB。哪个快用哪个，文件都一样：</p>
      {manual.urls.map((url, i) => (
        <div key={url} className="her-manual-row">
          <span className="her-muted">{sourceName(url, i)}</span>
          <code title={url}>{url}</code>
          <button className="her-btn small" onClick={() => copy(url)}>{copied === url ? '已复制' : '复制链接'}</button>
        </div>
      ))}

      <p><b>2. 把下载好的文件放到这个文件夹</b>（不用解压）：</p>
      <div className="her-manual-row">
        <code title={manual.folder}>{manual.folder}</code>
        <button className="her-btn small" onClick={() => copy(manual.folder)}>{copied === manual.folder ? '已复制' : '复制路径'}</button>
        <button className="her-btn small" onClick={() => void herApi.bodyOpenFolder()}>打开文件夹</button>
      </div>
      <p className="her-faint">文件名：{manual.file}。这个文件夹在装好后也可以留着，不影响什么。</p>

      <p><b>3. 安装</b>：插件会核对文件没有下错或被改过，解压，然后自动启动她。</p>
      <div className="her-row">
        <button className="her-btn primary" disabled={manual.downloaded !== 'ready' || installing} onClick={() => void install()}>{installing ? '正在核对和安装…' : '安装下载好的文件'}</button>
        {manual.downloaded === 'none' && <span className="her-muted">还没找到文件，放进去后这里会自动变化</span>}
        {manual.downloaded === 'partial' && <span className="her-warn">文件还不完整（{mb(manual.downloadedSize ?? 0)} / {mb(manual.size)} MB），等下载完</span>}
        {manual.downloaded === 'ready' && !installing && <span className="her-ok">✓ 找到文件了，大小正确</span>}
      </div>
      {error !== undefined && <p className="her-danger">{error}</p>}
      <p className="her-faint">
        不用自己运行：以后 dsh 启动时会自动启动她。装好的程序在 <code>{manual.program}</code>，想手动打开也可以直接运行它。
        校验值（SHA-256）：<code>{manual.sha256}</code>
      </p>
    </div>
  )
}
