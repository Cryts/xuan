/**
 * 自由输入 —— 供应商接口与共用的解析/清洗逻辑。
 *
 * 这一层只做一件事：把玩家写的一句中文，翻成 `IntentResult`。
 * **它不判定任何结果，也不产生任何数值。** 数字由 core 的引擎算，
 * 这里连"能不能成"都不该知道。
 *
 * 四个供应商（rule / api / ollama / native）实现同一个接口，
 * 于是「换模型」只是换一个对象，而不牵动任何一处结算代码。
 */

import { FREE_INPUT_MAX, INTENT_WHITELIST, type IntentResult } from '@/core/intent'
import type { Intent } from '@/core/types'

export type ProviderId = 'rule' | 'api' | 'ollama' | 'native'

/** 交给模型的处境摘要 —— 越窄越准，也越不容易让它越权 */
export interface IntentCtx {
  /** 当前场景的一句话描述 */
  scene: string
  /** 摆在玩家面前的既有选项（模型据此提高 mapped 的把握） */
  options: string[]
  /** 玩家身上的东西：行囊与已习之法。**未列于此的，模型不该提** */
  possessions: string[]
}

export interface IntentProvider {
  readonly id: ProviderId
  readonly label: string
  /** 是否就绪（比如没填 key 的 api provider 就是未就绪） */
  ready(): Promise<boolean>
  classify(input: string, ctx: IntentCtx): Promise<IntentResult>
}

/** 8 秒。超时即静默回落规则层，绝不弹窗。 */
export const INTENT_TIMEOUT_MS = 8000

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`超时（${ms} 毫秒）`)
    this.name = 'TimeoutError'
  }
}

/**
 * 8 秒闸。
 *
 * 网络请求能 abort，IPC 发出去了收不回来 —— 所以统一在这里"不再等它"。
 * 对玩家而言两者没有分别：到点就走规则层，界面照常往下走。
 */
export function withTimeout<T>(p: Promise<T>, ms = INTENT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  rule: '本地规则',
  api: '浏览器直连',
  ollama: '本地 Ollama',
  native: '主进程',
}

/* ============================================================
   输入与提示词的组装
   ============================================================ */

/** 输入硬上限 —— 防止有人把整本小说粘进来 */
export function clampInput(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.replace(/\s+/g, ' ').trim().slice(0, FREE_INPUT_MAX)
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** 玩家输入 + 处境摘要 —— 四个供应商共用同一份 user 消息 */
export function buildUserMessage(input: string, ctx: IntentCtx): string {
  const opts = (ctx.options ?? [])
    .slice(0, 6)
    .map((o) => `· ${clip(o, 40)}`)
    .join('\n')

  return [
    `玩家写下的：${input}`,
    '',
    `当前处境：${clip(ctx.scene ?? '', 120) || '（未知）'}`,
    opts ? `摆在面前的路：\n${opts}` : '摆在面前的路：（没有）',
    `他身上有的：${ctx.possessions.length > 0 ? ctx.possessions.slice(0, 24).join('、') : '（空）'}`,
    '',
    '他若提到不在这份清单里的东西，把 confidence 调低。只输出 JSON。',
  ].join('\n')
}

/** 空处境 —— 连通性测试与内容缺失时用，永远可用 */
export const EMPTY_CTX: IntentCtx = { scene: '', options: [], possessions: [] }

/* ============================================================
   模型输出的解析 —— 唯一的一道闸
   ============================================================ */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** 去掉 ```json 围栏与前后废话，只留最外层的那个对象 */
export function unfence(raw: string): string {
  const t = raw.replace(/^\s*```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '')
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  return a >= 0 && b > a ? t.slice(a, b + 1) : t
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.replace(/\s+/g, ' ').trim()
  return t.length === 0 ? undefined : t.slice(0, max)
}

/**
 * 把模型吐出来的东西收成 `IntentResult`。
 *
 * **只认那五个字段，多给的一律丢弃。** 模型说 intent 之外的话（"给他加一百灵石"）
 * 到这里就被切掉了 —— 数值永远由引擎算，不是一句约定，是这一行 return。
 * 解析不出来时返回 null，由调用方回落规则层。
 */
export function parseIntentJson(raw: unknown): IntentResult | null {
  if (typeof raw !== 'string' || raw.length === 0) return null

  let data: unknown
  try {
    data = JSON.parse(unfence(raw))
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null

  const o = data as Record<string, unknown>
  const intent = o.intent
  if (typeof intent !== 'string' || !INTENT_WHITELIST.includes(intent as Intent)) return null

  const conf = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? o.confidence : 0.5

  const out: IntentResult = { intent: intent as Intent, confidence: clamp01(conf) }
  const target = str(o.target, 40)
  if (target) out.target = target
  const approach = str(o.approach, 60)
  if (approach) out.approach = approach
  const narration = str(o.narration, 240)
  if (narration) out.narration = narration
  return out
}

/** OpenAI 兼容协议下从响应里取正文；取不到返回 null */
export function pickOpenAIContent(data: unknown): string | null {
  const d = data as { choices?: Array<{ message?: { content?: unknown } }> } | null
  const c = d?.choices?.[0]?.message?.content
  return typeof c === 'string' && c.length > 0 ? c : null
}

/** Anthropic /v1/messages 的正文由若干 text 块拼成 */
export function pickAnthropicContent(data: unknown): string | null {
  const d = data as { content?: Array<{ type?: string; text?: string }> } | null
  const t = (d?.content ?? [])
    .filter((b) => b?.type === 'text')
    .map((b) => b?.text ?? '')
    .join('')
  return t.length > 0 ? t : null
}

export const isAnthropicUrl = (url: string): boolean => /anthropic\.com/.test(url)
