/**
 * What the audio.cpp engine of the local Ming voice downloads
 * (docs/Ming跨平台.md): audio.cpp's own builds of `audiocpp_server`
 * (github.com/0xShug0/audio.cpp, Apache-2.0) and the Ming GGUF model
 * (audio-cpp/Ming-3.0-TTS-0.5B-GGUF, MIT), each pinned to its size and
 * SHA-256 (the release's own digests, and Hugging Face's LFS hash).
 *
 * Builds per computer, tried in order:
 * - main: the one installed first. Its program runs on the GPU (Metal,
 *   Vulkan) and on the CPU, so one download is measured both ways.
 * - fallback: CPU only, downloaded when nothing in the main build runs (a
 *   computer without a Vulkan driver cannot start the Vulkan program at all;
 *   a CPU without AVX2 needs the "portable" one).
 * - cuda: NVIDIA's own path; about 1 GB with its runtime, so only when asked.
 *
 * Linux uses audio.cpp's "portable" builds: they pick the CPU's instructions
 * when they start (the others are built for the CI machine's CPU). On Windows
 * "portable" means no AVX at all, slow, so it is only the last fallback.
 */

export const AUDIOCPP_VERSION = 'v0.9.4'

const RELEASE = `https://github.com/0xShug0/audio.cpp/releases/download/${AUDIOCPP_VERSION}/`

export type Backend = 'metal' | 'vulkan' | 'cuda' | 'cpu'

export interface AudioCppPackage {
  file: string
  size: number
  sha256: string
}

export interface AudioCppBuild {
  id: string
  kind: 'main' | 'fallback' | 'cuda'
  /** What its program can run on, best first. */
  backends: readonly Backend[]
  /** The program; for CUDA also its runtime libraries, unpacked into the same folder. */
  packages: readonly AudioCppPackage[]
}

const pkg = (file: string, size: number, sha256: string): AudioCppPackage => ({ file: `audio-${AUDIOCPP_VERSION}-${file}`, size, sha256 })

export const AUDIOCPP_BUILDS: Readonly<Record<string, readonly AudioCppBuild[]>> = {
  'darwin-arm64': [
    { id: 'macos-arm64-metal', kind: 'main', backends: ['metal', 'cpu'], packages: [pkg('bin-macos-arm64-metal.tar.gz', 36947118, '5722c4f33e56114345965c0dee472a9239218f7499ace6393bba6a951a41b86a')] },
  ],
  'darwin-x64': [
    { id: 'macos-x64-metal', kind: 'main', backends: ['metal', 'cpu'], packages: [pkg('bin-macos-x64-metal.tar.gz', 39330776, 'be2a35aa004cc3d63978c77723ee3f2805129eedf726172c45145ef114664451')] },
  ],
  'win32-x64': [
    { id: 'windows-x64-vulkan', kind: 'main', backends: ['vulkan', 'cpu'], packages: [pkg('bin-windows-x64-vulkan.zip', 84083745, '804f70cf47c7b8450ef37e76fc04ecee71728345061f6e749a412932dd7db7a7')] },
    { id: 'windows-x64-cpu', kind: 'fallback', backends: ['cpu'], packages: [pkg('bin-windows-x64-cpu.zip', 32323805, '596ef1d6ed5113f3a4f5194c8c00e02be5748d7dfb09e7f270168e6ec5c8e0cf')] },
    { id: 'windows-x64-cpu-portable', kind: 'fallback', backends: ['cpu'], packages: [pkg('bin-windows-x64-cpu-portable.zip', 32190461, '9c11a03b7ea21979792fde05f2f355ea1fc0da26ccd8f675dd61c628250ae76f')] },
    {
      id: 'windows-x64-cuda13.3', kind: 'cuda', backends: ['cuda'], packages: [
        pkg('bin-windows-x64-cuda13.3.zip', 279188412, 'b05eceb8aa0a29e618b3af87e0c2fd0fb665034d181096eb868ed856bf656b8b'),
        pkg('cudart-windows-x64-cuda13.3.zip', 575457454, 'b93fa9b9cb875ccea1aa81cb09fd6b02c9afda133de73bd119a73ff5d8db6d96'),
      ],
    },
  ],
  'linux-x64': [
    { id: 'ubuntu-x64-vulkan-portable', kind: 'main', backends: ['vulkan', 'cpu'], packages: [pkg('bin-ubuntu-x64-vulkan-portable.tar.gz', 87776393, '82808683beb5da2987abbdca5ba3b93622eb93568eda8d92acf1f7314a26dbab')] },
    { id: 'ubuntu-x64-cpu-portable', kind: 'fallback', backends: ['cpu'], packages: [pkg('bin-ubuntu-x64-cpu-portable.tar.gz', 70154506, '02756c556d78ccca8040cab6fbc6c7bf57d4f6ed70fe534e8a9e846bab464687')] },
    {
      id: 'ubuntu-x64-cuda12.8', kind: 'cuda', backends: ['cuda'], packages: [
        pkg('bin-ubuntu-x64-cuda12.8-colab.tar.gz', 229825141, '5b6708aa781a8a7b08d506abc6104ff9e642cb33c4271c768e81205c4c8df686'),
        pkg('cudart-ubuntu-x64-cuda12.8.tar.gz', 787014404, '48ab6515a4a924c128309bdeebed10c8e6a647f0399e66d46c986c6ba4e7c50f'),
      ],
    },
  ],
}

export const audiocppUrl = (file: string): string => `${RELEASE}${file}`

export const buildBytes = (build: AudioCppBuild): number => build.packages.reduce((sum, p) => sum + p.size, 0)

/**
 * The Ming model as audio.cpp reads it: one GGUF file, 8-bit (the speaker
 * encoder stays 32-bit). Sources in order: dsh-her's own release (when the
 * file is there), Hugging Face, and its mirror for mainland China; the size
 * and SHA-256 decide, whichever answered.
 */
export const MING_GGUF = {
  repo: 'audio-cpp/Ming-3.0-TTS-0.5B-GGUF',
  revision: '2eb8d37c7f10672e69c8aa33091baa04c461b66c',
  file: 'ming-3.0-tts-0.5b-q8_0.gguf',
  size: 1742280896,
  sha256: 'fcf2aa25e8e9cf2065a936e506581735c64d6255fb7869f09fbb61a2dde09aa1',
  sources: [
    'https://github.com/AIcivilization/dsh-her/releases/download/ming-gguf-1/',
    'https://huggingface.co/audio-cpp/Ming-3.0-TTS-0.5B-GGUF/resolve/2eb8d37c7f10672e69c8aa33091baa04c461b66c/',
    'https://hf-mirror.com/audio-cpp/Ming-3.0-TTS-0.5B-GGUF/resolve/2eb8d37c7f10672e69c8aa33091baa04c461b66c/',
  ],
} as const
