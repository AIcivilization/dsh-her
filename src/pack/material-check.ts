/**
 * What a material in the 素材库 should be (docs/设置页与编排设计.md §2.2):
 * checked, never refused. Each problem is said with what will happen, so
 * people who make their own know what to change. Pure.
 */

export interface MaterialInfo {
  kind: 'video' | 'image'
  width?: number
  height?: number
  durationMs?: number
  /** Has a transparent background (WebM with alpha, PNG/WebP/GIF with an alpha channel, SVG). */
  alpha?: boolean
  bytes: number
}

const MB = 1024 * 1024

export function checkMaterial(row: string, info: MaterialInfo): string[] {
  const out: string[] = []
  const { width, height } = info
  const shape = width !== undefined && height !== undefined && height > 0 ? width / height : undefined
  if (row === 'avatar') {
    if (shape !== undefined && Math.abs(shape - 1) > 0.12) out.push('不是正方形：放进圆形的小头像里，两边会留空或被裁掉')
    if (width !== undefined && Math.min(width, height ?? width) < 200) out.push('太小了（短边不到 200 像素），放大会糊；建议 512×512')
    if (info.kind === 'video' && (info.durationMs ?? 0) > 15_000) out.push('头像视频 15 秒以内就够，太长文件大')
  }
  if (row === 'pet') {
    if (info.alpha === false) out.push('没有透明背景：会连着底色一起浮在桌面上。要透明用带透明的 WebM 视频，或 PNG 图片')
    if (height !== undefined && height < 400) out.push('有点小（高不到 400 像素），桌面上会糊；建议高 1280 左右')
    if (info.kind === 'video' && (info.durationMs ?? 0) > 30_000) out.push('超过 30 秒：桌宠一段 5–10 秒、首尾能接上就好')
  }
  if (row === 'desktop') {
    if (shape !== undefined && (shape < 1.3 || shape > 2.4)) out.push('比例和电脑屏幕差很多：铺满屏幕时会裁掉一大块')
    if (width !== undefined && width < 1280) out.push('宽不到 1280 像素：铺满屏幕会糊；建议和屏幕一样大，比如 2560×1600')
  }
  if (info.bytes > 200 * MB) out.push(`文件很大（${Math.round(info.bytes / MB)} MB），加载会慢`)
  return out
}

/** What ffmpeg says of a picture or a clip, as size, length and transparency. */
export function parseFfmpegInfo(text: string, kind: MaterialInfo['kind'], bytes: number): MaterialInfo {
  const video = /Stream #[^\n]*Video:\s*(\w+)[^,\n]*(?:\([^)]*\))?,\s*(\w+)[^\n]*?(\d{2,5})x(\d{2,5})/.exec(text)
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(text)
  const codec = video?.[1] ?? ''
  const pixels = video?.[2] ?? ''
  const alpha = /alpha_mode\s*:\s*1/i.test(text) || /^(yuva|rgba|bgra|argb|abgr|ya|pal8|gbrap)/.test(pixels) || (codec === 'png' && /rgba|ya8|pal8/.test(pixels))
  const info: MaterialInfo = { kind, bytes, alpha }
  if (video !== null) {
    info.width = Number(video[3])
    info.height = Number(video[4])
  }
  if (kind === 'video' && duration !== null) info.durationMs = Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000)
  return info
}

/**
 * An SVG with nothing that runs: no scripts, no event handlers, no
 * embedded pages, no links out. What it was, and whether anything went.
 */
export function cleanSvg(text: string): { svg: string; removed: boolean } {
  let svg = text
  svg = svg.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*\/>/gi, '')
  svg = svg.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
  svg = svg.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  // Links only inside the picture (#id); anything else (http:, javascript:, data:) goes.
  svg = svg.replace(/\s+(xlink:)?href\s*=\s*("([^"]*)"|'([^']*)')/gi, (whole, _x, _q, a: string | undefined, b: string | undefined) => ((a ?? b ?? '').trim().startsWith('#') ? whole : ''))
  svg = svg.replace(/<!ENTITY[\s\S]*?>/gi, '')
  return { svg, removed: svg !== text }
}
