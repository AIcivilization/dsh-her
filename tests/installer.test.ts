import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { appendToZip } from '../src/core/zip-append.ts'
import { makeZip, readZip } from '../src/core/zip.ts'
import { fileName, Installers, keepsToOneself, readme } from '../src/engine/installer.ts'

const bytes = (text: string) => new TextEncoder().encode(text)

test('files added to a zip come after its own, which stay as they were', () => {
  const dir = mkdtempSync(join(tmpdir(), 'her-zip-'))
  const source = join(dir, 'a.zip')
  writeFileSync(source, makeZip([{ name: 'app/run', data: bytes('#!/bin/sh') }, { name: 'app/data.bin', data: new Uint8Array([0, 1, 2, 255]) }]))
  appendToZip(source, join(dir, 'b.zip'), [{ name: '小禾.her', data: bytes('her') }, { name: '说明.txt', data: bytes('读我') }])
  const out = readFileSync(join(dir, 'b.zip'))
  const original = readFileSync(source)
  // The original files' records, byte for byte, at the same places.
  assert.ok(out.subarray(0, original.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))).equals(original.subarray(0, original.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])))))
  assert.deepEqual(readZip(out).map(e => [e.name, new TextDecoder().decode(e.data)]), [['app/run', '#!/bin/sh'], ['app/data.bin', '\u0000\u0001\u0002�'], ['小禾.her', 'her'], ['说明.txt', '读我']])
  assert.throws(() => appendToZip(join(dir, 'b.zip.missing'), join(dir, 'c.zip'), []))
  writeFileSync(join(dir, 'not.zip'), 'hello')
  assert.throws(() => appendToZip(join(dir, 'not.zip'), join(dir, 'c.zip'), []), /不是一个 zip/)
})

test('who may not be passed on, safe file names, and the readme for each system', () => {
  assert.equal(keepsToOneself('仅个人使用，不许转发'), true)
  assert.equal(keepsToOneself('仅限个人使用'), true)
  assert.equal(keepsToOneself('Personal use only'), true)
  assert.equal(keepsToOneself('CC BY-NC-SA 4.0'), false)
  assert.equal(keepsToOneself('MIT'), false)
  assert.equal(fileName('小禾/2:*'), '小禾2')
  assert.equal(fileName(' ..'), '她')
  const win = readme('win32-x64', { her: '小禾.her', name: '小禾', author: '我', license: 'CC BY 4.0', version: '0.8.6' })
  assert.match(win, /仍要运行/)
  assert.ok(win.includes('\r\n') && !/[^\r]\n/.test(win), 'Windows: CRLF')
  const mac = readme('darwin-arm64', { her: '小禾.her', name: '小禾', author: '我', license: 'CC BY 4.0', version: '0.8.6' })
  assert.match(mac, /隐私与安全性/)
  assert.ok(!mac.includes('\r'))
})

test('an installer: the player is downloaded once and checked, her 设计包 and the readme go beside it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-installer-'))
  const out = mkdtempSync(join(tmpdir(), 'her-installer-out-'))
  const mac = makeZip([{ name: '真人桌宠.app/Contents/Info.plist', data: bytes('plist') }])
  const win = makeZip([{ name: '真人桌宠/真人桌宠.exe', data: bytes('exe') }])
  const asset = (file: string, data: Uint8Array) => ({ file, size: data.length, sha256: createHash('sha256').update(data).digest('hex') })
  const files: Record<string, Uint8Array | string> = {
    'player-latest.json': JSON.stringify({ format: 'dsh-her-player@1', version: '0.8.6', assets: { 'darwin-arm64': asset('m.zip', mac), 'win32-x64': asset('w.zip', win) } }),
    'm.zip': mac, 'w.zip': win,
  }
  const asked = new Map<string, number>()
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').slice(1))
    asked.set(name, (asked.get(name) ?? 0) + 1)
    if (files[name] === undefined) res.writeHead(404).end()
    else res.writeHead(200).end(files[name])
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  try {
    const installers = new Installers(home, base)
    const plan = await installers.plan(['darwin-arm64', 'win32-x64'])
    assert.deepEqual(plan.targets.map(t => [t.target, t.cached]), [['darwin-arm64', false], ['win32-x64', false]])
    assert.equal(asked.get('m.zip'), undefined, 'looking at the plan downloads nothing')
    await assert.rejects(installers.make({ targets: ['darwin-arm64'], design: bytes('design'), name: '小禾', author: '我', license: '仅个人使用，不许转发', outDir: out }), /不能生成安装包/)

    const made = await installers.make({ targets: ['darwin-arm64', 'win32-x64'], design: bytes('design'), name: '小禾', author: '我', license: 'CC BY 4.0', outDir: out })
    assert.deepEqual(made.map(f => f.split(/[/\\]/).pop()), ['真人桌宠-小禾-mac.zip', '真人桌宠-小禾-windows.zip'])
    assert.deepEqual(readZip(readFileSync(made[0]!)).map(e => e.name), ['真人桌宠.app/Contents/Info.plist', '小禾.her', '说明.txt'])
    assert.deepEqual(readZip(readFileSync(made[1]!)).map(e => e.name), ['真人桌宠/真人桌宠.exe', '真人桌宠/小禾.her', '真人桌宠/说明.txt'])
    assert.equal(installers.job.state, 'done')

    // Made again: the kept players are used, not downloaded again.
    assert.deepEqual((await installers.plan(['darwin-arm64'])).targets.map(t => t.cached), [true])
    await installers.make({ targets: ['darwin-arm64'], design: bytes('design'), name: '小禾', author: '我', license: 'CC BY 4.0', outDir: out })
    assert.equal(asked.get('m.zip'), 1)

    // A player that does not match the release is not used.
    files['m2.zip'] = mac
    files['player-latest.json'] = JSON.stringify({ format: 'dsh-her-player@1', version: '0.8.7', assets: { 'darwin-arm64': { ...asset('m2.zip', mac), sha256: 'c'.repeat(64) } } })
    await assert.rejects(new Installers(home, base).make({ targets: ['darwin-arm64'], design: bytes('d'), name: '小禾', author: '', license: 'MIT', outDir: out }), /校验不对/)
    // Not released yet: said so.
    delete files['player-latest.json']
    await assert.rejects(new Installers(home, base).plan(['darwin-arm64']), /还没有真人桌宠/)
  } finally {
    server.close()
  }
})
