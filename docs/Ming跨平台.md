# 设计：本机 Ming 在 Mac、Windows、Linux 上都能用（2026-10-31，讨论稿）

> 接着 [Ming本地声音设计.md](Ming本地声音设计.md)。现在只有 Apple 芯片的 Mac 能用（MLX）。这一份讲怎么让 Windows、Linux、Intel Mac 也能用。还没写代码。

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
