/**
 * 本地 Ollama 供应商 —— 无 key、不出网、断网也能用（只要本机跑着 Ollama）。
 *
 * 走 OpenAI 兼容端点 `http://localhost:11434/v1/chat/completions`，
 * 于是"换本地模型"只是改一个模型名。
 *
 * 探测（ready）刻意做得便宜且带缓存：Ollama 没起的时候，
 * 每次提交都去敲一次 11434 会白等一个连接超时。
 */

import { INTENT_SYSTEM_PROMPT, type IntentResult } from '@/core/intent'
import {
  INTENT_TIMEOUT_MS,
  buildUserMessage,
  clampInput,
  parseIntentJson,
  pickOpenAIContent,
  withTimeout,
  type IntentCtx,
  type IntentProvider,
} from './provider'
import { fallbackToRule } from './fallback'

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1'
/** 中文语境下的常见本地选择；玩家可在设置里改 */
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5:7b'

const PROBE_TIMEOUT_MS = 1500
const PROBE_TTL_MS = 15_000

/**
 * 探测结果**按端点缓存在模块级**，不挂在实例上。
 *
 * 每次提交都会重新组装一遍供应商（设置随时可能改），若缓存跟着实例走，
 * 就等于每次提交都去敲一次 11434 —— Ollama 没起的时候那是白等一个连接超时。
 */
const probeCache = new Map<string, { at: number; ok: boolean }>()
const probing = new Map<string, Promise<boolean>>()

/** 忘掉探测结果。测试用；设置页"连通性测试"之后再点也用得上。 */
export function resetOllamaProbeCache(): void {
  probeCache.clear()
  probing.clear()
}

export interface OllamaConfig {
  baseUrl: string
  model: string
  timeoutMs?: number
}

export class OllamaProvider implements IntentProvider {
  readonly id = 'ollama' as const
  readonly label = '本地 Ollama'

  constructor(private readonly cfg: OllamaConfig) {}

  private base(): string {
    return (this.cfg.baseUrl.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, '')
  }

  private model(): string {
    return this.cfg.model.trim() || DEFAULT_OLLAMA_MODEL
  }

  /** 敲一下 /models；探不到就当没装 —— 未就绪不会拦住下一个供应商 */
  async ready(): Promise<boolean> {
    const base = this.base()
    const hit = probeCache.get(base)
    if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.ok

    const inflight = probing.get(base)
    if (inflight) return inflight

    const p = (async () => {
      let ok = false
      try {
        const res = await withTimeout(fetch(`${base}/models`), PROBE_TIMEOUT_MS)
        ok = res.ok
      } catch {
        ok = false // 没起、跨域被拦、超时 —— 都是"未就绪"，不是错误
      }
      probeCache.set(base, { at: Date.now(), ok })
      probing.delete(base)
      return ok
    })()

    probing.set(base, p)
    return p
  }

  async classify(input: string, ctx: IntentCtx): Promise<IntentResult> {
    const text = clampInput(input)
    try {
      const res = await withTimeout(
        fetch(`${this.base()}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.model(),
            max_tokens: 400,
            temperature: 0.3,
            stream: false,
            messages: [
              { role: 'system', content: INTENT_SYSTEM_PROMPT },
              { role: 'user', content: buildUserMessage(text, ctx) },
            ],
          }),
        }),
        this.cfg.timeoutMs ?? INTENT_TIMEOUT_MS,
      )
      if (!res.ok) return fallbackToRule(text, ctx, this, `HTTP ${res.status}`)
      const parsed = parseIntentJson(pickOpenAIContent(await res.json()))
      if (!parsed) return fallbackToRule(text, ctx, this, '返回不是合法的意图 JSON')
      return parsed
    } catch (err) {
      return fallbackToRule(text, ctx, this, err)
    }
  }
}
