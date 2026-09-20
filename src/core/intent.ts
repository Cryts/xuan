/**
 * 自由输入 —— 意图的**落地判定**（纯 TS，不碰网络）。
 *
 * 这里是「玩家写了一句话」到「局面发生了什么」之间那道闸。模型只负责
 * 把句子翻译成结构化的意图（见 IntentResult），**判定的权力仍在规则层**：
 *
 *   - 玩家提到的东西必须**真的在他身上**（行囊里有，或已习得该规则）
 *   - 能对上的既有选项就直接走它，结算规则一个字不改
 *   - 对不上但确实说得通的，走「新路」：以属性判定，成败照常四段
 *   - 提到身上没有的东西，不认 —— 但不当成失败，给一段"你摸了摸行囊，
 *     那里并没有你说的东西"的旁白。**幻觉要挡住，但不能让玩家觉得被骂。**
 *
 * 数值永不由模型决定：模型的输出只用来**选**走哪条路，delta 一律由引擎算。
 */

import type { Rng } from './rng'
import { rollBand } from './resolve'
import type {
  AttrKey,
  Band,
  GameState,
  Intent,
  LooseEvent,
  NodePresentation,
  Option,
} from './types'

/** 模型应当返回的结构 —— 约定越窄，模型越难乱来 */
export interface IntentResult {
  /** 必须落在白名单里 */
  intent: Intent
  /** 玩家想作用的对象（自由文本，需被落地校验） */
  target?: string
  /** 手法 / 途径（自由文本，只用于生成旁白，不参与判定） */
  approach?: string
  /** 模型自评把握 0–1 */
  confidence: number
  /** 模型写的旁白（会被数值剥离器清洗） */
  narration?: string
}

export const INTENT_WHITELIST: Intent[] = [
  'greedy',
  'steady',
  'scheme',
  'flee',
  'evil',
  'social',
  'study',
  'sacrifice',
]

/** 意图 → 主要属性（用于新路判定） */
const INTENT_ATTR: Record<Intent, AttrKey> = {
  greedy: 'luck',
  steady: 'temper',
  scheme: 'wits',
  flee: 'insight',
  evil: 'insight',
  social: 'charm',
  study: 'wits',
  sacrifice: 'temper',
}

export type FreeOutcome =
  /** 对上了既有选项 —— 走原规则结算 */
  | { kind: 'mapped'; option: Option }
  /** 对上了剧本里的一次「试」 —— 走物证匹配 */
  | { kind: 'trial'; ref: string; affordance: string[] }
  /** 说得通但没对上任何既有分支 —— 开一条新路 */
  | { kind: 'novel'; band: Band; attr: AttrKey; fuse: boolean; reason: string }
  /** 提了身上没有的东西 —— 不认，但给旁白 */
  | { kind: 'grounded'; reason: string }
  /** 完全无法映射 */
  | { kind: 'refused'; reason: string }

export interface FreeContext {
  state: GameState
  /** 当前呈现（散事件或剧本） */
  pres: NodePresentation
  /** 当前散事件（剧本里为空） */
  event?: LooseEvent
  rng: Rng
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** 归一到可比较的字符串，用于粗匹配 */
function norm(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/**
 * 把玩家提到的目标**落地**到具体物品或已习得规则上。
 *
 * 这是整个自由输入的安全阀：模型可以说得天花乱坠，但只要东西不在玩家身上，
 * 就落不了地。**"说出一个你没有的东西"不会变成收益。**
 */
export function groundTarget(
  target: string | undefined,
  state: GameState,
): { kind: 'item'; id: string; name: string; affordance: string[]; pack?: string } | { kind: 'rule'; ref: string; name: string; pack: string } | null {
  if (!target) return null
  const t = norm(target)
  if (t.length === 0) return null

  // 先找行囊
  for (const it of state.items ?? []) {
    const n = norm(it.name)
    if (n === t || n.includes(t) || t.includes(n)) {
      return { kind: 'item', id: it.id, name: it.name, affordance: it.affordance ?? [] }
    }
  }
  // 再找已习得的跨体系规则
  for (const r of state.learned_rules ?? []) {
    const n = norm(r.name)
    if (n === t || n.includes(t) || t.includes(n)) {
      return { kind: 'rule', ref: r.ref, name: r.name, pack: r.pack }
    }
  }
  return null
}

/**
 * 判定玩家这一手能落到哪里。
 *
 * 顺序：**对的上的既有选项 → 剧本里的物证 → 新路 → 落地失败**。
 * 越靠前越"省事"，也越安全；真开新路是最后手段。
 */
export function resolveFreeAction(intent: IntentResult, ctx: FreeContext): FreeOutcome {
  const { state, pres, rng } = ctx

  if (!INTENT_WHITELIST.includes(intent.intent)) {
    return { kind: 'refused', reason: '这一手，你没有真的动。' }
  }

  const grounded = groundTarget(intent.target, state)

  // 提到了具体东西但身上没有 —— 明确不认，且说明原因（不是惩罚）
  if (intent.target && !grounded) {
    return {
      kind: 'grounded',
      reason: `你摸了摸行囊，里面并没有「${intent.target}」。`,
    }
  }

  const conf = clamp01(intent.confidence ?? 0.5)

  // ① 剧本里：能落到某件物证的，直接走「以物试之」（结算完全走原规则）
  if (pres.kind === 'scenario' && grounded?.kind === 'item') {
    const trial = pres.trials?.find((x) => x.ref === grounded.id)
    if (trial) return { kind: 'trial', ref: trial.ref, affordance: trial.affordance }
  }
  if (pres.kind === 'scenario' && grounded?.kind === 'rule') {
    const trial = pres.trials?.find((x) => x.ref === grounded.ref)
    if (trial) return { kind: 'trial', ref: trial.ref, affordance: trial.affordance }
  }

  // ② 散事件里：意图对得上某个既有选项，就走它 —— 规则一个字不改。
  //
  // 判据只看**呈现里的选项**，不看事件对象：这一层负责"落到哪里"，
  // 而执行时由调用方去查事件。要求 event 在场会平白多一个耦合，
  // 让这个纯函数没法单独测。
  if (pres.options.length > 0) {
    const same = pres.options.filter((o) => o.intent === intent.intent)
    // 把握够高才敢替玩家选；否则宁可走新路，也不擅自替他做决定
    if (same.length > 0 && conf >= 0.6) {
      return { kind: 'mapped', option: rng.pick(same) }
    }
  }

  // ③ 新路：属性判定。跨体系融合会给一点额外余地。
  const attr = INTENT_ATTR[intent.intent]
  const fuse = isFusionAttempt(intent, grounded, state)
  const hasGrounding = Boolean(grounded)

  // 没有具体物证兜底的空口白话，成功率压得很低 ——
  // 自由不等于空想，说得再漂亮也得有东西撑着
  const base = hasGrounding ? 0.45 : 0.2
  const resolve = {
    roll: { base: base + conf * 0.15, attr, attr_weight: 0.004 },
    /** 跨体系融合走相性：对方体系与你不合时会被压 */
    affinity_sensitive: fuse,
    bands: {},
  }
  const { band } = rollBand(resolve, state, rng)

  return {
    kind: 'novel',
    band,
    attr,
    fuse,
    reason: fuse
      ? '你把两套本不相干的规矩接到了一起——它们居然真的接上了。'
      : '你按自己的想法动了手。',
  }
}

/**
 * 是不是一次「跨体系融合」的尝试。
 *
 * 玩家要的那种涌现（异火被当成星际航行的燃料）本质是：**拿甲体系的底子，
 * 去干乙体系的事**。所以判据是：所依之物 / 所习之法，其来历与当前所处的
 * 体系不同，且玩家确实把它用出来了（有 grounded）。
 */
function isFusionAttempt(
  _intent: IntentResult,
  grounded: ReturnType<typeof groundTarget>,
  state: GameState,
): boolean {
  if (!grounded || grounded.kind !== 'rule') return false
  return grounded.pack !== state.pack_id
}

/** 自由输入的提示词 —— 供应商无关，主进程与浏览器共用同一份 */
export const INTENT_SYSTEM_PROMPT = `你在为文字修仙游戏《玄》做意图解析。玩家在做一个选择时，会写下自己想做的事。

你的唯一任务：把这句话解析成结构化意图。**你不判定结果，也不产生任何数值。**

只输出 JSON：
{
  "intent": "greedy|steady|scheme|flee|evil|social|study|sacrifice 之一",
  "target": "玩家作用的具体对象（物品名/法门名/某个人）。没提到就留空",
  "approach": "玩家用的手法，一句话",
  "confidence": 0.0 到 1.0 之间的把握度,
  "narration": "一到两行旁白，第二人称「你」，写他做了什么、周遭有何反应。**不得写出任何结果好坏**，不得出现数字、资源名（灵石/修为/丹药）、属性名、成功率"
}

判断准则：
- greedy 贪进夺宝 / steady 稳妥行事 / scheme 用计智取 / flee 退避保身
- evil 伤人夺命 / social 交涉结交 / study 参悟研习 / sacrifice 舍己付出
- 玩家想做的事若明显超出当前处境，confidence 调低
- narration 停在动作与物象上，不要抒情，不要作结

只输出 JSON，不要别的话。`

/** 玩家输入的硬上限 —— 防止把小说整段粘进来 */
export const FREE_INPUT_MAX = 120
