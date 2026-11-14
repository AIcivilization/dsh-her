# Windows 适配（0.3.0 发布；0.3.1 修了下载；0.3.2 能用下载软件）

> 之前 Windows 只写了一部分代码，从没跑过：插件能装进 Windows 版 dsh，但不会给 Windows 装身体，她出不来。这一轮把缺的补上，由 GitHub 的 Windows 机器自动打包、试启动；真正的显示、壁纸、麦克风要在你的 Win11 上测。

## 改了什么

| 部分 | 改动 |
|---|---|
| 身体打包（`body/scripts/package.mjs`） | 在 Windows 上打包：Electron 的文件夹改名为 `dsh-her`，`electron.exe` 改成 `dsh-her.exe`；身体代码放 `resources\app`，带上壁纸层要用的 koffi（Windows 版）；`ffmpeg.exe` 放 `resources`；用 rcedit 写上名字"她"和图标；打成 `dsh-her-body-<版本>-win32-x64.zip` |
| 图标 | 紫色圆加白色爱心，用代码画（`body/shared/icon.ts`、`body/scripts/ico.mjs`），仓库里没有图片。Windows 托盘以前是空图标（看不见），现在用它；exe 图标也是它 |
| ffmpeg | Windows 用 BtbN 的 **LGPL** 静态版 8.1，下载后按它发布里的校验值核对 |
| 插件下载安装身体（`src/dsh/body-install.ts`） | Windows 用系统自带的 `tar.exe` 解压 zip，启动 `dsh-her\dsh-her.exe`；旧版本的文件被占用时先留着，下次再删 |
| 解压 | 一律用 `C:\Windows\System32\tar.exe`：装了 Git 的电脑上，PATH 里的 `tar` 是 GNU tar，会把 `C:\…` 当成远程地址而失败（语音模型、uv、身体都受影响） |
| 启动身体 | 不弹黑色窗口（`windowsHide`） |
| `--smoke` | 身体加了一个检查开关：正常启动，窗口加载好就打印一行并退出（失败退出码 1） |
| 自动检查（`.github/workflows/ci.yml`） | 每次推送：插件的类型检查和单元测试在 Linux、Windows、macOS 上各跑一遍；检查 Windows 自带的 tar 能不能解 `.tar.bz2`（语音识别模型是这个格式）；在 Windows 上打身体的包、解压、`--smoke` 启动一次；包作为构建产物保留 |

**本机 Ming** 在 x64 的 Windows 上用 audio.cpp 版（见 [Ming跨平台.md](Ming跨平台.md)）：装好后自动比较显卡（Vulkan）和 CPU 哪个快，有 NVIDIA 显卡还可以再下 CUDA 版试试。ARM 的 Windows 暂不支持。克隆声音时读录音用 ffmpeg（桌面版的她自带一个）。

## 网络：GitHub 连不上时（0.3.1）

Win11 上第一次"下载安装身体"报 `fetch failed`：插件连 GitHub 时网络就断了。常见的两种情况：电脑靠代理软件（Clash 等）上 GitHub，浏览器走系统代理，但插件用的 Node 的 fetch 不管系统代理；或者 GitHub 的下载服务器直连被重置。改成：

- **走系统代理**：在 DSH 桌面版里，下载用 Electron 的网络（和浏览器一样跟着系统代理）。命令行版 dsh 还是 Node 的 fetch。
- **自动换镜像**：GitHub 连不上时，依次试 `body.mirrors` 里的镜像（默认 `https://ghfast.top/`、`https://gh-proxy.com/`，插件设置里可以改，清空就只用 GitHub）。身体的 zip、语音识别模型、uv、Ming 模型都这样下。
- **镜像不可信，所以都要校验**：经过镜像的每个文件都按事先知道的大小和 SHA-256 核对（这一版给语音识别模型也补上了校验值）。核对用的 `body-latest.json` 只从 GitHub 本身读，不走镜像；GitHub 读不到时，用发布 npm 时放进包里的那一份（`lib/body-release.json`，发布前由 `scripts/embed-body-release.mjs` 从这一版的 GitHub Release 取来），npm 在国内有镜像，读得到。
- **报错说人话**：比如"连不上 github.com（连接被拒绝或被重置）。如果你平时通过代理上 GitHub，打开代理软件的'系统代理'再试……"，不再是 `fetch failed`。

## 下载太慢：用下载软件（0.3.2）

「她」页面现在有两个按钮："直接下载安装"和"用下载软件下载"。直接下载时也能取消，或者点"太慢？换成用下载软件下载"。

1. **复制下载链接**：GitHub 原地址和每个镜像各一条，放进迅雷、IDM 或浏览器，哪个快用哪个。
2. **放到文件夹**：`%USERPROFILE%\.dsh-her\body\download`（Mac：`~/.dsh-her/body/download`），不用解压。页面上有"复制路径""打开文件夹"。文件名被下载软件改了也没关系，大小对就能认出来。
3. **点"安装下载好的文件"**：页面每 3 秒看一次文件到了没有，没下完会写"还不完整"。插件核对大小和 SHA-256，解压，自动启动。校验不对的文件不会安装，也不会被删掉。

不用自己运行：以后 dsh 启动时会自动启动她。装好的程序在 `%USERPROFILE%\.dsh-her\body\<版本>\dsh-her\dsh-her.exe`，想手动打开也可以直接运行。

## 页面顶部的版本和更新（0.3.2）

「她」页面最上面一行显示插件和身体的版本，以及"检查更新"：

- **插件**走 dshmarket 的公开更新接口（`/dsh-market/api/v1`）：检查、更新、进度、失败原因都由它负责，它会核对装上的版本对不对，不对就退回。更新后提示重启。
- **没装 dshmarket**：大脑自己问 npm（连不上时问 npmmirror），有新版本就显示要运行的命令 `dsh plugin add dsh-her@latest`。
- **身体**：后台下载、校验、安装，装好后显示"重启身体"。
- **链接到代码仓库的插件**（开发）：显示"开发版"，不更新。

## 发布时怎么带上 Windows 版

1. 推送后等 GitHub Actions 的 `ci` 跑完，从 `body-windows` 下载产物（zip 和它的 `body-latest.json`）。
2. 在 Mac 上照常 `npm run package` 打 Mac 版。
3. 把两份 `body-latest.json` 的 `assets` 合在一起（同一个版本号），和两个 zip 一起传到 Release。

## 在你的 Win11 上要测的

先装 Windows 版 DSH 桌面版，再装插件 `dsh-her`（带 Windows 身体的版本发布以后），然后：

| # | 测什么 | 怎么看对不对 |
|---|---|---|
| 1 | 「她」页面 → 下载安装身体 | 进度走完，自动启动；右下角托盘出现紫色爱心图标 |
| 2 | 她出现在桌面上 | 背景透明、能拖动；点她身上能点到，点空白处能点到后面的窗口 |
| 3 | 麦克风 | 按 Ctrl+Alt+空格 说话，「她 → 概况」里出现"最近听到"。听不到的话：设置 → 隐私和安全性 → 麦克风 → 允许桌面应用访问 |
| 4 | 第一次听你说话 | 自动下载识别模型（约 170 MB）并解压成功，之后能识别 |
| 5 | Edge 声音 | 第一次自动准备语音组件（一两分钟），之后她能出声 |
| 6 | 住在壁纸里 | 在托盘菜单里切换；她出现在桌面图标后面。Win11 24H2 用的是新结构，挂不上会自动退回"浮在最上层"，并在日志里写原因 |
| 7 | 导入外形素材 | 能导入（用到包里的 ffmpeg.exe） |
| 8 | 形象工坊 → 打开文件夹 | 用资源管理器打开 |
| 9 | 更新、重启身体 | 「她」页面里的"检查更新""重启身体"能用 |
| 10 | 任务管理器里 | 进程名 dsh-her，描述"她"，图标是紫色爱心 |

哪一项不对，把「她」页面的提示、`%USERPROFILE%\.dsh-her\logs` 里的日志发给我就行。

## 还没做的

- 代码签名：没签名的 exe 从浏览器下载会被 SmartScreen 拦；插件自己下载的文件不带"来自网络"标记，一般不会被拦，要在 Win11 上确认。
- Windows ARM、Linux 的身体包。
- 本机 Ming（audio.cpp 版）。
