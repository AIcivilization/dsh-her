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

/**
 * The six templates we start from: our whale girl four ways (drawn, a real
 * cosplayer photographed, chibi, pixel art), and a real girlfriend and
 * boyfriend. Each has its own character, how it is drawn, its own scenes and
 * its own opening.
 */
export type GuideStyle = 'anime' | 'real' | 'chibi' | 'pixel' | 'gf' | 'bf'

export const GUIDE_STYLES: GuideStyle[] = ['anime', 'real', 'chibi', 'pixel', 'gf', 'bf']

interface Template {
  label: string
  /** The character, as detailed as a 定妆照 needs. */
  who: string
  /** How every picture is drawn, said once per prompt. */
  look: string
  /** The small self standing on the chat box. */
  chibi: string
  /** Our whale girl: the three must-haves, and her tail in every clip. */
  whale: boolean
  /** 他, not 她. */
  he: boolean
  purpose: string
  /** Where the desktop scenes are, and how they move. */
  scene: Record<'窗边' | '窗外' | '远处' | '窗外动' | '夜景' | '夜景动' | '色调' | '皮肤底', string>
  /** The opening clip: how they come on. */
  opening: string
  /** Said in every clip's prompt (clips have no 画风 line): pixel art keeps its grid. */
  clip?: string
}

const DRAWN_LOOK = '高质量二次元插画，日系动画美型画风，线条干净细腻，光影柔和有层次，服装面料、刺绣和饰品的细节精致，高细节，高清。'
const REAL_LOOK = '高端商业摄影，写实真人，真实的皮肤和面料质感，服装做工精良，柔和的影棚灯光，高清；拍全身时机位略低，显得腿长；不要插画感，不要塑料感。'
const DRAWN_CHIBI = 'Q 版小人，大约两头身，大头小身子，圆润可爱'
const REAL_CHIBI = 'Q 版树脂手办（黏土人质感），大约两头身，大头小身子，真实微距摄影'

/** Pixel art (docs/像素动画设计.md §11): crisp squares, few colours, and a clip keeps its grid. */
const PIXEL_LOOK = '16-bit 像素画（pixel art），像 SNES 时代的角色立绘和场景：清晰的方形像素边缘，每个像素格大小一致，有限调色板（不超过 32 色），纯色块加少量规则的抖动网点，没有抗锯齿，没有模糊，没有渐变噪点，没有写实光影；细节精致，轮廓干净。如果是视频：保持像素风，像素格子大小全程不变，动作按帧一格一格地动，不要平滑插帧，不要运动模糊。'
const PIXEL_CHIBI = 'Q 版像素小人，大约两头身，大头小身子，大约 32 × 48 个像素格的比例，圆润可爱'

const PIXEL_SEA: Template['scene'] = {
  窗边: '像素风海边小木屋的窗边',
  窗外: '像素风的平静海面、几朵方块云和远处的小灯塔',
  远处: '像素海',
  窗外动: '窗外的像素海面一格一格地闪着波光，方块云非常缓慢地移动',
  夜景: '像素星空和月光下的像素海面',
  夜景动: '像素星星一明一暗地闪烁，月光下的海面一格一格地闪着波光',
  色调: '以海蓝、白和少量珊瑚粉为主，调色板不超过 32 色',
  皮肤底: '像素风的浅海水面俯视图，几道一格宽的浅色波纹和稀疏的像素光点，颜色是很浅的海蓝到白色，色块平涂',
}

const SEA: Template['scene'] = {
  窗边: '靠海的窗边',
  窗外: '白天平静的海面和几朵云',
  远处: '海',
  窗外动: '窗外的海面有细小的波光，云非常缓慢地移动',
  夜景: '星空和月光下的海面',
  夜景动: '星星微微闪烁，月光下的海面有缓慢的波光',
  色调: '以海蓝和白为主',
  皮肤底: '平静的浅海水面俯视图，极淡的水波纹和几缕光斑，颜色是很浅的海蓝到白色的柔和渐变',
}

const WHALE_PURPOSE = '这是为deepseek-harness设计鲸鱼娘的角色之一，要求：'

/**
 * Our whale girl (original, adult; no maid outfit). The three things every
 * picture of her keeps are in each version: the whale-tail hair accessory on
 * top of her head, the DeepSeek whale logo on her skirt, the blue whale tail
 * behind her.
 */
const TEMPLATES: Record<GuideStyle, Template> = {
  anime: {
    label: '二次元鲸鱼娘',
    who: [
      '成年女性鲸鱼娘，约二十二岁，二次元美型立绘。身材高挑纤细，约八头身，肩颈线条优美，腰线高而纤细，双腿修长笔直，整体比例像时尚插画里的成年女性角色。',
      '她有一头及腰的银白色长发，发丝柔顺有光泽，发尾渐变成透亮的浅海蓝，像被海水浸过；前额是轻盈的侧分刘海，脸侧垂下两缕细长的鬓发；左耳前编一条细细的三股辫，辫尾缀一颗小珍珠。',
      '小巧的鹅蛋脸，五官精致；眼睛是清澈的浅海青绿色，虹膜从外圈的深青渐变到中心透亮的浅绿，眼中有水波似的细碎高光；睫毛纤长，眼尾微微上挑，神情温柔又灵动，嘴角含着浅浅的笑。',
      '头顶右侧斜戴一枚银色镂空的鲸鱼尾巴发饰，两片尾鳍向上扬起，鳍面镶一排细小的珍珠和海蓝色碎钻，尾端垂下两条短短的珍珠流苏。',
      '她穿一条以海浪为灵感的礼裙。上身是贴身的珍珠白缎面立领无袖上衣，领口一圈银线绣的细浪纹，胸前一列小巧的贝母扣；双肩披一层深海蓝的透明薄纱短披肩，边缘像浪花一样微微卷起。腰间一条银色细链腰带，正中一枚小贝壳扣，收出纤细的腰身。',
      '裙子是前短后长的不对称剪裁：前摆到膝盖上方，后摆垂到脚踝；裙摆由多层薄纱叠成，颜色从腰部的珍珠白一层层过渡到雾蓝、海蓝，最下层是深海蓝，像从浅滩延伸到深海；裙摆边缘缀着细碎的银色亮片，像海面上的波光。裙子正面左下方用银蓝色丝线绣着 DeepSeek 的蓝色小鲸鱼标志，约掌心大，清晰醒目。',
      '双腿穿近乎透明的浅色薄丝袜，脚上是银白色细带高跟凉鞋，脚踝绑带上缀一颗小珍珠。',
      '脖子上一条细珍珠颈链，正中垂着一颗半透明的海玻璃水滴吊坠；两耳各一颗小小的银色鲸尾耳坠；左手腕一串细银链手链。',
      '腰后伸出一条修长流畅的深海蓝色鲸鱼尾巴，长到小腿，带着丝绸般的柔和光泽，向一侧弯出优雅的弧线；尾巴腹面是浅蓝色，有几道平行的白色细纹，像蓝鲸腹部的褶沟；末端展开两片宽大的尾鳍，鳍缘渐变成半透明的浅青色。',
      '气质温柔、优雅又灵动，像在月光下的海边演出的歌姬。配色以珍珠白、银白、雾蓝、海蓝、深海蓝为主，银色点缀，不用金色。',
      '避免：矮胖、短腿、头大身小、比例失调、衣服廉价粗糙、塑料感。',
    ].join('\n'),
    look: DRAWN_LOOK, chibi: DRAWN_CHIBI, whale: true, he: false, purpose: WHALE_PURPOSE, scene: SEA,
    opening: '一朵浪花从画面下方涌上来，水花散开，她从浪花里轻快地跃出，转了半圈，鲸鱼尾巴在身后划出一道弧线，稳稳落地，对着镜头挥手微笑，停在尾帧的姿势上。水花是透亮的海蓝色，落下时闪着细碎的光。',
  },
  real: {
    label: '真人鲸鱼娘',
    who: [
      '写实真人摄影，商业级Cosplay角色设定图，展示一位身材高挑修长的成年亚洲女性coser，扮演蓝色鲸鱼娘。她约二十三岁，身高约 172 厘米，九头身比例，肩颈线条优美，腰线高而纤细，双腿修长笔直，体态挺拔。',
      '她戴一顶及腰的银白色长假发，发丝顺滑有光泽，发尾挑染成透亮的浅海蓝；侧分刘海轻盈，脸侧垂下两缕细长鬓发；左耳前编一条细三股辫，辫尾系一颗真珍珠。',
      '鹅蛋脸，五官精致立体；戴浅海青绿色美瞳；妆容清透有高级感：细腻的底妆，眼尾一抹浅蓝珠光眼影，下眼睑点几颗细闪，蜜桃色唇釉；神情温柔明亮。',
      '头顶右侧斜戴一枚银色金属镂空的鲸鱼尾巴发饰，两片尾鳍向上扬起，镶一排小珍珠和海蓝色水钻，尾端垂下两条短珍珠流苏，做工精细。',
      '她穿一条以海浪为灵感的定制礼裙。上身是贴身剪裁的珍珠白真丝缎面立领无袖上衣，领口一圈银线手工刺绣的细浪纹，胸前一列贝母扣；双肩披一层深海蓝欧根纱短披肩，边缘做成微微卷起的浪花形。腰间一条银色细链腰带，正中一枚贝壳扣，收出纤细的腰身。',
      '裙子是前短后长的不对称剪裁：前摆到膝盖上方，后摆垂到脚踝；多层欧根纱叠成，颜色从腰部的珍珠白一层层过渡到雾蓝、海蓝、深海蓝；裙摆边缘手缝细碎的银色亮片，在灯光下像海面波光。裙子正面左下方用银蓝色丝线刺绣 DeepSeek 的蓝色小鲸鱼标志，约掌心大，清晰醒目。',
      '腿上是近乎透明的浅肤色薄丝袜，脚穿银白色细带高跟凉鞋，脚踝绑带上缀一颗小珍珠。',
      '脖子上一条细珍珠颈链，正中垂着一颗半透明的海玻璃水滴吊坠；两耳各一颗小巧的银色鲸尾耳坠；左手腕一串细银链手链。',
      '腰后装着一条修长的深海蓝色鲸鱼尾巴道具，外层是带柔和光泽的弹力缎面，内有支撑，自然弯出优雅的弧线，长到小腿；尾巴腹面浅蓝色，缝着几道平行的白色细条纹；末端两片宽大的尾鳍，鳍缘是渐变的半透明浅青色硬纱。',
      '气质温柔、优雅又灵动。配色以珍珠白、银白、雾蓝、海蓝、深海蓝为主，银色点缀，不用金色。服装做工精良，面料质感真实细腻，高端商业 Cosplay 摄影。',
      '避免：矮胖、短腿、头大身小、比例失调、衣服廉价粗糙、塑料感。',
    ].join('\n'),
    look: REAL_LOOK, chibi: REAL_CHIBI, whale: true, he: false, purpose: WHALE_PURPOSE, scene: SEA,
    opening: '画面下方先升起一串透亮的气泡和几缕海蓝色的光带，像在水下往上看。气泡越聚越多，在画面中间轻轻散开，她从光里走出来，身后的鲸鱼尾巴道具轻轻一甩，双手在胸前合成一个小小的鲸尾手势，对着镜头笑，停在尾帧的姿势上。气泡和光带是真实的质感，不要卡通。',
  },
  chibi: {
    label: 'Q版鲸鱼娘',
    who: [
      'Q 版二次元角色，大约两头身：头和身体差不多一样大，圆脸，小短手小短腿，圆润可爱又精致。她是一位优雅的成年鲸鱼娘的 Q 版形象。',
      '银白色蓬松长发垂到腰，发尾渐变成透亮的浅海蓝，头顶翘着一根呆毛；左耳前一条小小的三股辫，辫尾一颗小珍珠。',
      '大大的浅海青绿色眼睛，占脸的三分之一，里面有两颗星星似的高光和一圈水波反光；小小的嘴，常张着笑；脸颊两团圆圆的粉色红晕。',
      '头顶右侧一枚比例放大的银色鲸鱼尾巴发饰，两片尾鳍向上扬起，镶着小珍珠，垂两条短短的珍珠流苏，很显眼。',
      '穿一条 Q 版的海浪礼裙：珍珠白立领无袖小上衣，领口银色浪纹；肩上一片深海蓝薄纱小披肩；裙子是蓬蓬的多层薄纱，从珍珠白渐变到雾蓝、海蓝、深海蓝，裙边一圈银色小亮片；裙子正前方绣着一个大大的 DeepSeek 蓝色小鲸鱼标志，Q 版里也一眼能认出来；腰间一条银色细链。',
      '脚上一双银白色圆头小凉鞋，鞋带上一颗小珍珠。脖子上一颗海玻璃水滴吊坠。',
      '身后一条圆滚滚、有光泽的深海蓝色鲸鱼尾巴，几乎和身体一样长，末端翘起来，腹面浅蓝色带白色细纹，尾鳍边缘半透明浅青色。',
      '气质元气、爱闹、有点小得意。配色以珍珠白、银白、雾蓝、海蓝、深海蓝为主，银色点缀。',
      '避免：画面粗糙、线条杂乱、塑料感。',
    ].join('\n'),
    look: '精致的 Q 版二次元插画，大约两头身，大头小身子，圆润可爱，线条干净圆滑，色块柔和，光泽细腻，高细节。',
    chibi: 'Q 版小人（就是她本来的样子），大约两头身，大头小身子，圆润可爱',
    whale: true, he: false, purpose: WHALE_PURPOSE, scene: SEA,
    opening: '一个圆滚滚的海蓝色大泡泡从画面下方慢慢飘上来，在画面中间停住，轻轻一颤，「啵」地破开，Q 版的她从里面蹦出来，在空中转了一圈，小尾巴一翘，稳稳落地，双手比个耶，眨一下眼，停在尾帧的姿势上。泡泡破开时溅出几颗小水珠。',
  },
  pixel: {
    label: '像素鲸鱼娘',
    who: [
      '成年女性鲸鱼娘的 16-bit 像素画立绘，约二十二岁。虽然是像素画，身材比例要像成年女性：身材高挑纤细，约七到八头身，腰线高而纤细，双腿修长笔直，站姿挺拔。',
      '她有一头及腰的银白色长发，用三四个色阶画出光泽，发尾渐变成浅海蓝；侧分刘海，脸侧垂下两缕细长鬓发；左耳前一条细细的三股辫，辫尾一个白色像素点当珍珠。',
      '小巧的脸，像素画的大眼睛是浅海青绿色，每只眼睛里有一两个白色高光像素；眼神温柔，嘴角含笑，脸颊各一个淡粉色像素点。',
      '头顶右侧斜戴一枚银色的鲸鱼尾巴发饰，两片尾鳍向上扬起，用银白和浅蓝两个色阶画出镂空感，尾端垂下两条一格宽的珍珠流苏。',
      '她穿一条像素风的海浪礼裙：上身是珍珠白立领无袖上衣，领口一圈银色像素浪纹，胸前一列小扣子；双肩一层半透明的深海蓝薄纱短披肩（用抖动网点表现透明），边缘像浪花一样卷起；腰间一条银色细链腰带，正中一个小贝壳扣。',
      '裙子是前短后长的不对称剪裁：前摆到膝盖上方，后摆垂到脚踝；裙摆分成好几层，颜色一层层从珍珠白过渡到雾蓝、海蓝、深海蓝，每层边缘一排闪光像素点像海面波光。裙子正面左下方是 DeepSeek 的蓝色小鲸鱼标志，用像素画清楚地画出来，一眼能认出。',
      '腿上是浅色丝袜，脚上是银白色细带高跟凉鞋。脖子上一条珍珠颈链，正中一颗海玻璃水滴吊坠（两三个浅青色像素）。',
      '腰后伸出一条修长的深海蓝色鲸鱼尾巴，长到小腿，向一侧弯出优雅的弧线；尾巴腹面浅蓝色，有几道平行的白色像素细纹；末端两片宽大的尾鳍，鳍缘是浅青色。',
      '气质温柔、优雅又灵动。配色以珍珠白、银白、雾蓝、海蓝、深海蓝为主，银色点缀，不用金色；整套调色板不超过 32 色。',
      '避免：矮胖、短腿、头大身小、比例失调、像素格大小不一、模糊、抗锯齿、写实质感。',
    ].join('\n'),
    look: PIXEL_LOOK, chibi: PIXEL_CHIBI, whale: true, he: false, purpose: WHALE_PURPOSE, scene: PIXEL_SEA,
    clip: '保持 16-bit 像素画风：像素格子大小全程不变，颜色是平涂的色块，动作按帧一格一格地动，不要平滑插帧，不要运动模糊，不要变成写实或普通动画。',
    opening: '一道像素浪花从画面下方一格一格地涌上来，浪尖碎成方块水花；一条深海蓝的像素鲸鱼尾巴从浪里升起来，用力一拍，水花四溅，她从水花里跳出来，落地，对着镜头挥手微笑，停在尾帧的姿势上。全程是像素画，像素格大小不变，水花是浅蓝和白色的方块。（不想做视频：在「像素动画」里选自带的「鲸尾出水」当开机动画，也是这个感觉。）',
  },
  gf: {
    label: '真人女友',
    who: [
      '写实真人摄影，角色设定图。一位虚构的成年亚洲女性，约二十五岁，不像任何真实的明星或公众人物。身高约 166 厘米，身材纤细高挑，肩颈线条好看，腰细腿长，比例优美，体态轻盈。',
      '深栗色长发到胸口下方，自然的大波浪，发丝有光泽；轻薄的空气刘海；左侧耳上别一枚小小的珍珠发夹。',
      '小巧的鹅蛋脸，五官柔和精致；温柔的杏眼，深棕色瞳孔，淡淡的卧蚕；笑起来右边脸颊有一个浅浅的酒窝。妆容是清透的日常妆：浅杏色眼影，豆沙色唇釉，淡淡的腮红。',
      '上身是一件奶油白色细针织开衫，羊绒质感，V 领，一排浅木色牛角扣，袖子长到手背；里面是一件浅燕麦色真丝质感的圆领上衣。',
      '下身是一条浅杏色高腰缎面半身长裙，长度到小腿中部，走动时有柔和的垂坠感和光泽。',
      '脚上是一双裸色尖头低跟鞋，让腿部线条更修长。',
      '细金色锁骨链，吊坠是一弯小小的月亮；右耳一颗小珍珠耳钉；左手腕一只棕色细皮表带的小圆表；右手无名指一枚细细的素银戒。',
      '气质温柔、爱笑、有一点小迷糊，像下班路上会顺手给你带一杯热奶茶的女朋友。',
      '整体配色：奶油白、燕麦色、浅杏色，暖色调，干净有质感。面料质感真实细腻。',
      '避免：矮胖、短腿、头大身小、比例失调、衣服廉价粗糙、塑料感。',
    ].join('\n'),
    look: REAL_LOOK, chibi: REAL_CHIBI, whale: false, he: false,
    purpose: '这是为deepseek-harness设计真人女友角色的素材之一，要求：',
    scene: {
      窗边: '洒满午后阳光的公寓窗边',
      窗外: '安静的街道、一排梧桐树和几朵云',
      远处: '街景',
      窗外动: '窗外的梧桐叶轻轻摇动，阳光的光斑在窗台上慢慢移动',
      夜景: '远处城市的点点灯火和夜空',
      夜景动: '远处的灯火微微闪烁，夜空里的云慢慢飘',
      色调: '以奶油白和暖木色为主',
      皮肤底: '午后阳光透过纱帘落在浅色墙面上的柔和光影，颜色是很浅的奶油白到浅杏色的柔和渐变',
    },
    opening: '一阵暖风从画面左边吹过来，带着几片浅粉色的花瓣。她从画面右边走进来，被风吹得抬手拢了一下头发，转过身看到镜头，眼睛一亮，把耳边的头发别到耳后，笑着轻轻挥挥手，停在尾帧的姿势上。花瓣慢慢飘出画面。',
  },
  bf: {
    label: '真人男友',
    who: [
      '写实真人摄影，角色设定图。一位虚构的成年亚洲男性，约二十七岁，不像任何真实的明星或公众人物。身高约 183 厘米，宽肩窄腰，身材修长结实，腿长，体态挺拔。',
      '黑色短发，两侧剪短，头顶稍长、自然蓬松地向后梳，额前垂下几缕碎发，发型干净利落。',
      '脸型轮廓分明，五官端正立体：浓而整齐的眉毛，眼睛明亮温和，内双，鼻梁挺直，下颌线清晰，胡子刮得很干净；笑起来眼睛弯弯的。',
      '上身是一件质感很好的白色圆领 T 恤，外面敞穿一件剪裁合身的浅灰蓝色亚麻衬衫，袖子挽到小臂，左胸一个贴袋。',
      '下身是卡其色高腰直筒西装裤，九分，裤线笔直，露出一点脚踝；深棕色细皮带，银色扣。',
      '脚上是一双白色皮质低帮小白鞋，干净没有褶皱。',
      '左手腕一只银色表盘、深棕色皮表带的手表；右手腕一根黑色编织绳手链。',
      '气质温柔可靠，话不多但爱笑，会记得你说过的小事，像周末会陪你去散步的男朋友。',
      '整体配色：白、浅灰蓝、卡其、深棕，干净清爽。面料质感真实细腻。',
      '避免：矮胖、短腿、比例失调、衣服廉价粗糙、塑料感。',
    ].join('\n'),
    look: REAL_LOOK, chibi: REAL_CHIBI, whale: false, he: true,
    purpose: '这是为deepseek-harness设计真人男友角色的素材之一，要求：',
    scene: {
      窗边: '书房的大窗边',
      窗外: '远处的城市天际线、蓝天和几朵云',
      远处: '城市',
      窗外动: '窗外的云非常缓慢地移动，阳光在书桌上轻轻晃动',
      夜景: '城市的夜景和点点灯火',
      夜景动: '远处的灯火微微闪烁，夜空里的云慢慢飘',
      色调: '以浅灰、藏青和暖木色为主',
      皮肤底: '清晨的浅色亚麻布纹理上落着淡淡的窗格光影，颜色是很浅的灰白到浅雾蓝的柔和渐变',
    },
    opening: '他从画面右边走进来，一只手拎着搭在肩上的外套，另一只手插在裤兜里。走到画面中间停下，像是听到有人叫他，转过头看向镜头，笑了一下，把外套换到另一只手，抬手打个招呼，停在尾帧的姿势上。',
  },
}

export const DEFAULT_WHO = Object.fromEntries(GUIDE_STYLES.map(st => [st, TEMPLATES[st].who])) as Record<GuideStyle, string>
export const STYLE_LABEL = Object.fromEntries(GUIDE_STYLES.map(st => [st, TEMPLATES[st].label])) as Record<GuideStyle, string>
/** Is this template our whale girl (the three must-haves go into its prompts)? */
export const isWhale = (style: GuideStyle) => TEMPLATES[style].whale

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
  { id: 'desktop', title: '三、桌面（壁纸里）', about: '铺满整个屏幕，在所有窗口后面。她在场景里：窗边、书桌、夜晚的窗外。' },
  { id: 'pet', title: '四、宠物（浮在桌面上、网页里的桌宠）', about: '只有她自己，背景透明，浮在所有窗口上面，能拖、能点。' },
  { id: 'intro', title: '五、开机动画', about: '她出场时播一次的短片。六套模版各有自己的开机画面；也可以不用视频，在「像素动画」里选一个用代码画的。' },
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
    rules: ['正面、全身、站姿挺拔自然、双手自然下垂、嘴闭合。', '纯白背景，光线均匀，没有阴影。', '多生成几次，挑最满意的一张，后面都用它。'],
    how: '只用提示词。把「人物」换成你自己的设定（素材指南页面顶上填一次，下面每条都会带上）。',
    prompt: `${WHO}\n\n角色定妆照：正面全身，自然优雅的站姿，身体挺拔，重心落在一条腿上，双手自然垂在身体两侧，看向镜头，嘴巴闭合，温柔的浅笑。\n纯白背景，完全均匀，没有地面线、阴影和任何物体。光线柔和均匀。\n竖版构图 2:3，人物居中，头顶和脚下各留一点空白。${STYLE}\n${NO_TEXT}`,
    upload: '留在自己电脑上当参考图（也可以传到 素材库 → 三视图 里存着）。',
  },
  {
    id: 'base-sheet', group: 'base', title: '三视图（正面、侧面、背面）', where: '显示在「总览」里她的名片旁；更重要的是：以后做任何图和视频，都把它传给工具当参考。', tool: '生图',
    size: '2048×1152（横版 16:9）', format: 'PNG',
    rules: ['同一张图里三个全身像：正面、右侧面、背面，从左到右排开。', '三个像一样高，脚踩在同一条线上，姿势都是自然站立（手臂略微张开，方便看清衣服）。', '纯白或浅灰背景，不要文字标注。', '发型、服装、配饰〔、尾巴〕在三个角度要对得上。'],
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
    rules: ['脚不离开原地：眨眼、轻轻左右晃〔、尾巴摆〕。', '首尾帧都用「头像·站姿图」（绿背景那张）。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她站在原地：慢慢眨两次眼，身体轻轻左右晃一晃，〔尾巴摆了摆，〕头微微歪一下。动作小而可爱。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 头像，名字如「站着」，然后点「抠掉背景」。', stage: '编排 → 头像 → 初始（和走动、翻跟头、打滚一起选上，选「随机」）。',
  },
  {
    id: 'avatar-walk', group: 'avatar', title: '头像·来回走动', where: '在对话框上溜达，和「站着」轮着播。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '5–6 秒，循环',
    rules: ['走的范围不出画面：向左走两三步，转身，走回原位，转回正面。', '脚一直踩在画面最下沿那条线上。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她迈着小步子向画面左边走了两三步，〔尾巴一甩一甩；〕停下来转个身，再走回原来的位置，转回正面看向镜头。脚一直踩在画面最下沿，不离开画面。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 头像，名字如「走动」，然后点「抠掉背景」。', stage: '编排 → 头像 → 初始（随机）。',
  },
  {
    id: 'avatar-flip', group: 'avatar', title: '头像·翻跟头', where: '偶尔翻一个，和「站着」轮着播。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '3–4 秒',
    rules: ['原地向前翻一个跟头，稳稳落地，回到站姿。', '整个人一直在画面里，不出边。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她蹲下一点，原地向前翻了一个圆滚滚的跟头，〔尾巴跟着画了个圈，〕稳稳落地，张开双手得意地笑，然后回到原来的站姿。整个人一直在画面里。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 头像，名字如「翻跟头」，然后点「抠掉背景」。', stage: '编排 → 头像 → 初始（随机）。',
  },
  {
    id: 'avatar-roll', group: 'avatar', title: '头像·打滚', where: '偶尔打个滚，和「站着」轮着播。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '4–5 秒',
    rules: ['躺下，打一个滚，坐起来，站回原位。', '一直在画面下半部分，不出边。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她侧身躺倒，在原地开心地打了一个滚，〔尾巴拍了拍地面，〕坐起来伸个小懒腰，再站起来回到原来的站姿。一直在画面下半部分。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 头像，名字如「打滚」，然后点「抠掉背景」。', stage: '编排 → 头像 → 初始（随机）。',
  },
  {
    id: 'avatar-speak', group: 'avatar', title: '头像·说话', where: '她出声说话的时候。', tool: '图生视频',
    size: '512×512（正方形 1:1）', format: 'MP4（纯绿背景）→ 抠掉背景', length: '4–6 秒，循环',
    rules: ['站在原地，嘴一张一合，配一点手势。', '不要真的对口型：声音是程序合成的，这段只是「在说话」的样子。'],
    how: '首帧、尾帧都传「头像·站姿图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她站在原地看着镜头说话：嘴巴自然地一张一合，说得轻快，不时点一下头，两只小手比划着〔，尾巴轻轻摆〕。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
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
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她在思考：眼睛看向斜上方，一根手指点着下巴，原地踱了一小步又回来〔，尾巴慢慢摆〕。\n${LOOP}${GREEN}${NO_TEXT}`,
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
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面里是${Q}。她困了：打一个小小的哈欠，用手背揉揉眼睛，站着头一点一点地打瞌睡，〔尾巴也耷拉下来，〕又努力睁开眼。\n${LOOP}${GREEN}${NO_TEXT}`,
    upload: '素材库 → 头像，名字如「困了」，然后点「抠掉背景」。', stage: '编排 → 加一个场景，时机选「时间段」，填 23-6。',
  },
  // ── desktop ─────────────────────────────────────────────────────────
  {
    id: 'desktop-still', group: 'desktop', title: '桌面·场景图', where: '铺满整个屏幕的壁纸位置；也是下面桌面视频的首尾帧。只传这张图也行：她就是一张会呼吸的壁纸。', tool: '生图',
    size: 'Mac：2560×1600（16:10）；Windows：2560×1440（16:9）', format: 'PNG 或 JPG',
    rules: ['她在画面右侧三分之一，左边留空：桌面图标一般在左边。', '画面上方不要有重要内容（Mac 的菜单栏在那儿）。', '色调柔和、不刺眼：这是一整天都看着的背景。'],
    how: '把「三视图」传给工具当参考图。',
    prompt: `参考图是这个角色的三视图。${SAME}\n\n一张桌面壁纸：她坐在{窗边}，侧身看向窗外，一只手托着腮，窗外是{窗外}，窗帘被风轻轻吹起。她在画面右侧三分之一处，左边三分之二是窗台、{远处}和天空，留得很空。\n横版 16:10，色调柔和明亮，{色调}。${STYLE}\n${NO_TEXT}`,
    upload: '素材库 → 桌面。', stage: '编排 → 桌面 → 初始。',
  },
  {
    id: 'desktop-day', group: 'desktop', title: '桌面·白天（循环视频）', where: '壁纸位置，一直循环。', tool: '图生视频',
    size: '和场景图一样：2560×1600 或 2560×1440（工具出不了这么大就 1920×1200 / 1920×1080）', format: 'MP4', length: '8–10 秒，循环',
    rules: ['动的东西要少、要慢：窗帘、窗外、云、她的头发和呼吸。', '她不要走动、不要大动作。'],
    how: '首帧、尾帧都传「桌面·场景图」。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n画面很安静：窗帘被风轻轻吹动，{窗外动}。她坐在窗边看着窗外，慢慢眨眼，头发被风微微吹动，偶尔换一下托腮的手。所有动作都很慢、很轻。\n${LOOP}${NO_TEXT}不要声音。`,
    upload: '素材库 → 桌面，名字如「窗边白天」。', stage: '编排 → 桌面 → 初始。',
  },
  {
    id: 'desktop-night', group: 'desktop', title: '桌面·夜晚', where: '晚上自动换成这一段。', tool: '图生视频',
    size: '和场景图一样：2560×1600 或 2560×1440（工具出不了这么大就 1920×1200 / 1920×1080）', format: 'MP4', length: '8–10 秒，循环',
    rules: ['先用生图把「桌面·场景图」改成夜晚（同样的构图），再用它做首尾帧。', '夜里的画面要暗一些，不晃眼。'],
    how: '第一步（生图）：传「桌面·场景图」，提示词写「同样的构图和人物，改成夜晚：窗外是{夜景}，屋里亮着一盏暖色的小灯」。第二步（图生视频）：首帧、尾帧都传这张夜晚的图，用下面的提示词。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n夜晚，很安静：{夜景动}，小灯的暖光轻轻晃动。她抱着膝盖坐在窗边看着窗外，慢慢眨眼，头发微微动。所有动作都很慢。\n${LOOP}${NO_TEXT}不要声音。`,
    upload: '素材库 → 桌面，名字如「窗边夜晚」。', stage: '编排 → 加一个场景「夜晚」，时机选「时间段」，填 19-6。',
  },
  {
    id: 'desktop-away', group: 'desktop', title: '桌面·你不在的时候', where: '你离开电脑一阵子以后。', tool: '图生视频',
    size: '和场景图一样：2560×1600 或 2560×1440（工具出不了这么大就 1920×1200 / 1920×1080）', format: 'MP4', length: '8–10 秒，循环',
    rules: ['她在做自己的事：看书、趴着睡、玩手机。'],
    how: '先用生图做一张同构图的「她趴在窗台上睡着了」，再用它做首尾帧。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n她趴在窗台上睡着了：肩膀随着呼吸慢慢起伏，〔尾巴偶尔轻轻动一下，〕窗帘缓缓飘动，窗外的光影慢慢变化。非常安静。\n${LOOP}${NO_TEXT}不要声音。`,
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
    rules: ['脚不要动：站在原地。', '动作小：呼吸、眨眼、头发〔和尾巴〕轻摆。', '背景全程是同一种纯绿色，身上不要出现绿色。'],
    how: '首帧、尾帧都传「宠物·站姿图」（绿背景那张）。',
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n她站在原地，双脚不动：自然地呼吸，慢慢眨眼，头发〔和尾巴〕轻轻摆动，身体微微左右晃一下。动作很小。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
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
    prompt: `首帧和尾帧是同一张图。${STILL_CAMERA}\n\n她坐在地上抱着膝盖睡着了：肩膀随着呼吸慢慢起伏，头轻轻点一下〔，尾巴偶尔动一动〕。非常安静。\n${LOOP}${GREEN}${NO_TEXT}不要声音。`,
    upload: '素材库 → 宠物，名字如「睡着」，然后点「抠掉背景」。', stage: '编排 → 「夜晚」那个场景的宠物格子。',
  },
  // ── intro ───────────────────────────────────────────────────────────
  {
    id: 'intro', group: 'intro', title: '开机动画', where: '她出场时在屏幕中间播一次（约占屏幕一半大），播完自己消失。', tool: '图生视频',
    size: '1280×800（16:10）或 1280×720', format: 'MP4；想要透明就用纯绿背景，传好后点「抠掉背景」', length: '3–5 秒，不循环',
    rules: ['有头有尾：从没有到出现，最后停在一个好看的姿势上。', '短：超过 5 秒就嫌长了。'],
    how: '尾帧传「宠物·站姿图」或「定妆照」（首帧可以不给，让工具自己发挥出场方式）。',
    prompt: `尾帧是参考图。${STILL_CAMERA}\n\n{开场}\n${GREEN}${NO_TEXT}不要声音。`,
    upload: '皮肤 → 开机动画 → 上传。',
  },
  // ── skin ────────────────────────────────────────────────────────────
  {
    id: 'skin-bg', group: 'skin', title: '皮肤背景图', where: 'dsh 整个界面的背景，文字都叠在上面。', tool: '生图',
    size: '2560×1600（16:10）', format: 'JPG 或 WebP，1 MB 以内',
    rules: ['细节要少、对比要低：上面要放很多字。', '做两张更好：一张浅色的（配浅色模式）、一张深色的（配深色模式）。', '不要有人物的脸：她自己会出现在界面上。'],
    how: '只用提示词。',
    prompt: `一张用作软件界面背景的图：{皮肤底}。细节很少，对比度很低，整体干净、安静。\n横版 16:10。没有人物，没有物体。${NO_TEXT}`,
    upload: '皮肤 → 上传皮肤（和 skin.json 放在同一个文件夹里）。', noHer: true,
  },
]

/** Which of our templates this description is, or none (the user's own). Empty means the template's own. */
const templateOf = (who: string, style: GuideStyle): GuideStyle | undefined =>
  who.trim() === '' ? style : GUIDE_STYLES.find(st => TEMPLATES[st].who === who.trim())

/**
 * A text of the guide for one template: the tail lines 〔…〕 only for the
 * whale girl, its own scenes and opening, and 他 for him.
 */
export function adapt(text: string, style: GuideStyle = 'anime'): string {
  const t = TEMPLATES[style]
  let out = text.replace(/〔([^〕]*)〕/g, (_, kept: string) => t.whale ? kept : '')
  for (const [key, value] of Object.entries(t.scene)) out = out.split(`{${key}}`).join(value)
  out = out.split('{开场}').join(t.opening)
  return t.he ? out.replace(/她/g, '他') : out
}

/** The prompt with the character's description in it, drawn in `style`. */
export function fillPrompt(prompt: string, who: string, style: GuideStyle = 'anime'): string {
  const t = TEMPLATES[style]
  return adapt(prompt, style)
    .split(WHO).join(who.trim() === '' ? t.who : who.trim())
    .split(STYLE).join(t.look)
    .split(Q).join(t.chibi)
}

/** The line in front of a prompt that says what it is for (it helps the tool keep to the brief). */
export function purposeLine(who: string, style: GuideStyle = 'anime'): string {
  const ours = templateOf(who, style)
  return ours === undefined ? '这是为deepseek-harness设计的角色素材之一，要求：' : TEMPLATES[ours].purpose
}

/**
 * A material's whole prompt, to paste as it is: what it is for (when
 * `purpose`), the prompt with your character in it, the three things every
 * picture of her keeps (our whale girl only), and its size (and, for a clip,
 * how long), so nothing has to be typed into the tool beside it.
 */
export function promptFor(item: GuideItem, who: string, purpose = true, style: GuideStyle = 'anime'): string {
  const size = item.tool === '图生视频'
    ? `视频尺寸：${item.size}${item.length === undefined ? '' : `；时长：${item.length}`}。`
    : `图片尺寸：${item.size}；格式：${item.format}。`
  const ours = templateOf(who, style)
  const must = item.noHer === true || ours === undefined || !TEMPLATES[ours].whale ? [] : [MUST]
  const clip = item.tool === '图生视频' ? TEMPLATES[style].clip : undefined
  return [...(purpose ? [purposeLine(who, style)] : []), fillPrompt(item.prompt, who, style), ...(clip === undefined ? [] : [clip]), ...must, size].join('\n')
}

/** The whole guide as a document (docs/素材规格与提示词.md). */
export function guideMarkdown(own?: string, style: GuideStyle = 'anime'): string {
  const text = (s: string) => adapt(s, style)
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
    ...(own === undefined
      ? [
        '## 六套初始模版',
        '',
        `我们给了六套模版：${GUIDE_STYLES.map(st => `**${STYLE_LABEL[st]}**`).join('、')}。下面每条提示词都有六版，点开你要的那一版复制。换成你自己的人物：在 dsh 的素材指南页面里选一套最接近的模版，把人物设定改成你的。`,
        '',
        '四套鲸鱼娘的每一张图、每一段视频，都**必须保留这三样**：头顶的鲸鱼尾巴发饰；裙子（或短裤、长裤）上的 DeepSeek 蓝色小鲸鱼标志；身后的蓝色鲸鱼尾巴。提示词里已经写上了。真人女友和真人男友是虚构的成年人，不像任何真实的人。',
        '',
        '每套各有自己的场景和开机画面：鲸鱼娘在海边（像素版在像素海边小屋），女友在洒满阳光的公寓，男友在书房；开机画面分别是浪花、气泡和光带、大泡泡、像素浪花和鲸尾、带花瓣的风、走进画面打招呼。像素鲸鱼娘要在「像素动画」页打开「像素化显示」，她在屏幕上才是干净整齐的像素格。',
        '',
        ...GUIDE_STYLES.flatMap(st => [`**${STYLE_LABEL[st]}：**`, '', '```', DEFAULT_WHO[st], '```', '']),
        '下面「要求」「怎么做」这些说明按二次元鲸鱼娘写；女友和男友没有尾巴，场景按各自的来，提示词里都已经换好了。',
        '',
      ]
      : ['## 你的人物', '', '```', own, '```', '']),
  ]
  for (const group of GUIDE_GROUPS) {
    out.push(`## ${group.title}`, '', text(group.about), '')
    for (const item of GUIDE.filter(i => i.group === group.id)) {
      out.push(
        `### ${text(item.title)}`, '',
        `- **用在哪儿**：${text(item.where)}`,
        `- **用什么做**：${item.tool}`,
        `- **尺寸**：${item.size}`,
        `- **格式**：${item.format}`,
        ...(item.length === undefined ? [] : [`- **时长**：${item.length}`]),
        `- **要求**：`, ...item.rules.map(rule => `  - ${text(rule)}`),
        `- **怎么做**：${text(item.how)}`,
        `- **做好后**：${text(item.upload)}${item.stage === undefined ? '' : ` 然后：${text(item.stage)}`}`,
        ...(own !== undefined
          ? ['', '提示词（直接复制）：', '', '```', promptFor(item, own, true, style), '```', '']
          : ['', ...GUIDE_STYLES.flatMap(st => [`<details><summary>提示词·${STYLE_LABEL[st]}</summary>`, '', '```', promptFor(item, DEFAULT_WHO[st], true, st), '```', '', '</details>', ''])]),
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
