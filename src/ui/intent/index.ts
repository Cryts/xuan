/**
 * 自由输入 —— 供应商的选择、回落链与唯一入口。
 *
 * 上游说一句话，这里负责把它变成 `IntentResult`：
 *
 *   玩家写的一句话
 *     → pickProvider(settings)   native → ollama → api → rule，挑第一个就绪的
 *     → provider.classify()      模型翻译成语义结构（8 秒闸）
 *     → parseIntentJson()        只留那五个字段，多给的一律丢弃
 *     → 任何一步出岔子          **静默**回落 RuleProvider
 *     → IntentResult            交给 core 的 submitFreeAction 去落地与结算
 *
 * 铁律：这条路只产出「意图」。数值由引擎算，判定由 core 做。
 * 模型能把"抢"听成"退"，但听不出一点好处来。
 */

import { INTENT_TIMEOUT_MS, TimeoutError, clampInput, withTimeout, type IntentCtx, type IntentProvider, type ProviderId } from './provider'
import type { IntentResult } from '@/core/intent'
import type { GameState, NodePresentation } from '@/core/types'
import { ApiProvider } from './api'
import { OllamaProvider } from './ollama'
import { nativeProvider } from './native'
import { ruleProvider } from './rule'
import type { FreeInputSettings } from './settings'

export type { IntentCtx, IntentProvider, ProviderId } from './provider'
export {
  EMPTY_CTX,
  INTENT_TIMEOUT_MS,
  PROVIDER_LABELS,
  TimeoutError,
  buildUserMessage,
  clampInput,
  parseIntentJson,
  withTimeout,
} from './provider'
export { ApiProvider } from './api'
export { OllamaProvider, resetOllamaProbeCache } from './ollama'
export { NativeProvider } from './native'
export { nativeBridge, isElectron } from './native'
export type { NativeLlmStatus } from './native'
export { DEFAULT_API_MODEL, DEFAULT_API_URL } from './api'
export { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL } from './ollama'
export { DEFAULT_FREE_INPUT, PROVIDER_CHOICES, normalizeFreeInput } from './settings'
export type { FreeInputSettings, ProviderChoice } from './settings'
export { ruleProvider, classifyByRule, extractTarget } from './rule'

/** 自动模式下的优先次序：文件头那条链 */
export const AUTO_ORDER: ProviderId[] = ['native', 'ollama', 'api', 'rule']

/** 由设置组装四个供应商 —— 设置一改，实例跟着换 */
export function makeProviders(fi: FreeInputSettings): Record<ProviderId, IntentProvider> {
  return {
    native: nativeProvider,
    ollama: new OllamaProvider({ baseUrl: fi.ollamaUrl, model: fi.ollamaModel }),
    api: new ApiProvider({ baseUrl: fi.apiUrl, model: fi.apiModel, apiKey: fi.apiKey }),
    rule: ruleProvider, // 永远在场
  }
}

/**
 * 按 native → ollama → api → rule 挑第一个就绪的。
 *
 * 玩家手动指定了供应商时，它排在最前；若它未就绪（比如没填密钥），
 * 仍然照这条链往下走 —— **永远有 rule 兜底**，不存在"选错了就玩不了"。
 */
export async function pickProvider(
  fi: FreeInputSettings,
  providers: Record<ProviderId, IntentProvider> = makeProviders(fi),
): Promise<IntentProvider> {
  const order: ProviderId[] =
    fi.provider === 'auto' ? AUTO_ORDER : [fi.provider, ...AUTO_ORDER.filter((p) => p !== fi.provider)]

  for (const id of order) {
    const p = providers[id]
    if (!p) continue
    try {
      if (await p.ready()) return p
    } catch {
      // 探测本身出错 = 未就绪。不抛，继续往下找。
    }
  }
  return providers.rule
}

export interface ClassifyOutcome {
  intent: IntentResult
  /** 最终给出结果的供应商 */
  provider: ProviderId
  /** 实际被选中去尝试的供应商（未回落时与 provider 相同） */
  attempted: ProviderId
  /** 是否发生了回落（选中的那个没能给出结果） */
  fellBack: boolean
}

/**
 * 唯一入口：一句话 → 意图。
 *
 * **永不抛异常，永不返回空。** 走到最后一定是规则层的结果。
 */
export async function classifyFreeAction(
  input: string,
  ctx: IntentCtx,
  fi: FreeInputSettings,
  providers?: Record<ProviderId, IntentProvider>,
): Promise<ClassifyOutcome> {
  const all = providers ?? makeProviders(fi)
  const text = clampInput(input)

  if (text.length === 0) {
    return { intent: await all.rule.classify('', ctx), provider: 'rule', attempted: 'rule', fellBack: false }
  }

  let picked: IntentProvider
  try {
    picked = await pickProvider(fi, all)
  } catch {
    picked = all.rule
  }

  try {
    const intent = await withTimeout(picked.classify(text, ctx), INTENT_TIMEOUT_MS)
    return { intent, provider: picked.id, attempted: picked.id, fellBack: false }
  } catch (err) {
    const why = err instanceof TimeoutError ? '8 秒未应答' : String((err as Error)?.message ?? err)
    console.warn(`[玄] 自由输入：${picked.label} ${why}，回落本地规则。`)
    let intent: IntentResult
    try {
      intent = await all.rule.classify(text, ctx)
    } catch {
      // 规则层也出事（理论上不可能）—— 给一个最保守的意图，绝不把异常抛给界面
      intent = { intent: 'steady', confidence: 0.4 }
    }
    return { intent, provider: 'rule', attempted: picked.id, fellBack: picked.id !== 'rule' }
  }
}

/* ============================================================
   处境的摘要
   ============================================================ */

/** 交给模型的处境：当前的场面、摆在面前的路、身上真有的东西 */
export function buildIntentCtx(state: GameState, pres: NodePresentation): IntentCtx {
  const scene = [pres.title, pres.scenario?.name, pres.lines[0] ?? pres.transition ?? '']
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .join(' · ')
    .slice(0, 140)

  return {
    scene,
    options: pres.options.map((o) => o.text),
    possessions: [
      ...(state.items ?? []).map((i) => i.name),
      ...(state.learned_rules ?? []).map((r) => r.name),
    ],
  }
}

/* ============================================================
   连通性测试（设置页用）
   ============================================================ */

export interface TestOutcome {
  ok: boolean
  providerId: ProviderId
  label: string
  detail: string
}

const PROBE = '我先看看四周的动静'

/**
 * 连通性测试：真的把一句话走完整条链，再把结果说给人听。
 *
 * 刻意**不**只测"能不能连上"——玩家真正要知道的是
 * "我写一句话，系统到底能不能听懂"。
 */
export async function testFreeInput(fi: FreeInputSettings, ctx: IntentCtx): Promise<TestOutcome> {
  const all = makeProviders(fi)
  const out = await classifyFreeAction(PROBE, ctx, fi, all)

  const served = all[out.provider]
  const heard = `「${PROBE}」听成了 ${out.intent.intent}（把握 ${out.intent.confidence.toFixed(2)}）`

  // ① 指定的供应商没轮到 —— 大多是没填密钥 / 服务没起
  if (out.attempted === 'rule' && fi.provider !== 'auto' && fi.provider !== 'rule') {
    const wanted = all[fi.provider]
    let ready = false
    try {
      ready = await wanted.ready()
    } catch {
      ready = false
    }
    return {
      ok: false,
      providerId: 'rule',
      label: ruleProvider.label,
      detail: `「${wanted.label}」${ready ? '未能应答' : '未就绪'}（${
        ready ? '接口没通' : '没填密钥，或服务没起'
      }），已用「本地规则」顶上 —— ${heard}。游玩不受影响，只是理解得粗一些。`,
    }
  }

  // ② 选中了模型，但它没给出可用结果
  if (out.fellBack) {
    const failed = all[out.attempted]
    return {
      ok: false,
      providerId: out.provider,
      label: served.label,
      detail: `「${failed.label}」没给出可用的答案（超时 / 返回不是 JSON），已回落「${served.label}」—— ${heard}。`,
    }
  }

  const note =
    fi.provider !== 'auto' && out.provider !== fi.provider
      ? `（你指定的「${all[fi.provider].label}」未就绪，暂由「${served.label}」顶上）`
      : ''

  return {
    ok: true,
    providerId: out.provider,
    label: served.label,
    detail: `已由「${served.label}」判定 —— ${heard}。${note}`,
  }
}
