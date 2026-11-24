/**
 * 导出 GIF (docs/像素导出设计.md): a 像素动画 as a GIF that plays anywhere,
 * a WeChat sticker first. The animation runs in a sandbox of its own and
 * hands back its grids; the GIF is made here (src/core/pixel-export.ts).
 * What is shown is the GIF itself, so what one sees is what one gets, and on
 * a phone a long press saves it.
 */

import { useEffect, useRef, useState } from 'react'
import { inkOf, probePixel, renderFrames } from './pixel/host.ts'
import type { PixelInfo, PixelLook } from '../core/pixel.ts'
import { EXPORT_LENGTHS, EXPORT_PRESETS, exportPlan, joinFrames, makeGif, type ExportPreset, type ExportResult, type Rgb } from '../core/pixel-export.ts'
import { withBrand } from '../core/pixel-brand.ts'

const DARK = '#0e1726'
const BACKGROUNDS: Array<{ id: string; name: string }> = [
  { id: 'clear', name: '透明' },
  { id: DARK, name: '深色' },
  { id: '#ffffff', name: '白色' },
]

const fileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '').trim() || '像素动画'
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

type Grids = { key: string; info: PixelInfo; frames: Uint8ClampedArray[]; fps: number }

export function PixelExport({ code, name, look, onClose }: { code: string; name: string; look: PixelLook; onClose: () => void }) {
  const [info, setInfo] = useState<PixelInfo>()
  const [problem, setProblem] = useState<string>()
  const [preset, setPreset] = useState<ExportPreset>('wechat')
  const [background, setBackground] = useState<string>()
  const [dots, setDots] = useState(look.style === 'dots')
  const [pick, setPick] = useState(3)
  const [soft, setSoft] = useState(true)
  const [mark, setMark] = useState(false)
  const [carry, setCarry] = useState(true)
  const [grids, setGrids] = useState<Grids>()
  const [made, setMade] = useState<{ url: string; result: ExportResult }>()
  const [working, setWorking] = useState<string>()
  const box = useRef<HTMLDivElement>(null)
  const ink: Rgb = inkOf(look.color, '--dsw-alias-label-primary')

  useEffect(() => { box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [])

  // What it is (its loop, its length).
  useEffect(() => {
    let gone = false
    setInfo(undefined)
    setGrids(undefined)
    setProblem(undefined)
    setWorking('正在读动画……')
    void probePixel(code, ink).then(r => {
      if (gone) return
      if (!r.ok || r.info === undefined) {
        setWorking(undefined)
        setProblem(r.problems.join('；'))
      } else setInfo(r.info)
    })
    return () => { gone = true }
  }, [code])

  const plan = info === undefined ? undefined : exportPlan(info, pick, soft)

  // Its grids, worked out in the sandbox: again only when what is recorded changes.
  const planKey = plan === undefined ? '' : `${plan.fps}:${plan.times.length}:${plan.join}`
  useEffect(() => {
    if (plan === undefined || grids?.key === planKey) return
    let gone = false
    setWorking('正在一帧一帧算画面……')
    void renderFrames(code, plan.times).then(r => {
      if (gone) return
      if (!r.ok || r.info === undefined || r.frames === undefined) {
        setWorking(undefined)
        setProblem(r.problems.join('；'))
        return
      }
      setGrids({ key: planKey, info: r.info, frames: joinFrames(r.frames, plan), fps: plan.fps })
    })
    return () => { gone = true }
  }, [planKey, code])

  const mono = info?.color !== 'color'
  const bg = background ?? (preset === 'wechat' || !mono ? 'clear' : DARK)

  // The GIF: made again whenever a choice changes (a moment later, so the page shows it is working).
  useEffect(() => {
    if (grids === undefined || grids.key !== planKey) return
    setWorking('正在做 GIF……')
    const timer = setTimeout(() => {
      const result = makeGif({
        info: grids.info, frames: grids.frames, fps: grids.fps, preset,
        look: { style: dots ? 'dots' : 'blocks', ink, background: bg, mark },
        ...(carry ? { source: { name, code, look } } : {}),
      })
      const url = URL.createObjectURL(new Blob([result.bytes], { type: 'image/gif' }))
      setMade({ url, result })
      setWorking(undefined)
    }, 30)
    return () => clearTimeout(timer)
  }, [grids, preset, bg, dots, mark, carry, ink.join(), name])

  useEffect(() => () => { if (made !== undefined) URL.revokeObjectURL(made.url) }, [made])

  const file = () => new File([made!.result.bytes], `${fileName(name)}.gif`, { type: 'image/gif' })
  const download = () => {
    if (made === undefined) return
    const a = document.createElement('a')
    a.href = made.url
    a.download = `${fileName(name)}.gif`
    a.click()
  }
  const canShare = made !== undefined && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file()] })
  const share = () => void navigator.share({ files: [file()] }).catch(() => undefined)
  const exportJs = () => {
    const url = URL.createObjectURL(new Blob([withBrand(code)], { type: 'text/javascript' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName(name)}.js`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const r = made?.result
  const budget = EXPORT_PRESETS[preset].budget
  const joinSaid = plan === undefined ? '' : plan.join === 'loop'
    ? `一圈 ${Math.round(plan.seconds * 100) / 100} 秒，首尾正好接上`
    : plan.join === 'once' ? `播一遍 ${Math.round(plan.seconds * 10) / 10} 秒，然后从头再来` : ''

  return (
    <div ref={box} className="her-export">
      <div className="her-export-head">
        <b>📤 导出 GIF<span className="her-wechat-word"> · 做微信表情</span></b>
        <button className="her-btn small" onClick={onClose}>收起</button>
      </div>
      {problem !== undefined && <p className="her-danger">{problem}</p>}
      <div className="her-export-body">
        <div className="her-export-view">
          {made !== undefined ? <img src={made.url} alt={`${name}（GIF）`} /> : <span className="her-faint">{working ?? '…'}</span>}
          {made !== undefined && working !== undefined && <span className="her-export-busy">{working}</span>}
        </div>
        <div className="her-export-set">
          <div className="her-export-presets" role="group" aria-label="做成什么">
            {(Object.keys(EXPORT_PRESETS) as ExportPreset[]).map(id => (
              <button key={id} className={preset === id ? 'on' : ''} onClick={() => setPreset(id)}>
                <b>{EXPORT_PRESETS[id].name}</b><small>{EXPORT_PRESETS[id].about}</small>
              </button>
            ))}
          </div>
          <div className="her-ws-set">
            <b>背景</b>
            <span className="her-row" style={{ margin: 0 }}>
              <span className="her-seg" role="group" aria-label="背景">
                {BACKGROUNDS.map(b => <button key={b.id} className={bg === b.id ? 'on' : ''} onClick={() => setBackground(b.id)}>{b.name}</button>)}
              </span>
              <input type="color" aria-label="选一个背景颜色" value={bg === 'clear' ? DARK : bg} onChange={e => setBackground(e.target.value)} />
            </span>
            {bg === 'clear' && mono && <span className="her-faint">GIF 的透明只有"有"和"没有"：淡的地方会画得深一点，而不是半透明。</span>}
          </div>
          {mono && (
            <div className="her-ws-set">
              <b>画法</b>
              <span className="her-seg" role="group" aria-label="画法">
                <button className={!dots ? 'on' : ''} onClick={() => setDots(false)}>方块</button>
                <button className={dots ? 'on' : ''} onClick={() => setDots(true)}>圆点</button>
              </span>
              {look.style === 'code' && <span className="her-faint">代码字导出成方块或圆点。</span>}
            </div>
          )}
          {plan !== undefined && (plan.join === 'soft' || plan.join === 'cut') ? (
            <div className="her-ws-set">
              <b>录几秒</b>
              <span className="her-row" style={{ margin: 0 }}>
                <span className="her-seg" role="group" aria-label="录几秒">
                  {EXPORT_LENGTHS.map(s => <button key={s} className={pick === s ? 'on' : ''} onClick={() => setPick(s)}>{s} 秒</button>)}
                </span>
                <label className="her-muted"><input type="checkbox" checked={soft} onChange={e => setSoft(e.target.checked)} /> 首尾柔接（结尾慢慢变回开头，不跳）</label>
              </span>
            </div>
          ) : joinSaid !== '' && <span className="her-faint">{joinSaid}</span>}
          {r !== undefined && (
            <p className={preset === 'wechat' ? (r.fits ? 'her-ok' : 'her-danger') : 'her-muted'} style={{ margin: 0 }}>
              {r.width} × {r.height}，{r.frames} 帧（每秒 {Math.round(r.fps * 10) / 10} 帧），{kb(r.bytes.length)}
              {preset === 'wechat' && (r.fits ? ' ✓ 能加到微信表情' : `：比 ${kb(budget)} 大，微信可能加不上。试试「录几秒」少一点，或者换「方形大图」发图片`)}
            </p>
          )}
          <span className="her-row" style={{ margin: 0 }}>
            <button className="her-btn primary" disabled={made === undefined} onClick={download}>下载 GIF</button>
            {canShare && <button className="her-btn" onClick={share}>分享…</button>}
          </span>
          <p className="her-faint" style={{ margin: 0 }}>
            加到微信表情：手机上长按上面的图存进相册（或点「分享…」），在微信聊天里点表情 → ＋ → 选这张。电脑上把 GIF 拖进微信发给「文件传输助手」，再右键它 → 添加到表情。
          </p>
          <details className="her-more">
            <summary>更多</summary>
            <div className="her-ws-set" style={{ marginTop: 8 }}>
              <label className="her-muted"><input type="checkbox" checked={carry} onChange={e => setCarry(e.target.checked)} /> 把原文件藏进 GIF（别人拖进像素工坊就能接着改；有的网站会把它弄丢）</label>
              {carry && r !== undefined && !r.carries && <span className="her-faint">这个动画的文件太大，这一张没藏进去。</span>}
              <label className="her-muted"><input type="checkbox" checked={mark} onChange={e => setMark(e.target.checked)} /> 角落放一只像素小鲸鱼</label>
              <span className="her-row" style={{ margin: 0 }}><button className="her-btn small" onClick={exportJs}>导出 .js（动画文件本身）</button></span>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
