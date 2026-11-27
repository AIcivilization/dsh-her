/**
 * 真人桌宠's settings window (docs/独立安装包设计.md §6): who she is now and
 * the others, a 设计包 looked at before it is put in, where she shows and how
 * big, her quiet hours, and what this app is. With nobody yet the whole page
 * is the place to drop her 设计包.
 *
 * Everything shown comes from the main process as one view; every button
 * asks for a change and draws the view that comes back.
 */

import type { PetBridge } from '../main/preload-settings.ts'
import type { PetView } from '../main/standalone.ts'

declare global {
  interface Window { pet: PetBridge }
}

type Child = Node | string | false | undefined | null
/** A DOM node: tag, attributes (`on*` are listeners, `class` and the rest are set), children. Text is always text. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener)
    else if (key === 'class') node.className = String(value)
    else if (key in node) (node as unknown as Record<string, unknown>)[key] = value
    else node.setAttribute(key, String(value))
  }
  for (const child of children) if (child !== false && child !== undefined && child !== null) node.append(child)
  return node
}

const page = document.getElementById('page')!
let busy = false

/** Ask the main process for a change and draw what comes back; one at a time. */
async function ask(work: () => Promise<PetView>): Promise<void> {
  if (busy) return
  busy = true
  document.body.style.cursor = 'progress'
  try {
    draw(await work())
  } finally {
    busy = false
    document.body.style.cursor = ''
  }
}

const clock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const minutesOf = (value: string): number | undefined => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  return match === null ? undefined : Number(match[1]) * 60 + Number(match[2])
}
const megabytes = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

function row(title: string, note: string | undefined, control: Child): HTMLElement {
  return h('div', { class: 'row' }, h('div', { class: 'grow' }, title, note === undefined ? undefined : h('small', {}, note)), control)
}

const check = (checked: boolean, change: (on: boolean) => void, disabled = false): HTMLInputElement =>
  h('input', { type: 'checkbox', checked, disabled, onchange: (event: Event) => change((event.target as HTMLInputElement).checked) })

/** A place to drop a 设计包, and a button for those who would rather choose. */
function dropZone(title: string, note: string): HTMLElement {
  const zone = h('div', { class: 'drop' },
    h('b', {}, title),
    h('div', { class: 'note' }, note),
    h('div', { style: 'margin-top:14px' }, h('button', { class: 'main', onclick: () => void ask(() => window.pet.pick()) }, '选一个文件…')),
  )
  zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('over') })
  zone.addEventListener('dragleave', () => zone.classList.remove('over'))
  zone.addEventListener('drop', event => {
    event.preventDefault()
    zone.classList.remove('over')
    const file = event.dataTransfer?.files[0]
    if (file !== undefined) void ask(() => window.pet.drop(file))
  })
  return zone
}

/** A 设计包 looked at: who made it and under what licence come first; nothing is in until "装进来". */
function pendingView(view: PetView): Child[] {
  const p = view.pending!
  const m = p.manifest
  const materials = Object.values(p.materials).reduce((n, count) => n + count, 0)
  const inside = [
    p.character === undefined ? undefined : `人物「${p.character.name}」${p.character.lines === undefined ? '' : `，带 ${p.character.lines} 句写好的台词`}`,
    p.stage === undefined ? undefined : `编排：${p.stage.scenes} 个场景`,
    materials === 0 ? undefined : `${materials} 个素材（${megabytes(p.bytes)}）`,
    p.intro === undefined ? undefined : `开机动画「${p.intro.name}」`,
  ].filter((line): line is string => line !== undefined)
  return [
    h('h1', {}, `设计包：${m.name}`),
    p.cover === undefined ? undefined : h('img', { class: 'cover', src: p.cover, alt: '' }),
    h('div', { class: 'card' },
      row('作者', undefined, m.author),
      row('许可', '装之前请看清：这是作者允许你怎么用它', h('span', { class: 'licence' }, m.license)),
      row('版本', undefined, m.version),
      m.homepage === undefined ? undefined : row('主页', undefined, h('small', {}, m.homepage)),
    ),
    m.description === undefined ? undefined : h('p', { class: 'note' }, m.description),
    h('h2', {}, '里面有'),
    h('div', { class: 'card' }, h('ul', {}, ...inside.map(line => h('li', {}, line)))),
    p.character === undefined ? h('div', { class: 'warn' }, '这个设计包里没有人物：只会把素材放进来，她不会出现。') : h('p', { class: 'note' }, `「${p.character.persona}…」`),
    p.skin === undefined ? undefined : h('p', { class: 'note' }, `里面的皮肤「${p.skin.name}」不会装：皮肤是给 dsh 的界面用的。`),
    p.newer === undefined ? undefined : h('div', { class: 'warn' }, `它是给更新的版本（${p.newer}）做的，有些东西这一版可能显示不出来。`),
    p.problems.length === 0 ? undefined : h('div', { class: 'warn' }, '要注意：', h('ul', {}, ...p.problems.map(line => h('li', {}, line)))),
    p.skipped.length === 0 ? undefined : h('p', { class: 'note' }, `没收的文件：${p.skipped.join('、')}`),
    h('p', { class: 'note' }, '装进来是多一个人物，不会覆盖已有的。'),
    h('div', { class: 'buttons' },
      h('button', { onclick: () => void ask(() => window.pet.dismiss()) }, '不装'),
      h('button', { class: 'main', onclick: () => void ask(() => window.pet.install()) }, '装进来'),
    ),
  ]
}

function settingsView(view: PetView): Child[] {
  const s = view.settings
  const quiet = (key: 'quietFrom' | 'quietTo') => h('input', {
    type: 'time', value: clock(s[key]),
    onchange: (event: Event) => {
      const minutes = minutesOf((event.target as HTMLInputElement).value)
      if (minutes !== undefined) void ask(() => window.pet.set({ [key]: minutes }))
    },
  })
  const scale = h('select', { onchange: (event: Event) => void ask(() => window.pet.set({ petScale: Number((event.target as HTMLSelectElement).value) })) },
    ...([['小', 0.7], ['中', 1], ['大', 1.3], ['特大', 1.6]] as const).map(([label, value]) => h('option', { value: String(value), selected: Math.abs(view.petScale - value) < 0.05 }, label)))
  return [
    h('h1', {}, view.character?.name ?? view.app.name),
    h('h2', {}, '现在是谁'),
    h('div', { class: 'card' },
      ...view.characters.map(c => row(c.name, c.line === '' ? undefined : c.line, c.active
        ? h('span', { class: 'tag' }, '现在是她')
        : h('span', {},
          h('button', { class: 'plain', onclick: () => void ask(() => window.pet.use(c.cid)) }, '换成她'),
          h('button', { class: 'plain', onclick: () => { if (confirm(`移走「${c.name}」？\n不会删除，她会被放进数据文件夹里的 characters/.removed。`)) void ask(() => window.pet.remove(c.cid)) } }, '移走'),
        ))),
      row('再装一个设计包', '.her 或 .zip；也可以直接把文件拖进这个窗口', h('button', { onclick: () => void ask(() => window.pet.pick()) }, '选文件…')),
    ),
    h('h2', {}, '住在哪'),
    h('div', { class: 'card' },
      row('住在壁纸里', '在桌面图标的后面', check(view.places.wallpaper, on => void ask(() => window.pet.set({ wallpaper: on })))),
      row('浮在桌面上', '在所有窗口的上面，可以拖动、可以碰', check(view.places.overlay, on => void ask(() => window.pet.set({ overlay: on })))),
      row('大小', undefined, scale),
    ),
    h('h2', {}, '和她聊天'),
    h('div', { class: 'card' }, ...chatRows(view)),
    h('h2', {}, '让她接活（实验）'),
    h('div', { class: 'card' }, ...loopRows(view)),
    h('h2', {}, '她的日子'),
    h('div', { class: 'card' },
      view.stage.has
        ? row('按编排来', '设计包里排好的：什么时候显示什么', check(view.stage.playing, on => void ask(() => window.pet.set({ stage: on }))))
        : row('编排', '这个设计包里没有编排，所以桌面上没有她的画面', undefined),
      row('安静时段', '开始的时候她会说一句晚安（设计包里写了的话）', h('span', {}, quiet('quietFrom'), ' 到 ', quiet('quietTo'))),
      view.introName === undefined ? undefined : row('开机动画', `「${view.introName}」`, h('span', {},
        h('select', { disabled: !view.intro.on, onchange: (event: Event) => void ask(() => window.pet.set({ introWhen: (event.target as HTMLSelectElement).value as 'every' | 'daily' })) },
          h('option', { value: 'daily', selected: view.intro.when === 'daily' }, '每天第一次'),
          h('option', { value: 'every', selected: view.intro.when === 'every' }, '每次出场')),
        ' ', check(view.intro.on, on => void ask(() => window.pet.set({ introOn: on }))))),
    ),
    view.stage.notes.length === 0 ? undefined : h('div', { class: 'warn' }, '编排里有放不出来的：', h('ul', {}, ...view.stage.notes.map(line => h('li', {}, line)))),
    h('p', { class: 'note' }, `碰她时说的话：${view.lines.touch ? '设计包里写好的' : '几句通用的'}；出场 ${view.lines.hello} 句，晚安 ${view.lines.night} 句。她现在不会聊天。`),
    h('h2', {}, '这个程序'),
    h('div', { class: 'card' },
      row('开机自动启动', view.app.packaged ? undefined : '开发版里不能设', check(view.app.autostart, on => void ask(() => window.pet.set({ autostart: on })), !view.app.packaged)),
      ...updateRows(view),
      row(`${view.app.name} ${view.app.version}`, `身体引擎：dsh-her。${view.loop.kind === 'bundled' ? `接活用的是 agent-autoloop ${view.loop.version}（MIT，作者 数字生命卡兹克）。` : ''}${view.chat.choice.kind === 'none' ? '不要账号、不要 key' : '聊天时只和你选的那一家说话'}${view.update.auto ? '；除此之外只每天看一次有没有新版' : ''}。`, h('button', { onclick: () => window.pet.quit() }, '退出')),
    ),
    view.designs.length === 0 ? undefined : h('h2', {}, '装过的设计包'),
    view.designs.length === 0 ? undefined : h('div', { class: 'card' },
      ...view.designs.map(d => row(`${d.name} ${d.version}`, `作者：${d.author} · 许可：${d.license}${d.homepage === undefined ? '' : ` · ${d.homepage}`}`, undefined))),
  ]
}

/**
 * Talking with her (src/standalone/pet-chat.ts): which brain, its key, her
 * voice. A key typed here goes straight to where keys are kept (the keychain
 * on a Mac); the field is emptied and never shows it again.
 */
function chatRows(view: PetView): HTMLElement[] {
  const chat = view.chat
  const choice = chat.choice
  const set = (next: typeof choice) => void ask(() => window.pet.set({ brain: next }))
  const pick = h('select', {
    onchange: (event: Event) => {
      const kind = (event.target as HTMLSelectElement).value
      set(kind === 'claude-code' ? { kind: 'claude-code' } : kind === 'api-key' ? { kind: 'api-key' } : { kind: 'none' })
    },
  },
  h('option', { value: 'none', selected: choice.kind === 'none' }, '不聊天'),
  h('option', { value: 'claude-code', selected: choice.kind === 'claude-code' }, `Claude Code${chat.claude ? '' : '（没找到）'}`),
  h('option', { value: 'api-key', selected: choice.kind === 'api-key' }, 'DeepSeek 或别的 API key'))
  const rows: HTMLElement[] = [row('她用谁的脑子', choice.kind === 'none' ? '选一个，她就能和你聊天了；不选也能当桌宠' : undefined, pick)]
  if (choice.kind === 'claude-code') {
    rows.push(row('Claude Code', chat.claude
      ? '用这台电脑上已经登录的 Claude Code。它的工具都关掉了，她只能聊天，碰不到你的文件'
      : '这台电脑上没找到 claude。先装好 Claude Code 并登录，再回来选', undefined))
    const model = h('select', { onchange: (event: Event) => { const m = (event.target as HTMLSelectElement).value; set(m === '' ? { kind: 'claude-code' } : { kind: 'claude-code', model: m }) } },
      ...([['', 'Claude Code 自己的默认'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku（快、省）'], ['opus', 'Opus']] as const).map(([value, label]) => h('option', { value, selected: (choice.model ?? '') === value }, label)))
    rows.push(row('模型', undefined, model))
  }
  if (choice.kind === 'api-key') {
    const text = (value: string, placeholder: string, save: (v: string) => void) => h('input', {
      type: 'text', value, placeholder, style: 'width:190px', class: 'field',
      onchange: (event: Event) => save((event.target as HTMLInputElement).value.trim()),
    })
    rows.push(row('服务地址', '兼容 OpenAI 接口的都行；不填就是 DeepSeek', text(choice.base ?? '', 'https://api.deepseek.com/v1', v => set({ kind: 'api-key', ...(v === '' ? {} : { base: v }), ...(choice.model === undefined ? {} : { model: choice.model }) }))))
    rows.push(row('模型', undefined, text(choice.model ?? '', 'deepseek-chat', v => set({ kind: 'api-key', ...(choice.base === undefined ? {} : { base: choice.base }), ...(v === '' ? {} : { model: v }) }))))
    const key = h('input', { type: 'password', placeholder: chat.key ? '已经存好了（填新的就换掉）' : 'sk-…', style: 'width:190px', autocomplete: 'off' })
    rows.push(row('API key', '存在系统钥匙串里（Windows：只有你能读的文件），不会写进她的文件，也不会发到别处', h('span', { style: 'display:flex;gap:6px' },
      key,
      h('button', { onclick: () => { const value = key.value; key.value = ''; if (value.trim() !== '') void ask(() => window.pet.setKey(value)) } }, '保存'),
      chat.key ? h('button', { class: 'plain', onclick: () => { if (confirm('删掉存着的 API key？')) void ask(() => window.pet.setKey('')) } }, '删掉') : undefined)))
  }
  if (choice.kind !== 'none') {
    rows.push(row('她出声', '微软 Edge 的声音，要联网；第一次用时会自己装一个小工具，装好之前她只出字', check(chat.voice, on => void ask(() => window.pet.set({ voice: on })))))
    rows.push(row('和她说话', `${navigator.platform.startsWith('Mac') ? '⌃⌥↩' : 'Ctrl+Alt+Enter'}，或双击她。这一版只能打字，还听不见`, h('button', { onclick: () => window.pet.talk() }, '打开对话条')))
    rows.push(row('用的是你自己的账号', '她每说一句都算在你的 Claude 或 API 账号上。各家更建议经常自动用的场合用 API key；个人订阅的额度主要是给人自己用的', undefined))
  }
  return rows
}

/**
 * The loop she lives by (src/standalone/autoloop.ts): agent-autoloop, the
 * user's own when they run one, else the copy that comes with the app.
 */
function loopRows(view: PetView): HTMLElement[] {
  const loop = view.loop
  const status = !loop.on ? '关着。打开以后，她用 agent-autoloop 在后台接活、跟进，拿不准才来问你（还在做，现在只是把它启动起来）'
    : loop.kind === 'own' ? `用的是你自己装的 agent-autoloop（${loop.url}）`
      : loop.kind === 'bundled' ? `用的是自带的 agent-autoloop ${loop.version}${loop.running ? '，在运行' : '，没在运行'}；数据在她自己的文件夹里，不碰 ~/.agent-autoloop`
        : loop.kind === 'none' ? loop.why : '正在启动…'
  const rows = [row('让她接活', status, check(loop.on, on => void ask(() => window.pet.set({ loop: on }))))]
  if (loop.kind === 'bundled' && loop.ownAppeared) {
    rows.push(row('你自己也装了 agent-autoloop', '一台电脑上跑一份就够了。要改用你自己装的那份吗？自带的那份会停掉', h('span', { style: 'display:flex;gap:6px' },
      h('button', { class: 'main', onclick: () => void ask(() => window.pet.set({ loopUse: 'own' })) }, '改用我的'),
      h('button', { onclick: () => void ask(() => window.pet.set({ loopUse: 'bundled' })) }, '还用自带的'))))
  }
  return rows
}

const when = (at: number): string => {
  const d = new Date(at)
  const today = new Date().toDateString() === d.toDateString()
  return `${today ? '今天' : `${d.getMonth() + 1} 月 ${d.getDate()} 日`} ${clock(d.getHours() * 60 + d.getMinutes())}`
}

/** Updates (docs/独立安装包设计.md, decision 6): the daily look, a newer version, going back. */
function updateRows(view: PetView): HTMLElement[] {
  const u = view.update
  const rows: HTMLElement[] = []
  const status = u.progress !== undefined
    ? `正在下载 ${megabytes(u.progress.done)} / ${megabytes(u.progress.total)}，下完会核对，然后重新打开`
    : u.available !== undefined
      ? `有新版本 ${u.available.version}（${megabytes(u.available.size)}）`
      : u.checkedAt === undefined
        ? '还没看过'
        : `${u.latest !== undefined && u.error === undefined ? '已经是最新的' : '没看成'}（${when(u.checkedAt)}看的）`
  rows.push(row('每天看一次有没有新版', status, check(u.auto, on => void ask(() => window.pet.set({ autoUpdate: on })))))
  if (u.error !== undefined && u.progress === undefined) rows.push(row('上次没成', u.error, undefined))
  const buttons: HTMLElement[] = [h('button', { disabled: u.busy, onclick: () => void ask(() => window.pet.checkUpdate()) }, '现在看看')]
  if (u.available !== undefined) {
    buttons.push(h('button', {
      class: 'main', disabled: u.busy || u.cannot !== undefined,
      onclick: () => { if (confirm(`下载 ${u.available!.version} 并换上？\n大约 ${megabytes(u.available!.size)}。换好以后会自己重新打开，她和设置都还在。`)) void ask(() => window.pet.getUpdate()) },
    }, `更新到 ${u.available.version}`))
  }
  rows.push(row('更新', u.cannot, h('span', { style: 'display:flex;gap:6px' }, ...buttons)))
  if (u.previous !== undefined) {
    rows.push(row(`上一版 ${u.previous.version}`, '新版本用着不对，可以退回去', h('button', {
      disabled: u.busy || u.cannot !== undefined,
      onclick: () => { if (confirm(`退回 ${u.previous!.version}？会重新打开。`)) void ask(() => window.pet.goBack()) },
    }, '退回')))
  }
  return rows
}

function draw(view: PetView): void {
  document.title = view.character === undefined ? view.app.name : `${view.character.name} · ${view.app.name}`
  const parts: Child[] = []
  if (view.app.translocated) parts.push(h('div', { class: 'warn' }, `请先退出，把「${view.app.name}」拖进"应用程序"文件夹，再从那里打开。现在这样打开，下次可能找不到她。`))
  if (view.error !== undefined) parts.push(h('div', { class: 'warn bad' }, view.error))
  if (view.pending !== undefined) parts.push(...pendingView(view))
  else if (view.empty) {
    parts.push(
      h('h1', {}, view.app.name),
      dropZone('把她的设计包拖进来', '和这个程序一起收到的 .her 文件（或 .zip）。装之前会先给你看里面有什么。'),
      h('p', { class: 'note' }, '还没有人物，所以桌面上现在什么都没有。'),
      h('h2', {}, `${view.app.name} ${view.app.version}`),
      h('div', { class: 'card' }, ...updateRows(view)),
      h('div', { class: 'buttons' }, h('button', { onclick: () => window.pet.quit() }, '退出')),
    )
  } else parts.push(...settingsView(view))
  page.replaceChildren(...parts.filter((part): part is Node | string => part !== false && part !== undefined && part !== null))
}

// A 设计包 dropped anywhere on the window is looked at, whatever the page shows.
window.addEventListener('dragover', event => event.preventDefault())
window.addEventListener('drop', event => {
  event.preventDefault()
  const file = event.dataTransfer?.files[0]
  if (file !== undefined) void ask(() => window.pet.drop(file))
})
// Something changed outside the window (the tray, a file, a download moving along): drawn even while a click is still being answered.
window.pet.onChanged(() => void window.pet.state().then(draw))
void ask(() => window.pet.state())
