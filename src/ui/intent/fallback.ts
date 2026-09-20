/**
 * 回落 —— 自由输入的**唯一**出错出口。
 *
 * 模型这一路能出的错很多：没填 key、跨域被拦、超时、返回一段散文、
 * 返回一个不存在的 intent、返回一个想给玩家加钱的 JSON。
 * 这些**没有一种是玩家该看见的**：不弹窗、不报错、不留痕在界面上，
 * 只在 console 记一笔，然后照常往下走。
 *
 * 玩家侧的表现是：这一手照样落地了，只是理解得粗一些。
 */

import type { IntentResult } from '@/core/intent'
import type { IntentCtx, IntentProvider } from './provider'
import { ruleProvider } from './rule'

export async function fallbackToRule(
  input: string,
  ctx: IntentCtx,
  from: IntentProvider | string,
  err?: unknown,
): Promise<IntentResult> {
  const who = typeof from === 'string' ? from : from.label
  console.warn(`[玄] 自由输入：${who} 未给出可用结果，回落本地规则。`, err ?? '')
  return ruleProvider.classify(input, ctx)
}

/**
 * **静默**回落 —— 只在"这事本来就可能不成"的场合用（超时、未就绪）。
 * 与上者的区别只是日志的措辞：正常玩家永远看不到这两者的差别。
 */
export function quietFallback(input: string, ctx: IntentCtx, why: string): Promise<IntentResult> {
  console.warn(`[玄] 自由输入：${why}，回落本地规则。`)
  return ruleProvider.classify(input, ctx)
}
