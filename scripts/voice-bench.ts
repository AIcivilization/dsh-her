/**
 * M0 spike B: load the local voice models in a child process, then measure
 * synthesis (cold and warm, real-time factor) and recognition latency.
 * Writes sample WAVs to `$DSH_HER_HOME/logs/voice-bench/` so the voices can be
 * listened to and a default chosen.
 *
 *   DSH_HER_HOME=~/.dsh-her-dev npm run voice:bench [-- --sids 0,3,10,20,50,90]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeWav, encodeWav, herPaths } from '../src/core/index.ts'
import { LocalVoice } from '../src/voice/engine.ts'
import { MODELS, missingModels, modelPath } from '../src/voice/models.ts'

const paths = herPaths(process.env.DSH_HER_HOME ?? '~/.dsh-her')
if (missingModels(paths.models).length > 0) throw new Error('models missing: run npm run voice:models first')
const asrDir = modelPath(paths.models, MODELS.find(m => m.id === 'asr')!)
const ttsDir = modelPath(paths.models, MODELS.find(m => m.id === 'tts')!)
const arg = (name: string) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : undefined
}
const sids = arg('--sids')?.split(',').map(Number) ?? [3, 10, 20, 40, 60, 80]
const threads = Number(arg('--threads') ?? 4)
const ttsOverride = arg('--tts-dir')
const ttsModel = arg('--tts-model')
const out = join(paths.logs, 'voice-bench')
mkdirSync(out, { recursive: true })

const voice = new LocalVoice({ asrDir, ttsDir: ttsOverride ?? ttsDir, threads, ...(ttsModel === undefined ? {} : { ttsModel }) })
console.log(`threads ${threads} · tts ${ttsOverride ?? ttsDir} · ${ttsModel ?? 'model.onnx'}`)
const spawnAt = Date.now()
const { loadMs, speakers } = await voice.start()
console.log(`models loaded in ${loadMs} ms (child up after ${Date.now() - spawnAt} ms), ${speakers} speakers`)

const lines = ['你回来啦，我等你好久了。', '今天外面下雨，记得带伞哦。', '要不要我给你讲个故事？']
const results: string[] = []
for (const [i, text] of lines.entries()) {
  const audio = await voice.synthesize(text, sids[0]!)
  const seconds = audio.samples.length / audio.sampleRate
  results.push(`tts #${i + 1} ${audio.ms} ms for ${seconds.toFixed(2)} s audio (RTF ${(audio.ms / 1000 / seconds).toFixed(3)}) · ${text}`)
  writeFileSync(join(out, `line${i + 1}-sid${sids[0]}.wav`), encodeWav(audio.samples, audio.sampleRate))
}
for (const sid of sids) {
  const audio = await voice.synthesize('你好呀，我是住在你桌面上的小禾，今天过得怎么样？', sid)
  writeFileSync(join(out, `voice-sid${sid}.wav`), encodeWav(audio.samples, audio.sampleRate))
}
results.push(`voice samples for sids ${sids.join(', ')} → ${out}`)

for (const name of ['zh.wav', 'en.wav']) {
  const wav = decodeWav(readFileSync(join(asrDir, 'test_wavs', name)))
  const seconds = wav.samples.length / wav.sampleRate
  const heard = await voice.recognize(wav.samples, wav.sampleRate)
  results.push(`asr ${name} ${seconds.toFixed(2)} s audio → ${heard.ms} ms · [${heard.lang}] ${heard.text}`)
}
// Round trip: what she says, recognized back.
const said = decodeWav(readFileSync(join(out, `line1-sid${sids[0]}.wav`)))
const back = await voice.recognize(said.samples, said.sampleRate)
results.push(`round trip (${said.sampleRate} Hz input) → ${back.ms} ms · ${back.text}`)

console.log(results.join('\n'))
writeFileSync(join(out, 'result.txt'), `${new Date().toISOString()} ${process.platform}-${process.arch}\nload ${loadMs} ms\n${results.join('\n')}\n`)
voice.stop()
