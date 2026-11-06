// Bundle the body: main and preload for Electron's Node side (CommonJS), the
// renderer for the page. Native modules stay external.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

const common = { bundle: true, sourcemap: 'inline', logLevel: 'warning', target: 'es2023' }

mkdirSync('dist', { recursive: true })
await Promise.all([
  build({ ...common, entryPoints: ['main/index.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron', 'koffi', 'uiohook-napi'] }),
  build({ ...common, entryPoints: ['main/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['renderer/main.ts'], outfile: 'dist/renderer.js', platform: 'browser', format: 'iife' }),
  build({ ...common, entryPoints: ['renderer/panel.ts'], outfile: 'dist/panel.js', platform: 'browser', format: 'iife' }),
  build({ ...common, entryPoints: ['renderer/bar-page.ts'], outfile: 'dist/bar.js', platform: 'browser', format: 'iife' }),
])
copyFileSync('renderer/index.html', 'dist/index.html')
copyFileSync('renderer/panel.html', 'dist/panel.html')
copyFileSync('renderer/bar.html', 'dist/bar.html')
copyFileSync('renderer/mic-worklet.js', 'dist/mic-worklet.js')
