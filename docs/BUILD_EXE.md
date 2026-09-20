# 编译成 Windows exe

目标：在 Windows 上打出**双击即玩的单文件 exe**，在里面填自己的 API Key 试玩自由输入。

> **为什么必须在 Windows 上打**：electron-builder 不支持跨平台交叉打包。在 Linux 上打 Windows 包需要 wine 且容易出玄学问题，不值得。你本来就在 Windows 上，直接打最省事。

---

## 一、准备（只做一次）

### 1. 装 Node.js

到 https://nodejs.org/ 下载 **LTS 版**（20 或 22 都行），一路下一步。

装完打开 **PowerShell**（不是 cmd），确认：

```powershell
node -v      # 应输出 v20.x 或 v22.x
npm -v
```

### 2. 拉代码

```powershell
git clone https://github.com/Cryts/xuan.git
cd xuan
npm install
```

`npm install` 会下载 Electron 本体（约 100–200 MB），第一次慢一点，之后就缓存在本地了。

> 如果公司网络慢，可以先设国内镜像：
> ```powershell
> npm config set ELECTRON_MIRROR https://npmmirror.com/mirrors/electron/
> ```

---

## 二、开发模式（改代码时用）

```powershell
npm run electron:dev
```

会同时起 Vite 与 Electron，改 `src/` 下的任何文件，窗口里立刻热更新。

---

## 三、打出 exe

```powershell
npm run dist:win
```

跑完在 `release\` 目录下：

| 文件 | 说明 |
|---|---|
| `玄-1.0.0-x64.exe` | **单文件版**——双击就跑，不用安装。发给别人也行 |
| `玄 Setup 1.0.0.exe` | 安装包——带开始菜单和卸载项 |

首次打包会联网下载 Electron 的 Windows 二进制与 NSIS 工具链，几分钟。之后有缓存就快了。

---

## 四、填 API Key

打开 exe，进 **设置页** → 「玄机（自由输入）」一栏：

| 字段 | 填什么 |
|---|---|
| 接口地址 | 见下表 |
| 模型名 | 见下表 |
| API Key | 你自己的密钥 |

### 常用供应商

| 供应商 | 接口地址 | 模型名示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 月之暗面 | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Anthropic | `https://api.anthropic.com` | `claude-sonnet-5` |
| **本地 Ollama** | `http://localhost:11434/v1` | `qwen2.5:7b` |

除 Anthropic 外都走 OpenAI 兼容协议，**换供应商就是改前两栏，不用改代码**。

### 密钥存在哪

```
%APPDATA%\玄\config.json
```

**密钥只存在于这个文件里**。渲染进程（也就是游戏页面）拿不到它——页面只能通过 IPC 说"帮我调一次模型"，主进程用自己的密钥去发请求，结果再回给页面。所以即使游戏页面里出什么问题，也偷不走你的 Key。

设置页有「打开配置目录」按钮，可以直接去看。要清除就点「清除密钥」。

---

## 五、为什么 EXE 版比网页版更适合自由输入

网页版做自由输入有两个绕不过去的坎，EXE 版都没有：

| 问题 | 网页版 | EXE 版 |
|---|---|---|
| 密钥放哪 | 只能放 localStorage，**明文**，玩家自填也只是把风险转嫁给玩家 | 存在主进程的配置文件里，渲染进程够不着 |
| 跨域 | 国内模型接口基本不发 CORS 头，网页端直连**必然失败**，要绕就得自己搭代理服务器 | 请求由主进程的 Node 发出，根本没有跨域这回事 |

这两条是同一件事的两面：**把密钥和网络请求挪到前端够不到的地方**。

---

## 六、常见问题

**`npm install` 卡在 electron 下载**
设镜像后重试：
```powershell
npm config set ELECTRON_MIRROR https://npmmirror.com/mirrors/electron/
npm install
```

**打包时提示下载 nsis 失败**
同样设镜像：
```powershell
npm config set ELECTRON_BUILDER_BINARIES_MIRROR https://npmmirror.com/mirrors/electron-builder-binaries/
```

**双击 exe 白屏**
多半是 `dist` 没构建成功。先单独跑 `npm run electron:build`，确认 `dist\index.html` 存在且里面的资源路径是 `./assets/...`（相对路径）而不是 `/assets/...`（绝对路径）。绝对路径在 `file://` 下必然 404。

**杀毒软件报毒**
未签名的 Electron 应用常见误报。代码签名证书能解决，但个人自用可以直接加白名单。

**想打 32 位 / ARM 版**
改 `electron-builder.yml` 里 `win.target` 的 `arch`，例如 `[x64, arm64]`。

---

## 七、只想验证打包链路能不能通

```powershell
npm run dist:dir
```

只生成解压后的目录（`release\win-unpacked\`），不打安装包，快很多。能跑起来说明配置没问题。
