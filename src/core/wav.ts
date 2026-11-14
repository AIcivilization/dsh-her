/** Minimal PCM16 mono WAV encoding/decoding for speech audio. */

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = wavHeader(samples.length * 2, sampleRate)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

/** Wrap raw little-endian PCM16 mono (as a cloud voice sends it) in a WAV header. */
export function wavFromPcm16(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const bytes = wavHeader(pcm.byteLength, sampleRate)
  bytes.set(pcm, 44)
  return bytes
}

/** A WAV file of `dataBytes` PCM16 mono bytes, header filled in, data zeroed. */
function wavHeader(dataBytes: number, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  return bytes
}

/**
 * Decode a WAV of 16-bit or 32-bit float samples (encodeWav's, a mic
 * capture, a local voice engine's); the first channel. A data chunk whose
 * size was left unfilled (a stream) runs to the end of the file.
 */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file')
  let offset = 12
  let sampleRate = 0
  let channels = 1
  let bits = 16
  let format = 1
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
      // WAVE_FORMAT_EXTENSIBLE: the real format is the sub-format GUID's first two bytes.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true)
    } else if (id === 'data') {
      const float = format === 3 && bits === 32
      if (!float && !(format === 1 && bits === 16)) throw new Error(`unsupported WAV: format ${format}, ${bits}-bit`)
      const width = bits / 8
      const frames = Math.floor(Math.min(size, bytes.byteLength - body) / width / Math.max(1, channels))
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        const at = body + i * width * channels
        samples[i] = float ? view.getFloat32(at, true) : view.getInt16(at, true) / 0x8000
      }
      return { samples, sampleRate }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV has no data chunk')
}
