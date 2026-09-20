/**
 * 主进程供应商 —— EXE 版的路径，**优先于浏览器直连**。
 *
 * 它存在的理由不是"套壳"，而是网页版做不成的两件事（见 electron/main.cjs）：
 *   1. 密钥留在 Node 侧，渲染进程**拿不到**，被注入也偷不走；
 *   2. 请求由主进程发出，没有跨域这回事。
 *
 * 所以这里**绝不在 payload 里带 apiKey** —— 主进程只用自己存的那一份，
 * 传了也会被忽略。这条不是风格问题：密钥一旦进了渲染进程的内存，
 * 它就不再安全了。
 */

import { INTENT_SYSTEM_PROMPT, type IntentResult } from '@/core/intent'
import {
  INTENT_TIMEOUT_MS,
  TimeoutError,
  buildUserMessage,
  clampInput,
  parseIntentJson,
  withTimeout,
  type IntentCtx,
  type IntentProvider,
} from './provider'
import { fallbackToRule, quietFallback } from './fallback'

export interface NativeLlmStatus {
  hasKey?: boolean
  baseUrl?: string
  model?: string
}

export interface NativeChatResult {
  ok?: boolean
  content?: string
  error?: string
}

export interface NativeBridge {
  isElectron?: boolean
  llm?: {
    status?: () => Promise<NativeLlmStatus>
    set?: (opts: Record<string, unknown>) => Promise<unknown>
    clear?: () => Promise<unknown>
    chat?: (payload: Record<string, unknown>) => Promise<NativeChatResult>
  }
}

/** preload 暴露的窄接口；不在 Electron 里就是 undefined */
export function nativeBridge(): NativeBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { xuanNative?: NativeBridge }).xuanNative
}

export function isElectron(): boolean {
  return Boolean(nativeBridge()?.isElectron)
}

export class NativeProvider implements IntentProvider {
  readonly id = 'native' as const
  readonly label = '主进程'

  /** 在 Electron 里、且主进程确实配过东西 —— 否则不该拦住后面的供应商 */
  async ready(): Promise<boolean> {
    const llm = nativeBridge()?.llm
    if (!llm?.chat) return false
    try {
      const st = (await llm.status?.()) ?? null
      if (!st) return true // 拿不到状态就当就绪；真失败也会静默回落
      return Boolean(st.hasKey || st.baseUrl)
    } catch {
      return true
    }
  }

  async classify(input: string, ctx: IntentCtx): Promise<IntentResult> {
    const text = clampInput(input)
    const llm = nativeBridge()?.llm
    if (!llm?.chat) return fallbackToRule(text, ctx, this, '主进程通道不可用')

    try {
      const res = await withTimeout(
        llm.chat({
          system: INTENT_SYSTEM_PROMPT,
          user: buildUserMessage(text, ctx),
          maxTokens: 400,
          temperature: 0.3,
          // 刻意不带 apiKey：密钥归主进程管，见文件头
        }),
        INTENT_TIMEOUT_MS,
      )
      if (!res?.ok || !res.content) {
        return fallbackToRule(text, ctx, this, res?.error ?? '主进程未返回内容')
      }
      const parsed = parseIntentJson(res.content)
      if (!parsed) return fallbackToRule(text, ctx, this, '返回不是合法的意图 JSON')
      return parsed
    } catch (err) {
      if (err instanceof TimeoutError) return quietFallback(text, ctx, '主进程 8 秒未应答')
      return fallbackToRule(text, ctx, this, err)
    }
  }
}

export const nativeProvider = new NativeProvider()
