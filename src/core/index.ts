/** Pure logic with no DSH imports. */

export { FIRST_SOFT_CUT_AT, readingMs, SentenceSplitter, SOFT_CUT_AT } from './sentences.ts'
export { speakable } from './speakable.ts'
export { judgeBargeIn, type EchoVerdict } from './echo.ts'
export { EMOTION_WORDS, extractCues, isHeavy, performanceSection } from './cues.ts'
export { buildSystemPrompt, SAMPLE_PERSONA, type PromptParts } from './prompt.ts'
export { herPaths, type HerPaths } from './paths.ts'
export { decodeWav, encodeWav } from './wav.ts'
