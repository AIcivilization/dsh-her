/**
 * What to make for her, one entry per material (docs/素材规格与提示词.md is
 * written from this, and so is the 素材指南 page): where it shows, its size,
 * what a clip must keep to, and a prompt to copy into an image or video
 * tool. We do not make the pictures: the user does, with the tool they like.
 *
 * Everything starts from one character: her 定妆照, then her 三视图. Every
 * later picture and clip is made with those as the reference, so she stays
 * the same person everywhere.
 */

/** Two looks of the same her: drawn, or a real cosplayer photographed. */
export type GuideStyle = 'anime' | 'real'

/**
 * Our own whale girl (original, adult), in the two styles. The three things
 * every picture of her keeps are in both: the whale-tail hair accessory on
 * top of her head, the DeepSeek whale logo on her skirt, the blue whale tail
 * behind her.
 */
export const DEFAULT_WHO: Record<GuideStyle, string> = {
  anime: '成年女性，二次元动画风格。雾蓝色及肩短发，发尾微微内扣，左耳前编着一条细细的三股辫，辫尾系一颗小珍珠；浅海玻璃一样的青绿色眼睛，眼神清亮，带一点俏皮。头顶右侧别着一枚深海蓝色的鲸鱼尾巴发卡，尾鳍向上翘起，边缘描一圈白线。上身是白色短袖立领衬衫，领口系一条浅蓝色细丝带；外面套一件短款深海蓝防风夹克，袖子挽到小臂，袖口一圈白色波浪滚边，拉链头是一枚白色小水滴。下身是深海蓝高腰百褶短裙，裙摆左下角绣着 DeepSeek 的蓝色小鲸鱼标志（白色描边）；腰间一条浅棕色细皮带，皮带扣是一枚小贝壳。脖子上一根细银链，吊坠是一颗半透明的海蓝色玻璃水滴。左手腕一只浅蓝色细手环。白色短袜，白色帆布鞋配珊瑚橙色鞋带。身后从腰后伸出一条圆润的深海蓝色鲸鱼尾巴，自然垂下、末端微微上卷，尾巴腹面是浅蓝色，带几道平行的白色细纹（像蓝鲸腹部的褶沟），尾鳍边缘一圈浅青色。整体配色：雾蓝、深海蓝、白，少量珊瑚橙点缀。',
  real: '写实真人摄影，商业级Cosplay角色设定图，展示一位身材高挑修长的成年亚洲女性coser，扮演蓝色鲸鱼娘。她戴雾蓝色及肩短发假发，发尾微微内扣，左耳前编一条细三股辫，辫尾系一颗小珍珠；戴浅青绿色美瞳，妆容清透自然，笑容明朗。头顶右侧别着一枚深海蓝色的鲸鱼尾巴造型亚克力发卡，尾鳍向上翘起，边缘有白色描边。上身是白色短袖立领棉质衬衫，领口系一条浅蓝色细缎带；外搭一件短款深海蓝尼龙防风夹克，袖子挽到小臂，袖口缝一圈白色波浪滚边，拉链头是白色小水滴。下身是深海蓝高腰百褶短裙，裙摆左下角有一枚刺绣的 DeepSeek 蓝色小鲸鱼标志（白色描边）；腰间一条浅棕色细皮带，配贝壳形金属皮带扣。脖子上一根细银链，吊坠是半透明的海蓝色玻璃水滴。左手腕一只浅蓝色硅胶细手环。白色短袜，白色帆布鞋配珊瑚橙鞋带。腰后装着一条柔软的深海蓝色鲸鱼尾巴道具（短绒面料），自然垂到小腿、末端微微上卷，尾巴腹面浅蓝色、缝着几道平行的白色细条纹，尾鳍边缘一圈浅青色。真实皮肤质感，真实布料纹理，影棚柔光。',
}

export const STYLE_LABEL: Record<GuideStyle, string> = { anime: '二次元', real: '真人' }

/** How a picture is drawn, said once per prompt. */
const LOOK: Record<GuideStyle, string> = {
  anime: '二次元动画风格，线条干净，色块清晰，高细节。',
  real: '写实摄影，真实皮肤和布料质感，影棚柔光，高清，不要插画感。',
}

/** Her small self standing on the chat box: drawn chibi, or a chibi figurine photographed. */
const CHIBI: Record<GuideStyle, string> = {
  anime: 'Q 版小人，大约两头身，大头小身子，圆润可爱',
  real: 'Q 版树脂手办（黏土人质感），大约两头身，大头小身子，真实微距摄影',
}

/** In every prompt that shows her. */
export const MUST = '必须保留这三样：头顶的鲸鱼尾巴发饰；裙子（或短裤、长裤）上的 DeepSeek 蓝色小鲸鱼标志；身后的蓝色鲸鱼尾巴。'

/** The markers in a prompt: the character's description, how it is drawn, her chibi self. */
export const WHO = '{人物}'
const STYLE = '{画风}'
const Q = '{Q版}'

export type GuideGroup = 'base' | 'avatar' | 'desktop' | 'pet' | 'intro' | 'skin'

export interface GuideItem {
  id: string
  group: GuideGroup
  title: string
  /** Where it is seen. */
  where: string
  tool: '生图' | '图生视频'
  size: string
  format: string
  length?: string
  rules: string[]
  /** What to give the tool beside the prompt (reference pictures, first and last frame). */
  how: string
  prompt: string
  /** Where it goes once made. */
  upload: string
  /** 编排: the scene to put it in, and when that scene shows. */
  stage?: string
  /** She is not in it (a skin's background): no must-have line. */
  noHer?: boolean
}

export const GUIDE_GROUPS: Array<{ id: GuideGroup; title: string; about: string }> = [
  { id: 'base', title: '一、基础人物（先做这个）', about: '先把人定下来。后面所有的图和视频都拿这里的图当参考，她才是同一个人。' },
  { id: 'avatar', title: '二、头像（对话框上的 Q 版小她）', about: '站在 dsh 对话框上沿的 Q 版全身小人，不大。平时站着，会来回走两步、翻个跟头、打个滚；说话、听你说、想事情、被摸头、打招呼时各有一段。都用绿幕做，传上来点「抠掉背景」。' },
  { id: 'desktop', title: '三、桌面（壁纸里）', about: '铺满整个屏幕，在所有窗口后面。她在场景里：窗边、书桌、夜晚的海面。' },
  { id: 'pet', title: '四、宠物（浮在桌面上、网页里的桌宠）', about: '只有她自己，背景透明，浮在所有窗口上面，能拖、能点。' },
  { id: 'intro', title: '五、开机动画', about: '她出场时播一次的短片。' },
  { id: 'skin', title: '六、皮肤背景图', about: '换 dsh 整个界面时用的背景图（皮肤的其余部分是颜色和字体，不用画）。' },
]

/** Kept by every clip. */
export const VIDEO_RULES = [
  '固定机位：不推、不拉、不摇、不变焦、不切镜头。',
  '首帧和尾帧用同一张图：这样循环播放时接得上，看不出断点。',
  '画面里不要任何字：没有字幕、水印、Logo、界面元素（字幕由程序实时显示）。',
  '不要声音：她的声音由程序实时合成。',
  '同一个人、同一套衣服；换装就是另一组素材，从新的定妆照做起。',
  '导出 MP4（H.264）。文件别太大：头像 5 MB 以内，宠物 20 MB 以内，桌面 40 MB 以内为好。',
]

const SAME = `人物必须和参考图是同一个人：同样的发型、发色、五官、服装和配色，不要改动。`
const NO_TEXT = '画面中没有任何文字、字幕、水印、Logo。'
const STILL_CAMERA = '固定机位，镜头完全不动，不推拉、不摇移、不变焦、不切镜。'
const LOOP = '动作结束时回到和开头一模一样的姿势和表情，可以无缝循环。'
const GREEN = '背景是纯绿色（#00B140），完全均匀，没有地面、阴影、渐变和任何物体。'

export const GUIDE: GuideItem[] = [
  // ── base ────────────────────────────────────────────────────────────
  {
    id: 'base-portrait', group: 'base', title: '定妆照（正面全身）', where: '不直接显示：它是后面所有素材的参考图。', tool: '生图',
    size: '1024×1536（竖版 2:3）', format: 'PNG',
    rules: ['正面、全身、站直、双手自然下垂、嘴闭合。', '纯白背景，光线均匀，没有阴影。', '多生成几次，挑最满意的一张，后面都用它。'],
    how: '只用提示词。把「人物」换成你自己的设定（素材指南页面顶上填一次，下面每条都会带上）。',
    prompt: `${WHO}\n\n角色定妆照：正面全身，站直，身体放松，双手自然垂在身体两侧，看向镜头，嘴巴闭合，温柔的浅笑。\n纯白背景，完全均匀，没有地面线、阴影和任何物体。光线柔和均匀。\n竖版构图 2:3，人物居中，头顶和脚下各留一点空白。${STYLE}\n${NO_TEXT}`,
    upload: '留在自己电脑上当参考图（也可以传到 素材库 → 三视图 里存着）。',
  },
  {
    id: 'base-sheet', group: 'base', title: '三视图（正面、侧面、背面）', where: '显示在「总览」里她的名片旁；更重要的是：以后做任何图和视频，都把它传给工具当参考。', tool: '生图',
    size: '2048×1152（横版 16:9）', format: 'PNG',
    rules: ['同一张图里三个全身像：正面、右侧面、背面，从左到右排开。', '三个像一样高，脚踩在同一条线上，姿势都是自然站立（手臂略微张开，方便看清衣服）。', '纯白或浅灰背景，不要文字标注。', '发型、服装、配饰、尾巴在三个角度要对得上。'],
    how: '把上一步的「定妆照」传给工具当参考图，再用提示词。',
    prompt: `参考图是这个角色的定妆照。${SAME}\n\n画这个角色的三视图设定稿：同一张图里从左到右三个全身像，依次是正面、右侧面、背面。三个像一样高，脚在同一条水平线上，自然站立，手臂略微张开。\n纯白背景，光线均匀，没有阴影。横版 16:9，三个像均匀排开，互不遮挡。${STYLE}\n${NO_TEXT}不要标注和箭头。\n\n人物设定：${WHO}`,
    upload: '素材库 → 三视图。传好后在那里点「设为她的三视图」。',
  },
  {
    id: 'base-faces', group: 'base', title: '表情表（可选）', where: '不直接显示：做说话、开心、困了这些片段时当参考，表情更稳。', tool: '生图',
    size: '1536×1024（横版 3:2）', format: 'PNG',
    rules: ['六个头像排成两行三列：平静、微笑、开心大笑、惊讶、害羞、困。', '同一个角度（正面略侧），同样的大小。'],
    how: '把「三视图」传给工具当参考图。',
    prompt: `参考图是这个角色的三视图。${SAME}\n\n画这个角色的表情表：六个胸像排成两行三列，依次是平静、微笑、开心大笑、惊讶、害羞、犯困。每个胸像一样大，正面略微侧一点。\n纯白背景。横版 3:2。${STYLE}\n${NO_TEXT}`,
    upload: '留在自己电脑上当参考图。',
  },
  // ── avatar ──────────────────────────────────────────────────────────
  {
    id: 'avatar-still', group: 'avatar', title: '头像·站姿图（Q 版）', where: '站在 dsh 对话框上沿的小她（显示约 80 像素高）；也是下面每段头像视频的首尾帧。', tool: '生图',
    size: '512×512（正方形 1:1）', format: 'PNG（纯绿背景，传好后点「抠掉背景」）',
    rules: ['Q 版全身，大约两头身，站着，正面略侧。', '双脚踩在画面最下沿：她站在对话框的上沿。', '人物高约画面的七成，左右各留出空地（来回走动要用）。', '纯绿背景，身上不要有绿色。'],
    how: '把「三视图」传给工具当参考图。',
    prompt: `参考图是这个角色的三视图。${SAME}\n\n画这个角色的${Q}：全身，站着，正面略微侧一点，一只手轻轻挥着，看向镜头，开心地笑。双脚踩在画面最下沿，像站在一块平台的边上。人物高约画面的七成，居中，左右留出空地。\n正方形 1:1。${GREEN}人物边缘清晰，身上不要有绿色。\n${STYLE}${NO_TEXT}`,
    upload: '素材库 → 头像，然后点「抠掉背景」。', stage: '编排 → 头像 → 初始。',
  },
  {
    id: 'avatar-idle', group: 'avatar', title: '头像·站着（待机）', where: '平时站在对话框上的样子，循环播放。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '4–6 秒，循环',
    rules: ['脚不离开原地：眨眼、轻轻左右晃、尾巴摆。', '首尾帧都用「头像·站姿图」（绿背景那张）。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她站在原地：慢慢眨两次眼，身体轻轻左右晃一晃，尾巴摆了摆，头微微歪一下。动作小而可爱。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 头像，名字如「站着」，然后点「抠掉背景」。', stage: '编排 → 头像 → 初始（和走动、翻跟头、打滚一起选上，选「随机」）。',
  },
  {
    id: 'avatar-walk', group: 'avatar', title: '头像·来回走动', where: '在对话框上溜达，和「站着」轮着播。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '5–6 秒，循环',
    rules: ['走的范围不出画面：向左走两三步，转身，走回原位，转回正面。', '脚一直踩在画面最下沿那条线上。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她迈着小步子向画面左边走了两三步，尾巴一甩一甩；停下来转个身，再走回原来的位置，转回正面看向镜头。脚一直踩在画面最下沿，不离开画面。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 头像，名字如「走动」，然后点「抠掉背景」。', stage: '编排 → 头像 → 初始（随机）。',
  },
  {
    id: 'avatar-flip', group: 'avatar', title: '头像·翻跟头', where: '偶尔翻一个，和「站着」轮着播。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '3–4 秒',
    rules: ['原地向前翻一个跟头，稳稳落地，回到站姿。', '整个人一直在画面里，不出边。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她蹲下一点，原地向前翻了一个圆滚滚的跟头，尾巴跟着画了个圈，稳稳落地，张开双手得意地笑，然后回到原来的站姿。整个人一直在画面里。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 头像，名字如「翻跟头」，然后点「抠掉背景」。', stage: '编排 → 头像 → 初始（随机）。',
  },
  {
    id: 'avatar-roll', group: 'avatar', title: '头像·打滚', where: '偶尔打个滚，和「站着」轮着播。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '4–5 秒',
    rules: ['躺下，打一个滚，坐起来，站回原位。', '一直在画面下半部分，不出边。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她侧身躺倒，在原地开心地打了一个滚，尾巴拍了拍地面，坐起来伸个小懒腰，再站起来回到原来的站姿。一直在画面下半部分。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 头像，名字如「打滚」，然后点「抠掉背景」。', stage: '编排 → 头像 → 初始（随机）。',
  },
  {
    id: 'avatar-speak', group: 'avatar', title: '头像·说话', where: '她出声说话的时候。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '4–6 秒，循环',
    rules: ['站在原地，嘴一张一合，配一点手势。', '不要真的对口型：声音是程序合成的，这段只是「在说话」的样子。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她站在原地看着镜头说话：嘴巴自然地一张一合，说得轻快，不时点一下头，两只小手比划着，尾巴轻轻摆。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 头像，名字如「说话」，然后点「抠掉背景」。', stage: '编排 → 加一个场景「说话时」，时机选「她开口」。',
  },
  {
    id: 'avatar-listen', group: 'avatar', title: '头像·听你说', where: '你对她说话的时候。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '4–6 秒，循环',
    rules: ['嘴闭着，认真听：一只手放在耳边，点头。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她在认真听：嘴巴闭着，身体微微前倾，一只小手放在耳边，眼睛睁得圆圆的，慢慢点两次头。\n${LOOP}${GREEN}${NO_TEXT}`,
    upload: '素材库 → 头像，名字如「听你说」，然后点「抠掉背景」。', stage: '编排 → 加一个场景，时机选「你在说」。',
  },
  {
    id: 'avatar-think', group: 'avatar', title: '头像·想一想', where: '她在想怎么回答的那几秒。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '3–5 秒，循环',
    rules: ['眼睛看向斜上方，手指点着下巴，原地小步晃。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她在思考：眼睛看向斜上方，一根手指点着下巴，原地踱了一小步又回来，尾巴慢慢摆。\n${LOOP}${GREEN}${NO_TEXT}`,
    upload: '素材库 → 头像，名字如「想一想」，然后点「抠掉背景」。', stage: '编排 → 加一个场景，时机选「她在想」。',
  },
  {
    id: 'avatar-touch', group: 'avatar', title: '头像·被摸头', where: '你点她、摸她头的时候，播一次。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '2–4 秒',
    rules: ['反应要快：前半秒就有动作。', '眯眼、缩一下脖子、害羞地笑。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她被轻轻摸了头：马上眯起眼睛，缩一下脖子，脸红红的，开心地原地蹦了一下，然后回到原来的站姿。\n${LOOP}${GREEN}${NO_TEXT}`,
    upload: '素材库 → 头像，名字如「被摸头」，然后点「抠掉背景」。', stage: '编排 → 加一个场景，时机选「被碰」。',
  },
  {
    id: 'avatar-hello', group: 'avatar', title: '头像·打招呼', where: '你回到电脑前、她刚出来的时候。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '3–4 秒',
    rules: ['跳一下，用力挥手，笑。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她看到对方回来了：眼睛一亮，原地跳了一下，举起小手用力挥了挥，开心地笑，然后落回原来的站姿。\n${LOOP}${GREEN}${NO_TEXT}`,
    upload: '素材库 → 头像，名字如「打招呼」，然后点「抠掉背景」。', stage: '编排 → 加一个场景，时机选「你回来了」。',
  },
  {
    id: 'avatar-sleepy', group: 'avatar', title: '头像·困了（夜里）', where: '深夜。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '4–6 秒，循环',
    rules: ['站着打哈欠、揉眼睛、点头打瞌睡。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她困了：打一个小小的哈欠，用手背揉揉眼睛，站着头一点一点地打瞌睡，尾巴也耷拉下来，又努力睁开眼。\n${LOOP}${GREEN}${NO_TEXT}`,
    upload: '素材库 → 头像，名字如「困了」，然后点「抠掉背景」。', stage: '编排 → 加一个场景，时机选「时间段」，填 23-6。',
  },
  // ── desktop ─────────────────────────────────────────────────────────
  {
    id: 'desktop-still', group: 'desktop', title: '桌面·场景图', where: '铺满整个屏幕的壁纸位置；也是下面桌面视频的首尾帧。只传这张图也行：她就是一张会呼吸的壁纸。', tool: '生图',
    size: 'Mac：2560×1600（16:10）；Windows：2560×1440（16:9）', format: 'PNG 或 JPG',
    rules: ['她在画面右侧三分之一，左边留空：桌面图标一般在左边。', '画面上方不要有重要内容（Mac 的菜单栏在那儿）。', '色调柔和、不刺眼：这是一整天都看着的背景。'],
    how: '把「三视图」传给工具当参考图。',
    prompt: `参考图是这个角色的三视图。${SAME}\n\n一张桌面壁纸：她坐在靠海的窗边，侧身看向窗外，一只手托着腮，窗外是白天平静的海面和几朵云，窗帘被风轻轻吹起。她在画面右侧三分之一处，左边三分之二是窗台、海和天空，留得很空。\n横版 16:10，色调柔和明亮，以海蓝和白为主。${STYLE}\n${NO_TEXT}`,
    upload: '素材库 → 桌面。', stage: '编排 → 桌面 → 初始。',
  },
  {
    id: 'desktop-day', group: 'desktop', title: '桌面·白天（循环视频）', where: '壁纸位置，一直循环。', tool: '图生视频',
    size: '和场景图一样：2560×1600 或 2560×1440（工具出不了这么大就 1920×1200 / 1920×1080）', format: 'MP4', length: '8–10 秒，循环',
    rules: ['动的东西要少、要慢：窗帘、海面、云、她的头发和呼吸。', '她不要走动、不要大动作。'],
    how: '首帧、尾帧都传「桌面·场景图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面很安静：窗帘被风轻轻吹动，窗外的海面有细小的波光，云非常缓慢地移动。她坐在窗边看着海，慢慢眨眼，头发被风微微吹动，偶尔换一下托腮的手。所有动作都很慢、很轻。\n${LOOP}${NO_TEXT}不要声音。`,
    upload: '素材库 → 桌面，名字如「窗边白天」。', stage: '编排 → 桌面 → 初始。',
  },
  {
    id: 'desktop-night', group: 'desktop', title: '桌面·夜晚', where: '晚上自动换成这一段。', tool: '图生视频',
    size: '和场景图一样：2560×1600 或 2560×1440（工具出不了这么大就 1920×1200 / 1920×1080）', format: 'MP4', length: '8–10 秒，循环',
    rules: ['先用生图把「桌面·场景图」改成夜晚（同样的构图），再用它做首尾帧。', '夜里的画面要暗一些，不晃眼。'],
    how: '第一步（生图）：传「桌面·场景图」，提示词写「同样的构图和人物，改成夜晚：窗外是星空和月光下的海面，屋里亮着一盏暖色的小灯」。第二步（图生视频）：首帧、尾帧都传这张夜晚的图，用下面的提示词。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n夜晚，很安静：星星微微闪烁，月光下的海面有缓慢的波光，小灯的暖光轻轻晃动。她抱着膝盖坐在窗边看星星，慢慢眨眼，头发微微动。所有动作都很慢。\n${LOOP}${NO_TEXT}不要声音。`,
    upload: '素材库 → 桌面，名字如「窗边夜晚」。', stage: '编排 → 加一个场景「夜晚」，时机选「时间段」，填 19-6。',
  },
  {
    id: 'desktop-away', group: 'desktop', title: '桌面·你不在的时候', where: '你离开电脑一阵子以后。', tool: '图生视频',
    size: '和场景图一样：2560×1600 或 2560×1440（工具出不了这么大就 1920×1200 / 1920×1080）', format: 'MP4', length: '8–10 秒，循环',
    rules: ['她在做自己的事：看书、趴着睡、玩手机。'],
    how: '先用生图做一张同构图的「她趴在窗台上睡着了」，再用它做首尾帧。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n她趴在窗台上睡着了：肩膀随着呼吸慢慢起伏，尾巴偶尔轻轻动一下，窗帘缓缓飘动，海面波光缓慢。非常安静。\n${LOOP}${NO_TEXT}不要声音。`,
    upload: '素材库 → 桌面，名字如「睡着了」。', stage: '编排 → 加一个场景，时机选「你很久没动」。',
  },
  {
    id: 'desktop-play', group: 'desktop', title: '桌面·她自己想去的场景', where: '聊到某件事时，她自己换过去（比如聊到麻将，去「打麻将」）。', tool: '图生视频',
    size: '和场景图一样：2560×1600 或 2560×1440（工具出不了这么大就 1920×1200 / 1920×1080）', format: 'MP4', length: '8–10 秒，循环',
    rules: ['一个场景一件事：打麻将、喝茶、弹琴、做饭……想做几个做几个。', '给场景写一句「是什么」，她才知道什么时候该去。'],
    how: '先用生图做这个场景的图（传三视图当参考，她仍在画面右侧），再用它做首尾帧。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n她坐在麻将桌前：摸起一张牌看了看，想了一下，把牌轻轻打出去，然后把手放回桌上。动作从容。\n${LOOP}${NO_TEXT}不要声音。`,
    upload: '素材库 → 桌面，名字如「打麻将」。', stage: '编排 → 加一个场景「打麻将」，时机选「她自己选」，说明写「聊到麻将、想玩一把的时候」。',
  },
  // ── pet ─────────────────────────────────────────────────────────────
  {
    id: 'pet-still', group: 'pet', title: '宠物·站姿图', where: '浮在桌面上的她（高度约是屏幕的四成）；也是下面宠物视频的首尾帧。', tool: '生图',
    size: '1080×1920（竖版 9:16）；最少 720×1280', format: 'PNG（透明背景），或纯绿背景',
    rules: ['全身，站着，正面略侧。', '脚踩在画面底边上：她会站在屏幕下沿。', '头顶留一点空白（气泡在头顶）。', '背景透明；工具出不了透明就用纯绿色背景，传好后点「抠掉背景」。'],
    how: '把「三视图」传给工具当参考图。',
    prompt: `参考图是这个角色的三视图。${SAME}\n\n画这个角色的全身像：站着，正面略微侧一点，双手背在身后，看向镜头，微笑。脚踩在画面最下沿，头顶留少量空白。\n竖版 9:16，人物居中。${GREEN}人物边缘清晰，头发丝分明，身上不要有绿色。\n${STYLE}${NO_TEXT}`,
    upload: '素材库 → 宠物（绿背景的点「抠掉背景」）。', stage: '编排 → 宠物 → 初始。',
  },
  {
    id: 'pet-idle', group: 'pet', title: '宠物·站着（待机）', where: '平时浮在桌面上的样子，循环。', tool: '图生视频',
    size: '1080×1920 或 720×1280（9:16）', format: 'MP4（纯绿背景），传好后点「抠掉背景」变成透明 WebM', length: '5–8 秒，循环',
    rules: ['脚不要动：站在原地。', '动作小：呼吸、眨眼、头发和尾巴轻摆。', '背景全程是同一种纯绿色，身上不要出现绿色。'],
    how: '首帧、尾帧都传「宠物·站姿图」（绿背景那张）。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n她站在原地，双脚不动：自然地呼吸，慢慢眨眼，头发和尾巴轻轻摆动，身体微微左右晃一下。动作很小。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 宠物，名字如「站着」，然后点「抠掉背景」。', stage: '编排 → 宠物 → 初始。',
  },
  {
    id: 'pet-move', group: 'pet', title: '宠物·小动作（多做几段轮换）', where: '和「站着」轮着播，她看起来是活的。', tool: '图生视频',
    size: '1080×1920 或 720×1280（竖版 9:16）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '5–8 秒',
    rules: ['一段一个动作：伸懒腰、看手机、整理头发、踮脚张望、打哈欠。', '脚的位置不变，结束时回到站姿。'],
    how: '首帧、尾帧都传「宠物·站姿图」。每个动作生成一段，换提示词中间那句。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n她双脚站在原地，伸了一个大大的懒腰：双手举过头顶，踮一下脚，舒服地眯起眼睛，然后把手放下，回到原来的站姿。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 宠物，名字如「伸懒腰」「看手机」，然后点「抠掉背景」。', stage: '编排 → 宠物 → 初始：和「站着」一起选上，选「轮换」或「随机」。',
  },
  {
    id: 'pet-sleep', group: 'pet', title: '宠物·夜里睡着', where: '深夜浮在桌面上的样子。', tool: '图生视频',
    size: '1080×1920 或 720×1280（竖版 9:16）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '5–8 秒，循环',
    rules: ['先用生图做一张「坐在地上抱着膝盖睡着」的绿背景图（参考三视图），再用它做首尾帧。'],
    how: '首帧、尾帧都传那张睡着的图。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n她坐在地上抱着膝盖睡着了：肩膀随着呼吸慢慢起伏，头轻轻点一下，尾巴偶尔动一动。非常安静。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 宠物，名字如「睡着」，然后点「抠掉背景」。', stage: '编排 → 「夜晚」那个场景的宠物格子。',
  },
  // ── intro ───────────────────────────────────────────────────────────
  {
    id: 'intro', group: 'intro', title: '开机动画', where: '她出场时在屏幕中间播一次（约占屏幕一半大），播完自己消失。', tool: '图生视频',
    size: '1280×800（16:10）或 1280×720', format: 'MP4；想要透明就用纯绿背景，传好后点「抠掉背景」', length: '3–5 秒，不循环',
    rules: ['有头有尾：从没有到出现，最后停在一个好看的姿势上。', '短：超过 5 秒就嫌长了。'],
    how: '尾帧传「宠物·站姿图」或「定妆照」（首帧可以不给，让工具自己发挥出场方式）。',
    prompt: `尾帧是参考图。${STILL_CAMERA}\n\n一朵浪花从画面下方涌上来，水花散开，她从浪花里轻快地跃出，转了半圈，稳稳落地，对着镜头挥手微笑，停在尾帧的姿势上。水花是透亮的海蓝色。\n${GREEN}${NO_TEXT}不要声音。`,
    upload: '皮肤 → 开机动画 → 上传。',
  },
  // ── skin ────────────────────────────────────────────────────────────
  {
    id: 'skin-bg', group: 'skin', title: '皮肤背景图', where: 'dsh 整个界面的背景，文字都叠在上面。', tool: '生图',
    size: '2560×1600（16:10）', format: 'JPG 或 WebP，1 MB 以内',
    rules: ['细节要少、对比要低：上面要放很多字。', '做两张更好：一张浅色的（配浅色模式）、一张深色的（配深色模式）。', '不要有人物的脸：她自己会出现在界面上。'],
    how: '只用提示词。',
    prompt: `一张用作软件界面背景的图：平静的浅海水面俯视图，极淡的水波纹和几缕光斑，颜色是很浅的海蓝到白色的柔和渐变。细节很少，对比度很低，整体干净、安静。\n横版 16:10。没有人物，没有物体。${NO_TEXT}`,
    upload: '皮肤 → 上传皮肤（和 skin.json 放在同一个文件夹里）。', noHer: true,
  },
]

/** Is this the description we ship (either style), not one of the user's own? */
const isOurs = (who: string) => who.trim() === '' || who.trim() === DEFAULT_WHO.anime || who.trim() === DEFAULT_WHO.real

/** The prompt with the character's description in it, drawn in `style`. */
export function fillPrompt(prompt: string, who: string, style: GuideStyle = 'anime'): string {
  return prompt
    .split(WHO).join(who.trim() === '' ? DEFAULT_WHO[style] : who.trim())
    .split(STYLE).join(LOOK[style])
    .split(Q).join(CHIBI[style])
}

/** The line in front of a prompt that says what it is for (it helps the tool keep to the brief). */
export function purposeLine(who: string): string {
  return isOurs(who) ? '这是为deepseek-harness设计鲸鱼娘的角色之一，要求：' : '这是为deepseek-harness设计的角色素材之一，要求：'
}

/**
 * A material's whole prompt, to paste as it is: what it is for (when
 * `purpose`), the prompt with your character in it, the three things every
 * picture of her keeps (ours only), and its size (and, for a clip, how long),
 * so nothing has to be typed into the tool beside it.
 */
export function promptFor(item: GuideItem, who: string, purpose = true, style: GuideStyle = 'anime'): string {
  const size = item.tool === '图生视频'
    ? `视频尺寸：${item.size}${item.length === undefined ? '' : `；时长：${item.length}`}。`
    : `图片尺寸：${item.size}；格式：${item.format}。`
  const must = item.noHer === true || !isOurs(who) ? [] : [MUST]
  return [...(purpose ? [purposeLine(who)] : []), fillPrompt(item.prompt, who, style), ...must, size].join('\n')
}

/** The whole guide as a document (docs/素材规格与提示词.md). */
export function guideMarkdown(own?: string): string {
  const out: string[] = [
    '# 素材规格与提示词',
    '',
    '> 这份文档由 `src/core/material-guide.ts` 生成（`node scripts/make-material-doc.mjs`），和 dsh 里「她 → 素材指南」页面是同一份内容。在那个页面里可以把人物设定换成你自己的，每条提示词旁边有复制按钮。',
    '',
    '她的样子都是你自己做的图片和视频：我们不替你生成，只告诉你**要做哪些、多大、有什么要求**，并给出可以直接复制的提示词。把提示词粘到你常用的工具里（生图：Gemini、ChatGPT、即梦等；图生视频：可灵、即梦、海螺、Vidu 等，要支持**首尾帧**），做好后传到 dsh 的「她 → 素材库」。',
    '',
    '## 怎么用这份文档',
    '',
    '1. **先定人**：做「定妆照」，多抽几次，挑最满意的一张。',
    '2. **再做三视图**：正面、侧面、背面。传到 素材库 → 三视图，它会显示在总览里。',
    '3. **其余全部从三视图派生**：做任何一张图，都把三视图传给工具当参考图；做任何一段视频，都先有一张图，再用它当首帧和尾帧。这样她在头像、桌面、桌宠里是同一个人。',
    '4. **传到素材库，在编排里摆好**：每条下面写了传到哪一行、放进编排的哪个场景。',
    '',
    '不用一次做完。最少只要：**头像·站姿图**一张、**宠物·站姿图**一张（或**桌面·场景图**一张），她就能出现；其余的想到再加。',
    '',
    '## 规格速查',
    '',
    '| 素材 | 用在哪儿 | 尺寸 | 格式 | 时长 |',
    '|---|---|---|---|---|',
    ...GUIDE.map(item => `| ${item.title} | ${GUIDE_GROUPS.find(g => g.id === item.group)!.title.replace(/^.、/, '').replace(/（.*$/, '')} | ${item.size} | ${item.format} | ${item.length ?? '—'} |`),
    '',
    '## 每一段视频都要遵守',
    '',
    ...VIDEO_RULES.map(rule => `- ${rule}`),
    '',
    '## 透明背景怎么来',
    '',
    '宠物（和头像、开机动画，如果想要）需要透明背景，而视频工具一般出不了透明视频。做法：',
    '',
    '1. 生成时用**纯绿色背景**（提示词里已经写了 `#00B140`），人物身上不要有绿色。',
    '2. 传到素材库后，在那个素材上点**「抠掉背景」**：程序用 ffmpeg 把背景色去掉，生成一个带透明的 WebM（原文件留着）。',
    '3. 抠得不干净（边上一圈绿、身上缺了一块）：多半是背景不均匀或衣服上有相近的颜色，换一次生成，或把背景换成纯蓝色再试。',
    '',
    '## 你的人物（两版）',
    '',
    '默认是我们自己的鲸鱼娘，有**二次元**和**真人**（真人 Cosplay 摄影）两版，下面每条提示词也都给了两版。换成你自己的人物：把这一段整个替换掉（在 dsh 的素材指南页面里填一次就行）。',
    '',
    '每一张有她的图、每一段有她的视频，都**必须保留这三样**：头顶的鲸鱼尾巴发饰；裙子（或短裤、长裤）上的 DeepSeek 蓝色小鲸鱼标志；身后的蓝色鲸鱼尾巴。提示词里已经写上了。',
    '',
    '**二次元版：**',
    '',
    '```',
    own ?? DEFAULT_WHO.anime,
    '```',
    '',
    ...(own === undefined ? ['**真人版：**', '', '```', DEFAULT_WHO.real, '```', ''] : []),
  ]
  for (const group of GUIDE_GROUPS) {
    out.push(`## ${group.title}`, '', group.about, '')
    for (const item of GUIDE.filter(i => i.group === group.id)) {
      out.push(
        `### ${item.title}`, '',
        `- **用在哪儿**：${item.where}`,
        `- **用什么做**：${item.tool}`,
        `- **尺寸**：${item.size}`,
        `- **格式**：${item.format}`,
        ...(item.length === undefined ? [] : [`- **时长**：${item.length}`]),
        `- **要求**：`, ...item.rules.map(rule => `  - ${rule}`),
        `- **怎么做**：${item.how}`,
        `- **做好后**：${item.upload}${item.stage === undefined ? '' : ` 然后：${item.stage}`}`,
        ...(own !== undefined
          ? ['', '提示词（直接复制）：', '', '```', promptFor(item, own), '```', '']
          : ['', '提示词·二次元版（直接复制）：', '', '```', promptFor(item, DEFAULT_WHO.anime, true, 'anime'), '```', '',
            '提示词·真人版（直接复制）：', '', '```', promptFor(item, DEFAULT_WHO.real, true, 'real'), '```', '']),
      )
    }
  }
  out.push(
    '## 常见问题', '',
    '- **循环接不上，有一下跳**：首帧和尾帧没用同一张图，或者工具没有严格按尾帧收。换支持首尾帧的工具，或者重抽。',
    '- **人变了（脸、衣服不一样）**：没有传三视图当参考，或提示词里又描述了一遍外貌和参考图冲突。派生的图只写动作和场景，外貌交给参考图。',
    '- **文件太大**：视频用工具导出时选 1080p 以内；传到素材库后会标出过大的文件。',
    '- **想用真人或别的画风**：把「你的人物」那一段换掉即可，尺寸和规则都一样。真人的脸和声音要本人同意。',
    '- **想整套导入成一个「形象」而不是用编排**：见 [形象工坊的素材说明](素材生成提示词.md)（锚点姿势、抠像、多场景）。',
    '',
  )
  return out.join('\n')
}
