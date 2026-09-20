/**
 * 浏览器直连供应商 —— 用户自填 Key，存在本机 localStorage。
 *
 * 两个已知的现实：国内模型的接口基本不发 CORS 头，网页端直连多半会被浏览器拦下；
 * 静态站点上的 Key 也只是明文躺在 localStorage 里。所以这条路的定位是
 * **网页版的应急手段**，真要在桌面上用，走 native（密钥在 Node 侧）。
 *
 * 协议与主进程的 callModel 保持一致：`/anthropic.com/` 走 Anthropic 的
 * /v1/messages，其余按 OpenAI 兼容走 /chat/completions。换供应商只改地址与模型名。
 */

import { INTENT_SYSTEM_PROMPT, type IntentResult } from '@/core/intent'
import {
  INTENT_TIMEOUT_MS,
  buildUserMessage,
  clampInput,
  isAnthropicUrl,
  parseIntentJson,
  pickAnthropicContent,
  pickOpenAIContent,
  type IntentCtx,
  type IntentProvider,
} from './provider'
import { fallbackToRule } from './fallback'

/** 与 L3 同一套默认端点/模型 —— 玩家已经为卷轴填过一次，就不必再填第二次 */
export const DEFAULT_API_URL = 'https://api.anthropic.com'
export const DEFAULT_API_MODEL = 'claude-opus-4-8'

export interface ApiConfig {
  baseUrl: string
  model: string
  apiKey: string
  /** 单测用；线上固定 8 秒 */
  timeoutMs?: number
}

export class ApiProvider implements IntentProvider {
  readonly id = 'api' as const
  readonly label = '浏览器直连'

  constructor(private readonly cfg: ApiConfig) {}

  /** 没填 Key 就是未就绪 —— 这样它不会拦住后面真正能用的供应商 */
  async ready(): Promise<boolean> {
    return this.cfg.apiKey.trim().length > 0
  }

  async classify(input: string, ctx: IntentCtx): Promise<IntentResult> {
    const text = clampInput(input)
    if (text.length === 0) return fallbackToRule(text, ctx, this, '输入为空')

    try {
      const raw = await this.call(text, ctx)
      const parsed = parseIntentJson(raw)
      if (!parsed) return fallbackToRule(text, ctx, this, '返回不是合法的意图 JSON')
      return parsed
    } catch (err) {
      // 跨域、超时、HTTP 4xx —— 一律静默回落，玩家不该看到任何弹窗
      return fallbackToRule(text, ctx, this, err)
    }
  }

  private async call(input: string, ctx: IntentCtx): Promise<string> {
    const cfg = this.cfg
    const base = (cfg.baseUrl.trim() || DEFAULT_API_URL).replace(/\/+$/, '')
    const model = cfg.model.trim() || DEFAULT_API_MODEL
    const anthropic = isAnthropicUrl(base)
    const timeout = cfg.timeoutMs ?? INTENT_TIMEOUT_MS

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (anthropic) {
      headers['x-api-key'] = cfg.apiKey.trim()
      headers['anthropic-version'] = '2023-06-01'
      // 浏览器直连所需：服务端会校验该头，缺了会被 CORS 直接拦下
      headers['anthropic-dangerous-direct-browser-access'] = 'true'
    } else {
      headers['authorization'] = `Bearer ${cfg.apiKey.trim()}`
    }

    const user = buildUserMessage(input, ctx)
    const body = anthropic
      ? {
          model,
          max_tokens: 400,
          temperature: 0.3,
          system: INTENT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: user }],
        }
      : {
          model,
          max_tokens: 400,
          temperature: 0.3,
          messages: [
            { role: 'system', content: INTENT_SYSTEM_PROMPT },
            { role: 'user', content: user },
          ],
        }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
      const res = await fetch(anthropic ? `${base}/v1/messages` : `${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}：${detail.slice(0, 200)}`)
      }
      const data: unknown = await res.json()
      const content = anthropic ? pickAnthropicContent(data) : pickOpenAIContent(data)
      if (!content) throw new Error('模型返回了空内容')
      return content
    } finally {
      clearTimeout(timer)
    }
  }
}
