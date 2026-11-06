# dsh-her

**DSH 桌面女友，[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）插件。** 她可以住在你真正的桌面上（浮在所有窗口上面，或者住在壁纸里），也可以住在 dsh 的网页里，能聊天、记得你。桌面程序支持 macOS（Apple 芯片）和 Windows；Linux、VPS 和手机上她住在网页里，见 [docs/VPS部署.md](docs/VPS部署.md)。

> 开发中（P1）。设计和计划见 [docs/](docs/)，从 [docs/P1开发计划.md](docs/P1开发计划.md) 看起。

## 进度

| 里程碑 | 状态 |
|---|---|
| M0 风险验证 | ✅ mac 通过（[记录](docs/M0验证记录.md)）；Windows 待测 |
| M1 大脑与身体打通（文字） | ✅ mac 通过（[记录](docs/M1记录.md)）；休息模式 CPU 2.2% |
| M2 语音 | ✅ mac 通过（[记录](docs/M2记录.md)）；说完到她开口中位数约 2.5 秒；云端克隆音色待接 |
| M3 外形包与姿势图 | ✅ mac 通过（[记录](docs/M3记录.md)）；用合成测试包验证，"想看 JK" 全流程跑通；待真实素材校准 |
| M4 内置记忆 | ✅ mac 通过（[记录](docs/M4记录.md)）；换全新会话仍记得，删掉的事不再提 |
| M5 向导与管理页 | ✅ mac 通过（[记录](docs/M5记录.md)）；dsh 侧栏"她"：7 步向导 + 管理页。身体的下载安装挪到 M6 |
| M6 打磨与发布 | 进行中（[记录](docs/M6记录.md)）：mac 身体打包、一键下载安装和自动更新、Edge 声音不再依赖系统 Python；Windows 身体打包和安装已写好、等实测（[Windows适配](docs/Windows适配.md)）；签名公证、省电待做 |

## 组成

- **大脑**（本包，dsh 插件）：她在 dsh 里的专属会话"她 · 名字"、语音（本地识别 + 云端合成）、身体协议服务（`ws://127.0.0.1:38100` 起）。
- **身体**（[body/](body/)，Electron 桌面程序）：她的形象、字幕气泡、输入框、三种窗口模式。

两者之间的协议见 [docs/身体协议.md](docs/身体协议.md)。

## 安装

在 dsh 桌面版的插件页搜 `dsh-her` 安装；也可以把 [这段话](docs/AI帮你装.md) 发给 dsh 里的 AI，让它帮你装。没有桌面的 VPS 看 [VPS 部署](docs/VPS部署.md)。

## 怎么和她说话

- **对话小条**：按 **⌃⌥↩**（Windows：**Ctrl+Alt+Enter**）、双击她，或点 dsh 对话框上她的小头像，弹出小条：能打字，也能按住 🎙 说话；全屏时也能叫出来。所有对话都存在 dsh 左侧的"她"工作区里，可以新开一段，也可以接着之前那段（[说明](docs/对话入口设计.md)）。
- **说话**：按 **⌃⌥空格**（Windows：**Ctrl+Alt+空格**）说一句，说完自动发出；她说话时你开口就能打断她。菜单里可以勾"一直在听"。
- **打字**：双击她（或菜单"打字和她说"）打开输入框，回车发送，Esc 关闭。
- **她会先开口**：你回到电脑前、有日子的事快到了、很久没说话时，她会自己说一句。每天最多 3 次，23:30 到 8:30 不打扰，你不回她就慢慢少说；开会时用右键菜单的"专注一会儿"。在 设置 → 主动说话 里调（[说明](docs/主动与触摸设计.md)）。
- **碰她**：点她的头或身体，她马上有反应，隔一会儿还会说一句符合性格的话；按住不动是摸摸头。
- 在 dsh 里打开"她 · 名字"会话直接打字，或在任意会话里用 `/her 想说的话`：她都会在桌面上回答。
- 在她身上按住可以拖动；右键她（或点菜单栏的"她"）可以切换"浮在最上层 / 住在壁纸里 / 普通窗口"，或退出。
- **形象**：一个形象可以有好几个场景（窗边、书桌、卧室……），按时间和你在不在自动换，也可以跟她说"去卧室吧"。「她」页面的**形象工坊**带你做自己的形象：选好她的样子和场景，它把每张图、每段视频的提示词写进「文稿 / dsh-her 素材」里的文件夹，生成好再一键导入。见 [docs/形象工坊与多场景.md](docs/形象工坊与多场景.md)。
- **她记得的事**：她会自己记、自己查，每天整理一次写日记。`/her 记忆` 查看，`/her 忘掉 f3` 删除，`/her 导出记忆` 导出。也可以直接跟她说"把那件事忘掉"。文件都在 `~/.dsh-her/characters/<角色>/memory/`。

## 开发

```bash
npm install
npm test
npm run build
```

身体：

```bash
cd body
npm install
npm run build
```

打成一个可以分发的身体程序（mac；输出到 `release/`：zip 和 `body-latest.json`，传到 GitHub Release 后，插件会从 `body.releases` 下载安装、自动更新）：

```bash
cd body
npm run package
```

在一个单独的测试 profile 里运行（数据放在 `~/.dsh-her-dev`，不碰正式的 `~/.dsh-her`）：

```bash
dsh plugin --profile her-dev add link:/path/to/dsh-her
```

profile 的 `cordis.patch.yml`：

```yaml
- id: dsh-her
  name: dsh-her
  config:
    home: ~/.dsh-her-dev
    body:
      launch: auto          # dsh 启动 3 秒后若没有身体连上，就拉起 body/
      pack: ''              # 外形包目录；空 = 身体默认（~/dsh-her-dev-assets/bg2-stacked）
```

```bash
dsh --profile her-dev --no-open --port 3191
```

她的声音默认用微软 Edge 的声音（通过开源工具 edge-tts，免费，要联网）；找不到已装好的 edge-tts 时会自动装进 `$DSH_HER_HOME/edge-tts`。也可以在"她"页面里换成阿里云百炼 CosyVoice 的声音，key 放进 mac 钥匙串（或环境变量 `DASHSCOPE_API_KEY`）：

```bash
security add-generic-password -a dsh-her -s dsh-her-dashscope -w
```

本地语音识别模型（约 170 MB，下载到 `$DSH_HER_HOME/models`），以及测速和各音色试听样本：

```bash
DSH_HER_HOME=~/.dsh-her-dev npm run voice:models
DSH_HER_HOME=~/.dsh-her-dev npm run voice:bench
```

导入外形包（按 [docs/素材生成提示词.md](docs/素材生成提示词.md) 命名的一个文件夹）：

```bash
node body/scripts/import-pack.ts ~/我的角色 --packs ~/.dsh-her/packs --name 名字
```

合成测试包（色块小人，绿幕；加 `--scene` 是带空场景图的房间）：

```bash
node body/scripts/make-test-pack.mjs ~/dsh-her-dev-assets/test-doll-src
```

开发用素材都放在 `~/dsh-her-dev-assets/`，**不进仓库**。第三方演示素材由 `body/scripts/make-dev-pack.mjs` 转换。

## 隐私

不收集任何使用数据。身体只连本机 `127.0.0.1`，需要令牌（`<home>/token`，权限 600）。

## 许可

MIT
