/**
 * "+AI" from a page (docs/设置页与编排设计.md §6): the design session is told
 * what to change and opened in dsh, where you say how.
 */

import { herApi } from './api.ts'

export async function openDesign(focus: string): Promise<string | undefined> {
  const result = await herApi.designOpen(focus)
  if (!result.ok) return result.message
  if (window.__herOpenSession === undefined) return '设计会话准备好了：在左侧她的工作区里打开"设计（+AI）"，说你想怎么改。'
  window.__herOpenSession(result.sessionId)
  return undefined
}
