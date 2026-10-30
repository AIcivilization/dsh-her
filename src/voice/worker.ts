/**
 * The local voice child process: sherpa-onnx speech recognition (SenseVoice),
 * on CPU. It runs apart from DSH so a native crash or
 * a long synthesis never stalls or kills the host. The parent (engine.ts)
 * forks it with advanced IPC serialization, so audio travels as typed arrays.
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'

export interface WorkerInit {
  asrDir: string
  threads: number
}

export type WorkerRequest =
  | { id: number; op: 'init'; init: WorkerInit }
  | { id: number; op: 'asr'; samples: Float32Array; sampleRate: number }

export type WorkerReply =
  | { id: number; ok: true; op: 'init'; loadMs: number }
  | { id: number; ok: true; op: 'asr'; text: string; lang: string; ms: number }
  | { id: number; ok: false; error: string }

interface Sherpa {
  OfflineRecognizer: { createAsync(config: unknown): Promise<Recognizer> }
}
interface Recognizer {
  createStream(): { acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void }
  decodeAsync(stream: unknown): Promise<{ text: string; lang?: string }>
}

const require = createRequire(import.meta.url)
let sherpa: Sherpa | undefined
let recognizer: Recognizer | undefined

async function init(options: WorkerInit): Promise<{ loadMs: number }> {
  const started = Date.now()
  sherpa ??= require('sherpa-onnx-node') as Sherpa
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
  return { loadMs: Date.now() - started }
}

async function handle(request: WorkerRequest): Promise<WorkerReply> {
  const started = Date.now()
  switch (request.op) {
    case 'init': {
      const { loadMs } = await init(request.init)
      return { id: request.id, ok: true, op: 'init', loadMs }
    }
    case 'asr': {
      if (recognizer === undefined) throw new Error('speech recognition is not loaded')
      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples: request.samples, sampleRate: request.sampleRate })
      const result = await recognizer.decodeAsync(stream)
      return { id: request.id, ok: true, op: 'asr', text: result.text.trim(), lang: result.lang ?? '', ms: Date.now() - started }
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
