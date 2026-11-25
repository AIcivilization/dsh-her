import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { makeZip } from '../src/core/zip.ts'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CHECK_EVERY_MS, cleanUpdate, PlayerUpdates, releaseBase, RELEASE_BASE, validatePlayerManifest } from '../src/standalone/player-update.ts'

/** A release on this computer: its files, and how many times each was asked for. */
async function release(files: Record<string, Uint8Array | string>): Promise<{ base: string; asked: Map<string, number>; server: Server }> {
  const asked = new Map<string, number>()
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').slice(1))
    asked.set(name, (asked.get(name) ?? 0) + 1)
    const body = files[name]
    if (body === undefined) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200).end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return { base: `http://127.0.0.1:${port}/`, asked, server }
}

const manifest = (version: string, asset: { file: string; size: number; sha256: string }, key = `${process.platform}-${process.arch}`) =>
  JSON.stringify({ format: 'dsh-her-player@1', version, assets: { [key]: asset } })

test('the release manifest is checked; only an address on this computer can stand in for ours', () => {
  const asset = { file: 'dsh-her-player-1.0.0-darwin-arm64.zip', size: 3, sha256: 'a'.repeat(64) }
  assert.equal(validatePlayerManifest(JSON.parse(manifest('1.0.0', asset))).version, '1.0.0')
  assert.throws(() => validatePlayerManifest({ format: 'dsh-her-body@1', version: '1.0.0', assets: {} }), /不对/)
  assert.throws(() => validatePlayerManifest(JSON.parse(manifest('1.0.0', { ...asset, file: '../x.zip' }))), /不对/)
  assert.throws(() => validatePlayerManifest(JSON.parse(manifest('next', asset))), /不对/)
  assert.equal(releaseBase({}), RELEASE_BASE)
  assert.equal(releaseBase({ ZHENREN_UPDATE_BASE: 'http://127.0.0.1:8080/' }), 'http://127.0.0.1:8080/')
  assert.equal(releaseBase({ ZHENREN_UPDATE_BASE: 'https://evil.example/' }), RELEASE_BASE)
  assert.equal(cleanUpdate({}).auto, true, 'on by default')
  assert.equal(cleanUpdate({ auto: false }).auto, false)
})

test('once a day when on, never when off; a newer version is offered, the same or older is not', async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-update-'))
  const zip = new TextEncoder().encode('zip')
  const asset = { file: 'p.zip', size: zip.length, sha256: createHash('sha256').update(zip).digest('hex') }
  const files: Record<string, string | Uint8Array> = { 'player-latest.json': manifest('0.9.0', asset) }
  const { base, asked, server } = await release(files)
  let clock = 1_000_000
  try {
    const updates = new PlayerUpdates({ home, version: '0.8.6', base, now: () => clock })
    assert.equal(updates.due(), true)
    const found = await updates.check()
    assert.equal(found.available?.version, '0.9.0')
    assert.equal(found.latest, '0.9.0')
    assert.equal(updates.due(), false, 'looked today')
    clock += CHECK_EVERY_MS
    assert.equal(updates.due(), true)
    updates.setAuto(false)
    assert.equal(updates.due(), false, 'off: never')

    // Running 0.9.0 now: nothing is offered, though the file still says 0.9.0.
    const same = new PlayerUpdates({ home, version: '0.9.0', base, now: () => clock })
    assert.equal(same.state().available, undefined)
    assert.equal((await same.check()).available, undefined)

    // No file for this computer in the release: nothing offered.
    files['player-latest.json'] = manifest('1.0.0', asset, 'plan9-mips')
    assert.equal((await updates.check()).available, undefined)

    // GitHub not answering: said in words, and not tried again until tomorrow.
    files['player-latest.json'] = '{'
    await assert.rejects(updates.check())
    assert.ok(updates.state().error !== undefined)
    assert.equal(asked.get('p.zip'), undefined, 'looking never downloads')
  } finally {
    server.close()
  }
})

test('a download that does not match its checksum is thrown away; one that does is unpacked as the new program', async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-update-'))
  // A release zip with the program in it, its names in UTF-8 as package.mjs writes them.
  const platform = process.platform === 'win32' ? 'win32' : 'darwin'
  const app = platform === 'win32' ? '真人桌宠' : '真人桌宠.app'
  const zip = makeZip([{ name: `${app}/Contents/version.txt`, data: new TextEncoder().encode('0.9.0') }])
  const good = { file: 'p.zip', size: zip.length, sha256: createHash('sha256').update(zip).digest('hex') }
  const key = `${platform}-${process.arch}`
  const files: Record<string, string | Uint8Array> = { 'player-latest.json': manifest('0.9.0', { ...good, sha256: 'b'.repeat(64) }, key), 'p.zip': zip }
  const { base, server } = await release(files)
  try {
    const updates = new PlayerUpdates({ home, version: '0.8.6', base, platform })
    await updates.check()
    await assert.rejects(updates.download(), /校验不对/)
    assert.equal(existsSync(join(home, 'updates', 'p.zip')), false)
    assert.ok(updates.state().error !== undefined)

    files['player-latest.json'] = manifest('0.9.0', good, key)
    await updates.check()
    if (process.platform !== 'darwin' && process.platform !== 'win32') return // unpacking uses ditto or the Windows tar
    const { version, app: next } = await updates.download()
    assert.equal(version, '0.9.0')
    assert.equal(readFileSync(join(next, 'Contents', 'version.txt'), 'utf8'), '0.9.0')
    assert.equal(existsSync(join(home, 'updates', 'p.zip')), false, 'the zip goes once unpacked')

    // Kept aside, then tidied at the next start: the unpacked version goes, the one kept aside stays.
    mkdirSync(updates.previousSlot(), { recursive: true })
    updates.putAside('0.8.6')
    assert.equal(updates.state().previous?.version, '0.8.6')
    updates.tidy()
    assert.equal(existsSync(join(home, 'updates', '0.9.0')), false)
    assert.equal(existsSync(updates.previousSlot()), true)
    writeFileSync(join(home, 'updates', 'update-error.txt'), '\uFEFF文件被占用')
    assert.equal(updates.takeWindowsError(), '文件被占用')
    assert.equal(updates.takeWindowsError(), undefined, 'said once')
  } finally {
    server.close()
  }
})
