/**
 * 形象工坊 (docs/形象工坊与多场景.md §4): a look as a project the user fills in,
 * and the prompts and files made from it. Pure: the brain writes the files
 * (dsh/workshop.ts), the "她" page edits the project.
 *
 * Prompts come in three layers:
 * - rules: fixed, by kind (desk pet or scene);
 * - who she is: one sentence from the character card, the same in every
 *   image and every clip, so she stays the same person;
 * - the action: one per clip, preset or the user's own.
 */

export const PROJECT_FORMAT = 'dsh-her-workshop@1'
export const PROJECT_FILE = '形象.json'
export const REFERENCE_FILE = '参考图.png'
export const DESK_DIR = '桌宠'
export const sceneDir = (scene: { name: string }) => `场景-${safeName(scene.name)}`

/** A folder or file name from what the user typed. */
export function safeName(text: string): string {
  return text.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '') || '未命名'
}

export interface CharacterCard {
  gender: string
  age: string
  skin: string
  hairStyle: string
  hairColor: string
  build: string
  outfit: string
  accessories: string
  style: string
  /** Anything else ("左眼下有颗小痣"). */
  extra: string
  /** The sentence as the user edited it; empty: made from the fields. */
  sentence: string
}

/** Choices for each field of the card ("自己写" is always possible). Ages are adults only. */
export const CARD_CHOICES: Record<Exclude<keyof CharacterCard, 'extra' | 'sentence'>, readonly string[]> = {
  gender: ['女', '男'],
  age: ['二十出头', '二十多岁', '三十岁左右', '三十多岁'],
  skin: ['白皙', '自然肤色', '小麦色', '深色'],
  hairStyle: ['长直发', '长卷发', '中长发', '短发', '马尾', '丸子头'],
  hairColor: ['黑色', '深棕色', '栗色', '金色', '银白色'],
  build: ['纤细', '匀称', '健美', '丰满'],
  outfit: ['家居服', '衬衫连衣裙', '卫衣和牛仔裤', '吊带和短裙', '西装套装', '针织衫和长裙', '汉服'],
  accessories: ['无', '细框眼镜', '发卡', '耳环', '项链'],
  style: ['写实照片', '日系动漫', '3D 卡通'],
}

export const CARD_LABELS: Record<keyof CharacterCard, string> = {
  gender: '性别', age: '年龄', skin: '肤色', hairStyle: '发型', hairColor: '发色', build: '身材',
  outfit: '衣服', accessories: '配饰', style: '画风', extra: '其他特征', sentence: '角色描述',
}

export const DEFAULT_CARD: CharacterCard = {
  gender: '女', age: '二十多岁', skin: '自然肤色', hairStyle: '长卷发', hairColor: '深棕色', build: '匀称',
  outfit: '家居服', accessories: '无', style: '写实照片', extra: '', sentence: '',
}

/** Card fields that are about how she looks (not the art style). */
const subject = (card: CharacterCard) => (card.gender === '男' ? '成年男性' : card.gender === '女' ? '成年女性' : `成年人（${card.gender}）`)

/** "二十多岁的成年女性，自然肤色，深棕色长卷发，戴细框眼镜，穿家居服，身材匀称" — or the user's own sentence. */
export function describe(card: CharacterCard): string {
  if (card.sentence.trim() !== '') return card.sentence.trim()
  const parts = [
    `${card.age}的${subject(card)}`,
    `${card.skin}皮肤`,
    `${card.hairColor}${card.hairStyle}`,
    ...(card.accessories === '无' || card.accessories.trim() === '' ? [] : [`戴${card.accessories}`]),
    `穿${card.outfit}`,
    `身材${card.build}`,
    ...(card.extra.trim() === '' ? [] : [card.extra.trim()]),
  ]
  return parts.join('，')
}

/** The art style as words for a prompt. */
const styleWords = (card: CharacterCard) => (card.style === '写实照片' ? '写实摄影风格，真实皮肤质感，自然光' : card.style === '日系动漫' ? '日系动漫画风，干净线条' : card.style === '3D 卡通' ? '3D 卡通渲染风格' : card.style)

/** Green clothes would be keyed away with the green screen: then the background is grey. */
export function screenColor(card: CharacterCard): { name: string; hex: string } {
  return /绿/.test(`${card.outfit}${card.extra}${card.sentence}`) ? { name: '纯灰色', hex: '#808080' } : { name: '纯绿色', hex: '#00B140' }
}

export type Pose = 'stand' | 'sit' | 'lie'
export const POSE_WORDS: Record<Pose, string> = { stand: '站着', sit: '坐着', lie: '躺着' }

export interface ClipPlan {
  /** File name without .mp4: `<pose>_<role>_<nn>`. */
  file: string
  action: string
  /** Part of the minimum: one idle clip. */
  required?: boolean
  /** Left out of the task (the user unticked it). */
  off?: boolean
}

export interface ProjectScene {
  id: string
  name: string
  /** What the place looks like ("温馨的卧室，木质床头柜和台灯，暖色灯光"). */
  place: string
  pose: Pose
  hours?: string
  user?: 'active' | 'idle'
  clips: ClipPlan[]
}

/** The tool the clips are made with. `manual` is any other tool, described in `custom`. */
export type Generator = 'minimax' | 'comfyui' | 'jimeng' | 'kling' | 'hailuo' | 'wanx' | 'vidu' | 'manual'

export interface GeneratorInfo {
  name: string
  /** One line in the picker. */
  label: string
  /** The settings every clip uses, written at the top of each 提示词.txt. */
  settings: string
  /** How the clips get made, in the last card. */
  how: string
}

const WEB_HOW = '一段段生成：上传首帧，粘贴提示词（有"负面提示词"框就把负面提示词也粘进去，有"尾帧"就也放首帧那张图），下载后按文件名存进对应的文件夹。「生成清单.md」里每段都列好了。'

export const GENERATORS: Record<Exclude<Generator, 'manual'>, GeneratorInfo> = {
  minimax: {
    name: 'MiniMax Code', label: 'MiniMax Code（给它任务文件，自动生成下载）',
    settings: 'MiniMax-Hailuo-2.3 图生视频，1080P，6 秒。',
    how: '在 MiniMax Code 里说："按 <项目文件夹>/MiniMax生成任务.md 生成"，它会一段段生成、下载、存好。',
  },
  comfyui: {
    name: 'ComfyUI', label: 'ComfyUI（本地，Wan 2.2 等图生视频工作流）',
    settings: '图生视频工作流（比如 Wan 2.2 I2V），尺寸和首帧同比例、短边 720 以上，约 5 秒（16 fps 时 81 帧），负面提示词放进负面节点，每段用同一套参数。',
    how: '用你的图生视频工作流一段段跑，或者用脚本读「ComfyUI生成清单.json」（每段的首帧、提示词、负面提示词、保存路径）批量跑。输出存成清单里的文件名。',
  },
  jimeng: { name: '即梦', label: '即梦（网页 / App）', settings: '图生视频，1080P，5 秒。', how: `在即梦里${WEB_HOW}` },
  kling: { name: '可灵', label: '可灵（网页 / App）', settings: '图生视频，1080P，5 秒。', how: `在可灵里${WEB_HOW}` },
  hailuo: { name: '海螺 AI', label: '海螺 AI（MiniMax 的网页版）', settings: '图生视频，1080P，6 秒。', how: `在海螺 AI 里${WEB_HOW}` },
  wanx: { name: '通义万相', label: '通义万相（网页 / 阿里云百炼）', settings: '图生视频，1080P，5 秒。', how: `在通义万相里${WEB_HOW}` },
  vidu: { name: 'Vidu', label: 'Vidu（网页）', settings: '图生视频，1080P，4–5 秒。', how: `在 Vidu 里${WEB_HOW}` },
}

/** For `manual`: the tool's name, its settings, and words every clip's prompt starts with (a LoRA trigger word, a style). */
export interface CustomGenerator {
  name: string
  settings: string
  prefix: string
}

export const MANUAL_LABEL = '手工填写（别的工具，自己写名字和设置）'

/** The project's tool, a custom one filled in from `custom`. */
export function generatorInfo(project: Pick<LookProject, 'generator' | 'custom'>): GeneratorInfo {
  if (project.generator !== 'manual' && project.generator in GENERATORS) return GENERATORS[project.generator]
  const name = project.custom?.name.trim() || '你用的工具'
  const settings = project.custom?.settings.trim() || '图生视频，和首帧同比例，1080P，5–6 秒，每段用同一套设置。'
  return { name, label: MANUAL_LABEL, settings, how: `在${name}里${WEB_HOW}` }
}

export interface LookProject {
  format: typeof PROJECT_FORMAT
  id: string
  name: string
  card: CharacterCard
  desk: { on: boolean; clips: ClipPlan[] }
  scenes: ProjectScene[]
  /** The scene when no rule matches (an id in `scenes`). */
  default?: string
  generator: Generator
  /** Filled in when `generator` is `manual`. */
  custom?: CustomGenerator
  createdAt: string
}

/** Preset actions; `{pose}` reads 站着 / 坐着 / 躺着. */
const PRESETS: Array<{ role: string; n: number; action: string; required?: boolean; ticked?: boolean }> = [
  { role: 'idle', n: 1, required: true, action: '安静地{pose}，自然呼吸，偶尔眨眼，头极轻微地晃动，嘴巴闭合，浅浅地笑' },
  { role: 'talk', n: 1, ticked: true, action: '看着镜头温柔地说话，嘴巴自然持续开合，轻轻点头，手有很小的动作。最后一秒闭嘴回到原姿势' },
  { role: 'talk', n: 2, ticked: true, action: '看着镜头说话，换一种节奏，略带笑意，嘴巴自然持续开合，一只手轻轻抬起又放下。最后一秒闭嘴回到原姿势' },
  { role: 'idle', n: 2, action: '安静地{pose}，轻轻把一缕头发拨到耳后，然后恢复原姿势' },
  { role: 'listen', n: 1, action: '认真地听，嘴巴闭着，轻轻点头两次，眼神专注看着镜头' },
  { role: 'think', n: 1, action: '眼睛看向右上方像在思考，食指轻碰下巴，然后放下手，视线回到镜头' },
  { role: 'happy', n: 1, action: '开心地笑出来，眼睛弯起，肩膀轻微耸动，然后恢复浅笑' },
  { role: 'shy', n: 1, action: '害羞地低头，手指卷一下发梢，再抬眼看镜头，恢复原姿势' },
  { role: 'wave', n: 1, action: '看到你很开心，抬起右手朝镜头挥手，然后放下手恢复原姿势' },
  { role: 'touched', n: 1, action: '像被轻轻戳了一下，微微一惊，然后看着镜头笑，恢复原姿势' },
  { role: 'sleepy', n: 1, action: '打一个小哈欠，用手背轻揉眼睛，然后对镜头笑一下，恢复原姿势' },
]

/** The preset clips for a pose: idle and two talks ticked, the rest offered unticked. */
export function presetClips(pose: Pose): ClipPlan[] {
  return PRESETS.map(p => ({
    file: `${pose}_${p.role}_${String(p.n).padStart(2, '0')}`,
    action: p.action.replaceAll('{pose}', POSE_WORDS[pose]),
    ...(p.required === true ? { required: true } : p.ticked === true ? {} : { off: true }),
  }))
}

/** A clip of the user's own: an action name from what they typed (`<pose>_<name>_01`), not clashing with the others. */
export function customClip(pose: Pose, existing: readonly ClipPlan[], action: string): ClipPlan {
  let n = 1
  while (existing.some(c => c.file === `${pose}_act${n}_01`)) n++
  return { file: `${pose}_act${n}_01`, action: action.trim() }
}

export function newProject(id: string, name: string, now = new Date()): LookProject {
  return {
    format: PROJECT_FORMAT, id, name, card: { ...DEFAULT_CARD },
    desk: { on: true, clips: presetClips('stand') },
    scenes: [],
    generator: 'minimax',
    createdAt: now.toISOString(),
  }
}

export function newScene(id: string, name: string, pose: Pose = 'stand'): ProjectScene {
  return { id, name, place: '', pose, clips: presetClips(pose) }
}

/** Fixed rules every clip carries, for its kind and the generator. */
export function rules(project: LookProject, kind: 'desk' | 'scene', scene?: ProjectScene): string {
  const common = [
    '固定机位，单一连续镜头，不推拉摇移，不变焦，不切镜',
    '脸、五官、发型、妆容、服装、身材比例全程完全不变',
    '动作自然、克制、幅度小，真实的呼吸和眨眼',
    '画面中不出现任何文字、字幕、水印、Logo，无背景音乐',
    '视频开始和结束时，人物姿势与参考图完全一致',
  ]
  if (kind === 'desk') {
    const color = screenColor(project.card)
    return [`参考图中的同一位${subject(project.card)}，全身站立，${color.name}背景`, ...common,
      `背景始终是均匀的${color.name}（${color.hex}），无地面、无阴影、无渐变、无任何物体，光照不变`,
      '双脚始终站在原地，身体始终完整地在画面内（头顶和脚都不出画）'].join('。') + '。'
  }
  return [`参考图中的同一位${subject(project.card)}，在${scene?.name ?? '场景'}里${POSE_WORDS[scene?.pose ?? 'stand']}`, ...common,
    '背景与参考图完全一致且静止，光照不变', '人物不离开原位，身体始终在画面内'].join('。') + '。'
}

export const NEGATIVE = '换脸, 身份漂移, 发型变化, 服装变化, 年龄变化, 多余人物, 多余手指, 手部畸形, 肢体扭曲, 脚步移动, 走出画面, 瞬移, 镜头移动, 变焦, 切镜, 背景变化, 光线闪烁, 阴影出现, 文字, 字幕, 水印, logo, 夸张表情, 卡通化, 塑料皮肤, 模糊, 低清'

/** The full prompt of one clip: rules, who she is, the action. */
export function clipPrompt(project: LookProject, kind: 'desk' | 'scene', clip: ClipPlan, scene?: ProjectScene): string {
  const prefix = project.generator === 'manual' ? project.custom?.prefix.trim() ?? '' : ''
  return `${prefix === '' ? '' : `${prefix.replace(/[，。,.\s]+$/, '')}。`}${rules(project, kind, scene)}她是：${describe(project.card)}。${clip.action}。`
}

/** The reference picture: her on a plain screen, full length. It is also the desk pet's anchor. */
export function referencePrompt(project: LookProject): string {
  const color = screenColor(project.card)
  return [
    `${describe(project.card)}`,
    '全身正面站立，双手自然垂在身侧，表情温和，看着镜头',
    `${color.name}背景（${color.hex}），背景完全均匀，无地面、无阴影、无渐变、无任何物体`,
    '人物居中，头顶和脚下各留一点空，竖版 9:16，1080×1920',
    styleWords(project.card),
  ].join('。') + '。'
}

/** A scene's full-screen photo, made with the reference picture so she stays the same person. */
export function scenePhotoPrompt(project: LookProject, scene: ProjectScene, screen?: { width: number; height: number }): string {
  const size = screen === undefined ? '横版 16:10，2560 宽以上' : `横版，和屏幕一样的比例，${screen.width}×${screen.height}`
  return [
    `${scene.place.trim() === '' ? scene.name : scene.place.trim()}`,
    `画面里有一位${describe(project.card)}，${POSE_WORDS[scene.pose]}，看着镜头`,
    '用参考图保持人物完全一致（同一张脸、同样的发型和衣服）',
    '人物完整地在画面中间偏一侧，头顶和脚下留出空间，人物高度约占画面的六成',
    size,
    styleWords(project.card),
  ].join('。') + '。'
}

/** Every clip to make, with where it goes and its prompt. */
export function plannedClips(project: LookProject): Array<{ part: string; folder: string; first: string; clip: ClipPlan; prompt: string }> {
  const out: Array<{ part: string; folder: string; first: string; clip: ClipPlan; prompt: string }> = []
  if (project.desk.on) {
    for (const clip of project.desk.clips.filter(c => c.off !== true)) {
      out.push({ part: '桌宠', folder: DESK_DIR, first: REFERENCE_FILE, clip, prompt: clipPrompt(project, 'desk', clip) })
    }
  }
  for (const scene of project.scenes) {
    for (const clip of scene.clips.filter(c => c.off !== true)) {
      out.push({ part: scene.name, folder: sceneDir(scene), first: `${sceneDir(scene)}/crop.png`, clip, prompt: clipPrompt(project, 'scene', clip, scene) })
    }
  }
  return out
}

/** 提示词.txt of one part (the desk pet, or a scene): every clip's prompt, ready to copy. */
export function promptsFile(project: LookProject, part: 'desk' | ProjectScene): string {
  const kind = part === 'desk' ? 'desk' : 'scene'
  const scene = part === 'desk' ? undefined : part
  const clips = part === 'desk' ? project.desk.clips : part.clips
  const first = part === 'desk' ? `上一层的 ${REFERENCE_FILE}（复制进来改名叫 anchor_stand.png 也行）` : 'crop.png（先在「她」页面里框好人物区）'
  return [
    `${project.name} · ${part === 'desk' ? '桌宠' : part.name} · 视频提示词`,
    '',
    `用${generatorInfo(project).name}：${generatorInfo(project).settings}`,
    `首帧（和尾帧，工具支持的话）：${first}。比例和首帧一致。`,
    '生成好的视频按下面的文件名命名（.mp4），放进这个文件夹。',
    '',
    `负面提示词：${NEGATIVE}`,
    '',
    ...clips.filter(c => c.off !== true).flatMap(c => [`${c.file}.mp4${c.required === true ? '（必须）' : ''}`, clipPrompt(project, kind, c, scene), '']),
  ].join('\n')
}

/** 生成清单.md: every clip with its first frame, where it goes and its prompt, for any tool. */
export function clipList(project: LookProject, root: string): string {
  const tool = generatorInfo(project)
  const lines = [
    `# ${project.name} · 视频片段清单（${tool.name}）`,
    '',
    `统一设置：${tool.settings}`,
    '提示词原样使用；首尾接不上没关系，导入时会自动处理成循环。已经有的 mp4 不用重做。',
    '',
    `负面提示词（工具有这个框就用）：${NEGATIVE}`,
    '',
  ]
  for (const item of plannedClips(project)) {
    lines.push(`## ${item.part} / ${item.clip.file}${item.clip.required === true ? '（必须）' : ''}`, `- 首帧：\`${root}/${item.first}\``, `- 保存到：\`${root}/${item.folder}/${item.clip.file}.mp4\``, `- 提示词：${item.prompt}`, '')
  }
  return lines.join('\n')
}

/** ComfyUI生成清单.json: the same list for a script that drives a ComfyUI workflow. */
export function comfyuiList(project: LookProject, root: string): string {
  return `${JSON.stringify({
    format: 'dsh-her-clips@1',
    settings: GENERATORS.comfyui.settings,
    negative: NEGATIVE,
    clips: plannedClips(project).map(item => ({
      part: item.part, name: item.clip.file, required: item.clip.required === true,
      image: `${root}/${item.first}`, output: `${root}/${item.folder}/${item.clip.file}.mp4`, prompt: item.prompt,
    })),
  }, null, 2)}\n`
}

/** The task file for MiniMax Code: one uniform setting, at most 5 at a time, download as each finishes. */
export function minimaxTask(project: LookProject, root: string): string {
  const lines = [
    `# ${project.name} · 视频片段生成任务（给 MiniMax Code）`,
    '',
    '按下面的清单生成视频，下载保存到指定路径。所有片段用完全相同的设置。',
    '',
    '## 统一设置',
    '- 模型：**MiniMax-Hailuo-2.3**，图生视频，只给首帧（每段写了用哪张图）。',
    '- 分辨率 **1080P**，时长 **6 秒**，静音，不加水印，不配乐。',
    '- 提示词原样使用，不要改写、不要翻译、不要加任何前缀或说明。',
    '- 首尾接不上没关系，导入时会自动处理成循环。',
    '',
    '## 怎么跑',
    `- 临时文件放在 \`${root}/.minimax-work/\`，不要放进任何代码仓库。`,
    '- 已经存在的 mp4 跳过，不要覆盖。',
    '- 同时最多 5 个任务在生成：满了就先查询已提交的任务，**每段一完成就立刻下载**到它的保存路径（下载链接几小时后失效），腾出位置再提交下一段。',
    '- 失败的段重试一次；还失败就记下来跳过，不要卡住。',
    '- 除了新生成的 MP4，不要改动、删除这些文件夹里的任何文件。',
    '- 全部结束后报告：每段成功/失败、分辨率、时长，失败的原因。',
    '',
    '## 清单',
    '',
  ]
  for (const item of plannedClips(project)) {
    lines.push(`### ${item.part} / ${item.clip.file}`, `- 首帧：\`${root}/${item.first}\``, `- 保存到：\`${root}/${item.folder}/${item.clip.file}.mp4\``, `- 提示词：${item.prompt}`, '')
  }
  return lines.join('\n')
}

/** An age that is clearly grown up: 二十多岁, 三十岁左右, 25 岁, 成年 … */
export function isAdult(age: string): boolean {
  if (/成年|二十|三十|四十|五十|六十|七十/.test(age)) return true
  const years = [...age.matchAll(/(\d{1,3})\s*岁?/g)].map(m => Number(m[1]))
  return years.length > 0 && years.every(n => n >= 18)
}

/** Check a project read from disk or sent by the page. */
export function validateProject(value: unknown): LookProject {
  const p = value as LookProject
  if (typeof p !== 'object' || p === null || p.format !== PROJECT_FORMAT) throw new Error('不是形象工坊的项目')
  if (typeof p.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(p.id)) throw new Error('项目 id 不对')
  if (typeof p.name !== 'string' || p.name.trim() === '') throw new Error('先给形象起个名字')
  if (typeof p.card !== 'object' || p.card === null) throw new Error('缺少角色卡')
  for (const key of Object.keys(DEFAULT_CARD) as Array<keyof CharacterCard>) {
    if (typeof p.card[key] !== 'string') throw new Error(`角色卡缺少「${CARD_LABELS[key]}」`)
  }
  if (!isAdult(p.card.age)) throw new Error('年龄只能是成年人（比如"二十多岁"或"25 岁"）')
  if (!Array.isArray(p.scenes) || typeof p.desk !== 'object' || !Array.isArray(p.desk?.clips)) throw new Error('项目内容不完整')
  if (!p.desk.on && p.scenes.length === 0) throw new Error('桌宠和场景至少要有一个')
  if (p.generator !== 'manual' && !(p.generator in GENERATORS)) throw new Error('不认识这个生成工具')
  if (p.custom !== undefined && (typeof p.custom !== 'object' || p.custom === null || [p.custom.name, p.custom.settings, p.custom.prefix].some(v => typeof v !== 'string'))) throw new Error('手工填写的工具信息不对')
  const names = new Set<string>()
  for (const scene of p.scenes) {
    if (typeof scene.id !== 'string' || typeof scene.name !== 'string' || scene.name.trim() === '' || !Array.isArray(scene.clips)) throw new Error('场景要有名字')
    if (names.has(sceneDir(scene))) throw new Error(`有两个场景都叫「${scene.name}」`)
    names.add(sceneDir(scene))
  }
  return p
}

/** The workshop's cards, in order. */
export type WorkshopCard = 'look' | 'reference' | 'desk' | 'scene' | 'import'

/**
 * Example pictures and clips each card shows, by file name under
 * `examples/workshop/` (in the plugin; a file of the same name in
 * `<home>/examples/workshop/` wins). A missing one shows as a placeholder
 * naming the file, until the finished showroom's material is put there.
 */
export const EXAMPLE_SLOTS: Record<WorkshopCard, ReadonlyArray<{ file: string; label: string }>> = {
  look: [{ file: 'look.png', label: '做好的她（角色卡这样填出来的样子）' }],
  reference: [{ file: 'reference.png', label: '参考图：纯色背景、全身、正面站立' }],
  desk: [{ file: 'desk.mp4', label: '桌宠片段（绿幕原片）' }, { file: 'desk-keyed.png', label: '抠好后浮在桌面上' }],
  scene: [
    { file: 'scene-plate.png', label: '场景的全屏照片' },
    { file: 'scene-crop.png', label: '框好的人物区（crop.png）' },
    { file: 'scene.mp4', label: '场景片段' },
  ],
  import: [{ file: 'result.png', label: '导入后桌面上的样子' }],
}

export const EXAMPLE_FILES: ReadonlySet<string> = new Set(Object.values(EXAMPLE_SLOTS).flatMap(slots => slots.map(s => s.file)))
