import { test } from 'node:test'
import assert from 'node:assert/strict'
import { afterSpeaking, afterYou, cleanRecord, cleanSettings, decide, DEFAULT_INITIATIVE, EMPTY_RECORD, inQuietHours, initiativePrompt, MAX_UNANSWERED, MIN_GAP_MS, parseOpening, Presence, TALKED_QUIET_MS, type InitiativeInput } from '../src/core/initiative.ts'

const dayOf = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
const noon = new Date(2026, 10, 5, 12, 0)
const at = noon.getTime()
const HOUR = 3_600_000
const input = (change: Partial<InitiativeInput> = {}): InitiativeInput => ({
  settings: DEFAULT_INITIATIVE, record: EMPTY_RECORD, now: noon, dayOf, ready: true, bodyHere: true, presence: 'active', busy: false, due: [], ...change,
})
const why = (change: Partial<InitiativeInput>) => {
  const decision = decide(input(change))
  assert.equal(decision.go, false)
  return (decision as { why: string }).why
}

test('every gate keeps her quiet and says why', () => {
  assert.match(why({ settings: { ...DEFAULT_INITIATIVE, on: false } }), /关着/)
  assert.match(why({ record: { ...EMPTY_RECORD, focusUntil: -1 } }), /专注/)
  assert.match(why({ record: { ...EMPTY_RECORD, focusUntil: at + HOUR } }), /专注/)
  assert.match(why({ ready: false }), /向导/)
  assert.match(why({ bodyHere: false }), /身体/)
  assert.match(why({ presence: undefined }), /不知道/)
  assert.match(why({ presence: 'idle' }), /不在/)
  assert.match(why({ presence: 'away' }), /不在/)
  assert.match(why({ busy: true }), /正在说话/)
  assert.match(why({ now: new Date(2026, 10, 5, 23, 45) }), /安静/)
  assert.match(why({ now: new Date(2026, 10, 5, 7, 0) }), /安静/)
  assert.match(why({ record: { ...EMPTY_RECORD, day: dayOf(noon), count: 3 } }), /3 次/)
  assert.match(why({ record: { ...EMPTY_RECORD, unanswered: MAX_UNANSWERED } }), /没回/)
  assert.match(why({ record: { ...EMPTY_RECORD, retryAt: at + 1 } }), /没说成/)
  assert.match(why({ record: { ...EMPTY_RECORD, lastTalkAt: at - TALKED_QUIET_MS + 1 } }), /刚聊过/)
  assert.match(why({ record: { ...EMPTY_RECORD, lastAt: at - MIN_GAP_MS + 1 } }), /刚说过/)
})

test('an expired focus no longer keeps her quiet', () => {
  assert.equal(decide(input({ record: { ...EMPTY_RECORD, focusUntil: at - 1 } })).go, true)
})

test('yesterday\'s count does not count today', () => {
  assert.equal(decide(input({ record: { ...EMPTY_RECORD, day: '2026-11-4', count: 3 } })).go, true)
})

test('each opening you did not answer doubles the wait', () => {
  const record = { ...EMPTY_RECORD, unanswered: 2, lastTalkAt: at - 2 * HOUR, nextCompanyAt: at - 1 }
  assert.match(why({ record: { ...record, lastAt: at - 5.9 * HOUR } }), /刚说过/)
  assert.equal(decide(input({ record: { ...record, lastAt: at - 6.1 * HOUR } })).go, true)
})

test('she picks the moment: a date first, then a first hello, then your return, then company', () => {
  const talkedToday = at - 2 * HOUR
  const moment = (change: Partial<InitiativeInput>) => {
    const decision = decide(input(change))
    assert.equal(decision.go, true)
    return (decision as { moment: { kind: string } }).moment.kind
  }
  const due = [{ id: 'e1', text: '面试', due: '2026-11-06' }]
  assert.equal(moment({ due }), 'due')
  assert.equal(moment({}), 'hello')
  assert.equal(moment({ record: { ...EMPTY_RECORD, lastTalkAt: talkedToday, nextCompanyAt: at + HOUR }, returned: { awayMinutes: 90 } }), 'back')
  assert.equal(moment({ record: { ...EMPTY_RECORD, lastTalkAt: talkedToday, nextCompanyAt: at - 1 } }), 'company')
  assert.match(why({ record: { ...EMPTY_RECORD, lastTalkAt: talkedToday, nextCompanyAt: at + HOUR } }), /还没到/)
})

test('a date she already brought up is not brought up again', () => {
  const decision = decide(input({ due: [{ id: 'e1', text: '面试', due: '2026-11-06' }], record: { ...EMPTY_RECORD, raised: ['e1'] } }))
  assert.equal(decision.go && decision.moment.kind, 'hello')
})

test('speaking counts, your answer clears the back-off', () => {
  const spoke = afterSpeaking(EMPTY_RECORD, { kind: 'due', id: 'e1', text: 'x', due: 'y' }, '面试加油', noon, dayOf, () => 0)
  assert.equal(spoke.count, 1)
  assert.equal(spoke.unanswered, 1)
  assert.equal(spoke.lastAt, at)
  assert.deepEqual(spoke.raised, ['e1'])
  assert.deepEqual(spoke.recent, ['面试加油'])
  const answered = afterYou(spoke, at + 1000, () => 0)
  assert.equal(answered.unanswered, 0)
  assert.equal(answered.lastTalkAt, at + 1000)
})

test('a try from the page does not use up her day', () => {
  const tried = afterSpeaking(EMPTY_RECORD, undefined, '试试', noon, dayOf, () => 0)
  assert.equal(tried.count, 0)
  assert.equal(tried.unanswered, 0)
  assert.equal(tried.lastAt, 0)
})

test('quiet hours may run past midnight or not, and equal means none', () => {
  const settings = { ...DEFAULT_INITIATIVE, quietFrom: 13 * 60, quietTo: 14 * 60 }
  assert.equal(inQuietHours(settings, new Date(2026, 1, 1, 13, 30)), true)
  assert.equal(inQuietHours(settings, new Date(2026, 1, 1, 14, 0)), false)
  assert.equal(inQuietHours({ ...settings, quietTo: 13 * 60 }, new Date(2026, 1, 1, 13, 0)), false)
})

test('a damaged file gives defaults, not a crash', () => {
  assert.deepEqual(cleanRecord('x'), EMPTY_RECORD)
  assert.deepEqual(cleanRecord({ count: 'no', recent: [1, 'a'] }), { ...EMPTY_RECORD, recent: ['a'] })
  assert.deepEqual(cleanSettings(null), DEFAULT_INITIATIVE)
  assert.equal(cleanSettings({ perDay: 999 }).perDay, DEFAULT_INITIATIVE.perDay)
  assert.equal(cleanSettings({ on: false }).on, false)
})

test('her line comes out clean; PASS means nothing to say', () => {
  assert.equal(parseOpening('「今天下雨了。」'), '今天下雨了。')
  assert.equal(parseOpening('PASS'), undefined)
  assert.equal(parseOpening('  pass  '), undefined)
  assert.equal(parseOpening(''), undefined)
  assert.equal([...parseOpening('字'.repeat(500))!].length, 160)
})

test('the prompt carries the moment and what not to repeat', () => {
  const text = initiativePrompt({ kind: 'back', awayMinutes: 120 }, ['昨天那句'], ['对方：我去吃饭'])
  assert.match(text, /大约 2 小时/)
  assert.match(text, /昨天那句/)
  assert.match(text, /我去吃饭/)
  assert.match(text, /PASS/)
})

test('presence: a silent body stops counting, and any active body means you are here', () => {
  const presence = new Presence(180_000)
  assert.equal(presence.current(at), undefined)
  presence.report('desktop', 'idle', at)
  assert.equal(presence.current(at), 'idle')
  presence.report('web', 'active', at)
  assert.equal(presence.current(at), 'active')
  assert.equal(presence.current(at + 180_001), undefined)
  presence.report('web', 'away', at)
  presence.report('desktop', 'away', at)
  assert.equal(presence.current(at), 'away')
})

test('presence: coming back after a long while is noticed once, for a few minutes', () => {
  const presence = new Presence(180_000, 30 * 60_000, 300_000)
  assert.equal(presence.report('desktop', 'active', at), false)
  assert.equal(presence.report('desktop', 'active', at + 60_000), false)
  assert.equal(presence.returned(at + 60_000), undefined)
  const back = at + 60_000 + 45 * 60_000
  assert.equal(presence.report('desktop', 'active', back), true)
  assert.deepEqual(presence.returned(back), { awayMinutes: 45 })
  assert.equal(presence.returned(back + 300_001), undefined)
  presence.clearReturned()
  assert.equal(presence.returned(back), undefined)
})
