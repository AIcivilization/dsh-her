/**
 * Skins (docs/设置页与编排设计.md §4): a whole look for dsh itself — its
 * colours through dsh's own theme (token overrides, a light and a dark value
 * each), and on top of that, our own CSS for a background picture, a font,
 * her talk bar and bubble, and a skin's own extra CSS. A skin is a folder
 * with `skin.json` and its files; two come built in. Pure.
 */

export const SKIN_FORMAT = 'dsh-her-skin@1'

export interface Pair {
  light: string
  dark: string
}

export interface Skin {
  format?: typeof SKIN_FORMAT
  id: string
  name: string
  author?: string
  /** dsh's colour tokens (`--dsw-alias-…`), each for light and dark. */
  colors?: Record<string, Pair>
  /** A picture behind the whole page (a file in the skin's folder), and how dark a veil over it is (0–0.9). */
  background?: { file: string; dim?: number }
  /** A font: a file in the folder (woff2, woff, ttf, otf) or the name of one installed on the computer. */
  font?: { file?: string; name?: string }
  /** Her talk bar and bubble. */
  bar?: { background?: Pair; text?: Pair; accent?: Pair }
  /** A short clip played when she comes out (a file in the folder). */
  intro?: string
  /** A file of extra CSS, for those who want more (may need fixing when dsh changes). */
  css?: string
  /** Built in, not a folder. */
  builtin?: boolean
}

const pair = (light: string, dark: string): Pair => ({ light, dark })

/** The ones that come with her: no files, colours only. */
export const BUILTIN_SKINS: Skin[] = [
  {
    id: 'whale-blue', name: '鲸鱼蓝', builtin: true,
    colors: {
      '--dsw-alias-bg-base': pair('#f3f8fe', '#0b1626'),
      '--dsw-alias-bg-layer-1': pair('#ffffff', '#102036'),
      '--dsw-alias-bg-layer-2': pair('#f8fbff', '#13263f'),
      '--dsw-specific-sidebar-fill': pair('#e8f1fc', '#0d1b2e'),
      '--dsw-specific-bubble': pair('#dcebfd', '#1a3354'),
      '--dsw-specific-input-major': pair('#ffffff', '#122741'),
      '--dsw-alias-brand-primary': pair('#1f5fa8', '#9cc8ff'),
      '--dsw-alias-link': pair('#2a6fd1', '#7fb6ff'),
      '--dsw-alias-state-business-primary': pair('#2a7de1', '#6fb1ff'),
      '--dsw-specific-sidebar-nav-item-active': pair('#d3e5fb', '#1b3557'),
    },
    bar: { background: pair('rgba(240,247,255,0.97)', 'rgba(12,28,48,0.96)'), text: pair('#0f2a4a', '#e6f1ff'), accent: pair('#2a7de1', '#7fb6ff') },
  },
  {
    id: 'deep-sea', name: '深海夜', builtin: true,
    colors: {
      '--dsw-alias-bg-base': pair('#e9eef6', '#050b16'),
      '--dsw-alias-bg-layer-1': pair('#f4f7fb', '#0a1424'),
      '--dsw-alias-bg-layer-2': pair('#eef3f9', '#0e1a2e'),
      '--dsw-specific-sidebar-fill': pair('#dfe7f2', '#040a14'),
      '--dsw-specific-bubble': pair('#d5e0ef', '#14223a'),
      '--dsw-specific-input-major': pair('#f4f7fb', '#0c1828'),
      '--dsw-alias-brand-primary': pair('#163a66', '#7ad0ff'),
      '--dsw-alias-link': pair('#1d5aa0', '#5fc4ff'),
      '--dsw-alias-state-business-primary': pair('#1d5aa0', '#3fb7ff'),
      '--dsw-specific-sidebar-nav-item-active': pair('#cbd9ec', '#122440'),
    },
    bar: { background: pair('rgba(233,239,247,0.97)', 'rgba(4,12,24,0.96)'), text: pair('#0b1f38', '#d8ecff'), accent: pair('#1d5aa0', '#3fb7ff') },
  },
]

const isPair = (v: unknown): v is Pair => typeof v === 'object' && v !== null && typeof (v as Pair).light === 'string' && typeof (v as Pair).dark === 'string'
/** A value that stays a value: no way out of its declaration. */
const safeValue = (v: string) => !/[;{}<>]|url\s*\(|expression|@import/i.test(v) && v.length <= 200
const safeFile = (v: unknown, exts: RegExp) => typeof v === 'string' && /^[^/\\]+$/.test(v) && !v.startsWith('.') && exts.test(v)

/**
 * Read a skin.json. What is wrong is left out and said; a skin with nothing
 * usable gives none. `files` are the names in its folder.
 */
export function parseSkin(raw: unknown, id: string, files: readonly string[]): { skin?: Skin; problems: string[] } {
  const problems: string[] = []
  if (typeof raw !== 'object' || raw === null) return { problems: ['skin.json 不是一个 JSON 对象'] }
  const v = raw as Record<string, unknown>
  const skin: Skin = { format: SKIN_FORMAT, id, name: typeof v.name === 'string' && v.name.trim() !== '' ? v.name.trim().slice(0, 40) : id }
  if (typeof v.author === 'string') skin.author = v.author.slice(0, 60)
  const has = (file: string) => files.includes(file)
  if (v.colors !== undefined) {
    const colors: Record<string, Pair> = {}
    for (const [name, value] of Object.entries(v.colors as Record<string, unknown>)) {
      if (!/^--dsw-[a-z0-9-]+$/.test(name)) problems.push(`颜色名 ${name} 不对：要是 dsh 的 --dsw-… 颜色`)
      else if (!isPair(value) || !safeValue(value.light) || !safeValue(value.dark)) problems.push(`颜色 ${name} 要写成 { "light": "#...", "dark": "#..." }`)
      else colors[name] = { light: value.light, dark: value.dark }
    }
    if (Object.keys(colors).length > 0) skin.colors = colors
  }
  const bg = v.background as { file?: unknown; dim?: unknown } | undefined
  if (bg !== undefined) {
    if (safeFile(bg.file, /\.(png|jpe?g|webp|gif|avif)$/i) && has(bg.file as string)) skin.background = { file: bg.file as string, ...(typeof bg.dim === 'number' ? { dim: Math.min(0.9, Math.max(0, bg.dim)) } : {}) }
    else problems.push('背景图要是这个文件夹里的一张图片（png、jpg、webp、gif、avif）')
  }
  const font = v.font as { file?: unknown; name?: unknown } | undefined
  if (font !== undefined) {
    if (font.file !== undefined && safeFile(font.file, /\.(woff2?|ttf|otf)$/i) && has(font.file as string)) skin.font = { file: font.file as string }
    else if (typeof font.name === 'string' && /^[\w一-鿿 \-]{1,60}$/.test(font.name)) skin.font = { name: font.name }
    else problems.push('字体要是这个文件夹里的字体文件（woff2、woff、ttf、otf），或者电脑上装好的字体名')
  }
  const bar = v.bar as Record<string, unknown> | undefined
  if (bar !== undefined) {
    const out: NonNullable<Skin['bar']> = {}
    for (const key of ['background', 'text', 'accent'] as const) {
      const value = bar[key]
      if (value === undefined) continue
      if (isPair(value) && safeValue(value.light) && safeValue(value.dark)) out[key] = value
      else problems.push(`bar.${key} 要写成 { "light": …, "dark": … }`)
    }
    if (Object.keys(out).length > 0) skin.bar = out
  }
  if (v.intro !== undefined) {
    if (safeFile(v.intro, /\.(mp4|webm|mov|m4v)$/i) && has(v.intro as string)) skin.intro = v.intro as string
    else problems.push('开机动画要是这个文件夹里的一段视频（mp4、webm）')
  }
  if (v.css !== undefined) {
    if (safeFile(v.css, /\.css$/i) && has(v.css as string)) skin.css = v.css as string
    else problems.push('css 要是这个文件夹里的一个 .css 文件')
  }
  return { skin, problems }
}

/** The colour overrides for dsh's theme, with the talk bar's own as `--her-bar-*`. */
export function skinTokens(skin: Skin): Record<string, Pair> {
  return { ...skin.colors }
}

/**
 * Our CSS for a skin: the background, the font, the talk bar's colours (for
 * light and dark: dsh marks dark with `body[data-ds-dark-theme]`), and the
 * skin's own CSS (given as text). `file` gives a file's address.
 */
export function skinCss(skin: Skin, file: (name: string) => string, extra = ''): string {
  const out: string[] = []
  if (skin.background !== undefined) {
    const dim = skin.background.dim ?? 0.35
    out.push(`body{background-image:linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})),url("${file(skin.background.file)}")!important;background-size:cover!important;background-position:center!important;background-attachment:fixed!important}`)
    // The page's own layers let the picture through.
    out.push('body{--dsw-alias-bg-base:transparent!important}')
  }
  if (skin.font?.file !== undefined) {
    out.push(`@font-face{font-family:"dsh-her-skin";src:url("${file(skin.font.file)}");font-display:swap}`)
    out.push('body{--dsw-font-family:"dsh-her-skin",var(--dsh-font-family-text-default)!important;font-family:"dsh-her-skin",var(--dsh-font-family-text-default)}')
  } else if (skin.font?.name !== undefined) {
    out.push(`body{--dsw-font-family:"${skin.font.name}",var(--dsh-font-family-text-default)!important;font-family:"${skin.font.name}",var(--dsh-font-family-text-default)}`)
  }
  const bar = skin.bar
  if (bar !== undefined) {
    const vars = (mode: 'light' | 'dark') => [
      bar.background === undefined ? '' : `--her-bar-bg:${bar.background[mode]};`,
      bar.text === undefined ? '' : `--her-bar-text:${bar.text[mode]};`,
      bar.accent === undefined ? '' : `--her-bar-accent:${bar.accent[mode]};`,
    ].join('')
    out.push(`body{${vars('light')}}`, `body[data-ds-dark-theme]{${vars('dark')}}`)
  }
  if (extra !== '') out.push(extra)
  return out.join('\n')
}
