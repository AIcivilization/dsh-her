# 一起来做 dsh-her

谢谢你愿意帮忙。dsh-her 是一个**身体引擎**：引擎负责让角色会动、会说、会听、会先开口、记得你；角色长什么样、怎么编排，由设计者用[设计包](docs/设计包格式.md)装进来。所以有两种参与方式，都很重要：

- **写代码**：修 bug、加功能、支持新平台、接新的声音。
- **做设计，不用写代码**：设计包（人设、三视图、动画素材、编排）、皮肤、开机动画、像素动画、提示词。

不需要先打招呼，也不用加群。挑一件事，直接做，做好了提 PR 或者投稿就行。

## 从哪儿开始

- [新手可做](https://github.com/AIcivilization/dsh-her/labels/good%20first%20issue)：范围小、说明写清楚了的事。
- [欢迎帮忙](https://github.com/AIcivilization/dsh-her/labels/help%20wanted)：大一点的事，比如英文界面、Intel 芯片的 Mac、Linux 桌面程序。
- 想做别的：先[开一个 issue](https://github.com/AIcivilization/dsh-her/issues/new/choose) 写一下你打算怎么做，免得做到一半发现方向不对。改错字、补文档这种小事直接提 PR。

做一件事之前，在那个 issue 下面留一句"我来做"，别人就不会重复做。

## 做设计（不写代码）

1. 看 [设计包格式](docs/设计包格式.md) 和 [素材规格与提示词](docs/素材规格与提示词.md)。在「她」→ 外观 → 素材指南里，每样素材都有尺寸、规则和可以直接复制的提示词。
2. 像素动画是一个 `.js` 文件。在设置页里复制「给大模型的说明」，告诉大模型你想要什么画面，让它写；做法见 [像素动画设计](docs/像素动画设计.md)。
3. 在自己的 dsh-her 里导入、试好，再从设置页导出设计包。
4. 设计包放在**你自己的**仓库、Release 或网盘里，然后用「[设计包投稿](https://github.com/AIcivilization/dsh-her/issues/new?template=design-pack.yml)」告诉我们。我们只放链接和介绍，不把图片、视频收进这个仓库。

几条规矩：

- 要原创，或者你有权分享。不要用别人的角色、别人的画；参考可以，照搬不行。
- 写明许可（比如 CC BY 4.0、CC BY-SA 4.0），别人才知道能不能改、能不能再分享。
- 角色都是成年人，穿着得体。
- 用真人的脸或声音，要有本人同意。

## 写代码

### 准备

- Node.js 22 或更新。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）0.2 或更新。
- 桌面程序（`body/`）现在能在 macOS（Apple 芯片）和 Windows 上打包；Linux 上先用网页身体。

```bash
git clone https://github.com/AIcivilization/dsh-her.git
cd dsh-her
npm install
npm run typecheck
npm test
npm run build
```

桌面程序：

```bash
cd body
npm install
npm run build
```

### 在 dsh 里跑起来

用一个单独的测试 profile，数据放在 `~/.dsh-her-dev`，不会碰你正在用的 `~/.dsh-her`：

```bash
dsh plugin --profile her-dev add link:/你的路径/dsh-her
dsh --profile her-dev --no-open --port 3191
```

profile 怎么配、声音和语音识别模型怎么装，见 [开发说明](docs/开发.md)。整个项目是怎么分的（大脑在 `src/`，桌面身体在 `body/`，两边怎么说话），见 [身体协议](docs/身体协议.md) 和 [产品定义](docs/产品定义.md)。

### 测一测

- `npm run typecheck` 和 `npm test` 都要过。CI 会在 Linux、Windows、macOS 上跑，还会在没有桌面的机器上跑网页身体，并打包启动一次 Windows 桌面程序。
- 改了界面，在 dsh 里打开「她」页面看一眼，手机宽度也看一眼。
- dsh 桌面版启动插件时，`PATH` 里只有系统目录。要测出这种问题，用干净的环境启动：

  ```bash
  env -i HOME="$HOME" USER="$USER" SHELL=/bin/zsh TMPDIR="$TMPDIR" PATH=/usr/bin:/bin:/usr/sbin:/sbin dsh --profile her-dev --no-open --port 3191
  ```

  （这一行要能找到 `dsh` 和 `node`：可以建一个文件夹，放两个指向它们的链接，把文件夹加在 `PATH` 最前面。）

### 规矩

- **仓库只放代码。** 图片、视频、声音、模型、压缩包都不进仓库（`.gitignore` 已经挡住了）。演示素材放在 Release 附件或你自己的文件夹里。
- **不收集数据。** 不加统计、不加上报。她的记忆和设置只存在用户自己的电脑上。
- **密钥不进文件。** API key 在 Mac 上存进钥匙串，别的系统用环境变量；不打进日志，不写进普通配置。
- **只连本机。** 桌面程序只连 `127.0.0.1`，不要打开局域网端口。
- **给普通人用。** 界面上的字写成不懂技术的人也能看懂的话；不要让用户去改配置文件或者敲命令。
- **改动小一点。** 一个 PR 做一件事，更容易看，也更快合并。

## 提 PR

1. Fork，开一个分支。
2. 改好，`npm run typecheck`、`npm test` 都过。
3. 提 PR，按模板写清楚：改了什么、为什么改、怎么测的；改了界面的话，附一张截图。截图放在 PR 里就好，不要放进仓库。
4. CI 全过后，维护者看过就合并。中文、英文都可以。

## 成为协作者

合并过两三个 PR，或者投稿的设计包被收进推荐的人，我们会邀请你成为仓库的**协作者**：可以帮忙整理 issue、看别人的 PR、直接开分支。`main` 分支还是要 CI 全过、有人看过才能合并，所以不用担心改坏。

## 许可

你提交的代码按本仓库的 [MIT 许可](LICENSE) 发布。设计包用你自己选的许可。
