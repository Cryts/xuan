/**
 * 预加载脚本 —— 渲染进程与主进程之间**唯一**的通道。
 *
 * 只暴露那几个必要的方法，不暴露 ipcRenderer 本身，也不暴露 require。
 * 渲染进程拿不到 apiKey：`llm:status` 只回"有没有配"，
 * 真正的密钥从不跨进程回传。这样即使游戏页面里被注入了什么，
 * 也偷不走玩家的密钥。
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('xuanNative', {
  /** 渲染进程用它判断"我在 Electron 里还是浏览器里" */
  isElectron: true,
  platform: process.platform,

  llm: {
    /** 只回 { hasKey, baseUrl, model } —— 不含密钥本身 */
    status: () => ipcRenderer.invoke('llm:status'),

    /** 写入密钥与供应商设置（密钥只进不出） */
    set: (opts) => ipcRenderer.invoke('llm:set', opts || {}),

    /** 抹掉已存的密钥 */
    clear: () => ipcRenderer.invoke('llm:clear'),

    /**
     * 调模型。**不要在 payload 里带 apiKey**——主进程会用自己存的那份，
     * 传了也会被忽略。
     */
    chat: (payload) => ipcRenderer.invoke('llm:chat', payload || {}),
  },

  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openConfigDir: () => ipcRenderer.invoke('app:openConfigDir'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  },
})
