/**
 * "设置…" from the desktop body's menu: dsh shows her page, on the page of her
 * settings asked for. Her page may not be mounted yet when the request comes,
 * so the request waits here until it is.
 */

import type { SettingsPage } from '../protocol/index.ts'

let wanted: SettingsPage | undefined
const listeners = new Set<(page: SettingsPage) => void>()

/** Ask her page to show `page` (now if it is open, else when it opens). */
export function requestPage(page: SettingsPage): void {
  wanted = page
  for (const listener of listeners) listener(page)
}

/** The page asked for and not yet shown; asking again gives nothing. */
export function takePage(): SettingsPage | undefined {
  const page = wanted
  wanted = undefined
  return page
}

export function onPageRequest(listener: (page: SettingsPage) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
