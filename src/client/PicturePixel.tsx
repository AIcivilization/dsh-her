/**
 * 图片转精灵 (docs/像素工坊设计.md §5): a picture chosen here becomes a pixel
 * picture, in this page only. It is not uploaded or kept; what goes into the
 * draft is the characters. How many cells high, mono or colour, and whether
 * a plain background is taken away, all seen at once.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { makePicture, type Picture, type Rgba } from '../core/pixel-picture.ts'

const HEIGHTS = [32, 48, 64, 96, 128]
const INK: [number, number, number] = [159, 216, 255]

/** The picture's pixels, at most 512 on its longer side. */
async function readPicture(file: File): Promise<Rgba> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const k = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, w, h)
    return { data: ctx.getImageData(0, 0, w, h).data, w, h }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function draw(canvas: HTMLCanvasElement, picture: Picture): void {
  const k = Math.max(2, Math.floor(Math.min(260 / picture.w, 240 / picture.h)))
  canvas.width = picture.w * k
  canvas.height = picture.h * k
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0b1a2e'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  picture.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!
      if (ch === '.') continue
      ctx.fillStyle = picture.palette !== undefined ? picture.palette[ch] ?? '#fff' : `rgba(${INK.join(',')},${Number(ch) / 9})`
      ctx.fillRect(x * k, y * k, k, k)
    }
  })
}

export function PicturePixel({ file, onUse, onCancel }: { file: File; onUse: (picture: Picture) => Promise<void>; onCancel: () => void }) {
  const [source, setSource] = useState<Rgba>()
  const [problem, setProblem] = useState<string>()
  const [height, setHeight] = useState(64)
  const [color, setColor] = useState(false)
  const [cut, setCut] = useState(true)
  const [edge, setEdge] = useState(true)
  const [busy, setBusy] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    setSource(undefined)
    setProblem(undefined)
    readPicture(file).then(setSource, () => setProblem('这张图打不开：换一张 PNG、JPG 或 WebP 试试'))
  }, [file])

  // A fresh copy each time: taking the background away changes the pixels.
  const picture = useMemo(
    () => (source === undefined ? undefined : makePicture({ data: new Uint8ClampedArray(source.data), w: source.w, h: source.h }, { height, color, cutBackground: cut, outline: edge })),
    [source, height, color, cut, edge],
  )
  useEffect(() => { if (picture !== undefined && canvas.current !== null) draw(canvas.current, picture) }, [picture])

  return (
    <div className="her-ws-picture">
      <b>用图片做</b>
      {problem !== undefined && <p className="her-danger">{problem}</p>}
      {source === undefined && problem === undefined && <p className="her-muted">正在读图……</p>}
      {picture !== undefined && (
        <>
          <canvas ref={canvas} className="her-ws-picture-view" />
          <span className="her-faint">
            {picture.w} × {picture.h} 格{picture.palette === undefined ? '' : `，${Object.keys(picture.palette).length} 种颜色`}
            {picture.background === 'clear' ? '；图本来就是透明底' : picture.background === 'cut' ? '；去掉了纯色背景' : cut ? '；背景不是纯色，没去掉' : ''}
          </span>
          <div className="her-ws-set">
            <b>多少格高</b>
            <span className="her-faint">越高越细腻；96、128 适合人物</span>
            <span className="her-seg" role="group" aria-label="多少格高">
              {HEIGHTS.map(h => <button key={h} className={height === h ? 'on' : ''} onClick={() => setHeight(h)}>{h}</button>)}
            </span>
          </div>
          <div className="her-ws-set">
            <b>颜色</b>
            <span className="her-seg" role="group" aria-label="颜色">
              <button className={!color ? 'on' : ''} onClick={() => setColor(false)}>单色（能换画法、调颜色）</button>
              <button className={color ? 'on' : ''} onClick={() => setColor(true)}>彩色（只能画成方块）</button>
            </span>
          </div>
          {color && <label className="her-muted"><input type="checkbox" checked={edge} onChange={e => setEdge(e.target.checked)} /> 加一圈深色描边（轮廓更清楚）</label>}
          {picture.background !== 'clear' && (
            <label className="her-muted"><input type="checkbox" checked={cut} onChange={e => setCut(e.target.checked)} /> 去掉纯色背景</label>
          )}
          <span className="her-row" style={{ margin: 0 }}>
            <button className="her-btn small primary" disabled={busy} onClick={() => { setBusy(true); void onUse(picture).finally(() => setBusy(false)) }}>放进草稿</button>
            <button className="her-btn small" onClick={onCancel}>不用了</button>
          </span>
        </>
      )}
      <p className="her-faint">图片只在这个页面里转，不上传、不保存；放进草稿的只是转好的字符。用别人的图自己玩没关系，分享出去要用自己有权分享的。</p>
    </div>
  )
}
