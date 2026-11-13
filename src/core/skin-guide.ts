/**
 * What a skin is made of, said once (docs/设置页与编排设计.md §18): the 皮肤
 * page's "自己做一套", the README in the template zip, and the questions the
 * AI asks when it makes one with you all come from here.
 */

/** dsh's colours a skin sets most often, and what each one paints. */
export const SKIN_TOKENS: Array<{ name: string; what: string }> = [
  { name: '--dsw-alias-bg-base', what: '整个页面的底色（有背景图时被背景图盖住）' },
  { name: '--dsw-alias-bg-layer-1', what: '卡片、对话区、弹出框的底色' },
  { name: '--dsw-alias-bg-layer-2', what: '第二层：卡片里的小块、鼠标停上去的颜色' },
  { name: '--dsw-specific-sidebar-fill', what: '左边栏的底色' },
  { name: '--dsw-specific-sidebar-nav-item-active', what: '左边栏里选中的那一项' },
  { name: '--dsw-specific-bubble', what: '你发出去的消息气泡' },
  { name: '--dsw-specific-input-major', what: '底部的输入框' },
  { name: '--dsw-alias-brand-primary', what: '品牌色：标题、图标上的强调' },
  { name: '--dsw-alias-state-business-primary', what: '主按钮、选中、开关打开时的颜色' },
  { name: '--dsw-alias-link', what: '链接' },
  { name: '--dsw-alias-label-primary', what: '主要文字（一般不用改，改了注意看得清）' },
  { name: '--dsw-alias-label-secondary', what: '次要文字、说明文字' },
  { name: '--dsw-alias-border-l2', what: '分隔线、边框' },
]

/** The skin.json in the template: every field, with values that work. */
export const SKIN_TEMPLATE = {
  name: '我的皮肤',
  author: '你的名字',
  colors: {
    '--dsw-alias-bg-base': { light: '#fdf6f8', dark: '#1a1216' },
    '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#22181d' },
    '--dsw-alias-bg-layer-2': { light: '#fbeef2', dark: '#2b1f25' },
    '--dsw-specific-sidebar-fill': { light: '#f8e8ee', dark: '#170f13' },
    '--dsw-specific-sidebar-nav-item-active': { light: '#f2d6e0', dark: '#3a2630' },
    '--dsw-specific-bubble': { light: '#f6dce6', dark: '#3d2631' },
    '--dsw-specific-input-major': { light: '#ffffff', dark: '#241a1f' },
    '--dsw-alias-brand-primary': { light: '#b03a64', dark: '#ffa3c4' },
    '--dsw-alias-state-business-primary': { light: '#d0487a', dark: '#ff8db6' },
    '--dsw-alias-link': { light: '#c03f70', dark: '#ff9cc1' },
  },
  background: { file: 'background.svg', dim: 0, dark: { dim: 0.15 } },
  bar: {
    background: { light: 'rgba(255,247,250,0.97)', dark: 'rgba(30,20,26,0.96)' },
    text: { light: '#4a2233', dark: '#ffe8f0' },
    accent: { light: '#d0487a', dark: '#ff8db6' },
  },
}

/** The template's background: a light pattern drawn as SVG, so it can be changed by hand or by the AI. */
export const SKIN_TEMPLATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <g fill="#f4c6d6" opacity="0.35">
    <circle cx="180" cy="160" r="90"/><circle cx="1420" cy="140" r="60"/><circle cx="1320" cy="820" r="120"/><circle cx="260" cy="860" r="50"/>
  </g>
</svg>
`

/** How to make one by hand, step by step (the 皮肤 page shows the same). */
export const SKIN_STEPS: Array<{ title: string; text: string }> = [
  { title: '下载模板', text: '一个 zip，里面是能直接用的 skin.json、一张背景图（background.svg）和说明。解压后文件夹名就是皮肤的 id（只用字母、数字、中文和 -）。' },
  { title: '改颜色', text: '在 skin.json 的 colors 里改，每个颜色写浅色（light）和深色（dark）两个值，dsh 切换深浅色时跟着换。下面的表说明每个颜色管哪一块；不写的就保持 dsh 原样。' },
  { title: '换背景（可以不要）', text: '把一张图放进文件夹（png、jpg、webp、gif、avif 或 svg，最好和屏幕一样大，比如 2560×1600，1 MB 以内），在 background.file 写它的文件名；dim 是盖在上面的暗度，0 到 0.9，浅色图写 0，深色图写 0.3 左右，字才清楚。图下面垫着皮肤的页面底色，所以透明底的花纹（比如模板里的 SVG）浅色、深色都能用；深色模式想换一张图，写 background.dark.file。不要背景就把 background 整段删掉。' },
  { title: '对话小条和字体（可以不要）', text: 'bar 是她的对话小条和头顶气泡：底色 background、文字 text、强调色 accent。字体放 .woff2 文件进文件夹，写 "font": {"file": "字体.woff2"}；或写电脑上装好的字体名 "font": {"name": "霞鹜文楷"}。要分享的皮肤只放能自由分发的字体。' },
  { title: '上传、试、保存', text: '在皮肤页点"上传皮肤"，选整个文件夹或打成的 zip。传好后点它，整个 dsh 马上换给你看，满意再点保存。写错的地方会列出来，其他照常生效。' },
]

/** The README in the template zip. */
export function skinReadme(): string {
  return [
    '# dsh-her 皮肤模板',
    '',
    '一套皮肤 = 一个文件夹：skin.json + 它用到的图片、字体、视频。',
    '',
    ...SKIN_STEPS.flatMap((step, i) => [`## ${i + 1}. ${step.title}`, '', step.text, '']),
    '## skin.json 里每一项',
    '',
    '- name：显示的名字；author：作者。',
    '- colors：dsh 的颜色，见下表。每个都是 { "light": "…", "dark": "…" }，可以写 #rrggbb、rgb()、rgba()。',
    '- background：{ "file": "文件名", "dim": 0 到 0.9, "dark": { "file": "深色模式用的图（可以不写）", "dim": 深色模式的暗度 } }。图下面垫着 colors 里 --dsw-alias-bg-base 的颜色。',
    '- font：{ "file": "字体文件" } 或 { "name": "装好的字体名" }。',
    '- bar：她的对话小条和气泡，background / text / accent，各写 light 和 dark。',
    '- intro：开机动画，文件夹里一段视频（mp4、webm，2–5 秒）。',
    '- css：再加一个 .css 文件，给想多改一点的人（dsh 改版时可能要跟着改；不能用 url() 和 @import）。',
    '',
    '## 颜色对照表',
    '',
    '| 颜色名 | 管哪一块 |',
    '|---|---|',
    ...SKIN_TOKENS.map(t => `| ${t.name} | ${t.what} |`),
    '',
  ].join('\n')
}

/**
 * The questions the AI asks, one at a time, when it makes a skin with you
 * (the "做一套皮肤" conversation's prompt).
 */
export const SKIN_INTERVIEW = `## 现在要做的事：和用户一起做一套 dsh 皮肤

用户点了"AI 做一套"。你来带着他一步一步定下来，**一次只问一个问题**，每个问题给 3–6 个带编号的选项（加一个"都不是，我说说看"），用户回一个数字或一句话就行。用户中途说"你定吧""随便"，就替他选一个好看的，告诉他你选了什么，接着往下。

按这个顺序问（用户已经说过的就跳过）：
1. **整体色系**：比如 1 海蓝（清爽）2 樱粉（温柔）3 薄荷绿（安静）4 暖杏（温暖）5 墨夜（深色、低调）6 紫藤（梦幻）。也可以说一种喜欢的东西（"像夏天的海边""像抹茶拿铁"），你来配色。
2. **深浅**：1 浅色和深色都做（推荐，dsh 切换深浅色时跟着换）2 主要用浅色 3 主要用深色。两种都要写，只是重心不同。
3. **强调色**：按钮、选中、她的对话小条用的颜色。根据第 1 步给 3 个搭配的候选（写出颜色名和十六进制值）。
4. **装饰**：1 不要，干干净净 2 很淡的纹样（波浪、气泡、星点、樱花瓣、格子……你来画成 SVG）3 一个角落的图案 4 用我自己的图片（告诉他做好皮肤后，把图片放进皮肤文件夹、在 background.file 写上名字，或者在皮肤页重新上传）。选 2、3 时再问一句要什么图案。
5. **背景浓淡**：装饰要不要明显一点（只在有装饰时问）。
6. **字体**：1 跟着 dsh 不变（推荐）2 电脑上装好的某个字体（问名字）。不要替用户找字体文件。
7. **名字**：给这套皮肤起个名字，你先提 2–3 个候选。

问完后：
- 用一小段话复述最后的样子（色系、深浅、强调色、装饰、字体、名字），问"就这样做吗？"。
- 用户说好，就做：
  1. 想一个 id（拼音或英文小写加 -，比如 sakura-pink），不要和已有的重名（先 skin_get 不带 id 看一眼）。
  2. 有装饰就先用 skin_file_set 写 background.svg：viewBox 1600×1000，preserveAspectRatio="xMidYMid slice"，**背景透明，不要铺满整块的底色矩形**（底色由 skin.json 里 --dsw-alias-bg-base 的浅色、深色值垫在下面），只画图案；图案要淡（opacity 0.15–0.4），颜色在浅底和深底上都不刺眼；不要文字，不要外部链接。深色模式想要另一种图案，再写一个 background-dark.svg，在 background.dark.file 引用。
  3. 用 skin_set 写 skin.json：colors 至少写下面这些，每个给 light 和 dark，深色里文字要看得清（底色暗、强调色亮一些）；bar 的 background / text / accent 也写上；有背景图就写 background：dim 写 0，再写 "dark": { "dim": 0.15 }。
  4. 告诉用户做好了，并给他三个选择：**现在就换上**（他说要，就用 skin_wear 换上并保存）、**下载**（用 skin_export 存成 zip 到他电脑的"下载"文件夹，把位置告诉他；他可以发给别人，别人在皮肤页点"上传 zip"就能用；不要自己编链接）、**去皮肤页试看**（点它就整个 dsh 换给他看，不满意点取消）。
- 用户之后说"再深一点""强调色换成紫的"，就读出来（skin_get）、改好、再写回去（skin_set），同名覆盖。

颜色名和它们管的地方：
${SKIN_TOKENS.map(t => `- ${t.name}：${t.what}`).join('\n')}

参考写法（一套能用的 skin.json）：
${JSON.stringify(SKIN_TEMPLATE, null, 1)}

规则：只用你的工具读写皮肤，不要让用户自己去改文件；用中文，句子短，别一次说太多。`
