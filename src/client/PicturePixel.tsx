/**
 * 图片转精灵 (docs/像素工坊设计.md §5, "一键动起来和多帧"): one picture, or
 * a few of one thing moving (pictures chosen together, a GIF, a short
 * video), becomes a pixel picture in this page only. Nothing is uploaded or
 * kept; what goes into the draft is the characters. How many cells high,
 * mono or colour, the outline, the background, how many frames: all seen
 * at once, the frames playing.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { makeFrames, pictureBytes, type Picture, type Rgba } from '../core/pixel-picture.ts'
import { PIXEL_LIMITS } from '../core/pixel.ts'

const HEIGHTS = [32, 48, 64, 96, 128]
const FRAME_COUNTS = [6, 8, 12, 16, 24]
/** The longest stretch of a video taken, in seconds. */
const VIDEO_SPAN = 6
const INK: [number, number, number] = [159, 216, 255]
/** The longer side pictures are brought to before they are turned. */
const SIDE = 512

/** What was chosen, read: its frames (all the same size) and how long the whole lasts. */
interface Source {
  frames: Rgba[]
  /** Seconds the whole takes, for a GIF or a video; undefined for pictures. */
  seconds?: number
  kind: 'picture' | 'pictures' | 'gif' | 'video'
}

/** A canvas `w` × `h`, the picture drawn in it whole; any room left filled with its own corner colour, so a plain background stays plain. */
function grab(source: CanvasImageSource, sw: number, sh: number, w: number, h: number): Rgba {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const k = Math.min(w / sw, h / sh)
  const dw = Math.round(sw * k), dh = Math.round(sh * k)
  if (dw !== w || dh !== h) {
    ctx.drawImage(source, 0, 0, 1, 1, 0, 0, w, h)
  }
  ctx.drawImage(source, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh)
  return { data: ctx.getImageData(0, 0, w, h).data, w, h }
}
const sized = (sw: number, sh: number) => {
  const k = Math.min(1, SIDE / Math.max(sw, sh))
  return [Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k))] as const
}

async function readImages(files: File[]): Promise<Rgba[]> {
  const images: HTMLImageElement[] = []
  for (const file of files) {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      images.push(img)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const [w, h] = sized(images[0]!.naturalWidth, images[0]!.naturalHeight)
  return images.map(img => grab(img, img.naturalWidth, img.naturalHeight, w, h))
}

/** WebCodecs' ImageDecoder, where the browser has it (Chrome, Edge). */
interface GifDecoder {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null }
  decode(o: { frameIndex: number }): Promise<{ image: VideoFrame }>
  close(): void
}
type GifDecoderClass = new (init: { data: ReadableStream<Uint8Array> | ArrayBuffer; type: string }) => GifDecoder

async function readGif(file: File, most: number): Promise<{ frames: Rgba[]; seconds: number }> {
  const Decoder = (window as unknown as { ImageDecoder?: GifDecoderClass }).ImageDecoder
  if (Decoder === undefined) throw new Error('这个浏览器读不了动图里的每一帧：换成 Chrome 或 Edge，或者传一段视频、几张图')
  const decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type || 'image/gif' })
  try {
    await decoder.tracks.ready
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1
    const pick = Array.from({ length: Math.min(most, count) }, (_, k) => Math.floor(k * count / Math.min(most, count)))
    const frames: Rgba[] = []
    let micro = 0
    for (let k = 0; k < count; k++) {
      // Every frame's length counts toward the whole; only the picked ones are drawn.
      const { image } = await decoder.decode({ frameIndex: k })
      micro += image.duration ?? 100_000
      if (pick.includes(k)) {
        const [w, h] = sized(image.displayWidth, image.displayHeight)
        frames.push(grab(image, image.displayWidth, image.displayHeight, w, h))
      }
      image.close()
    }
    return { frames, seconds: micro / 1_000_000 }
  } finally {
    decoder.close()
  }
}

async function readVideo(file: File, count: number): Promise<{ frames: Rgba[]; seconds: number }> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('这段视频打不开：换一段 MP4 或 WebM 试试'))
    })
    const span = Math.min(VIDEO_SPAN, Number.isFinite(video.duration) ? video.duration : VIDEO_SPAN)
    const [w, h] = sized(video.videoWidth, video.videoHeight)
    const frames: Rgba[] = []
    for (let k = 0; k < count; k++) {
      await new Promise<void>(resolve => {
        video.onseeked = () => resolve()
        video.currentTime = (k + 0.5) * span / count
      })
      frames.push(grab(video, video.videoWidth, video.videoHeight, w, h))
    }
    return { frames, seconds: span }
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

async function readSource(files: File[], count: number): Promise<Source> {
  const first = files[0]!
  if (files.length === 1 && first.type.startsWith('video/')) return { ...await readVideo(first, count), kind: 'video' }
  if (files.length === 1 && first.type === 'image/gif') {
    const gif = await readGif(first, count)
    return gif.frames.length > 1 ? { ...gif, kind: 'gif' } : { frames: gif.frames, kind: 'picture' }
  }
  const pictures = files.filter(f => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 12)
  if (pictures.length === 0) throw new Error('选图片（PNG、JPG、WebP、GIF）或者一段视频')
  return { frames: await readImages(pictures), kind: pictures.length > 1 ? 'pictures' : 'picture' }
}

function draw(canvas: HTMLCanvasElement, picture: Picture, frame: number): void {
  const k = Math.max(2, Math.floor(Math.min(260 / picture.w, 240 / picture.h)))
  if (canvas.width !== picture.w * k) canvas.width = picture.w * k
  if (canvas.height !== picture.h * k) canvas.height = picture.h * k
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0b1a2e'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  picture.frames[frame % picture.frames.length]!.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!
      if (ch === '.') continue
      ctx.fillStyle = picture.palette !== undefined ? picture.palette[ch] ?? '#fff' : `rgba(${INK.join(',')},${Number(ch) / 9})`
      ctx.fillRect(x * k, y * k, k, k)
    }
  })
}

export function PicturePixel({ files, onUse, onCancel }: { files: File[]; onUse: (picture: Picture) => Promise<void>; onCancel: () => void }) {
  const [source, setSource] = useState<Source>()
  const [problem, setProblem] = useState<string>()
  const [height, setHeight] = useState(64)
  const [color, setColor] = useState(true)
  const [cut, setCut] = useState(true)
  const [edge, setEdge] = useState(true)
  const [count, setCount] = useState(12)
  const [busy, setBusy] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const moving = files.length > 1 || files[0]?.type === 'image/gif' || files[0]?.type.startsWith('video/') === true

  useEffect(() => {
    let gone = false
    setSource(undefined)
    setProblem(undefined)
    readSource(files, count).then(
      s => { if (!gone) setSource(s) },
      (e: unknown) => { if (!gone) setProblem(e instanceof Error && /[一-龥]/.test(e.message) ? e.message : '打不开：换一张 PNG、JPG、WebP，或者一段 MP4 试试') },
    )
    return () => { gone = true }
  }, [files, count])

  // A fresh copy each time: taking the background away changes the pixels.
  const picture = useMemo(() => {
    if (source === undefined) return undefined
    const copies = source.frames.map(f => ({ data: new Uint8ClampedArray(f.data), w: f.w, h: f.h }))
    const each = source.seconds === undefined ? 0.15 : source.seconds / source.frames.length
    return makeFrames(copies, { height, color, cutBackground: cut, outline: edge }, each)
  }, [source, height, color, cut, edge])
  useEffect(() => {
    if (picture === undefined || canvas.current === null) return
    const c = canvas.current
    let n = 0
    draw(c, picture, 0)
    if (picture.frames.length < 2) return
    const timer = setInterval(() => draw(c, picture, ++n), (picture.each ?? 0.15) * 1000)
    return () => clearInterval(timer)
  }, [picture])

  const bytes = picture === undefined ? 0 : pictureBytes(picture)
  const tooBig = bytes > PIXEL_LIMITS.bytes * 0.95
  const what = source?.kind === 'video' ? '视频' : source?.kind === 'gif' ? '动图' : source?.kind === 'pictures' ? `${files.length} 张图` : '图片'

  return (
    <div className="her-ws-picture">
      <b>用{moving ? '动图、视频或几张图' : '图片'}做</b>
      {problem !== undefined && <p className="her-danger">{problem}</p>}
      {source === undefined && problem === undefined && <p className="her-muted">正在读{moving ? '每一帧' : '图'}……</p>}
      {picture !== undefined && (
        <>
          <canvas ref={canvas} className="her-ws-picture-view" />
          <span className="her-faint">
            {what}转成 {picture.w} × {picture.h} 格{picture.frames.length > 1 ? `，${picture.frames.length} 帧，每帧 ${picture.each} 秒` : ''}{picture.palette === undefined ? '' : `，${Object.keys(picture.palette).length} 种颜色`}
            {picture.background === 'clear' ? '；本来就是透明底' : picture.background === 'cut' ? '；去掉了纯色背景' : cut ? '；背景不是纯色，没去掉' : ''}
          </span>
          {tooBig && <p className="her-danger">太大了（约 {Math.round(bytes / 1024)} KB，最多 {PIXEL_LIMITS.bytes / 1024} KB）：少几帧，或者矮一点。</p>}
          <div className="her-ws-set">
            <b>多少格高</b>
            <span className="her-seg" role="group" aria-label="多少格高">
              {HEIGHTS.map(h => <button key={h} className={height === h ? 'on' : ''} onClick={() => setHeight(h)}>{h}</button>)}
            </span>
            <span className="her-faint">越高越细腻；96、128 适合人物</span>
          </div>
          {(source?.kind === 'video' || source?.kind === 'gif') && (
            <div className="her-ws-set">
              <b>几帧</b>
              <span className="her-seg" role="group" aria-label="几帧">
                {FRAME_COUNTS.map(n => <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>{n}</button>)}
              </span>
              <span className="her-faint">{source.kind === 'video' ? `从前 ${Math.round(Math.min(VIDEO_SPAN, source.seconds ?? VIDEO_SPAN) * 10) / 10} 秒里平均取` : '从动图里平均取'}；帧越多越顺，文件也越大</span>
            </div>
          )}
          <div className="her-ws-set">
            <b>颜色</b>
            <span className="her-seg" role="group" aria-label="颜色">
              <button className={color ? 'on' : ''} onClick={() => setColor(true)}>彩色（只能画成方块）</button>
              <button className={!color ? 'on' : ''} onClick={() => setColor(false)}>单色（能换画法、调颜色）</button>
            </span>
          </div>
          {color && <label className="her-muted"><input type="checkbox" checked={edge} onChange={e => setEdge(e.target.checked)} /> 加一圈深色描边（轮廓更清楚）</label>}
          {picture.background !== 'clear' && (
            <label className="her-muted"><input type="checkbox" checked={cut} onChange={e => setCut(e.target.checked)} /> 去掉纯色背景</label>
          )}
          <span className="her-row" style={{ margin: 0 }}>
            <button className="her-btn small primary" disabled={busy || tooBig} onClick={() => { setBusy(true); void onUse(picture).finally(() => setBusy(false)) }}>放进草稿</button>
            <button className="her-btn small" onClick={onCancel}>不用了</button>
          </span>
        </>
      )}
      <p className="her-faint">只在这个页面里转，不上传、不保存；放进草稿的只是转好的字符。想要会动的：一次选几张图（按顺序），或者一张动图、一段几秒的视频。用别人的图自己玩没关系，分享出去要用自己有权分享的。</p>
    </div>
  )
}
