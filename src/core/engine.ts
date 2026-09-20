/**
 * 引擎 —— 状态机 · 事件调度器 · 剧本推进器 · 结算。
 *
 * 全部是纯函数：给定同一份 state 与同一份 seed，输出必然一致。
 * 这保证了回放、蒙特卡洛模拟与 bug 复现（SPEC 第 1 章决策 #2）。
 *
 * 铁律：数值永不由文本层决定。这里只算数值，文本由 narrative.ts 单独选。
 */

import { PACK_ESSENCE } from './affinity'
import { evaluate } from './conditions'
import { resolveFreeAction, type IntentResult } from './intent'
import {
  canKill,
  resolveDuel,
  setupDuel,
  type DuelOpponent,
  type StanceId,
} from './duel'
import { divideInitAttrs } from './genesis'
import {
  ARCHETYPE_NAMES,
  advanceFate,
  checkDestinyProtection,
  generateDestinyChildren,
  killDestinyChild,
} from './destiny'
import { PACK_IDS, resolveAffordances, type ContentDB } from './content'
import { pickFromPool, splitLines } from './narrative'
import { Rng, deriveSeed, makeSeed } from './rng'
import { applyEffects, clampVar, mergeDelta, rollBand } from './resolve'
import type {
  AnyEvent,
  AttrKey,
  Band,
  Condition,
  DailyAction,
  DailyActionId,
  DeltaEntry,
  DuelOutcome,
  Essence,
  DestinyChild,
  Effect,
  Ending,
  GameState,
  Item,
  LooseEvent,
  NodePresentation,
  Option,
  OutcomeBand,
  PackId,
  Realm,
  Scenario,
  ScenarioAction,
  ScenarioActionId,
  Stage,
  TrialOption,
  VarKey,
} from './types'

// ============================================================
// 阶段与节奏
// ============================================================

const TOTAL_NODES_BASE = 24

/** 阶段按比例推进，保证 20–30 节点的节奏稳定 */
export function stageForNode(n: number, total: number): Stage {
  const r = n / total
  if (r < 0.1) return 'childhood'
  if (r < 0.28) return 'entry'
  if (r < 0.72) return 'growth'
  if (r < 0.92) return 'turn'
  return 'endgame'
}

const STAGE_TENSION_TARGET: Record<Stage, number> = {
  childhood: 2,
  entry: 4,
  growth: 5,
  turn: 8,
  endgame: 9,
}

/**
 * 累积修为 → power_index 的换算率（**平衡主旋钮**）。
 *
 * 事件改写的是 `vars.power`（累积修为），而境界由累积量反推。
 * 没有这一步，玩家会一辈子停在最底层——所有高境界结局都成死内容。
 * 调这个值等于调整整局的成长速度，改前先跑 Monte Carlo。
 */
export const POWER_TO_INDEX = 0.26

/**
 * 由累积修为反推 power_index 与 realm_idx。
 * 这是「统一数值骨架」的落地：引擎只认 power_index，
 * 表层境界名是它经体系包查表得到的投影。
 */
/**
 * 大境界内部的小境界称呼。
 *
 * 玩家反馈「缺乏小境界提升的明显，直接就大境界跨越了，每个境界停留时间较短」——
 * 十三个大境界摊在二十五步里，每跨一级都是大跳，成长感是断的。
 * 有了小境界，同样一段路会被切成「炼气七层→八层→九层→筑基初期」，
 * 每一步都有东西可看，大跨越也就不显得突兀了。
 *
 * 默认口径按修行题材的惯例：首个大境界九层，其余初期/中期/后期/圆满。
 * 内容包可用 `realm.sub_names` 覆盖。
 */
const SUB_NINE = ['一层', '二层', '三层', '四层', '五层', '六层', '七层', '八层', '九层']
const SUB_FOUR = ['初期', '中期', '后期', '圆满']

export function subLevelsOf(realm: Realm | undefined, realmIdx: number): string[] {
  if (!realm) return []
  // 显式给了空数组 = 这个体系不要小境界。
  // 阶位/序列类的体系（如灰雾之秘的"阶位九品→一品"）名字本身已经有序，
  // 再缀上"一层"会变成"阶位八品一层"这种别扭的东西。
  if (Array.isArray(realm.sub_names)) return realm.sub_names
  if (realmIdx <= 0) return [] // 凡人无小境界
  if (realmIdx === 1) return SUB_NINE
  return SUB_FOUR
}

/** 「炼气七层」「筑基后期」「凡人」 */
export function progressNameOf(state: GameState, content: ContentDB): string {
  const pack = content.packs[state.pack_id]
  const realm = pack?.realms[state.realm_idx]
  if (!realm) return '未知'
  const subs = subLevelsOf(realm, state.realm_idx)
  if (subs.length === 0) return realm.name
  return `${realm.name}${subs[Math.min(state.minor_idx, subs.length - 1)] ?? ''}`
}

export function recomputeProgress(state: GameState, content: ContentDB): GameState {
  const pack = content.packs[state.pack_id]
  if (!pack || pack.realms.length === 0) return state

  const power_index = Math.max(0, Math.min(1000, Math.round(state.vars.power * POWER_TO_INDEX)))

  let realm_idx = 0
  for (let i = pack.realms.length - 1; i >= 0; i--) {
    if (power_index >= pack.realms[i]!.power_index[0]) {
      realm_idx = i
      break
    }
  }

  // 大境界内的小境界：按 power_index 在本段区间里的位置切分
  const realm = pack.realms[realm_idx]!
  const subs = subLevelsOf(realm, realm_idx)
  let minor_idx = 0
  if (subs.length > 0) {
    const [lo, hi] = realm.power_index
    const span = Math.max(1, hi - lo)
    const into = Math.max(0, power_index - lo)
    minor_idx = Math.max(0, Math.min(subs.length - 1, Math.floor((into / span) * subs.length)))
  }

  if (
    power_index === state.power_index &&
    realm_idx === state.realm_idx &&
    minor_idx === state.minor_idx
  ) {
    return state
  }
  return { ...state, power_index, realm_idx, minor_idx }
}

/** 当前境界的表层名（各体系包不同） */
export function realmNameOf(state: GameState, content: ContentDB): string {
  const pack = content.packs[state.pack_id]
  return pack?.realms[state.realm_idx]?.name ?? '未知'
}

// ============================================================
// 年龄与寿元
// ============================================================

/** 开局岁数 —— 童年期起点 */
export const START_AGE = 16

/** 境界未标注寿命时（真仙以上）视作不受寿数所限 */
export const UNBOUNDED_LIFESPAN = 999_999

/**
 * 每个节点跨过的年数。
 *
 * 修行不是逐日过的：低境界几年一节点，高境界一次闭关就是几十年上百年。
 * 这也让「境界表里 1600 / 6400 这种大数字」有了着落——不是给你一千六百年花，
 * 而是**能活到一千六百岁**，而高境界的每一年本来就走得快。
 *
 * 由此得到一条天然的压力：**停在低境界，年月照样在走，你会老死**。
 * 这正是凡人流的核心恐怖。
 */
export const YEARS_BASE = 2
export const YEARS_PER_REALM = 4

export function yearsPerNode(state: GameState): number {
  return YEARS_BASE + state.realm_idx * YEARS_PER_REALM
}

/**
 * 寿元上限 = 当前境界的寿命 + 折损。
 * 折损为负（被折了寿）就压低上限；为正（得了延寿之物）就抬高。
 */
export function lifespanCapOf(state: GameState, content: ContentDB): number {
  const realm = content.packs[state.pack_id]?.realms[state.realm_idx]
  const base = realm?.lifespan ?? UNBOUNDED_LIFESPAN
  return Math.max(1, base + (state.vars.lifespan ?? 0))
}

export interface AgeInfo {
  age: number
  cap: number
  /** 剩余年岁 */
  left: number
  /** 已过的比例 0–1 */
  ratio: number
  /** 是否已到寿尽边缘（剩不到两成） */
  dire: boolean
  /** 该境界是否本就不受寿数所限 */
  unbounded: boolean
}

/** UI 与门禁共用：把年龄与寿元一起算出来 */
export function ageInfoOf(state: GameState, content: ContentDB): AgeInfo {
  const cap = lifespanCapOf(state, content)
  const age = state.age ?? START_AGE
  const left = cap - age
  const unbounded = cap >= UNBOUNDED_LIFESPAN
  return {
    age,
    cap,
    left,
    ratio: unbounded ? 0 : Math.max(0, Math.min(1, age / Math.max(1, cap))),
    dire: !unbounded && left <= cap * 0.2,
    unbounded,
  }
}

/** 「年龄 37 / 寿元 120」—— 界面与旁白用同一套说法 */
export function ageLabelOf(state: GameState, content: ContentDB): string {
  const a = ageInfoOf(state, content)
  if (a.unbounded) return `年龄 ${Math.round(a.age)} · 寿数不限`
  return `年龄 ${Math.round(a.age)} / 寿元 ${Math.round(a.cap)}`
}

/** 年数分档 —— 过渡句要按跨度选说法，"三年后"和"三百年后"不是一回事 */
export function yearsBucket(years: number): 'few' | 'some' | 'many' | 'ages' {
  if (years <= 3) return 'few'
  if (years <= 15) return 'some'
  if (years <= 80) return 'many'
  return 'ages'
}

/**
 * 承上启下的过渡句 —— 接上上一件事与这一件事之间的缝。
 *
 * 为什么必须单独生成：正文是按 `loose.<母题>.<阶段>` 独立取词的，
 * **它不知道前一个节点讲过什么**。于是两个节点摆在一起就是两张不相干的画：
 * 上一句祖父递来一卷书，下一句你已经跟着商队进了山，中间发生了什么
 * 全靠玩家自己脑补。这类断裂不是文笔问题，是缺了一层接缝。
 *
 * 素材全部现成：过了多少年、境界有没有跳、上一个母题是什么、是不是换了人生阶段。
 * 不需要模型，也不需要新的状态。
 */
export function composeTransition(
  state: GameState,
  content: ContentDB,
  rng: Rng,
): string | undefined {
  if (state.node_index === 0) return undefined // 开局第一拍前面没有东西可接

  const years = state.last_years ?? 0
  const prevStage = stageForNode(Math.max(0, state.node_index - 1), state.total_nodes)
  const stageChanged = prevStage !== state.stage
  const realmUp = (state.last_realm_idx ?? 0) < state.realm_idx
  const age = ageInfoOf(state, content)

  // 按优先级挑一条：人生阶段 > 境界跃迁 > 寿元告急 > 年数跨度
  let key: string
  if (stageChanged) key = `transition.stage.${state.stage}`
  else if (realmUp) key = 'transition.realm_up'
  else if (age.dire) key = 'transition.dire_age'
  else key = `transition.years.${yearsBucket(years)}`

  const picked = pickFromPool(key, content.l2, state, rng)
  let text = picked.text
  // 兜底：没写这个 key 的内容也不该出现空白接缝
  if (!text) {
    const fallback = pickFromPool('transition.years.some', content.l2, state, rng)
    text = fallback.text
  }
  if (!text) return undefined

  // 年数由引擎填，不由文本层决定 —— 数值永远出自状态层
  return text.replace(/\{years\}/g, String(Math.max(1, Math.round(years)))).trim()
}

/**
 * 每节点基础修炼收益 —— 对应上游设计文档 7.3 的 `cultivate_gain_base`。
 *
 * **事件是际遇，修炼是日常。** 只靠事件给修为的话，一次奇遇加个十几点，
 * 二十几个节点下来玩家还停在炼气期，所有高境界结局都是死内容。
 * 修行者是在事件之间一天天长大的，这条补上"时间在走"的那部分。
 *
 * 悟性越高越快；境界越高，单节点收益也越高（高阶修士的日常吐纳本就更多）。
 */
export const CULTIVATE_BASE = 8

/**
 * 剧本在节点中的目标占比（SPEC 第 3 章的三层结构：散事件 ~70% / 剧本 ~25%）。
 * 这里给的是"有可用剧本时，本节点进入剧本的概率"。
 */
export const SCENARIO_SHARE = 0.18

/**
 * 剧本最早可出现的阶段。
 *
 * 剧本的 `unsolved` 大多带 `trigger_end` —— 破不了局，此世就到头了。
 * 这是**设计要的戏剧性**（"你被封在冢中，成了后来者口中的传说"），
 * 但也意味着：在玩家还没攒下任何器物与法门时把他丢进剧本，
 * 等于开局即判死。童年与入门阶段是攒家底的，不该有这种杀局。
 */
export const SCENARIO_MIN_STAGE: Stage = 'growth'

const STAGE_RANK: Record<Stage, number> = {
  childhood: 0,
  entry: 1,
  growth: 2,
  turn: 3,
  endgame: 4,
}

/**
 * 每节点修为进项 —— **与处境挂钩，不是匀速上涨**。
 *
 * 玩家的原话："修为和事件好像没什么关联，自然而然就在增长"。
 * 之前这里是个只跟悟性和境界有关的常数，于是时间一推就涨，
 * 跟这一路上发生了什么毫无关系。现在它被三件事改写：
 *
 *   1. **伤势**——带伤运功事倍功半；重伤之下强行催动，反而会跌。
 *      这是"受伤倒退"的来源，也是凡人流里最常见的那种倒退。
 *   2. **刚做过什么**——闭关参悟算修行，游历争斗不算。
 *      按最近几次选择的意图给一个 0.6~1.6 的系数。
 *   3. **心魔 / 因果**——污染重了心不静，欠债多了心不安。
 */
export function cultivateGain(state: GameState): number {
  const witsFactor = 1 + state.attrs.wits / 100
  const realmFactor = 1 + state.realm_idx * 0.2
  const base = CULTIVATE_BASE * witsFactor * realmFactor

  return base * cultivationCondition(state)
}

/** 当前处境对修行效率的乘数（含为负的情形） */
export function cultivationCondition(state: GameState): number {
  const hp = state.vars.hp ?? 0
  const corruption = state.vars.corruption ?? 0
  const debt = state.vars.debt ?? 0

  // 伤势：以 85 为**零点** —— 无伤时 1.0，85（垂危）时 0，再往上是负的。
  // 零点之所以不放在 100，是因为"还剩一口气才倒退"太晚了：
  // 85 之后就已经是硬撑着运功，该开始伤根基了。
  const injury = (85 - hp) / 85

  // **修行有快慢，但不是"除了闭关就一无所得"。**
  //
  // 玩家原话："不是每一次事件都会增长修为的"。第一版我把它读成了
  // "某些打法修为恒为零" —— 夺宝、厮杀、逃命一律不涨。结果是：
  // 敢冒险的玩家把代价全付了、收益一分没拿，战力只有稳健路线的四成，
  // 支配性检测直接报警。那不是"修行有快慢"，那是罚人。
  //
  // 改成**宽幅**：参悟最丰，厮杀最薄，但都有 —— 历练也是修行的一种。
  // 八倍差距足够让"你把时间花在哪"看得出来，又不至于把一条路堵死。
  const last = (state.history ?? [])[state.history.length - 1]
  const PRACTICE: Record<string, number> = {
    study: 1.0,     // 参悟研习
    steady: 0.9,    // 闭关打坐
    scheme: 0.6,    // 用计也是动脑子
    social: 0.5,    // 交游长见识
    sacrifice: 0.45,
    greedy: 0.35,   // 夺宝是历练
    evil: 0.3,
    flee: 0.25,     // 逃命学到的也是东西
  }
  const practice = last?.intent ? (PRACTICE[last.intent] ?? 0.5) : 0.5

  // 心境：污染与因果都拖慢修行
  const mind = Math.max(0.5, 1 - corruption / 200 - debt / 300)

  // 静修加成：最近在参悟就有额外进项，否则 0.85（边走边练，事倍功半）
  const focus = 0.85 + Math.min(0.6, practice)

  const mult = injury * mind * focus

  // 重伤之下**主动倒退**：这不是惩罚，是"带伤强行运功，修为反而散了"。
  // 玩家明确要过这一条（"甚至可以有受伤倒退"），所以不设正的下界。
  //
  // 但它只在**真的快不行了**的时候发生：hp ≥ 75（垂危）才可能转负，
  // 且最深只到 −0.25 —— 一个节点掉掉百分之几的修为，是挫折不是毁灭。
  // 想让玩家跌境，该由事件显式写 modify_power_index 负值，而不是靠被动流失。
  // 这一手根本不在修行 —— 不涨，也不掉（伤势造成的倒退另算，见下）
  const dormant = practice <= 0 && hp < 85
  if (dormant) return 0

  // 下界 −0.25：掉是掉，但一个节点掉掉百分之几，是挫折不是毁灭。
  return Math.max(-0.25, Math.min(1.6, mult))
}

/**
 * 每节点伤势自愈 —— 修士不是凡人，伤口会自己收口。
 *
 * 没有这一条，伤势是**单调累积**的：每次失败都往上加，从不下降，
 * 于是所有人最终都死于同一件事——伤口攒够了。实测里一路随便选的玩家
 * 第七个节点就油尽灯枯，这不是难度，是缺了一条规则。
 *
 * 根骨主肉身（上游 4.3），所以自愈速度由它决定。
 */
export const HEAL_BASE = 1.2

export function healPerNode(state: GameState): number {
  const rootFactor = 1 + state.attrs.root / 100
  const realmFactor = 1 + state.realm_idx * 0.15
  return HEAL_BASE * rootFactor * realmFactor
}

// ============================================================
// 开局
// ============================================================

export interface RunConfig {
  runId: string
  seed?: string
  packId: PackId
  originId: string
  traitIds: string[]
  flawId?: string
  content: ContentDB
  /** 0–3 个位面之子 */
  destinyCount?: number
}

export function startRun(cfg: RunConfig): GameState {
  const { content, packId } = cfg
  const runId = cfg.runId
  const seed = cfg.seed ?? makeSeed(runId, 0, 'root')

  const origin = content.origins.find((o) => o.id === cfg.originId) ?? content.origins[0]
  const traits = cfg.traitIds
    .map((t) => content.traits.find((x) => x.id === t))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
  const flaw = cfg.flawId ? content.flaws.find((f) => f.id === cfg.flawId) : undefined

  const pack = content.packs[packId]
  if (!pack) throw new Error(`未知体系包：${packId}`)

  // 起点属性：基础 + 出身修正 + 天赋/缺陷效果
  let attrs = divideInitAttrs(new Rng(deriveSeed(seed, 'attrs')), origin, traits, flaw)

  const vars: Record<VarKey, number> = {
    currency: 20,
    power: 0,
    rare_mat: 0,
    favor: 0,
    debt: 0,
    exposure: 0,
    corruption: 0,
    karma: 0,
    hp: 0, // 伤势：开局完好（0 = 无伤，100 = 油尽灯枯）
    lifespan: 0, // 寿元折损：0 = 未折损。上限由境界决定，见 lifespanCapOf
  }
  for (const [k, v] of Object.entries(origin?.start_resources ?? {})) {
    vars[k as VarKey] = v as number
  }

  const flags: Record<string, boolean> = {}
  for (const f of origin?.inherent_flags ?? []) flags[f] = true

  // 开局物品：一件本体系的凡品
  const starterItems = pickStarterItems(content, packId, new Rng(deriveSeed(seed, 'items')), 2)

  const total_nodes = TOTAL_NODES_BASE + new Rng(deriveSeed(seed, 'len')).int(0, 6)

  // 位面之子：从**其他**体系包生成
  const destinies = generateDestinyChildren({
    seed,
    playerPack: packId,
    allPacks: PACK_IDS,
    count: cfg.destinyCount ?? new Rng(deriveSeed(seed, 'dcount')).int(0, 3),
    realmNames: Object.fromEntries(
      PACK_IDS.map((p) => [p, (content.packs[p]?.realms ?? []).map((r) => r.name)]),
    ) as Partial<Record<PackId, string[]>>,
    fateTemplates: content.fateTemplates,
    regionTags: ['wild', 'cave', 'city', 'sect', 'ruin'],
    oraclePool: content.oracle,
  })

  const state: GameState = {
    run_id: runId,
    seed,
    node_index: 0,
    stage: 'childhood',
    pack_id: packId,
    age: START_AGE,
    realm_idx: 0,
    minor_idx: 0,
    power_index: 0,
    attrs,
    vars,
    flags,
    items: starterItems,
    relations: [],
    learned_rules: [],
    titles: [],
    codex: [],
    faction_tier: {},
    history: [],
    queue: [],
    recent_motifs: [],
    recent_tags: [],
    recent_narrative: [],
    destiny_children: destinies,
    ending_threads: [],
    status: 'alive',
    rule_version: '2026-09',
    content_version: content.version,
    total_nodes,
    completed_scenarios: [],
    fired_events: [],
  }

  // 天赋/缺陷的即时效果
  const instant: Effect[] = [
    ...traits.flatMap((t) => t.effects),
    ...(flaw?.effects ?? []),
  ]
  const withEffects = applyEffectsState(state, instant, 'origin')

  return withEffects
}

function pickStarterItems(content: ContentDB, packId: PackId, rng: Rng, n: number): Item[] {
  const affixMap = new Map(content.affixes.map((a) => [a.id, a]))
  const pool = content.items.filter((i) => i.quality === '凡品' || i.quality === '灵品')
  const picked = rng.weightedSample(pool, pool.map(() => 1), n)
  return picked.map((i) => ({ ...i, affordance: resolveAffordances(i, affixMap) }))
}

// ============================================================
// 状态合并（把 Effect[] 真正落到 state 上）
// ============================================================

function applyEffectsState(state: GameState, effects: Effect[], reason: string): GameState {
  const { delta } = applyEffects(effects, state, reason)
  let next = mergeDelta(state, delta)

  const vars = { ...next.vars }
  const items = [...next.items]
  const flags = { ...next.flags }
  const relations = [...next.relations]
  const learned = [...next.learned_rules]
  const titles = [...next.titles]
  const codex = [...next.codex]
  const queue = [...next.queue]
  let pending_ending = next.pending_ending
  const threads = [...next.ending_threads]

  for (const eff of effects) {
    switch (eff.type) {
      case 'add_item': {
        const proto = state.items.find((i) => i.id === eff.ref)
        if (proto) items.push({ ...proto })
        break
      }
      case 'consume_item': {
        const idx = items.findIndex((i) => i.id === eff.ref)
        if (idx >= 0) items.splice(idx, 1)
        break
      }
      case 'set_flag':
        flags[eff.key] = true
        break
      case 'clear_flag':
        delete flags[eff.key]
        break
      case 'set_relation': {
        const r = relations.find((x) => x.npc_id === eff.npc_id && x.kind === eff.kind)
        if (r) r.value += eff.delta
        else relations.push({ npc_id: eff.npc_id, kind: eff.kind, value: eff.delta })
        break
      }
      case 'queue_followup': {
        const parsed = parseFollowup(eff.ref, next.node_index)
        if (parsed) queue.push(parsed)
        break
      }
      case 'unlock_title':
        if (!titles.includes(eff.ref)) titles.push(eff.ref)
        break
      case 'unlock_codex':
        if (!codex.includes(eff.ref)) codex.push(eff.ref)
        break
      case 'learn_rule':
        if (!learned.some((r) => r.pack === eff.pack && r.ref === eff.ref)) {
          learned.push({ pack: eff.pack, ref: eff.ref, name: eff.ref })
        }
        break
      case 'modify_power_index': {
        // power_index 是派生的（由 vars.power 反推），直接改它会被
        // recomputeProgress 覆盖。这里换算回累积修为池。
        const curIndex = vars.power * POWER_TO_INDEX
        const nextIndex = Math.max(0, Math.min(1000, curIndex + eff.delta))
        vars.power = nextIndex / POWER_TO_INDEX
        break
      }
      case 'destiny_drain': {
        // 遭遇事件是**静态内容**，而位面之子是**程序化生成**的，
        // 所以事件无法写死具体 id。约定 ref = '@current' 时绑定到
        // 当前在场的存活者（优先气运最薄的那位，即最有机会得手的）。
        const alive = next.destiny_children.filter((d) => d.alive)
        const dc =
          eff.ref === '@current'
            ? alive.sort((a, b) => a.destiny_pool - b.destiny_pool)[0]
            : next.destiny_children.find((d) => d.id === eff.ref)
        if (dc) dc.destiny_pool = Math.max(0, dc.destiny_pool - eff.delta)
        break
      }
      case 'trigger_end':
        pending_ending = eff.ref
        break
      default:
        break
    }
  }

  next = {
    ...next,
    vars,
    items,
    flags,
    relations,
    learned_rules: learned,
    titles,
    codex,
    queue,
    pending_ending,
    ending_threads: threads,
  }
  // 效果应用期间境界保持不动，真正的推进只在 advanceNode → recomputeProgress
  // 这一条路径上发生（单一换算入口，避免两处打架）。
  return next
}

/** "evt_x@3-8" 或 "evt_x@debt>=3" */
function parseFollowup(ref: string, nodeIndex: number) {
  const [id, cond] = ref.split('@')
  if (!id) return null
  if (!cond) return { event_id: id, window: [nodeIndex + 1, nodeIndex + 6] as [number, number] }
  const m = cond.match(/^(\d+)-(\d+)$/)
  if (m) {
    return {
      event_id: id,
      window: [nodeIndex + Number(m[1]), nodeIndex + Number(m[2])] as [number, number],
    }
  }
  return { event_id: id, window: [nodeIndex + 1, nodeIndex + 8] as [number, number] }
}

// ============================================================
// 调度器（SPEC 5.5）
// ============================================================

export interface SchedulerInput {
  state: GameState
  content: ContentDB
  rng: Rng
}

/**
 * 结构性标签 —— 出现在过多事件上的标签，描述的是「阶段 / 体裁」而非「内容身份」。
 *
 * 拿它们做冷却会让整池事件互相排斥：若全部童年事件都带 `early`，
 * 一个触发后其余全被挡掉，调度器抽不到任何事件，游戏从此空转。
 * 判据是**数据驱动**的，不写死清单 —— 换一批内容也不用改这里。
 */
export function structuralTagsOf(content: ContentDB): Set<string> {
  const count = new Map<string, number>()
  for (const e of content.events) {
    for (const t of e.tags) count.set(t, (count.get(t) ?? 0) + 1)
  }
  const threshold = Math.max(8, content.events.length * 0.12)
  const out = new Set<string>()
  for (const [t, n] of count) {
    if (n > threshold) out.add(t)
  }
  return out
}

/**
 * 过滤 → 加权 → 保底 → 抽样
 */
export function pickNextEvent(input: SchedulerInput): LooseEvent | Scenario | null {
  const { state, content, rng } = input
  const pack = content.packs[state.pack_id]

  // 1. 队列保底：窗口内必出 —— **出过就不再出**。
  //
  // 少了 `fired_events` 这一条，一个窗口是 [7,12] 的连锁事件会在第 7 到第 12
  // 个节点**每一拍都返回同一个事件**：它走的是保底路径，绕过全部冷却与权重，
  // 于是玩家连着五六个节点在读同一段文字。试玩 agent 报的"同一母题连着走
  // 五个节点"就是这么来的 —— 不是内容重复，是队列没有出队。
  const forced = state.queue.filter(
    (q) =>
      !state.fired_events.includes(q.event_id) &&
      state.node_index >= q.window[0] &&
      state.node_index <= q.window[1],
  )
  if (forced.length > 0) {
    const id = forced[0]!.event_id
    const ev = content.events.find((e) => e.id === id)
    if (ev) return ev
    const sc = content.scenarios.find((s) => s.id === id)
    if (sc) return sc
  }

  // 2. 过滤 —— 分三级放宽（见下方说明）
  const structural = structuralTagsOf(content)
  const collect = (
    relaxTags: boolean,
    relaxMotif: boolean,
    relaxStage: boolean,
  ): (LooseEvent | Scenario)[] => {
    const out: (LooseEvent | Scenario)[] = []

    for (const e of content.events) {
      if (state.fired_events.includes(e.id) && e.once_per_run) continue
      if (!e.pack.includes(state.pack_id) && !e.pack.includes('*')) continue
      if (!relaxStage && !e.stage.includes(state.stage)) continue
      if (e.requires && !evaluate(e.requires, { state })) continue

      if (!relaxMotif && e.cooldown?.same_motif) {
        const recent = state.recent_motifs.slice(-e.cooldown.same_motif)
        if (recent.includes(e.motif)) continue
      }
      if (!relaxTags && e.cooldown?.same_tag) {
        const recentTags = state.recent_tags.slice(-e.cooldown.same_tag)
        // 结构性标签不参与冷却 —— 它们描述的是阶段而非内容身份
        const meaningful = e.tags.filter((t) => !structural.has(t))
        if (meaningful.some((t) => recentTags.includes(t))) continue
      }
      out.push(e)
    }

    // 剧本：无进行中剧本、且已过开局阶段时才考虑
    if (!state.active_scenario && STAGE_RANK[state.stage] >= STAGE_RANK[SCENARIO_MIN_STAGE]) {
      for (const s of content.scenarios) {
        if (state.completed_scenarios.includes(s.id)) continue
        if (!s.pack.includes(state.pack_id) && !s.pack.includes('*')) continue
        if (s.requires && !evaluate(s.requires, { state })) continue
        out.push(s)
      }
    }
    return out
  }

  // 放宽阶梯：严格 → 忽略标签冷却 → 连母题冷却也忽略 → 连阶段也放宽。
  //
  // 后两级是**安全网**。调度器绝不能被自己的规则锁死，也绝不能让
  // 玩家遇到空节点。两次真实事故：
  //   1. 全部童年事件都带 `early` 标签，一个触发后整池互相排斥，游戏从此空转；
  //   2. 三个体系包的童年/入门阶段事件数为 0，选它们的前七个节点全空。
  // 内容补齐是治本，但引擎这一层必须保证"再缺内容也不会卡住"。
  let candidates = collect(false, false, false)
  if (candidates.length === 0) candidates = collect(true, false, false)
  if (candidates.length === 0) candidates = collect(true, true, false)
  if (candidates.length === 0) candidates = collect(true, true, true)

  if (candidates.length === 0) return null

  // 3. 剧本以**目标概率**直接命中，不参与事件池的加权竞争。
  //
  // 事件池有几百条、权重尺度在百位，剧本权重只有几十 —— 靠"乘个系数"
  // 去调，实际占比会被事件条数稀释到 1% 以下，而且加一条事件就变了。
  // 直接给概率才是可控的。
  const scenarios = candidates.filter((c) => c.kind === 'scenario') as Scenario[]
  if (scenarios.length > 0 && rng.chance(SCENARIO_SHARE)) {
    return rng.weighted(scenarios, scenarios.map((s) => s.weight || 1))
  }

  const evCandidates = candidates.filter((c) => c.kind !== 'scenario')
  if (evCandidates.length === 0) return scenarios.length > 0 ? rng.pick(scenarios) : null

  // 4. 加权
  const target = STAGE_TENSION_TARGET[state.stage]
  // evCandidates 已剔除剧本，这里全是散事件
  // 同一母题不紧挨着重来 —— 内建抑制，不依赖内容自己声明 cooldown。
  //
  // 用**权重压制**而不是过滤：硬过滤在放宽阶梯里会被绕过，放宽之后又
  // 只剩它，于是连着好几个节点都是同一个母题（试玩 agent 报出"本源融合"
  // 连走五个节点）。压到 0.05 既几乎不会发生，又不会把候选集清空。
  const prevMotif = state.last_motif ?? state.recent_motifs[state.recent_motifs.length - 1]

  const weights = (evCandidates as LooseEvent[]).map((c) => {
    const base = c.weight
    const sameAsLast = prevMotif && c.motif === prevMotif ? 0.05 : 1
    const packPref = pack?.motif_weights?.[c.motif] ?? 1
    const tension = c.tension ?? 5
    // 张力拟合：离目标越远权重越低，但不为 0
    const tensionFit = 1 / (1 + Math.abs(tension - target) * 0.25)
    const luckFactor = 1 + (state.attrs.luck - 50) * 0.004
    return base * packPref * tensionFit * luckFactor * sameAsLast
  })

  // 5. 抽样
  return rng.weighted(evCandidates, weights)
}

// ============================================================
// 呈现
// ============================================================

export function buildPresentation(
  state: GameState,
  content: ContentDB,
  ev: LooseEvent | Scenario,
  rng: Rng,
): NodePresentation {
  if (ev.kind === 'scenario') {
    return buildScenarioPresentation(state, content, ev, rng)
  }
  return buildLoosePresentation(state, content, ev, rng)
}

function buildLoosePresentation(
  state: GameState,
  content: ContentDB,
  ev: LooseEvent,
  rng: Rng,
): NodePresentation {
  const title = ev.narrative.title_pool.length > 0 ? rng.pick(ev.narrative.title_pool) : '未名'
  const picked = pickFromPool(ev.narrative.body_key, content.l2, state, rng)
  let lines = splitLines(picked.text)
  if (lines.length === 0) {
    // 三级降级：无文本也要能玩（SPEC 8.6）
    lines = ['雾散雾起，前路未明。']
  }

  return {
    node_index: state.node_index,
    kind: 'loose',
    event_id: ev.id,
    title,
    lines,
    mood: 'mystic',
    transition: composeTransition(state, content, rng),
    options: ev.options.filter((o) => !o.requires || evaluate(o.requires, { state })),
  }
}

function buildScenarioPresentation(
  state: GameState,
  content: ContentDB,
  sc: Scenario,
  rng: Rng,
): NodePresentation {
  const run = state.active_scenario
  const solved = run?.solved ?? []
  const spent = run?.nodes_spent ?? 0
  const revealed = run?.revealed_rules ?? []

  const ctx = { state, solvedInScenario: solved, scenarioNodesSpent: spent }

  const breakthroughs = sc.breakthroughs
    .filter((b) => !b.hidden || solved.length > 0)
    .map((b) => ({
      id: b.id,
      name: b.name,
      cost: b.cost,
      hidden: Boolean(b.hidden),
      satisfied: b.conditions.every((c) => evaluate(c, ctx)),
    }))

  const hiddenRules = sc.rules_hidden.map((r) => ({
    id: r.id,
    hint: r.hint,
    revealed: revealed.includes(r.id) || evaluate(r.reveal, ctx),
  }))

  return {
    node_index: state.node_index,
    kind: 'scenario',
    event_id: sc.id,
    title: sc.name,
    lines: [],
    mood: 'tense',
    scenario: {
      name: sc.name,
      rules_stated: sc.rules_stated,
      rules_hidden: hiddenRules,
      forbidden: sc.forbidden,
      breakthroughs,
      nodes_spent: spent,
      span: sc.span,
    },
    transition: composeTransition(state, content, rng),
    options: [],
    trials: buildTrials(state, content),
    actions: SCENARIO_ACTIONS,
  }
}

/**
 * 「以物 / 以法试之」入口 —— 离散选择，永不是自由文本。
 * 玩家只能从**自己持有的**物品与**已习得的**规则里选。
 * 限制 = 你只能用手里的东西；自由 = 用哪个、什么时候用，完全由你。
 */
export function buildTrials(state: GameState, content: ContentDB): TrialOption[] {
  const out: TrialOption[] = []
  for (const it of state.items) {
    out.push({ kind: 'item', ref: it.id, name: it.name, affordance: it.affordance ?? [] })
  }
  for (const r of state.learned_rules) {
    out.push({ kind: 'rule', ref: r.ref, name: r.name, affordance: [r.ref] })
  }
  void content
  return out
}

// ============================================================
// 提交动作
// ============================================================

export interface EngineResult {
  ok: boolean
  reason?: string
  delta: DeltaEntry[]
  band?: Band
  /** 本次判定的结果叙事（L2）。取不到则回落事件级文本，再取不到则空。 */
  narrative?: { title: string; lines: string[] }
  presentation: NodePresentation
  state: GameState
}

/**
 * 结果叙事的回落链：段位键 → 事件级键 → 空。
 *
 * 内容生产是分批做的，段位级键（`loose.<motif>.<stage>.<band>`）与
 * 事件级键（`loose.<motif>.<stage>`）未必同时存在。没有这条回落链，
 * 写了段位键的那批事件取不到文本 —— 不影响结算，但会静默丢掉文案。
 */
function outcomeNarrative(
  ev: LooseEvent,
  opt: Option | undefined,
  band: Band | undefined,
  state: GameState,
  content: ContentDB,
  rng: Rng,
): { title: string; lines: string[] } | undefined {
  const title = ev.narrative?.title_pool?.length ? rng.pick(ev.narrative.title_pool) : ''

  // 1) 段位级键（最贴切）
  if (band && opt?.resolve) {
    const bandKey = pickBand(opt.resolve.bands, band)?.narrative
    if (bandKey) {
      const lines = splitLines(pickFromPool(bandKey, content.l2, state, rng).text)
      if (lines.length > 0) return { title, lines }
    }
  }
  // 2) 事件级键
  const bodyKey = ev.narrative?.body_key
  if (bodyKey) {
    const lines = splitLines(pickFromPool(bodyKey, content.l2, state, rng).text)
    if (lines.length > 0) return { title, lines }
  }
  return undefined
}

export function submitOption(
  state: GameState,
  optionId: string,
  content: ContentDB,
  currentEvent: LooseEvent,
): EngineResult {
  const opt = currentEvent.options.find((o) => o.id === optionId)
  if (!opt) return fail(state, content, `无此选项：${optionId}`)

  const rng = new Rng(makeSeed(state.seed, state.node_index, `opt:${optionId}`))

  let band: Band | undefined
  let effects: Effect[] = []
  let flagsSet: string[] = []
  let followups: string[] = []

  if (opt.resolve) {
    const outcome = rollBand(opt.resolve, state, rng, opponentPackOf(state))
    band = outcome.band
    const ob = pickBand(opt.resolve.bands, outcome.band)
    effects = ob?.effects ?? []
    flagsSet = ob?.flags_set ?? []
    followups = ob?.queue_followup ? [ob.queue_followup] : []
  } else if (opt.outcome) {
    effects = opt.outcome.effects
    flagsSet = opt.outcome.flags_set ?? []
    followups = opt.outcome.queue_followup ? [opt.outcome.queue_followup] : []
  }

  // 位面之子遭遇：致命结果不直接结算，先过「天意庇佑」。
  // 内容用 ref:'@current' 指向"在场的那个"，所以这里也要认这个约定 ——
  // 只按具体 id 匹配的话，遭遇永远解不开，谁也不会死。
  const dcRef = state.destiny_children.find(
    (d) =>
      d.alive &&
      effects.some((e) => e.type === 'destiny_drain' && (e.ref === '@current' || e.ref === d.id)),
  )

  const allEffects: Effect[] = [...effects]
  for (const f of flagsSet) allEffects.push({ type: 'set_flag', key: f })
  for (const fu of followups) allEffects.push({ type: 'queue_followup', ref: fu })

  let next = applyEffectsState(state, allEffects, `${currentEvent.id}:${optionId}`)

  // 记录去重信息
  next = {
    ...next,
    history: [
      ...next.history,
      {
        node_index: state.node_index,
        event_id: currentEvent.id,
        option_id: optionId,
        intent: opt.intent,
        band,
        delta: Object.fromEntries(
          applyEffects(allEffects, state, 'x').delta.map((d) => [d.key, d.to - d.from]),
        ) as Partial<Record<VarKey | AttrKey, number>>,
        rule_version: state.rule_version,
      },
    ],
    recent_motifs: [...state.recent_motifs, currentEvent.motif].slice(-12),
    recent_tags: [...state.recent_tags, ...currentEvent.tags].slice(-16),
    fired_events: [...state.fired_events, currentEvent.id],
  }

  if (dcRef) {
    next = resolveDestinyEncounter(next, dcRef)
  }

  next = advanceNode(next, content)

  return {
    ok: true,
    delta: applyEffects(allEffects, state, `${currentEvent.id}:${optionId}`).delta,
    band,
    narrative: outcomeNarrative(currentEvent, opt, band, state, content, rng),
    presentation: presentCurrent(next, content),
    state: next,
  }
}

/**
 * 剧本内的一次「试」。
 * 匹配不到任何破局条件组时，**不是"操作无效"**——消耗一刻并给出叙事。
 */
export function submitTrial(
  state: GameState,
  kind: 'item' | 'rule',
  ref: string,
  content: ContentDB,
): EngineResult {
  const sc = content.scenarios.find((s) => s.id === state.active_scenario?.scenario_id)
  if (!sc || !state.active_scenario) return fail(state, content, '当前不在剧本中')

  const run = state.active_scenario
  const ctx = { state, solvedInScenario: run.solved, scenarioNodesSpent: run.nodes_spent }

  // 这件物事满足了哪几组条件？
  const satisfied = sc.breakthroughs.filter(
    (b) => !run.solved.includes(b.id) && b.conditions.every((c) => evaluate(c, ctx)),
  )

  // 注意：这里**不**自增 nodes_spent。
  // 记时由 advanceNode 统一负责，否则一次尝试会被算作两刻。
  let next: GameState = {
    ...state,
    active_scenario: {
      ...run,
      attempted: [...run.attempted, ref],
    },
  }

  if (satisfied.length > 0) {
    // 破局成功。**关键：记录但不立即退出剧本。**
    //
    // 若一命中就退出，run.solved 永远只有一个元素，
    // 那么所有以 solved_any_of 为条件的隐藏通路都成了死内容。
    // 这里让 solved 累积：玩家可以继续留在此处探索其他通路，
    // 直到主动离开、路尽、或被时间逼出去。
    for (const hit of satisfied) {
      next = applyEffectsState(next, hit.outcome.effects ?? [], `scenario:${sc.id}:${hit.id}`)
    }
    next = {
      ...next,
      active_scenario: {
        ...next.active_scenario!,
        solved: [...next.active_scenario!.solved, ...satisfied.map((s) => s.id)],
      },
    }

    // 全部通路皆通 —— 此地已无可探，收束
    if (next.active_scenario!.solved.length >= sc.breakthroughs.length) {
      next = finishScenario(next, sc)
      next = advanceNode(next, content)
      return { ok: true, delta: [], presentation: presentCurrent(next, content), state: next }
    }

    next = advanceNode(next, content)
    next = checkScenarioTimeout(next, sc)
    return { ok: true, delta: [], presentation: presentCurrent(next, content), state: next }
  }

  // 未命中：推进一刻，消耗已试物事（时间在走）
  const consumed = kind === 'item' ? consumeOne(next, ref) : next
  next = advanceNode(consumed, content)
  next = checkScenarioTimeout(next, sc)
  return {
    ok: true,
    delta: [],
    presentation: presentCurrent(next, content),
    state: next,
  }
}

function consumeOne(state: GameState, itemId: string): GameState {
  const idx = state.items.findIndex((i) => i.id === itemId)
  if (idx < 0) return state
  const items = [...state.items]
  items.splice(idx, 1)
  return { ...state, items }
}

function checkScenarioTimeout(state: GameState, sc: Scenario): GameState {
  const run = state.active_scenario
  if (!run || run.scenario_id !== sc.id) return state
  if (run.nodes_spent < sc.span) return state
  return finishScenario(state, sc)
}

/**
 * 收束剧本 —— 按**已通的通路**决定结局线索。
 *
 * 优先级：隐藏通路（最难达成）> 最后解出的那条 > 未破局。
 * 未破局不是失败，是独立结局；它是否直接终结此世，交给剧本自己的
 * `unsolved.effects` 里的 `trigger_end` 决定，而不是引擎一刀切。
 */
export function finishScenario(state: GameState, sc: Scenario): GameState {
  const run = state.active_scenario
  const solved = run?.scenario_id === sc.id ? run.solved : []

  let ref = sc.unsolved.ref
  if (solved.length > 0) {
    const hiddenHit = sc.breakthroughs.find((b) => b.hidden && solved.includes(b.id))
    const anyHit = [...sc.breakthroughs].reverse().find((b) => solved.includes(b.id))
    const chosen = hiddenHit ?? anyHit
    if (chosen) ref = chosen.outcome.ref
  }

  // 未破局不再直接终结一世。
  //
  // 剧本原本的语义是"破不了局，此世就到头了"，但玩家反馈剧本不过是
  // "随机触发的剧本类事件"——不该有这种一票否决的权力。
  // 现在未破局照常结算代价（受伤、欠债、掉声望），并把这条线索记进
  // ending_threads 影响最终结局，但**不再强制结束这一世**。
  // 真的想写死局的剧本，可以在 effects 里自己放 trigger_end。
  const rawEffects = solved.length === 0 ? (sc.unsolved.effects ?? []) : []
  const effects = rawEffects.filter((e) => e.type !== 'trigger_end')
  const next = applyEffectsState(state, effects, `scenario:${sc.id}:finish`)

  return {
    ...next,
    ending_threads: [...next.ending_threads, ref],
    completed_scenarios: [...next.completed_scenarios, sc.id],
    active_scenario: undefined,
  }
}

/**
 * 剧本内可用的通用手段。
 *
 * 这是「剧本只能用物品和静待」的解法：**不依赖背包**的主动操作。
 * 探查找规则、交涉走人情、硬闯拼肉身、静待等它自己露破绽、抽身保住已有。
 * 每一样都耗一刻 —— 时间是剧本里唯一真正稀缺的东西。
 */
export const SCENARIO_ACTIONS: ScenarioAction[] = [
  { id: 'probe', name: '细察', desc: '不碰任何东西，先看清这里的规矩', cost: '一刻', attr: 'insight' },
  { id: 'parley', name: '交涉', desc: '与这里的「人」说话——如果那算人的话', cost: '一刻', attr: 'charm' },
  { id: 'force', name: '硬闯', desc: '不猜了，直接动手', cost: '一刻，多半带伤', attr: 'root' },
  { id: 'attune', name: '感气', desc: '闭眼，让这一处的气息告诉自己些什么', cost: '一刻', attr: 'wits' },
  { id: 'wait', name: '静待', desc: '什么也不做。看它会先动还是你先老', cost: '一刻' },
  { id: 'leave', name: '抽身', desc: '带着已经到手的东西退出去', cost: '放弃剩下的路' },
]

/**
 * 执行一次剧本内的通用操作。
 * 与「以物试之」并列，但不需要背包里有东西。
 */
export function submitScenarioAction(
  state: GameState,
  actionId: ScenarioActionId,
  content: ContentDB,
): EngineResult {
  const run = state.active_scenario
  if (!run) return fail(state, content, '当前不在剧本中')
  const sc = content.scenarios.find((s) => s.id === run.scenario_id)
  if (!sc) return fail(state, content, '剧本不存在')

  if (actionId === 'leave') return leaveScenario(state, content)

  const rng = new Rng(makeSeed(state.seed, state.node_index, `act:${actionId}`))
  const act = SCENARIO_ACTIONS.find((a) => a.id === actionId)!
  const ctx = { state, solvedInScenario: run.solved, scenarioNodesSpent: run.nodes_spent }

  // 尚未揭示的隐规则 —— 玩家的操作就是冲着它们去的
  const unrevealed = sc.rules_hidden.filter((r) => !run.revealed_rules.includes(r.id))

  let next: GameState = state
  const noticed: string[] = []

  const p = act.attr ? 0.35 + (state.attrs[act.attr] ?? 0) * 0.005 : 0.3
  const success = rng.chance(Math.min(0.9, p))

  if (success && unrevealed.length > 0) {
    // 看破一条 —— 这是「细察 / 感气」的主要回报：信息
    const got = unrevealed[rng.int(0, unrevealed.length - 1)]!
    noticed.push(got.id)
  }

  // 硬闯会有代价，无论成败
  const effects: Effect[] = []
  if (actionId === 'force') {
    effects.push({ type: 'add_var', key: 'hp', delta: success ? 6 : 14 })
    if (!success) effects.push({ type: 'add_var', key: 'exposure', delta: 3 })
  }
  if (actionId === 'parley' && success) {
    effects.push({ type: 'add_var', key: 'favor', delta: 8 })
  }
  if (actionId === 'attune' && success) {
    effects.push({ type: 'add_var', key: 'power', delta: 12 })
  }
  if (actionId === 'wait') {
    effects.push({ type: 'add_var', key: 'hp', delta: -4 }) // 静待是唯一能喘口气的
  }
  if (actionId === 'probe' || actionId === 'attune') {
    effects.push({ type: 'add_var', key: 'exposure', delta: success ? 1 : 3 })
  }

  next = applyEffectsState(next, effects, `scenario-act:${actionId}`)
  next = {
    ...next,
    active_scenario: {
      ...run,
      revealed_rules: [...run.revealed_rules, ...noticed],
      attempted: [...run.attempted, `act:${actionId}`],
    },
  }

  // 看破了新规则 → 该规则可能立刻让某条条件组成立
  const solvedNow = sc.breakthroughs.filter(
    (b) =>
      !next.active_scenario!.solved.includes(b.id) &&
      b.conditions.every((c) =>
        evaluate(c, {
          state: next,
          solvedInScenario: next.active_scenario!.solved,
          scenarioNodesSpent: next.active_scenario!.nodes_spent,
        }),
      ),
  )
  if (solvedNow.length > 0) {
    for (const hit of solvedNow) {
      next = applyEffectsState(next, hit.outcome.effects ?? [], `scenario:${sc.id}:${hit.id}`)
    }
    next = {
      ...next,
      active_scenario: {
        ...next.active_scenario!,
        solved: [...next.active_scenario!.solved, ...solvedNow.map((s) => s.id)],
      },
    }
  }

  next = advanceNode(next, content)
  if (next.active_scenario && next.active_scenario.solved.length >= sc.breakthroughs.length) {
    next = finishScenario(next, sc)
  }
  next = checkScenarioTimeout(next, sc)

  void ctx
  return { ok: true, delta: [], presentation: presentCurrent(next, content), state: next }
}

/**
 * 剧本触发时的入场呈现 —— 单独抽出来，因为**两处**要用：
 * 一是刚从调度器抽到这个剧本的那一拍，二是玩家还没决定时每次重新呈现。
 * 抽成一个函数就不会两处写法漂移。
 */
function buildEntryPresentation(
  state: GameState,
  content: ContentDB,
  sc: Scenario,
  rng: Rng,
): NodePresentation {
  const intro = pickFromPool(`loose.${sc.id}.intro`, content.l2, state, rng)
  const lines = splitLines(intro.text)
  return {
    node_index: state.node_index,
    kind: 'scenario',
    event_id: sc.id,
    title: sc.name,
    lines,
    mood: 'tense',
    transition: composeTransition(state, content, rng),
    scenario_entry: {
      scenario_id: sc.id,
      name: sc.name,
      lines,
      rules_stated: sc.rules_stated,
      span: sc.span,
    },
    options: [
      {
        id: 'enter',
        text: '进去',
        intent: 'greedy',
        risk_tier: '险',
        odds_hint: '未卜',
        cost_hint: `约 ${sc.span} 刻`,
      },
      {
        id: 'bypass',
        text: '绕开。你记下了这个地方。',
        intent: 'flee',
        risk_tier: '稳',
        odds_hint: '十拿九稳',
        cost_hint: '错过此处',
      },
    ],
  }
}

/**
 * 自由输入的一次落地结果 —— 给 UI 交代"你这一手到底落到了哪里"。
 * 玩家需要知道系统是怎么理解他的，否则自由输入就成了抽奖。
 */
export interface FreeActionReport {
  outcome: 'mapped' | 'trial' | 'novel' | 'grounded' | 'refused'
  /** 落到既有选项/物证时，它的名字 */
  landing?: string
  band?: Band
  fuse?: boolean
  /** 系统怎么理解你写的这句话 */
  understood: string
  /** 旁白（模型写的或引擎兜底的） */
  narration?: string[]
}

/**
 * 执行一次自由输入。
 *
 * **模型不参与结算**：它只把句子翻译成意图，走哪条路、成不成、
 * 掉什么数值，全在这里由规则层决定。所以模型说错话最多是"理解偏了"，
 * 不会凭空变出收益。
 */
export function submitFreeAction(
  state: GameState,
  intent: IntentResult,
  content: ContentDB,
  pres: NodePresentation,
  narrationLines?: string[],
): EngineResult & { free: FreeActionReport } {
  const rng = new Rng(makeSeed(state.seed, state.node_index, `free:${intent.intent}`))
  const event = content.events.find((e) => e.id === pres.event_id)

  const outcome = resolveFreeAction(intent, { state, pres, event, rng })

  const understoodOf = (): string => {
    const t = intent.target ? `「${intent.target}」` : '眼前这场面'
    const a = intent.approach ? `，${intent.approach}` : ''
    return `你打算对${t}${a}。`
  }

  switch (outcome.kind) {
    case 'mapped': {
      const r = event
        ? submitOption(state, outcome.option.id, content, event)
        : fail(state, content, '当前无可执行的事件')
      return {
        ...r,
        free: {
          outcome: 'mapped',
          landing: outcome.option.text,
          band: r.band,
          understood: `照旧法行事：${outcome.option.text}`,
          narration: narrationLines,
        },
      }
    }

    case 'trial': {
      const r = submitTrial(state, 'item', outcome.ref, content)
      return {
        ...r,
        free: {
          outcome: 'trial',
          landing: outcome.ref,
          understood: understoodOf(),
          narration: narrationLines,
        },
      }
    }

    case 'grounded':
      // 提了身上没有的东西：不认，但不当失败 —— 只走时间，不作惩罚
      return {
        ...advanceWith(state, content),
        free: {
          outcome: 'grounded',
          understood: understoodOf(),
          narration: [outcome.reason],
        },
      }

    case 'refused':
      return {
        ...fail(state, content, outcome.reason),
        free: { outcome: 'refused', understood: understoodOf() },
      }

    case 'novel': {
      // 新路：按判定段位给一笔**克制的**得失。
      // 刻意比正常事件小 —— 自创招式该有回报，但不该比踏踏实实选路更赚，
      // 否则玩家会绕开所有既有选项只写小作文。
      const table: Record<Band, Effect[]> = {
        crit: [
          { type: 'add_var', key: 'power', delta: 18 },
          { type: 'add_attr', key: outcome.attr, delta: 2 },
        ],
        success: [{ type: 'add_var', key: 'power', delta: 10 }],
        fail: [{ type: 'add_var', key: 'hp', delta: 5 }],
        crit_fail: [
          { type: 'add_var', key: 'hp', delta: 12 },
          { type: 'add_var', key: 'exposure', delta: 3 },
        ],
      }
      const effects = [...table[outcome.band]]
      if (outcome.fuse && (outcome.band === 'crit' || outcome.band === 'success')) {
        // 跨体系融合成了 —— 多给一条线头，玩家能顺着它往下走
        effects.push({ type: 'add_var', key: 'rare_mat', delta: 1 })
      }

      let next = applyEffectsState(state, effects, `free:novel:${outcome.band}`)
      next = advanceNode(next, content)

      return {
        ok: true,
        delta: applyEffects(effects, state, 'free').delta,
        band: outcome.band,
        presentation: presentCurrent(next, content),
        state: next,
        free: {
          outcome: 'novel',
          band: outcome.band,
          fuse: outcome.fuse,
          understood: understoodOf(),
          narration: narrationLines ?? [outcome.reason],
        },
      }
    }
  }
}

/** 只走时间、不做判定的推进（用于"说得通但落空"的情形） */
function advanceWith(state: GameState, content: ContentDB): EngineResult {
  const next = advanceNode(state, content)
  return { ok: true, delta: [], presentation: presentCurrent(next, content), state: next }
}

// ============================================================
// 日常行动 —— 这段时间花在哪，玩家自己定
// ============================================================

/**
 * 每几个节点插入一次日常。
 *
 * 25 个节点里插 5~6 次：够玩家感到"我在安排自己的修行"，
 * 又不至于把一局 5–8 分钟的节奏拖散。事件仍是主体。
 */
export const DAILY_EVERY = 4

/** 该不该是日常节点 */
export function isDailyNode(state: GameState): boolean {
  if (state.active_scenario || state.pending_scenario) return false
  if (state.node_index === 0) return false // 开局第一拍先给事件
  return state.node_index % DAILY_EVERY === 0
}

/** 当前处境下可做的日常 —— available 为假时给明原因 */
export function dailyActions(state: GameState): DailyAction[] {
  const v = state.vars
  return [
    {
      id: 'cultivate',
      name: '闭关',
      desc: '把这段时间整个投进修行里，不见人，不出门。',
      gain_hint: '修为大进；若身上有伤或心魔，进项会打折',
      available: true,
    },
    {
      id: 'roam',
      name: '游历',
      desc: '出门走走。你会遇到什么，说不准。',
      gain_hint: '一段际遇 —— 机缘与凶险都在里头',
      available: true,
    },
    {
      id: 'gather',
      name: '采药',
      desc: '上山下涧，找些用得上的东西。',
      gain_hint: '或有灵草矿石入账',
      cost_hint: '费些脚力（伤势略增）',
      available: true,
    },
    {
      id: 'market',
      name: '坊市',
      desc: '去人多的地方换些物事。',
      gain_hint: '以灵石易物',
      cost_hint: '破费',
      available: v.currency >= 30,
      blocked_reason: v.currency < 30 ? '囊中羞涩，去了也只是看' : undefined,
    },
    {
      id: 'duel',
      name: '寻斗',
      desc: '找个人打一场。修行的人，总要跟人交手的。',
      gain_hint: '胜则得修为、材料、人情；可杀可放',
      cost_hint: '败则带伤、掉声望',
      available: state.power_index >= 5,
      blocked_reason: state.power_index < 5 ? '你还没有跟人动手的资格' : undefined,
    },
    {
      id: 'befriend',
      name: '交游',
      desc: '拜访旧识，或结识新交。',
      gain_hint: '人情与声望；日久或成助力',
      available: true,
    },
  ]
}

/**
 * 执行一次日常行动。
 *
 * 「游历」是唯一的例外：不结算日常收益，而是**去抽一个事件** ——
 * 它是"我不想安排，让天意安排"的那条路。
 */
export function submitDaily(
  state: GameState,
  actionId: DailyActionId,
  content: ContentDB,
): EngineResult {
  const rng = new Rng(makeSeed(state.seed, state.node_index, `daily:${actionId}`))

  // 游历：主要收益是"遇到什么"，但行万里路本身也是修行 ——
  // 给一笔小进项，免得"出门"变成纯粹的零收益选项。
  if (actionId === 'roam') {
    const next = advanceNode({ ...state, last_daily: 'roam' } as GameState, content)
    return { ok: true, delta: [], presentation: presentCurrent(next, content), state: next }
  }

  const effects: Effect[] = []

  switch (actionId) {
    case 'cultivate': {
      // 闭关一次约等于三个节点的日常修行 —— 代价是这段时间只干了这一件事。
      //
      // 但它同时是**养伤**：闭关就是哪也不去、不见人、不动手。
      // 先前这里写反了 —— 带伤闭关反而 `hp +8`（伤上加伤），
      // 于是受伤的玩家越闭越重，直接陷进"伤—闭关—更伤"的死循环。
      // 实测把 aggressive 原型压到 steady 的四成。那不是难度，是陷阱。
      // **一味道闭关会闭门造车。**
      //
      // 没有这条之前，闭关是严格最优解：给修为、能养伤、不要钱、没风险，
      // 于是"每次都闭关"成了支配性策略 —— 实测稳健原型战力是激进原型的
      // 两倍半，支配性检测报警。一个选择如果永远是对的，它就不是选择。
      //
      // 递减之后，闭关是"最稳的那条路"而不是"唯一的路"：
      // 连着闭三次，收益就只剩三成，逼你去游历、去坊市、去结交。
      const streak = state.daily_streak ?? 0
      const dim = 1 / (1 + streak * 0.6)
      const gain = cultivateGain(state) * 3
      effects.push({ type: 'add_var', key: 'power', delta: Math.round(Math.max(0, gain) * 1.4 * dim) })
      if (streak >= 2) {
        // 闭久了心不静
        effects.push({ type: 'add_var', key: 'corruption', delta: 2 })
      }

      const hp = state.vars.hp
      if (hp >= 75) {
        // 垂危之人强行闭关是拿命换修为：要么搏回来，要么走火入魔
        const survived = rng.chance(0.55)
        effects.push({ type: 'add_var', key: 'hp', delta: survived ? -25 : 12 })
        if (!survived) effects.push({ type: 'add_var', key: 'corruption', delta: 6 })
      } else {
        // 寻常带伤：静养，伤会收口
        effects.push({ type: 'add_var', key: 'hp', delta: -Math.round(6 + hp * 0.25) })
      }
      break
    }
    case 'gather': {
      const luck = rng.chance(0.4 + (state.attrs.luck ?? 50) * 0.004)
      effects.push({ type: 'add_var', key: 'rare_mat', delta: luck ? rng.int(2, 4) : rng.int(0, 1) })
      effects.push({ type: 'add_var', key: 'hp', delta: rng.int(2, 5) }) // 爬山涉水的磕碰
      break
    }
    case 'market': {
      const spend = Math.min(state.vars.currency, 40)
      effects.push({ type: 'add_var', key: 'currency', delta: -spend })
      effects.push({ type: 'add_var', key: 'rare_mat', delta: Math.max(1, Math.round(spend / 15)) })
      break
    }
    case 'befriend': {
      effects.push({ type: 'add_var', key: 'favor', delta: rng.int(4, 10) })
      effects.push({ type: 'add_var', key: 'exposure', delta: 1 }) // 露面多了也容易被认出来
      break
    }
    default:
      break
  }

  let next = applyEffectsState(state, effects, `daily:${actionId}`)
  const streak = actionId === 'cultivate' ? (state.daily_streak ?? 0) + 1 : 0
  next = advanceNode({ ...next, last_daily: actionId, daily_streak: streak } as GameState, content)

  return {
    ok: true,
    delta: applyEffects(effects, state, `daily:${actionId}`).delta,
    presentation: presentCurrent(next, content),
    state: next,
  }
}

/**
 * 这一拍会不会有人拦路。
 *
 * 斗法**不是日常**（玩家指出：日程表上不该有"打架"这一项）。
 * 它是**奇遇** —— 你走着走着，事情找上来。所以触发条件全部来自
 * 你此前做过的事，而不是你想不想打：
 *
 *   因果缠身   → 仇家寻上门（你欠的账，有人来收）
 *   暴露过高   → 有人认出了你是谁
 *   位面之子在 → 命线交汇（他挡在你的路上）
 *   血债在册   → 当年那笔账该算了
 *
 * 概率随程度升高 —— 债欠得越多，被找上门就越勤。
 */
export function duelTrigger(state: GameState, rng: Rng): string | undefined {
  if (state.pending_duel || state.pending_duel_result) return undefined
  if (state.active_scenario) return undefined
  if (state.power_index < 5) return undefined // 还没到能跟人动手的地步
  if (state.last_duel_node !== undefined && state.node_index - state.last_duel_node < 4) {
    return undefined // 刚打完没多久，缓一缓
  }

  const debt = state.vars.debt ?? 0
  const exposure = state.vars.exposure ?? 0
  const alive = (state.destiny_children ?? []).filter((d) => d.alive)
  const blood = Object.keys(state.flags ?? {}).some((f) => f.startsWith('slew_'))

  // 债越多越躲不掉
  if (debt >= 10 && rng.chance(Math.min(0.5, 0.08 + debt * 0.012))) {
    return '你欠下的那笔账，有人来收了。'
  }
  if (exposure >= 20 && rng.chance(Math.min(0.4, 0.06 + exposure * 0.006))) {
    return '有人盯了你很久，这一回不打算再等。'
  }
  if (blood && rng.chance(0.1)) {
    return '你杀过的人，有同门。'
  }
  if (alive.length > 0 && rng.chance(0.09)) {
    return '命线交汇 —— 你们迟早要在一条路上撞见。'
  }
  return undefined
}

/**
 * 随机生成一个对手。
 *
 * 优先从**在场且活着**的位面之子中挑（打主角是这游戏最刺激的事），
 * 没有就按当前境界临时捏一个。对手的路数取自他的体系，
 * 所以你会遇到气克体、体克灵这类相性问题 —— 这正是相性环的用武之地。
 */
export function rollOpponent(state: GameState, rng: Rng, content: ContentDB): DuelOpponent {
  const alive = (state.destiny_children ?? []).filter((d) => d.alive)
  if (alive.length > 0 && rng.chance(0.55)) {
    const d = rng.pick(alive)
    const pack = content.packs[d.pack]
    return {
      id: d.id,
      name: d.name,
      essence: PACK_ESSENCE[d.pack],
      power_index: Math.round(d.power_index * 0.9 + state.power_index * 0.35),
      realm_name: pack?.realms[Math.min(d.fate_progress, (pack?.realms.length ?? 1) - 1)]?.name ?? '不明',
      is_destiny: true,
      fate_progress: d.fate_progress,
      note: d.oracle_note,
    }
  }

  // 临时捏一个同代散修
  const pool = PACK_IDS.filter((p) => p !== state.pack_id)
  const packId = rng.pick(pool)
  const pool2 = content.names
  const name =
    (pool2?.surname?.length ? rng.pick(pool2.surname) : '无') +
    (pool2?.given_male?.length ? rng.pick(pool2.given_male) : '名')
  return {
    id: `foe_${state.node_index}_${packId}`,
    name,
    essence: PACK_ESSENCE[packId],
    power_index: Math.max(3, Math.round(state.power_index * (0.75 + rng.next() * 0.7))),
    realm_name: content.packs[packId]?.realms[state.realm_idx]?.name ?? '不明',
  }
}

/**
 * 遭遇斗法时的抉择：打，还是避。
 *
 * 避战**不是免费的跳过**：折声望、记一笔因果（你转身走了，对方记着你）。
 * 但它是安全的 —— 不会死、不会伤。让它有代价，是为了让"怂"也是一次
 * 真正的取舍；让它不致命，是因为包里的调研结论很一致：
 * 这类游戏把惩罚落在声望与次数上，不落在角色存亡上。
 */
export function submitDuelEntry(
  state: GameState,
  fight: boolean,
  content: ContentDB,
): EngineResult {
  if (!state.pending_duel) return fail(state, content, '当前没有拦路的人')

  if (fight) {
    // 决定出手 —— 接下来该选路数与架势了，**不推进节点**
    const next: GameState = { ...state, duel_committed: true, duel_reason: state.duel_reason }
    return { ok: true, delta: [], presentation: presentCurrent(next, content), state: next }
  }

  // 避开：折声望 + 记一笔
  const opp = state.pending_duel.opponent
  const effects: Effect[] = [
    { type: 'add_var', key: 'favor', delta: -6 },
    { type: 'add_var', key: 'karma', delta: -2 },
    { type: 'set_flag', key: `avoided_${opp.id}` },
  ]
  let next = applyEffectsState(
    { ...state, pending_duel: undefined, duel_committed: false, duel_reason: undefined },
    effects,
    'duel:avoid',
  )
  next = advanceNode(next, content)

  return {
    ok: true,
    delta: applyEffects(effects, state, 'duel:avoid').delta,
    presentation: presentCurrent(next, content),
    state: next,
  }
}

/**
 * 斗法第一步之后：选定路数与架势，把三轮打完。
 * 结果存进 pending_duel_result，等玩家决定杀还是放。
 */
export function submitDuelStance(
  state: GameState,
  stanceId: StanceId,
  wayEssence: Essence,
  content: ContentDB,
): EngineResult {
  const setup = state.pending_duel
  if (!setup) return fail(state, content, '当前没有待决的斗法')

  const rng = new Rng(makeSeed(state.seed, state.node_index, `duel:${stanceId}:${wayEssence}`))
  const res = resolveDuel(state, setup, stanceId, wayEssence, rng)
  const killable = canKill(setup, res)

  const outcome: DuelOutcome = {
    opponent: setup.opponent,
    outcome: res.outcome,
    rounds: res.rounds.map((r) => ({
      index: r.index,
      affinity: r.affinity,
      winner: r.winner,
      line: r.line,
    })),
    summary: res.summary,
    momentum: res.momentum,
    win_spoils: setup.spoils.win,
    kill_spoils: setup.spoils.kill,
    kill_cost: setup.spoils.kill_cost,
    can_kill: killable,
  }

  // 落败的代价：带伤、掉声望。**但不死** —— 调研里这类游戏的通行做法，
  // 惩罚落在声望与次数上，不落在角色存亡上。
  let next: GameState = {
    ...state,
    pending_duel: undefined,
    duel_committed: false,
    duel_reason: undefined,
    pending_duel_result: outcome,
  }
  if (res.outcome === 'lose') {
    next = applyEffectsState(
      next,
      [
        { type: 'add_var', key: 'hp', delta: 14 },
        { type: 'add_var', key: 'favor', delta: -8 },
      ],
      'duel:lose',
    )
  } else if (res.outcome === 'win') {
    next = applyEffectsState(
      next,
      [{ type: 'add_var', key: 'favor', delta: setup.spoils.win.favor }],
      'duel:win:favor',
    )
  }

  return { ok: true, delta: [], presentation: presentCurrent(next, content), state: next }
}

/**
 * 斗法第三步：杀，还是放。
 *
 * 玩家要的"可以杀"落在这里 —— 它是**独立的一个选择**，有独立的奖惩，
 * 不是败者的默认下场。放了得人情与材料；杀了拿得更多，
 * 但背上因果与暴露，且此人若是有来头的，他的关系网会记住你。
 */
export function submitDuelAftermath(
  state: GameState,
  kill: boolean,
  content: ContentDB,
): EngineResult {
  const d = state.pending_duel_result
  if (!d) return fail(state, content, '当前没有待决的战后处置')

  const effects: Effect[] = []
  if (kill) {
    if (!d.can_kill) return fail(state, content, '你没有取人性命的余地')
    effects.push({ type: 'add_var', key: 'power', delta: d.kill_spoils.power })
    effects.push({ type: 'add_var', key: 'currency', delta: d.kill_spoils.currency })
    effects.push({ type: 'add_var', key: 'rare_mat', delta: d.kill_spoils.rare_mat })
    effects.push({ type: 'add_var', key: 'debt', delta: d.kill_cost.debt })
    effects.push({ type: 'add_var', key: 'exposure', delta: d.kill_cost.exposure })
    effects.push({ type: 'add_var', key: 'karma', delta: d.kill_cost.karma })
    effects.push({ type: 'set_flag', key: `slew_${d.opponent.id}` })
    // 杀了位面之子，他的金手指归你 —— 与截杀那条路同一套兑付
    if (d.opponent.is_destiny) {
      const at = d.opponent.fate_progress ?? 0
      effects.push({ type: 'add_var', key: 'power', delta: 60 + at * 40 })
      effects.push({ type: 'add_var', key: 'rare_mat', delta: 2 + at })
      effects.push({ type: 'unlock_title', ref: `弑主·${d.opponent.name}` })
    }
  } else {
    effects.push({ type: 'add_var', key: 'power', delta: d.win_spoils.power })
    effects.push({ type: 'add_var', key: 'currency', delta: d.win_spoils.currency })
    effects.push({ type: 'add_var', key: 'rare_mat', delta: d.win_spoils.rare_mat })
    effects.push({ type: 'add_var', key: 'karma', delta: 4 })
  }

  let next = applyEffectsState(state, effects, `duel:${kill ? 'kill' : 'spare'}`)
  next = { ...next, pending_duel_result: undefined }
  next = advanceNode(next, content)

  return {
    ok: true,
    delta: applyEffects(effects, state, `duel:${kill ? 'kill' : 'spare'}`).delta,
    presentation: presentCurrent(next, content),
    state: next,
  }
}

/**
 * 入场抉择：进去，或者绕开。
 *
 * 绕开不是无代价的「跳过」——它记一笔因果（你看见了一个地方却没敢进），
 * 并且那个剧本本局不再出现。**错过也是选择的一部分。**
 */
export function submitScenarioEntry(
  state: GameState,
  enter: boolean,
  content: ContentDB,
): EngineResult {
  const sc = content.scenarios.find((s) => s.id === state.pending_scenario)
  if (!sc) return fail(state, content, '当前没有待定的剧本')

  if (enter) {
    let next: GameState = {
      ...state,
      pending_scenario: undefined,
      active_scenario: {
        scenario_id: sc.id,
        started_at: state.node_index,
        nodes_spent: 0,
        revealed_rules: [],
        solved: [],
        attempted: [],
      },
    }
    next = advanceNode(next, content)
    next = checkScenarioTimeout(next, sc)
    return { ok: true, delta: [], presentation: presentCurrent(next, content), state: next }
  }

  // 绕开：本局不再出现，留一笔"没敢进"的因果
  let next: GameState = {
    ...state,
    pending_scenario: undefined,
    completed_scenarios: [...state.completed_scenarios, sc.id],
    vars: { ...state.vars, karma: clampVar('karma', state.vars.karma - 2) },
  }
  next = advanceNode(next, content)
  return { ok: true, delta: [], presentation: presentCurrent(next, content), state: next }
}

/** 玩家主动离开剧本 —— 带着已通的通路收束 */
export function leaveScenario(state: GameState, content: ContentDB): EngineResult {
  const run = state.active_scenario
  if (!run) return fail(state, content, '当前不在剧本中')
  const sc = content.scenarios.find((s) => s.id === run.scenario_id)
  if (!sc) return fail(state, content, '剧本不存在')

  let next = finishScenario(state, sc)
  next = advanceNode(next, content)
  return { ok: true, delta: [], presentation: presentCurrent(next, content), state: next }
}

function pickBand(
  bands: Partial<Record<Band, OutcomeBand>> | undefined,
  band: Band,
): OutcomeBand | undefined {
  if (!bands) return undefined
  // 写了的段位直接用；没写的按"离它最近"的语义回落
  if (bands[band]) return bands[band]
  const order: Band[] = ['success', 'fail', 'crit', 'crit_fail']
  for (const b of order) {
    if (bands[b]) return bands[b]
  }
  return undefined
}

function opponentPackOf(state: GameState): PackId | undefined {
  // 遭遇中的位面之子所在体系
  return state.destiny_children.find((d) => d.alive)?.pack
}

function fail(state: GameState, content: ContentDB, reason: string): EngineResult {
  return {
    ok: false,
    reason,
    delta: [],
    presentation: presentCurrent(state, content),
    state,
  }
}

// ============================================================
// 位面之子遭遇结算
// ============================================================

function resolveDestinyEncounter(state: GameState, child: DestinyChild): GameState {
  const rng = new Rng(deriveSeed(state.seed, `encounter-${child.id}-${state.node_index}`))
  const protection = checkDestinyProtection(child, rng)

  if (protection.protected) {
    // 天意庇佑：巧合救走他。气运已扣。
    return {
      ...state,
      destiny_children: state.destiny_children.map((d) => (d.id === child.id ? child : d)),
      flags: { ...state.flags, [`destiny_protected_${child.id}`]: true },
      recent_narrative: [...state.recent_narrative, protection.coincidenceKey],
    }
  }

  // 气运耗尽：他真的会死。玩家继承他的金手指与因果。
  const reward = killDestinyChild(child)

  // **两半都要给。**
  //
  // 设计上写的是"你继承他的金手指与他的因果"，但先前只兑了因果那一半：
  // 杀完拿到一个称号 + 一笔债（他的仇家从此来找你），金手指那一半没兑现。
  // 于是敢动手的玩家把代价全付了，收益一分没拿 —— 实测走激进路线的原型
  // 战力只有稳健路线的四成，支配性检测直接报警。
  //
  // 他走到哪一步，金手指就养到哪一步：这是"截杀主角"该有的分量。
  const wasAt = child.fate_progress
  const spoils: Effect[] = [
    { type: 'unlock_title', ref: reward.title },
    { type: 'add_var', key: 'debt', delta: reward.inherited_debt },
    // 他的金手指
    { type: 'add_var', key: 'power', delta: 60 + wasAt * 40 },
    // 他身上带着的东西
    { type: 'add_var', key: 'rare_mat', delta: 2 + wasAt },
    { type: 'add_var', key: 'currency', delta: 80 + wasAt * 30 },
    { type: 'add_var', key: 'exposure', delta: 4 }, // 杀主角是藏不住的
  ]

  const next = applyEffectsState(state, spoils, `kill:${child.id}`)
  return {
    ...next,
    destiny_children: next.destiny_children.map((d) => (d.id === child.id ? child : d)),
    flags: { ...next.flags, [`destiny_slain_${child.id}`]: true },
  }
}

// ============================================================
// 节点推进
// ============================================================

export function advanceNode(state: GameState, content: ContentDB): GameState {
  let next: GameState = { ...state, node_index: state.node_index + 1 }
  next.stage = stageForNode(next.node_index, next.total_nodes)

  // 位面之子也在推进自己的命运线 —— 玩家每走一步，他们也走一步
  next = {
    ...next,
    destiny_children: next.destiny_children.map((d) => {
      if (!d.alive) return d
      const copy: DestinyChild = { ...d, fate_line: [...d.fate_line] }
      advanceFate(copy, next.node_index)
      return copy
    }),
  }

  // 因果自然衰减（SPEC 7.3 debt_decay：每 5 节点 −1）
  if (next.node_index % 5 === 0 && next.vars.debt > 0) {
    next = {
      ...next,
      vars: { ...next.vars, debt: clampVar('debt', next.vars.debt - 1) },
    }
  }

  // 若正在剧本中，累计消耗
  if (next.active_scenario) {
    next = {
      ...next,
      active_scenario: {
        ...next.active_scenario,
        nodes_spent: next.active_scenario.nodes_spent + 1,
      },
    }
  }

  // 日常修炼：事件之间，时间也在走
  const gain = cultivateGain(next)
  const heal = healPerNode(next)
  // 年岁随之增长 —— 高境界一年走得更快，所以大数字的寿元上限才有意义
  const years = yearsPerNode(next)
  next = {
    ...next,
    age: (next.age ?? START_AGE) + years,
    last_years: years,
    last_realm_idx: next.realm_idx,
    last_motif: next.recent_motifs[next.recent_motifs.length - 1],
    vars: {
      ...next.vars,
      // 上界与 clampVar('power') 保持一致：累积修为要留出换算余量，
      // 这里若再封 1000，power_index 就永远到不了 1000。
      power: Math.min(4200, next.vars.power + gain),
      hp: Math.max(0, next.vars.hp - heal),
    },
  }

  // 由累积修为反推境界 —— 每推进一步结算一次
  next = recomputeProgress(next, content)

  return checkEnd(next, content)
}

/** 终局判定：寿元耗尽 / 伤势归零 / 节点走完 */
export function checkEnd(state: GameState, content: ContentDB): GameState {
  if (state.status === 'ended') return state
  if (state.pending_ending) {
    return { ...state, status: 'ended', end_reason: 'ending', pending_ending: state.pending_ending }
  }
  // hp 是伤势：满值才是死，不是归零
  if (state.vars.hp >= 100) {
    return { ...state, status: 'ended', end_reason: 'hp' }
  }
  // 寿尽：年龄追上了这一境界能活到的岁数。
  // 停在低境界而年月照走，就是这条判定的意义 —— 不进取会老死。
  if ((state.age ?? START_AGE) >= lifespanCapOf(state, content)) {
    return { ...state, status: 'ended', end_reason: 'lifespan' }
  }
  if (state.node_index >= state.total_nodes) {
    return { ...state, status: 'ended', end_reason: 'nodes' }
  }
  return state
}

/** 推进到下一个节点并给出呈现 */
export function presentCurrent(state: GameState, content: ContentDB): NodePresentation {
  if (state.status === 'ended') {
    return {
      node_index: state.node_index,
      kind: 'ending',
      event_id: state.pending_ending ?? 'end_unknown',
      title: '终',
      lines: [],
      mood: 'somber',
      options: [],
    }
  }

  // 剧本已触发但玩家尚未决定进不进 —— 先给出它的全貌与两条路
  if (state.pending_scenario) {
    const sc = content.scenarios.find((s) => s.id === state.pending_scenario)
    if (sc) {
      const rng = new Rng(makeSeed(state.seed, state.node_index, `entry:${sc.id}`))
      return buildEntryPresentation(state, content, sc, rng)
    }
  }

  // 斗法·遭遇：先问"打不打"。
  //
  // 斗法是**奇遇**不是日常 —— 它自己找上来，你只有接或不接。
  // 所以这里给的是两条路而不是"选架势"：架势是接战之后的事。
  if (state.pending_duel && !state.duel_committed) {
    const d = state.pending_duel
    const ess = { qi: '气', body: '体', spirit: '灵', law: '则', will: '意', shi: '势' }
    return {
      node_index: state.node_index,
      kind: 'loose',
      event_id: '__duel_encounter__',
      title: '拦路',
      lines: [
        state.duel_reason ?? '路上有人拦着。',
        `${d.opponent.name} —— ${d.opponent.realm_name}，走的是「${ess[d.opponent.essence]}」一路。`,
        d.opponent.note ?? '',
      ].filter(Boolean),
      mood: 'tense',
      duel: d,
      options: [
        {
          id: 'duel_fight',
          text: '出手',
          intent: 'greedy',
          risk_tier: d.matchup.odds >= 0.7 ? '常' : d.matchup.odds >= 0.45 ? '险' : '狠',
          odds_hint: d.matchup.odds_hint,
          cost_hint: '败则带伤、折声望',
          gain_hint: '胜则得修为材料；可杀可放',
        },
        {
          id: 'duel_avoid',
          text: '避开这一场',
          intent: 'flee',
          risk_tier: '稳',
          odds_hint: '十拿九稳',
          cost_hint: '折些颜面，心里记着',
          gain_hint: '保住气力',
        },
      ],
    }
  }

  // 斗法·已决定出手：选路数与架势
  if (state.pending_duel && state.duel_committed) {
    const d = state.pending_duel
    return {
      node_index: state.node_index,
      kind: 'loose',
      event_id: '__duel__',
      title: '斗法',
      lines: [`${d.opponent.name}已经动了。`],
      mood: 'tense',
      options: [],
      duel: d,
    }
  }

  // 斗法·战后：赢了才谈得上处置
  if (state.pending_duel_result) {
    const r = state.pending_duel_result
    return {
      node_index: state.node_index,
      kind: 'loose',
      event_id: '__duel_after__',
      title: '胜负已分',
      lines: r.rounds.map((x) => x.line).concat(r.summary),
      mood: r.outcome === 'win' ? 'heroic' : 'somber',
      options: [],
      duel_result: r,
    }
  }

  // 日常节点：这段时间怎么过，玩家自己定
  if (isDailyNode(state)) {
    return {
      node_index: state.node_index,
      kind: 'loose',
      event_id: '__daily__',
      title: '日常',
      lines: ['又过了一段日子。接下来的时间，你打算怎么用？'],
      mood: 'somber',
      options: [],
      daily: dailyActions(state),
    }
  }

  // 剧本进行中：继续呈现剧本
  if (state.active_scenario) {
    const sc = content.scenarios.find((s) => s.id === state.active_scenario!.scenario_id)
    if (sc) {
      const rng = new Rng(makeSeed(state.seed, state.node_index, `scn:${sc.id}`))
      return buildScenarioPresentation(state, content, sc, rng)
    }
  }

  const rng = new Rng(makeSeed(state.seed, state.node_index, 'present'))

  // 有人拦路？（奇遇触发，不是日程安排）
  const reason = duelTrigger(state, rng)
  if (reason) {
    const opp = rollOpponent(state, rng, content)
    state.pending_duel = setupDuel(state, opp, rng)
    state.duel_reason = reason
    state.last_duel_node = state.node_index
    state.duel_committed = false
    const d = state.pending_duel
    const ess = { qi: '气', body: '体', spirit: '灵', law: '则', will: '意', shi: '势' }
    return {
      node_index: state.node_index,
      kind: 'loose',
      event_id: '__duel_encounter__',
      title: '拦路',
      lines: [
        reason,
        `${d.opponent.name} —— ${d.opponent.realm_name}，走的是「${ess[d.opponent.essence]}」一路。`,
        d.opponent.note ?? '',
      ].filter(Boolean),
      mood: 'tense',
      duel: d,
      options: [
        {
          id: 'duel_fight',
          text: '出手',
          intent: 'greedy',
          risk_tier: d.matchup.odds >= 0.7 ? '常' : d.matchup.odds >= 0.45 ? '险' : '狠',
          odds_hint: d.matchup.odds_hint,
          cost_hint: '败则带伤、折声望',
          gain_hint: '胜则得修为材料；可杀可放',
        },
        {
          id: 'duel_avoid',
          text: '避开这一场',
          intent: 'flee',
          risk_tier: '稳',
          odds_hint: '十拿九稳',
          cost_hint: '折些颜面，心里记着',
          gain_hint: '保住气力',
        },
      ],
    }
  }

  const ev = pickNextEvent({ state, content, rng })
  if (!ev) {
    return {
      node_index: state.node_index,
      kind: 'loose',
      event_id: 'fallback',
      title: '静',
      lines: ['四下无声。你调息片刻，继续前行。'],
      mood: 'somber',
      transition: composeTransition(state, content, rng),
      options: [
        { id: 'a', text: '继续赶路', intent: 'steady', risk_tier: '稳', odds_hint: '十拿九稳' },
      ],
    }
  }

  // 剧本触发：先给**入场抉择**，不把玩家直接拽进去。
  //
  // 玩家反馈「剧本没有可入选项……我的认知里剧本只是一个随机触发的剧本类事件」——
  // 触发即入、入则卡死，等于剥夺了选择权。现在它先摆在你面前，
  // 你可以进，也可以绕过去（代价是错过，不是死）。
  //
  // 注意：这里必须**直接返回入场呈现**，不能只记下 pending 然后往下走到
  // buildPresentation —— 那样触发的那一拍会渲染成剧本正文（还带着
  // trials/actions），而入场选项要等到下一拍才出现。玩家会在没做选择时
  // 就先看见"手段"，点了还会被告知"当前不在剧本中"。
  if (ev.kind === 'scenario' && !state.active_scenario) {
    const sc = ev as Scenario
    state.pending_scenario = sc.id
    return buildEntryPresentation(state, content, sc, rng)
  }

  return buildPresentation(state, content, ev, rng)
}

// ============================================================
// 结局结算
// ============================================================

export interface EndingResult {
  ending: Ending | null
  title: string
  lines: string[]
  stars: number
  verdict: string
  meta: { legacy_points: number; unlock: string[] }
}

/**
 * 结局贴合度 —— 玩家的终局状态离这个结局有多近，返回 0–1。
 *
 * 为什么不用"严格过滤 + 兜底"：结局条件是分散写死的，
 * 玩家的终局状态几乎必然卡在某个缝里。严格过滤会让一大片中段境界的
 * 玩家匹配不到任何结局，然后统统落到同一个兜底上——先是全员飞升，
 * 改成按门槛排序后又全员道陨。**按贴合度排序**才是稳的：每个玩家都拿到
 * 离自己这一世最近的那个结局，而且分布天然分散。
 *
 * 数值型条件用"距离"而非"是否满足"，所以 `realm >= 9` 对一个 8 境的
 * 玩家是 0.9 而不是 0 —— 差一点就是差一点，不该掉进完全无关的结局。
 */
export function fitScore(cond: Condition | undefined, ctx: { state: GameState }): number {
  if (!cond) return 0.6 // 无条件 = 通用结局，给一个中性的贴合度

  // 差一点就是差很多 —— 用平方衰减而非线性。
  // 线性衰减下，"五境的人够九境的条件"还能拿到过半的分，
  // 于是大量中段玩家被判成飞升。门槛条件本质上是有/无，
  // 平方能让"没够着"迅速掉分。
  const falloff = (deficit: number) => Math.max(0, 1 - deficit) ** 2

  const numeric = (player: number, op: string, target: number): number => {
    const scale = Math.max(1, Math.abs(target))
    switch (op) {
      case '>=':
        return player >= target ? 1 : falloff((target - player) / scale)
      case '>':
        return player > target ? 1 : falloff((target - player) / scale)
      case '<=':
        return player <= target ? 1 : falloff((player - target) / scale)
      case '<':
        return player < target ? 1 : falloff((player - target) / scale)
      case '==':
        return falloff(Math.abs(player - target) / scale)
      case '!=':
        return player !== target ? 1 : 0
      default:
        return 0.5
    }
  }

  switch (cond.type) {
    case 'all': {
      if (cond.of.length === 0) return 0.6
      const fits = cond.of.map((c) => fitScore(c, ctx))
      const mean = fits.reduce((a, b) => a + b, 0) / fits.length
      const weakest = Math.min(...fits)
      // 合取式要"短板主导"：只要有一条没够着，整体就不该接近满分。
      // 纯取均值会出事——"飞升"的 `all[realm>=9, 无盟友, 无道侣]`
      // 对一个人脉寡淡的三境玩家，两条"无关系"轻松拿满，
      // 均值把没够着的境界条件冲淡成 0.7，于是满世界都是白日飞升。
      return weakest * 0.6 + mean * 0.4
    }
    case 'any':
      // 命中支路里最贴近的那条
      return cond.of.length ? Math.max(...cond.of.map((c) => fitScore(c, ctx))) : 0.5
    case 'not':
      return evaluate(cond, ctx) ? 1 : 0.1
    case 'attr':
      return numeric(ctx.state.attrs[cond.key as AttrKey] ?? 0, cond.op, cond.value)
    case 'var':
      return numeric(ctx.state.vars[cond.key as VarKey] ?? 0, cond.op, cond.value)
    case 'realm_idx': {
      // 境界是**硬门槛**，不是梯度。
      // 别的条件可以"差一点也算沾边"（功德少些、因果多些都还是那种人生），
      // 但没修到那个境界就是没修到——飞升不是一件"差不多做成"的事。
      // 用软评分的话，五境的人够九境的条件还能拿三成分，
      // 于是满世界都是白日飞升。
      if ((cond.op === '>=' || cond.op === '>') && !evaluate(cond, ctx)) return 0.02
      return numeric(ctx.state.realm_idx, cond.op, cond.value)
    }
    default:
      // 布尔型条件（flag / relation / learned_rule …）只有满足与否
      return evaluate(cond, ctx) ? 1 : 0
  }
}

/**
 * 部分满足度 —— 数一个条件树里有多少个原子条件成立。
 *
 * 用于"没有任何结局被严格满足"时挑最贴近的那个。
 * 结局库的条件是分散写死的，玩家的终局状态几乎必然卡在某个缝里；
 * 严格过滤会让一大片中段境界的玩家落到同一个兜底结局上。
 */
export function satisfactionScore(cond: Condition | undefined, ctx: { state: GameState }): number {
  if (!cond) return 0
  switch (cond.type) {
    case 'all':
      return cond.of.reduce((a, c) => a + satisfactionScore(c, ctx), 0)
    case 'any':
      return Math.max(0, ...cond.of.map((c) => satisfactionScore(c, ctx)))
    case 'not':
      return evaluate(cond, ctx) ? 1 : 0
    default:
      return evaluate(cond, ctx) ? 1 : 0
  }
}

export function resolveEnding(state: GameState, content: ContentDB): EndingResult {
  const ctx = { state }
  const eligible = content.endings.filter(
    (e) => e.pack.includes('*' as PackId) || e.pack.includes(state.pack_id),
  )
  const rng = new Rng(deriveSeed(state.seed, 'ending'))

  // 剧本破局 / trigger_end 直接指定的结局优先 —— 玩家自己挣来的结局
  // 不该被状态匹配覆盖掉。
  const threaded = state.pending_ending ?? state.ending_threads[state.ending_threads.length - 1]
  const forced = threaded ? content.endings.find((e) => e.id === threaded) : undefined

  // 否则在全库里按**贴合度**取最贴近的一批。
  const scored = eligible
    .map((e) => ({ e, fit: fitScore(e.requires, ctx) }))
    .sort((a, b) => b.fit - a.fit)

  const best = scored[0]?.fit ?? 0
  // 取与最优差距在 0.15 以内的一批，在其中带权重随机 —— 既有针对性又不呆板
  const near = scored.filter((s) => s.fit >= best - 0.15)

  const ending =
    forced ??
    (near.length > 0
      ? rng.weighted(near.map((s) => s.e), near.map((s) => (s.e.tier === 'S' ? 1 : 3)))
      : (scored[0]?.e ?? null))

  if (!ending) {
    return {
      ending: null,
      title: '道陨',
      lines: ['你走过的这一世，无人记得。'],
      stars: 1,
      verdict: '寂',
      meta: { legacy_points: 5, unlock: [] },
    }
  }

  const stars = computeStars(state, ending)
  const picked = pickFromPool(ending.body_key, content.l2, state, rng)

  return {
    ending,
    title: rng.pick(ending.title_pool),
    lines: splitLines(picked.text).length > 0 ? splitLines(picked.text) : ['一世终了。'],
    stars,
    verdict: stars >= 5 ? '玄' : stars >= 4 ? '妙' : stars >= 3 ? '可' : stars >= 2 ? '平' : '寂',
    meta: ending.meta_reward,
  }
}

function computeStars(state: GameState, ending: Ending): number {
  // 评星要能让"半途而废"和"登临绝顶"拉开距离。
  // 以 power_index（跨体系可比的唯一标尺）为主，功德与因果做修正。
  const power = state.power_index / 90 // 0–11
  const karma = state.vars.karma / 70 // −1.4–1.4
  const debt = state.vars.debt / 30 // 0–3.3
  const raw = 1 + power + karma - debt
  void ending
  return Math.max(1, Math.min(5, Math.round(raw)))
}

// ============================================================
// 天机榜（UI 数据源）
// ============================================================

export interface HeavenBoardRow {
  id: string
  name: string
  pack: PackId
  packName: string
  archetype: string
  archetypeName: string
  power_index: number
  destiny_pool: number
  destiny_max: number
  fate_progress: number
  fate_total: number
  fate_next: string
  relation: number
  alive: boolean
  resistances: string[]
  oracle_note: string
}

export function buildHeavenBoard(state: GameState, content: ContentDB): HeavenBoardRow[] {
  return state.destiny_children.map((d) => ({
    id: d.id,
    name: d.name,
    pack: d.pack,
    packName: content.packs[d.pack]?.display_name ?? d.pack,
    archetype: d.archetype,
    archetypeName: ARCHETYPE_NAMES[d.archetype],
    power_index: d.power_index,
    destiny_pool: d.destiny_pool,
    destiny_max: d.destiny_max,
    fate_progress: d.fate_progress,
    fate_total: d.fate_line.length,
    fate_next: d.fate_line[d.fate_progress]?.name ?? '命线已尽',
    relation: d.relation,
    alive: d.alive,
    resistances: d.resistances,
    oracle_note: d.oracle_note,
  }))
}

export type { AnyEvent, Condition, Option }
