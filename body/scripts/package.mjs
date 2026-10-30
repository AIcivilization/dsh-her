// Package the body as an app for this platform, the way the plugin downloads it:
//
//   node scripts/package.mjs [--ffmpeg /path/to/ffmpeg] [--out ../release]
//
// - macOS: Electron.app copied as "dsh-her.app" with the body in
//   Contents/Resources/app and ffmpeg in Contents/Resources/ffmpeg; Info.plist
//   gets her name, a menu-bar-only flag and the microphone reason; then an
//   ad-hoc signature (Apple Silicon runs nothing unsigned; a Developer ID
//   signature and notarization replace it for a public release).
// - The zip is `dsh-her-body-<version>-<platform>-<arch>.zip`, and
//   `body-latest.json` lists it with its size and SHA-256: the plugin reads
//   that file from the release to know what to download and to check it.
//
// ffmpeg (for importing looks) is a separate program inside the app. The one
// found on PATH is used unless --ffmpeg names another: for a public release,
// choose a static build on purpose and ship its licence (an --enable-gpl
// build is GPL: say so and point to its source).

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const bodyDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const out = resolve(option('--out') ?? join(bodyDir, '..', 'release'))
const pkg = JSON.parse(readFileSync(join(bodyDir, 'package.json'), 'utf8'))
const version = pkg.version
const platform = process.platform
const arch = process.arch
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: 'inherit', ...opts })

if (platform !== 'darwin') {
  console.error('现在只会打 mac 的包；Windows 的等有测试机再加')
  process.exit(1)
}

const ffmpeg = option('--ffmpeg') ?? execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim()
if (!existsSync(ffmpeg)) throw new Error(`找不到 ffmpeg：${ffmpeg}`)
const linked = execFileSync('otool', ['-L', ffmpeg], { encoding: 'utf8' }).split('\n').slice(1).map(l => l.trim()).filter(Boolean)
const foreign = linked.filter(l => !l.startsWith('/usr/lib/') && !l.startsWith('/System/'))
if (foreign.length > 0) throw new Error(`这个 ffmpeg 依赖本机的库，放进 app 别人用不了：\n${foreign.join('\n')}\n换一个静态编译的（--ffmpeg）`)

console.log(`dsh-her body ${version} → ${platform}-${arch}`)
run('npm', ['run', 'build'], { cwd: bodyDir })

const stage = join(out, `stage-${platform}-${arch}`)
const app = join(stage, 'dsh-her.app')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
// ditto keeps the framework symlinks and permissions intact.
run('ditto', [join(bodyDir, 'node_modules', 'electron', 'dist', 'Electron.app'), app])

const resources = join(app, 'Contents', 'Resources')
rmSync(join(resources, 'default_app.asar'), { force: true })
const appDir = join(resources, 'app')
mkdirSync(appDir, { recursive: true })
cpSync(join(bodyDir, 'dist'), join(appDir, 'dist'), { recursive: true })
writeFileSync(join(appDir, 'package.json'), `${JSON.stringify({ name: pkg.name, productName: 'dsh-her', version, main: pkg.main, license: pkg.license }, null, 2)}\n`)
copyFileSync(ffmpeg, join(resources, 'ffmpeg'))
writeFileSync(join(resources, 'ffmpeg-NOTICE.txt'), [
  'ffmpeg (https://ffmpeg.org) is included as a separate program, used to import appearance packs.',
  `Build: ${execFileSync(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8' }).split('\n').slice(0, 3).join('\n')}`,
  'Its licence follows its build configuration (LGPL, or GPL when built with --enable-gpl); its source is at https://ffmpeg.org/download.html.',
  '',
].join('\n'))

const plist = join(app, 'Contents', 'Info.plist')
const set = (key, type, value) => {
  try { run('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist], { stdio: 'ignore' }) } catch { /* not there */ }
  run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, plist])
}
set('CFBundleName', 'string', 'dsh-her')
set('CFBundleDisplayName', 'string', '她')
set('CFBundleIdentifier', 'string', 'ai.aicivilization.dsh-her.body')
set('CFBundleShortVersionString', 'string', version)
set('CFBundleVersion', 'string', version)
set('LSUIElement', 'bool', 'true')
set('NSMicrophoneUsageDescription', 'string', '她要听你说话（按快捷键说话、或一直在听时）')

run('codesign', ['--force', '--deep', '--sign', '-', app])

const zipName = `dsh-her-body-${version}-${platform}-${arch}.zip`
const zip = join(out, zipName)
rmSync(zip, { force: true })
run('ditto', ['-c', '-k', '--keepParent', app, zip])
rmSync(stage, { recursive: true, force: true })

const sha256 = createHash('sha256').update(readFileSync(zip)).digest('hex')
const manifestFile = join(out, 'body-latest.json')
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {}
const next = {
  format: 'dsh-her-body@1',
  version,
  assets: { ...(manifest.version === version ? manifest.assets : {}), [`${platform}-${arch}`]: { file: zipName, size: statSync(zip).size, sha256 } },
}
writeFileSync(manifestFile, `${JSON.stringify(next, null, 2)}\n`)
console.log(`→ ${zip}（${(statSync(zip).size / 1e6).toFixed(1)} MB）\n→ ${manifestFile}`)
