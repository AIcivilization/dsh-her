// Bundle the body: main and preload for Electron's Node side (CommonJS), the
// renderer for the page. Native modules stay external.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

const common = { bundle: true, sourcemap: 'inline', logLevel: 'warning', target: 'es2023' }

mkdirSync('dist', { recursive: true })
await Promise.all([
  build({ ...common, entryPoints: ['main/index.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron', 'koffi'] }),
  build({ ...common, entryPoints: ['main/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['renderer/main.ts'], outfile: 'dist/renderer.js', platform: 'browser', format: 'iife' }),
])
copyFileSync('renderer/index.html', 'dist/index.html')
