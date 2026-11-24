/**
 * Where a 像素动画 came from (docs/像素导出设计.md §5): one comment line at
 * the top of every file the workshop makes or hands out, with the project's
 * page, so a file passed on leads back here. Nothing on the picture itself
 * (the little whale is off unless one turns it on). Pure.
 */

export const SITE_URL = 'https://aicivilization.github.io/dsh-her/'

/** The line at the top of a file. */
export const BRAND_LINE = `// 用 dsh-her 像素工坊做的 · ${SITE_URL}`

/** The words in a GIF's comment (plain ASCII: some readers show nothing else). */
export const GIF_COMMENT = `Made with dsh-her pixel workshop - ${SITE_URL}`

/** The file with our line at its top: added when it is not there (the AI, or a person, may have taken it off). */
export function withBrand(code: string): string {
  if (code.includes(SITE_URL)) return code
  return `${BRAND_LINE}\n${code}`
}
