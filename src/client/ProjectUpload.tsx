/**
 * Sending pictures and clips to a 形象工坊 project from the browser, so a
 * project on another computer (a VPS) can be filled from this one.
 */

import { useRef, useState } from 'react'
import { uploadFiles, type UploadProgress } from './upload.ts'

const projectUrl = (projectId: string, path: string) => `/api/dsh-her/web/upload?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`

/** A file of the project, to download. */
export const projectFileUrl = (projectId: string, path: string) => `/api/dsh-her/web/project-file?id=${encodeURIComponent(projectId)}&f=${encodeURIComponent(path)}`

/**
 * One upload button. `named`: the file becomes this (its extension kept);
 * otherwise the files keep their names, into `folder`.
 */
export function ProjectUpload({ projectId, folder, named, accept, label, onDone }: { projectId: string; folder?: string; named?: string; accept: string; label: string; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<UploadProgress>()
  const [error, setError] = useState<string>()
  const pathOf = (file: File) => {
    const extension = /\.[^.]+$/.exec(file.name)?.[0].toLowerCase() ?? ''
    const name = named === undefined ? file.name : `${named}${extension}`
    return folder === undefined ? name : `${folder}/${name}`
  }
  const send = async (files: File[]) => {
    if (files.length === 0) return
    setError(undefined)
    try {
      await uploadFiles(files, file => projectUrl(projectId, pathOf(file)), setProgress)
    } catch (failure) {
      setError((failure as Error).message)
    }
    setProgress(undefined)
    if (input.current !== null) input.current.value = ''
    onDone()
  }
  return (
    <>
      <input ref={input} type="file" hidden multiple={named === undefined} accept={accept} onChange={e => void send([...(e.target.files ?? [])])} />
      <button className="her-btn" disabled={progress !== undefined} onClick={() => input.current?.click()}>{progress === undefined ? label : `正在上传 ${progress.file}（${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%）`}</button>
      {error !== undefined && <span className="her-danger">{error}</span>}
    </>
  )
}
