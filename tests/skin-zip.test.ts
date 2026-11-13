import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { test } from 'node:test'
import { crc32, makeZip, readZip } from '../src/core/zip.ts'
import { parseSkin, skinCss } from '../src/core/skin.ts'
import { safeSkinCss, Skins } from '../src/dsh/skins.ts'
import { SKIN_INTERVIEW, SKIN_TEMPLATE, SKIN_TOKENS, skinReadme } from '../src/core/skin-guide.ts'
import { designTools } from '../src/dsh/design-tools.ts'
import { Library } from '../src/dsh/library.ts'
import { StageStore } from '../src/dsh/stage-store.ts'

const bytes = (text: string) => new TextEncoder().encode(text)

test('a zip written here reads back the same, Chinese names too', () => {
  const files = [{ name: '樱花/skin.json', data: bytes('{"name":"樱花"}') }, { name: '樱花/bg.svg', data: bytes('<svg/>') }]
  const back = readZip(makeZip(files))
  assert.deepEqual(back.map(f => [f.name, new TextDecoder().decode(f.data)]), [['樱花/skin.json', '{"name":"樱花"}'], ['樱花/bg.svg', '<svg/>']])
  assert.equal(crc32(bytes('123456789')), 0xcbf43926)
  assert.throws(() => readZip(bytes('not a zip at all, sorry')), /不是一个 zip/)
})

test('a zip made by other tools (deflated entries, a folder entry) is read', () => {
  // One deflated entry, by hand: what Finder and Windows write.
  const data = bytes('{"name":"压缩的"}')
  const packed = deflateRawSync(data)
  const name = bytes('x/skin.json')
  const local = new DataView(new ArrayBuffer(30))
  local.setUint32(0, 0x04034b50, true); local.setUint16(8, 8, true); local.setUint32(14, crc32(data), true)
  local.setUint32(18, packed.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true)
  const head = new DataView(new ArrayBuffer(46))
  head.setUint32(0, 0x02014b50, true); head.setUint16(10, 8, true); head.setUint32(16, crc32(data), true)
  head.setUint32(20, packed.length, true); head.setUint32(24, data.length, true); head.setUint16(28, name.length, true)
  const centralAt = 30 + name.length + packed.length
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true)
  end.setUint32(12, 46 + name.length, true); end.setUint32(16, centralAt, true)
  const zip = new Uint8Array([...new Uint8Array(local.buffer), ...name, ...packed, ...new Uint8Array(head.buffer), ...name, ...new Uint8Array(end.buffer)])
  assert.equal(new TextDecoder().decode(readZip(zip)[0]!.data), '{"name":"压缩的"}')
})

test('a skin goes out as a zip and comes back in as a skin of its own', () => {
  const home = mkdtempSync(join(tmpdir(), 'her-skin-'))
  const skins = new Skins(home)
  mkdirSync(join(home, 'skins', 'sakura'), { recursive: true })
  writeFileSync(join(home, 'skins', 'sakura', 'skin.json'), JSON.stringify({ name: '樱花', background: { file: 'bg.svg', dim: 0 } }))
  writeFileSync(join(home, 'skins', 'sakura', 'bg.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')
  const zip = skins.zip('sakura')
  // The same name again: a second one, not over the first.
  const { id, skipped } = skins.importZip(zip, 'whatever')
  assert.equal(id, 'sakura-2')
  assert.deepEqual(skipped, [])
  const entry = skins.get('sakura-2')!
  assert.equal(entry.skin.name, '樱花')
  assert.deepEqual(entry.skin.background, { file: 'bg.svg', dim: 0 })
  assert.deepEqual(entry.problems, [])
  assert.throws(() => skins.zip('whale-blue'), /自带/)
})

test('what a skin cannot have is left out of an imported zip, and what could run is taken out', () => {
  const home = mkdtempSync(join(tmpdir(), 'her-skin-'))
  const skins = new Skins(home)
  const zip = makeZip([
    { name: 'mine/skin.json', data: bytes('{"name":"我的"}') },
    { name: 'mine/run.sh', data: bytes('rm -rf ~') },
    { name: 'mine/deep/x.png', data: bytes('x') },
    { name: 'mine/evil.css', data: bytes('body{background:url(https://example.com/t.png)}') },
    { name: 'mine/bg.svg', data: bytes('<svg><script>alert(1)</script><rect/></svg>') },
    { name: '__MACOSX/mine/._skin.json', data: bytes('junk') },
  ])
  const { id, skipped } = skins.importZip(zip, 'x')
  assert.equal(id, 'mine')
  assert.ok(skipped.includes('run.sh') && skipped.includes('deep/x.png') && skipped.some(s => s.startsWith('evil.css')))
  assert.equal(existsSync(join(home, 'skins', 'mine', 'run.sh')), false)
  assert.equal(readFileSync(join(home, 'skins', 'mine', 'bg.svg'), 'utf8').includes('script'), false)
  assert.throws(() => skins.importZip(makeZip([{ name: 'a.txt', data: bytes('x') }]), 'x'), /没有 skin.json/)
  assert.equal(safeSkinCss('a{color:red}'), true)
  assert.equal(safeSkinCss('@import "x.css";'), false)
})

test('the template is a skin that works, and the guide names every colour it uses', () => {
  const { skin, problems } = parseSkin(SKIN_TEMPLATE, 'my-skin', ['skin.json', 'background.svg'])
  assert.deepEqual(problems, [])
  assert.equal(skin?.background?.file, 'background.svg')
  const named = new Set(SKIN_TOKENS.map(t => t.name))
  for (const name of Object.keys(SKIN_TEMPLATE.colors)) assert.ok(named.has(name), name)
  for (const t of SKIN_TOKENS) assert.ok(skinReadme().includes(t.name))
  // The AI is told the tools it has.
  for (const tool of ['skin_set', 'skin_file_set', 'skin_wear', 'skin_export', 'skin_get']) assert.ok(SKIN_INTERVIEW.includes(tool), tool)
})

test('the design tools write an SVG background into a skin, put a skin on, and save it as a zip', async () => {
  const home = mkdtempSync(join(tmpdir(), 'her-skin-'))
  const skins = new Skins(home)
  let worn: string | undefined | null = null
  const tools = designTools({ home, library: new Library(home), skins, stages: new StageStore(home), applied: () => {}, wear: id => { worn = id }, log: () => {} })
  const run = (name: string, args: Record<string, unknown>) => tools.find(t => t.name === name)!.execute(args).then(r => r.text)
  assert.match(await run('skin_file_set', { id: 'sea', file: 'background.svg', text: '<svg viewBox="0 0 10 10" onload="x()"><rect width="10" height="10"/></svg>' }), /写好了/)
  assert.equal(readFileSync(join(home, 'skins', 'sea', 'background.svg'), 'utf8').includes('onload'), false)
  assert.match(await run('skin_file_set', { id: 'sea', file: 'x.css', text: 'body{background:url(http://a)}' }), /没做成/)
  assert.match(await run('skin_file_set', { id: 'sea', file: 'x.png', text: 'x' }), /没做成/)
  assert.match(await run('skin_set', { id: 'sea', skin: { name: '海', background: { file: 'background.svg', dim: 0 }, colors: { '--dsw-alias-bg-base': { light: '#fff', dark: '#000' } } } }), /写好了皮肤「海」/)
  const read = JSON.parse(await run('skin_get', { id: 'sea' })) as { files: string[]; texts: Record<string, string> }
  assert.ok(read.files.includes('background.svg') && read.texts['background.svg']!.includes('<rect'))
  const saved = await run('skin_export', { id: 'sea' })
  assert.match(saved, /存好了/)
  assert.ok(existsSync(join(home, 'exports', '海.zip')))
  assert.match(await run('skin_export', { id: 'sea' }), /海-2\.zip/)
  assert.equal(readZip(readFileSync(join(home, 'exports', '海.zip'))).some(e => e.name === 'sea/skin.json'), true)
  assert.match(await run('skin_wear', { id: 'sea' }), /换上并保存/)
  assert.equal(worn, 'sea')
  assert.match(await run('skin_wear', { id: 'nope' }), /没做成/)
})

test('the picture lies on the skin\'s own page colour, with its own picture or veil in dark mode', () => {
  const { skin } = parseSkin({ colors: { '--dsw-alias-bg-base': { light: '#fff8fa', dark: '#1a1216' } }, background: { file: 'p.svg', dim: 0, dark: { file: 'd.svg', dim: 0.2 } } }, 's', ['p.svg', 'd.svg'])
  const css = skinCss(skin!, f => `/f/${f}`)
  assert.match(css, /body\{[^}]*url\("\/f\/p\.svg"\)[^}]*background-color:#fff8fa/)
  assert.match(css, /body\[data-ds-dark-theme\]\{[^}]*rgba\(0,0,0,0\.2\)[^}]*url\("\/f\/d\.svg"\)[^}]*background-color:#1a1216/)
  assert.match(parseSkin({ background: { file: 'p.svg', dark: { file: 'gone.png' } } }, 's', ['p.svg']).problems.join(), /background\.dark/)
})
