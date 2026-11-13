import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DEFAULT_WHO, fillPrompt, GUIDE, GUIDE_GROUPS, guideMarkdown, promptFor, WHO } from '../src/core/material-guide.ts'
import { cleanVeil, DEFAULT_VEIL } from '../src/dsh/web-body.ts'

test('the document in docs/ is the one the guide writes (run scripts/make-material-doc.mjs after changing the guide)', () => {
  // A Windows checkout may have turned the line ends into CRLF.
  assert.equal(readFileSync(new URL('../docs/素材规格与提示词.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), guideMarkdown())
})

test('every material says its size, its rules and a prompt; every group has some', () => {
  assert.equal(new Set(GUIDE.map(item => item.id)).size, GUIDE.length)
  for (const item of GUIDE) {
    assert.ok(item.size !== '' && item.format !== '' && item.where !== '' && item.how !== '' && item.upload !== '', item.id)
    assert.ok(item.rules.length > 0, item.id)
    assert.ok(item.prompt.length > 40, item.id)
    // A clip says how long, and that nothing is written on it.
    if (item.tool === '图生视频') {
      assert.ok(item.length !== undefined, item.id)
      assert.ok(item.prompt.includes('固定机位'), item.id)
    }
    assert.ok(item.prompt.includes('没有任何文字'), item.id)
  }
  for (const group of GUIDE_GROUPS) assert.ok(GUIDE.some(item => item.group === group.id), group.id)
  // The three-view is made from the portrait; what follows is made from the three-view.
  assert.ok(GUIDE.find(i => i.id === 'base-sheet')!.how.includes('定妆照'))
  for (const id of ['avatar-still', 'desktop-still', 'pet-still']) assert.ok(GUIDE.find(i => i.id === id)!.how.includes('三视图'), id)
})

test("your character's description goes into the prompts that describe her", () => {
  const portrait = GUIDE.find(i => i.id === 'base-portrait')!
  assert.ok(portrait.prompt.includes(WHO))
  assert.ok(fillPrompt(portrait.prompt, '银发的狐狸少女').includes('银发的狐狸少女'))
  assert.ok(!fillPrompt(portrait.prompt, '银发的狐狸少女').includes(WHO))
  // Nothing typed: ours.
  assert.ok(fillPrompt(portrait.prompt, '  ').includes(DEFAULT_WHO))
  assert.ok(guideMarkdown('银发的狐狸少女').includes('银发的狐狸少女'))
})

test('the veil over a background stays within what a page can show', () => {
  assert.deepEqual(cleanVeil({}), DEFAULT_VEIL)
  assert.deepEqual(cleanVeil({ dim: 200, blur: -3 }), { dim: 95, blur: 0 })
  assert.deepEqual(cleanVeil({ dim: 12.4, blur: 8 }), { dim: 12, blur: 8 })
  assert.deepEqual(cleanVeil({ dim: 'x', blur: Number.NaN }), DEFAULT_VEIL)
})

test('every prompt to copy says what it is for and its size, a clip how long; nothing says only "the same as above"', () => {
  for (const item of GUIDE) {
    assert.ok(!item.size.startsWith('同上'), item.id)
    const prompt = promptFor(item, DEFAULT_WHO)
    assert.ok(prompt.startsWith('这是为deepseek-harness设计鲸鱼娘的角色之一，要求：'), item.id)
    assert.ok(prompt.includes(item.size), item.id)
    if (item.length !== undefined) assert.ok(prompt.includes(item.length), item.id)
  }
  const pet = GUIDE.find(i => i.id === 'pet-still')!
  assert.ok(!promptFor(pet, DEFAULT_WHO, false).startsWith('这是为'))
  assert.ok(promptFor(GUIDE.find(i => i.id === 'base-portrait')!, '银发的狐狸少女').startsWith('这是为deepseek-harness设计的角色素材之一'))
})
