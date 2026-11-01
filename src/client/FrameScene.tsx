/**
 * 框人物区 in the page, for when there is no desktop body to open its window:
 * drag a box on the scene's photo; the brain writes scene.json and crop.png.
 * The box keeps the shape her clips are generated in (9:16 unless changed).
 */

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { herApi, type FrameRegion } from './api.ts'

const SHAPES: Array<[number, string]> = [[9 / 16, '竖版 9:16'], [3 / 4, '3:4'], [1, '方形'], [16 / 9, '横版 16:9'], [0, '不限形状']]

export function FrameScene({ projectId, sceneId, sceneName, onDone }: { projectId: string; sceneId: string; sceneName: string; onDone: () => void }) {
  const [photo, setPhoto] = useState<{ width: number; height: number; url: string }>()
  const [region, setRegion] = useState<FrameRegion>()
  const [shape, setShape] = useState(9 / 16)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const area = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void herApi.workshopFrameInfo(projectId, sceneId).then(result => {
      if (!result.ok) return setError(result.message)
      setPhoto({ width: result.width, height: result.height, url: `/api/dsh-her/web/project-file?id=${encodeURIComponent(projectId)}&f=${encodeURIComponent(result.file)}` })
      if (result.region !== undefined) {
        setRegion(result.region)
        setShape(0)
      }
    })
  }, [projectId, sceneId])

  /** Photo pixels under the pointer. */
  const at = (event: { clientX: number; clientY: number }) => {
    const box = area.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * photo!.width,
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) * photo!.height,
    }
  }
  const startBox = (event: ReactMouseEvent) => {
    event.preventDefault()
    const from = at(event)
    const move = (next: MouseEvent) => {
      const to = at(next)
      let width = Math.abs(to.x - from.x)
      let height = Math.abs(to.y - from.y)
      if (shape > 0) {
        if (width / Math.max(height, 1) > shape) height = width / shape
        else width = height * shape
      }
      const x = Math.max(0, to.x < from.x ? from.x - width : from.x)
      const y = Math.max(0, to.y < from.y ? from.y - height : from.y)
      setRegion({ x, y, width: Math.min(width, photo!.width - x), height: Math.min(height, photo!.height - y) })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const save = async () => {
    if (region === undefined) return
    setSaving(true)
    setError(undefined)
    const result = await herApi.workshopFrameSave(projectId, sceneId, region)
    setSaving(false)
    if (result.ok) onDone()
    else setError(result.message)
  }

  if (photo === undefined) return <div className="her-manual">{error === undefined ? <p className="her-muted">正在读照片…</p> : <p className="her-danger">{error}</p>}</div>
  const percent = (value: number, of: number) => `${(value / of) * 100}%`
  return (
    <div className="her-manual">
      <p><b>框出「{sceneName}」里她活动的范围</b>：在照片上拖一个框，把她整个框进去，头顶和脚下留一点空。</p>
      <div className="her-row">
        <select className="her-select" style={{ width: 'auto' }} value={shape} onChange={e => setShape(Number(e.target.value))}>
          {SHAPES.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
        </select>
        <span className="her-muted">{region === undefined ? `照片 ${photo.width}×${photo.height}` : `人物区 ${Math.round(region.width)}×${Math.round(region.height)}（照片 ${photo.width}×${photo.height}）`}</span>
      </div>
      <div ref={area} className="her-frame" onMouseDown={startBox}>
        <img src={photo.url} alt="" draggable={false} />
        {region !== undefined && (
          <div className="her-frame-box" style={{ left: percent(region.x, photo.width), top: percent(region.y, photo.height), width: percent(region.width, photo.width), height: percent(region.height, photo.height) }} />
        )}
      </div>
      <div className="her-row">
        <button className="her-btn primary" disabled={region === undefined || saving} onClick={() => void save()}>{saving ? '正在保存…' : '保存人物区'}</button>
        <button className="her-btn" onClick={onDone}>取消</button>
      </div>
      {error !== undefined && <p className="her-danger">{error}</p>}
    </div>
  )
}
