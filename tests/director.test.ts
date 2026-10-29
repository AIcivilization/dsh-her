import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Director, type GraphClip } from '../body/renderer/director.ts'

function c(id: string, from: string, to: string, role: GraphClip['role'], name: string, durationMs = 2000): GraphClip {
  return { id, from, to, role, name, interruptible: role !== 'transition', durationMs }
}

const clips: GraphClip[] = [
  c('stand_idle_01', 'stand', 'stand', 'state', 'idle'),
  c('stand_idle_02', 'stand', 'stand', 'state', 'idle'),
  c('stand_talk_01', 'stand', 'stand', 'state', 'talk'),
  c('stand_happy_01', 'stand', 'stand', 'emotion', 'happy'),
  c('stand_wave_01', 'stand', 'stand', 'action', 'wave'),
  c('sit_idle_01', 'sit', 'sit', 'state', 'idle'),
  c('sit_talk_01', 'sit', 'sit', 'state', 'talk'),
  c('sit_to_stand', 'sit', 'stand', 'transition', 'transition', 1500),
  c('stand_to_sit', 'stand', 'sit', 'transition', 'transition', 1500),
  c('stand_exit_right', 'stand', 'off', 'transition', 'exit'),
  c('off_enter_right', 'off', 'stand', 'transition', 'enter'),
  c('off_enter_right_jk', 'off', 'stand@jk', 'transition', 'enter'),
  c('stand@jk_idle_01', 'stand@jk', 'stand@jk', 'state', 'idle'),
  c('stand@jk_show_01', 'stand@jk', 'stand@jk', 'action', 'jk_show'),
  c('stand@jk_exit_right', 'stand@jk', 'off', 'transition', 'exit'),
  c('line_hello', 'stand', 'stand', 'line', 'line_hello'),
]
const macros = [
  { action: 'outfit_jk', goTo: 'stand@jk', then: 'jk_show' },
  { action: 'outfit_default', goTo: 'stand' },
]

/** Play n clips the way the player does, returning their ids. */
function play(director: Director, n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const clip = director.next()
    out.push(clip.id)
    director.played(clip)
  }
  return out
}

test('states loop at the current anchor; a missing state falls back to idle there', () => {
  const director = new Director(clips, macros, 'stand')
  for (const id of play(director, 6)) assert.match(id, /^stand_idle_0[12]$/)
  director.setState('talk')
  assert.deepEqual(play(director, 2), ['stand_talk_01', 'stand_talk_01'])
  director.setState('think')
  assert.match(play(director, 1)[0]!, /^stand_idle/)
})

test('two idle loops alternate instead of repeating', () => {
  const director = new Director(clips, macros, 'stand')
  const ids = play(director, 10)
  for (let i = 1; i < ids.length; i++) assert.notEqual(ids[i], ids[i - 1])
})

test('an action elsewhere walks there first, then settles', async () => {
  const director = new Director(clips, macros, 'sit')
  const done = director.act('wave')
  assert.deepEqual(play(director, 2), ['sit_to_stand', 'stand_wave_01'])
  assert.deepEqual(await done, { ok: true })
  assert.equal(director.at, 'stand')
})

test('"想看 JK": from sitting, stand up, leave, come back in the outfit, show it', async () => {
  const director = new Director(clips, macros, 'sit')
  const done = director.act('outfit_jk')
  assert.deepEqual(play(director, 4), ['sit_to_stand', 'stand_exit_right', 'off_enter_right_jk', 'stand@jk_show_01'])
  assert.deepEqual(await done, { ok: true })
  assert.equal(director.at, 'stand@jk')
  // Idle in the new outfit afterwards.
  assert.deepEqual(play(director, 1), ['stand@jk_idle_01'])
  // And back: the macro with no action to play ends on arrival.
  const back = director.act('outfit_default')
  assert.deepEqual(play(director, 2), ['stand@jk_exit_right', 'off_enter_right'])
  assert.deepEqual(await back, { ok: true })
})

test('unknown actions fail at once; emotions are best effort; clear drops what waits', async () => {
  const director = new Director(clips, macros, 'stand')
  assert.deepEqual(await director.act('fly'), { ok: false, reason: 'unsupported' })
  director.emote('cry')
  director.emote('happy')
  assert.deepEqual(play(director, 1), ['stand_happy_01'])
  const pending = director.act('wave')
  director.clear()
  assert.deepEqual(await pending, { ok: false, reason: 'interrupted' })
})

test('stored lines are actions played at their anchor', async () => {
  const director = new Director(clips, macros, 'sit')
  const done = director.act('line_hello')
  assert.deepEqual(play(director, 2), ['sit_to_stand', 'line_hello'])
  assert.deepEqual(await done, { ok: true })
})

test('the player asks for the next clip before the current one ends: an action plays once', async () => {
  const director = new Director(clips, macros, 'stand')
  const done = director.act('wave')
  const first = director.next()
  // Asked again while the wave is still on screen: not another wave.
  const second = director.next()
  assert.equal(first.id, 'stand_wave_01')
  assert.match(second.id, /^stand_idle/)
  director.played(first)
  assert.deepEqual(await done, { ok: true })
})

test('a macro that arrives with nothing to play there settles when its last step has played', async () => {
  const director = new Director(clips, macros, 'stand@jk')
  let settled = false
  const back = director.act('outfit_default').then(r => { settled = true; return r })
  const exit = director.next()
  director.played(exit)
  const enter = director.next()
  assert.deepEqual([exit.id, enter.id], ['stand@jk_exit_right', 'off_enter_right'])
  director.next()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  director.played(enter)
  assert.deepEqual(await back, { ok: true })
})

test('a light action or emotion never changes clothes to happen', async () => {
  const director = new Director(clips, macros, 'stand@jk')
  // Waving and "happy" exist only in the default outfit.
  director.emote('happy')
  const wave = director.act('wave')
  assert.match(director.next().id, /^stand@jk_idle/)
  assert.deepEqual(await wave, { ok: false, reason: 'unreachable' })
  // Changing clothes on purpose still goes off screen.
  const back = director.act('outfit_default')
  assert.deepEqual(play(director, 2), ['stand@jk_exit_right', 'off_enter_right'])
  assert.deepEqual(await back, { ok: true })
})
