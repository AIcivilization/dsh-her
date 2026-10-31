/** Pure logic with no DSH imports. */

export { FIRST_SOFT_CUT_AT, readingMs, SentenceSplitter, SOFT_CUT_AT } from './sentences.ts'
export { speakable } from './speakable.ts'
export { judgeBargeIn, type EchoVerdict } from './echo.ts'
export { EMOTION_WORDS, extractCues, isHeavy, performanceSection } from './cues.ts'
export { buildSystemPrompt, memoryContext, SAMPLE_PERSONA, type MemoryContext, type PromptParts } from './prompt.ts'
export { herPaths, type HerPaths } from './paths.ts'
export { DEFAULT_VOICE, MING_MOODS, mingSpeech, OWN_PREFIX, SERVICE_NAMES, serviceOf, VOICE_MODEL, VOICES, voiceName, type VoiceOption, type VoiceService } from './voices.ts'
export { extractSounds, SOUND_SECTION, withSounds } from './sounds.ts'
export { spokenNumbers } from './spoken-numbers.ts'
export { invalidCharacter, loadCharacter, saveCharacter, type Character, type Pronoun } from './character.ts'
export { decodeWav, encodeWav, wavFromPcm16 } from './wav.ts'
