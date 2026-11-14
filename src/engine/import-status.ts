/**
 * Where a pack import started from the "她" page stands. The import itself
 * runs in the body (it reads your folder and has ffmpeg); the body reports
 * progress and a report, which the page shows by polling the brain's state.
 */

export interface ReportLine {
  level: 'ok' | 'warn' | 'error'
  text: string
}

export interface ImportStatus {
  state: 'idle' | 'picking' | 'running' | 'done' | 'failed'
  done: number
  total: number
  step: string
  lines: ReportLine[]
}

export const IDLE_IMPORT: ImportStatus = { state: 'idle', done: 0, total: 0, step: '', lines: [] }
