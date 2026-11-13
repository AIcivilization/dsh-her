/**
 * The design session of "+AI" (docs/设置页与编排设计.md §6): a session of its
 * own in her workspace ("她 · 设计"), apart from her conversations, with the
 * design tools only. What you clicked "+AI" on goes into its prompt, so you
 * open it and just say how to change it. Made once and resumed after that.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NativeTool } from './design-tools.ts'
import { SKIN_INTERVIEW } from '../core/skin-guide.ts'
import type { DshServices, ModelRoute, ScopedContext } from './her-session.ts'

export interface DesignSessionDeps {
  home: string
  /** Her workspace's folder, so the session sits with hers. */
  room: string
  title: string
  services: () => DshServices | undefined
  route: () => ModelRoute | undefined
  tools: () => NativeTool[]
  logger: { info(message: string): void; warn(message: string): void }
}

const PROMPT = `你是 dsh-her 的设计助手。dsh-her 是 dsh 里的一个虚拟陪伴角色，用户可以自己编排她的样子：
- 编排：一行一类东西（皮肤、头像、桌面、宠物），一列一个场景；格子里写素材库里的素材名，空着就沿用下面一层。
- 皮肤：dsh 整个界面的颜色（--dsw-alias-… 颜色，每个给 light 和 dark）、背景图、字体、她的对话小条。
- SVG：素材库里的矢量图，分好层的（比如 <g id="衣服">）可以直接改颜色、改部件。

用你的工具读、改这些东西。规则：
- 改之前先读（stage_get、skin_get、svg_get），只改用户要改的地方，其他照原样。
- 改完用一两句话说清楚改了什么、在哪儿看、怎么退回（编排页"退回到之前的版本"，素材库图上的"退回上一版"）。
- 你只能改编排、皮肤和素材库里的 SVG；位图和视频改不了，可以帮用户写提示词让他们拿去别的工具生成。
- 用中文，简短。`

interface DesignHandle {
  agent: {
    session: unknown
    followup?(message: { id: string; role: 'user'; content: Array<{ type: 'text'; text: string }>; source: { kind: string } }): void
  }
}

export class DesignSession {
  private readonly deps: DesignSessionDeps
  private handle: DesignHandle | undefined
  /** The "做一套皮肤" conversations started here (each its own session), kept alive while the brain runs. */
  private readonly skinHandles: DesignHandle[] = []
  /** What was clicked "+AI" on, said to the session each turn. */
  private focus = ''

  constructor(deps: DesignSessionDeps) {
    this.deps = deps
  }

  private get file(): string {
    return join(this.deps.home, 'design-session.json')
  }

  private recorded(): string | undefined {
    try {
      const id = (JSON.parse(readFileSync(this.file, 'utf8')) as { sessionId?: unknown }).sessionId
      return typeof id === 'string' ? id : undefined
    } catch {
      return undefined
    }
  }

  private setup = (agentCtx: ScopedContext) => this.prepare(agentCtx, () => (this.focus === '' ? PROMPT : `${PROMPT}\n\n用户这次点了"+AI"的是：${this.focus}。先读它，再问用户想怎么改（如果用户已经说了，就直接改）。`))

  /** Her design prompt and tools only (DSH's own tools hidden). */
  private prepare(agentCtx: ScopedContext, prompt: () => string): void {
    agentCtx.systemPrompt?.section({ name: 'dsh-her:design', order: 0, complete: true, interpolate: false, text: prompt })
    agentCtx.systemPrompt?.suppressRuntimeContext?.()
    try {
      const names = agentCtx.tools.schemas().map(schema => schema.name).filter(name => name !== 'run_code')
      if (names.length > 0) agentCtx.tools.restrict({ deny: names })
    } catch (error) {
      this.deps.logger.warn(`dsh-her: design session keeps DSH's tools (${(error as Error).message})`)
    }
    for (const tool of this.deps.tools()) agentCtx.tools.register(tool)
  }

  /**
   * "AI 做一套" on the 皮肤 page (§18): a new conversation each time, in her
   * workspace, where the AI asks one question at a time and then writes the
   * skin. Its first line is sent for you, so it opens already asking. `base`:
   * a skin of yours to change instead of a new one.
   */
  async startSkin(base?: { id: string; name: string }): Promise<string> {
    const services = this.deps.services()
    if (services === undefined) throw new Error('DSH 的 agents 服务还不可用')
    const edit = base === undefined ? '' : `\n\n这一次不是做新的，而是改用户已有的皮肤「${base.name}」（id ${base.id}）：先用 skin_get 读出来，用一两句话告诉他现在是什么样，再问他想改哪里（给编号选项：色系、深浅、强调色、装饰、字体、名字），改完用同一个 id 写回去。`
    const sessionId = `dsh-her-skin-${randomUUID()}`
    mkdirSync(this.deps.room, { recursive: true })
    const workspace = await services.workspaceRegistry?.create(this.deps.room, this.deps.title)
    const handle = await services.agents.create({
      sessionId, meta: { cwd: this.deps.room }, agentOptions: this.deps.route(),
      setup: (agentCtx: ScopedContext) => this.prepare(agentCtx, () => `${PROMPT}\n\n${SKIN_INTERVIEW}${edit}`),
    }) as DesignHandle
    this.skinHandles.push(handle)
    try {
      await workspace?.attachSession(sessionId)
      services.sessionTitle?.rename(handle.agent.session, base === undefined ? '做一套皮肤（+AI）' : `改皮肤「${base.name}」（+AI）`)
    } catch (error) {
      this.deps.logger.warn(`dsh-her: skin session not attached/titled (${(error as Error).message})`)
    }
    const first = base === undefined ? '帮我做一套新皮肤，一步一步问我。' : `帮我改一改皮肤「${base.name}」。`
    handle.agent.followup?.({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: first }], source: { kind: 'dsh-her-design' } })
    this.deps.logger.info(`dsh-her: started a skin conversation (${sessionId})`)
    return sessionId
  }

  /** The session, ready (made the first time, resumed after); its id to open in dsh. */
  async open(focus: string): Promise<string> {
    this.focus = focus.slice(0, 300)
    const services = this.deps.services()
    if (services === undefined) throw new Error('DSH 的 agents 服务还不可用')
    const route = this.deps.route()
    const recorded = this.recorded()
    if (this.handle !== undefined && recorded !== undefined) return recorded
    if (recorded !== undefined) {
      try {
        this.handle = await services.agents.resume({ resumeSessionId: recorded, agentOptions: route, setup: this.setup }) as DesignHandle
        return recorded
      } catch (error) {
        this.deps.logger.warn(`dsh-her: design session not resumed (${(error as Error).message}); making a new one`)
      }
    }
    const sessionId = `dsh-her-design-${randomUUID()}`
    mkdirSync(this.deps.room, { recursive: true })
    const workspace = await services.workspaceRegistry?.create(this.deps.room, this.deps.title)
    this.handle = await services.agents.create({ sessionId, meta: { cwd: this.deps.room }, agentOptions: route, setup: this.setup }) as DesignHandle
    try {
      await workspace?.attachSession(sessionId)
      services.sessionTitle?.rename(this.handle!.agent.session, '设计（+AI）')
    } catch (error) {
      this.deps.logger.warn(`dsh-her: design session not attached/titled (${(error as Error).message})`)
    }
    writeFileSync(this.file, `${JSON.stringify({ sessionId })}\n`)
    this.deps.logger.info(`dsh-her: made the design session (${sessionId})`)
    return sessionId
  }
}
