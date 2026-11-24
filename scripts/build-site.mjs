// Build the project page (site/) into _site/ for GitHub Pages: the page and
// its style copied, the script bundled with our own pixel animation code.
// Runs the same on macOS, Windows and Linux.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'

const out = new URL('../_site/', import.meta.url)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const f of ['index.html', 'style.css']) copyFileSync(new URL(`../site/${f}`, import.meta.url), new URL(f, out))
await build({
  entryPoints: ['site/main.ts'],
  outfile: '_site/main.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
})
console.log('site → _site/')
