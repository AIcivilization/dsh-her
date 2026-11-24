// The 像素动画 player page (src/client/pixel/player.ts with its worker inlined),
// as one HTML file that loads nothing: bundled into the plugin's client for
// dsh's page and written to body/dist/pixel.html for the desktop's opening clip.
// The caller passes its own esbuild `build`: the body is built with only
// body/node_modules installed (CI), the plugin with the root's.
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

/** No network, no frames, no forms: inline script and blob workers only. */
export const PIXEL_CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:"

export async function pixelPlayerHtml(build) {
  const common = { bundle: true, write: false, platform: 'browser', target: 'es2022', format: 'iife', legalComments: 'none', logLevel: 'warning', absWorkingDir: root, minify: true }
  const worker = (await build({ ...common, entryPoints: ['src/client/pixel/worker.ts'] })).outputFiles[0].text
  const player = (await build({ ...common, entryPoints: ['src/client/pixel/player.ts'], define: { __PIXEL_WORKER__: JSON.stringify(worker) } })).outputFiles[0].text
  if (player.includes('</script')) throw new Error('the player bundle contains </script')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>像素动画</title>
<meta http-equiv="Content-Security-Policy" content="${PIXEL_CSP}">
<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}canvas{position:fixed;inset:0;width:100%;height:100%;display:block}</style>
</head><body><canvas id="c"></canvas>
<script>${player}</script>
</body></html>
`
}
