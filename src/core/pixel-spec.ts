/**
 * 给大模型的说明 (docs/像素动画设计.md §3): what to paste to a model so that
 * the file it writes plays here. Pure.
 */

import { EXAMPLE_PIXEL } from './pixel-builtins.ts'
import { PIXEL_LIMITS } from './pixel.ts'

export function pixelSpec(): string {
  return `请帮我写一个「dsh-her 像素动画」文件（JavaScript）。我想要的动画是：【在这里写你想要的画面，比如：一只像素小鲸鱼从左边游到右边，吐出几个泡泡】

${pixelFormat()}`
}

/** The format and its rules, without the request (像素工坊's AI gets this). */
export function pixelFormat(): string {
  return `## 这是什么

dsh-her 会运行这个文件，每一帧调用一次 frame(g, t, n)。你只需要往一张粗格子（比如 192 × 108 格）里填数，不用管屏幕大小和颜色：引擎会把格子画成方块、圆点或代码小字，颜色由用户选。

## 文件格式（必须照这个写）

\`\`\`js
export const info = {
  name: '动画名字',
  author: '',            // 可选
  grid: [192, 108],      // 宽 × 高（格），都是 8 以上的整数，最大 ${PIXEL_LIMITS.w} × ${PIXEL_LIMITS.h}；用「圆点」画法时建议不超过 192 × 108
  fps: 24,               // 每秒几帧，1–${PIXEL_LIMITS.fps}
  seconds: 4,            // 一遍多长（秒）；当开机动画最长 ${PIXEL_LIMITS.seconds} 秒；0 表示一直循环（只能当背景）
  loop: 2,               // 可选：画面每隔几秒回到一模一样（比如 Math.sin(t * Math.PI) 是 2 秒）；导出 GIF 时按它录一圈，首尾正好接上。不知道就不写
  color: 'mono',         // 'mono'：每格只给亮度（推荐，颜色由用户选）；'color'：每格自己给颜色（只能画成方块）
}

export function setup(g) { }        // 可选：开始前调用一次，准备数据
export function frame(g, t, n) { }  // 每帧调用：t 是秒（从 0 开始），n 是第几帧
\`\`\`

## g 能用的东西

- g.w、g.h：格子的宽、高
- g.clear()：全部清空；g.fade(k)：所有格子的透明度乘以 k（0–1），用来做拖尾
- g.set(x, y, v = 1, a = 1)：填一格。v 是亮度 0–1（color 模式下也可以写 '#rrggbb'），a 是透明度 0–1；a = 0 等于擦掉
- g.rgb(x, y, r, g, b, a = 1)：color 模式下按 0–255 给颜色
- g.rect(x, y, w, h, v, a)、g.circle(cx, cy, r, v, a)、g.line(x0, y0, x1, y1, v, a)：方块、实心圆、线
- g.text(x, y, '文字', v, a)：5 × 7 像素字，只有英文字母、数字和常用符号（小写会画成大写），每个字占 6 格宽；返回画了多宽
- g.sprite(x, y, 图, 选项)：画一张像素图（画角色、动物、物件就用它）。图是一组字符串，一个字符一格：'.' 和空格不画；'1'–'9' 是亮度（9 最亮，'0' 是全暗，会盖住下面）；'#' 和字母默认最亮。选项都可以不写：{ scale: 3（每格放大几倍）, flip: true（左右翻转）, flipY: true（上下翻转）, center: true（x、y 是图的中心）, palette: { a: '#ffcc00', b: 0.5 }（字母的颜色或亮度；单色动画里颜色按深浅算）, a: 1（透明度）}。返回画了多宽
- g.get(x, y)：读一格（亮度 × 透明度，0–1）
- g.random()：随机数 0–1，每次播放结果一样
- g.noise(x, y, z)：平滑噪声 0–1，用来做水、云、火、闪烁
- g.ease.linear / in / out / inOut / outBack / sine (p)：缓动，p 是 0–1
- 坐标可以是小数，会取整；超出格子的会自动忽略；后画的盖住先画的
- 也可以用 Math 里的所有东西

## 画角色、动物、物件

先用 g.sprite 画像素图，比用圆和线拼像得多。动起来靠移动、翻转、放大缩小，以及换图：多画几张（睁眼、眨眼；张嘴、闭嘴；迈左脚、迈右脚），按时间轮着用。比如：

\`\`\`js
const FISH = [          // 头朝右，'0' 是眼睛
  '....9999...',
  '9.99999999.',
  '.9999999909',
  '9.99999999.',
  '....9999...',
]
// 在 frame 里：从左游到右，到头翻过来游回去
const p = (t / 4) % 2, x = p < 1 ? p * g.w : (2 - p) * g.w
g.sprite(x, g.h / 2 + Math.sin(t * 3) * 4, FISH, { scale: 3, center: true, flip: p >= 1 })
\`\`\`

要细腻，就画大、画细：人物至少 32 行高，info.grid 用 [256, 144] 或更细（最细 [384, 216]），scale 用 1 或 2。用彩色（color: 'color'）时，palette 给每块颜色配三层深浅（亮面、本色、暗面），外面描一圈深色轮廓，眼睛至少 2 × 2 格、加一格高光。

g.sprite 是新加的：用了它的动画，放到很旧的 dsh-her 里会播不了。

## 规矩

1. 只有一个文件，不要 import 任何东西，不要 export default。
2. 没有网络、没有页面：不要用 fetch、document、window、setTimeout、requestAnimationFrame（这些用不了）。动画的快慢全靠参数 t。
3. 每一帧要很快（${PIXEL_LIMITS.frameMs} 毫秒以内）：不要在 frame 里做大量计算，能提前算的放进 setup。
4. 有固定时长的（seconds > 0），要在这段时间里演完；引擎会在开头和结尾自动淡入淡出。seconds 为 0 的会一直播，t 会一直变大，要首尾相接、循环自然。要循环的，周期尽量取整数秒（比如 Math.sin(t * Math.PI * 2 / 3) 是 3 秒一圈），把这一圈的秒数写进 info.loop。
5. 画面要在黑色和白色背景上都好看：mono 模式下，亮度 v 越大越显眼，没画的格子是透明的。
6. 最后只给我完整的代码文件，不用解释。

## 一个完整的例子

\`\`\`js
${EXAMPLE_PIXEL.trim()}
\`\`\`
`
}
