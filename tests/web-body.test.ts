import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileResponse, frameFor, packFile, parseRange, WEB_BASE, WebBody } from '../src/dsh/web-body.ts'
import { saveUpload, uploadAllowed, uploadTarget } from '../src/dsh/uploads.ts'
import { clampRegion } from '../src/pack/frame.ts'
import type { PackInfo } from '../src/pack/types.ts'

test('range requests are read the way a video element sends them', () => {
  assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 })
  assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 })
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.equal(parseRange('bytes=100-', 100), 'invalid')
  assert.equal(parseRange('bytes=20-10', 100), 'invalid')
  assert.equal(parseRange(null, 100), undefined)
  assert.equal(parseRange('bytes=0-1,5-6', 100), undefined, 'several ranges: the whole file instead')
})

test('only files inside a pack can be asked for', () => {
  const packs = join(tmpdir(), 'packs')
  assert.equal(packFile(packs, 'a', 'clips/x.mp4'), join(packs, 'a', 'clips', 'x.mp4'))
  for (const [id, file] of [['a', '../b/x.mp4'], ['a', '../../secret'], ['..', 'x'], ['a/b', 'x'], ['.old', 'x'], ['', 'x'], ['a', ''], ['a', '/etc/passwd']] as const) {
    assert.equal(packFile(packs, id, file), undefined, `${id} ${file}`)
  }
})

test('a pack file answers range, full and unchanged requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'her-web-'))
  try {
    const path = join(dir, 'clip.mp4')
    writeFileSync(path, '0123456789')
    const get = (headers: Record<string, string> = {}) => fileResponse(path, new Request('http://x/', { headers }))
    const full = get()
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('content-type'), 'video/mp4')
    assert.equal(full.headers.get('accept-ranges'), 'bytes')
    assert.equal(await full.text(), '0123456789')
    const part = get({ range: 'bytes=2-4' })
    assert.equal(part.status, 206)
    assert.equal(part.headers.get('content-range'), 'bytes 2-4/10')
    assert.equal(await part.text(), '234')
    assert.equal(get({ range: 'bytes=50-' }).status, 416)
    const etag = full.headers.get('etag')!
    assert.equal(get({ 'if-none-match': etag }).status, 304)
    assert.equal(fileResponse(join(dir, 'missing.mp4'), new Request('http://x/')).status, 404)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the floating window fits the pack', () => {
  const pack = (over: Partial<PackInfo>): PackInfo => ({ id: 'p', name: 'p', layer: 'overlay', layout: 'stacked', start: 'stand', clips: [], macros: [], ...over })
  const figure = frameFor(pack({ aspect: 0.5 }))
  assert.equal(figure.her.height, 380)
  assert.ok(figure.frame.height > figure.her.height, 'room for her bubble')
  assert.ok(figure.frame.width >= figure.her.width)
  const scene = frameFor(pack({ layer: 'scene', aspect: 1.6 }))
  assert.deepEqual(scene.frame, { width: 400, height: 250 })
})

const packDir = (home: string, id: string) => {
  const dir = join(home, 'packs', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'clips.json'), JSON.stringify({ name: id, clips: [{ id: 'a', file: 'a.mp4' }] }))
}

test('she shows the chosen pack, from DSH’s address', () => {
  const home = mkdtempSync(join(tmpdir(), 'her-web-'))
  try {
    const web = new WebBody(home)
    assert.equal(web.config(false).pack.clips.length, 0, 'no pack yet: the drawn stand-in')
    assert.equal(web.summary(), undefined)
    packDir(home, 'one')
    packDir(home, 'two')
    assert.equal(web.config(false).pack.id, 'one')
    assert.equal(web.config(true).mute, true)
    assert.equal(web.config(false).pack.clips[0]?.url, `${WEB_BASE}/file?p=one&f=a.mp4`)
    web.use('two')
    assert.equal(web.config(false).pack.id, 'two')
    assert.equal(web.activeId(), 'two')
    assert.equal(web.packList().length, 2)
    assert.equal(web.mode, 'auto')
    web.mode = 'off'
    assert.equal(new WebBody(home).mode, 'off')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('one live connection: the newest wins and the older is told', async () => {
  const web = new WebBody(mkdtempSync(join(tmpdir(), 'her-web-')))
  const opened: string[] = []
  const read = async (response: Response, until: string) => {
    const reader = response.body!.getReader()
    let text = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return text
      text += new TextDecoder().decode(value)
      if (text.includes(until)) {
        await reader.cancel()
        return text
      }
    }
  }
  const first = new AbortController()
  const a = web.connect(first.signal, () => opened.push('a'), () => opened.push('a closed'))
  assert.equal(web.connected, true)
  const aText = read(a, 'web.replaced')
  const second = new AbortController()
  const b = web.connect(second.signal, () => opened.push('b'), () => opened.push('b closed'))
  assert.match(await aText, /web\.replaced/)
  assert.deepEqual(opened, ['a', 'a closed', 'b'], 'what the older tab was doing is over')
  const bText = read(b, '"hello"')
  web.send({ t: 'bubble', cid: 'c', text: 'hello' })
  assert.match(await bText, /data: \{"m":\{"t":"bubble"/)
  second.abort()
  assert.equal(web.connected, false)
  assert.deepEqual(opened, ['a', 'a closed', 'b', 'b closed'])
})

test('uploads stay inside their folder and only materials get through', async () => {
  const root = mkdtempSync(join(tmpdir(), 'her-up-'))
  try {
    assert.equal(uploadTarget(root, 'clips/a.mp4'), join(root, 'clips', 'a.mp4'))
    for (const bad of ['../x.mp4', 'a/../../x.mp4', '..\\x.mp4', '.hidden/a.mp4', '', '/']) assert.equal(uploadTarget(root, bad), undefined, bad)
    assert.equal(uploadTarget(root, '/etc/passwd'), join(root, 'etc', 'passwd'), 'a leading slash stays inside')
    assert.ok(uploadAllowed('a.MP4'))
    assert.ok(uploadAllowed('参考图.png'))
    assert.ok(!uploadAllowed('a.sh'))
    assert.ok(!uploadAllowed('a.exe'))
    const target = uploadTarget(root, 'clips/a.mp4')!
    const size = await saveUpload(new Request('http://x/', { method: 'POST', body: 'hello', duplex: 'half' } as RequestInit), target)
    assert.equal(size, 5)
    assert.equal(readFileSync(target, 'utf8'), 'hello')
    assert.ok(!existsSync(`${target}.part`))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a frame stays inside the photo, on even sizes', () => {
  const photo = { width: 1000, height: 800 }
  assert.deepEqual(clampRegion({ x: 10.4, y: 20.6, width: 301.2, height: 533 }, photo), { x: 10, y: 21, width: 300, height: 532 })
  assert.deepEqual(clampRegion({ x: -5, y: 790, width: 2000, height: 50 }, photo), { x: 0, y: 790, width: 1000, height: 10 })
})
