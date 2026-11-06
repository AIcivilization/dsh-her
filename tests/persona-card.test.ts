import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CARD_MAX_CHARS, cardFromPng, cardText, parsePersonaCard, personaCardPrompt } from '../src/core/persona-card.ts'

test('plain text stays as it is', () => {
  assert.equal(cardText('  傲2娇8，爱吃甜的 '), '傲2娇8，爱吃甜的')
  assert.equal([...cardText('字'.repeat(CARD_MAX_CHARS + 50))].length, CARD_MAX_CHARS)
})

test('a character JSON becomes labelled text, flat or under data', () => {
  assert.match(cardText(JSON.stringify({ name: '阿禾', personality: '爱吐槽' })), /名字：阿禾\n性格：爱吐槽/)
  assert.match(cardText(JSON.stringify({ spec: 'chara_card_v2', data: { name: '阿禾', first_mes: '你来啦' } })), /开场白：你来啦/)
  // JSON that is not a card, and text that only looks like it, stay text.
  assert.equal(cardText('{"foo": 1}'), '{"foo": 1}')
  assert.equal(cardText('{不是 JSON'), '{不是 JSON')
})

/** A PNG with one text chunk (the checksum is not read). */
function png(key: string, value: string): Uint8Array {
  const text = Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')])
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
  }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('tEXt', text), chunk('IEND', Buffer.alloc(0))]))
}

test('a card PNG gives up the character inside', () => {
  const inner = Buffer.from(JSON.stringify({ data: { name: '阿禾', description: '编剧' } })).toString('base64')
  assert.match(cardFromPng(png('chara', inner))!, /名字：阿禾\n描述：编剧/)
  assert.match(cardFromPng(png('ccv3', inner))!, /阿禾/)
})

test('a PNG with no card, or not a PNG, gives nothing', () => {
  assert.equal(cardFromPng(png('Software', 'x')), undefined)
  assert.equal(cardFromPng(png('chara', '!!!not base64')), undefined)
  assert.equal(cardFromPng(new Uint8Array([1, 2, 3])), undefined)
})

test('the answer is read, cut to size, or refused', () => {
  assert.deepEqual(parsePersonaCard('{"name":"阿禾","persona":"你是阿禾。","callYou":"小笨蛋"}'), { name: '阿禾', persona: '你是阿禾。', callYou: '小笨蛋' })
  assert.equal(parsePersonaCard('{"refused": true}'), 'refused')
  assert.equal(parsePersonaCard('写不出来'), undefined)
  assert.equal(parsePersonaCard('{"name":"","persona":"x"}'), undefined)
  const long = parsePersonaCard(JSON.stringify({ name: '名'.repeat(30), persona: '人'.repeat(4000) }))
  assert.ok(long !== undefined && long !== 'refused')
  assert.equal([...long.name].length, 20)
  assert.equal([...long.persona].length, 3000)
  assert.equal(long.callYou, '')
})

test('the prompt treats the card as material and keeps her an adult', () => {
  const prompt = personaCardPrompt()
  assert.match(prompt, /只是要读的材料/)
  assert.match(prompt, /成年人/)
  assert.match(prompt, /refused/)
})
