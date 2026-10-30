/**
 * Her voice, measured: cloud synthesis (CosyVoice) latency on a kept-open
 * connection, one sample per voice for listening, local recognition latency,
 * and a round trip (what she says, recognized back). Writes the WAVs and
 * results to `$DSH_HER_HOME/logs/voice-bench/`.
 *
 *   DSH_HER_HOME=~/.dsh-her-dev npm run voice:bench [-- --voices longanrou_v3,longxing_v3]
 *
 * Needs the Model Studio key (DASHSCOPE_API_KEY or the macOS keychain, see src/voice/cloud-key.ts).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeWav, DEFAULT_VOICE, herPaths, VOICE_MODEL, VOICES } from '../src/core/index.ts'
import { readCloudKey } from '../src/voice/cloud-key.ts'
import { CosyVoice } from '../src/voice/cosyvoice.ts'
import { LocalVoice } from '../src/voice/engine.ts'
import { MODELS, missingModels, modelPath } from '../src/voice/models.ts'

const paths = herPaths(process.env.DSH_HER_HOME ?? '~/.dsh-her')
const arg = (name: string) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : undefined
}
const voices = arg('--voices')?.split(',') ?? VOICES.map(v => v.id)
const out = join(paths.logs, 'voice-bench')
mkdirSync(out, { recursive: true })
const results: string[] = []

const cloud = new CosyVoice(VOICE_MODEL, readCloudKey)
const lines = ['你回来啦，我等你好久了。', '今天外面下雨，记得带伞哦。', '要不要我给你讲个故事？', '嗯。']
for (const [i, text] of lines.entries()) {
  const audio = await cloud.synthesize(text, DEFAULT_VOICE, 1)
  results.push(`tts #${i + 1} ${audio.ms} ms for ${(audio.durationMs / 1000).toFixed(2)} s audio · ${text}`)
  writeFileSync(join(out, `line${i + 1}.wav`), audio.audio)
}
for (const id of voices) {
  const audio = await cloud.synthesize('你好呀，我是住在你桌面上的小禾。今天过得怎么样？累不累呀？', id, 1)
  writeFileSync(join(out, `voice-${id}.wav`), audio.audio)
}
results.push(`voice samples (${voices.length}) → ${out}`)
cloud.close()

if (missingModels(paths.models).length === 0) {
  const asrDir = modelPath(paths.models, MODELS.find(m => m.id === 'asr')!)
  const asr = new LocalVoice({ asrDir, threads: 4 })
  const { loadMs } = await asr.start()
  results.push(`asr loaded in ${loadMs} ms`)
  for (const name of ['zh.wav', 'en.wav']) {
    const wav = decodeWav(readFileSync(join(asrDir, 'test_wavs', name)))
    const heard = await asr.recognize(wav.samples, wav.sampleRate)
    results.push(`asr ${name} ${(wav.samples.length / wav.sampleRate).toFixed(2)} s audio → ${heard.ms} ms · [${heard.lang}] ${heard.text}`)
  }
  const said = decodeWav(readFileSync(join(out, 'line1.wav')))
  const back = await asr.recognize(said.samples, said.sampleRate)
  results.push(`round trip → ${back.ms} ms · ${back.text}`)
  asr.stop()
} else {
  results.push('asr skipped: models missing (npm run voice:models)')
}

console.log(results.join('\n'))
writeFileSync(join(out, 'result.txt'), `${new Date().toISOString()} ${process.platform}-${process.arch}\n${results.join('\n')}\n`)
