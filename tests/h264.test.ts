import assert from 'node:assert/strict'
import { test } from 'node:test'
import { h264Args, pickH264 } from '../src/pack/media.ts'

// Lines as `ffmpeg -encoders` prints them.
const GPL = ` V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D libopenh264          OpenH264 H.264 / MPEG-4 AVC (codec h264)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)`
const LGPL = ` V....D libopenh264          OpenH264 H.264 / MPEG-4 AVC (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)`
const WINDOWS = ` V....D h264_mf              H264 via MediaFoundation (codec h264)`
const NONE = ` V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D aac                  AAC (Advanced Audio Coding)`

test('the best H.264 encoder the build has', () => {
  assert.equal(pickH264(GPL), 'libx264')
  assert.equal(pickH264(LGPL), 'libopenh264')
  assert.equal(pickH264(WINDOWS), 'h264_mf')
  assert.equal(pickH264(NONE), undefined)
})

test('CRF for libx264, a bitrate for the others', () => {
  assert.deepEqual(h264Args('libx264', 20), ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20'])
  assert.deepEqual(h264Args('libopenh264', 12), ['-c:v', 'libopenh264', '-b:v', '20M', '-maxrate', '20M'])
  assert.deepEqual(h264Args('h264_mf', 22), ['-c:v', 'h264_mf', '-b:v', '5M', '-maxrate', '5M'])
})
