/**
 * 规则供应商 —— **兜底中的兜底**。
 *
 * 没有模型、模型超时、模型返回非法 JSON、密钥没填、断网、在飞机上 ——
 * 一律落到这里。所以它只有一条铁律：**永不失败、永不抛异常、永不联网。**
 *
 * 代价是准确率不高。这是刻意的：规则层给出的 confidence 一律压在
 * 0.4–0.55，而 core 里「替玩家选既有选项」的门槛是 0.6 ——
 * 也就是说规则层**永远不会替玩家套用既有选项**，它只把句子翻译成一个方向，
 * 剩下的交给属性判定。宁可走一条新路，也不擅自替玩家做决定。
 *
 * 数值？这里一个都不产生。
 */

import type { IntentResult } from '@/core/intent'
import type { Intent } from '@/core/types'
import type { IntentCtx, IntentProvider } from './provider'
import { clampInput } from './provider'

/* ============================================================
   关键词表
   ------------------------------------------------------------
   中文没有词边界，同义动词又互相咬（"退"在"退避"里也在"退还"里），
   所以判据用**权重 + 命中词长**，而不是"看到一个词就定案"：
   越长的词越具体，命中了就越算数。
   ============================================================ */

interface Rule {
  intent: Intent
  /** 该组词的基准权重 */
  w: number
  words: string[]
}

/** 次序即平局时的优先级：越靠前越"具体"，越不容易被泛词盖过 */
const RULES: Rule[] = [
  {
    intent: 'evil',
    w: 1.2,
    words: ['杀', '斩', '宰', '屠', '灭口', '弄死', '毒死', '弑', '除掉', '下杀手', '痛下杀手', '斩草除根', '偷袭'],
  },
  {
    intent: 'flee',
    w: 1.1,
    words: [
      '逃', '跑', '撤', '退', '溜', '闪', '避', '保命', '求生', '走为上', '抽身',
      '躲', '藏', '不趟浑水', '逃命', '求饶', '转身就走', '退出',
    ],
  },
  {
    intent: 'scheme',
    w: 1.05,
    words: ['计', '谋', '诈', '骗', '设局', '陷阱', '诱', '假装', '蒙', '引开', '调虎离山', '瞒', '声东击西', '诓'],
  },
  {
    intent: 'sacrifice',
    w: 1.0,
    words: ['舍', '牺牲', '让给', '赠', '献', '救', '替', '挡', '付出', '割舍', '成全', '以身相代', '自损'],
  },
  {
    intent: 'social',
    w: 1.0,
    words: [
      '说', '谈', '问', '交涉', '结交', '求', '请', '拜', '商量', '劝', '讨', '寒暄',
      '打招呼', '套话', '攀谈', '说服', '搭话', '开口',
    ],
  },
  {
    intent: 'study',
    w: 1.0,
    words: [
      '参悟', '研习', '修', '悟', '练', '读', '推演', '揣摩', '学习', '研究', '沉思',
      '打坐', '冥想', '琢磨', '请教', '参详',
    ],
  },
  {
    intent: 'greedy',
    w: 1.0,
    words: [
      '抢', '夺', '取', '拿', '掠', '偷', '盗', '摸走', '独吞', '据为己有', '顺手牵羊',
      '搜刮', '捡', '收下', '私藏', '抢走', '夺宝', '攫取', '据有',
    ],
  },
  {
    intent: 'steady',
    w: 0.9,
    words: [
      '稳', '谨慎', '小心', '稳妥', '不冒', '按兵不动', '保守', '耐心', '等待', '慢慢',
      '不急', '观察', '细察', '三思', '稳妥起见', '沉住气', '不轻举妄动', '以静制动', '静静',
    ],
  },
]

/** 什么都没匹配上时给的方向 —— 不动如山是中文语境里最中性的一手 */
const DEFAULT_INTENT: Intent = 'steady'

/** 规则层的把握度天花板。**必须低于 core 里替玩家选路所需的 0.6。** */
export const RULE_CONF_MAX = 0.55
export const RULE_CONF_MIN = 0.4

const norm = (s: string): string => s.replace(/\s+/g, '').toLowerCase()

/* ============================================================
   目标的抽取
   ------------------------------------------------------------
   只从**玩家身上真有的东西**里抽：行囊名与已习之法。
   于是规则层交给引擎的 target，必定能被 core 的 groundTarget 接住 ——
   规则层不会说出一个玩家没有的东西（那是模型才会犯的错）。
   ============================================================ */

export function extractTarget(hay: string, names: string[]): string | null {
  let best: { text: string; len: number } | null = null

  for (const raw of names) {
    if (typeof raw !== 'string') continue
    const n = norm(raw)
    if (n.length < 2) continue

    // ① 全名出现 —— 最可靠
    if (hay.includes(n)) {
      if (!best || n.length > best.len) best = { text: n, len: n.length }
      continue
    }
    // ② 名字的一段（「青冥瓶」→「冥瓶」）。只认到 2 字：再短就纯属巧合。
    for (let len = Math.min(3, n.length - 1); len >= 2; len--) {
      let hit = ''
      for (let i = 0; i + len <= n.length; i++) {
        const win = n.slice(i, i + len)
        if (hay.includes(win)) {
          hit = win
          break
        }
      }
      if (hit) {
        if (!best || hit.length > best.len) best = { text: hit, len: hit.length }
        break
      }
    }
  }
  return best?.text ?? null
}

/* ============================================================
   分类
   ============================================================ */

/** 纯函数版：给定输入与处境，永远返回一个合法的 IntentResult */
export function classifyByRule(input: string, ctx?: Partial<IntentCtx>): IntentResult {
  const text = clampInput(input)
  const hay = norm(text)

  // 抽出目标 —— 只认**玩家身上真有的东西**（行囊 + 已习之法）。
  // 绝不从选项文案里抽：那样抽出来的 target 过不了 core 的落地校验，
  // 会凭空造出"你摸了摸行囊，里面并没有…"这种假警报。
  let target: string | null = null
  try {
    const names = (ctx?.possessions ?? []).filter((x): x is string => typeof x === 'string')
    target = extractTarget(hay, names)
  } catch {
    target = null // 处境数据形状不对也不该拖垮兜底
  }

  let bestIntent: Intent = DEFAULT_INTENT
  let bestScore = 0
  let bestLen = 0

  for (const rule of RULES) {
    for (const kw of rule.words) {
      const k = norm(kw)
      if (k.length === 0 || !hay.includes(k)) continue
      // 长词比短词具体得多：「按兵不动」该压过「说」，「参悟」该压过「问」。
      // 词长权重给到 0.15，是为了让同权重下 2 字词稳定胜过 1 字词。
      const score = rule.w + k.length * 0.15
      if (score > bestScore) {
        bestScore = score
        bestIntent = rule.intent
        bestLen = k.length
      }
    }
  }

  // 0.4 起，命中越长越有把握，封顶 0.55。
  //
  // **认出对象要重赏**（+0.08）：`target` 是拿玩家行囊里的名字去比出来的，
  // 是**经过核实**的信号 —— 他真的拿着那件东西，不是随口一提。
  // 相比之下关键词长度只是"猜得像不像"。核实过的事实比猜出来的像升权，
  // 于是"掏出青冥瓶强行抢夺"能过 0.5 的映射门槛，而"我随便动动"过不了。
  const confidence = Math.min(
    RULE_CONF_MAX,
    RULE_CONF_MIN + Math.min(0.12, bestLen * 0.05) + (target ? 0.08 : 0),
  )

  const result: IntentResult = { intent: bestIntent, confidence }

  // 目标必须是**玩家真有的**才写进去，这样 core 的落地校验一定接得住
  if (target) result.target = target

  // 手法只用于生成「系统怎么理解你」那句话，不参与任何判定
  const excerpt = text.replace(/[。，、！？；：…\s]+$/, '').slice(0, 18)
  if (excerpt) result.approach = excerpt

  return result
}

/** 「什么都没听懂」时的保底 —— 连出错的余地都不留 */
const NEUTRAL: IntentResult = { intent: DEFAULT_INTENT, confidence: RULE_CONF_MIN }

export class RuleProvider implements IntentProvider {
  readonly id = 'rule' as const
  readonly label = '本地规则'

  async ready(): Promise<boolean> {
    return true // 零依赖、离线可用 —— 永远就绪
  }

  async classify(input: string, ctx: IntentCtx): Promise<IntentResult> {
    try {
      return classifyByRule(input, ctx)
    } catch (err) {
      // 兜底自己出错是最不该发生的事。真出了，也要给出一个合法的意图。
      console.warn('[玄] 规则解析异常，已退回中性意图。', err)
      return { ...NEUTRAL }
    }
  }
}

export const ruleProvider = new RuleProvider()
