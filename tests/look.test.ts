import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeWhen, inHours, LOOK_FORMAT, pickScene, shouldSwitch, validateLook, type Look } from '../body/shared/look.ts'

const look: Look = {
  format: LOOK_FORMAT,
  id: 'showroom',
  name: '样板间',
  scenes: [
    { id: 'window', name: '窗边', pack: 'p-window', when: { hours: '7-10' } },
    { id: 'desk', name: '书桌', pack: 'p-desk', when: { hours: '10-18', user: 'active' } },
    { id: 'sofa', name: '沙发', pack: 'p-sofa', when: { user: 'idle' } },
    { id: 'bedroom', name: '卧室', pack: 'p-bedroom', when: { hours: '21-24' } },
    { id: 'bed', name: '床上', pack: 'p-bed', when: { hours: '0-7' } },
  ],
  default: 'bedroom',
}

test('hour ranges, including ones past midnight', () => {
  assert.equal(inHours('7-10', 7), true)
  assert.equal(inHours('7-10', 10), false)
  assert.equal(inHours('22-7', 23), true)
  assert.equal(inHours('22-7', 3), true)
  assert.equal(inHours('22-7', 12), false)
  assert.equal(inHours('21-24', 23), true)
  assert.equal(inHours('0-24', 5), true)
  assert.equal(inHours('早上', 8), false)
})

test('the scene follows the time of day', () => {
  assert.equal(pickScene(look, { hour: 8, idleSeconds: 0 }), 'window')
  assert.equal(pickScene(look, { hour: 22, idleSeconds: 0 }), 'bedroom')
  assert.equal(pickScene(look, { hour: 2, idleSeconds: 0 }), 'bed')
})

test('a rule about you beats a time of day', () => {
  // 14:00, using the computer: the desk.
  assert.equal(pickScene(look, { hour: 14, idleSeconds: 10 }), 'desk')
  // 14:00, away for 10 minutes: the sofa (no hours, but a rule about you).
  assert.equal(pickScene(look, { hour: 14, idleSeconds: 600 }), 'sofa')
  // 8:00 and away: the sofa beats the window.
  assert.equal(pickScene(look, { hour: 8, idleSeconds: 600 }), 'sofa')
  // 14:00, neither active nor long idle (2 minutes): nothing matches, the default.
  assert.equal(pickScene(look, { hour: 14, idleSeconds: 120 }), 'bedroom')
})

test('scenes switched off are skipped', () => {
  assert.equal(pickScene(look, { hour: 8, idleSeconds: 0 }, ['window']), 'bedroom')
})

test('switching waits, and never happens when held, switched off or busy', () => {
  const now = 10 * 60 * 60_000
  assert.equal(shouldSwitch(look, {}, 'bedroom', 'window', now, false), true)
  assert.equal(shouldSwitch(look, { switchedAt: now - 5 * 60_000 }, 'bedroom', 'window', now, false), false)
  assert.equal(shouldSwitch(look, { switchedAt: now - 25 * 60_000 }, 'bedroom', 'window', now, false), true)
  assert.equal(shouldSwitch(look, { locked: true }, 'bedroom', 'window', now, false), false)
  assert.equal(shouldSwitch(look, { auto: false }, 'bedroom', 'window', now, false), false)
  assert.equal(shouldSwitch(look, {}, 'bedroom', 'window', now, true), false)
  assert.equal(shouldSwitch(look, {}, 'window', 'window', now, false), false)
  assert.equal(shouldSwitch({ minStayMinutes: 1 }, { switchedAt: now - 2 * 60_000 }, 'a', 'b', now, false), true)
})

test('rules in words', () => {
  assert.equal(describeWhen({ hours: '7-10' }), '7–10 点')
  assert.equal(describeWhen({ hours: '10-18', user: 'active' }), '10–18 点 · 你在用电脑时')
  assert.equal(describeWhen(undefined), '没有条件时')
})

test('a look is checked before use', () => {
  assert.ok(validateLook(look).look)
  assert.match(validateLook({ ...look, default: 'kitchen' }).problem ?? '', /默认场景/)
  assert.match(validateLook({ ...look, scenes: [] }).problem ?? '', /没有场景/)
  assert.match(validateLook({ format: 'x' }).problem ?? '', /不是/)
})
