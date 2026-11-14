import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { freeName, parseDesignManifest, planDesign, versionAtLeast } from '../src/core/design-pack.ts'
import { makeZip, readZip } from '../src/core/zip.ts'
import { loadCharacter, saveCharacter, type Character } from '../src/core/character.ts'
import { Characters } from '../src/dsh/characters.ts'
import { DesignPacks } from '../src/dsh/design-packs.ts'
import { Library } from '../src/dsh/library.ts'
import { Skins } from '../src/dsh/skins.ts'
import { StageStore } from '../src/dsh/stage-store.ts'
import { readPlay } from '../src/dsh/stage-play.ts'

const bytes = (text: string) => new TextEncoder().encode(text)
const her: Character = { name: '小禾', persona: '你是小禾。', callYou: '你', pronoun: '他', voice: { id: 'zh-CN-XiaoxiaoNeural', speed: 1 }, onboarded: true }
const manifest = {
  format: 'dsh-her-design@1', id: 'sakura-sugar', name: '樱花糖', version: '1.0.0', author: '某人', license: 'CC BY-NC-SA 4.0',
  character: { name: '樱花糖', persona: '你是樱花糖，二十岁。', callYou: '阿文', voice: { id: 'zh-CN-XiaoyiNeural', speed: 1.1 }, sheet: '三视图' },
  stage: 'stage.json', skin: 'skin', intro: { material: '出场', when: 'every' },
}
const stage = { format: 'dsh-her-stage@1', name: '樱花糖', rows: ['avatar', 'desktop'], scenes: [{ id: 'base', name: '初始', cells: { avatar: { use: ['发呆'] }, desktop: { use: ['窗边'] } } }] }
const pack = (extra: Array<{ name: string; data: Uint8Array }> = []) => makeZip([
  { name: 'sakura-sugar/design.json', data: bytes(JSON.stringify(manifest)) },
  { name: 'sakura-sugar/stage.json', data: bytes(JSON.stringify(stage)) },
  { name: 'sakura-sugar/library/avatar/发呆.png', data: bytes('png') },
  { name: 'sakura-sugar/library/desktop/窗边.mp4', data: bytes('mp4') },
  { name: 'sakura-sugar/library/sheet/三视图.png', data: bytes('sheet') },
  { name: 'sakura-sugar/library/intro/出场.webm', data: bytes('webm') },
  { name: 'sakura-sugar/skin/skin.json', data: bytes('{"name":"樱花糖"}') },
  { name: 'sakura-sugar/run.sh', data: bytes('rm -rf ~') },
  ...extra,
])

function engine() {
  const home = mkdtempSync(join(tmpdir(), 'her-design-'))
  const charactersDir = join(home, 'characters')
  saveCharacter(join(charactersDir, 'sample'), her)
  const people = new Characters(home, charactersDir, { cid: 'sample', name: '小禾' })
  const library = new Library(home)
  const skins = new Skins(home)
  let intro: { source?: string; when: 'every' | 'daily' } = { when: 'daily' }
  const designs = new DesignPacks({
    home, charactersDir, version: '0.9.0', library, skins, people,
    current: () => ({ cid: 'sample', dir: join(charactersDir, 'sample'), character: loadCharacter(join(charactersDir, 'sample'), her) }),
    intro: () => intro, setIntro: (source, when) => { intro = { source, when } }, examine: () => {},
  })
  return { home, charactersDir, people, library, skins, designs, intro: () => intro }
}

test('design.json: what must be there is asked for, what is wrong is said', () => {
  assert.ok(parseDesignManifest(manifest).manifest !== undefined)
  assert.match(parseDesignManifest({ ...manifest, license: '' }).problems.join(), /license/)
  assert.equal(parseDesignManifest({ ...manifest, license: '' }).manifest, undefined)
  assert.match(parseDesignManifest({ ...manifest, format: 'x' }).problems.join(), /format/)
  const loose = parseDesignManifest({ ...manifest, homepage: 'http://x', engine: 'new', character: { name: '', persona: '' } })
  assert.ok(loose.manifest !== undefined && loose.manifest.homepage === undefined && loose.manifest.character === undefined)
  assert.equal(loose.problems.length, 3)
  assert.equal(versionAtLeast('0.9.0', '0.8.5'), true)
  assert.equal(versionAtLeast('0.8.5', '0.9.0'), false)
  assert.equal(freeName('发呆', n => n === '发呆', '樱花糖'), '发呆（樱花糖）')
})

test('a zip is sorted into its parts; what is not part of a design pack is left out and said', () => {
  const { plan, problems } = planDesign(readZip(pack()))
  assert.deepEqual(problems, [])
  assert.equal(plan!.materials.avatar[0]!.name, '发呆')
  assert.equal(plan!.skinFiles.length, 1)
  assert.deepEqual(plan!.skipped, ['run.sh'])
  assert.match(planDesign(readZip(makeZip([{ name: 'skin.json', data: bytes('{}') }]))).problems.join(), /design\.json/)
})

test('looked at first, then the chosen parts go in: a new character with her 编排, a skin, an opening clip — nothing written over', () => {
  const e = engine()
  // Something of the same name is there already.
  mkdirSync(join(e.home, 'library', 'avatar'), { recursive: true })
  writeFileSync(join(e.home, 'library', 'avatar', '发呆.png'), 'mine')
  const preview = e.designs.preview(pack())
  assert.equal(preview.manifest.license, 'CC BY-NC-SA 4.0')
  assert.equal(preview.character?.name, '樱花糖')
  assert.equal(preview.stage?.scenes, 1)
  assert.equal(preview.materials.avatar, 1)
  assert.equal(e.people.list().length, 1, 'nothing is written by looking')
  const { record } = e.designs.apply(preview.token, { character: true, switchTo: false, skin: true, wearSkin: true, intro: true, setIntro: true, materials: true })
  const cid = record.cid!
  assert.equal(e.people.list().length, 2)
  assert.equal(e.people.active(), 'sample', 'not switched unless asked')
  const made = loadCharacter(join(e.charactersDir, cid), her)
  assert.equal(made.name, '樱花糖')
  assert.equal(made.callYou, '阿文')
  assert.equal(made.voice.id, 'zh-CN-XiaoyiNeural')
  assert.equal(made.sheet, '三视图')
  // Hers was kept; the pack's came in under another name, and her 编排 follows it.
  assert.equal(readFileSync(join(e.home, 'library', 'avatar', '发呆.png'), 'utf8'), 'mine')
  assert.ok(existsSync(join(e.home, 'library', 'avatar', '发呆（樱花糖）.png')))
  const saved = new StageStore(join(e.charactersDir, cid)).load().stage!
  assert.deepEqual(saved.scenes[0]!.cells.avatar!.use, ['发呆（樱花糖）'])
  assert.equal(readPlay(join(e.charactersDir, cid)).on, true)
  assert.equal(e.skins.current(), record.skinId)
  assert.deepEqual(e.intro(), { source: '出场', when: 'every' })
  assert.equal(e.designs.installed()[0]!.author, '某人')
  assert.throws(() => e.designs.apply(preview.token, { character: true, switchTo: false, skin: false, wearSkin: false, intro: false, setIntro: false, materials: false }), /没有这个设计包/)
})

test('the character of now goes out as a design pack that comes back in as the same her', () => {
  const e = engine()
  for (const [row, file] of [['avatar', '发呆.png'], ['desktop', '窗边.mp4'], ['sheet', '三视图.png'], ['intro', '出场.webm']] as const) {
    mkdirSync(join(e.home, 'library', row), { recursive: true })
    writeFileSync(join(e.home, 'library', row, file), `${row}-data`)
  }
  new StageStore(join(e.charactersDir, 'sample')).save({ ...stage, scenes: [{ id: 'base', name: '初始', cells: { avatar: { use: ['发呆', 'pack:old'] }, desktop: { use: ['窗边'] } } }] } as never)
  const can = e.designs.exportable()
  assert.equal(can.stage?.materials, 2)
  assert.equal(can.sheet, '三视图')
  assert.ok(can.stage?.skipped.some(s => s.includes('外形包')))
  const { zip, skipped } = e.designs.export({ parts: new Set(['character', 'stage', 'sheet', 'skin', 'intro']), id: 'Xiao He!', name: '小禾', author: '我', version: '1.0.0', license: 'CC BY 4.0' })
  assert.ok(skipped.some(s => s.includes('外形包')) && skipped.some(s => s.includes('皮肤')) && skipped.some(s => s.includes('开机动画')))
  const { plan } = planDesign(readZip(zip))
  assert.equal(plan!.manifest.id, 'xiao-he')
  assert.equal(plan!.manifest.license, 'CC BY 4.0')
  assert.equal(plan!.manifest.character?.sheet, '三视图')
  assert.deepEqual(plan!.materials.avatar.map(m => m.name), ['发呆'])
  // Into another dsh-her: the same her.
  const other = engine()
  const back = other.designs.apply(other.designs.preview(zip).token, { character: true, switchTo: false, skin: false, wearSkin: false, intro: false, setIntro: false, materials: true })
  assert.equal(loadCharacter(join(other.charactersDir, back.record.cid!), her).persona, '你是小禾。')
  assert.throws(() => e.designs.export({ parts: new Set(), id: 'x-y', name: 'x', author: '', version: '1', license: 'MIT' }), /没有可以导出/)
})
