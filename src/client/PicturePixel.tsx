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
/** What the two buttons take: pictures (one, several, or a moving GIF), or one video. Kept apart so a video is never taken for a picture. */
export const PICTURE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
export const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime,.mp4,.m4v,.mov,.webm'
export type SourceKind = 'picture' | 'pictures' | 'gif' | 'video'
const isVideo = (f: File) => f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(f.name)

/** What is turned from what was chosen or dropped: one video when there is one (the pictures beside it left out, and said), else the pictures. */
export function sortSources(list: File[]): { files: File[]; left?: string } {
  const video = list.find(isVideo)
  if (video !== undefined) {
    const others = list.length - 1
    return { files: [video], ...(others > 0 ? { left: `一起选了 ${list.length} 个文件，用的是视频「${video.name}」，其余 ${others} 个没用` } : {}) }
  }
  return { files: list.filter(f => f.type.startsWith('image/')) }
}

/** The longest stretch of a video taken, in seconds. */
const VIDEO_SPAN = 6
/** How long a stretch of a video one may take. */
const SPANS = [2, 3, 4, 6]
const INK: [number, number, number] = [159, 216, 255]
/** The longer side pictures are brought to before they are turned. */
const SIDE = 512

/** What was chosen, read: its frames (all the same size) and how long the whole lasts. */
interface Source {
  frames: Rgba[]
  /** Seconds the whole takes, for a GIF or a video; undefined for pictures. */
  seconds?: number
  /** A video's whole length, and where the stretch taken starts (s). */
  duration?: number
  from?: number
  kind: SourceKind
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

/** `count` frames evenly over `span` seconds of a video from `from` (as much as there is). */
async function readVideo(file: File, count: number, from = 0, span = VIDEO_SPAN): Promise<{ frames: Rgba[]; seconds: number; duration: number; from: number }> {
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
    const duration = Number.isFinite(video.duration) ? video.duration : span
    const length = Math.min(span, VIDEO_SPAN, duration)
    const start = Math.max(0, Math.min(from, duration - length))
    const [w, h] = sized(video.videoWidth, video.videoHeight)
    const frames: Rgba[] = []
    for (let k = 0; k < count; k++) {
      await new Promise<void>(resolve => {
        video.onseeked = () => resolve()
        video.currentTime = start + (k + 0.5) * length / count
      })
      frames.push(grab(video, video.videoWidth, video.videoHeight, w, h))
    }
    return { frames, seconds: length, duration, from: start }
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

async function readSource(files: File[], count: number, from = 0, span = VIDEO_SPAN): Promise<Source> {
  const first = files[0]!
  if (files.length === 1 && isVideo(first)) return { ...await readVideo(first, count, from, span), kind: 'video' }
  if (files.length === 1 && first.type === 'image/gif') {
    const gif = await readGif(first, count)
    return gif.frames.length > 1 ? { ...gif, kind: 'gif' } : { frames: gif.frames, kind: 'picture' }
  }
  const pictures = files.filter(f => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 12)
  if (pictures.length === 0) throw new Error('选图片（PNG、JPG、WebP、GIF）或者一段视频')
  return { frames: await readImages(pictures), kind: pictures.length > 1 ? 'pictures' : 'picture' }
}

const round1 = (n: number) => Math.round(n * 10) / 10

function draw(canvas: HTMLCanvasElement, picture: Picture, frame: number): void {
  const k = Math.max(2, Math.floor(Math.min(420 / picture.w, 320 / picture.h)))
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

export function PicturePixel({ files, left, onUse, onCancel }: { files: File[]; left?: string; onUse: (picture: Picture, kind: SourceKind) => Promise<void>; onCancel: () => void }) {
  const [source, setSource] = useState<Source>()
  const [problem, setProblem] = useState<string>()
  const [height, setHeight] = useState(64)
  const [color, setColor] = useState(true)
  const [cut, setCut] = useState(true)
  const [edge, setEdge] = useState(true)
  const [count, setCount] = useState(12)
  const [from, setFrom] = useState(0)
  const [span, setSpan] = useState(VIDEO_SPAN)
  const [bounce, setBounce] = useState(false)
  const [busy, setBusy] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const video = files.length === 1 && isVideo(files[0]!)
  const moving = files.length > 1 || files[0]?.type === 'image/gif' || video

  // Read again a moment after the stretch stops moving, not at every step of the slider.
  useEffect(() => {
    let gone = false
    setProblem(undefined)
    const timer = setTimeout(() => {
      readSource(files, count, from, span).then(
        s => { if (!gone) setSource(s) },
        (e: unknown) => { if (!gone) setProblem(e instanceof Error && /[一-龥]/.test(e.message) ? e.message : '打不开：换一张 PNG、JPG、WebP，或者一段 MP4 试试') },
      )
    }, source === undefined ? 0 : 350)
    return () => {
      gone = true
      clearTimeout(timer)
    }
  }, [files, count, from, span])
  useEffect(() => setSource(undefined), [files])

  // A fresh copy each time: taking the background away changes the pixels.
  const picture = useMemo(() => {
    if (source === undefined) return undefined
    const copies = source.frames.map(f => ({ data: new Uint8ClampedArray(f.data), w: f.w, h: f.h }))
    const each = source.seconds === undefined ? 0.15 : source.seconds / source.frames.length
    const made = makeFrames(copies, { height, color, cutBackground: cut, outline: edge }, each)
    if (!bounce || made.frames.length < 3) return made
    // Forward, then back: the last frame runs into the first, whatever the clip.
    const frames = [...made.frames, ...made.frames.slice(1, -1).reverse()]
    return { ...made, frames, rows: frames[0]! }
  }, [source, height, color, cut, edge, bounce])
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

  const summary = picture === undefined ? '' : `${what}转成 ${picture.w} × ${picture.h} 格${picture.frames.length > 1 ? `，${picture.frames.length} 帧` : ''}${picture.palette === undefined ? '' : `，${Object.keys(picture.palette).length} 色`}${picture.background === 'clear' ? '，透明底' : picture.background === 'cut' ? '，去掉了背景' : cut ? '，背景不是纯色，没去掉' : ''}`

  return (
    <div className="her-ws-picture">
      <div className="her-ws-picture-head">
        <b>{video ? '🎬' : '🖼'} {files.length === 1 ? files[0]!.name : `${files.length} 张图`}</b>
        <button className="her-btn small" onClick={onCancel}>不用了</button>
      </div>
      {left !== undefined && <span className="her-muted">{left}</span>}
      {problem !== undefined && <p className="her-danger">{problem}</p>}
      <div className="her-ws-picture-body">
        <div className="her-ws-picture-show">
          {picture === undefined
            ? <span className="her-faint">{problem === undefined ? `正在读${moving ? '每一帧' : '图'}……` : ''}</span>
            : <canvas ref={canvas} className="her-ws-picture-view" />}
          {picture !== undefined && <span className="her-faint">{summary}</span>}
        </div>
        {picture !== undefined && (
          <div className="her-ws-picture-set">
            {tooBig && <p className="her-danger" style={{ margin: 0 }}>太大了（约 {Math.round(bytes / 1024)} KB，最多 {PIXEL_LIMITS.bytes / 1024} KB）：少几帧，或者矮一点。</p>}
            {source?.kind === 'video' && source.duration !== undefined && source.duration > 2.2 && (
              <div className="her-ws-row">
                <b>哪一段</b>
                <div>
                  <span className="her-seg" role="group" aria-label="取几秒">
                    {SPANS.filter(n => n <= Math.ceil(source.duration!)).map(n => <button key={n} className={span === n ? 'on' : ''} onClick={() => setSpan(n)}>{n} 秒</button>)}
                  </span>
                  {source.duration > Math.min(span, VIDEO_SPAN) + 0.2 && (
                    <span className="her-range">
                      <input type="range" aria-label="从第几秒开始" min={0} max={Math.max(0, source.duration - Math.min(span, VIDEO_SPAN))} step={0.1} value={from} onChange={e => setFrom(Number(e.target.value))} />
                      <i>从第 {round1(from)} 秒</i>
                    </span>
                  )}
                </div>
              </div>
            )}
            <div className="her-ws-row">
              <b title="越高越细腻；96、128 适合人物">格子高</b>
              <span className="her-seg" role="group" aria-label="多少格高">
                {HEIGHTS.map(h => <button key={h} className={height === h ? 'on' : ''} onClick={() => setHeight(h)}>{h}</button>)}
              </span>
            </div>
            {(source?.kind === 'video' || source?.kind === 'gif') && (
              <div className="her-ws-row">
                <b title="帧越多越顺，文件也越大">几帧</b>
                <span className="her-seg" role="group" aria-label="几帧">
                  {FRAME_COUNTS.map(n => <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>{n}</button>)}
                </span>
              </div>
            )}
            <div className="her-ws-row">
              <b>颜色</b>
              <span className="her-seg" role="group" aria-label="颜色">
                <button className={color ? 'on' : ''} title="只能画成方块" onClick={() => setColor(true)}>彩色</button>
                <button className={!color ? 'on' : ''} title="能换画法、调颜色" onClick={() => setColor(false)}>单色</button>
              </span>
            </div>
            <div className="her-ws-checks">
              {moving && <label><input type="checkbox" checked={bounce} onChange={e => setBounce(e.target.checked)} /> 来回播<i>正放再倒放，首尾接得上</i></label>}
              {color && <label><input type="checkbox" checked={edge} onChange={e => setEdge(e.target.checked)} /> 深色描边<i>轮廓更清楚</i></label>}
              {picture.background !== 'clear' && <label><input type="checkbox" checked={cut} onChange={e => setCut(e.target.checked)} /> 去掉纯色背景</label>}
            </div>
            <button className="her-btn primary" disabled={busy || tooBig} onClick={() => { setBusy(true); void onUse(picture, source!.kind).finally(() => setBusy(false)) }}>{busy ? '…' : '放进草稿'}</button>
          </div>
        )}
      </div>
      <p className="her-faint" style={{ margin: 0 }}>只在这个页面里转，不上传、不保存。用别人的图自己玩没关系，分享出去要用自己有权分享的。</p>
    </div>
  )
}
