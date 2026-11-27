// Package the body as an app for this platform, the way the plugin downloads it:
//
//   node scripts/package.mjs [--ffmpeg /path/to/ffmpeg] [--out ../release] [--player]
//
// --player packages 真人桌宠 instead (docs/独立安装包设计.md, docs/实施计划.md
// step 5): the same body under another name, identifier and data folder,
// that runs its own small brain and opens 设计包 (`.her`). Its zip is
// `dsh-her-player-<version>-<platform>-<arch>.zip`, listed in
// `player-latest.json`; it never touches the body's files in the release.
//
// - macOS: Electron.app copied as "dsh-her.app" with the body in
//   Contents/Resources/app and ffmpeg in Contents/Resources/ffmpeg; Info.plist
//   gets her name, a menu-bar-only flag and the microphone reason; then an
//   ad-hoc signature (Apple Silicon runs nothing unsigned; a Developer ID
//   signature and notarization replace it for a public release).
// - Windows (run on Windows; CI does it, .github/workflows/ci.yml): Electron's
//   folder copied as "dsh-her" with electron.exe renamed dsh-her.exe, the body
//   in resources/app (with koffi for the wallpaper layer), ffmpeg.exe in
//   resources; rcedit gives the exe her name and icon (drawn in code,
//   shared/icon.ts). --ffmpeg is required: name the ffmpeg.exe to ship.
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
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { crc32, deflateRawSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ico } from './ico.mjs'

const bodyDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const out = resolve(option('--out') ?? join(bodyDir, '..', 'release'))
const pkg = JSON.parse(readFileSync(join(bodyDir, 'package.json'), 'utf8'))
const version = pkg.version
const platform = process.platform
const arch = process.arch
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: 'inherit', ...opts })

/** 真人桌宠 or the body: everything that differs between the two packages. */
const PLAYER = args.includes('--player')
const kind = PLAYER
  ? {
    name: '真人桌宠', exe: '真人桌宠', bundleId: 'ai.aicivilization.zhenren-zhuochong', display: '真人桌宠',
    asset: 'dsh-her-player', manifest: 'player-latest.json', format: 'dsh-her-player@1', description: '真人桌宠',
  }
  : {
    name: 'dsh-her', exe: 'dsh-her', bundleId: 'ai.aicivilization.dsh-her.body', display: '她',
    asset: 'dsh-her-body', manifest: 'body-latest.json', format: 'dsh-her-body@1', description: '她',
  }

if (platform !== 'darwin' && platform !== 'win32') {
  console.error('现在只会打 macOS 和 Windows 的包')
  process.exit(1)
}

const ffmpeg = option('--ffmpeg') ?? (platform === 'win32' ? undefined : execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim())
if (ffmpeg === undefined) throw new Error('Windows 要用 --ffmpeg 指定要放进包里的 ffmpeg.exe')
if (!existsSync(ffmpeg)) throw new Error(`找不到 ffmpeg：${ffmpeg}`)
if (platform === 'darwin') {
  const linked = execFileSync('otool', ['-L', ffmpeg], { encoding: 'utf8' }).split('\n').slice(1).map(l => l.trim()).filter(Boolean)
  const foreign = linked.filter(l => !l.startsWith('/usr/lib/') && !l.startsWith('/System/'))
  if (foreign.length > 0) throw new Error(`这个 ffmpeg 依赖本机的库，放进 app 别人用不了：\n${foreign.join('\n')}\n换一个静态编译的（--ffmpeg）`)
}

console.log(`${kind.name} ${version} → ${platform}-${arch}`)
// Electron 44 no longer downloads its program on install: fetch it (checked against its checksums) when missing.
if (!existsSync(join(bodyDir, 'node_modules', 'electron', 'dist'))) run(process.execPath, [join(bodyDir, 'node_modules', 'electron', 'install.js')], { cwd: bodyDir })
run('npm', ['run', 'build'], { cwd: bodyDir, shell: platform === 'win32' })

const stage = join(out, `stage-${platform}-${arch}`)
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
const notice = [
  'ffmpeg (https://ffmpeg.org) is included as a separate program, used to import appearance packs.',
  `Build: ${execFileSync(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8' }).split('\n').slice(0, 3).join('\n')}`,
  'Its licence follows its build configuration (LGPL, or GPL when built with --enable-gpl); its source is at https://ffmpeg.org/download.html.',
  '',
].join('\n')
/** The body itself, as Electron loads it from resources/app. */
const putApp = (resources) => {
  rmSync(join(resources, 'default_app.asar'), { force: true })
  const appDir = join(resources, 'app')
  mkdirSync(appDir, { recursive: true })
  cpSync(join(bodyDir, 'dist'), join(appDir, 'dist'), { recursive: true })
  // The keyboard hook for holding a key to talk (main.cjs keeps it external); its prebuilt binaries cover every platform.
  for (const dep of ['uiohook-napi', 'node-gyp-build']) {
    const from = join(bodyDir, 'node_modules', dep)
    if (!existsSync(from)) throw new Error(`缺少 ${dep}（运行 npm ci）`)
    cpSync(from, join(appDir, 'node_modules', dep), { recursive: true })
  }
  // `standalone`: the body knows it is 真人桌宠 (main/standalone.ts).
  writeFileSync(join(appDir, 'package.json'), `${JSON.stringify({ name: pkg.name, productName: kind.name, version, main: pkg.main, license: pkg.license, ...(PLAYER ? { standalone: true } : {}) }, null, 2)}\n`)
  if (PLAYER) {
    writeFileSync(join(resources, 'NOTICE.txt'), playerNotice)
    // agent-autoloop (docs/实施计划.md step 12): the pinned copy, fetched and checked by scripts/fetch-autoloop.mjs.
    run(process.execPath, [join(bodyDir, '..', 'scripts', 'fetch-autoloop.mjs')])
    cpSync(join(bodyDir, 'vendor', 'agent-autoloop'), join(resources, 'agent-autoloop'), { recursive: true })
  }
  return appDir
}

/** What 真人桌宠 ships with: whose engine it is, and that it needs no account. */
const playerNotice = [
  '真人桌宠 — 身体引擎 dsh-her（https://github.com/AIcivilization/dsh-her），MIT 许可。',
  '设计包（.her）是各自作者的作品，许可写在设计包里，装之前会给你看。',
  '不聊天时不要账号、不要 key；聊天时只和你选的那一家说话；除了每天看一次有没有新版，不联网。',
  '接活用的 agent-autoloop（https://github.com/KKKKhazix/agent-autoloop）是 MIT 许可，作者 数字生命卡兹克，许可全文在 agent-autoloop/LICENSE。',
  '',
].join('\n')

/**
 * Zip a folder: every file deflated (stored when that is not smaller), names
 * as UTF-8 under `name(relative path)`, one file in memory at a time.
 */
function writeZip(out, root, name) {
  const files = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (entry.isFile()) files.push(rel)
    }
  }
  walk(root, '')
  const fd = openSync(out, 'w')
  const central = []
  let offset = 0
  const put = (buffer) => { writeSync(fd, buffer); offset += buffer.length }
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  for (const rel of files) {
    const data = readFileSync(join(root, ...rel.split('/')))
    const packed = deflateRawSync(data, { level: 9 })
    const stored = packed.length >= data.length
    const body = stored ? data : packed
    const crc = crc32(data)
    const nameBytes = Buffer.from(name(rel), 'utf8')
    if (offset > 0xffffffff - body.length - 1024) throw new Error('包超过 4 GB 了')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(20, 6)
    head.writeUInt16LE(0x0800, 8)
    head.writeUInt16LE(stored ? 0 : 8, 10)
    head.writeUInt16LE(time, 12)
    head.writeUInt16LE(date, 14)
    head.writeUInt32LE(crc, 16)
    head.writeUInt32LE(body.length, 20)
    head.writeUInt32LE(data.length, 24)
    head.writeUInt16LE(nameBytes.length, 28)
    head.writeUInt32LE(offset, 42)
    central.push(head, nameBytes)
    put(local)
    put(nameBytes)
    put(body)
  }
  const cdStart = offset
  for (const part of central) put(part)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(offset - cdStart, 12)
  end.writeUInt32LE(cdStart, 16)
  put(end)
  closeSync(fd)
}

const zipName = `${kind.asset}-${version}-${platform}-${arch}.zip`
const zip = join(out, zipName)
rmSync(zip, { force: true })

if (platform === 'darwin') {
  const app = join(stage, `${kind.exe}.app`)
  // ditto keeps the framework symlinks and permissions intact.
  run('ditto', [join(bodyDir, 'node_modules', 'electron', 'dist', 'Electron.app'), app])
  const resources = join(app, 'Contents', 'Resources')
  putApp(resources)
  copyFileSync(ffmpeg, join(resources, 'ffmpeg'))
  writeFileSync(join(resources, 'ffmpeg-NOTICE.txt'), notice)

  const plist = join(app, 'Contents', 'Info.plist')
  const set = (key, type, value) => {
    try { run('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist], { stdio: 'ignore' }) } catch { /* not there */ }
    run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, plist])
  }
  set('CFBundleName', 'string', kind.name)
  set('CFBundleDisplayName', 'string', kind.display)
  set('CFBundleIdentifier', 'string', kind.bundleId)
  set('CFBundleShortVersionString', 'string', version)
  set('CFBundleVersion', 'string', version)
  set('LSUIElement', 'bool', 'true')
  set('NSMicrophoneUsageDescription', 'string', '她要听你说话（按快捷键说话、或一直在听时）')
  if (PLAYER) {
    // A 设计包 (.her) opens in 真人桌宠 with a double click.
    for (const key of ['CFBundleDocumentTypes', 'UTExportedTypeDeclarations']) {
      try { run('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist], { stdio: 'ignore' }) } catch { /* not there */ }
    }
    for (const command of [
      'Add :CFBundleDocumentTypes array',
      'Add :CFBundleDocumentTypes:0 dict',
      'Add :CFBundleDocumentTypes:0:CFBundleTypeName string 真人桌宠设计包',
      'Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer',
      'Add :CFBundleDocumentTypes:0:LSHandlerRank string Owner',
      'Add :CFBundleDocumentTypes:0:LSItemContentTypes array',
      `Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string ${kind.bundleId}.design`,
      'Add :UTExportedTypeDeclarations array',
      'Add :UTExportedTypeDeclarations:0 dict',
      `Add :UTExportedTypeDeclarations:0:UTTypeIdentifier string ${kind.bundleId}.design`,
      'Add :UTExportedTypeDeclarations:0:UTTypeDescription string 真人桌宠设计包',
      'Add :UTExportedTypeDeclarations:0:UTTypeConformsTo array',
      'Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:0 string public.zip-archive',
      'Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification dict',
      'Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension array',
      'Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:0 string her',
    ]) {
      run('/usr/libexec/PlistBuddy', ['-c', command, plist])
    }
  }

  // An ad-hoc signature: Apple Silicon runs nothing unsigned. A Developer ID
  // signature and notarization go here once there is an Apple developer account
  // (docs/独立安装包设计.md, decision 4): codesign --options runtime with the
  // certificate, then xcrun notarytool submit --wait and xcrun stapler staple.
  run('codesign', ['--force', '--deep', '--sign', '-', app])
  run('ditto', ['-c', '-k', '--keepParent', app, zip])
} else {
  // Built under plain ASCII names: on Windows, Node's cpSync, tar.exe and rcedit all take a
  // name like 真人桌宠 through the system code page and lose it. The zip gives it its real name.
  const app = join(stage, PLAYER ? 'player' : kind.exe)
  const exe = PLAYER ? 'player.exe' : `${kind.exe}.exe`
  cpSync(join(bodyDir, 'node_modules', 'electron', 'dist'), app, { recursive: true })
  renameSync(join(app, 'electron.exe'), join(app, exe))
  const resources = join(app, 'resources')
  const appDir = putApp(resources)
  // koffi (and its Windows build) for the wallpaper layer: main.cjs keeps it external.
  for (const dep of ['koffi', join('@koromix', `koffi-win32-${arch}`)]) {
    const from = join(bodyDir, 'node_modules', dep)
    if (!existsSync(from)) throw new Error(`缺少 ${dep}（在 Windows 上运行 npm ci）`)
    cpSync(from, join(appDir, 'node_modules', dep), { recursive: true })
  }
  copyFileSync(ffmpeg, join(resources, 'ffmpeg.exe'))
  writeFileSync(join(resources, 'ffmpeg-NOTICE.txt'), notice)

  const icon = join(stage, 'her.ico')
  writeFileSync(icon, ico([16, 24, 32, 48, 64, 128, 256]))
  const { rcedit } = await import('rcedit')
  const numeric = version.replace(/-.*$/, '')
  await rcedit(join(app, exe), {
    icon,
    'file-version': numeric,
    'product-version': numeric,
    'version-string': { ProductName: kind.name, FileDescription: kind.description, CompanyName: 'AIcivilization', OriginalFilename: `${kind.exe}.exe`, InternalName: kind.exe },
  })
  if (PLAYER) {
    // Our own zip writer: UTF-8 names (flag 11), so 真人桌宠 comes out right on any Windows.
    writeZip(zip, app, (path) => `${kind.exe}/${path === exe ? `${kind.exe}.exe` : path}`)
  } else {
    // The system's bsdtar writes zip with -a; named by path, not a Git tar from PATH.
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    run(tar, ['-a', '-c', '-f', zip, '-C', stage, kind.exe])
  }
}
rmSync(stage, { recursive: true, force: true })

const sha256 = createHash('sha256').update(readFileSync(zip)).digest('hex')
const manifestFile = join(out, kind.manifest)
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {}
const next = {
  format: kind.format,
  version,
  assets: { ...(manifest.version === version ? manifest.assets : {}), [`${platform}-${arch}`]: { file: zipName, size: statSync(zip).size, sha256 } },
}
writeFileSync(manifestFile, `${JSON.stringify(next, null, 2)}\n`)
console.log(`→ ${zip}（${(statSync(zip).size / 1e6).toFixed(1)} MB）\n→ ${manifestFile}`)

