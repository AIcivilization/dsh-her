// A computer with no desktop, end to end: a real `dsh` with dsh-her in a web
// profile and a real browser. She must appear in DSH's page, take an uploaded
// folder of clips, and play the result through the brain.
//
//   node scripts/headless-check.mjs [--browser chrome]
//
// Needs `dsh` and ffmpeg on PATH and playwright-core installed. CI runs it on
// Ubuntu (.github/workflows/ci.yml). It makes a throwaway profile, `her-check`,
// and removes it afterwards; her data goes to a temporary folder.

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const PROFILE = 'her-check'
const PORT = 3193
const REPO = resolve(import.meta.dirname, '..')
const channel = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : undefined
const profileDir = join(homedir(), '.dsh', 'profiles', PROFILE)
const work = mkdtempSync(join(tmpdir(), 'her-check-'))
const home = join(work, 'home')

function step(text) {
  console.log(`\n== ${text}`)
}

function sh(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32', ...options })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

function setUpProfile() {
  step('profile with dsh-her linked in')
  sh('dsh', ['plugin', '--profile', PROFILE, 'add', `dsh-her@link:${REPO}`], { cwd: tmpdir() })
  const packagePath = join(profileDir, 'package.json')
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  manifest.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-her']
  writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), `- id: dsh-her\n  name: dsh-her\n  config:\n    home: ${JSON.stringify(home)}\n    body:\n      launch: "off"\n`)
}

/** Clips of a plain colour: the repository holds no media, and the importer only cares about names and specs. */
function makeClips() {
  step('clips')
  const dir = join(work, 'clips')
  mkdirSync(dir)
  for (const [name, colour] of [['stand_idle_01.mp4', 'green'], ['stand_talk_01.mp4', 'blue']]) {
    sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=${colour}:s=1080x1920:r=24:d=2`, '-pix_fmt', 'yuv420p', join(dir, name)])
  }
  return dir
}

function startDsh() {
  step('dsh')
  const child = spawn('dsh', ['--profile', PROFILE, '--no-open', '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  return {
    child,
    log: () => log,
    url: new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`dsh did not start:\n${log}`)), 180_000)
      const read = chunk => {
        log += chunk
        const found = log.match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)
        if (found !== null) {
          clearTimeout(timer)
          done(found[0])
        }
      }
      child.stdout.on('data', read)
      child.stderr.on('data', read)
      child.on('exit', code => fail(new Error(`dsh exited (${code}):\n${log}`)))
    }),
  }
}

/** In the page: what her page does, through the same addresses. */
async function herPost(page, path, body = {}) {
  return page.evaluate(async ([path, body]) => {
    const res = await fetch(`/api/dsh-her${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, value: await res.json() }
  }, [path, body])
}

async function run(url, clips) {
  const browser = await chromium.launch({ headless: true, ...(channel === undefined ? {} : { channel }) })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const failures = []
    page.on('pageerror', error => failures.push(error.message))
    const packResponses = []
    page.on('response', response => {
      if (response.url().includes('/api/dsh-her/web/file')) packResponses.push(response)
    })
    await page.goto(url)

    step('she shows in the page, with no desktop body')
    const frame = page.locator('iframe[src*="/api/dsh-her/web/page"]')
    await frame.waitFor({ state: 'attached', timeout: 60_000 })
    const state = (await herPost(page, '/state')).value.state
    if (state.body.connected) throw new Error('a desktop body is connected: this is not the check it should be')
    console.log(`desktop body exists here: ${state.body.desktopExists}; web: ${JSON.stringify(state.body.web)}`)
    if (process.platform === 'linux') {
      if (state.body.desktopExists) throw new Error('Linux must not offer the desktop body')
      await page.getByRole('button', { name: '她', exact: true }).first().click()
      await page.getByRole('button', { name: '2. 身体' }).click()
      await page.getByText('dsh 跑在 Linux 上').waitFor({ timeout: 30_000 })
      if (await page.getByRole('button', { name: '直接下载安装' }).count() > 0) throw new Error('Linux must not offer to install a desktop program')
      if (await page.getByRole('button', { name: '启动身体' }).count() > 0) throw new Error('Linux must not offer to start a desktop program')
      console.log('the wizard says she lives in the page, and offers nothing to install')
    }

    step('upload a folder and import it on the brain')
    const { batch } = (await herPost(page, '/web/new-batch')).value
    for (const file of readdirSync(clips)) {
      const bytes = readFileSync(join(clips, file)).toString('base64')
      const status = await page.evaluate(async ([batch, file, bytes]) => {
        const body = Uint8Array.from(atob(bytes), c => c.charCodeAt(0))
        return (await fetch(`/api/dsh-her/web/upload?batch=${encodeURIComponent(batch)}&path=${encodeURIComponent(file)}`, { method: 'POST', credentials: 'same-origin', body })).status
      }, [batch, file, bytes])
      if (status !== 200) throw new Error(`upload ${file}: HTTP ${status}`)
    }
    const started = await herPost(page, '/web/import-batch', { batch, name: 'check' })
    if (started.status !== 200) throw new Error(`import: ${JSON.stringify(started.value)}`)
    const deadline = Date.now() + 180_000
    for (;;) {
      const now = (await herPost(page, '/state')).value.state.import
      if (now.state === 'done') {
        console.log(`imported: ${now.lines?.map(line => line.text).join(' / ')}`)
        break
      }
      if (now.state === 'failed') throw new Error(`import failed: ${JSON.stringify(now)}`)
      if (Date.now() > deadline) throw new Error(`import is taking too long: ${JSON.stringify(now)}`)
      await new Promise(done => setTimeout(done, 500))
    }

    step('she plays it, through the brain')
    const inner = page.frameLocator('iframe[src*="/api/dsh-her/web/page"]')
    await inner.locator('video').first().waitFor({ state: 'attached', timeout: 60_000 })
    await page.waitForFunction(() => {
      const iframe = document.querySelector('iframe[src*="/api/dsh-her/web/page"]')
      return [...(iframe?.contentDocument?.querySelectorAll('video') ?? [])].some(video => video.readyState >= 2 && !video.error)
    }, undefined, { timeout: 60_000 })
    const kept = packResponses.find(response => response.url().includes('&v='))
    if (kept === undefined) throw new Error('no pack file was asked for with its date in the address')
    const cache = (await kept.allHeaders())['cache-control']
    if (!/immutable/.test(cache ?? '')) throw new Error(`pack file cache-control: ${cache}`)
    console.log(`video plays; cache-control: ${cache}`)

    if (failures.length > 0) throw new Error(`errors in the page:\n${failures.join('\n')}`)
  } finally {
    await browser.close()
  }
}

let dsh
try {
  setUpProfile()
  const clips = makeClips()
  dsh = startDsh()
  await run(await dsh.url, clips)
  console.log('\nok')
} finally {
  dsh?.child.removeAllListeners('exit')
  dsh?.child.kill()
  rmSync(profileDir, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
}
