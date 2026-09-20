/**
 * Electron 主进程。
 *
 * 存在的理由**不是**"把网页套个壳"，而是解决网页版做不成自由输入的两个死结：
 *
 *   1. **密钥不能放在前端。** 静态站点上任何 localStorage 里的 Key 都是明文，
 *      玩家自填也只是把风险转嫁给玩家。
 *   2. **浏览器跨域打不通模型 API。** 国内模型的接口基本都不发 CORS 头，
 *      网页端直连必然失败；要绕过就得自己搭代理服务器。
 *
 * 主进程同时解决这两件事：密钥留在 Node 侧（渲染进程拿不到），
 * 请求由主进程发出（没有跨域这回事）。这也是做 EXE 最实在的收益。
 *
 * 另：本文件是 CommonJS（.cjs），因为 Electron 主进程不认 package.json 里的
 * "type": "module"。
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')

// 开发模式下 Vite 起在 5173；打包后加载本地文件
const DEV_URL = process.env.XUAN_DEV_URL || ''
const isDev = Boolean(DEV_URL)

let win = null

// ============================================================
// 配置存储：密钥落在用户目录，不进仓库、不进安装包
// ============================================================

function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

async function writeConfig(cfg) {
  const p = configPath()
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, JSON.stringify(cfg, null, 2), 'utf8')
  // 尽量收紧权限（Windows 上会被忽略，Linux/macOS 上有效）
  try {
    await fsp.chmod(p, 0o600)
  } catch {
    /* Windows 不支持，忽略 */
  }
}

// ============================================================
// 模型调用
// ============================================================

/**
 * 统一走 OpenAI 兼容协议 —— 国内主流厂商（DeepSeek / 通义 / 智谱 / 月之暗面 …）
 * 与本地 Ollama 都支持它。这样"换供应商"只是改 baseUrl 和 model，不用改代码。
 * Anthropic 走自己的 /v1/messages，单独一条分支。
 */
async function callModel({ baseUrl, apiKey, model, system, user, maxTokens, temperature }) {
  const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')

  const isAnthropic = /anthropic\.com/.test(base)
  const url = isAnthropic ? `${base}/v1/messages` : `${base}/chat/completions`

  const headers = { 'content-type': 'application/json' }
  if (apiKey) {
    if (isAnthropic) {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers['authorization'] = `Bearer ${apiKey}`
    }
  }

  const body = isAnthropic
    ? {
        model,
        max_tokens: maxTokens ?? 400,
        temperature: temperature ?? 0.8,
        system,
        messages: [{ role: 'user', content: user }],
      }
    : {
        model,
        max_tokens: maxTokens ?? 400,
        temperature: temperature ?? 0.8,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: user },
        ],
      }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}：${text.slice(0, 300)}` }
    }
    let data
    try {
      data = JSON.parse(text)
    } catch {
      return { ok: false, error: '返回不是合法 JSON' }
    }
    const content = isAnthropic
      ? (data.content || []).map((c) => c.text || '').join('')
      : data.choices?.[0]?.message?.content || ''
    if (!content) return { ok: false, error: '模型返回了空内容' }
    return { ok: true, content }
  } catch (e) {
    const msg = e.name === 'AbortError' ? '请求超时（30 秒）' : String(e.message || e)
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

// ============================================================
// IPC
// ============================================================

function registerIpc() {
  // 密钥相关：只回"有没有"，**从不把密钥回传给渲染进程**
  ipcMain.handle('llm:status', () => {
    const cfg = readConfig()
    return {
      hasKey: Boolean(cfg.apiKey),
      baseUrl: cfg.baseUrl || '',
      model: cfg.model || '',
    }
  })

  ipcMain.handle('llm:set', async (_e, { apiKey, baseUrl, model }) => {
    const cfg = readConfig()
    if (typeof apiKey === 'string' && apiKey.length > 0) cfg.apiKey = apiKey
    if (typeof baseUrl === 'string') cfg.baseUrl = baseUrl
    if (typeof model === 'string') cfg.model = model
    await writeConfig(cfg)
    return { ok: true }
  })

  ipcMain.handle('llm:clear', async () => {
    const cfg = readConfig()
    delete cfg.apiKey
    await writeConfig(cfg)
    return { ok: true }
  })

  // 模型调用：由主进程发出，渲染进程只管拿结果
  ipcMain.handle('llm:chat', async (_e, payload) => {
    const cfg = readConfig()
    return callModel({
      baseUrl: payload?.baseUrl || cfg.baseUrl,
      apiKey: cfg.apiKey, // 永远用存下来的那份，不接受渲染进程传进来的
      model: payload?.model || cfg.model,
      system: payload?.system,
      user: payload?.user,
      maxTokens: payload?.maxTokens,
      temperature: payload?.temperature,
    })
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    configPath: configPath(),
  }))

  ipcMain.handle('app:openConfigDir', async () => {
    await shell.openPath(path.dirname(configPath()))
    return { ok: true }
  })

  ipcMain.handle('app:openExternal', async (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) await shell.openExternal(url)
    return { ok: true }
  })
}

// ============================================================
// 窗口
// ============================================================

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#0b0a09',
    title: '玄 · 文字修仙',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // 渲染进程不得直接碰 Node —— 一切经由 preload 暴露的窄接口
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // 站内链接留在窗口里，站外链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(DEV_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.on('closed', () => {
    win = null
  })
}

// 单实例：重复启动时聚焦已有窗口，而不是再开一个
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

// 渲染进程崩了给个提示，别静默白屏
process.on('uncaughtException', (err) => {
  try {
    dialog.showErrorBox('玄 · 出错了', String(err && err.stack ? err.stack : err))
  } catch {
    /* 对话框都弹不出来就只能算了 */
  }
})
