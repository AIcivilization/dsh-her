// M0 development pack: turn third-party demo clips into something the body can
// play. These clips are for local testing only; they never enter the repository
// or a release.
//
//   node scripts/make-dev-pack.mjs <clips dir> <name> [--key black] [--scene] [--title 名字] [--out <packs dir>]
//
// With --key black the black background is keyed out (for the overlay mode):
// - default: a VP9 WebM with an alpha channel (decoded in software on macOS);
// - --stacked [width]: an H.264 MP4 with the colour on top and the alpha mask
//   below, hardware decoded and composited by the page in WebGL.
// Otherwise clips are re-muxed as they are; with --scene they fill the screen
// as a live wallpaper. Files with the same content are taken once.
// Output: <packs dir>/<name>/ (default ~/dsh-her-dev-assets) with clips and clips.json;
// with --out ~/.dsh-her-dev/packs it shows up among her looks.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'

/** Width and height from what `ffmpeg -i` prints. */
function size(text) {
  const match = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(text)
  if (match === null) return {}
  const [width, height] = [Number(match[1]), Number(match[2])]
  return layout === 'stacked' ? { width, height: height / 2 } : { width, height }
}

const [src, name, ...rest] = process.argv.slice(2)
if (src === undefined || name === undefined) {
  console.error('usage: node scripts/make-dev-pack.mjs <clips dir> <name> [--key black] [--stacked [width]]')
  process.exit(1)
}
const option = flag => {
  const at = rest.indexOf(flag)
  return at < 0 ? undefined : (rest[at + 1]?.startsWith('--') ? '' : rest[at + 1] ?? '')
}
const key = option('--key')
const stackedWidth = option('--stacked')
const layout = key === undefined ? 'opaque' : stackedWidth !== undefined ? 'stacked' : 'alpha'
const layer = rest.includes('--scene') ? 'scene' : 'overlay'
const title = option('--title') || name
const expandHome = dir => dir.replace(/^~(?=\/|$)/, homedir())
const out = join(expandHome(option('--out') || join(homedir(), 'dsh-her-dev-assets')), name)
mkdirSync(out, { recursive: true })
const clips = []
const seen = new Set()
for (const file of readdirSync(src).filter(f => extname(f).toLowerCase() === '.mp4').sort()) {
  const hash = createHash('sha1').update(readFileSync(join(src, file))).digest('hex')
  if (seen.has(hash)) {
    console.log(`skip ${file} (same as an earlier clip)`)
    continue
  }
  seen.add(hash)
  const id = `clip${String(clips.length + 1).padStart(2, '0')}`
  const input = join(src, file)
  if (layout === 'stacked') {
    const output = join(out, `${id}.mp4`)
    const width = Number(stackedWidth || 480)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-filter_complex',
      `[0]scale=${width}:-2,colorkey=0x000000:0.10:0.08,format=rgba,split[c][a];` +
      '[a]alphaextract,format=yuv420p[m];[c]format=yuv420p[rgb];[rgb][m]vstack,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-movflags', '+faststart', '-map_metadata', '-1', '-an', output])
    clips.push({ id, file: `${id}.mp4`, from: basename(file) })
  } else if (key === 'black') {
    const output = join(out, `${id}.webm`)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input,
      '-vf', 'colorkey=0x000000:0.10:0.08,format=yuva420p',
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32', '-row-mt', '1', '-map_metadata', '-1', '-an', output])
    clips.push({ id, file: `${id}.webm`, from: basename(file) })
  } else {
    const output = join(out, `${id}.mp4`)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-c', 'copy', '-map_metadata', '-1', '-an', output])
    clips.push({ id, file: `${id}.mp4`, from: basename(file) })
  }
  console.log(`${id} ← ${file}`)
}
// The picture's size, so the window can take its shape (the first clip's; for stacked files, the colour half).
const probe = spawnSync('ffmpeg', ['-hide_banner', '-i', join(out, clips[0].file)], { encoding: 'utf8' }).stderr
writeFileSync(join(out, 'clips.json'), JSON.stringify({ name, title, layer, layout, ...size(probe), clips }, null, 2))
console.log(`→ ${out}`)
