/**
 * The local voice child process: sherpa-onnx speech recognition (SenseVoice)
 * and synthesis (Kokoro), on CPU. It runs apart from DSH so a native crash or
 * a long synthesis never stalls or kills the host. The parent (engine.ts)
 * forks it with advanced IPC serialization, so audio travels as typed arrays.
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'

export interface WorkerInit {
  asrDir?: string
  ttsDir?: string
  threads: number
  /** Kokoro model file inside ttsDir: model.onnx (fp32, default) or model.int8.onnx. */
  ttsModel?: string
}

export type WorkerRequest =
  | { id: number; op: 'init'; init: WorkerInit }
  | { id: number; op: 'asr'; samples: Float32Array; sampleRate: number }
  | { id: number; op: 'tts'; text: string; sid: number; speed: number }

export type WorkerReply =
  | { id: number; ok: true; op: 'init'; loadMs: number; speakers: number }
  | { id: number; ok: true; op: 'asr'; text: string; lang: string; ms: number }
  | { id: number; ok: true; op: 'tts'; samples: Float32Array; sampleRate: number; ms: number }
  | { id: number; ok: false; error: string }

interface Sherpa {
  OfflineRecognizer: { createAsync(config: unknown): Promise<Recognizer> }
  OfflineTts: { createAsync(config: unknown): Promise<Tts> }
  GenerationConfig: new (options: { sid: number; speed: number; silenceScale?: number }) => unknown
}
interface Recognizer {
  createStream(): { acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void }
  decodeAsync(stream: unknown): Promise<{ text: string; lang?: string }>
}
interface Tts {
  numSpeakers: number
  generateAsync(options: { text: string; generationConfig: unknown; enableExternalBuffer?: boolean }): Promise<{ samples: Float32Array; sampleRate: number }>
}

const require = createRequire(import.meta.url)
let sherpa: Sherpa | undefined
let recognizer: Recognizer | undefined
let tts: Tts | undefined

async function init(options: WorkerInit): Promise<{ loadMs: number; speakers: number }> {
  const started = Date.now()
  sherpa ??= require('sherpa-onnx-node') as Sherpa
  if (options.asrDir !== undefined) {
    recognizer = await sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        senseVoice: { model: join(options.asrDir, 'model.int8.onnx'), language: '', useInverseTextNormalization: 1 },
        tokens: join(options.asrDir, 'tokens.txt'),
        numThreads: options.threads,
        provider: 'cpu',
        debug: 0,
      },
    })
  }
  if (options.ttsDir !== undefined) {
    const dir = options.ttsDir
    tts = await sherpa.OfflineTts.createAsync({
      model: {
        kokoro: {
          model: join(dir, options.ttsModel ?? 'model.onnx'),
          voices: join(dir, 'voices.bin'),
          tokens: join(dir, 'tokens.txt'),
          dataDir: join(dir, 'espeak-ng-data'),
          dictDir: join(dir, 'dict'),
          lexicon: [join(dir, 'lexicon-us-en.txt'), join(dir, 'lexicon-zh.txt')].join(','),
        },
        numThreads: options.threads,
        provider: 'cpu',
        debug: 0,
      },
      ruleFsts: ['date-zh.fst', 'phone-zh.fst', 'number-zh.fst'].map(f => join(dir, f)).join(','),
      maxNumSentences: 1,
    })
  }
  return { loadMs: Date.now() - started, speakers: tts?.numSpeakers ?? 0 }
}

async function handle(request: WorkerRequest): Promise<WorkerReply> {
  const started = Date.now()
  switch (request.op) {
    case 'init': {
      const { loadMs, speakers } = await init(request.init)
      return { id: request.id, ok: true, op: 'init', loadMs, speakers }
    }
    case 'asr': {
      if (recognizer === undefined) throw new Error('speech recognition is not loaded')
      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples: request.samples, sampleRate: request.sampleRate })
      const result = await recognizer.decodeAsync(stream)
      return { id: request.id, ok: true, op: 'asr', text: result.text.trim(), lang: result.lang ?? '', ms: Date.now() - started }
    }
    case 'tts': {
      if (tts === undefined || sherpa === undefined) throw new Error('speech synthesis is not loaded')
      const generationConfig = new sherpa.GenerationConfig({ sid: request.sid, speed: request.speed, silenceScale: 0.2 })
      // Electron (the DSH desktop app) forbids external buffers inside its V8 memory cage; copy instead.
      const audio = await tts.generateAsync({ text: request.text, generationConfig, enableExternalBuffer: false })
      return { id: request.id, ok: true, op: 'tts', samples: audio.samples, sampleRate: audio.sampleRate, ms: Date.now() - started }
    }
  }
}

process.on('message', (message: WorkerRequest) => {
  handle(message).then(
    reply => process.send?.(reply),
    (error: unknown) => process.send?.({ id: message.id, ok: false, error: (error as Error).message ?? String(error) }),
  )
})
process.on('disconnect', () => process.exit(0))
