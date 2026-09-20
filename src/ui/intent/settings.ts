/**
 * 自由输入的设置形状与默认值。
 *
 * 单独一个零依赖的小文件，是为了让 store.ts 与 intent/ 两边都能引它，
 * 而不把整条供应商链拖进 store。
 *
 * **默认关。** 这是实验分支：开关关着时输入行根本不渲染，
 * 一切与没有这个功能时完全一样。
 */

export type ProviderChoice = 'auto' | 'rule' | 'api' | 'ollama' | 'native'

export interface FreeInputSettings {
  /** 默认 false —— 玩家不主动打开，就永远看不到输入行 */
  enabled: boolean
  /** 'auto' = 按 native → ollama → api → rule 挑第一个就绪的 */
  provider: ProviderChoice
  /** 浏览器直连：端点、模型、密钥（密钥只存本机 localStorage） */
  apiUrl: string
  apiModel: string
  apiKey: string
  /** 本地 Ollama：端点与模型 */
  ollamaUrl: string
  ollamaModel: string
}

export const DEFAULT_FREE_INPUT: FreeInputSettings = {
  enabled: false,
  provider: 'auto',
  apiUrl: '',
  apiModel: '',
  apiKey: '',
  ollamaUrl: '',
  ollamaModel: '',
}

export const PROVIDER_CHOICES: Array<{ id: ProviderChoice; label: string; hint: string }> = [
  { id: 'auto', label: '自动', hint: '主进程 → 本地 Ollama → 浏览器直连 → 本地规则，挑第一个可用的' },
  { id: 'rule', label: '规则', hint: '纯关键词匹配，零依赖、离线可用。准确率最低，但永不失败' },
  { id: 'api', label: '直连', hint: '浏览器直接请求模型接口。需要自填密钥；国内厂商多半不发 CORS 头，可能被浏览器拦下' },
  { id: 'ollama', label: '本地', hint: '本机跑的 Ollama（localhost:11434），无需密钥、不出网' },
  { id: 'native', label: '主进程', hint: '仅 EXE 版可用：密钥存在主进程，渲染进程拿不到，且没有跨域问题' },
]

/** 把设置里缺的字段补齐 —— 老存档里可能没有这一节 */
export function normalizeFreeInput(src: unknown): FreeInputSettings {
  const o = (src ?? {}) as Partial<FreeInputSettings>
  const choice = PROVIDER_CHOICES.some((c) => c.id === o.provider) ? o.provider! : 'auto'
  return {
    enabled: Boolean(o.enabled), // 未写 = 关。实验分支的默认必须是最保守的那个
    provider: choice,
    apiUrl: typeof o.apiUrl === 'string' ? o.apiUrl : '',
    apiModel: typeof o.apiModel === 'string' ? o.apiModel : '',
    apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
    ollamaUrl: typeof o.ollamaUrl === 'string' ? o.ollamaUrl : '',
    ollamaModel: typeof o.ollamaModel === 'string' ? o.ollamaModel : '',
  }
}
