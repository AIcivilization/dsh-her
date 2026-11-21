/**
 * 像素工坊's AI (docs/像素工坊设计.md §3): one dsh session per draft, in her
 * workspace, apart from 「她 · 设计」. It gets the 像素动画 format and three
 * tools only (DSH's own are hidden): read the version shown, hand in new code,
 * change the look.
 *
 * Code handed in is never run here. It goes to the workshop page, which tries
 * it in its sandbox and answers with what it found and three frames drawn in
 * characters, so the AI can see what it made. The page asks for the chat
 * every half second; that is also how it learns there is something to try.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { pixelFormat } from '../core/pixel-spec.ts'
import { cleanPixelInfo, PIXEL_STYLES, STYLE_NAME, wrapPixelCode, type PixelInfo } from '../core/pixel.ts'
import { sketchReport, type Sketch } from '../core/pixel-sketch.ts'
import type { NativeTool } from './design-tools.ts'
import type { DshServices, ModelRoute, ScopedContext, StreamFrame } from './her-session.ts'
import type { DraftView, PixelDrafts } from './pixel-drafts.ts'

export interface ChatItem {
  /** you: the user; ai: the AI's words; note: what happened (a try, a new version). */
  who: 'you' | 'ai' | 'note'
  text: string
  at: number
  ok?: boolean
}

export interface ProbeResult {
  ok: boolean
  problems: string[]
  warnings: string[]
  info?: PixelInfo
  frameMs?: number
  sketches?: Sketch[]
}

export interface ChatView {
  items: ChatItem[]
  /** The AI is answering. */
  busy: boolean
  /** Changes whenever anything here does. */
  rev: number
  /** Changes when the AI made a version or changed the look: the page reads the draft again. */
  draftRev: number
  /** Code for the page to try in its sandbox, and send back. */
  probe?: { req: string; code: string }
  sessionId?: string
}

interface Handle {
  agent: {
    session: unknown
    followup(message: { id: string; role: 'user'; content: Array<{ type: 'text'; text: string }>; source: { kind: string } }): void
    cancel(cause?: unknown): void
    whenIdle(): Promise<void>
  }
}

interface Chat {
  items: ChatItem[]
  sessionId?: string
  handle?: Handle
  opening?: Promise<Handle>
  busy: boolean
  /** The AI's words being written now. */
  live?: ChatItem
  /** Model steps started and not ended. */
  open: number
  rev: number
  draftRev: number
  /** Code handed in since the user last spoke. */
  tries: number
  probe?: { req: string; code: string; resolve: (result: ProbeResult | undefined) => void }
  /** When the page last asked. */
  seen: number
}

export interface PixelChatDeps {
  drafts: PixelDrafts
  services: () => DshServices | undefined
  route: () => ModelRoute | undefined
  /** Her workspace's folder, so the sessions sit with hers. */
  room: string
  title: string
  logger: { info(message: string): void; warn(message: string): void }
}

/** How many times in one answer the AI may hand in code. */
export const MAX_TRIES = 4
/** How long a try may wait for the page. */
const PROBE_WAIT = 25_000
/** The page counts as open if it asked this recently. */
const PAGE_ALIVE = 8_000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const isItem = (v: unknown): v is ChatItem => typeof v === 'object' && v !== null && ['you', 'ai', 'note'].includes((v as ChatItem).who) && typeof (v as ChatItem).text === 'string'
const strings = (v: unknown, most: number): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').map(s => s.slice(0, 400)).slice(0, most) : [])

/** What the page says it found, kept to the shape we expect. */
export function cleanProbe(raw: unknown): ProbeResult {
  const v = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const info = cleanPixelInfo(v.info).info
  const sketches = Array.isArray(v.sketches)
    ? (v.sketches as unknown[]).slice(0, 5).flatMap(s => {
      const o = typeof s === 'object' && s !== null ? s as Record<string, unknown> : {}
      if (typeof o.t !== 'number' || typeof o.text !== 'string') return []
      const stats = typeof o.stats === 'object' && o.stats !== null ? o.stats as Sketch['stats'] : { filled: 0 }
      return [{ t: o.t, text: o.text.slice(0, 4000), stats: { filled: Number(stats.filled) || 0, ...(stats.box === undefined ? {} : { box: stats.box }) } }]
    })
    : []
  return {
    ok: v.ok === true && info !== undefined,
    problems: strings(v.problems, 10),
    warnings: strings(v.warnings, 10),
    ...(info === undefined ? {} : { info }),
    ...(typeof v.frameMs === 'number' && Number.isFinite(v.frameMs) ? { frameMs: v.frameMs } : {}),
    ...(sketches.length > 0 ? { sketches } : {}),
  }
}

export function pixelPrompt(draft: DraftView): string {
  const now = draft.code === '' ? '还是空的，没有画面' : `页面上正在播 v${draft.current}（${draft.versions.find(v => v.n === draft.current)?.note ?? ''}）`
  return `你是 dsh-her「像素工坊」里的动画师。用户多半不会写代码，你帮他做「dsh-her 像素动画」：一个 .js 文件，引擎每一帧调用 frame(g, t, n)，你往一张粗格子里填数，画成什么样、什么颜色由引擎和用户决定。

现在的草稿叫「${draft.name}」，${now}。

怎么做：
1. 用户说想要什么，你写好完整的代码，用 pixel_write 交上去。不要把代码贴在对话里：用户看不懂，交上去页面就会播。下面格式说明里"只给代码、不用解释"那条在这里不适用。
2. pixel_write 会在用户的页面里试跑。出错了，照着错误改好再交；通过了，它会给你三帧缩小的字符画和画面范围，看看位置、大小、形状、动作对不对，不对就自己再改。一次回答里最多交 ${MAX_TRIES} 次。
3. 用户要改，先用 pixel_read 读当前代码，只改他说的地方，其他照原样。
4. 做好了，用一两句话告诉用户你做了什么、还可以怎么改。说中文，简短，不讲代码。
5. 颜色、画法（方块、圆点、代码字）、大小是用户在页面上自己调的，不写在代码里。用单色（color: 'mono'），亮度表示深浅；只有用户要好几种颜色时才用 'color'。用户明确说"换成方块""换成粉色"时，用 pixel_look 改。
6. 画东西：位置和大小用 g.w、g.h 算，别写死坐标；主体要够大，占画面一半左右；画人物、动物、物件时用 g.sprite：先用一组字符串画出像素图，要动的部分多画几张（眨眼、张嘴、迈步）轮着换，比用圆和线拼像得多；要细腻就画大（人物至少 32 行，格子用 256 × 144 或更细），彩色时每块颜色有亮、中、暗三层，外圈描深色轮廓；动作要有节奏，一直循环的要首尾接得上。
7. 用户要做他喜欢的角色、形象，是他自己用，照着做就好。
8. 代码里有 PICTURE 的，是用户上传的图片转成的像素图：原样保留那些字符串，用 g.sprite 画它；要眨眼、张嘴、抬手，就复制一份只改那几格，轮着换。

${pixelFormat()}`
}

export class PixelChats {
  private readonly chats = new Map<string, Chat>()
  private readonly deps: PixelChatDeps

  constructor(deps: PixelChatDeps) {
    this.deps = deps
  }

  private chat(id: string): Chat {
    let c = this.chats.get(id)
    if (c === undefined) {
      const saved = this.deps.drafts.chat(id)
      c = { items: saved.items.filter(isItem), ...(saved.sessionId === undefined ? {} : { sessionId: saved.sessionId }), busy: false, open: 0, rev: 1, draftRev: 1, tries: 0, seen: 0 }
      this.chats.set(id, c)
    }
    return c
  }

  private changed(id: string, c: Chat, keep = false): void {
    c.rev++
    if (keep) this.deps.drafts.saveChat(id, { ...(c.sessionId === undefined ? {} : { sessionId: c.sessionId }), items: c.items })
  }

  private note(id: string, c: Chat, text: string, ok: boolean): void {
    c.items.push({ who: 'note', text, at: Date.now(), ok })
    this.changed(id, c, true)
  }

  view(id: string): ChatView {
    this.deps.drafts.get(id)
    const c = this.chat(id)
    c.seen = Date.now()
    return {
      items: c.items, busy: c.busy, rev: c.rev, draftRev: c.draftRev,
      ...(c.probe === undefined ? {} : { probe: { req: c.probe.req, code: c.probe.code } }),
      ...(c.sessionId === undefined ? {} : { sessionId: c.sessionId }),
    }
  }

  async send(id: string, text: string): Promise<ChatView> {
    const said = text.trim().slice(0, 2000)
    if (said === '') throw new Error('说点什么吧')
    const c = this.chat(id)
    if (c.busy) throw new Error('AI 还在做上一件事：等它做完，或者先点「停」')
    c.busy = true
    this.changed(id, c)
    let handle: Handle
    try {
      handle = await this.open(id)
    } catch (error) {
      c.busy = false
      this.changed(id, c)
      throw error
    }
    c.items.push({ who: 'you', text: said, at: Date.now() })
    c.tries = 0
    this.changed(id, c, true)
    handle.agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: said }], source: { kind: 'dsh-her-pixel' } })
    void this.settle(id, c, handle)
    return this.view(id)
  }

  /** Busy until the agent is idle with no step open (a tool call starts another step). */
  private async settle(id: string, c: Chat, handle: Handle): Promise<void> {
    for (let i = 0; i < 200; i++) {
      await sleep(400)
      try {
        await handle.agent.whenIdle()
      } catch {
        break
      }
      await sleep(300)
      if (c.open === 0) break
    }
    c.busy = false
    c.open = 0
    if (c.live !== undefined) this.endLive(c)
    this.changed(id, c, true)
  }

  stop(id: string): ChatView {
    const c = this.chat(id)
    try {
      c.handle?.agent.cancel(new Error('用户点了停'))
    } catch {
      // already stopped
    }
    c.probe?.resolve(undefined)
    c.probe = undefined
    c.busy = false
    c.open = 0
    if (c.live !== undefined) this.endLive(c)
    this.note(id, c, '停下了。', false)
    return this.view(id)
  }

  /** Something that happened on the page, said in the chat (not to the AI). */
  addNote(id: string, text: string): ChatView {
    this.note(id, this.chat(id), text.slice(0, 200), true)
    return this.view(id)
  }

  /** The page's answer to a try. */
  answerProbe(id: string, req: string, result: unknown): void {
    const c = this.chat(id)
    if (c.probe?.req !== req) return
    const probe = c.probe
    c.probe = undefined
    this.changed(id, c)
    probe.resolve(cleanProbe(result))
  }

  /** The session's id, made or resumed if need be (to open it in dsh). */
  async sessionOf(id: string): Promise<string> {
    await this.open(id)
    return this.chat(id).sessionId!
  }

  forget(id: string): void {
    const c = this.chats.get(id)
    if (c === undefined) return
    try {
      if (c.busy) c.handle?.agent.cancel(new Error('草稿扔掉了'))
    } catch {
      // gone anyway
    }
    c.probe?.resolve(undefined)
    this.chats.delete(id)
  }

  private open(id: string): Promise<Handle> {
    const c = this.chat(id)
    if (c.handle !== undefined) return Promise.resolve(c.handle)
    c.opening ??= this.make(id, c).finally(() => { c.opening = undefined })
    return c.opening
  }

  private async make(id: string, c: Chat): Promise<Handle> {
    const services = this.deps.services()
    if (services === undefined) throw new Error('DSH 的 agents 服务还不可用，过一会儿再试')
    const route = this.deps.route()
    const setup = (agentCtx: ScopedContext) => this.prepare(id, agentCtx)
    if (c.sessionId !== undefined) {
      try {
        c.handle = await services.agents.resume({ resumeSessionId: c.sessionId, agentOptions: route, setup }) as unknown as Handle
        return c.handle
      } catch (error) {
        this.deps.logger.warn(`dsh-her: pixel chat not resumed (${(error as Error).message}); making a new one`)
      }
    }
    const sessionId = `dsh-her-pixel-${randomUUID()}`
    mkdirSync(this.deps.room, { recursive: true })
    const workspace = await services.workspaceRegistry?.create(this.deps.room, this.deps.title)
    c.handle = await services.agents.create({ sessionId, meta: { cwd: this.deps.room }, agentOptions: route, setup }) as unknown as Handle
    c.sessionId = sessionId
    try {
      await workspace?.attachSession(sessionId)
      services.sessionTitle?.rename(c.handle.agent.session, `做像素动画：${this.deps.drafts.get(id).name}`)
    } catch (error) {
      this.deps.logger.warn(`dsh-her: pixel chat not attached/titled (${(error as Error).message})`)
    }
    this.changed(id, c, true)
    this.deps.logger.info(`dsh-her: made a pixel chat (${sessionId})`)
    return c.handle
  }

  /** The format, the draft as it is now, our three tools; DSH's own tools hidden. */
  private prepare(id: string, agentCtx: ScopedContext): void {
    agentCtx.systemPrompt?.section({ name: 'dsh-her:pixel', order: 0, complete: true, interpolate: false, text: () => pixelPrompt(this.deps.drafts.get(id)) })
    agentCtx.systemPrompt?.suppressRuntimeContext?.()
    try {
      const names = agentCtx.tools.schemas().map(schema => schema.name).filter(name => name !== 'run_code')
      if (names.length > 0) agentCtx.tools.restrict({ deny: names })
    } catch (error) {
      this.deps.logger.warn(`dsh-her: pixel chat keeps DSH's tools (${(error as Error).message})`)
    }
    for (const tool of this.tools(id)) agentCtx.tools.register(tool)
    agentCtx.on('agent/assistant-stream', ({ frame }) => this.onFrame(id, frame))
  }

  private endLive(c: Chat): void {
    const live = c.live!
    c.live = undefined
    live.text = live.text.trim()
    if (live.text === '') c.items.splice(c.items.indexOf(live), 1)
  }

  private onFrame(id: string, frame: StreamFrame): void {
    const c = this.chats.get(id)
    if (c === undefined) return
    if (frame.type === 'start') {
      c.open++
      c.busy = true
      if (c.live !== undefined) this.endLive(c)
      this.changed(id, c)
    } else if (frame.type === 'chunk') {
      if (frame.chunk.type !== 'text-delta' || typeof frame.chunk.text !== 'string') return
      if (c.live === undefined) {
        c.live = { who: 'ai', text: '', at: Date.now() }
        c.items.push(c.live)
      }
      c.live.text += frame.chunk.text
      this.changed(id, c)
    } else {
      c.open = Math.max(0, c.open - 1)
      if (c.live !== undefined) this.endLive(c)
      this.changed(id, c, true)
    }
  }

  /** Hand code to the page to try; undefined when no page is there to try it. */
  private tryOnPage(id: string, code: string): Promise<ProbeResult | undefined> {
    const c = this.chat(id)
    if (Date.now() - c.seen > PAGE_ALIVE) return Promise.resolve(undefined)
    c.probe?.resolve(undefined)
    return new Promise(resolve => {
      const req = randomUUID()
      const timer = setTimeout(() => {
        if (c.probe?.req !== req) return
        c.probe = undefined
        this.changed(id, c)
        resolve(undefined)
      }, PROBE_WAIT)
      c.probe = { req, code, resolve: result => { clearTimeout(timer); resolve(result) } }
      this.changed(id, c)
    })
  }

  tools(id: string): NativeTool[] {
    const drafts = this.deps.drafts
    const output = {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_args: unknown, value: { text: string }) => [{ type: 'text' as const, text: value.text }],
    }
    const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], run: (args: Record<string, unknown>) => string | Promise<string>): NativeTool => ({
      name, description, output,
      parameters: { type: 'object', properties, required, additionalProperties: false },
      execute: async args => {
        try {
          return { text: await run(args) }
        } catch (error) {
          return { text: `没做成：${(error as Error).message}` }
        }
      },
    })
    const colorName = (color: string) => (color === 'theme' ? '跟着 dsh 的颜色' : color)
    return [
      tool('pixel_read', '读页面上正在播的这一版：代码、版本、外观。改之前先读。', {}, [], () => {
        const d = drafts.get(id)
        if (d.code === '') return '还没有画面：这是一个空草稿，直接按用户说的写一个新的。'
        const v = d.versions.find(x => x.n === d.current)
        return `现在是 v${d.current}（${v?.note ?? ''}）。外观（用户在页面上调的，不在代码里）：画法 ${STYLE_NAME[d.look.style]}，颜色 ${colorName(d.look.color)}。\n\n代码：\n\`\`\`js\n${d.code}\n\`\`\``
      }),
      tool('pixel_write', '交一份完整的新代码（整个文件）。会在用户的页面里试跑：出错就告诉你错在哪，通过了就存成新的一版开始播，并给你三帧字符画看看画得对不对。', {
        code: { type: 'string', description: '整个 .js 文件' },
        note: { type: 'string', description: '这一版改了什么，十个字以内，比如"小鲸鱼游过去"' },
      }, ['code', 'note'], async args => {
        const c = this.chat(id)
        c.tries++
        if (c.tries > MAX_TRIES) return `这一次已经交了 ${MAX_TRIES} 次，先停下来：用一两句话告诉用户现在卡在哪里，问他想怎么办。`
        const code = typeof args.code === 'string' ? args.code : ''
        const note = (typeof args.note === 'string' ? args.note.trim() : '').slice(0, 30) || 'AI 改的'
        const wrapped = wrapPixelCode(code)
        if (wrapped.script === undefined) {
          this.note(id, c, `🔧 没交上去：${wrapped.problems[0] ?? ''}`, false)
          return `没交上去：\n- ${wrapped.problems.join('\n- ')}\n改好再交（这一次还能交 ${MAX_TRIES - c.tries} 次）。`
        }
        const trying: ChatItem = { who: 'note', text: '🔧 在你的页面里试跑……', at: Date.now(), ok: true }
        c.items.push(trying)
        this.changed(id, c)
        const result = await this.tryOnPage(id, code)
        if (c.items.includes(trying)) c.items.splice(c.items.indexOf(trying), 1)
        if (result === undefined) {
          this.note(id, c, '没法试跑：像素工坊页面没开着', false)
          return '没法试跑：用户的像素工坊页面现在没开着。告诉用户：回到「她」→ 像素动画，打开这个草稿，再说一次。'
        }
        if (!result.ok) {
          this.note(id, c, `🔧 试跑没通过（${result.problems[0] ?? '出错了'}），AI 在改`, false)
          return `试跑没通过：\n- ${result.problems.join('\n- ')}\n改好再交（这一次还能交 ${MAX_TRIES - c.tries} 次）。`
        }
        const d = drafts.add(id, code, `🤖 ${note}`)
        c.draftRev++
        this.note(id, c, `✓ v${d.current}：${note}`, true)
        const info = result.info!
        const head = `试跑通过，存成了 v${d.current}，页面上已经在播。格子 ${info.grid[0]} × ${info.grid[1]}，每秒 ${info.fps} 帧，${info.seconds > 0 ? `${info.seconds} 秒一遍` : '一直循环'}${result.frameMs === undefined ? '' : `，每帧最慢 ${result.frameMs} 毫秒`}。`
        const warn = result.warnings.length > 0 ? `\n要注意：${result.warnings.join('；')}` : ''
        const sketch = result.sketches === undefined ? '' : `\n\n三帧缩小的字符画（越往右越亮：" .:+#"）：\n${sketchReport(result.sketches)}`
        return `${head}${warn}${sketch}\n\n看看对不对（位置、大小、形状、动作）。不对就再改；对了，就用一两句话告诉用户做了什么。`
      }),
      tool('pixel_look', '改外观：画法、颜色、大小。只在用户明确要求时用。', {
        style: { type: 'string', enum: PIXEL_STYLES, description: 'blocks 方块，dots 圆点，code 代码字' },
        color: { type: 'string', description: "'theme'（跟着 dsh 的颜色）或 #rrggbb" },
        size: { type: 'number', description: '0.2–1，占画面多少' },
        fit: { type: 'string', enum: ['contain', 'cover'], description: 'contain 放中间，cover 铺满' },
      }, [], args => {
        const change: Record<string, unknown> = {}
        for (const key of ['style', 'color', 'size', 'fit']) if (args[key] !== undefined) change[key] = args[key]
        const d = drafts.set(id, { look: change })
        const c = this.chat(id)
        c.draftRev++
        this.note(id, c, `🎨 外观：${STYLE_NAME[d.look.style]}，${colorName(d.look.color)}`, true)
        return `改好了：画法 ${STYLE_NAME[d.look.style]}，颜色 ${colorName(d.look.color)}，大小 ${Math.round(d.look.size * 100)}%，${d.look.fit === 'cover' ? '铺满' : '放中间'}。`
      }),
    ]
  }
}
