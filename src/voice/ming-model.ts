/**
 * The Ming voice's model: mlx-community/Ming-3.0-tts-0.5B-8bit (MIT, from
 * inclusionAI's Ming-3.0-tts-0.5B), pinned to one revision. A copy of the
 * same files is on dsh-her's GitHub release `ming-model-1`, which is tried
 * first (Hugging Face is slow or blocked in some places); each file is
 * checked against its size and SHA-256 whichever source it came from.
 */

export const MING_MODEL = {
  repo: 'mlx-community/Ming-3.0-tts-0.5B-8bit',
  revision: 'd0d1da6f627e4b3f20cc2db6ba4aee86d45343ad',
  sources: [
    'https://github.com/AIcivilization/dsh-her/releases/download/ming-model-1/',
    'https://huggingface.co/mlx-community/Ming-3.0-tts-0.5B-8bit/resolve/d0d1da6f627e4b3f20cc2db6ba4aee86d45343ad/',
  ],
  files: [
    { name: 'LICENSE', size: 1067, sha256: '2872f1918dfc04fdeb7f5d66d8d1b773594c9375e7c8f7bda39780bb97ad4fba' },
    { name: 'README.md', size: 4360, sha256: '0af63591f3ab08d8e057330477928692ce8a4234618aacd4f2a0095c5d50bda9' },
    { name: 'added_tokens.json', size: 1785, sha256: '34394b1e16d7da2db16618bd43a0f970902ade0075480bcd812fe62d559ec319' },
    { name: 'campplus.safetensors', size: 27699096, sha256: 'a479586bd8f8f96cdb414eaa2fa07c6cd54d6d1636562e2d75a0211cb3b0a6fd' },
    { name: 'config.json', size: 6087, sha256: '8ea3e685a870fd1a535d3b4a4c975fc20c4fca56e67acdef06fe40004064c73b' },
    { name: 'merges.txt', size: 1671853, sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5' },
    { name: 'model.safetensors', size: 1573366591, sha256: 'e88a4b53cb5b705703e961389f3d7f0e8b72c240b4dad796bf9961cc018971fc' },
    { name: 'model.safetensors.index.json', size: 201850, sha256: 'f59991abebed1a4f798a9488568af496d925e6eea507450aa8051a06f475a2ce' },
    { name: 'special_tokens_map.json', size: 2726, sha256: '2c2ec51b9da5db654ac20de8310350d0c9c1a65918ae0181b80dacd2919b4fc3' },
    { name: 'tokenizer.json', size: 11431389, sha256: '87d54ca3b44ea2f822ba39a0a45cb1b61644bd6606d9d3536dea75367bffb06d' },
    { name: 'tokenizer_config.json', size: 16260, sha256: '12d6162c815edef24f8606e65b60d43fe0d92b0a4e150a0db8fa01c523aaf36a' },
    { name: 'vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
  ],
} as const

export const MING_MODEL_BYTES = MING_MODEL.files.reduce((sum, f) => sum + f.size, 0)
