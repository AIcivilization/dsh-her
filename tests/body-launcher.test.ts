import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bodyRunning, findDevBody } from '../src/dsh/body-launcher.ts'

test('a body is running only when body.json names a live process', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-her-body-'))
  assert.equal(bodyRunning(home), false)
  writeFileSync(join(home, 'body.json'), JSON.stringify({ pid: process.pid }))
  assert.equal(bodyRunning(home), true)
  // Far above any real pid range: no such process.
  writeFileSync(join(home, 'body.json'), JSON.stringify({ pid: 2 ** 30 }))
  assert.equal(bodyRunning(home), false)
  writeFileSync(join(home, 'body.json'), 'not json')
  assert.equal(bodyRunning(home), false)
})

test('an unbuilt body is reported as missing, not launched', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-her-pkg-'))
  const plan = findDevBody(root)
  assert.ok('missing' in plan)
  assert.match(plan.missing, /npm run build/)
})
