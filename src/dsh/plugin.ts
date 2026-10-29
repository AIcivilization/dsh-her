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
 * Her replies are also logged with timings to `<home>/logs/stream.jsonl`.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { extractCues, herPaths, judgeBargeIn, performanceSection, readingMs, speakable } from '../core/index.ts'
import { PROTOCOL_VERSION, type BodyMessage, type BrainMessage, type PackSummary } from '../protocol/index.ts'
import { BrainServer } from '../server/brain-server.ts'
import { bodyRunning, findDevBody, launchBody } from './body-launcher.ts'
import type { HerConfig } from './config.ts'
import { HerSession, type DshServices, type ModelRoute } from './her-session.ts'
import { heardText, SpeechQueue } from '../voice/speech-queue.ts'
import { Voice } from '../voice/voice.ts'

interface CommandsLike {
  register(definition: {
    name: string
    description: string
    input?: { hint: string }
    handler: (invocation: { rawInput: string }) => Promise<{ kind: 'success' | 'error'; text: string }>
  }): () => void
}

const SERVICES = ['agents', 'agentDefaultModel', 'workspaceRegistry', 'sessionTitle', 'sessionQuery'] as const

const STOP_WORDS = new Set(['停', '停下', 'stop'])
const INTERRUPT_CHECK = '测打断'
const DIAGNOSE = '诊断'

/** How long after DSH starts to wait for a running body before starting one. */
const LAUNCH_AFTER_MS = 3000

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
  let speech: SpeechQueue | undefined
  let nextStream = 1
  /** What you heard of her last cut-off reply; told to her before your next turn. */
  let cutNote: string | undefined
  /** The last barge-in, to check the utterance that follows it for echo. */
  let lastCut: { uid: string; at: number } | undefined
  /** The pack of the most recently connected body: what she can perform. */
  let bodyPack: PackSummary | undefined
  /** Actions sent to a body, waiting for its `act.done`. */
  const pendingActs = new Map<string, (result: { ok: boolean; reason?: string }) => void>()
  let nextAct = 1

  /** Have the body perform an action and wait (at most 90 s) for it to finish. */
  const playAction = (action: string): Promise<{ ok: boolean; reason?: string; transcript?: string }> => {
    const body = server?.bodies.at(-1)
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
      pendingActs.set(id, result => {
        clearTimeout(timer)
        log({ event: 'act', action, ...result })
        resolve(known.transcript === undefined || !result.ok ? result : { ...result, transcript: known.transcript })
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

  const broadcast = (message: BrainMessage) => server?.broadcast(message)

  /** A reply with no words: record what the turn did instead (tool calls, reasoning only, errors). */
  const logQuietTurn = async () => {
    const id = session?.sessionId
    const query = services?.sessionQuery
    if (id === undefined || query === undefined) return
    try {
      const events = (await query.readSession(id)).events.slice(-12)
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
    } catch (error) {
      log({ event: 'quiet-turn', error: (error as Error).message })
    }
  }

  const route = (): ModelRoute | undefined => {
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
    broadcast({ t: 'state', cid, state: 'think' })
    const her = session
    const note = cutNote
    cutNote = undefined
    ;(note === undefined ? Promise.resolve() : her.note(note))
      .then(() => her.say(text, via))
      .catch((error: Error) => {
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
    if (current?.attemptId === uid) session?.interrupt()
    speech?.cancel(uid)
  }

  const onBodyMessage = (message: BodyMessage, audio: Uint8Array | undefined) => {
    switch (message.t) {
      case 'user.text': {
        const text = message.text.trim()
        if (text !== '') hear(text, 'text')
        break
      }
      case 'user.utterance': {
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
        const settle = pendingActs.get(message.id)
        pendingActs.delete(message.id)
        settle?.({ ok: message.ok, ...(message.reason === undefined ? {} : { reason: message.reason }) })
        break
      }
    }
  }

  ctx.effect(() => {
    mkdirSync(dir, { recursive: true })
    mkdirSync(paths.logs, { recursive: true })
    session = new HerSession({
      cid,
      name: config.character.name,
      persona: config.character.persona,
      performance: () => performanceSection(bodyPack),
      playAction,
      dir,
      get route() { return route() },
      services: () => services,
      logger: ctx.logger,
      events: {
        start(attemptId) {
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
          log({ event: 'sentence', attemptId, text, sinceSendMs: sentAt === undefined ? null : now - sentAt })
          const performed = extractCues(text, bodyPack)
          if (performed.text !== '' || performed.cues.length > 0) speech?.say(attemptId, seq, performed.text, performed.cues)
        },
        end(attemptId, outcome) {
          log({ event: 'end', attemptId, outcome, sinceSendMs: sentAt === undefined ? null : Date.now() - sentAt })
          if (current?.attemptId === attemptId) {
            current.outcome = outcome
            if (current.sentences.length === 0 && outcome !== 'committed') {
              broadcast({ t: 'bubble', cid, text: '（我刚才没说出话来，模型可能出错了）', ttlMs: 6000 })
            }
            if (current.sentences.length === 0) void logQuietTurn()
            finished.push(current)
            if (finished.length > 20) finished.shift()
          }
          speech?.end(attemptId)
          current = undefined
        },
      },
    } as ConstructorParameters<typeof HerSession>[0])
    if (services !== undefined) open()

    voice = new Voice(paths.models, config.voice, ctx.logger)
    const herVoice = voice
    void herVoice.start()
    speech = new SpeechQueue(text => herVoice.synthesize(speakable(text)), {
      sentence(uid, seq, text, audio, cues) {
        const withCues = cues.length === 0 ? {} : { cues }
        if (audio === undefined) {
          broadcast({ t: 'speak.seg', cid, uid, seq, text, durationMs: text === '' ? 300 : readingMs(text), ...withCues })
          return
        }
        const stream = nextStream++
        if (seq === 0) log({ event: 'first-audio', uid, sinceSendMs: sentAt === undefined ? null : Date.now() - sentAt, durationMs: audio.durationMs })
        server?.broadcastWithAudio({ t: 'speak.seg', cid, uid, seq, text, durationMs: audio.durationMs, format: 'wav', stream, ...withCues }, stream, audio.audio)
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
          characters: [{ cid, name: config.character.name, mode: 'overlay' }],
          config: { mic: config.voice.mic, bargeIn: true },
        }
      },
      message: (_client, message, audio) => onBodyMessage(message, audio),
      closed: () => {
        bodyPack = server?.bodies.at(-1)?.hello.packs[0]
        for (const settle of pendingActs.values()) settle({ ok: false, reason: 'no body' })
        pendingActs.clear()
      },
    })
    let launchTimer: NodeJS.Timeout | undefined
    brain.start().then(discovery => {
      server = brain
      if (config.body.launch !== 'auto') return
      launchTimer = setTimeout(() => {
        if (brain.bodies.length > 0 || bodyRunning(paths.root)) return
        const plan = findDevBody()
        if ('missing' in plan) {
          ctx.logger.warn(`dsh-her: no body to start (missing ${plan.missing})`)
          return
        }
        const pid = launchBody(plan, { url: discovery.url, token: discovery.token, home: paths.root, pack: config.body.pack })
        ctx.logger.info(`dsh-her: started the body (pid ${pid})`)
      }, LAUNCH_AFTER_MS)
      launchTimer.unref()
    }, (error: Error) => ctx.logger.warn(`dsh-her: body server failed to start (${error.message})`))

    return async () => {
      clearTimeout(launchTimer)
      herVoice.stop()
      voice = undefined
      speech = undefined
      const closing = session
      session = undefined
      server = undefined
      closing?.interrupt()
      await Promise.all([closing?.dispose(), brain.stop()])
    }
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
