import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkMaterial, cleanSvg, parseFfmpegInfo } from '../src/pack/material-check.ts'

// What ffmpeg 8 prints for each kind (made with lavfi test sources).
const WEBM_ALPHA = `  Duration: 00:00:01.00, start: 0.000000, bitrate: 15 kb/s
  Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv, progressive), 320x240, SAR 1:1 DAR 4:3, 25 fps, 25 tbr, 1k tbn
        alpha_mode      : 1`
const MP4 = `  Duration: 00:00:12.50, start: 0.000000, bitrate: 18 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 9 kb/s, 25 fps, 25 tbr, 12800 tbn (default)`
const PNG = `  Duration: N/A, bitrate: N/A
  Stream #0:0: Video: png, rgba(pc, gbr/unknown/unknown), 64x64 [SAR 1:1 DAR 1:1], 25 fps, 25 tbr, 25 tbn`
const JPG = `  Duration: N/A, bitrate: N/A
  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 640x480 [SAR 1:1 DAR 4:3], 25 fps, 25 tbr, 25 tbn`

test('size, length and transparency from what ffmpeg says', () => {
  assert.deepEqual(parseFfmpegInfo(WEBM_ALPHA, 'video', 10), { kind: 'video', bytes: 10, alpha: true, width: 320, height: 240, durationMs: 1000 })
  assert.deepEqual(parseFfmpegInfo(MP4, 'video', 10), { kind: 'video', bytes: 10, alpha: false, width: 1920, height: 1080, durationMs: 12500 })
  assert.deepEqual(parseFfmpegInfo(PNG, 'image', 10), { kind: 'image', bytes: 10, alpha: true, width: 64, height: 64 })
  assert.equal(parseFfmpegInfo(JPG, 'image', 10).alpha, false)
})

test('each row has its own rules; a good file has none to say', () => {
  assert.deepEqual(checkMaterial('avatar', { kind: 'image', width: 512, height: 512, bytes: 1 }), [])
  assert.match(checkMaterial('avatar', { kind: 'image', width: 640, height: 480, bytes: 1 }).join(), /正方形/)
  assert.match(checkMaterial('avatar', { kind: 'image', width: 64, height: 64, bytes: 1 }).join(), /太小/)
  assert.match(checkMaterial('pet', { kind: 'video', width: 720, height: 1280, alpha: false, durationMs: 5000, bytes: 1 }).join(), /透明/)
  assert.deepEqual(checkMaterial('pet', { kind: 'video', width: 720, height: 1280, alpha: true, durationMs: 5000, bytes: 1 }), [])
  assert.match(checkMaterial('desktop', { kind: 'video', width: 1080, height: 1920, bytes: 1 }).join(), /比例/)
  assert.deepEqual(checkMaterial('desktop', { kind: 'video', width: 2560, height: 1600, bytes: 1 }), [])
  assert.match(checkMaterial('desktop', { kind: 'video', width: 2560, height: 1600, bytes: 300 * 1024 * 1024 }).join(), /很大/)
})

test('an SVG keeps its drawing and loses what could run', () => {
  const bad = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><rect id="衣服" fill="#2a6" onclick='x()'/></a><use href="#衣服"/><image href="https://evil.example/x.png"/><foreignObject><iframe src="x"/></foreignObject></svg>`
  const { svg, removed } = cleanSvg(bad)
  assert.equal(removed, true)
  for (const gone of ['onload', 'script', 'javascript:', 'onclick', 'evil.example', 'foreignObject', 'iframe']) assert.ok(!svg.includes(gone), gone)
  for (const kept of ['<rect id="衣服" fill="#2a6"/>', '<use href="#衣服"/>']) assert.ok(svg.includes(kept), kept)
  assert.equal(cleanSvg('<svg><circle r="3"/></svg>').removed, false)
})
