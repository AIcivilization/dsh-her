import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { candidates, explain, NetError, setMirrors } from '../src/net.ts'
import { bundledRelease, latestRelease } from '../src/dsh/body-install.ts'

const GH = 'https://github.com/AIcivilization/dsh-her/releases/latest/download/a.zip'

test('a failed download says why, in plain words', () => {
  const failed = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code, message: '' } })
  assert.match(explain(GH, failed('ENOTFOUND')), /找不到 github\.com（域名解析失败）.*系统代理/)
  assert.match(explain(GH, failed('ECONNRESET')), /连不上 github\.com（连接被拒绝或被重置）/)
  assert.match(explain(GH, failed('UND_ERR_CONNECT_TIMEOUT')), /超时/)
  assert.match(explain(GH, failed('UNABLE_TO_VERIFY_LEAF_SIGNATURE')), /证书/)
  assert.match(explain(GH, new Error('HTTP 403')), /返回了错误（HTTP 403）/)
  assert.doesNotMatch(explain('https://example.com/x', failed('ECONNRESET')), /GitHub/)
})

test('mirrors are tried only for GitHub downloads', () => {
  assert.deepEqual(candidates(GH, ['https://ghfast.top/']), [GH, `https://ghfast.top/${GH}`])
  assert.deepEqual(candidates('https://huggingface.co/x', ['https://ghfast.top/']), ['https://huggingface.co/x'])
  setMirrors(['https://ok.example/', 'http://plain.example/', 'not a url'])
  assert.deepEqual(candidates(GH), [GH, `https://ok.example/${GH}`], 'only https prefixes ending in / are kept')
  setMirrors([])
  assert.deepEqual(candidates(GH), [GH])
})

test('the release bundled in the package is used only when it is GitHub’s', () => {
  const dir = mkdtempSync(join(tmpdir(), 'her-net-'))
  try {
    const manifest = { format: 'dsh-her-body@1', version: '0.3.0', assets: { 'win32-x64': { file: 'a.zip', size: 1, sha256: 'a'.repeat(64) } } }
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ base: 'https://github.com/AIcivilization/dsh-her/releases/download/v0.3.0/', manifest }))
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ base: 'https://evil.example/', manifest }))
    assert.equal(bundledRelease(join(dir, 'ok.json'))?.manifest.version, '0.3.0')
    assert.equal(bundledRelease(join(dir, 'bad.json')), undefined)
    assert.equal(bundledRelease(join(dir, 'missing.json')), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('without GitHub and without a bundled release, the error explains', async () => {
  // Nothing listens on port 9 here; the development tree has no lib/body-release.json.
  await assert.rejects(latestRelease('http://127.0.0.1:9/rel/'), (error: Error) => error instanceof NetError && /连不上 127\.0\.0\.1:9/.test(error.message))
})
