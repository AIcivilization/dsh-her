/**
 * The DSH shell: opens her session as soon as DSH's agent services are ready,
 * serves the body protocol, starts the body, and exposes `/her`. Everything
 * hangs off `ctx.effect`, so disabling or uninstalling the plugin closes her
 * session handle and the server (the body stays up and waits, asleep).
 *
 * Every reply of her session, whoever prompted it (the body's input box or
 * microphone, the DSH page, `/her`), goes to connected bodies as `speak.*`
 * sentences, each with its synthesized audio (or, without a voice, timed by
 * reading speed). Replies are live only: a body that connects later never gets
 * earlier ones replayed.
 *
 * Listening: a body sends what you said as audio; it is recognized here and
 * goes to her like typed text. When a body cuts her off (you started talking),
 * it reports how far she got; her next turn is told what you actually heard.
 *
 * Performing: the connected body's pack decides what she can do. Her prompt
 * lists it; inline tags in her reply become cues on the sentence they are in,
 * and longer performances go through her `play_action` tool, which waits for
 * the body's `act.done`.
 *
 * Memory: files under `<home>/characters/<cid>/memory/` (src/memory). She
 * writes with `remember`, reads with `recall`, and her prompt carries what she
 * knows about you, her last diary days and what has a date today or tomorrow.
 * A minute after each talk, a short note picks out of the new turns what is
 * worth keeping (as candidates), so it shows on the "她记得的事" page at once.
 * Once a day (30 minutes after you last talked, or from 23:30) a digest reads
 * the day back from her session and writes her diary page and candidates.
 *
 * Her replies are also logged with timings to `<home>/logs/stream.jsonl`.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { buildSystemPrompt, cardText, DEFAULT_VOICE, extractCues, extractSounds, FALLBACK_LINES, herPaths, initiativePrompt, invalidCharacter, judgeBargeIn, loadCharacter, memoryContext, OWN_PREFIX, parseOpening, parsePersonaCard, parseTouchLines, performanceSection, personaCardPrompt, readingMs, saveCharacter, SentenceSplitter, serviceOf, SOUND_SECTION, speakable, touchClip, touchLinesPrompt, TouchTracker, withSounds, type Character, type Moment, type TouchLines } from '../core/index.ts'
import { digestPrompt, notePrompt, parseDigest, transcriptOf } from '../memory/digest.ts'
import { dayOf, FileMemory } from '../memory/store.ts'
import { PROTOCOL_VERSION, type BodyMessage, type BrainMessage, type LookView, type PackSummary, type WindowMode } from '../protocol/index.ts'
import { BrainServer } from '../server/brain-server.ts'
import { type AvatarView, API_BASE, apiHandlers, handle, type ApiRuntime } from './api.ts'
import { bodyRunning, findDevBody, launchBody, type LaunchPlan } from './body-launcher.ts'
import { compareVersions, desktopBodyExists, downloadFolder, install, installDownloaded, installedBody, installedPlan, latestRelease, manualInstall, type InstallState, type ManualInstall } from './body-install.ts'
import { IDLE_IMPORT, type ImportStatus, type ReportLine } from './import-status.ts'
import { DESK_DIR, newProject, sceneDir } from '../core/workshop.ts'
import { assignClip, avatarIn, avatarOf, exampleFile, examples, exportProject, findProject, importProject, listProjects, prepareImport, projectStatus, removeStray, saveProject } from './workshop.ts'
import type { HerConfig } from './config.ts'
import { HerSession, type DshServices, type ModelRoute } from './her-session.ts'
import { heardText, SpeechQueue } from '../voice/speech-queue.ts'
import { webShows, fileResponse, packFile, WEB_BASE, WebBody, type WebMode } from './web-body.ts'
import { saveUpload, uploadAllowed, uploadTarget } from './uploads.ts'
import { Initiative } from './initiative.ts'
import { cachePreview, fetchPresets, installPreset, previewPath, type Preset } from './presets.ts'
import { importLook, type LookRequest } from '../pack/import-look.ts'
import { importPack } from '../pack/import.ts'
import { plateIn, saveFrame } from '../pack/frame.ts'
import { makeAvatar, makeAvatarClip } from '../pack/avatar.ts'
import { ffmpegCommand, stillSize } from '../pack/media.ts'
import { ensureFfmpeg, findFfmpeg } from './ffmpeg-fetch.ts'
import { Voice } from '../voice/voice.ts'
import { httpFetch, NetError, setMirrors } from '../net.ts'
import { defaultIdleMinutes, MingVoice } from '../voice/ming.ts'
import { MING_STEPS, OwnVoices, prepareRecording } from '../voice/ming-voices.ts'

interface CommandsLike {
  register(definition: {
    name: string
    description: string
    input?: { hint: string }
    handler: (invocation: { rawInput: string }) => Promise<{ kind: 'success' | 'error'; text: string }>
  }): () => void
}

const SERVICES = ['agents', 'agentDefaultModel', 'workspaceRegistry', 'sessionTitle', 'sessionQuery', 'llm'] as const

interface LlmLike {
  stream(options: {
    provider: string
    model: string
    reasoningEffort?: string
    system?: string
    messages: Array<{ role: 'user'; content: Array<{ type: 'text'; text: string }> }>
    maxTokens?: number
  }): AsyncIterable<{ type: string; text?: string; reason?: unknown; error?: unknown; message?: unknown }>
}

/** The error a model stream chunk carries, if any (an `error` chunk, or a finish whose reason is an error). */
function chunkError(chunk: { type: string; reason?: unknown; error?: unknown; message?: unknown }): string | undefined {
  const reason = chunk.reason as { kind?: string; error?: { message?: string } } | undefined
  if (chunk.type === 'error') return String((chunk.error as { message?: string } | undefined)?.message ?? chunk.message ?? '模型出错了')
  if (reason?.kind === 'error') return reason.error?.message ?? '模型出错了'
  return undefined
}

/** What to tell you when her model failed: the likely fix, in plain words. */
export function explainModelError(message: string, model: string): string {
  if (/no API key|api[_ ]?key|401|unauthori[sz]ed/i.test(message)) return `她用的模型（${model}）没有 API key，没法回答。到「她 → 设置 → 模型」换一个能用的模型，或者在 dsh 的设置里给它填上 key。`
  if (/quota|insufficient|balance|余额|429/i.test(message)) return `她用的模型（${model}）额度不够或请求太多，暂时没法回答。可以等一会儿，或在「她 → 设置 → 模型」换一个。`
  if (/timeout|timed out|ECONN|network|fetch failed/i.test(message)) return `连不上她用的模型（${model}），检查一下网络，或者换一个模型。`
  return `她用的模型（${model}）出错了：${message.slice(0, 160)}`
}

/** This plugin's version, from its package.json (two folders up from src/dsh and lib/dsh alike). */
const PLUGIN_VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string }).version

/** The newest published plugin: npm itself, or its China mirror where that cannot be reached. */
async function npmLatest(): Promise<string> {
  let failure: unknown
  for (const registry of ['https://registry.npmjs.org/', 'https://registry.npmmirror.com/']) {
    try {
      const res = await httpFetch(`${registry}dsh-her/latest`, { signal: AbortSignal.timeout(15_000) })
      if (res.ok) return (await res.json() as { version: string }).version
      failure = new Error(`HTTP ${res.status}`)
    } catch (error) {
      failure = error
    }
  }
  throw new NetError('https://registry.npmjs.org/', failure)
}

/** After a failed digest, wait this long before trying again (the model is probably not usable yet). */
const DIGEST_RETRY_MS = 60 * 60_000

/** The digest runs this long after you last talked, or from DIGEST_HOUR:DIGEST_MINUTE. */
const DIGEST_IDLE_MS = 30 * 60_000
const DIGEST_HOUR = 23
const DIGEST_MINUTE = 30
const DIGEST_CHECK_MS = 5 * 60_000
/** A note is taken once you have been quiet this long and her reply is over. */
const NOTE_QUIET_MS = 60_000
const NOTE_CHECK_MS = 15_000

const STOP_WORDS = new Set(['停', '停下', 'stop'])
const MEMORY_WORDS = new Set(['记忆', 'memory'])
const INTERRUPT_CHECK = '测打断'
const DIAGNOSE = '诊断'
const OPEN_WORD = '开口'

/** How often she looks whether to speak first. */
const INITIATIVE_CHECK_MS = 60_000
/** What she told herself about her own lines and your touches waits for your next words; only the latest few matter. */
const MAX_NOTES = 4
/** After her touch lines could not be written, not again before this. */
const TOUCH_LINES_RETRY_MS = 10 * 60_000

/** How long after DSH starts to wait for a running body before starting one. */
const LAUNCH_AFTER_MS = 3000
/** The installed body checks the release for a newer version this soon after start, then this often. */
const UPDATE_FIRST_MS = 60_000
const UPDATE_CHECK_MS = 6 * 60 * 60_000
/**
 * A turn that has not started this long after you spoke is stuck. Seen in M4:
 * an effort id the route does not accept (`off`) left her session silent with
 * no error at all.
 */
const STUCK_AFTER_MS = 20_000

/** One reply as seen from the stream, for timing and for `/her`'s answer. */
interface ReplyTrace {
  attemptId: string
  startedAt: number
  firstSentenceAt?: number
  sentences: string[]
  outcome?: string
}

export function apply(ctx: Context, config: HerConfig): void {
  const paths = herPaths(config.home)
  setMirrors(config.body.mirrors)
  const cid = config.character.id
  const dir = join(paths.characters, cid)
  let services: DshServices | undefined
  let session: HerSession | undefined
  let server: BrainServer | undefined
  let sentAt: number | undefined
  let current: ReplyTrace | undefined
  const finished: ReplyTrace[] = []
  /** Resolves on the first sentence of the next reply. */
  let onFirstSentence: (() => void) | undefined
  let voice: Voice | undefined
  /** The local Ming voice (made with the voice) and her own Ming voices. */
  let ming: MingVoice | undefined
  const ownVoices = new OwnVoices(join(paths.root, 'voices', 'ming'))
  const usesMing = () => serviceOf(character.voice.id) === 'ming'
  let speech: SpeechQueue | undefined
  let nextStream = 1
  /** What you heard of her last cut-off reply; told to her before your next turn. */
  let cutNote: string | undefined
  let stuckTimer: NodeJS.Timeout | undefined
  const memory = new FileMemory(join(dir, 'memory'))
  /** Who she is: the "她" page's saved settings over the plugin config's defaults. */
  let character: Character = loadCharacter(dir, {
    name: config.character.name,
    persona: config.character.persona,
    callYou: '',
    pronoun: '他',
    voice: { id: config.voice.voice, speed: config.voice.speed },
    onboarded: false,
  })
  /** When you last talked to her, and the day of it (for the digest). */
  let lastTalkAt = 0
  let digesting: Promise<string> | undefined
  /** A digest that failed is not tried again before this (it ran every few minutes against a model with no key). */
  let digestRetryAt = 0
  /** The last reply that came out empty because her model failed; cleared by the next sentence she says. */
  let problem: { text: string; at: number } | undefined

  /** Write her diary page for `day` and keep what is worth keeping; a short report. */
  const digest = (day: string): Promise<string> => {
    digesting ??= runDigest(day)
      .then(report => {
        if (report.includes('失败')) digestRetryAt = Date.now() + DIGEST_RETRY_MS
        return report
      }, (error: Error) => {
        digestRetryAt = Date.now() + DIGEST_RETRY_MS
        throw error
      })
      .finally(() => { digesting = undefined })
    return digesting
  }

  /** One model call outside her session (digest, persona drafts): the whole answer as text. */
  const complete = async (system: string, user: string, maxTokens: number): Promise<string> => {
    const llm = (services as unknown as { llm?: LlmLike } | undefined)?.llm
    const target = route()
    if (llm === undefined || target === undefined) throw new Error('dsh 的模型服务还没准备好')
    let answer = ''
    for await (const chunk of llm.stream({
      provider: target.provider, model: target.model, ...(target.reasoningEffort === undefined ? {} : { reasoningEffort: target.reasoningEffort }),
      system, messages: [{ role: 'user', content: [{ type: 'text', text: user }] }], maxTokens,
    })) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') answer += chunk.text
      const error = chunkError(chunk)
      if (error !== undefined) throw new Error(error)
    }
    return answer.trim()
  }

  const runDigest = async (day: string): Promise<string> => {
    const id = session?.sessionId
    const query = services?.sessionQuery
    if (id === undefined || query === undefined) return '整理不了：dsh 的服务还没准备好'
    const [y, m, d] = day.split('-').map(Number) as [number, number, number]
    const start = new Date(y, m - 1, d).getTime()
    const lines = transcriptOf((await query.readSession(id)).events as Array<{ type: string; time?: number; data: unknown }>, start, start + 86_400_000)
    if (lines.length === 0) {
      memory.applyDigest(day, { diary: '', facts: [], episodes: [] }, new Date())
      return `${day} 没有聊天，不用整理`
    }
    const { facts, episodes } = memory.list()
    const prompt = digestPrompt(character.name, day, lines, facts.map(f => f.text), episodes.map(e => (e.due === undefined ? e.text : `${e.text}（${e.due}）`)), character.pronoun)
    const answer = await complete(prompt.system, prompt.user, 2000)
    const parsed = parseDigest(answer)
    if (parsed === undefined) {
      log({ event: 'digest', day, error: 'unparsable', answer: answer.slice(0, 400) })
      return `${day} 整理失败：模型没有给出能读懂的结果`
    }
    const added = memory.applyDigest(day, parsed, new Date())
    log({ event: 'digest', day, lines: lines.length, ...added })
    return `${day} 整理好了：日记 1 篇，新的候选事实 ${added.facts} 条，事件 ${added.episodes} 条`
  }

  /** Turns up to here have been noted (the daily digest still reads the whole day). */
  let notedUntil = Date.now()
  let noting: Promise<void> | undefined

  /** Note what in the turns since the last note is worth keeping; never throws. */
  const runNote = async (): Promise<void> => {
    const id = session?.sessionId
    const query = services?.sessionQuery
    if (id === undefined || query === undefined) return
    const from = notedUntil
    const to = Date.now()
    notedUntil = to
    const lines = transcriptOf((await query.readSession(id)).events as Array<{ type: string; time?: number; data: unknown }>, from, to)
    if (!lines.some(l => l.who === 'you')) return
    const now = new Date()
    const { facts, episodes } = memory.list()
    const prompt = notePrompt(character.name, dayOf(now), lines, facts.map(f => f.text), episodes.map(e => (e.due === undefined ? e.text : `${e.text}（${e.due}）`)), character.pronoun)
    const parsed = parseDigest(await complete(prompt.system, prompt.user, 800))
    if (parsed === undefined) {
      log({ event: 'note', error: 'unparsable' })
      return
    }
    log({ event: 'note', lines: lines.length, ...memory.keep(parsed, now) })
  }

  const noteTick = () => {
    if (noting !== undefined || current !== undefined || lastTalkAt <= notedUntil || Date.now() - lastTalkAt < NOTE_QUIET_MS) return
    noting = runNote()
      .catch((error: Error) => ctx.logger.warn(`dsh-her: note failed (${error.message})`))
      .finally(() => { noting = undefined })
  }

  /** Every few minutes: settle old candidates, and digest a day that has ended its talking. */
  const digestTick = () => {
    const now = new Date()
    memory.settle(now)
    if (now.getTime() < digestRetryAt) return
    const done = memory.lastDigestDay()
    if (lastTalkAt === 0) {
      // DSH restarted since you last talked: catch up on yesterday, if it was never digested.
      const yesterday = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
      if (done === undefined || done < yesterday) void digest(yesterday).then(report => ctx.logger.info(`dsh-her: ${report}`), () => {})
      return
    }
    const talkedDay = dayOf(new Date(lastTalkAt))
    if (done !== undefined && done >= talkedDay) return
    const late = now.getHours() > DIGEST_HOUR || (now.getHours() === DIGEST_HOUR && now.getMinutes() >= DIGEST_MINUTE)
    const quiet = now.getTime() - lastTalkAt >= DIGEST_IDLE_MS
    const nextDay = dayOf(now) !== talkedDay
    if (quiet || late || nextDay) void digest(talkedDay).then(report => ctx.logger.info(`dsh-her: ${report}`), (error: Error) => ctx.logger.warn(`dsh-her: digest failed (${error.message})`))
  }

  const aboutYou = () => {
    const now = new Date()
    return memoryContext({ profile: memory.profile(), recent: memory.recent(now), due: memory.due(now) })
  }
  /** What she said first and how you touched her, told to her session before your next words. */
  let notes: string[] = []
  const addNote = (note: string) => {
    notes = [...notes, note].slice(-MAX_NOTES)
  }
  /** Her own line in progress (an opening, a touch line), outside her session. */
  let ownLine: { uid: string; note: string } | undefined
  let nextOwn = 1
  /** Waiting for a reply to start, and until when her voice is still playing. */
  let awaitingReply = false
  let speakingUntil = 0
  const herBusy = () => current !== undefined || awaitingReply || Date.now() < speakingUntil

  /** Say one sentence of hers: her sound marks and performance tags are taken out, the rest goes to the voice. */
  const saySentence = (uid: string, seq: number, text: string) => {
    // Ming can sigh and laugh: those tags become its sound markers, out of the subtitle.
    const sounds = usesMing() ? extractSounds(text) : undefined
    const performed = extractCues(sounds?.text ?? text, bodyPack)
    const spoken = sounds !== undefined && sounds.before.length + sounds.after.length > 0 ? withSounds(performed.text, sounds) : undefined
    if (performed.text !== '' || performed.cues.length > 0) speech?.say(uid, seq, performed.text, performed.cues, spoken)
  }

  /** She says something by herself, not as a reply: the session hears of it before your next words. */
  const sayOwnLine = (text: string, note: string) => {
    if (speech === undefined) return
    voice?.warm()
    const uid = `own-${Date.now().toString(36)}-${nextOwn++}`
    ownLine = { uid, note }
    addNote(note)
    broadcast({ t: 'speak.begin', cid, uid })
    const splitter = new SentenceSplitter()
    const sentences = [...splitter.push(text), ...splitter.flush()]
    sentences.forEach((sentence, seq) => saySentence(uid, seq, sentence))
    speech.end(uid)
    speakingUntil = Math.max(speakingUntil, Date.now() + readingMs(text))
  }

  /** The last few lines you two said, for her opening. */
  const lastTalk = async (): Promise<string[]> => {
    const id = session?.sessionId
    const query = services?.sessionQuery
    if (id === undefined || query === undefined) return []
    const now = Date.now()
    const lines = transcriptOf((await query.readSession(id)).events as Array<{ type: string; time?: number; data: unknown }>, now - 3 * 86_400_000, now + 1000)
    return lines.slice(-6).map(line => `${line.who === 'you' ? '对方' : '你'}：${line.text}`)
  }
  const herSystem = () => buildSystemPrompt({
    name: character.name, persona: character.persona, you: { call: character.callYou, pronoun: character.pronoun },
    performance: performanceSection(bodyPack), aboutYou: aboutYou(), now: new Date(),
  })

  const initiative = new Initiative({
    file: join(dir, 'initiative.json'),
    dayOf,
    ready: () => character.onboarded,
    bodyHere: () => desktopConnected() || webBody.connected,
    busy: herBusy,
    due: now => memory.due(now),
    compose: async (moment: Moment | undefined, recent: string[]) => {
      const user = initiativePrompt(moment ?? { kind: 'company' }, recent, await lastTalk().catch(() => []))
      return parseOpening(await complete(herSystem(), user, 600))
    },
    speak: text => sayOwnLine(text, `（备注：刚才是你主动对对方说的："${text}"。）`),
    log: entry => log(entry),
    focusChanged: focus => server?.broadcast({ t: 'config', focus }),
  })

  /** Her lines for being touched, written once for this persona and kept. */
  const touchFile = join(dir, 'touch-lines.json')
  const tracker = new TouchTracker()
  let touchLines: { hash: string; lines: TouchLines } | undefined
  try {
    touchLines = JSON.parse(readFileSync(touchFile, 'utf8')) as typeof touchLines
  } catch {
    // not written yet
  }
  let writingLines = false
  let touchLinesRetryAt = 0
  const personaHash = () => createHash('sha1').update(`${character.name}\n${character.persona}`).digest('hex').slice(0, 12)
  const ensureTouchLines = () => {
    if (writingLines || !character.onboarded || touchLines?.hash === personaHash() || Date.now() < touchLinesRetryAt) return
    writingLines = true
    const hash = personaHash()
    void complete(herSystem(), touchLinesPrompt(), 800).then(answer => {
      const lines = parseTouchLines(answer)
      if (lines === undefined) {
        log({ event: 'touch-lines', unparsable: answer.slice(0, 400) })
        throw new Error('模型没有给出能读懂的结果')
      }
      touchLines = { hash, lines }
      writeFileSync(touchFile, `${JSON.stringify(touchLines, null, 2)}\n`)
      log({ event: 'touch-lines', hash })
    }).catch((error: Error) => {
      touchLinesRetryAt = Date.now() + TOUCH_LINES_RETRY_MS
      log({ event: 'touch-lines', error: error.message })
    }).finally(() => { writingLines = false })
  }
  const linesNow = (): TouchLines => (touchLines?.hash === personaHash() ? touchLines.lines : FALLBACK_LINES)

  /** You touched her: the body has already moved; a clip she has for it, and now and then a word. */
  const touched = (message: Extract<BodyMessage, { t: 'touch' }>) => {
    const part = message.part === 'head' ? 'head' : 'body'
    const kind = message.kind === 'long' ? 'long' : 'tap'
    initiative.heardYou()
    ensureTouchLines()
    const where = kind === 'long' ? '摸了摸你的头' : part === 'head' ? '点了点你的头' : '戳了你一下'
    if (herBusy()) return
    const clip = touchClip(bodyPack, part)
    if (clip !== undefined && 'act' in clip) void playAction(clip.act)
    else if (clip !== undefined) broadcast({ t: 'emotion', cid, emotion: clip.emotion })
    const mood = tracker.next(part, kind, Date.now())
    const line = mood === undefined ? undefined : tracker.pick(linesNow()[mood])
    if (line === undefined) return
    log({ event: 'touch', part, kind, line })
    sayOwnLine(line, `（备注：对方刚才${where}，你说了"${line}"。）`)
  }

  /** Ready-made looks offered on the release, and the one being fetched. */
  let presetList: Preset[] = []
  let presetState: { id: string; state: 'downloading' | 'failed'; done: number; total: number; error?: string } | undefined
  let presetDownload: AbortController | undefined

  /** The last barge-in, to check the utterance that follows it for echo. */
  let lastCut: { uid: string; at: number } | undefined
  /** The pack of the most recently connected body: what she can perform. */
  let bodyPack: PackSummary | undefined
  /** She can also live in DSH's own web page (VPS, no desktop). */
  const webBody = new WebBody(paths.root)
  /** The act id's body for the web page (desktop bodies count up from 1). */
  const WEB_BODY_ID = -1
  /** What she can do now: a desktop body speaks for her, else the web page. */
  const refreshBodyPack = () => {
    bodyPack = server?.bodies.at(-1)?.hello.packs[0] ?? (webBody.connected ? webBody.summary() : undefined)
  }
  const desktopConnected = () => (server?.bodies.length ?? 0) > 0
  /** What the body reports about itself, for the "她" page. */
  let bodyPacks: PackSummary[] = []
  let activePack: string | undefined
  let bodyLook: LookView | undefined
  let bodyMode: WindowMode | undefined
  let importStatus: ImportStatus = IDLE_IMPORT
  let lastHeard: { text: string; at: number } | undefined
  let discovery: { url: string; token: string } | undefined
  /** Actions sent to a body, waiting for its `act.done`. */
  /** The installed body: download, check, install, update (body-install.ts). */
  /** A server: nowhere to show a window, whatever is in the repository. */
  const noScreen = process.platform === 'linux' && process.env.DISPLAY === undefined && process.env.WAYLAND_DISPLAY === undefined
  const devBody = (): ReturnType<typeof findDevBody> => (noScreen ? { missing: 'no screen on this computer' } : config.body.useDev ? findDevBody() : { missing: 'useDev is off' })
  let installState: InstallState = { state: 'idle', dev: !('missing' in devBody()) }
  /** The body to start: the development one in the repository when there is one, else the installed app. */
  const bodyPlan = (): LaunchPlan | { missing: string } => {
    const dev = devBody()
    if (!('missing' in dev)) return dev
    return installedPlan(paths.root) ?? { missing: '还没有安装，在「她」页面点"下载安装身体"' }
  }
  /**
   * Install the release's body when there is none, or a newer one (`asked`:
   * the user pressed the button, so a first install starts the body too).
   * A development setup never updates itself.
   */
  const installLatest = async (asked: boolean): Promise<void> => {
    if (installState.dev && !asked) return
    const before = installedBody(paths.root)
    if (!asked && before === undefined) return
    installState = { ...installState, state: 'checking' }
    try {
      const { manifest, base } = await latestRelease(config.body.releases)
      installState = { ...installState, latest: manifest.version }
      if (before !== undefined && compareVersions(manifest.version, before.version) <= 0) {
        installState = { ...installState, state: 'idle' }
        return
      }
      installState = { ...installState, state: 'downloading', done: 0, total: 0 }
      downloading = new AbortController()
      const installed = await install(paths.root, base, manifest, (done, total) => {
        installState = { ...installState, state: done < total ? 'downloading' : 'installing', done, total }
      }, downloading.signal)
      afterInstall(installed.version, before !== undefined)
    } catch (error) {
      if (downloading?.signal.aborted === true) {
        installState = { ...installState, state: 'idle' }
        return
      }
      installState = { ...installState, state: 'failed', error: (error as Error).message }
      ctx.logger.warn(`dsh-her: body install/update failed (${(error as Error).message})`)
    } finally {
      downloading = undefined
    }
  }
  /** A body was installed: an update waits for "重启身体", a first install starts at once. */
  const afterInstall = (version: string, updated: boolean) => {
    installState = { ...installState, state: 'idle', installed: version, restart: updated && (server?.bodies.length ?? 0) > 0 }
    log({ event: 'body-installed', version })
    if (!updated && discovery !== undefined && (server?.bodies.length ?? 0) === 0 && !bodyRunning(paths.root)) {
      const plan = bodyPlan()
      if (!('missing' in plan)) launchBody(plan, { url: discovery.url, token: discovery.token, home: paths.root, pack: config.body.pack })
    }
  }
  /** The release the manual download page is about, so a file is checked against what its links said. */
  let manualRelease: Awaited<ReturnType<typeof latestRelease>> | undefined
  /** Cancels a running download. */
  let downloading: AbortController | undefined
  /** Stop the running body (it writes its pid to body.json) and wait for it to go. */
  const stopBody = async (): Promise<void> => {
    let pid: number | undefined
    try {
      pid = (JSON.parse(readFileSync(join(paths.root, 'body.json'), 'utf8')) as { pid?: number }).pid
    } catch {
      return
    }
    if (typeof pid !== 'number') return
    try {
      process.kill(pid)
    } catch {
      return
    }
    for (let i = 0; i < 50 && bodyRunning(paths.root); i++) await new Promise(r => setTimeout(r, 100))
  }
  /** Folder dialogs open on the body, waiting for the user's choice. */
  const folderPicks = new Map<string, (path: string | undefined) => void>()
  /** Ask the body to show a folder dialog; undefined when cancelled. */
  const pickFolder = (title: string, button: string, file?: string): Promise<string | undefined> => {
    const body = server?.bodies.at(-1)
    if (body === undefined) return Promise.reject(new Error('身体还没连上：选文件夹的窗口要在身体那边弹出来'))
    const id = `f${Date.now().toString(36)}`
    return new Promise(resolve => {
      const timer = setTimeout(() => { folderPicks.delete(id); resolve(undefined) }, 10 * 60_000)
      folderPicks.set(id, path => { clearTimeout(timer); resolve(path) })
      body.send({ t: 'folder.pick', id, title, button, ...(file === undefined ? {} : { file }) })
    })
  }
  /** Actions sent to a body and not done yet, with the body doing each. */
  const pendingActs = new Map<string, { body: number; settle: (result: { ok: boolean; reason?: string }) => void }>()
  let nextAct = 1

  /** Have the body perform an action and wait (at most 90 s) for it to finish. */
  const playAction = (action: string): Promise<{ ok: boolean; reason?: string; transcript?: string }> => {
    // The latest body that shows her (has packs), not a text-only client that connected after it.
    const bodies = server?.bodies ?? []
    const desktop = [...bodies].reverse().find(b => b.hello.packs.length > 0) ?? bodies.at(-1)
    const body = desktop ?? (webBody.connected ? { id: WEB_BODY_ID, send: (message: BrainMessage) => webBody.send(message) } : undefined)
    log({ event: 'play-action', action, body: body?.id ?? null, packActions: bodyPack?.actions.map(a => a.id) ?? null })
    if (body === undefined) return Promise.resolve({ ok: false, reason: 'no body' })
    const known = bodyPack?.actions.find(a => a.id === action)
    if (known === undefined) return Promise.resolve({ ok: false, reason: 'unsupported' })
    const id = `a${nextAct++}`
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        pendingActs.delete(id)
        resolve({ ok: false, reason: 'timeout' })
      }, 90_000)
      pendingActs.set(id, {
        body: body.id,
        settle: result => {
          clearTimeout(timer)
          log({ event: 'act', action, ...result })
          resolve(known.transcript === undefined || !result.ok ? result : { ...result, transcript: known.transcript })
        },
      })
      body.send({ t: 'act', cid, id, action })
    })
  }

  const log = (entry: Record<string, unknown>) => {
    try {
      appendFileSync(join(paths.logs, 'stream.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), cid, ...entry })}\n`)
    } catch (error) {
      ctx.logger.warn(`dsh-her: stream log failed (${(error as Error).message})`)
    }
  }

  const broadcast = (message: BrainMessage) => {
    server?.broadcast(message)
    webBody.send(message)
  }

  /** A reply with no words: record what the turn did instead (tool calls, reasoning only, errors). */
  /** Log the end of her session after a reply with no words; the model's error, when the turn ended on one. */
  const logQuietTurn = async (): Promise<string | undefined> => {
    const id = session?.sessionId
    const query = services?.sessionQuery
    if (id === undefined || query === undefined) return undefined
    try {
      // The reply's end can come before DSH has written the turn's end (and its error): wait for it a little.
      let events = (await query.readSession(id)).events.slice(-12)
      for (let i = 0; i < 10 && !events.some(e => e.type === 'turn/end'); i++) {
        await new Promise(resolve => setTimeout(resolve, 300))
        events = (await query.readSession(id)).events.slice(-12)
      }
      const failed = events.findLast(e => e.type === 'turn/end' && (e.data as { reason?: { kind?: string } }).reason?.kind === 'error')
      log({
        event: 'quiet-turn',
        events: events.map(e => {
          const data = e.data as { name?: string; arguments?: string; message?: { content?: Array<{ type: string; text?: string }> }; reason?: unknown }
          if (e.type === 'tool/call') return `tool/call ${data.name} ${data.arguments ?? ''}`
          if (e.type === 'assistant/message') return `assistant/message [${data.message?.content?.map(b => `${b.type}${b.text === undefined ? '' : `:${b.text.slice(0, 40)}`}`).join(', ') ?? ''}]`
          if (e.type === 'turn/end') return `turn/end ${JSON.stringify(data.reason).slice(0, 120)}`
          return e.type
        }),
      })
      return failed === undefined ? undefined : (failed.data as { reason: { error?: { message?: string } } }).reason.error?.message ?? '模型出错了'
    } catch (error) {
      log({ event: 'quiet-turn', error: (error as Error).message })
      return undefined
    }
  }

  /** Her model: the "她" page's choice, else the plugin config's, else DSH's default. */
  const route = (): ModelRoute | undefined => {
    const chosen = character.model
    if (chosen !== undefined) return { provider: chosen.provider, model: chosen.model, ...(chosen.effort ? { reasoningEffort: chosen.effort } : {}) }
    const effort = config.reasoningEffort === '' ? {} : { reasoningEffort: config.reasoningEffort }
    if (config.provider !== '' && config.model !== '') return { provider: config.provider, model: config.model, ...effort }
    const selected = services?.agentDefaultModel?.currentSelection()
    return selected === undefined ? undefined : { provider: selected.provider, model: selected.model, ...effort }
  }

  const open = () => {
    session?.ensure().catch(error => ctx.logger.warn(`dsh-her: her session not ready (${(error as Error).message})`))
  }

  /** Stop her current reply: generation, synthesis and every body's playback. */
  const cut = () => {
    if (ownLine !== undefined) {
      speech?.cancel(ownLine.uid)
      broadcast({ t: 'speak.cancel', cid, uid: ownLine.uid })
      ownLine = undefined
      speakingUntil = 0
    }
    if (current === undefined) return
    session?.interrupt()
    speech?.cancel(current.attemptId)
    broadcast({ t: 'speak.cancel', cid, uid: current.attemptId })
  }

  /** You said something (typed or spoken): cut her off if she is talking, then pass it on. */
  const hear = (text: string, via: 'text' | 'voice') => {
    if (session === undefined) return
    cut()
    sentAt = Date.now()
    lastTalkAt = sentAt
    awaitingReply = true
    speakingUntil = 0
    initiative.heardYou(sentAt)
    // A voice that has to start up (Ming after a quiet while) starts while she thinks.
    voice?.warm()
    broadcast({ t: 'state', cid, state: 'think' })
    clearTimeout(stuckTimer)
    stuckTimer = setTimeout(() => {
      log({ event: 'stuck', text, waitedMs: STUCK_AFTER_MS })
      awaitingReply = false
      void logQuietTurn()
      broadcast({ t: 'state', cid, state: 'idle' })
      broadcast({ t: 'bubble', cid, text: '（我好像卡住了，没能开始回答。看看 dsh 里她的会话和模型设置？）', ttlMs: 8000 })
    }, STUCK_AFTER_MS)
    stuckTimer.unref()
    const her = session
    const note = [...notes, ...(cutNote === undefined ? [] : [cutNote])].join('\n')
    cutNote = undefined
    notes = []
    ;(note === '' ? Promise.resolve() : her.note(note))
      .then(() => her.say(text, via))
      .catch((error: Error) => {
        awaitingReply = false
        broadcast({ t: 'state', cid, state: 'idle' })
        broadcast({ t: 'bubble', cid, text: `（我还没准备好：${error.message}）`, ttlMs: 6000 })
      })
  }

  /** A body cut her off at `seq`, `playedMs` into it: remember what you heard and stop the rest. */
  const interrupted = (uid: string, seq: number, playedMs: number) => {
    const heard = heardText(speech?.sentOf(uid) ?? [], seq, playedMs)
    cutNote = heard === ''
      ? '（备注：你上一段话刚开口就被对方打断了，对方什么都没听到。）'
      : `（备注：你上一段话只说到"${heard}"就被对方打断了，后面的部分对方没有听到。）`
    log({ event: 'interrupted', uid, seq, playedMs, heard })
    lastCut = { uid, at: Date.now() }
    if (ownLine?.uid === uid) {
      // What she said by herself was cut: the note above says how far she got, not the whole line.
      const whole = ownLine.note
      notes = notes.filter(n => n !== whole)
      ownLine = undefined
      speakingUntil = 0
    }
    if (current?.attemptId === uid) session?.interrupt()
    speech?.cancel(uid)
  }

  const onBodyMessage = (message: BodyMessage, audio: Uint8Array | undefined, source: 'desktop' | 'web' = 'desktop') => {
    switch (message.t) {
      case 'presence':
        if (message.state === 'active' || message.state === 'idle' || message.state === 'away') initiative.report(source, message.state)
        break
      case 'touch':
        touched(message)
        break
      case 'focus.set':
        initiative.setFocus(message.on ? 'span' : 'off')
        break
      case 'user.text': {
        voice?.warm()
        const text = message.text.trim()
        if (text !== '') hear(text, 'text')
        break
      }
      case 'user.utterance': {
        voice?.warm()
        if (message.text !== undefined) {
          broadcast({ t: 'heard', cid, uttId: message.uttId, text: message.text })
          if (message.text.trim() !== '') hear(message.text.trim(), 'voice')
          break
        }
        if (audio === undefined || voice === undefined) break
        const rate = Number(/@(\d+)k/.exec(message.format)?.[1] ?? 16) * 1000
        const endedAt = Date.now()
        voice.recognize(audio, rate).then(({ text, ms }) => {
          // Right after a barge-in: was it you, or her own voice through the speakers?
          const barge = lastCut !== undefined && endedAt - lastCut.at < 10_000 ? lastCut : undefined
          lastCut = undefined
          const verdict = barge === undefined ? 'you' : judgeBargeIn(text, (speech?.sentOf(barge.uid) ?? []).map(s => s.text).join(''))
          log({ event: 'heard', uttId: message.uttId, text, asrMs: ms, audioMs: message.durationMs, verdict })
          if (verdict !== 'you') {
            cutNote = undefined
            broadcast({ t: 'heard', cid, uttId: message.uttId, text: '', ignored: verdict })
            return
          }
          broadcast({ t: 'heard', cid, uttId: message.uttId, text })
          lastHeard = { text, at: Date.now() }
          if (text !== '') hear(text, 'voice')
          sentAt = endedAt
        }, (error: Error) => {
          broadcast({ t: 'heard', cid, uttId: message.uttId, text: '' })
          broadcast({ t: 'bubble', cid, text: `（我没听清：${error.message}）`, ttlMs: 5000 })
        })
        break
      }
      case 'interrupt':
        interrupted(message.uid, message.seq, message.playedMs)
        break
      case 'act.done': {
        const settle = pendingActs.get(message.id)?.settle
        pendingActs.delete(message.id)
        settle?.({ ok: message.ok, ...(message.reason === undefined ? {} : { reason: message.reason }) })
        break
      }
      case 'pack.list':
        bodyPacks = message.packs
        activePack = message.active
        bodyPack = message.packs.find(p => p.packId === message.active) ?? bodyPack
        break
      case 'mode.changed':
        bodyMode = message.mode
        break
      case 'folder.picked':
        folderPicks.get(message.id)?.(message.path)
        folderPicks.delete(message.id)
        break
      case 'look.state':
        bodyLook = message.look ?? undefined
        break
      case 'pack.progress':
        importStatus = { ...importStatus, state: 'running', done: message.done, total: message.total, step: message.step }
        break
      case 'pack.report':
        importStatus = { ...importStatus, state: message.ok ? 'done' : 'failed', lines: message.lines }
        break
      case 'panel.get':
        broadcast(panel())
        break
      case 'panel.set': {
        let error: string | undefined
        try {
          if (message.character !== undefined) api.saveCharacter(message.character)
          if (message.forget !== undefined) api.memoryRemove(message.forget)
          if (message.confirm !== undefined) api.memoryConfirm(message.confirm)
        } catch (failure) {
          error = (failure as Error).message
        }
        broadcast(panel(error))
        break
      }
    }
  }

  /** The body's main screen in device pixels, for photo sizes in the prompts. */
  const mainScreen = (): { width: number; height: number } | undefined => {
    const first = server?.bodies.at(-1)?.hello.caps.screens[0] ?? webScreen
    return first === undefined ? undefined : { width: Math.round(first.w * first.scale), height: Math.round(first.h * first.scale) }
  }

  /** Who she is and what she remembers, for the body's settings window. */
  const panel = (error?: string): BrainMessage => {
    const { facts, episodes, diary } = memory.list()
    const { name, persona, callYou, pronoun } = character
    return { t: 'panel', cid, character: { name, persona, callYou, pronoun }, memory: { facts, episodes, diary }, ...(error === undefined ? {} : { error }) }
  }

  /** The screen of the browser she lives in, as the page reports it (the desktop body knows its own). */
  let webScreen: { w: number; h: number; scale: number } | undefined

  /**
   * With no desktop body the brain imports by itself (it has the files and
   * ffmpeg). Progress and the report show the same way as from a body.
   */
  /** Her small picture: from the 形象工坊 project she was made in, or kept with a ready-made look. */
  const lookAvatar = (lookId: string) => avatarOf(lookId) ?? (/^[\w-]+$/.test(lookId) ? avatarIn(join(paths.root, 'looks', lookId)) : undefined)
  /** Her small picture for the look she wears, with an address that changes when the picture does. */
  const webAvatar = (): AvatarView | undefined => {
    const active = webBody.activeId()
    const avatar = active?.startsWith('look:') === true ? lookAvatar(active.slice('look:'.length)) : undefined
    if (avatar === undefined) return undefined
    const version = (path: string) => Math.floor(statSync(path).mtimeMs).toString(36)
    return {
      url: `/api/dsh-her/web/avatar?v=${version(avatar.path)}`,
      overhang: avatar.overhang,
      ...(avatar.clip === undefined ? {} : { clipUrl: `/api/dsh-her/web/avatar?clip=1&v=${version(avatar.clip)}` }),
    }
  }
  /** A full path only: a bare name means it is on the PATH the body has too. */
  const ffmpegForBody = () => (ffmpegCommand() === 'ffmpeg' ? {} : { ffmpeg: ffmpegCommand() })
  const importHere = async (work: (onProgress: (done: number, total: number, step: string) => void) => Promise<{ ok: boolean; lines: ReportLine[]; show?: string }>, cleanup?: () => void): Promise<void> => {
    if (importStatus.state === 'running') throw new Error('已经有一个在导入了，等它做完')
    importStatus = { ...IDLE_IMPORT, state: 'running', step: '准备中…' }
    const onProgress = (done: number, total: number, step: string) => {
      importStatus = { ...importStatus, state: 'running', done, total, step }
    }
    void ensureFfmpeg(paths.root, (done, total) => onProgress(done, total, `第一次导入：下载 ffmpeg（约 ${Math.round(total / 1e6)} MB）`)).then(() => work(onProgress)).then(result => {
      importStatus = { ...importStatus, state: result.ok ? 'done' : 'failed', lines: result.lines }
      if (result.show !== undefined) {
        webBody.use(result.show)
        refreshBodyPack()
      }
    }, (error: Error) => {
      importStatus = { ...importStatus, state: 'failed', lines: [{ level: 'error', text: error.message }] }
    }).finally(() => {
      cleanup?.()
    })
  }
  const uploadsDir = join(paths.root, 'uploads')
  const browserScreen = () => (webScreen === undefined ? {} : { screen: { width: webScreen.w, height: webScreen.h, scale: webScreen.scale } })

  /** Whether the page should show her: asked for, or (the default) while no desktop body is here. */
  const webShown = (remote = false): boolean => webShows(webBody.mode, desktopConnected() || bodyRunning(paths.root), remote)
  /** A message from the page, as main fills in the character id for the desktop page. */
  const withCid = (message: BodyMessage): BodyMessage => ('cid' in message && typeof message.cid === 'string' && message.cid !== '' ? message : { ...message, cid } as BodyMessage)

  /** The "她" page's view of everything, and what it can change. */
  const api: ApiRuntime = {
    state: () => {
      const body = server?.bodies.at(-1)
      const target = route()
      const { facts, episodes, diary } = memory.list()
      return {
        platform: process.platform,
        version: PLUGIN_VERSION,
        character,
        model: target === undefined ? null : { provider: target.provider, model: target.model, ...(target.reasoningEffort === undefined ? {} : { effort: target.reasoningEffort }), chosen: character.model !== undefined },
        voice: {
          status: voice?.status ?? 'off', speaking: voice?.speaking ?? { status: 'off', service: serviceOf(character.voice.id) }, id: character.voice.id, speed: character.voice.speed,
          ming: { ...(ming?.status ?? { state: 'stopped' }), installed: ming?.installed ?? false, settings: ownVoices.settings(), own: ownVoices.list() },
        },
        body: {
          connected: body !== undefined,
          running: body !== undefined || bodyRunning(paths.root),
          canStart: !('missing' in bodyPlan()),
          desktopExists: desktopBodyExists() || installState.dev,
          install: { ...installState, ...(installedBody(paths.root) === undefined ? {} : { installed: installedBody(paths.root)!.version }) },
          ...(body === undefined ? {} : { info: { kind: body.hello.body.kind, version: body.hello.body.version, os: body.hello.body.os } }),
          ...(bodyPack === undefined ? {} : { pack: bodyPack }),
          // With no desktop body the brain itself knows her packs (docs/网页身体设计.md).
          packs: body === undefined ? webBody.packList() : bodyPacks,
          ...((body === undefined ? webBody.activeId() : activePack) === undefined ? {} : { activePack: body === undefined ? webBody.activeId()! : activePack! }),
          web: { mode: webBody.mode, connected: webBody.connected, show: webShown(), ...webBody.place(), ...(webAvatar() === undefined ? {} : { avatar: webAvatar()! }) },
          ...(bodyMode === undefined ? {} : { mode: bodyMode }),
          ...(bodyLook === undefined ? {} : { look: bodyLook }),
          ...(body === undefined ? {} : { screens: body.hello.caps.screens.map(({ w, h, scale }) => ({ w, h, scale })) }),
        },
        import: importStatus,
        ...(lastHeard === undefined ? {} : { heard: lastHeard }),
        ...(problem === undefined ? {} : { problem }),
        initiative: initiative.view(),
        presets: { list: presetList, ...(presetState === undefined ? {} : { active: presetState }) },
        memory: { facts, episodes, diary, lastDigestDay: memory.lastDigestDay() ?? null },
      }
    },
    saveCharacter: patch => {
      const next: Character = { ...character, ...patch, voice: { ...character.voice, ...patch.voice } }
      if ('model' in patch && patch.model === undefined) delete next.model
      const problem = invalidCharacter(next)
      if (problem !== undefined) throw new Error(problem)
      const modelChanged = JSON.stringify(next.model) !== JSON.stringify(character.model)
      saveCharacter(dir, next)
      character = next
      if (modelChanged) {
        // The model is fixed when her session is opened: reopen it on the new one (her history stays).
        cut()
        void session?.dispose().then(open)
        log({ event: 'model', ...(route() ?? {}) })
      }
      voice?.setVoice(next.voice.id, next.voice.speed)
      log({ event: 'character', name: next.name, voice: next.voice.id, onboarded: next.onboarded })
      return next
    },
    expandPersona: async ({ name, idea, callYou, pronoun }) => complete(
      [
        '你在帮用户写一个桌面陪伴角色的人设。她住在用户电脑桌面上，陪用户聊天，会记得用户说过的事。',
        '根据用户的一句话描述，写成完整人设：150 到 300 字，用第二人称"你是……"开头。',
        '写清楚：年龄感和性格、说话方式（口头禅、语气）、自己的喜好和小习惯、和对方的关系。',
        `对方的称呼是"${callYou || '对方'}"，提到对方时用"${pronoun}"。`,
        '不要写她能做什么、不能做什么（这部分另有规定）；不要成人内容；只输出人设正文。',
      ].join('\n'),
      `名字：${name}\n用户的描述：${idea}`, 800,
    ),
    tryPersona: async ({ name, persona, callYou, pronoun, history, message }) => complete(
      buildSystemPrompt({ name, persona, you: { call: callYou, pronoun }, now: new Date() }),
      [...history.map(h => `${h.who === 'you' ? '对方' : '你'}：${h.text}`), `对方：${message}`, '（只回复你接下来说的话，不要带"你："前缀。）'].join('\n'),
      300,
    ),
    personaFromCard: async raw => {
      const text = cardText(raw)
      if (text === '') throw new Error('先把人设卡的内容贴进来')
      // A model now and then answers around the JSON: once more before asking you to do anything.
      let parsed: ReturnType<typeof parsePersonaCard>
      for (let tries = 0; tries < 2 && parsed === undefined; tries++) {
        const answer = await complete(personaCardPrompt(), `人设卡：\n${text}`, 1600)
        parsed = parsePersonaCard(answer)
        if (parsed === undefined) log({ event: 'persona-card', unparsable: answer.slice(0, 400) })
      }
      if (parsed === 'refused') throw new Error('这张卡不能用：它把未成年人写成了恋爱或性的对象')
      if (parsed === undefined) throw new Error('模型没能读懂这张卡，再试一次，或者把主要内容直接贴进人设里')
      return parsed
    },
    initiativeSet: change => initiative.setSettings(change),
    initiativeFocus: choice => initiative.setFocus(choice),
    initiativeTry: () => initiative.tryNow(),
    presetsRefresh: async () => {
      const base = config.body.releases
      presetList = await fetchPresets(base)
      await Promise.all(presetList.map(preset => cachePreview(paths.root, base, preset)))
      return presetList
    },
    presetUse: id => {
      const preset = presetList.find(p => p.id === id)
      if (preset === undefined) throw new Error('没有这个预设')
      if (presetState?.state === 'downloading') throw new Error('已经有一个在下载了，等它做完')
      presetState = { id, state: 'downloading', done: 0, total: preset.size }
      presetDownload = new AbortController()
      void installPreset(paths.root, config.body.releases, preset, (done, total) => {
        presetState = { id, state: 'downloading', done, total }
      }, presetDownload.signal).then(() => {
        presetState = undefined
        log({ event: 'preset', id })
        const packId = preset.kind === 'look' ? `look:${id}` : id
        if (desktopConnected()) broadcast({ t: 'pack.use', packId })
        else {
          webBody.use(packId)
          refreshBodyPack()
        }
      }, (error: Error) => {
        presetState = presetDownload?.signal.aborted === true ? undefined : { id, state: 'failed', done: 0, total: preset.size, error: error.message }
      }).finally(() => { presetDownload = undefined })
    },
    presetCancel: () => presetDownload?.abort(),
    previewVoice: async (id, speed, text) => {
      if (voice === undefined) throw new Error('她的声音还没准备好')
      const audio = await voice.preview(text, id, speed)
      return { audio: Buffer.from(audio.audio).toString('base64'), format: audio.format, durationMs: audio.durationMs }
    },
    startBody: () => {
      if (server?.bodies.length) return '身体已经连上了'
      if (bodyRunning(paths.root)) return '身体已经在运行，正在连接'
      const plan = bodyPlan()
      if ('missing' in plan) return `找不到身体程序：${plan.missing}`
      if (discovery === undefined) return '大脑还没准备好'
      launchBody(plan, { url: discovery.url, token: discovery.token, home: paths.root, pack: config.body.pack })
      return '已经启动，几秒钟后会连上'
    },
    installBody: () => {
      if (installState.state === 'downloading' || installState.state === 'installing' || installState.state === 'checking') return
      void installLatest(true)
    },
    restartBody: async () => {
      if (discovery === undefined) throw new Error('大脑还没准备好')
      await stopBody()
      const plan = bodyPlan()
      if ('missing' in plan) throw new Error(`找不到身体程序：${plan.missing}`)
      launchBody(plan, { url: discovery.url, token: discovery.token, home: paths.root, pack: config.body.pack })
      installState = { ...installState, restart: false }
    },
    setMode: mode => broadcast({ t: 'mode', cid, mode }),
    pickPack: () => {
      const body = server?.bodies.at(-1)
      if (body === undefined) throw new Error('身体还没连上，导入素材要在身体所在的电脑上选文件夹')
      importStatus = { ...IDLE_IMPORT, state: 'picking' }
      void findFfmpeg(paths.root).then(() => body.send({ t: 'pack.pick', id: `i${Date.now()}`, ...ffmpegForBody() }))
    },
    usePack: packId => {
      if (!desktopConnected()) {
        if (!webBody.packList().some(p => p.packId === packId)) throw new Error('没有这个外形包')
        webBody.use(packId)
        refreshBodyPack()
        return
      }
      if (!bodyPacks.some(p => p.packId === packId)) throw new Error('没有这个外形包')
      broadcast({ t: 'pack.use', packId })
    },
    webNewBatch: () => {
      const batch = `b${Date.now().toString(36)}`
      mkdirSync(join(uploadsDir, batch), { recursive: true })
      return batch
    },
    webStatus: (screen, remote) => {
      if (screen !== undefined) webScreen = screen
      const { place, scope } = webBody.place()
      const avatar = webAvatar()
      return { show: webShown(remote), mode: webBody.mode, place, scope, focus: initiative.focused, ...(avatar === undefined ? {} : { avatar }) }
    },
    importBatch: async (batch, name) => {
      const dir = uploadTarget(uploadsDir, batch)
      if (dir === undefined || !existsSync(dir)) throw new Error('找不到上传的文件')
      await importHere(async onProgress => {
        // A folder of the same name sent again replaces its pack instead of adding another.
        const id = name === undefined ? {} : { id: `up-${createHash('sha1').update(name).digest('hex').slice(0, 8)}` }
        const result = await importPack(dir, paths.packs, { ...id, ...(name === undefined ? {} : { name }), ...browserScreen(), onProgress })
        return { ok: result.pack !== undefined, lines: result.report, ...(result.pack === undefined ? {} : { show: result.pack.id }) }
      }, () => rmSync(dir, { recursive: true, force: true }))
    },
    workshopFrameInfo: async (id, sceneId) => {
      const found = findProject(id)
      const scene = found?.project.scenes.find(s => s.id === sceneId)
      if (found === undefined || scene === undefined) throw new Error('找不到这个场景')
      const dir = join(found.dir, sceneDir(scene))
      const plate = plateIn(dir)
      if (plate === undefined) throw new Error('这个场景还没有照片：先按提示词生成，存成 plate.png 传上来')
      await ensureFfmpeg(paths.root, () => {})
      const size = await stillSize(join(dir, plate))
      let region: { x: number; y: number; width: number; height: number } | undefined
      try {
        region = (JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')) as { region?: typeof region }).region
      } catch {
        // not framed yet
      }
      return { ...size, file: `${sceneDir(scene)}/${plate}`, ...(region === undefined ? {} : { region }) }
    },
    workshopFrameSave: async (id, sceneId, region) => {
      const found = findProject(id)
      const scene = found?.project.scenes.find(s => s.id === sceneId)
      if (found === undefined || scene === undefined) throw new Error('找不到这个场景')
      await ensureFfmpeg(paths.root, () => {})
      await saveFrame(join(found.dir, sceneDir(scene)), region)
      return projectStatus(found.project, found.dir)
    },
    // Beside a desktop body she keeps quiet, unless that desktop is on another computer than this page.
    webConfig: remote => webBody.config(desktopConnected() && !remote),
    webSend: message => onBodyMessage(withCid(message), undefined, 'web'),
    webSetMode: (mode: WebMode) => {
      webBody.mode = mode
    },
    webSetPlace: change => {
      webBody.setPlace(change)
      refreshBodyPack()
    },
    workshopList: () => listProjects(),
    workshopNew: name => {
      if (name === '') throw new Error('先给形象起个名字')
      return saveProject(newProject(`p${Date.now().toString(36)}`, name), mainScreen())
    },
    workshopSave: project => saveProject(project, mainScreen()),
    workshopAvatar: async id => {
      const found = findProject(id)
      if (found === undefined) throw new Error('找不到这个项目')
      await ensureFfmpeg(paths.root, () => {})
      await makeAvatar(found.dir)
      return projectStatus(found.project, found.dir)
    },
    workshopAvatarClip: async id => {
      const found = findProject(id)
      if (found === undefined) throw new Error('找不到这个项目')
      await ensureFfmpeg(paths.root, () => {})
      await makeAvatarClip(found.dir)
      return projectStatus(found.project, found.dir)
    },
    workshopAssignClip: (id, folder, file, clip) => assignClip(id, folder, file, clip, mainScreen()),
    workshopRemoveStray: (id, folder, file) => removeStray(id, folder, file),
    workshopExport: async (id, media) => {
      const dest = await pickFolder('导出到哪个文件夹', '导出到这里')
      return dest === undefined ? undefined : exportProject(id, dest, media)
    },
    workshopImportProject: async () => {
      const path = await pickFolder('选一个形象项目（文件夹，或里面的 形象.json）', '导入', '形象.json')
      return path === undefined ? undefined : importProject(path, mainScreen())
    },
    workshopExamples: () => examples(paths.root),
    workshopOpen: id => {
      const found = findProject(id)
      if (found === undefined) throw new Error('找不到这个项目')
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
      spawn(opener, [found.dir], { detached: true, stdio: 'ignore' }).unref()
    },
    workshopFrame: (id, sceneId) => {
      const found = findProject(id)
      const scene = found?.project.scenes.find(s => s.id === sceneId)
      if (found === undefined || scene === undefined) throw new Error('找不到这个场景')
      const body = server?.bodies.at(-1)
      if (body === undefined) throw new Error('身体还没连上：框人物区要在身体那边的窗口里做')
      body.send({ t: 'scene.frame', dir: join(found.dir, sceneDir(scene)), name: scene.name })
    },
    workshopImport: id => {
      const found = findProject(id)
      if (found === undefined) throw new Error('找不到这个项目')
      const body = server?.bodies.at(-1)
      const status = projectStatus(found.project, found.dir)
      if (!status.importable) throw new Error('还没有可以导入的部分：至少要有参考图和桌宠的一段待机，或者一个框好人物区的场景和它的一段待机')
      prepareImport(found.project, found.dir)
      const ready = (folder: string) => status.parts.find(p => p.folder === folder)?.enough === true
      const { project } = found
      const request: LookRequest = {
        id: project.id, name: project.name, dir: found.dir,
        ...(project.desk.on && ready(DESK_DIR) ? { desk: DESK_DIR } : {}),
        ...(project.default === undefined ? {} : { default: project.default }),
        scenes: project.scenes.filter(s => ready(sceneDir(s)) && status.parts.find(p => p.folder === sceneDir(s))?.framed === true).map(s => ({
          id: s.id, name: s.name, folder: sceneDir(s),
          ...(s.hours !== undefined || s.user !== undefined ? { when: { ...(s.hours === undefined ? {} : { hours: s.hours }), ...(s.user === undefined ? {} : { user: s.user }) } } : {}),
        })),
      }
      if (body === undefined) {
        return importHere(async onProgress => {
          const result = await importLook(request, { home: paths.root, packsDir: paths.packs, ...browserScreen(), onProgress })
          return { ok: result.look !== undefined, lines: result.lines, ...(result.look === undefined ? {} : { show: `look:${result.look.id}` }) }
        })
      }
      importStatus = { ...IDLE_IMPORT, state: 'running' }
      void findFfmpeg(paths.root).then(() => body.send({ t: 'look.import', ...request, ...ffmpegForBody() }))
    },
    setLook: change => {
      if (bodyLook === undefined) throw new Error('现在用的不是多场景的形象')
      if (change.go !== undefined && !bodyLook.scenes.some(s => s.id === change.go)) throw new Error('没有这个场景')
      broadcast({ t: 'look.set', ...change })
    },
    bodyManual: async (): Promise<ManualInstall> => {
      manualRelease ??= await latestRelease(config.body.releases)
      return manualInstall(paths.root, manualRelease.base, manualRelease.manifest)
    },
    bodyInstallDownloaded: async () => {
      manualRelease ??= await latestRelease(config.body.releases)
      const updated = installedBody(paths.root) !== undefined
      downloading?.abort()
      installState = { ...installState, state: 'installing', done: 0, total: 0 }
      try {
        const installed = await installDownloaded(paths.root, manualRelease.manifest)
        afterInstall(installed.version, updated)
      } catch (error) {
        installState = { ...installState, state: 'idle' }
        throw error
      }
    },
    bodyCancelDownload: () => {
      downloading?.abort()
    },
    bodyOpenFolder: () => {
      const folder = downloadFolder(paths.root)
      mkdirSync(folder, { recursive: true })
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
      spawn(opener, [folder], { detached: true, stdio: 'ignore' }).unref()
    },
    pluginLatest: async () => {
      const latest = await npmLatest()
      return { latest, updateAvailable: compareVersions(latest, PLUGIN_VERSION) > 0 }
    },
    mingInstall: () => {
      if (ming === undefined) throw new Error('声音还没准备好')
      void ming.install().catch(error => ctx.logger.warn(`dsh-her: ${(error as Error).message}`))
    },
    mingUninstall: () => {
      if (usesMing()) api.saveCharacter({ voice: { id: DEFAULT_VOICE, speed: character.voice.speed } })
      ming?.uninstall()
    },
    mingRestart: async () => {
      await ming?.restart()
    },
    mingSettings: patch => {
      const next = ownVoices.saveSettings(patch)
      ming?.setIdleMinutes(next.idleMinutes ?? defaultIdleMinutes())
    },
    mingDesign: async description => {
      if (ming === undefined) throw new Error('声音还没准备好')
      const text = `你好呀，我是${character.name}。今天过得怎么样？有什么想跟我说的吗？`
      const drafts = []
      // Three takes of one description: each comes out a little different; you keep the one you like.
      for (const seed of [11, 22, 33]) {
        const audio = await ming.synthesize({ text, design: description, steps: MING_STEPS.quality, seed })
        const id = ownVoices.addDraft(audio.audio, { kind: 'design', text, description })
        drafts.push({ id, audio: Buffer.from(audio.audio).toString('base64'), durationMs: audio.durationMs })
      }
      return drafts
    },
    mingClone: async (audio, name) => {
      const recording = await prepareRecording(Buffer.from(audio, 'base64'), name)
      // What it says, to start from (Ming needs the words); you correct it on the page.
      const heard = await voice?.recognize(recording.pcm16k, 16_000).catch(() => undefined)
      const id = ownVoices.addDraft(recording.wav, { kind: 'clone', text: heard?.text ?? '' })
      return { id, audio: Buffer.from(recording.wav).toString('base64'), durationMs: Math.round(recording.seconds * 1000), text: heard?.text ?? '' }
    },
    mingKeep: (draft, name, change) => ownVoices.keep(draft, name, change),
    mingRemove: id => {
      if (character.voice.id === `${OWN_PREFIX}${id}`) api.saveCharacter({ voice: { id: 'ming:灵风信', speed: character.voice.speed } })
      ownVoices.remove(id)
    },
    memoryRemove: ids => memory.remove(ids),
    memoryConfirm: ids => memory.confirm(ids),
    digest: () => digest(dayOf(new Date())),
    exportMemory: () => memory.exportMarkdown(),
  }

  ctx.effect(() => {
    mkdirSync(dir, { recursive: true })
    mkdirSync(paths.logs, { recursive: true })
    session = new HerSession({
      cid,
      character: () => character,
      performance: () => [performanceSection(bodyPack), usesMing() ? SOUND_SECTION : ''].filter(Boolean).join('\n'),
      playAction,
      aboutYou,
      memory,
      dir,
      get route() { return route() },
      services: () => services,
      logger: ctx.logger,
      events: {
        start(attemptId) {
          clearTimeout(stuckTimer)
          awaitingReply = false
          // A reply means someone is talking to her, wherever from (dsh's own page, `/her`).
          initiative.heardYou()
          current = { attemptId, startedAt: Date.now(), sentences: [] }
          log({ event: 'start', attemptId, sinceSendMs: sentAt === undefined ? null : current.startedAt - sentAt })
          broadcast({ t: 'speak.begin', cid, uid: attemptId })
        },
        sentence(attemptId, text) {
          const now = Date.now()
          let seq = 0
          if (current?.attemptId === attemptId) {
            current.firstSentenceAt ??= now
            current.sentences.push(text)
            seq = current.sentences.length - 1
          }
          onFirstSentence?.()
          onFirstSentence = undefined
          problem = undefined
          log({ event: 'sentence', attemptId, text, sinceSendMs: sentAt === undefined ? null : now - sentAt })
          saySentence(attemptId, seq, text)
        },
        end(attemptId, outcome) {
          log({ event: 'end', attemptId, outcome, sinceSendMs: sentAt === undefined ? null : Date.now() - sentAt })
          if (current?.attemptId === attemptId) {
            current.outcome = outcome
            if (current.sentences.length === 0) {
              // No words at all: say why, on her and on the page (a model without a key used to fail silently).
              const model = route()
              void logQuietTurn().then(error => {
                if (error === undefined && outcome === 'committed') return
                const text = error === undefined ? '我刚才没说出话来，模型可能出错了' : explainModelError(error, model === undefined ? '没有模型' : `${model.provider} / ${model.model}`)
                problem = { text, at: Date.now() }
                broadcast({ t: 'bubble', cid, text: `（${text}）`, ttlMs: 12_000 })
              })
            }
            finished.push(current)
            if (finished.length > 20) finished.shift()
          }
          speech?.end(attemptId)
          current = undefined
        },
      },
    } as ConstructorParameters<typeof HerSession>[0])
    if (services !== undefined) open()

    ming = new MingVoice(join(paths.root, 'ming'), join(paths.root, 'uv'), ctx.logger, ownVoices.settings().idleMinutes ?? defaultIdleMinutes())
    voice = new Voice(paths.models, join(paths.root, 'edge-tts'), { ...config.voice, voice: character.voice.id, speed: character.voice.speed }, ctx.logger, { voice: ming, own: ownVoices })
    const herVoice = voice
    void herVoice.start()
    speech = new SpeechQueue((text, cues) => herVoice.synthesize(speakable(text), cues), {
      sentence(uid, seq, text, audio, cues) {
        const withCues = cues.length === 0 ? {} : { cues }
        speakingUntil = Math.max(speakingUntil, Date.now()) + (audio?.durationMs ?? readingMs(text))
        if (audio === undefined) {
          broadcast({ t: 'speak.seg', cid, uid, seq, text, durationMs: text === '' ? 300 : readingMs(text), ...withCues })
          return
        }
        const stream = nextStream++
        if (seq === 0) log({ event: 'first-audio', uid, sinceSendMs: sentAt === undefined ? null : Date.now() - sentAt, durationMs: audio.durationMs })
        const seg: BrainMessage = { t: 'speak.seg', cid, uid, seq, text, durationMs: audio.durationMs, format: audio.format, stream, ...withCues }
        server?.broadcastWithAudio(seg, stream, audio.audio)
        webBody.sendWithAudio(seg, audio.audio)
      },
      end(uid) {
        broadcast({ t: 'speak.end', cid, uid })
      },
    })

    const brain = new BrainServer({
      tokenFile: join(paths.root, 'token'),
      discoveryFile: paths.discovery,
      preferredPort: config.port,
      logger: ctx.logger,
      welcome: client => {
        bodyPack = client.hello.packs[0] ?? bodyPack
        return {
          t: 'welcome',
          v: PROTOCOL_VERSION,
          sessionId: session?.sessionId ?? '',
          characters: [{ cid, name: character.name, mode: 'overlay' }],
          config: { mic: config.voice.mic, bargeIn: true, focus: initiative.focused },
        }
      },
      message: (_client, message, audio) => onBodyMessage(message, audio),
      closed: client => {
        refreshBodyPack()
        // Only what that body was doing is lost; another body (or a text-only client) leaving changes nothing.
        for (const [id, pending] of pendingActs) {
          if (pending.body !== client.id) continue
          pendingActs.delete(id)
          pending.settle({ ok: false, reason: 'no body' })
        }
      },
    })
    let launchTimer: NodeJS.Timeout | undefined
    brain.start().then(started => {
      server = brain
      discovery = started
      if (config.body.launch !== 'auto') return
      launchTimer = setTimeout(() => {
        if (brain.bodies.length > 0 || bodyRunning(paths.root)) return
        const plan = bodyPlan()
        if ('missing' in plan) {
          ctx.logger.info(desktopBodyExists() ? `dsh-her: no body to start yet (${plan.missing}); the "她" page offers to install it` : 'dsh-her: no desktop body on this computer; she lives in the web page')
          return
        }
        const pid = launchBody(plan, { url: started.url, token: started.token, home: paths.root, pack: config.body.pack })
        ctx.logger.info(`dsh-her: started the body (pid ${pid})`)
      }, LAUNCH_AFTER_MS)
      launchTimer.unref()
    }, (error: Error) => ctx.logger.warn(`dsh-her: body server failed to start (${error.message})`))

    // The installed body keeps itself up to date: a check soon after start, then every few hours.
    const updateFirst = setTimeout(() => void installLatest(false), UPDATE_FIRST_MS)
    const updateTimer = setInterval(() => void installLatest(false), UPDATE_CHECK_MS)
    updateFirst.unref()
    updateTimer.unref()
    const digestTimer = setInterval(digestTick, DIGEST_CHECK_MS)
    const noteTimer = setInterval(noteTick, NOTE_CHECK_MS)
    const initiativeTimer = setInterval(() => {
      initiative.tick()
      ensureTouchLines()
    }, INITIATIVE_CHECK_MS)
    initiativeTimer.unref()
    noteTimer.unref()
    digestTimer.unref()

    return async () => {
      clearTimeout(launchTimer)
      clearTimeout(updateFirst)
      clearInterval(updateTimer)
      clearInterval(digestTimer)
      clearInterval(noteTimer)
      clearInterval(initiativeTimer)
      clearTimeout(stuckTimer)
      herVoice.stop()
      voice = undefined
      ming = undefined
      speech = undefined
      const closing = session
      session = undefined
      server = undefined
      closing?.interrupt()
      await Promise.all([closing?.dispose(), brain.stop()])
    }
  })

  // The "她" page's API, on DSH's own authenticated `/api` channel.
  ctx.inject(['connection'], (webCtx) => {
    const connection = (webCtx as unknown as { connection: { fetch: { register(route: { path: string; methods: string[]; requestBody: 'buffered'; fetch: (request: Request) => Promise<Response> }): () => void } } }).connection
    for (const [path, handler] of Object.entries(apiHandlers(api))) {
      webCtx.effect(() => connection.fetch.register({ path: `${API_BASE}${path}`, methods: ['POST'], requestBody: 'buffered', fetch: request => handle(handler, request) }))
    }
    // 形象工坊's example pictures and clips, as files (`?f=reference.png`); only the named slots.
    webCtx.effect(() => connection.fetch.register({
      path: `${API_BASE}/example`, methods: ['GET'], requestBody: 'buffered',
      fetch: async request => {
        const file = exampleFile(paths.root, new URL(request.url).searchParams.get('f') ?? '')
        if (file === undefined) return new Response('not found', { status: 404 })
        const type = file.endsWith('.mp4') ? 'video/mp4' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream'
        return new Response(readFileSync(file), { headers: { 'content-type': type, 'cache-control': 'no-cache' } })
      },
    }))
  })

  ctx.inject(['connection'], (webCtx) => {
    const connection = (webCtx as unknown as { connection: { fetch: { register(route: { path: string; methods: string[]; requestBody: 'buffered' | 'streaming'; fetch: (request: Request) => Response | Promise<Response> }): () => void } } }).connection
    const get = (path: string, fetch: (request: Request) => Response | Promise<Response>) =>
      webCtx.effect(() => connection.fetch.register({ path: `${WEB_BASE}/${path}`, methods: ['GET', 'HEAD'], requestBody: 'buffered', fetch }))
    get('page', () => webBody.asset('index.html'))
    get('renderer.js', () => webBody.asset('renderer.js'))
    get('mic-worklet.js', () => webBody.asset('mic-worklet.js'))
    get('file', request => webBody.file(request))
    get('avatar', request => {
      const active = webBody.activeId()
      const avatar = active?.startsWith('look:') === true ? lookAvatar(active.slice('look:'.length)) : undefined
      const path = new URL(request.url).searchParams.has('clip') ? avatar?.clip : avatar?.path
      return path === undefined ? new Response('not found', { status: 404 }) : fileResponse(path, request, true)
    })
    get('preset-preview', request => {
      const path = previewPath(paths.root, new URL(request.url).searchParams.get('id') ?? '')
      return path === undefined ? new Response('not found', { status: 404 }) : new Response(readFileSync(path), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-cache' } })
    })
    get('events', request => webBody.connect(request.signal, () => {
      webBody.send({ t: 'welcome', v: PROTOCOL_VERSION, sessionId: session?.sessionId ?? '', characters: [{ cid, name: character.name, mode: 'overlay' }], config: { mic: config.voice.mic, bargeIn: true, focus: initiative.focused } })
      refreshBodyPack()
      log({ event: 'web-body', state: 'connected' })
    }, () => {
      refreshBodyPack()
      log({ event: 'web-body', state: 'closed' })
      for (const [id, pending] of pendingActs) {
        if (pending.body !== WEB_BODY_ID) continue
        pendingActs.delete(id)
        pending.settle({ ok: false, reason: 'no body' })
      }
    }))
    // A file of a 形象工坊 project (its photo, crop.png …), to frame or to download.
    get('project-file', request => {
      const query = new URL(request.url).searchParams
      const found = findProject(query.get('id') ?? '')
      const path = found === undefined ? undefined : packFile(dirname(found.dir), basename(found.dir), query.get('f') ?? '')
      return path === undefined ? new Response('not found', { status: 404 }) : fileResponse(path, request)
    })
    // Files from the browser, streamed to disk: a materials folder (`batch`) or into a project (`project`).
    webCtx.effect(() => connection.fetch.register({
      path: `${WEB_BASE}/upload`, methods: ['POST'], requestBody: 'streaming',
      fetch: async request => {
        const answer = (status: number, value: Record<string, unknown>) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
        // Refused: read the body first, or the browser sees a dropped connection instead of the reason.
        const refuse = async (message: string) => {
          for await (const _chunk of request.body as unknown as AsyncIterable<Uint8Array>) { /* discard */ }
          return answer(400, { ok: false, message })
        }
        const query = new URL(request.url).searchParams
        const file = query.get('path') ?? ''
        const project = query.get('project')
        const root = project === null ? uploadTarget(uploadsDir, query.get('batch') ?? '') : findProject(project)?.dir
        const target = root === undefined ? undefined : uploadTarget(root, file)
        if (target === undefined) return refuse(`不能放到这里：${file}`)
        if (!uploadAllowed(file)) return refuse(`不支持这种文件：${file}`)
        try {
          return answer(200, { ok: true, size: await saveUpload(request, target) })
        } catch (error) {
          return answer(500, { ok: false, message: (error as Error).message })
        }
      },
    }))
    // What you said in the page: 16-bit mono PCM at 16 kHz, as a desktop body sends it.
    webCtx.effect(() => connection.fetch.register({
      path: `${WEB_BASE}/utterance`, methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        const query = new URL(request.url).searchParams
        const pcm = new Uint8Array(await request.arrayBuffer())
        onBodyMessage({ t: 'user.utterance', cid, uttId: query.get('uttId') ?? `w${Date.now()}`, format: 'pcm16@16k', durationMs: Number(query.get('durationMs')) || 0, stream: 0 }, pcm)
        return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
      },
    }))
    webCtx.effect(() => () => webBody.close())
  })

  ctx.inject([...SERVICES], (serviceCtx) => {
    serviceCtx.effect(() => {
      services = serviceCtx as unknown as DshServices
      open()
      return () => { services = undefined }
    })
  })

  /**
   * M0 spike: send a prompt, interrupt right after her first sentence, then
   * read her session back and report what DSH recorded for the cut reply.
   */
  const checkInterrupt = async (her: HerSession, prompt: string): Promise<{ kind: 'success' | 'error'; text: string }> => {
    const query = services?.sessionQuery
    const id = her.sessionId
    const before = query === undefined || id === undefined ? -1 : Math.max(-1, ...(await query.readSession(id)).events.map(e => e.seq))
    const first = new Promise<void>(resolve => { onFirstSentence = resolve })
    sentAt = Date.now()
    const agent = await her.say(prompt, 'command')
    const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 60_000).unref())
    if (await Promise.race([first, timeout]) === 'timeout') return { kind: 'error', text: '60 秒内没有等到第一句' }
    const cutAt = Date.now()
    her.interrupt()
    await agent.whenIdle()
    const idleMs = Date.now() - cutAt
    const events = query === undefined || her.sessionId === undefined ? [] : (await query.readSession(her.sessionId)).events.filter(e => e.seq > before)
    const message = events.filter(e => e.type === 'assistant/message').at(-1)?.data as { interrupted?: boolean; usage?: unknown; message?: { content?: Array<{ type: string; text?: string }> } } | undefined
    const kept = message?.message?.content?.filter(b => b.type === 'text').map(b => b.text ?? '').join('') ?? ''
    const end = events.filter(e => e.type === 'turn/end').at(-1)?.data as { reason?: { kind?: string } } | undefined
    log({ event: 'interrupt-check', idleMs, turnEnd: end?.reason?.kind ?? null, interrupted: message?.interrupted ?? null, kept, usage: message?.usage ?? null, eventTypes: events.map(e => e.type) })
    return {
      kind: 'success',
      text: [
        `第一句后 ${idleMs} ms 停稳`,
        `turn/end：${end?.reason?.kind ?? '（无）'}`,
        `assistant/message.interrupted：${message?.interrupted === true ? 'true' : String(message?.interrupted)}`,
        `DSH 记下的前半段（${[...kept].length} 字）：${kept.slice(0, 120)}${[...kept].length > 120 ? '…' : ''}`,
      ].join('\n'),
    }
  }

  /** M0 spike: what her last model request carried (tools, system prompt) and what it cost. */
  const diagnose = async (her: HerSession): Promise<{ kind: 'success' | 'error'; text: string }> => {
    const query = services?.sessionQuery
    const id = her.sessionId
    if (query === undefined || id === undefined) return { kind: 'error', text: '会话还没建好' }
    const events = (await query.readSession(id)).events
    const header = events.filter(e => e.type === 'request/header').at(-1)?.data as Record<string, unknown> | undefined
    const usage = events.filter(e => e.type === 'assistant/message' && (e.data as { usage?: unknown }).usage !== undefined).at(-1)?.data as { usage?: unknown } | undefined
    const system = events.filter(e => e.type === 'system/message').at(-1)?.data as { message?: unknown } | undefined
    const result = {
      headerKeys: header === undefined ? null : Object.keys(header),
      systemChars: system === undefined ? null : JSON.stringify(system.message).length,
      usage: usage?.usage ?? null,
      bodies: server?.bodies.map(b => `${b.hello.body.kind} ${b.hello.body.version} ${b.hello.body.os}`) ?? [],
      voice: voice?.status ?? null,
      server: server?.url ?? null,
    }
    log({ event: 'diagnose', ...result })
    return { kind: 'success', text: JSON.stringify(result, null, 2) }
  }

  /**
   * `/her 记忆`: what she remembers, with ids. `/her 确认 f3 f4`, `/her 忘掉 f3 e2`,
   * `/her 整理` (digest today now), `/her 导出记忆` (a Markdown file).
   */
  const memoryCommand = (text: string): Promise<{ kind: 'success' | 'error'; text: string }> | undefined => {
    const [word = '', ...rest] = text.split(/\s+/)
    const ids = rest.map(id => id.replace(/^#/, '')).filter(Boolean)
    if (MEMORY_WORDS.has(word)) {
      const { facts, episodes, diary } = memory.list()
      const lines = [
        `关于你（${facts.length}）：`,
        ...facts.map(f => `  ${f.id} ${f.text}${f.status === 'candidate' ? '（待确认）' : ''}${f.sensitive ? '（敏感）' : ''}`),
        `事件（${episodes.length}）：`,
        ...episodes.map(e => `  ${e.id} ${e.at.slice(0, 10)} ${e.text}${e.due === undefined ? '' : `（${e.due}）`}`),
        `日记：${diary.length === 0 ? '还没有' : diary.join('、')}`,
        `文件在 ${join(dir, 'memory')}`,
        '确认：/her 确认 f3 ｜ 删除：/her 忘掉 f3 e2 ｜ 现在整理今天：/her 整理 ｜ 导出：/her 导出记忆',
      ]
      return Promise.resolve({ kind: 'success', text: lines.join('\n') })
    }
    if (word === '确认') return Promise.resolve({ kind: 'success', text: `确认了 ${memory.confirm(ids)} 条。` })
    if (word === '忘掉' || word === 'forget') {
      if (ids.length === 0) return Promise.resolve({ kind: 'error', text: '用法：/her 忘掉 f3 e2（编号见 /her 记忆）' })
      return Promise.resolve({ kind: 'success', text: `删掉了 ${memory.remove(ids)} 条。` })
    }
    if (word === '整理') return digest(dayOf(new Date())).then(report => ({ kind: 'success' as const, text: report }))
    if (word === '导出记忆') {
      const file = join(dir, 'memory', `她记得的事-${dayOf(new Date())}.md`)
      writeFileSync(file, memory.exportMarkdown())
      return Promise.resolve({ kind: 'success', text: `导出到 ${file}` })
    }
    return undefined
  }

  ctx.inject(['commands'], (commandCtx) => {
    const commands = (commandCtx as unknown as { commands: CommandsLike }).commands
    commandCtx.effect(() => commands.register({
      name: 'her',
      description: 'dsh-her: talk to her (`/her 你好`), stop her (`/her 停`), or show her session',
      input: { hint: '[想对她说的话 | 停]' },
      async handler(invocation) {
        if (session === undefined) return { kind: 'error', text: 'dsh-her：还没有启动' }
        const text = invocation.rawInput.trim()
        if (text === '') {
          const id = session.sessionId
          const bodies = server?.bodies.length ?? 0
          return {
            kind: 'success',
            text: `${session.title}\n会话：${id ?? '还没建好'}\n身体：${bodies} 个已连接（${server?.url ?? '服务未启动'}）\n日志：${join(paths.logs, 'stream.jsonl')}`,
          }
        }
        if (STOP_WORDS.has(text.toLowerCase())) {
          cut()
          return { kind: 'success', text: '已让她停下。' }
        }
        if (text.startsWith(INTERRUPT_CHECK)) return checkInterrupt(session, text.slice(INTERRUPT_CHECK.length).trim() || '给我讲一个很长很长的睡前故事，至少讲十句。')
        if (text === DIAGNOSE) return diagnose(session)
        if (text === OPEN_WORD) {
          return initiative.tryNow().then(said => ({ kind: 'success' as const, text: `她说：${said}` }), (error: Error) => ({ kind: 'error' as const, text: error.message }))
        }
        const memoryReply = memoryCommand(text)
        if (memoryReply !== undefined) return memoryReply
        sentAt = Date.now()
        broadcast({ t: 'state', cid, state: 'think' })
        const before = finished.length
        const agent = await session.say(text, 'command')
        await agent.whenIdle()
        const reply = finished.slice(before).at(-1)
        if (reply === undefined) return { kind: 'error', text: '她没有回复（看 DSH 日志里的模型错误）' }
        const firstMs = reply.firstSentenceAt === undefined ? '—' : `${reply.firstSentenceAt - sentAt} ms`
        return {
          kind: 'success',
          text: `${reply.sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n（开始生成 ${reply.startedAt - sentAt} ms · 第一句 ${firstMs} · ${reply.outcome}）`,
        }
      },
    }))
  })
}
