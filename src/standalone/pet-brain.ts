/**
 * The small brain of the pet that does not chat (docs/实施计划.md, step 3;
 * docs/独立安装包设计.md): everything she does without DSH and without a
 * model. A body connects to it with the same protocol it speaks to DSH.
 *
 * What it does: says who she is and what she wears (her 编排, compiled into
 * the look the body already knows), answers a touch with one of her written
 * lines in a bubble, says hello when she comes out and good night when the
 * quiet hours begin, lets chance scenes come up, plays her opening clip,
 * puts 设计包 in (looked at first), switches between characters, and keeps
 * where the body shows her.
 *
 * What it does not: a model, conversation, voice, listening, memory, skins.
 * There is no network in here at all.
 *
 * The home has the same layout as dsh-her's own (`characters/`, `packs/`,
 * `library/`, `looks/`), so the body finds what to show where it always did.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCharacter, type Character } from '../core/character.ts'
import { cleanIntro, introPixel, type IntroSettings } from '../core/intro.ts'
import { loadLines, type WrittenLines } from '../core/lines.ts'
import { herPaths, type HerPaths } from '../core/paths.ts'
import { FALLBACK_LINES, touchClip, TouchTracker } from '../core/touch.ts'
import { DEFAULT_VOICE } from '../core/voices.ts'
import { Characters, type CharacterCard } from '../engine/characters.ts'
import { DesignPacks, type DesignChoice, type DesignPreview, type InstalledDesign } from '../engine/design-packs.ts'
import { Library } from '../engine/library.ts'
import { Pixels } from '../engine/pixels.ts'
import { Skins } from '../engine/skins.ts'
import { compileStage, readPlay, STAGE_LOOK, STAGE_LOOK_ID, writePlay } from '../engine/stage-play.ts'
import { StageStore } from '../engine/stage-store.ts'
import { useFfmpeg } from '../pack/media.ts'
import { listPacks } from '../pack/settings.ts'
import type { Scene, When } from '../pack/stage.ts'
import { PROTOCOL_VERSION, type BodyMessage, type BrainMessage, type DeskPlaces, type LookView, type PackSummary } from '../protocol/index.ts'
import { BrainServer, type BodyClient, type Discovery } from '../server/brain-server.ts'
import { findClaude } from '../engine/brains/claude-code.ts'
import type { FrontBrain } from '../engine/front-brain.ts'
import { Secrets } from '../voice/secrets.ts'
import { API_KEY_NAME, cleanBrainChoice, PetChat, type BrainChoice } from './pet-chat.ts'

/** The id the list of characters is built around when nobody has come in yet. */
const NOBODY = 'nobody'
const NO_ONE: Character = { name: '', persona: '', callYou: '', pronoun: 'TA', voice: { id: DEFAULT_VOICE, speed: 1 }, onboarded: false }
/** A body that reconnects (sleep, a restart) is not greeted again at once. */
const HELLO_EVERY_MS = 30 * 60_000
const TICK_MS = 60_000
/** A bubble stays long enough to be read. */
const bubbleMs = (text: string): number => Math.max(3000, 1500 + [...text].length * 260)

export interface PetSettings {
  /** Where the body shows her; undefined until the body has said. */
  wallpaper?: boolean
  overlay?: boolean
  tray?: boolean
  holdKey?: boolean
  petScale?: number
  /** She is switched off (no window). */
  off: boolean
  /** Her quiet hours, minutes from midnight; may run past midnight. Good night is said when they begin. */
  quietFrom: number
  quietTo: number
  /** The day she last said good night (YYYY-MM-DD). */
  nightDay?: string
  /** Who she talks with (pet-chat.ts): nobody until the user chooses. */
  brain: BrainChoice
  /** Her voice out loud when she talks (Edge); off: words only. */
  voice: boolean
  /** She takes on work through agent-autoloop (autoloop.ts); off by default while it is being built. */
  loop: boolean
}

export const DEFAULT_PET: PetSettings = { off: false, quietFrom: 23 * 60 + 30, quietTo: 8 * 60 + 30, brain: { kind: 'none' }, voice: true, loop: false }

export function cleanPet(value: unknown): PetSettings {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const minutes = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 24 * 60 ? x : fallback)
  const out: PetSettings = { off: v.off === true, quietFrom: minutes(v.quietFrom, DEFAULT_PET.quietFrom), quietTo: minutes(v.quietTo, DEFAULT_PET.quietTo), brain: cleanBrainChoice(v.brain), voice: v.voice !== false, loop: v.loop === true }
  for (const key of ['wallpaper', 'overlay', 'tray', 'holdKey'] as const) if (typeof v[key] === 'boolean') out[key] = v[key]
  if (typeof v.petScale === 'number' && Number.isFinite(v.petScale)) out.petScale = Math.min(3, Math.max(0.3, v.petScale))
  if (typeof v.nightDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.nightDay)) out.nightDay = v.nightDay
  return out
}

const dayOf = (at: Date): string => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

export interface PetBrainOptions {
  /** Her home: `characters/`, `packs/`, `library/`, `looks/` and this brain's own files. */
  home: string
  /** The engine's version, for a 设计包 that wants a newer one. */
  version: string
  preferredPort?: number
  /** The ffmpeg to make clips out of pictures with (the body app ships one); the one on PATH when not given. */
  ffmpeg?: string
  log?: (entry: Record<string, unknown>) => void
  now?: () => number
  random?: () => number
  /** How long after a body is welcomed she comes out (her opening clip, hello); the body needs a moment to draw her. */
  comeOutAfterMs?: number
  /** For tests: the brain she talks with, instead of the one chosen. */
  chatBrain?: FrontBrain
  /** Where her API key is kept (the keychain on a Mac); tests give a folder. */
  secrets?: Secrets
}

/** What the small settings window shows. */
export interface PetState {
  /** Nobody yet: a 设计包 has to come in first. */
  empty: boolean
  character?: { cid: string; name: string }
  characters: CharacterCard[]
  designs: InstalledDesign[]
  /** Her 编排: on, and what of it could not be played. */
  stage: { has: boolean; playing: boolean; notes: string[] }
  lines: { touch: boolean; hello: number; night: number }
  settings: PetSettings
  intro: IntroSettings
  /** What the opening clip is called (a 像素动画's name rather than its id). */
  introName?: string
  bodies: number
  /** Talking with her: the brain chosen, whether Claude Code is on this computer, whether a key is kept. */
  chat: { choice: BrainChoice; claude: boolean; key: boolean; voice: boolean }
}

export class PetBrain {
  readonly paths: HerPaths
  private readonly options: PetBrainOptions
  private readonly now: () => number
  private readonly random: () => number
  private readonly people: Characters
  private readonly library: Library
  private readonly pixels: Pixels
  private readonly designs: DesignPacks
  private server: BrainServer | undefined
  private timer: NodeJS.Timeout | undefined
  private settings: PetSettings
  private tracker = new TouchTracker()
  private bodyPack: PackSummary | undefined
  private bodyLook: LookView | undefined
  private stageNotes: string[] = []
  /** Her 编排 is written as a look the body can show. */
  private dressed = false
  private helloAt = 0
  private readonly randomNext = new Map<string, number>()
  private chosenUntil = 0
  private actId = 0
  /** Talking with her, while a brain is chosen and someone is here. */
  private chat: PetChat | undefined
  private readonly secrets: Secrets
  private hasKey = false
  /** Performances asked of the body, waiting for it to say they are done. */
  private readonly pendingActs = new Map<string, (result: { ok: boolean; reason?: string }) => void>()

  constructor(options: PetBrainOptions) {
    this.options = options
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.paths = herPaths(options.home)
    mkdirSync(this.paths.root, { recursive: true })
    if (options.ffmpeg !== undefined) useFfmpeg(options.ffmpeg)
    this.people = new Characters(this.paths.root, this.paths.characters, { cid: NOBODY, name: '' })
    this.library = new Library(this.paths.root)
    this.pixels = new Pixels(this.paths.root)
    this.settings = cleanPet(this.readJson('pet.json'))
    this.secrets = options.secrets ?? new Secrets(this.paths.root)
    void this.secrets.has(API_KEY_NAME).then(has => { this.hasKey = has }, () => undefined)
    this.designs = new DesignPacks({
      home: this.paths.root, charactersDir: this.paths.characters, version: options.version,
      library: this.library, skins: new Skins(this.paths.root), people: this.people,
      current: () => this.current(),
      intro: () => { const intro = this.intro(); return { ...(intro.source === 'skin' ? {} : { source: intro.source }), when: intro.when } },
      setIntro: (source, when) => this.saveIntro({ ...this.intro(), on: true, source, when }),
      pixels: this.pixels,
      // Nothing here looks at materials against the spec: that is the designer's page in dsh-her.
      examine: () => {},
    })
  }

  // ── files ───────────────────────────────────────────────────────────────

  private readJson(name: string): unknown {
    try {
      return JSON.parse(readFileSync(join(this.paths.root, name), 'utf8'))
    } catch {
      return undefined
    }
  }

  private writeJson(name: string, value: unknown): void {
    mkdirSync(this.paths.root, { recursive: true })
    writeFileSync(join(this.paths.root, name), `${JSON.stringify(value)}\n`)
  }

  private log(entry: Record<string, unknown>): void {
    this.options.log?.({ at: new Date(this.now()).toISOString(), ...entry })
  }

  private saveSettings(change: Partial<PetSettings>): void {
    this.settings = cleanPet({ ...this.settings, ...change })
    this.writeJson('pet.json', this.settings)
  }

  private intro(): IntroSettings {
    return cleanIntro(this.readJson('intro.json'))
  }

  private introName(): { introName?: string } {
    const intro = this.intro()
    if (intro.source === 'skin') return {}
    const pixel = introPixel(intro)
    if (pixel === undefined) return { introName: intro.source }
    const name = this.pixels.list().find(p => p.id === pixel)?.name
    return name === undefined ? {} : { introName: `${name}（像素动画）` }
  }

  private saveIntro(intro: IntroSettings): void {
    this.writeJson('intro.json', intro)
  }

  // ── who she is ──────────────────────────────────────────────────────────

  /** The character of now; `NOBODY` with an empty character before any 设计包 came in. */
  private current(): { cid: string; dir: string; character: Character } {
    const cid = this.people.active()
    const dir = join(this.paths.characters, cid)
    return { cid, dir, character: cid === NOBODY ? NO_ONE : loadCharacter(dir, NO_ONE) }
  }

  private someone(): boolean {
    return this.people.active() !== NOBODY
  }

  private lines(): WrittenLines {
    const { dir, character } = this.current()
    return this.someone() ? loadLines(dir, character) : {}
  }

  private characters(): CharacterCard[] {
    return this.people.list().filter(c => c.cid !== NOBODY)
  }

  // ── what she wears ──────────────────────────────────────────────────────

  /** Her 编排 as the look the body knows; what could not be played is kept in words. */
  private dress(): boolean {
    this.stageNotes = []
    if (!this.someone()) return false
    const { dir } = this.current()
    if (!readPlay(dir).on) return false
    const { stage, problems } = new StageStore(dir).load()
    if (stage === undefined) {
      this.stageNotes = problems
      return false
    }
    const { look, notes } = compileStage(stage, this.paths.root, this.paths.packs, this.library, listPacks(this.paths.packs).map(p => p.packId))
    this.stageNotes = notes
    this.log({ event: 'stage', action: 'play', notes: notes.length, shown: look !== undefined })
    return look !== undefined
  }

  private broadcast(message: BrainMessage): void {
    this.server?.broadcast(message)
  }

  private bubble(text: string): void {
    this.broadcast({ t: 'bubble', cid: this.current().cid, text, ttlMs: bubbleMs(text) })
  }

  private pick(lines: string[] | undefined): string | undefined {
    return lines === undefined || lines.length === 0 ? undefined : lines[Math.floor(this.random() * lines.length)]
  }

  // ── a body ──────────────────────────────────────────────────────────────

  private places(): DeskPlaces | undefined {
    const { wallpaper, overlay } = this.settings
    return wallpaper === undefined || overlay === undefined ? undefined : { wallpaper, overlay }
  }

  private welcome(client: BodyClient): BrainMessage {
    this.bodyPack = client.hello.packs[0] ?? this.bodyPack
    const { cid, character } = this.current()
    const places = this.places()
    const { tray, holdKey, petScale } = this.settings
    if (this.someone() && !this.settings.off) {
      // What she wears was written when this brain started (start()), before any body could look for it.
      if (this.dressed) setTimeout(() => client.send({ t: 'pack.use', packId: STAGE_LOOK_ID }), 300)
      this.people.dressed('desktop')
      setTimeout(() => this.comeOut(client), this.options.comeOutAfterMs ?? 1500)
    }
    return {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      sessionId: '',
      characters: this.someone() ? [{ cid, name: character.name, mode: 'overlay' }] : [],
      // No brain to talk to: the microphone is only ever held, and nothing answers it.
      config: {
        mic: 'push-to-talk', bargeIn: false, focus: false, off: this.settings.off,
        ...(places === undefined ? {} : { places }),
        ...(tray === undefined ? {} : { tray }),
        ...(holdKey === undefined ? {} : { holdKey }),
        ...(petScale === undefined ? {} : { petScale }),
      },
    }
  }

  /** She comes out on a body: her opening clip when its time has come, then a word of hello. */
  private comeOut(client: BodyClient): void {
    const intro = this.intro()
    // A 像素动画 goes as its code (the body draws it in its sandboxed player); a clip as its file.
    const pixel = introPixel(intro)
    const code = pixel === undefined ? undefined : this.pixels.code(pixel)
    const path = pixel !== undefined || intro.source === 'skin' ? undefined : this.library.path('intro', intro.source)
    const today = dayOf(new Date(this.now()))
    let played = false
    if ((path !== undefined || code !== undefined) && intro.on && !(intro.when === 'daily' && intro.lastDay === today)) {
      client.send(code === undefined ? { t: 'intro', path: path! } : { t: 'intro', path: '', pixel: { code, look: intro.look } })
      this.saveIntro({ ...intro, lastDay: today })
      played = true
      this.log({ event: 'intro', ...(pixel === undefined ? {} : { pixel }) })
    }
    if (this.now() - this.helloAt < HELLO_EVERY_MS) return
    const line = this.pick(this.lines().hello)
    if (line === undefined) return
    this.helloAt = this.now()
    // After the clip, not over it.
    setTimeout(() => this.bubble(line), played ? 4000 : 0)
    this.log({ event: 'hello', line })
  }

  private onMessage(client: BodyClient, message: BodyMessage): void {
    switch (message.t) {
      case 'touch':
        this.touched(message)
        break
      case 'off.set':
        this.setOff(message.off)
        break
      case 'body.prefs':
        this.saveSettings({ wallpaper: message.places.wallpaper, overlay: message.places.overlay, tray: message.tray, holdKey: message.holdKey, ...(message.petScale === undefined ? {} : { petScale: message.petScale }) })
        break
      case 'pack.list':
        this.bodyPack = message.packs.find(p => p.packId === message.active) ?? this.bodyPack
        break
      case 'look.state':
        this.bodyLook = message.look ?? undefined
        break
      case 'user.text': {
        const chat = this.ensureChat()
        if (chat !== undefined) chat.hear(message.text)
        // No brain chosen: say so rather than seem broken.
        else if (this.someone()) this.bubble('（我现在还不会聊天：在设置里的"和她聊天"选一个。）')
        break
      }
      case 'user.utterance':
        if (this.someone()) this.bubble(this.ensureChat() === undefined ? '（我现在还不会聊天。）' : '（我还听不见，打字和我说吧。）')
        break
      case 'interrupt':
        this.chat?.interrupted(message.uid, message.seq, message.playedMs)
        break
      case 'talk.get': {
        const chat = this.ensureChat()
        if (chat !== undefined) client.send({ t: 'talk', ...chat.talkView() })
        break
      }
      case 'act.done':
        this.pendingActs.get(message.id)?.({ ok: message.ok, ...(message.reason === undefined ? {} : { reason: message.reason }) })
        this.pendingActs.delete(message.id)
        break
      default:
        // Everything else belongs to a brain that talks.
        break
    }
  }

  private touched(message: Extract<BodyMessage, { t: 'touch' }>): void {
    if (!this.someone() || this.settings.off) return
    const part = message.part === 'head' ? 'head' : 'body'
    const kind = message.kind === 'long' ? 'long' : 'tap'
    const { cid } = this.current()
    const clip = touchClip(this.bodyPack, part)
    if (clip !== undefined && 'act' in clip) this.broadcast({ t: 'act', cid, id: `touch-${++this.actId}`, action: clip.act })
    else if (clip !== undefined) this.broadcast({ t: 'emotion', cid, emotion: clip.emotion })
    const mood = this.tracker.next(part, kind, this.now())
    if (mood === undefined) return
    const line = this.tracker.pick((this.lines().touch ?? FALLBACK_LINES)[mood], this.random)
    if (line === undefined) return
    const chat = this.ensureChat()
    // With a brain, out loud and noted for her next turn; without one, a bubble.
    if (chat !== undefined) {
      const where = kind === 'long' ? '摸了摸你的头' : part === 'head' ? '点了点你的头' : '戳了你一下'
      chat.sayOwnLine(line, `（备注：对方刚才${where}，你说了"${line}"。）`)
    } else this.bubble(line)
    this.log({ event: 'touch', part, kind, line })
  }

  // ── time ────────────────────────────────────────────────────────────────

  /** Every minute: good night when the quiet hours begin, and scenes that come up by chance. */
  tick(): void {
    if (!this.someone() || this.settings.off) return
    const at = new Date(this.now())
    const minute = at.getHours() * 60 + at.getMinutes()
    const today = dayOf(at)
    // Within a few minutes of the beginning, so a tick that ran late still says it; once a day.
    const since = (minute - this.settings.quietFrom + 24 * 60) % (24 * 60)
    if (since < 5 && this.settings.nightDay !== today && (this.server?.bodies.length ?? 0) > 0) {
      const line = this.pick(this.lines().night)
      this.saveSettings({ nightDay: today })
      if (line !== undefined) {
        this.bubble(line)
        this.log({ event: 'night', line })
      }
    }
    this.chance()
  }

  /** "隔一会儿随机": a scene of her 编排 whose time has come comes up, when the body's look has it. */
  private chance(): void {
    const { dir } = this.current()
    if (!readPlay(dir).on) return
    const { stage } = new StageStore(dir).load()
    if (stage === undefined) return
    const now = this.now()
    const hold = (scene: Scene) => (scene.hold === 'once' ? 60_000 : typeof scene.hold === 'object' ? scene.hold.minutes * 60_000 : 15 * 60_000)
    for (const scene of stage.scenes.slice(1)) {
      const random = scene.off === true ? undefined : scene.when?.find((w): w is Extract<When, { on: 'random' }> => w.on === 'random')
      if (random === undefined) {
        this.randomNext.delete(scene.id)
        continue
      }
      const [low, high] = random.everyMinutes
      const wait = () => (low + this.random() * (high - low)) * 60_000
      const due = this.randomNext.get(scene.id)
      if (due === undefined) this.randomNext.set(scene.id, now + wait())
      else if (now >= due && now >= this.chosenUntil) {
        this.chosenUntil = now + hold(scene)
        this.randomNext.set(scene.id, this.chosenUntil + wait())
        if (this.bodyLook?.id === STAGE_LOOK && this.bodyLook.scenes.some(s => s.id === scene.id)) this.broadcast({ t: 'look.set', go: scene.id })
        this.log({ event: 'stage', action: 'enter', scene: scene.id, why: 'random' })
      }
    }
  }

  // ── running ─────────────────────────────────────────────────────────────

  async start(): Promise<Discovery> {
    const server = new BrainServer({
      tokenFile: join(this.paths.root, 'token'),
      discoveryFile: this.paths.discovery,
      ...(this.options.preferredPort === undefined ? {} : { preferredPort: this.options.preferredPort }),
      welcome: client => this.welcome(client),
      message: (client, message) => this.onMessage(client, message),
    })
    // Pictures of her 编排 become clips here (ffmpeg, it can take a while): done before a body is let in.
    try {
      this.dressed = this.dress()
    } catch (error) {
      this.dressed = false
      this.stageNotes = [`编排没能放上去：${(error as Error).message}`]
      this.log({ event: 'stage', error: (error as Error).message })
    }
    const discovery = await server.start()
    this.server = server
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.timer.unref()
    this.log({ event: 'start', url: discovery.url, someone: this.someone() })
    return discovery
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    this.timer = undefined
    const chat = this.chat
    this.chat = undefined
    await chat?.dispose()
    for (const settle of this.pendingActs.values()) settle({ ok: false, reason: 'no body' })
    this.pendingActs.clear()
    const server = this.server
    this.server = undefined
    await server?.stop()
  }

  /** She is someone else, or wears something else: bodies are let go and come back to a new welcome. */
  private async again(): Promise<void> {
    if (this.server === undefined) return
    this.bodyLook = undefined
    this.randomNext.clear()
    this.chosenUntil = 0
    this.helloAt = 0
    this.tracker = new TouchTracker()
    await this.stop()
    await this.start()
  }

  // ── the settings window ─────────────────────────────────────────────────

  state(): PetState {
    const someone = this.someone()
    const { cid, dir, character } = this.current()
    const lines = this.lines()
    return {
      empty: !someone,
      ...(someone ? { character: { cid, name: character.name } } : {}),
      characters: this.characters(),
      designs: this.designs.installed(),
      stage: { has: someone && new StageStore(dir).load().stage !== undefined, playing: someone && readPlay(dir).on, notes: this.stageNotes },
      lines: { touch: lines.touch !== undefined, hello: lines.hello?.length ?? 0, night: lines.night?.length ?? 0 },
      settings: this.settings,
      intro: this.intro(),
      ...this.introName(),
      bodies: this.server?.bodies.length ?? 0,
      chat: { choice: this.settings.brain, claude: findClaude() !== undefined, key: this.hasKey, voice: this.settings.voice },
    }
  }

  // ── talking ─────────────────────────────────────────────────────────────

  /** The conversation with the character of now, when a brain is chosen. */
  private ensureChat(): PetChat | undefined {
    if (!this.someone() || this.settings.brain.kind === 'none') return undefined
    if (this.chat !== undefined) return this.chat
    const { cid, dir } = this.current()
    this.chat = new PetChat({
      home: this.paths.root, cid, dir,
      character: () => this.current().character,
      choice: this.settings.brain,
      secrets: this.secrets,
      voice: () => this.settings.voice,
      broadcast: message => this.broadcast(message),
      broadcastWithAudio: (message, stream, audio) => this.server?.broadcastWithAudio(message, stream, audio),
      bodyPack: () => this.bodyPack,
      playAction: action => this.playAction(action),
      off: () => this.settings.off,
      log: entry => this.log(entry),
      ...(this.options.chatBrain === undefined ? {} : { brain: this.options.chatBrain }),
    })
    return this.chat
  }

  /** A longer performance by the body (her play_action tool): done when the body says so. */
  private playAction(action: string): Promise<{ ok: boolean; reason?: string }> {
    if ((this.server?.bodies.length ?? 0) === 0) return Promise.resolve({ ok: false, reason: 'no body' })
    const id = `act-${++this.actId}`
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pendingActs.delete(id); resolve({ ok: false, reason: 'timeout' }) }, 60_000)
      timer.unref()
      this.pendingActs.set(id, result => { clearTimeout(timer); resolve(result) })
      this.broadcast({ t: 'act', cid: this.current().cid, id, action })
    })
  }

  /** Who she talks with; the conversation so far is kept by each brain. */
  async setBrain(choice: BrainChoice): Promise<void> {
    this.saveSettings({ brain: cleanBrainChoice(choice) })
    const chat = this.chat
    this.chat = undefined
    await chat?.dispose()
  }

  /** Keep her API key (empty: forget it). Never logged, never in a file anyone else can read. */
  async setKey(key: string): Promise<void> {
    await this.secrets.set(API_KEY_NAME, key)
    this.hasKey = key.trim() !== ''
  }

  setVoice(on: boolean): void {
    this.saveSettings({ voice: on })
  }

  setLoop(on: boolean): void {
    this.saveSettings({ loop: on })
  }

  /** Look at a 设计包: nothing is written but the zip, kept for `installDesign`. */
  previewDesign(zip: Uint8Array): DesignPreview {
    return this.designs.preview(zip)
  }

  /**
   * Put a 设计包 in. Everything it has that a pet can use, unless said
   * otherwise: the character with her 编排 and materials, her opening clip;
   * never the skin (there is no DSH to wear it). She becomes the one shown.
   */
  async installDesign(token: string, choice: Partial<DesignChoice> = {}): Promise<{ record: InstalledDesign; notes: string[] }> {
    const { record, notes } = this.designs.apply(token, { character: true, switchTo: true, intro: true, setIntro: true, materials: true, ...choice, skin: false, wearSkin: false })
    this.log({ event: 'design-pack', action: 'install', id: record.id, cid: record.cid ?? null })
    if (record.cid === undefined) notes.push('这个设计包里没有人物，只把素材放进来了')
    else if (choice.switchTo !== false) {
      this.people.use(record.cid)
      await this.again()
    }
    return { record, notes }
  }

  async useCharacter(cid: string): Promise<void> {
    if (cid === NOBODY) throw new Error('没有这个人物')
    this.people.use(cid)
    await this.again()
  }

  /** Out of the list (kept in `characters/.removed`); not the one shown now. */
  removeCharacter(cid: string): void {
    if (cid === NOBODY) throw new Error('没有这个人物')
    this.people.remove(cid)
  }

  /** Whether she follows her 编排 (off: the body keeps what it last wore). */
  async playStage(on: boolean): Promise<void> {
    if (!this.someone()) throw new Error('还没有人物')
    writePlay(this.current().dir, { on })
    await this.again()
  }

  setOff(off: boolean): void {
    this.saveSettings({ off })
    this.broadcast({ t: 'config', off })
  }

  /** Where the body shows her, and how big. */
  setPlaces(change: { wallpaper?: boolean; overlay?: boolean; tray?: boolean; petScale?: number }): void {
    this.saveSettings(change)
    const places = this.places()
    this.broadcast({
      t: 'config',
      ...(places === undefined ? {} : { places }),
      ...(this.settings.tray === undefined ? {} : { tray: this.settings.tray }),
      ...(this.settings.petScale === undefined ? {} : { petScale: this.settings.petScale }),
    })
  }

  setQuiet(quietFrom: number, quietTo: number): void {
    this.saveSettings({ quietFrom, quietTo })
  }

  setIntro(change: { on?: boolean; when?: 'every' | 'daily' }): void {
    this.saveIntro(cleanIntro({ ...this.intro(), ...change }))
  }
}
