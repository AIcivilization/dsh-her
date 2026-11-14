# 设计：本机 Ming 在 Mac、Windows、Linux 上都能用（2026-10-31 讨论稿；2026-11-13 已实现）

> 接着 [Ming本地声音设计.md](Ming本地声音设计.md)。原来只有 Apple 芯片的 Mac 能用（MLX）。这一份讲怎么让 Windows、Linux、Intel Mac 也能用。§1–§5 是当初的讨论稿，§6 起是实现和在 M1 Pro 上的实测。

## 1. 用什么跑：audio.cpp

[audio.cpp](https://github.com/0xShug0/audio.cpp) 是一个纯 C++ 的语音推理程序（基于 ggml，Apache-2.0 许可）。

- **已经支持 Ming-3.0-tts-0.5B**（`ming3_tts`）：说话、克隆、设计声音、情绪控制都有，也支持流式输出。
- **不需要 Python**，这比我们现在 Mac 上的做法（uv 加一个约 450 MB 的 Python 环境）更省事。
- **自带 HTTP 服务**（`audiocpp_server`，`POST /v1/audio/speech`），用法和我们现在的常驻进程差不多。
- **作者为每个平台都发了编好的程序**（v0.9.3，2026-10-26）：

| 平台 | 能用的后端 | 程序包大小 |
|---|---|---|
| macOS Apple 芯片 / Intel | Metal（也带 CPU） | 34–36 MB |
| Windows x64 | CPU、Vulkan、CUDA 12.4 / 13.3 | CPU 30 MB，Vulkan 82 MB，CUDA 277–465 MB，另加 CUDA 运行库 575–607 MB |
| Ubuntu x64 | CPU、Vulkan、CUDA 12.8（标的是 Colab 用） | CPU 57 MB，Vulkan 99 MB，CUDA 228 MB 加运行库 787 MB |
| Windows / Linux 的 AMD ROCm | 测试版 | 280–700 MB |

- **模型**：用 GGUF 格式的 `audio-cpp/Ming-3.0-TTS-0.5B-GGUF`，8 位版 1.74 GB。权重还是 MIT 许可，可以像现在的 MLX 模型一样，在我们自己的 GitHub Release 上放一份。
- **速度**：作者在 RTX 5090 上测，合成时间是声音长度的 0.17 倍，比官方 Python 快 3.9 倍，显存约 1.9 GB。

## 2. 还不知道的（决定方案的关键）

1. **CPU 有多快**：Ming 的说明里没有 CPU 数字。CPU 上要是一句话超过 5 秒，没有显卡的电脑就不该用它。
2. **Mac 的 Metal 能不能跑 Ming**：Ming 的说明里只写了 CUDA、Vulkan、CPU。Metal 跑不了的话，Intel Mac 只能用 CPU。
3. **Vulkan 有多快**：Vulkan 可以用一个 82 MB 的包同时覆盖 NVIDIA、AMD、Intel 显卡，CUDA 要下近 1 GB。两者差多少决定 NVIDIA 显卡默认用哪个。
4. **功能是不是都对得上**：中文内置声音（灵风信等）、带情绪版本的声音、情绪和语速一起用、克隆、设计。
5. **数字念法**：audio.cpp 也没有文字规范化，我们的 `spokenNumbers()` 照样要先用。这一条已经知道，不算问题。

第 1、2、4 条可以在你这台 M1 Pro 上先测（CPU 和 Metal）；第 3 条要有 Windows 或 Linux 的显卡机器。

## 3. 方案（测完再定细节）

**各平台用什么**：

| 电脑 | 用什么 | 说明 |
|---|---|---|
| Mac Apple 芯片 | 现在的 MLX（已测，一句 2.4–2.6 秒） | 如果 audio.cpp 的 Metal 更快，就统一换成 audio.cpp，少一个 Python |
| Mac Intel | audio.cpp（Metal 或 CPU） | 看实测速度 |
| Windows、Linux，有 NVIDIA 显卡 | audio.cpp：默认 Vulkan，"更快"选项用 CUDA | CUDA 要多下约 1 GB |
| Windows、Linux，有 AMD 或 Intel 显卡 | audio.cpp Vulkan | |
| 没有能用的显卡 | audio.cpp CPU | CPU 太慢就提示"这台电脑跑本机声音会很慢"，建议继续用 Edge |
| Windows ARM、Linux ARM | 暂不支持 | 作者没有发这两个平台的包 |

**安装时自检**：
- 先下对应平台的程序包和模型；
- 再用每个能用的后端各合成一句话，记下用了多久，自动选最快的；
- 设置页显示选了哪个（比如"用显卡（Vulkan），一句约 0.8 秒"），也可以手动换；
- 太慢的话直接告诉用户。

这样不用我们自己去判断显卡型号，也不怕显卡驱动有问题。

**代码怎么改**：
- `MingVoice` 下面分两种引擎：`mlx`（现在的 Python 常驻进程）和 `audiocpp`（`audiocpp_server` 常驻进程，通过本机 HTTP 收发）。
- 上面的几层不用改：设置页、我的声音（设计、克隆）、情绪、叹气和笑、数字念法。
- 程序包和模型都写死版本和 SHA-256，下载后先核对再用，和现在一样。
- 程序包从作者的 GitHub Release 下载，模型先从我们的 Release 下。

## 4. 测试怎么做

| 测什么 | 在哪测 |
|---|---|
| CPU、Metal 的速度，以及功能能不能对上 | 你这台 M1 Pro（要下载约 1.8 GB，见下面） |
| Windows、Linux 上装得上、能说一句（CPU） | GitHub Actions 的 Windows 和 Ubuntu 机器，每次提交自动跑（没有显卡，只能测 CPU） |
| Vulkan、CUDA 的速度和稳定性 | 要有显卡的 Windows 或 Linux 电脑：你那边有吗？没有的话，先按"自检"的结果走，等有用户反馈 |

**还有一件事**：Windows、Linux 上光有声音不够，她的"身体"（Electron 程序）现在也只打了 Mac 的包。要让 Windows、Linux 用户真正用上，身体的 Windows、Linux 包也要一起做（M6 里本来就有这一项）。

## 5. 下一步

先在你这台 Mac 上实测 audio.cpp，需要下载：
- `audio-v0.9.3-bin-macos-arm64-metal.tar.gz`（34 MB，作者 GitHub Release）；
- `ming-3.0-tts-0.5b-q8_0.gguf`（1.74 GB，Hugging Face）。

都放在临时文件夹，测完删掉。要测的：
- Metal 和 CPU 的速度；
- 中文内置声音、情绪、克隆、设计能不能用；
- 服务模式和流式输出，看能不能比 MLX 更早开口。

## 6. 实现（2026-11-13）

用的是 audio.cpp **v0.9.4**（2026-11-05，比讨论稿里的 v0.9.3 新一版）。

| 文件 | 做什么 |
|---|---|
| `src/voice/audiocpp-release.ts` | 每种电脑下哪个程序包，都写死大小和 SHA-256（作者 Release 自带的校验值）；GGUF 模型写死 Hugging Face 的提交和 SHA-256 |
| `src/voice/ming-audiocpp.ts` | audio.cpp 引擎：安装、自检挑最快的、常驻 `audiocpp_server`、用本机 HTTP 一句一句合成；请求怎么拼（纯函数，有测试） |
| `src/voice/ming-mlx.ts` | 原来的 MLX 引擎，从 `ming.ts` 里搬出来，没改行为 |
| `src/voice/ming-engine.ts` | 两种引擎共同的接口 |
| `src/voice/ming.ts` | `MingVoice`：按电脑选引擎；排队、不说话就停、连续出错就停，这些两种引擎共用 |
| `src/client/MingVoice.tsx` | 设置页：显示"正在用 CPU，一句约 2.5 秒"，可以换成别的、重新测一次；有 NVIDIA 显卡时多一个"试试 CUDA 版" |
| `src/voice/ming-voices.ts` | 克隆读录音：Mac 用 afconvert，别的系统用 ffmpeg（桌面版的她自带；没有就下载校验过的那个） |

**各电脑用什么**（`mingEngine()`）：

| 电脑 | 引擎 | 下载的程序包 |
|---|---|---|
| Apple 芯片，macOS 14 及以上 | MLX（不变；实测比 audio.cpp 快，见 §7） | — |
| Apple 芯片，macOS 13 及以下；Intel Mac | audio.cpp | `macos-arm64-metal` / `macos-x64-metal`（37–39 MB，Metal 和 CPU 都能跑） |
| Windows x64 | audio.cpp | 先下 `windows-x64-vulkan`（84 MB，Vulkan 和 CPU 都能跑）；都跑不起来再下 `cpu`（32 MB），还不行再下 `cpu-portable`（不用 AVX，慢）。有 NVIDIA 显卡时可以点"试试 CUDA 版"：`cuda13.3` 加运行库，共约 855 MB |
| Linux x64 | audio.cpp | 先下 `ubuntu-x64-vulkan-portable`（88 MB）；不行再下 `cpu-portable`（70 MB）。CUDA 版是 `cuda12.8-colab` 加运行库，约 1 GB |
| Windows ARM、Linux ARM | 不支持，设置页写明 | 作者没发这两个平台的包 |

- Linux 用 "portable" 包：它启动时按 CPU 选指令集；不带 portable 的是按 CI 机器的 CPU 编的，别的 CPU 上可能直接崩。Windows 的 "portable" 是完全不用 AVX，很慢，所以只当最后的退路。
- CUDA 选 13.3 不选 12.4：12.4 的包不含 RTX 50 系列（Blackwell）的显卡代码。驱动太旧时 CUDA 自检会失败，设置页会显示原因，不影响继续用 Vulkan 或 CPU。
- 模型 `ming-3.0-tts-0.5b-q8_0.gguf`（1,742,280,896 字节）先试我们自己的 Release `ming-gguf-1`，再试 Hugging Face，再试 hf-mirror.com，校验值说了算。**`ming-gguf-1` 还没上传**，现在会先 404 再从 Hugging Face 下（日志里有一行 warn，不影响安装）。
- 开发时可以用环境变量 `DSH_HER_MING_ENGINE=audiocpp` 让 Apple 芯片的 Mac 也走 audio.cpp。

**自检**：装好以后，每个能用的后端各跑一次：启动、加载、先说"嗯。"预热，再把同一句（16 个字）说两遍，取快的那次。挑最快的写进 `<home>/ming/audiocpp/choice.json`。一句超过 5 秒，设置页提示"比较慢，建议继续用 Edge"。都跑不起来就报错，写明每个后端的原因。

**请求怎么拼**（和 MLX 一样，单元测试对比过 mlx-audio 自己的 `ming3_instruction`，逐字节相同）：

| 她说话用的 | 发给 audio.cpp 的 |
|---|---|
| 内置声音（带不带情绪、语速） | `template_name: freeform`，`instruct` 是 Ming 的控制串（情感、语速、IP 写在一起），`zero_speaker_embedding: true`。audio.cpp 的 `ip` 模板不允许同时带情绪，所以不用它 |
| 我的声音（克隆） | `voice_ref` 给录音路径，`reference_text` 给录音里的话；有情绪时 `instruct` 是只带情感、语速的控制串 |
| 设计声音 | `template_name: freeform`，`instruct` 就是那句描述，`zero_speaker_embedding: true`（MLX 也是这么做的）。audio.cpp 自己的 `voice_design` 模板会一直生成到上下文用完再把静音剪掉，一次要 26 秒，所以不用 |

audio.cpp 的流匹配固定 10 步，没有"步数"可调，所以 audio.cpp 版的设置页不显示"速度优先 / 音质优先"。

## 7. 实测（2026-11-13，M1 Pro 10 核 CPU，16 GB）

在这台 Mac 上真的走了一遍安装（下载、校验、解压、自检），又把三种跑法各测了一遍：每句话合成后用 SenseVoice 识别回来，对字。

**安装**：模型从 Hugging Face 下载约 7 分钟（GitHub 上我们的 Release 还没有，先 404），程序包 4 秒，自检 19–25 秒。占用：模型 1.6 GB，程序 92 MB。

**速度**（毫秒；每句都是预热后的）：

| | audio.cpp Metal | audio.cpp CPU（8 线程） | MLX（现在用的） |
|---|---|---|---|
| 启动加预热 | 16,389 | 2,244 | 2,704 |
| 12 个字，三次 | 2,954 / 2,914 / 2,880 | 2,256 / 1,961 / 1,476 | 1,553 / 1,547 / 1,305 |
| 28 个字，三次 | 8,787 / 6,743 / 6,377 | 4,984 / 6,735 / 7,016 | 4,408 / 4,930 / 5,232 |
| 设计一个声音（一次，28 个字） | 26–33 秒（改之前的模板） | 4.8–7.0 秒（改成 freeform 后） | 3.3–3.5 秒 |
| 克隆（第一次 / 带情绪） | 3,036 / 2,450 | 2,702 / 2,118（另一轮第一次 5,271） | 2,503 / 538（出错，见下） |
| 自检那一句（两遍取快的） | 4,117 | 2,537 | — |

结论：
- **Apple 芯片继续用 MLX**：MLX 最快，audio.cpp 的 CPU 比 MLX 慢约 30%。
- **在 M1 Pro 上 audio.cpp 的 Metal 比它自己的 CPU 还慢**，加载也要 16 秒。所以自检必须真的测，不能默认"有显卡就用显卡"。第一版自检只测一遍，挑中了 Metal（2,955 对 3,044，误差范围内），改成测两遍取快的以后挑的是 CPU。
- Windows、Linux 上普通 CPU（比 M1 Pro 慢）大概一句 3–5 秒，接近"太慢"的线；有显卡的电脑要靠 Vulkan 或 CUDA，这要在有显卡的机器上测（§8）。

**功能**（三种跑法结果一样，识别回来的字都对）：

| 项 | 结果 |
|---|---|
| 内置声音（灵小芸、灵风信_中性） | 对 |
| 情绪版本（灵风信_高兴） | 对 |
| 内置声音 + 情绪 + 语速（灵梦，悲伤，慢速） | 对（freeform 控制串） |
| 〔笑〕〔叹气〕（`[Laughter]`、`[Sigh]`） | 对，叹气识别成"唉"，和 MLX 一样 |
| 数字（已经先用 `spokenNumbers()` 转成汉字） | "两个小时、三点十五分、百分之三十"都对 |
| 设计 3 个（种子 11、22、33） | 都能说，字对（"小鲸"识别成"小金"是同音） |
| 用设计出的声音克隆、克隆 + 情绪 | 对。顺便发现 MLX 的"克隆 + 高兴"这一句只出了 0.3 秒空白，audio.cpp 没这个问题；MLX 这个问题另外看 |

测完，下载的程序和模型已从临时文件夹删掉。

## 8. 还没验证的（要有 Windows 或 Linux 的显卡电脑）

- **Windows 上真的装一次**：zip 用系统自带的 `tar.exe` 解（和语音识别模型同一个办法，CI 已经测过它能读 zip）；`audiocpp_server.exe` 能启动、`--no-ui` 认得；路径里有中文用户名时能不能读模型。
- **Vulkan 的速度和稳定性**：NVIDIA、AMD、Intel 核显各一台最好。
- **CUDA**：13.3 的运行库放在程序旁边能不能被找到；驱动太旧时的报错是不是看得懂。Linux 的 CUDA 运行库解压出来的目录结构没看过（代码会把带 `.so` 的目录都加进 `LD_LIBRARY_PATH`）。
- **没有 Vulkan 驱动的 Windows**（虚拟机）：Vulkan 包应该启动不了，然后自动改下 CPU 包。
- **普通 x64 CPU 的速度**：决定"太慢"的提示会不会经常出现。
- **CI**：GitHub Actions 的 Windows 和 Ubuntu 机器可以加一步"下载 CPU 包和模型、说一句"，但每次要下 1.8 GB，建议只在手动触发时跑，还没加。
- **克隆在 Windows 上读 m4a**：走 ffmpeg，没在 Windows 上试过。
- **`ming-gguf-1` Release**：把模型传上去以后，国内下载会快很多（现在先 404 再去 Hugging Face）。

## 0.8.5：Windows 暂不开放

audio.cpp 引擎已经合进 main，但还没在 Windows 上实测，所以在 Windows 上本机 Ming 先标成"暂时还不能用"：「声音」里 Ming 那一栏是灰的，大脑也不会去装。Mac（MLX，Intel Mac 用 audio.cpp）和 x64 的 Linux 照常。

要在 Windows 上试：启动 DSH 之前设环境变量 `DSH_HER_MING_ENGINE=audiocpp`，Ming 那一栏就能用了。实测没问题后，把 `src/voice/ming.ts` 里 `mingEngine()` 的 Windows 那一行去掉即可。
