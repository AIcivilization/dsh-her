import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareVersions, fetchManifest, install, installedBody, installedPlan, platformKey, validateManifest } from '../src/dsh/body-install.ts'

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

test('install downloads, checks, unpacks and keeps the previous version', { skip: process.platform !== 'darwin' }, async () => {
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
    const app = join(dir, version, 'dsh-her.app', 'Contents', 'MacOS')
    mkdirSync(app, { recursive: true })
    writeFileSync(join(app, 'Electron'), `#!/bin/sh\necho ${version}\n`)
    const zip = join(dir, `body-${version}.zip`)
    execFileSync('ditto', ['-c', '-k', '--keepParent', join(dir, version, 'dsh-her.app'), zip])
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
    assert.ok(installedPlan(home)?.binary.endsWith('dsh-her.app/Contents/MacOS/Electron'))
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
