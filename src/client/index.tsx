/**
 * Browser half: a "她 / Her" entry in the left sidebar that opens her page
 * (the setup wizard, then the management page) in the main area. The sidebar
 * entry and the page share one id, the same way DSH's own task manager is wired.
 */

import { HerPage } from './Page.tsx'
import { mountWebFloat } from './web-float.ts'
import { STYLES } from './styles.ts'
import { requestPage } from './open-page.ts'

export const PACKAGE_NAME = 'dsh-her'
export const inject = ['slots', 'locale']

/** Shared by the sidebar entry and the main page it opens. */
export const PANEL_ID = 'dsh-her'
const NS = 'dsh-her'

interface ClientContext {
  effect(fn: () => () => void, label?: string): void
  locale: {
    register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void
    bind(ns: string): (key: string) => string
  }
  slots: {
    inject(name: string, fn: () => () => void): void
    register(definition: Record<string, unknown>, component: unknown): () => void
  }
}

/** A heart outline; drawn inline so it works in every DSH release. */
function HerIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </svg>
  )
}

export function apply(ctx: ClientContext): void {
  // She can live on every page of DSH, not only in her own (no desktop needed).
  ctx.effect(() => mountWebFloat(), 'dsh-her: web body')
  ctx.effect(() => ctx.locale.register(NS, { zh: { panel: '她' }, en: { panel: 'Her' } }), 'dsh-her: dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshPlugin = PACKAGE_NAME
    style.textContent = STYLES
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-her: styles')

  // "完整对话": open her conversation in dsh's own view, when this dsh offers that (uiWorkspace.openSession).
  const withService = ctx as unknown as { inject?: (deps: string[], fn: (c: { effect(fn: () => () => void): void; uiWorkspace?: { openSession?(id: string): void } }) => void) => void }
  withService.inject?.(['uiWorkspace'], c => c.effect(() => {
    if (typeof c.uiWorkspace?.openSession !== 'function') return () => {}
    window.__herOpenSession = id => c.uiWorkspace?.openSession?.(id)
    return () => { delete window.__herOpenSession }
  }))

  // "设置…" on the desktop body: show her page (layout.selectPanel), on the page of her settings asked for.
  const withLayout = ctx as unknown as { inject?: (deps: string[], fn: (c: { effect(fn: () => () => void): void; layout?: { selectPanel?(id: string): void } }) => void) => void }
  let selectPanel: ((id: string) => void) | undefined
  withLayout.inject?.(['layout'], c => c.effect(() => {
    if (typeof c.layout?.selectPanel !== 'function') return () => {}
    selectPanel = id => c.layout?.selectPanel?.(id)
    return () => { selectPanel = undefined }
  }))
  ctx.effect(() => {
    window.__herOpenPage = page => {
      requestPage(page)
      try {
        selectPanel?.(PANEL_ID)
      } catch {
        // her page is not registered yet: it shows the request when it opens
      }
    }
    return () => { delete window.__herOpenPage }
  }, 'dsh-her: open settings')

  const t = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, HerPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 31,
    locale: NS,
    label: () => t('panel'),
  }, HerIcon))
}
