// Bundle the body: main and preload for Electron's Node side (CommonJS), the
// renderer for the page. Native modules stay external.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { pixelPlayerHtml } from '../../scripts/pixel-player.mjs'

const common = { bundle: true, sourcemap: 'inline', logLevel: 'warning', target: 'es2023' }

mkdirSync('dist', { recursive: true })
await Promise.all([
  build({ ...common, entryPoints: ['main/index.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron', 'koffi', 'uiohook-napi'] }),
  build({ ...common, entryPoints: ['main/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['renderer/main.ts'], outfile: 'dist/renderer.js', platform: 'browser', format: 'iife' }),
  build({ ...common, entryPoints: ['renderer/bar-page.ts'], outfile: 'dist/bar.js', platform: 'browser', format: 'iife' }),
])
copyFileSync('renderer/index.html', 'dist/index.html')
copyFileSync('renderer/bar.html', 'dist/bar.html')
copyFileSync('renderer/intro.html', 'dist/intro.html')
// A 像素动画 as her opening clip: the same sandboxed player as in dsh's page.
writeFileSync('dist/pixel.html', await pixelPlayerHtml(build))
copyFileSync('renderer/mic-worklet.js', 'dist/mic-worklet.js')
