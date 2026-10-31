/**
 * Downloads that work on the networks her users are on.
 *
 * - Inside the DSH desktop app, requests go through Electron's `net.fetch`:
 *   Chromium's network stack, which follows the system proxy settings the
 *   way a browser does (Node's own fetch ignores them, so a computer that
 *   reaches GitHub only through Clash or the like got "fetch failed").
 *   Elsewhere (the dsh command line) it is Node's fetch.
 * - A GitHub download that cannot connect is tried again through mirrors
 *   (`body.mirrors`, prefixes such as `https://ghfast.top/`). Mirrors are
 *   third parties: only files whose size and SHA-256 the caller knows in
 *   advance should come through them, and every caller here checks both.
 * - A failure says what went wrong in plain words (no bare "fetch failed").
 */

import { createRequire } from 'node:module'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** Mirror prefixes tried, in order, after github.com itself. */
export const DEFAULT_MIRRORS: readonly string[] = ['https://ghfast.top/', 'https://gh-proxy.com/']

let mirrors: readonly string[] = DEFAULT_MIRRORS
let systemFetch: Fetch | null | undefined

/** The plugin's `body.mirrors` setting (an empty list: GitHub only). */
export function setMirrors(list: readonly string[]): void {
  mirrors = list.map(m => m.trim()).filter(m => /^https:\/\/\S+\/$/.test(m))
}

/** Electron's net.fetch when this runs inside the DSH desktop app. */
function viaSystem(): Fetch | undefined {
  if (systemFetch === undefined) {
    try {
      const electron = createRequire(import.meta.url)('electron') as { net?: { fetch?: Fetch } } | string
      systemFetch = typeof electron === 'object' && typeof electron.net?.fetch === 'function' ? electron.net.fetch.bind(electron.net) : null
    } catch {
      systemFetch = null
    }
  }
  return systemFetch ?? undefined
}

/** fetch, through the system proxy when it can. */
export async function httpFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const system = viaSystem()
  if (system !== undefined) {
    try {
      return await system(url, init)
    } catch (error) {
      if ((error as Error).name === 'AbortError' || (error as Error).name === 'TimeoutError') throw error
      // Electron's stack could not; Node's may (a proxy that only Node sees, through its own settings).
    }
  }
  return fetch(url, init)
}

/** Where to try `url`: itself, then each mirror when it is a GitHub download. */
export function candidates(url: string, list: readonly string[] = mirrors): string[] {
  return [url, ...(isGithub(url) ? list.map(m => `${m}${url}`) : [])]
}

const isGithub = (url: string) => /^https:\/\/(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//.test(url)

/**
 * The response for `url`, from GitHub or, if that cannot connect, a mirror.
 * Only for files the caller checks (size and SHA-256) before using them.
 * Throws a NetError explaining the first failure.
 */
export async function fetchChecked(url: string, init: RequestInit = {}): Promise<Response> {
  let first: unknown
  for (const candidate of candidates(url)) {
    try {
      const res = await httpFetch(candidate, { redirect: 'follow', ...init })
      // A mirror that answers with an error page is no better than one that does not answer.
      if (res.ok || candidate === url && res.status === 404) return res
      first ??= new Error(`HTTP ${res.status}`)
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error
      first ??= error
    }
  }
  throw new NetError(url, first)
}

/** A download that failed, with the reason in Chinese for the page. */
export class NetError extends Error {
  constructor(url: string, cause: unknown) {
    super(explain(url, cause), { cause })
    this.name = 'NetError'
  }
}

/** "连不上 github.com：…" from fetch's error (its `cause` carries the system's code). */
export function explain(url: string, error: unknown): string {
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  })()
  const e = error as { message?: string; code?: string; cause?: { code?: string; message?: string } }
  const code = e?.cause?.code ?? e?.code ?? ''
  const detail = `${code}${e?.cause?.message ?? e?.message ?? ''}`
  const github = /github/.test(host)
  const tip = github ? '如果你平时通过代理上 GitHub，打开代理软件的"系统代理"再试；没有代理也会自动换镜像下载，都不行时可以在插件设置 body.mirrors 里换一个镜像。' : '检查一下网络再试。'
  if (/HTTP \d+/.test(detail)) return `${host} 返回了错误（${detail.match(/HTTP \d+/)![0]}）。${tip}`
  if (/ENOTFOUND|EAI_AGAIN|NAME_NOT_RESOLVED/.test(detail)) return `找不到 ${host}（域名解析失败）。${tip}`
  if (/ECONNRESET|ECONNREFUSED|CONNECTION_RESET|CONNECTION_REFUSED|CONNECTION_CLOSED/.test(detail)) return `连不上 ${host}（连接被拒绝或被重置）。${tip}`
  if (/TIMEOUT|ETIMEDOUT|TIMED_OUT|Timeout/i.test(detail)) return `连接 ${host} 超时。${tip}`
  if (/CERT|SSL|TLS|SIGNATURE|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(detail)) return `和 ${host} 的加密连接出错（证书不对，可能被网络或代理拦截了）。${tip}`
  return `连不上 ${host}（${detail || '网络错误'}）。${tip}`
}
