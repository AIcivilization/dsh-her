/**
 * The pose-graph director (docs/外形包与姿势图.md §3): which clip plays next.
 *
 * Anchors are nodes, clips are edges; a loop clip starts and ends at the same
 * anchor. The director knows where she is and what is wanted:
 * - a state (idle, listen, think, talk, sleep): loops at the current anchor,
 *   taking turns between that state's variants there (never the same one
 *   twice running); idle when the pack has none for that state there, unless
 *   another anchor has it (then she goes there). Off screen she does not
 *   stay: any state brings her back to the start pose.
 * - one-shot requests, first come first served: an action (a loop clip, or a
 *   macro: walk to an anchor then maybe play an action), an emotion, a stored
 *   line. Reaching a request's anchor walks the shortest path (by duration).
 *   Only macros may pass off screen (that is where outfits change): a plain
 *   action or emotion the current outfit cannot reach on screen is skipped,
 *   so a wave never turns into a change of clothes.
 *
 * No DOM and no timing here: the player asks `next()` when a clip is about to
 * end and calls `done()` when a request's last clip has finished.
 */

export interface GraphClip {
  id: string
  from: string
  to: string
  role: 'state' | 'emotion' | 'action' | 'transition' | 'line'
  name: string
  interruptible: boolean
  durationMs: number
}

export interface Macro {
  action: string
  goTo: string
  then?: string
  /** No clip leads there: cut (crossfade) straight to the anchor's loop. */
  jump?: boolean
}

interface Request {
  kind: 'action' | 'emotion'
  name: string
  /** For a macro: the anchor to reach, then the action to play there (if any). */
  goTo?: string
  then?: string
  jump?: boolean
  settle: (result: { ok: boolean; reason?: string }) => void
  /** The clip that completes the request once it has played. */
  last?: string
}

export class Director<C extends GraphClip = GraphClip> {
  private anchor: string
  private state = 'idle'
  private readonly requests: Request[] = []
  private lastLoop: string | undefined
  private readonly clips: C[]
  private readonly macros: Map<string, Macro>
  readonly start: string

  constructor(clips: C[], macros: Macro[], start: string) {
    this.clips = clips
    this.macros = new Map(macros.map(m => [m.action, m]))
    this.start = start
    this.anchor = start
  }

  get at(): string {
    return this.anchor
  }

  get wanted(): string {
    return this.state
  }

  /** Is anything requested (and not yet on its way out) that should cut an interruptible loop short? */
  get urgent(): boolean {
    return this.requests.some(r => r.last === undefined)
  }

  setState(state: string): void {
    this.state = state
  }

  /** Does the pack have a way to do this action (a loop clip, a macro, or a stored line)? */
  canDo(action: string): boolean {
    return this.macros.has(action) || this.clips.some(c => (c.role === 'action' || c.role === 'line') && c.name === action)
  }

  hasEmotion(emotion: string): boolean {
    return this.clips.some(c => c.role === 'emotion' && c.name === emotion)
  }

  /** Queue an action; resolves when it has been played (or could not be). */
  act(action: string): Promise<{ ok: boolean; reason?: string }> {
    return new Promise(settle => {
      const macro = this.macros.get(action)
      if (macro !== undefined) {
        this.requests.push({ kind: 'action', name: action, goTo: macro.goTo, ...(macro.then === undefined ? {} : { then: macro.then }), ...(macro.jump === true ? { jump: true } : {}), settle })
      } else if (this.canDo(action)) {
        this.requests.push({ kind: 'action', name: action, settle })
      } else {
        settle({ ok: false, reason: 'unsupported' })
      }
    })
  }

  /** Show an emotion once, if the pack has it (otherwise nothing happens). */
  emote(emotion: string): void {
    if (!this.hasEmotion(emotion)) return
    // A newer emotion replaces one still waiting.
    const waiting = this.requests.findIndex(r => r.kind === 'emotion')
    if (waiting >= 0) this.requests.splice(waiting, 1)[0]!.settle({ ok: false, reason: 'replaced' })
    this.requests.push({ kind: 'emotion', name: emotion, settle: () => {} })
  }

  /** Drop every waiting request (she was cut off). */
  clear(reason = 'interrupted'): void {
    for (const request of this.requests.splice(0)) request.settle({ ok: false, reason })
  }

  /**
   * The clip to play next, from the current anchor. A request whose last clip
   * has been handed out waits for `played()` and yields no more clips; the
   * player asks for the next clip before the current one has finished.
   */
  next(): C {
    for (let i = 0; i < this.requests.length;) {
      const request = this.requests[i]!
      if (request.last !== undefined) {
        i++
        continue
      }
      // Already where a macro leads, with nothing to play there: done.
      if (request.goTo === this.anchor && request.then === undefined) {
        this.requests.splice(i, 1)[0]!.settle({ ok: true })
        continue
      }
      const step = this.stepFor(request)
      if (step !== undefined) return this.take(step)
      // No way there from here: give up on it.
      this.requests.splice(i, 1)[0]!.settle({ ok: false, reason: 'unreachable' })
    }
    return this.take(this.stateClip())
  }

  /** A clip left the screen: settles the request it completed, if any (not ok if it was cut short). */
  played(clip: GraphClip, finished = true): void {
    const i = this.requests.findIndex(r => r.last === clip.id)
    if (i < 0) return
    this.requests.splice(i, 1)[0]!.settle(finished ? { ok: true } : { ok: false, reason: 'interrupted' })
  }

  private take(clip: C): C {
    this.anchor = clip.to
    if (clip.from === clip.to) this.lastLoop = clip.id
    return clip
  }

  /** The next clip toward a request, marking the clip that completes it. */
  private stepFor(request: Request): C | undefined {
    if (request.goTo !== undefined && this.anchor !== request.goTo) {
      const path = this.path(this.anchor, a => a === request.goTo, true)
      if ((path === undefined || path.length === 0) && request.jump === true) {
        const loop = this.clips.find(c => c.from === request.goTo && c.to === request.goTo && c.role === 'state' && c.name === 'idle')
          ?? this.clips.find(c => c.from === request.goTo && c.to === request.goTo)
        if (loop !== undefined && request.then === undefined) request.last = loop.id
        return loop
      }
      if (path === undefined || path.length === 0) return undefined
      const step = path[0]!
      // Arriving with nothing to play there completes the macro.
      if (step.to === request.goTo && request.then === undefined) request.last = step.id
      return step
    }
    const name = request.goTo !== undefined ? request.then : request.name
    if (name === undefined) return undefined
    const role = request.kind === 'emotion' ? 'emotion' : undefined
    const match = (c: C) => c.name === name && (role === undefined ? c.role === 'action' || c.role === 'line' : c.role === role)
    const here = this.pick(this.clips.filter(c => c.from === this.anchor && match(c)))
    if (here !== undefined) {
      request.last = here.id
      return here
    }
    // A macro's last part may still need its trip off screen; a plain action stays on screen.
    const path = this.path(this.anchor, a => this.clips.some(c => c.from === a && match(c)), request.goTo !== undefined)
    return path?.[0]
  }

  private stateClip(): C {
    if (this.anchor === 'off' || !this.clips.some(c => c.from === this.anchor && c.to === this.anchor)) {
      const back = this.path(this.anchor, a => a === this.start, true)?.[0]
      if (back !== undefined) return back
    }
    const loops = (anchor: string, name: string) => this.clips.filter(c => c.from === anchor && c.to === anchor && c.role === 'state' && c.name === name)
    // The wanted state is somewhere else (she sleeps at another place): walk there, or cut there if no clip leads.
    if (loops(this.anchor, this.state).length === 0) {
      const elsewhere = this.clips.find(c => c.role === 'state' && c.name === this.state && c.from === c.to && c.from !== 'off')?.from
      if (elsewhere !== undefined) return this.path(this.anchor, a => a === elsewhere)?.[0] ?? this.pick(loops(elsewhere, this.state))!
      // No idle where she is (a place only for sleeping): back to where she started.
      if (loops(this.anchor, 'idle').length === 0 && loops(this.start, 'idle').length > 0) {
        return this.path(this.anchor, a => a === this.start)?.[0] ?? this.pick(loops(this.start, 'idle'))!
      }
    }
    // Variants of the same state at the same place take turns, so a few seconds of video read as one long take;
    // a different state, place, action or look only comes when asked.
    const pool = loops(this.anchor, this.state)
    const chosen = this.pick(pool.length > 0 ? pool : loops(this.anchor, 'idle'))
      ?? this.pick(this.clips.filter(c => c.from === this.anchor && c.to === this.anchor))
    if (chosen === undefined) throw new Error(`no clip to play at ${this.anchor}`)
    return chosen
  }

  /** Random, avoiding the loop just played when there is a choice. */
  private pick(pool: C[]): C | undefined {
    const options = pool.length > 1 ? pool.filter(c => c.id !== this.lastLoop) : pool
    return options[Math.floor(Math.random() * options.length)]
  }

  /** Shortest path (by duration) over transitions to the first anchor accepted by `goal`; through `off` only if allowed. */
  private path(from: string, goal: (anchor: string) => boolean, viaOff = false): C[] | undefined {
    if (goal(from)) return []
    const best = new Map<string, { cost: number; path: C[] }>([[from, { cost: 0, path: [] }]])
    const open = [from]
    while (open.length > 0) {
      open.sort((a, b) => best.get(a)!.cost - best.get(b)!.cost)
      const anchor = open.shift()!
      const here = best.get(anchor)!
      if (goal(anchor)) return here.path
      for (const edge of this.clips.filter(c => c.role === 'transition' && c.from === anchor && (viaOff || c.to !== 'off'))) {
        const cost = here.cost + edge.durationMs
        if ((best.get(edge.to)?.cost ?? Infinity) <= cost) continue
        best.set(edge.to, { cost, path: [...here.path, edge] })
        open.push(edge.to)
      }
    }
    return undefined
  }
}
