/**
 * A card that folds to one line: a solid round arrow, the title, what is set
 * now (with a status dot), and a labelled "展开 / 收起" button on the right.
 * The whole line is the button. Which cards are open is remembered in this
 * browser, per page.
 */

import { useCallback, useState, type ReactNode } from 'react'

type Tone = 'ok' | 'warn' | 'bad' | 'off'

export function Fold({ id, title, summary, tone, summaryClass, open, onToggle, children }: {
  id?: string
  title: string
  summary?: ReactNode
  /** A status dot before the summary. */
  tone?: Tone
  summaryClass?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className={`her-card her-foldcard${open ? ' open' : ''}`} {...(id === undefined ? {} : { id })}>
      <button className="her-fold" onClick={onToggle} aria-expanded={open}>
        <span className={`her-fold-arrow${open ? ' open' : ''}`} aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <h2>{title}</h2>
        <span className={`her-fold-sum ${summaryClass ?? 'her-muted'}`}>
          {tone !== undefined && <span className={`her-dot ${tone}`} />}
          {summary}
        </span>
        <span className="her-fold-toggle">{open ? '收起' : '展开'}</span>
      </button>
      {open && <div className="her-fold-body">{children}</div>}
    </div>
  )
}

/** Which cards are open, remembered under `key`; `initial` for a card never toggled. */
export function useFolds<K extends string>(key: string, initial: Record<K, boolean>): [Record<K, boolean>, (card: K, open?: boolean) => void] {
  const [folds, setFolds] = useState<Record<K, boolean>>(() => {
    try {
      return { ...initial, ...JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Record<K, boolean>> }
    } catch {
      return initial
    }
  })
  const toggle = useCallback((card: K, open?: boolean) => setFolds(current => {
    const next = { ...current, [card]: open ?? !current[card] }
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // private window: the folds are just not remembered
    }
    return next
  }), [key])
  return [folds, toggle]
}
