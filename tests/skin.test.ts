import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { BUILTIN_SKINS, parseSkin, skinCss } from '../src/core/skin.ts'
import { Skins } from '../src/dsh/skins.ts'

test('a skin.json is read with what is wrong said, and nothing can break out of CSS', () => {
  const { skin, problems } = parseSkin({
    name: '樱花', author: '我',
    colors: { '--dsw-alias-bg-base': { light: '#fff', dark: '#000' }, 'color': { light: 'red', dark: 'red' }, '--dsw-alias-link': { light: 'red;}body{display:none', dark: 'x' }, '--dsw-alias-bg-layer-1': '#fff' },
    background: { file: 'bg.webp', dim: 2 },
    font: { file: '../evil.woff2' },
    bar: { accent: { light: '#f9c', dark: '#c69' }, text: 'red' },
    intro: '出场.webm', css: 'more.css',
  }, 'sakura', ['skin.json', 'bg.webp', '出场.webm'])
  assert.ok(skin !== undefined)
  assert.deepEqual(Object.keys(skin.colors ?? {}), ['--dsw-alias-bg-base'])
  assert.deepEqual(skin.background, { file: 'bg.webp', dim: 0.9 })
  assert.equal(skin.font, undefined)
  assert.deepEqual(skin.bar, { accent: { light: '#f9c', dark: '#c69' } })
  assert.equal(skin.intro, '出场.webm')
  assert.equal(skin.css, undefined)
  for (const word of ['color 不对', '--dsw-alias-link', '--dsw-alias-bg-layer-1', '字体', 'bar.text', 'css']) assert.ok(problems.some(p => p.includes(word)), word)
})

test('the CSS of a skin: background, font, the talk bar in light and dark', () => {
  const css = skinCss({ id: 's', name: 's', background: { file: 'bg.webp' }, font: { file: 'f.woff2' }, bar: { accent: { light: '#111', dark: '#eee' } } }, f => `/x?f=${f}`, '.a{}')
  assert.match(css, /url\("\/x\?f=bg\.webp"\)/)
  assert.match(css, /@font-face\{font-family:"dsh-her-skin";src:url\("\/x\?f=f\.woff2"\)/)
  assert.match(css, /body\{--her-bar-accent:#111;\}/)
  assert.match(css, /body\[data-ds-dark-theme\]\{--her-bar-accent:#eee;\}/)
  assert.ok(css.endsWith('.a{}'))
})

test('skins on disk: built in first, folders after, the one in use remembered', () => {
  const home = mkdtempSync(join(tmpdir(), 'her-skin-'))
  const skins = new Skins(home)
  assert.deepEqual(skins.list().map(e => e.skin.id), BUILTIN_SKINS.map(s => s.id))
  assert.equal(skins.current(), undefined)
  const dir = join(home, 'skins', 'sakura')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'skin.json'), JSON.stringify({ name: '樱花', colors: { '--dsw-alias-bg-base': { light: '#fee', dark: '#211' } } }))
  assert.equal(skins.list().at(-1)?.skin.name, '樱花')
  skins.use('sakura')
  assert.equal(skins.current(), 'sakura')
  assert.match(skins.target('sakura', '某文件夹/bg.webp') ?? '', /sakura[/\\]bg\.webp$/)
  for (const [id, file] of [['sakura', 'x.exe'], ['../x', 'a.png'], ['whale-blue', 'a.png'], ['sakura', '.hidden.png']] as const) assert.equal(skins.target(id, file), undefined, `${id} ${file}`)
  assert.throws(() => skins.remove('whale-blue'), /自带/)
  skins.remove('sakura')
  assert.equal(skins.current(), undefined)
  assert.equal(skins.file('sakura', 'skin.json'), undefined)
})
