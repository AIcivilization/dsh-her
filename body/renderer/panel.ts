/**
 * The body's settings window, from her right-click menu: who she is (人设)
 * and what she remembers (她记得的事) come from the brain (`panel`) and every
 * change goes back to it (`panel.set`); what each clip of her look is used
 * for (画面) is the body's own, read and saved through main. The "她" page in
 * dsh has the rest (voice, model …).
 */

import type { PanelCharacter, PanelMemory } from '../../src/protocol/index.ts'
import { fitScene, SCREEN_SHAPES, shapeName } from '../shared/fit.ts'
import type { ClipUse, ClipsView, ScreenInfo } from '../shared/types.ts'

type Tab = 'persona' | 'memory' | 'clips' | 'scene'
type Panel = { character: PanelCharacter; memory: PanelMemory; error?: string }

const content = document.getElementById('content')!
const query = new URLSearchParams(location.search)
const asked = query.get('tab')
let tab: Tab = asked === 'memory' || asked === 'clips' || asked === 'scene' ? asked : 'persona'
let clips: ClipsView | undefined

const USES: Array<[ClipUse, string]> = [
  ['idle', '待机（同类的轮流播）'], ['listen', '听你说话'], ['talk', '她说话'], ['think', '她在想'],
  ['shy', '害羞'], ['happy', '开心'], ['fall-asleep', '趴下睡着（进入睡觉）'], ['sleep', '睡着（循环）'], ['none', '不用'],
]
let panel: Panel | undefined
let note: { kind: 'saved' | 'error'; text: string } | undefined

const esc = (text: string) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const isToday = (at: string) => new Date(at).toDateString() === new Date().toDateString()

function ask(): void {
  void window.her.send({ t: 'panel.get', cid: '' })
}

function set(change: { character?: Partial<PanelCharacter>; forget?: string[]; confirm?: string[] }, saved: string): void {
  note = { kind: 'saved', text: saved }
  void window.her.send({ t: 'panel.set', cid: '', ...change })
}

function render(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('header button')) button.classList.toggle('on', button.dataset.tab === tab)
  if (tab === 'clips') {
    renderClips()
    return
  }
  if (tab === 'scene') {
    if (scene.dir !== undefined && scene.photo === undefined && note === undefined) {
      void window.her.scenePhotoIn(scene.dir).then(result => {
        if (result.ok && result.photo !== undefined) scene.photo = result.photo
        else note = { kind: 'error', text: result.message ?? '找不到照片' }
        render()
      })
      return
    }
    if (screens === undefined) {
      void window.her.screens().then(list => { screens = list; renderScene() }, () => { screens = []; renderScene() })
      return
    }
    renderScene()
    return
  }
  if (panel === undefined) return
  const status = note === undefined ? '' : `<p class="${note.kind}">${esc(note.text)}</p>`
  content.innerHTML = tab === 'persona' ? personaHtml(panel.character) + status : status + memoryHtml(panel.memory)
}

function personaHtml(c: PanelCharacter): string {
  const pronoun = (p: string) => `<option${c.pronoun === p ? ' selected' : ''}>${p}</option>`
  return `<div class="card">
    <div class="row">
      <div><label>她的名字</label><input id="name" value="${esc(c.name)}"></div>
      <div><label>她怎么称呼你</label><input id="callYou" value="${esc(c.callYou)}" placeholder="比如：阿文"></div>
      <div class="narrow"><label>提到你时用</label><select id="pronoun">${['他', '她', 'TA'].map(pronoun).join('')}</select></div>
    </div>
    <label>人设（她是谁、怎么说话、和你是什么关系）</label>
    <textarea id="persona">${esc(c.persona)}</textarea>
    <button class="primary" id="save">保存</button>
    <p class="hint">保存后从她的下一句话开始生效。让模型帮你写人设、先试聊几句，在 dsh 的"她"页面 → 设置 → 人设。</p>
  </div>`
}

function memoryHtml(m: PanelMemory): string {
  const facts = [...m.facts].reverse().map(f => `<li><span class="grow">${esc(f.text)}</span>
    ${isToday(f.createdAt) ? '<span class="tag ok">今天</span>' : ''}
    ${f.status === 'candidate' ? '<span class="tag warn">待确认</span>' : ''}
    ${f.sensitive ? '<span class="tag bad">敏感</span>' : ''}
    ${f.status === 'candidate' ? `<button class="small" data-confirm="${f.id}">确认</button>` : ''}
    <button class="small" data-forget="${f.id}" data-text="${esc(f.text)}">忘掉</button></li>`).join('')
  const episodes = [...m.episodes].reverse().map(e => `<li><span class="muted">${e.at.slice(5, 10)}</span><span class="grow">${esc(e.text)}</span>
    ${isToday(e.at) ? '<span class="tag ok">今天</span>' : ''}
    ${e.due === undefined ? '' : `<span class="tag">${e.due}</span>`}
    <button class="small" data-forget="${e.id}" data-text="${esc(e.text)}">忘掉</button></li>`).join('')
  const none = '<li class="muted">还没有</li>'
  return `<div class="card"><h2>关于你（${m.facts.length}）</h2>
      <p class="hint">她聊天时自己记下的直接生效；聊完一分钟后她会把刚才的话过一遍，挑出来的先"待确认"。</p>
      <ul>${facts || none}</ul></div>
    <div class="card"><h2>事件（${m.episodes.length}）</h2><ul>${episodes || none}</ul></div>
    <div class="card"><h2>她的日记（${m.diary.length} 天）</h2><p>${m.diary.length === 0 ? '<span class="muted">还没有</span>' : m.diary.join('、')}</p>
      <p class="hint">日记的内容、导出，在 dsh 的"她"页面 → 她记得的事。</p></div>`
}

function renderClips(): void {
  if (clips === undefined) {
    content.innerHTML = '<p class="muted">正在读素材……</p>'
    void window.her.clips().then(view => { clips = view; if (tab === 'clips') renderClips() })
    return
  }
  const status = note === undefined ? '' : `<span class="${note.kind}">${esc(note.text)}</span>`
  const head = clips.editable
    ? `<div class="bar"><button class="primary" id="save-clips">保存</button>${status}</div>
       <p class="hint">「${esc(clips.name)}」的每一段用在哪里，由你来定。同一类的几段会轮流播，像一段长镜头；"趴下睡着"在你 10 分钟没理她时播一次，接着播"睡着"；你一开口或点她就醒。鼠标移到画面上预览。</p>`
    : `<p class="hint">「${esc(clips.name)}」是导入的外形包，片段的用途由文件名决定（见 docs/素材生成提示词.md），这里只能看。</p>`
  const cards = clips.clips.map(c => `<div class="clip${c.use === 'none' ? ' off' : ''}">
      <video src="${esc(c.url)}" muted loop preload="metadata"></video>
      ${clips!.editable ? `<select data-use="${c.id}">${USES.map(([value, label]) => `<option value="${value}"${value === c.use ? ' selected' : ''}>${label}</option>`).join('')}</select>
      <input data-desc="${c.id}" value="${esc(c.desc)}" placeholder="说明（可不填）">` : `<div class="meta">${esc(c.desc)}</div>`}
      <div class="meta">${c.id} · ${(c.durationMs / 1000).toFixed(1)} 秒</div>
    </div>`).join('')
  content.innerHTML = `${head}<div class="clips">${cards}</div>`
  for (const video of content.querySelectorAll('video')) {
    video.addEventListener('mouseenter', () => void video.play())
    video.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0 })
  }
}

/** 做场景: the photo chosen, her region on it (photo pixels), and the shape the box keeps. */
const scene: { photo?: { path: string; url: string; width: number; height: number }; region?: { x: number; y: number; width: number; height: number }; shape: number; name: string; saved?: string; dir?: string } = { shape: 0, name: '' }
// Opened from 形象工坊 on a scene folder: frame its photo, write the frame there.
const frameDir = query.get('dir') ?? undefined
if (frameDir !== undefined) Object.assign(scene, { dir: frameDir, name: query.get('name') ?? '', shape: 9 / 16 })
const SHAPES: Array<[number, string]> = [[0, '自由'], [1, '1:1 正方形'], [3 / 4, '3:4 竖'], [9 / 16, '9:16 竖'], [4 / 3, '4:3 横'], [16 / 9, '16:9 横']]
/** The screens, for advice on sizes (the main one first). */
let screens: ScreenInfo[] | undefined
const mainScreen = () => screens?.find(s => s.primary) ?? screens?.[0]
const pixels = (s: ScreenInfo) => ({ width: Math.round(s.width * s.scale), height: Math.round(s.height * s.scale) })

/** What the photo should be, for this screen. */
function photoAdvice(): string {
  const s = mainScreen()
  if (s === undefined) return '横版，和屏幕一样的比例，2560 宽以上'
  const px = pixels(s)
  return `横版，和你的屏幕一样的比例（${shapeName(s.width / s.height)}），最好 ${px.width}×${px.height}（你的屏幕的像素）`
}

/** How the region fares on the main screen and on common shapes, and what size to generate her clips at. */
function fitAdvice(photo: { width: number; height: number }, region: { x: number; y: number; width: number; height: number }): string {
  const scene = { width: photo.width, height: photo.height, region }
  const lines: string[] = []
  const s = mainScreen()
  if (s !== undefined) {
    const fit = fitScene(scene, s.width, s.height)
    const her = { width: Math.round(fit.region.width * s.scale), height: Math.round(fit.region.height * s.scale) }
    lines.push(fit.covers ? `<li class="saved">你的屏幕：铺满，她完整</li>` : `<li class="error">你的屏幕：铺满会裁到她，画面会缩小 ${Math.round((1 - fit.shrink) * 100)}%、边上模糊补齐</li>`)
    lines.push(`<li>她在你屏幕上约 ${her.width}×${her.height} 像素：生成视频选 ${her.height > 1300 ? '1080P' : '720P 或以上'}</li>`)
    const enlarge = (fit.scale * s.scale)
    if (enlarge > 1.35) lines.push(`<li class="error">照片铺满你的屏幕要放大 ${enlarge.toFixed(1)} 倍，会有点糊：可以先用 AI 放大</li>`)
  }
  const others = SCREEN_SHAPES.map(shape => {
    const shrink = fitScene(scene, shape.aspect * 1000, 1000).shrink
    return shrink >= 0.999 ? `${shape.name} ✓` : `${shape.name} 缩小 ${Math.round((1 - shrink) * 100)}%`
  })
  lines.push(`<li class="muted">其他屏幕：${others.join(' · ')}（框小一点、离照片上下边远一点，在更多屏幕上都能铺满）</li>`)
  return `<ul class="fit">${lines.join('')}</ul>`
}

function renderScene(): void {
  const intro = `<p class="hint">做一个自己的场景：一张全屏照片当桌面（场景里有她），框出她活动的那一块。之后只要用这一块去生成视频，视频贴回照片的这个位置，背景清晰不动，她在动。</p>`
  if (scene.photo === undefined) {
    content.innerHTML = `<div class="card">${intro}<ol class="steps">
      <li>先准备一张全屏照片：${photoAdvice()}。一个省事的办法：把场景图设成壁纸、截全屏，再把她合成进去。</li>
      <li>选好照片，框出她的活动范围（留够她动作的余量）。</li>
      <li>起个名字保存，会生成一个素材文件夹，里面有裁好的 crop.png。</li></ol>
      <button class="primary" id="scene-pick">选择全屏照片…</button></div>`
    return
  }
  const { photo, region } = scene
  const status = note === undefined ? '' : `<span class="${note.kind}">${esc(note.text)}</span>`
  const size = region === undefined ? '在照片上按住鼠标拖出一个框' : `人物区 ${Math.round(region.width)}×${Math.round(region.height)}（照片 ${photo.width}×${photo.height}）`
  content.innerHTML = `<div class="card">
    <div class="row">
      <div><label>框的形状</label><select id="scene-shape">${SHAPES.map(([value, label]) => `<option value="${value}"${value === scene.shape ? ' selected' : ''}>${label}</option>`).join('')}</select></div>
      <div><label>场景名字</label><input id="scene-name" value="${esc(scene.name)}" placeholder="比如：客厅沙发"${scene.dir === undefined ? '' : ' disabled'}></div>
    </div>
    <div class="photo" id="scene-photo"><img src="${esc(photo.url)}" draggable="false"><div class="view" id="scene-view" style="display:none"></div><div class="box" id="scene-box" style="display:none"></div></div>
    <p class="hint" id="scene-size">${size}</p>
    <div id="scene-fit"></div>
    <div class="bar"><button class="primary" id="scene-save">保存场景</button>${scene.dir === undefined ? '<button class="small" id="scene-pick">换一张照片</button>' : ''}${status}</div>
    ${scene.saved === undefined ? '' : scene.dir !== undefined
      ? `<p class="saved">人物区已保存（scene.json、crop.png）。接下来：用 crop.png 当首帧，按这个文件夹里「提示词.txt」生成视频，放回这个文件夹；回到「她」页面的形象工坊导入。</p>`
      : `<p class="saved">已保存到 ${esc(scene.saved)}，并在访达里打开了。接下来：用里面的 crop.png 去生成视频（首帧和尾帧都用它），按文档命名放进这个文件夹，然后在「她」页面 → 设置 → 外形 → 导入我的素材… 选这个文件夹。</p>`}
  </div>`
  drawBox()
  const area = document.getElementById('scene-photo')!
  let start: { x: number; y: number } | undefined
  const toPhoto = (event: MouseEvent) => {
    const rect = area.getBoundingClientRect()
    const k = photo.width / rect.width
    return { x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width) * k, y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height) * k }
  }
  area.addEventListener('mousedown', event => { start = toPhoto(event) })
  window.onmousemove = event => {
    if (start === undefined) return
    const at = toPhoto(event)
    let width = Math.abs(at.x - start.x)
    let height = Math.abs(at.y - start.y)
    if (scene.shape > 0) {
      // Keep the chosen shape: the box follows the larger of the two drags.
      if (width / height > scene.shape) height = width / scene.shape
      else width = height * scene.shape
    }
    const x = Math.min(Math.max(at.x < start.x ? start.x - width : start.x, 0), photo.width - width)
    const y = Math.min(Math.max(at.y < start.y ? start.y - height : start.y, 0), photo.height - height)
    scene.region = { x, y, width: Math.min(width, photo.width), height: Math.min(height, photo.height) }
    drawBox()
  }
  window.onmouseup = () => { start = undefined }
  window.onresize = drawBox
}

function drawBox(): void {
  const box = document.getElementById('scene-box')
  const area = document.getElementById('scene-photo')
  if (box === null || area === null || scene.photo === undefined || scene.region === undefined) return
  const k = area.getBoundingClientRect().width / scene.photo.width
  const r = scene.region
  Object.assign(box.style, { display: 'block', left: `${r.x * k}px`, top: `${r.y * k}px`, width: `${r.width * k}px`, height: `${r.height * k}px` })
  const size = document.getElementById('scene-size')
  if (size !== null) size.textContent = `人物区 ${Math.round(r.width)}×${Math.round(r.height)}（照片 ${scene.photo.width}×${scene.photo.height}）`
  const advice = document.getElementById('scene-fit')
  if (advice !== null) advice.innerHTML = fitAdvice(scene.photo, r)
  // The part of the photo your screen shows (dashed).
  const view = document.getElementById('scene-view')
  const s = mainScreen()
  if (view !== null && s !== undefined) {
    const fit = fitScene({ width: scene.photo.width, height: scene.photo.height, region: r }, s.width, s.height)
    const x = Math.max(0, -fit.left / fit.scale)
    const y = Math.max(0, -fit.top / fit.scale)
    const w = Math.min(scene.photo.width - x, s.width / fit.scale)
    const h = Math.min(scene.photo.height - y, s.height / fit.scale)
    Object.assign(view.style, { display: 'block', left: `${x * k}px`, top: `${y * k}px`, width: `${w * k}px`, height: `${h * k}px` })
  }
}

function pickPhoto(): void {
  void window.her.pickScenePhoto().then(photo => {
    if (photo === undefined) return
    Object.assign(scene, { photo, region: undefined, saved: undefined })
    note = undefined
    renderScene()
  }, (error: Error) => { note = { kind: 'error', text: error.message }; renderScene() })
}

function saveScene(): void {
  if (scene.photo === undefined) return
  scene.name = (document.getElementById('scene-name') as HTMLInputElement).value
  if (scene.region === undefined) {
    note = { kind: 'error', text: '先在照片上框出她的活动范围' }
    renderScene()
    return
  }
  void window.her.saveScene({ path: scene.photo.path, name: scene.name, region: scene.region, ...(scene.dir === undefined ? {} : { dir: scene.dir }) }).then(result => {
    note = result.ok ? undefined : { kind: 'error', text: result.message ?? '保存失败' }
    if (result.ok) scene.saved = result.dir
    renderScene()
  })
}

function saveClips(): void {
  if (clips === undefined) return
  const changes = clips.clips.map(c => ({
    id: c.id,
    use: (content.querySelector<HTMLSelectElement>(`select[data-use="${c.id}"]`)?.value ?? c.use) as ClipUse,
    desc: content.querySelector<HTMLInputElement>(`input[data-desc="${c.id}"]`)?.value ?? c.desc,
  }))
  void window.her.saveClips(changes).then(result => {
    note = result.ok ? { kind: 'saved', text: '已保存，她马上换成新的编排。' } : { kind: 'error', text: result.message ?? '保存失败' }
    clips = undefined
    renderClips()
  })
}

content.addEventListener('change', event => {
  const target = event.target as HTMLElement
  if (target.id === 'scene-shape') {
    scene.shape = Number((target as HTMLSelectElement).value)
    scene.name = (document.getElementById('scene-name') as HTMLInputElement).value
    scene.region = undefined
    renderScene()
    return
  }
  const select = event.target as HTMLElement
  if (select instanceof HTMLSelectElement && select.dataset.use !== undefined) select.closest('.clip')?.classList.toggle('off', select.value === 'none')
})

content.addEventListener('click', event => {
  const target = event.target as HTMLElement
  if (target.id === 'scene-pick') {
    pickPhoto()
    return
  }
  if (target.id === 'scene-save') {
    saveScene()
    return
  }
  if (target.id === 'save-clips') {
    saveClips()
    return
  }
  if (target.id === 'save') {
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value
    set({ character: { name: value('name').trim(), callYou: value('callYou').trim(), pronoun: value('pronoun') as PanelCharacter['pronoun'], persona: value('persona').trim() } }, '已保存，从她的下一句话开始生效。')
  } else if (target.dataset.confirm !== undefined) {
    set({ confirm: [target.dataset.confirm] }, '已确认。')
  } else if (target.dataset.forget !== undefined && window.confirm(`让她忘掉这条？\n\n${target.dataset.text ?? ''}`)) {
    set({ forget: [target.dataset.forget] }, '她忘掉了。')
  }
})

for (const button of document.querySelectorAll<HTMLButtonElement>('header button')) {
  button.addEventListener('click', () => {
    tab = button.dataset.tab as Tab
    note = undefined
    render()
  })
}

window.her.onBrain(message => {
  if (message.t !== 'panel') return
  // A change made here answers with an error, or with the fresh state (the note says it was saved).
  if (message.error !== undefined) note = { kind: 'error', text: message.error }
  const typing = tab === 'persona' && panel !== undefined && document.activeElement instanceof HTMLTextAreaElement
  panel = { character: message.character, memory: message.memory }
  // Don't wipe what is being typed when the brain answers another window's request.
  if (!typing || note !== undefined) render()
})

// What she remembers changes while you talk: ask again whenever the window comes back to the front.
window.addEventListener('focus', () => {
  ask()
  // The look may have changed meanwhile (the "她" page, the menu): read its clips again, unless you are editing them.
  if (tab !== 'clips') clips = undefined
})
render()
ask()
