/**
 * Her opening clip shown over dsh's page (docs/设置页与编排设计.md §4.5): a
 * 像素动画 in its sandbox, or a video; a click skips it. When a dsh page
 * opens (web-float.ts), and right away when one is chosen in 像素工坊, so
 * choosing it shows it.
 */

import type { WebIntro } from '../dsh/api.ts'
import { herApi } from './api.ts'
import { inkOf, PixelFrame } from './pixel/host.ts'

export function showIntro(intro: WebIntro): void {
  const veil = document.createElement('div')
  veil.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.25);cursor:pointer'
  veil.title = '点一下跳过'
  if (intro.pixel !== undefined) {
    // A 像素动画 (docs/像素动画设计.md §6): drawn in its sandbox over the page, a click skips it.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const pixel = intro.pixel
    veil.style.background = 'rgba(0,0,0,.12)'
    const frame = new PixelFrame()
    const end = () => {
      frame.destroy()
      veil.remove()
    }
    frame.on(event => { if (event.t === 'ended' || event.t === 'problem') end() })
    veil.onclick = end
    veil.append(frame.el)
    setTimeout(end, 12_000)
    void herApi.pixelsCode(pixel.id).then(result => {
      if (!result.ok) return end()
      document.body.append(veil)
      frame.play(result.code, pixel.look, inkOf(pixel.look.color, '--dsw-alias-brand-primary'), { mode: 'once', cap: 8, fade: true })
    })
    return
  }
  if (intro.url === undefined) return
  const video = document.createElement('video')
  video.src = new URL(intro.url, document.baseURI).href
  video.muted = true
  video.playsInline = true
  video.autoplay = true
  video.style.cssText = 'max-width:80vw;max-height:80vh'
  veil.append(video)
  const end = () => veil.remove()
  veil.onclick = end
  video.onended = end
  video.onerror = end
  setTimeout(end, 8000)
  document.body.append(veil)
  void video.play().catch(end)
}
