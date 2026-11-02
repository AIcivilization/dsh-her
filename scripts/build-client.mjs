// Bundle src/client into lib/client.js in DSH's browser module format:
//   window.__ModuleLoader__.load({ id, factory: (require) => module.exports })
// React and cordis come from the page through the injected `require`;
// everything else is bundled. Runs the same on macOS, Windows and Linux.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// Modules the DSH page provides to browser plugins.
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const result = await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  legalComments: 'inline',
  logLevel: 'warning',
})

const body = result.outputFiles[0].text
const out = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body}
\t\treturn module.exports;
\t}
});
`
mkdirSync(new URL('../lib', import.meta.url), { recursive: true })
writeFileSync(new URL('../lib/client.js', import.meta.url), out)

const required = [...body.matchAll(/require\("([^"]+)"\)/g)].map(m => m[1])
const stray = required.filter(r => !PLATFORM_MODULES.includes(r))
if (stray.length > 0) {
  console.error(`client bundle requires modules the page does not provide: ${stray.join(', ')}`)
  process.exit(1)
}
console.log(`lib/client.js: ${(out.length / 1024).toFixed(1)} KiB, externals: ${[...new Set(required)].join(', ')}`)

// The web body's page (src/client/web-bridge.ts + the body's renderer), served by the brain.
await build({
  entryPoints: ['src/client/web-body-entry.ts'],
  bundle: true,
  outfile: 'lib/web-body/renderer.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'inline',
  logLevel: 'warning',
})
copyFileSync('body/renderer/mic-worklet.js', 'lib/web-body/mic-worklet.js')
// Clips come from DSH's own address here, not file: URLs.
const html = readFileSync('body/renderer/index.html', 'utf8')
const csp = /<meta http-equiv="Content-Security-Policy"[^>]*>/
if (!csp.test(html)) throw new Error('body/renderer/index.html has no CSP to replace')
// The window is small here: her words go over the top of a scene, whatever its layout says.
const WEB_STYLE = `<style>
    body.scene #bubble, body.region.scene #bubble { left: 4%; right: 4%; width: auto; top: 6px; bottom: auto; justify-content: center; }
    /* As the page's background: clear of her face, up in a corner. */
    body.wallpaper.scene #bubble { left: auto !important; right: 4%; width: min(34%, 420px); top: 56px; bottom: auto !important; justify-content: flex-end; }
  </style>
</head>`
writeFileSync('lib/web-body/index.html', html
  .replace(csp, `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'">`)
  .replace('</head>', WEB_STYLE))
console.log('lib/web-body: page and renderer')
