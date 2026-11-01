import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appName, compareVersions, downloadFolder, fetchManifest, install, installDownloaded, installedBody, installedPlan, manualInstall, platformKey, validateManifest } from '../src/dsh/body-install.ts'
import { systemTar } from '../src/platform.ts'

test('versions order like releases', () => {
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0)
  assert.equal(compareVersions('0.1.0-dev.0', '0.1.0'), -1)
  assert.equal(compareVersions('0.1.1', '0.1.0'), 1)
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1)
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.1'), 1)
})

test('a manifest is checked before use', () => {
  const ok = { format: 'dsh-her-body@1', version: '0.1.0', assets: { 'darwin-arm64': { file: 'a.zip', size: 1, sha256: 'a'.repeat(64) } } }
  assert.equal(validateManifest(ok).version, '0.1.0')
  assert.throws(() => validateManifest({ ...ok, format: 'x' }))
  assert.throws(() => validateManifest({ ...ok, assets: { x: { file: '../evil.zip', size: 1, sha256: 'a'.repeat(64) } } }))
  assert.throws(() => validateManifest({ ...ok, assets: { x: { file: 'a.zip', size: 1, sha256: 'short' } } }))
})

test('install downloads, checks, unpacks and keeps the previous version', { skip: process.platform !== 'darwin' && process.platform !== 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'her-release-'))
  const home = mkdtempSync(join(tmpdir(), 'her-home-'))
  const files = new Map<string, Buffer>()
  const server = createServer((req, res) => {
    const body = files.get((req.url ?? '').replace(/^\/rel\//, ''))
    if (body === undefined) { res.statusCode = 404; res.end(); return }
    res.end(body)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/rel`
  // A tiny stand-in for the app, zipped the way package.mjs does.
  const release = (version: string, tamper = false) => {
    const win = process.platform === 'win32'
    const bin = win ? join(dir, version, appName()) : join(dir, version, appName(), 'Contents', 'MacOS')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, win ? 'dsh-her.exe' : 'Electron'), `#!/bin/sh\necho ${version}\n`)
    const zip = join(dir, `body-${version}.zip`)
    if (win) execFileSync(systemTar(), ['-a', '-c', '-f', zip, '-C', join(dir, version), appName()])
    else execFileSync('ditto', ['-c', '-k', '--keepParent', join(dir, version, appName()), zip])
    const bytes = readFileSync(zip)
    files.set(`body-${version}.zip`, tamper ? Buffer.concat([bytes, Buffer.from('x')]) : bytes)
    files.set('body-latest.json', Buffer.from(JSON.stringify({
      format: 'dsh-her-body@1', version,
      assets: { [platformKey()]: { file: `body-${version}.zip`, size: statSync(zip).size, sha256: createHash('sha256').update(bytes).digest('hex') } },
    })))
  }
  try {
    release('0.1.0')
    const progress: number[] = []
    const first = await install(home, base, await fetchManifest(base), done => progress.push(done))
    assert.equal(first.version, '0.1.0')
    assert.ok(progress.length > 0)
    assert.equal(installedBody(home)?.version, '0.1.0')
    assert.ok(installedPlan(home)?.binary.endsWith(process.platform === 'win32' ? join('dsh-her', 'dsh-her.exe') : join('dsh-her.app', 'Contents', 'MacOS', 'Electron')))
    assert.ok(existsSync(installedPlan(home)!.binary))

    // A download that does not match its checksum is refused; 0.1.0 stays.
    release('0.1.1', true)
    await assert.rejects(install(home, base, await fetchManifest(base), () => {}), /校验不对/)
    assert.equal(installedBody(home)?.version, '0.1.0')

    // Two good updates: the newest is current, the one before it kept, older ones removed.
    release('0.1.2')
    await install(home, base, await fetchManifest(base), () => {})
    release('0.1.3')
    await install(home, base, await fetchManifest(base), () => {})
    assert.equal(installedBody(home)?.version, '0.1.3')
    assert.ok(existsSync(join(home, 'body', '0.1.2')))
    assert.ok(!existsSync(join(home, 'body', '0.1.0')))
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('a body downloaded by hand: found by name or size, checked, installed', { skip: process.platform !== 'darwin' && process.platform !== 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'her-manual-'))
  const home = mkdtempSync(join(tmpdir(), 'her-home-'))
  try {
    const win = process.platform === 'win32'
    const bin = win ? join(dir, appName()) : join(dir, appName(), 'Contents', 'MacOS')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, win ? 'dsh-her.exe' : 'Electron'), 'body')
    const built = join(dir, 'built.zip')
    if (win) execFileSync(systemTar(), ['-a', '-c', '-f', built, '-C', dir, appName()])
    else execFileSync('ditto', ['-c', '-k', '--keepParent', join(dir, appName()), built])
    const bytes = readFileSync(built)
    const file = 'dsh-her-body-1.0.0.zip'
    const manifest = validateManifest({
      format: 'dsh-her-body@1', version: '1.0.0',
      assets: { [platformKey()]: { file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } },
    })
    const base = 'https://github.com/AIcivilization/dsh-her/releases/latest/download/'
    const folder = downloadFolder(home)

    // Nothing there yet.
    const before = manualInstall(home, base, manifest)
    assert.equal(before.downloaded, 'none')
    assert.equal(before.urls[0], `${base}${file}`)
    await assert.rejects(installDownloaded(home, manifest), /没找到/)

    // Still downloading.
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, file), bytes.subarray(0, 10))
    assert.equal(manualInstall(home, base, manifest).downloaded, 'partial')
    await assert.rejects(installDownloaded(home, manifest), /不完整/)

    // Right size, wrong bytes: refused, and the file stays for you to see.
    writeFileSync(join(folder, file), Buffer.alloc(bytes.length))
    assert.equal(manualInstall(home, base, manifest).downloaded, 'ready')
    await assert.rejects(installDownloaded(home, manifest), /校验不对/)
    assert.ok(existsSync(join(folder, file)))
    assert.equal(installedBody(home), undefined)

    // Saved under another name by a download manager: found by its size, installed.
    rmSync(join(folder, file))
    writeFileSync(join(folder, 'dsh-her-body-1.0.0 (1).zip'), bytes)
    assert.equal(manualInstall(home, base, manifest).downloaded, 'ready')
    assert.equal((await installDownloaded(home, manifest)).version, '1.0.0')
    assert.equal(installedBody(home)?.version, '1.0.0')
    assert.ok(existsSync(installedPlan(home)!.binary))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('a download can be cancelled, and leaves nothing behind', { skip: process.platform !== 'darwin' && process.platform !== 'win32' }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-home-'))
  // A server that sends a little and then keeps the connection open.
  const server = createServer((_req, res) => {
    res.write(Buffer.alloc(1024))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/rel`
  try {
    const manifest = validateManifest({ format: 'dsh-her-body@1', version: '1.0.0', assets: { [platformKey()]: { file: 'a.zip', size: 4096, sha256: 'a'.repeat(64) } } })
    const cancel = new AbortController()
    const running = install(home, base, manifest, () => cancel.abort(), cancel.signal)
    await assert.rejects(running)
    assert.ok(!existsSync(join(downloadFolder(home), 'a.zip.part')))
    assert.ok(!existsSync(join(downloadFolder(home), 'a.zip')))
  } finally {
    server.closeAllConnections()
    server.close()
    rmSync(home, { recursive: true, force: true })
  }
})
