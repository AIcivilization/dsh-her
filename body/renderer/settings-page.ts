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
    h('h2', {}, '她的日子'),
    h('div', { class: 'card' },
      view.stage.has
        ? row('按编排来', '设计包里排好的：什么时候显示什么', check(view.stage.playing, on => void ask(() => window.pet.set({ stage: on }))))
        : row('编排', '这个设计包里没有编排，所以桌面上没有她的画面', undefined),
      row('安静时段', '开始的时候她会说一句晚安（设计包里写了的话）', h('span', {}, quiet('quietFrom'), ' 到 ', quiet('quietTo'))),
      view.intro.source === 'skin' ? undefined : row('开机动画', `「${view.intro.source}」`, h('span', {},
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
      row(`${view.app.name} ${view.app.version}`, '身体引擎：dsh-her。不要账号、不要 key，不联网。', h('button', { onclick: () => window.pet.quit() }, '退出')),
    ),
    view.designs.length === 0 ? undefined : h('h2', {}, '装过的设计包'),
    view.designs.length === 0 ? undefined : h('div', { class: 'card' },
      ...view.designs.map(d => row(`${d.name} ${d.version}`, `作者：${d.author} · 许可：${d.license}${d.homepage === undefined ? '' : ` · ${d.homepage}`}`, undefined))),
  ]
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
window.pet.onChanged(() => void ask(() => window.pet.state()))
void ask(() => window.pet.state())
