/**
 * How a choice card says what it is: the one in use carries "✓ 正在用"; one
 * picked to try (heard, not switched to yet) has a dashed outline. Shared by
 * every picker, so "what she uses now" always looks the same.
 */

import type { ReactNode } from 'react'
import { OWN_PREFIX, voiceName } from '../core/voices.ts'
import type { StateView } from './api.ts'

export function choiceClass(id: string, inUse: string, trying?: string): string {
  return `her-choice${id === inUse ? ' on' : ''}${trying !== undefined && id === trying && id !== inUse ? ' trying' : ''}`
}

/** The small line under a card's name. */
export function choiceNote(id: string, inUse: string, text: string, busy?: string): ReactNode {
  if (busy !== undefined && busy === id) return '正在合成…'
  return id === inUse ? <><span className="her-badge">✓ 正在用</span>{text}</> : text
}

/** A voice's name, her own Ming voices included. */
export function voiceLabel(state: StateView, id: string): string {
  if (id.startsWith(OWN_PREFIX)) return state.voice.ming.own.find(v => `${OWN_PREFIX}${v.id}` === id)?.name ?? '已删除的声音'
  return voiceName(id)
}

export const SERVICE_SHORT: Record<string, string> = { edge: '微软 Edge', cosyvoice: '阿里云百炼', ming: '本机 Ming' }
