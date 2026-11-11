/**
 * Wearing a skin in dsh's page (docs/设置页与编排设计.md §4): its colours go
 * through dsh's own theme service (`theme.overrideTokens`, set by the client
 * plugin as `window.__herTheme`), the rest is a style element of ours. Every
 * dsh page wears what the brain says; the settings page may try one on
 * (preview) and goes back to it when it does not save.
 */

import { skinCss, skinTokens, type Pair, type Skin } from '../core/skin.ts'

interface ThemeService {
  overrideTokens(source: string, tokens: Record<string, Pair>): () => void
}

declare global {
  interface Window {
    __herTheme?: ThemeService
  }
}

const SOURCE = 'dsh-her-skin'
const fileOf = (id: string) => (name: string) => `/api/dsh-her/web/skin-file?id=${encodeURIComponent(id)}&f=${encodeURIComponent(name)}`

let undoTokens: (() => void) | undefined
/** What is worn because the brain says so, and what is being tried on. */
let saved: { id: string; rev: number } | undefined
let trying: string | null | undefined

async function skinData(id: string): Promise<Skin | undefined> {
  try {
    const res = await fetch(new URL('/api/dsh-her/skins/get', document.baseURI), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
    const value = await res.json() as { ok: boolean; skins?: Skin[] }
    return value.skins?.find(s => s.id === id)
  } catch {
    return undefined
  }
}

async function put(skin: Skin | undefined): Promise<void> {
  undoTokens?.()
  undoTokens = undefined
  document.getElementById('dsh-her-skin')?.remove()
  if (skin === undefined) return
  const tokens = skinTokens(skin)
  if (Object.keys(tokens).length > 0 && window.__herTheme !== undefined) {
    try {
      undoTokens = window.__herTheme.overrideTokens(SOURCE, tokens)
    } catch {
      // an older dsh without token overrides: the rest still applies
    }
  }
  let extra = ''
  if (skin.css !== undefined) {
    try {
      extra = await (await fetch(new URL(fileOf(skin.id)(skin.css), document.baseURI), { credentials: 'same-origin' })).text()
    } catch {
      // without its extra CSS
    }
  }
  const style = document.createElement('style')
  style.id = 'dsh-her-skin'
  style.textContent = skinCss(skin, fileOf(skin.id), extra)
  document.head.append(style)
}

/** What the brain says this page wears (from web/status): put on when it changed, unless one is being tried on. */
export async function wearSaved(skin: { id: string; rev: number } | undefined): Promise<void> {
  const same = saved?.id === skin?.id && saved?.rev === skin?.rev
  saved = skin
  if (same || trying !== undefined) return
  await put(skin === undefined ? undefined : await skinData(skin.id))
}

/** Try one on (null: dsh as it is) without saving. */
export async function tryOn(id: string | null): Promise<void> {
  trying = id
  await put(id === null ? undefined : await skinData(id))
}

/** Stop trying on: back to the saved one (after saving, the new saved one). */
export async function stopTrying(now?: { id: string; rev: number } | null): Promise<void> {
  trying = undefined
  if (now !== undefined) saved = now ?? undefined
  await put(saved === undefined ? undefined : await skinData(saved.id))
}
