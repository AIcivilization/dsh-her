# 在 VPS 上用 dsh-her（没有桌面）

VPS 上她住在 dsh 的网页里：大脑在 VPS 上，你用任何设备（电脑、手机）打开这个网页，她就在页面上，声音也从这台设备出来。桌面程序（"身体"）不用装，「她」页面也不会让你装。

只要是从别的设备打开网页，即使 dsh 跑在 Windows 或 Mac 上，也是这样。

## 1. 装

```bash
npm i -g pnpm @deepseek-ai/dsh
```

```bash
dsh plugin --profile web add dsh-her
```

需要 Node.js 22.18 或更新；dsh 用 pnpm 安装插件，所以要一起装上。这个 profile 要带 dsh 的网页界面（`@deepseek-ai/dsh-web-app`，`web` profile 默认带）。

## 2. 打开网页：三种办法

**A. SSH 隧道（最简单，推荐先用这个）。** dsh 只听本机，不用开端口、不用证书，麦克风也能用（浏览器把 localhost 当安全地址）。

在 VPS 上：

```bash
dsh --profile web --no-open --port 3000
```

在你自己的电脑上：

```bash
ssh -L 3000:127.0.0.1:3000 你的VPS
```

然后用 dsh 打印出来的带 token 的地址，在自己电脑的浏览器里打开。

**B. dsh 自己配 HTTPS。** 有域名和证书时：

```bash
dsh --profile web --no-open --host 203.0.113.7 --port 8443 --tls-cert /path/fullchain.pem --tls-key /path/privkey.pem --public-url https://her.example.com:8443 --trusted-host her.example.com:8443
```

`--host` 要写这台机器网卡上的具体 IP（把例子里的 `203.0.113.7` 换掉），dsh 不接受 `0.0.0.0`。私钥不能带密码。

**C. 放在反向代理后面（Caddy、Nginx）。** dsh 只听本机，由代理负责 HTTPS，并带上 `--public-url` 和 `--trusted-host`。代理要关掉响应缓冲，否则她的长连接（SSE）会卡住；上传大视频要放开请求体大小。Nginx 的写法：

```nginx
proxy_buffering off;
proxy_read_timeout 1d;
client_max_body_size 2g;
```

**只用 HTTP 直接开公网端口**：她能出现、能打字、能出声，但浏览器不给麦克风，页面上"和她说话"是灰的。不建议这样，访问 token 也是明文传的。

## 3. 她的样子

视频不在 VPS 上生成，在自己电脑上生成好传上去：

- **设置 → 外形 → 上传素材文件夹**：传一个按规则命名的片段文件夹（`stand_idle_01.mp4`、`stand_talk_01.mp4`……），大脑导入后她就换上。同名文件夹再传一次会替换。
- **形象工坊**：每张卡片都能上传参考图、照片和片段，在页面上框人物区，再导入。

导入要用 ffmpeg。没有的话装一个：

```bash
sudo apt install ffmpeg
```

片段第一次看时下载，之后浏览器长期缓存，同一个文件不会再下；重新导入才会换新地址。

## 4. 声音

| 声音 | VPS 上能用吗 |
|---|---|
| Edge | 能。第一次用时自动装好，Python 或 venv 不全也没关系（会改用 uv）。VPS 的 IP 有时会被微软限制，不出声时换百炼试试 |
| 百炼 | 能，需要 API 密钥 |
| 本机 Ming | 暂时不能（目前只支持 Apple 芯片的 Mac；VPS 没有显卡也会很慢） |

浏览器不让网页自己出声：第一次要在页面上点一下，会看到"🔊 点一下开声音"。

## 5. 几个要知道的

- **关掉网页，她就不在了**；大脑还在跑。
- **同一时间只有一个标签页有她**：新开的标签页接管，旧的显示一个"她"按钮，点一下再接管回来。
- **语音识别**在 VPS 上做，模型第一次用时下载。小内存的 VPS 可能跑不动，这时打字就好。
