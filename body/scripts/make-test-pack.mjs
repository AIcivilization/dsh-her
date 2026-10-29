// Synthetic test pack "测试小人" (test doll): a figure made of boxes on a green
// screen, named exactly as docs/素材生成提示词.md tells a user to name clips.
// Every clip starts and ends exactly on its anchor pose, so seams are perfect
// and the import check and pose graph can be tested before real footage
// exists. Each clip shows its id in the corner, to see what plays.
//
// With --scene the figure stands in a simple room (16:9) instead of on green,
// and the empty room is written as plate.png: a scene pack for the wallpaper.
//
//   node scripts/make-test-pack.mjs [out dir=~/dsh-her-dev-assets/test-doll-src] [--line-wav file] [--scene]
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const out = args[0] && !args[0].startsWith('--') ? args[0] : join(homedir(), 'dsh-her-dev-assets', 'test-doll-src')
const lineWav = args.includes('--line-wav') ? args[args.indexOf('--line-wav') + 1] : undefined
const scene = args.includes('--scene')
mkdirSync(join(out, 'lines'), { recursive: true })

const W = scene ? 960 : 540
const H = scene ? 540 : 720
const FPS = 24
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
const POSE = scene
  ? { stand: { x: 600, y: 60 }, sit: { x: 600, y: 150 }, off: { x: 1000, y: 60 } }
  : { stand: { x: 170, y: 200 }, sit: { x: 170, y: 320 }, off: { x: 600, y: 200 } }
/** The background as a lavfi source: green screen, or a room (wall, floor, sofa). */
const background = (seconds) => scene
  ? `color=c=0x2B2D42:s=${W}x${H}:r=${FPS}${seconds === undefined ? '' : `:d=${seconds}`},drawbox=x=0:y=400:w=${W}:h=140:c=0x3D3A4B:t=fill,drawbox=x=420:y=330:w=460:h=150:c=0x6B4F3A:t=fill,drawbox=x=420:y=290:w=460:h=50:c=0x7E5D45:t=fill`
  : `color=c=0x00B140:s=${W}x${H}:r=${FPS}${seconds === undefined ? '' : `:d=${seconds}`}`

const ffmpeg = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a])

// Figures: head + body (+ skirt for the jk outfit), transparent around.
const figures = { base: join(out, '.fig_base.png'), jk: join(out, '.fig_jk.png') }
ffmpeg('-f', 'lavfi', '-i', 'color=c=black@0:s=200x460,format=rgba', '-frames:v', '1', '-vf',
  'drawbox=x=60:y=0:w=80:h=80:c=0xF2C9A0:t=fill:replace=1,drawbox=x=30:y=90:w=140:h=230:c=0xE06C8C:t=fill:replace=1,drawbox=x=45:y=320:w=40:h=140:c=0x5A4A6A:t=fill:replace=1,drawbox=x=115:y=320:w=40:h=140:c=0x5A4A6A:t=fill:replace=1',
  figures.base)
ffmpeg('-f', 'lavfi', '-i', 'color=c=black@0:s=200x460,format=rgba', '-frames:v', '1', '-vf',
  'drawbox=x=60:y=0:w=80:h=80:c=0xF2C9A0:t=fill:replace=1,drawbox=x=30:y=90:w=140:h=150:c=0x23305A:t=fill:replace=1,drawbox=x=20:y=240:w=160:h=80:c=0xB0283C:t=fill:replace=1,drawbox=x=50:y=320:w=35:h=140:c=0xF5F5F5:t=fill:replace=1,drawbox=x=115:y=320:w=35:h=140:c=0xF5F5F5:t=fill:replace=1',
  figures.jk)

/**
 * One clip: the figure overlaid on green with position expressions in t
 * (seconds) and T (the last frame's time, so expressions land exactly on
 * the anchor at the end). `extra` adds overlays (mouth, arm).
 */
function clip(file, { seconds, figure = 'base', x, y, mouth = false, arm = false, audio }) {
  const T = (seconds - 1 / FPS).toFixed(4)
  const fx = String(x).replaceAll('T', T)
  const fy = String(y).replaceAll('T', T)
  const inputs = ['-f', 'lavfi', '-i', background(seconds), '-loop', '1', '-i', figures[figure]]
  let graph = `[0][1]overlay=x='${fx}':y='${fy}':shortest=1:eval=frame[v0]`
  let last = 'v0'
  if (mouth) {
    graph += `;[${last}]drawbox=x='${POSE.stand.x + 85}':y='${POSE.stand.y + 55}':w=30:h=8:c=0x7A2030:t=fill:enable='lt(mod(t\\,0.25)\\,0.12)'[v1]`
    last = 'v1'
  }
  if (arm) {
    inputs.push('-f', 'lavfi', '-i', `color=c=0xF2C9A0:s=24x90:r=${FPS}:d=${seconds}`)
    graph += `;[${last}][2]overlay=x=${POSE.stand.x + 170}:y='${POSE.stand.y + 90}-110*sin(PI*t/${T})':eval=frame[v2]`
    last = 'v2'
  }
  const id = file.replace(/^.*\//, '').replace(/\.mp4$/, '')
  graph += `;[${last}]drawtext=fontfile=${FONT}:text='${id}':x=12:y=h-34:fontsize=20:fontcolor=white@0.85[out]`
  const audioInput = inputs.filter(a => a === '-i').length
  const audioArgs = audio === undefined ? ['-an'] : ['-map', `${audioInput}:a`, '-c:a', 'aac']
  ffmpeg(...inputs, ...(audio === undefined ? [] : ['-i', audio]), '-filter_complex', graph, '-map', '[out]', ...audioArgs,
    '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', join(out, file))
}

const sway = (base, amp) => `${base}+${amp}*sin(2*PI*min(t\\,T)/T)`
const move = (from, to) => `${from}+(${to}-${from})*min(1\\,t/T)`

clip('stand_idle_01.mp4', { seconds: 3, x: sway(POSE.stand.x, 8), y: POSE.stand.y })
clip('stand_idle_02.mp4', { seconds: 3, x: POSE.stand.x, y: `${POSE.stand.y}-6*sin(PI*min(t\\,T)/T)` })
clip('stand_talk_01.mp4', { seconds: 2, x: POSE.stand.x, y: POSE.stand.y, mouth: true })
clip('stand_talk_02.mp4', { seconds: 2.5, x: sway(POSE.stand.x, 4), y: POSE.stand.y, mouth: true })
clip('stand_listen_01.mp4', { seconds: 2, x: POSE.stand.x, y: `${POSE.stand.y}+5*sin(PI*min(t\\,T)/T)` })
clip('stand_happy_01.mp4', { seconds: 2, x: POSE.stand.x, y: `${POSE.stand.y}-25*abs(sin(2*PI*min(t\\,T)/T))` })
clip('stand_wave_01.mp4', { seconds: 2.5, x: POSE.stand.x, y: POSE.stand.y, arm: true })
clip('sit_idle_01.mp4', { seconds: 3, x: sway(POSE.sit.x, 5), y: POSE.sit.y })
clip('sit_talk_01.mp4', { seconds: 2, x: POSE.sit.x, y: POSE.sit.y })
clip('sit_to_stand.mp4', { seconds: 1.5, x: POSE.sit.x, y: move(POSE.sit.y, POSE.stand.y) })
clip('stand_to_sit.mp4', { seconds: 1.5, x: POSE.stand.x, y: move(POSE.stand.y, POSE.sit.y) })
clip('stand_exit_right.mp4', { seconds: 2, x: move(POSE.stand.x, POSE.off.x), y: POSE.stand.y })
clip('off_enter_right.mp4', { seconds: 2, x: move(POSE.off.x, POSE.stand.x), y: POSE.stand.y })
clip('off_enter_right_jk.mp4', { seconds: 2, figure: 'jk', x: move(POSE.off.x, POSE.stand.x), y: POSE.stand.y })
clip('stand@jk_idle_01.mp4', { seconds: 3, figure: 'jk', x: sway(POSE.stand.x, 8), y: POSE.stand.y })
clip('stand@jk_show_01.mp4', { seconds: 2.5, figure: 'jk', x: sway(POSE.stand.x, 40), y: POSE.stand.y })
clip('stand@jk_exit_right.mp4', { seconds: 2, figure: 'jk', x: move(POSE.stand.x, POSE.off.x), y: POSE.stand.y })

// Anchor stills: the exact first frames.
for (const [name, figure, pose] of [['anchor_stand.png', 'base', POSE.stand], ['anchor_sit.png', 'base', POSE.sit], ['anchor_stand@jk.png', 'jk', POSE.stand]]) {
  ffmpeg('-f', 'lavfi', '-i', background(), '-i', figures[figure], '-frames:v', '1',
    '-filter_complex', `[0][1]overlay=x=${pose.x}:y=${pose.y}`, join(out, name))
}

// A stored line: talking at the stand anchor, with its own audio and transcript.
if (lineWav !== undefined && existsSync(lineWav)) {
  const seconds = Number(execFileSync('ffmpeg', ['-i', lineWav, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).match(/time=(\d+):(\d+):([\d.]+)/)?.slice(1).reduce((s, v, i) => s + Number(v) * [3600, 60, 1][i], 0) ?? 2)
  clip('lines/line_hello.mp4', { seconds: Math.max(1, Math.ceil(seconds * FPS) / FPS), x: POSE.stand.x, y: POSE.stand.y, mouth: true, audio: lineWav })
  copyFileSync(lineWav, join(out, 'lines', 'line_hello.wav'))
  execFileSync('sh', ['-c', `printf '%s' '你好呀，我是测试小人。' > "${join(out, 'lines', 'line_hello.txt')}"`])
}
if (scene) ffmpeg('-f', 'lavfi', '-i', background(), '-frames:v', '1', join(out, 'plate.png'))
console.log(`→ ${out}`)
