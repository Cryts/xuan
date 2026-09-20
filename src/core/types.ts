/**
 * 《玄》核心契约 —— 全部并行工作的唯一接口来源。
 *
 * 铁律（改动本文件前先想清楚，它牵动所有 agent）：
 *   1. 本文件与整个 src/core 不得 import 任何浏览器 API、DOM、React。
 *      同一套代码要能在 Node 里跑 10 万局蒙特卡洛。
 *   2. 数值永不由文本层决定。文本只描述已结算的结果。
 *   3. 玩家输入永远是离散 ID（选项 / 物品 / 规则 / 条件组），永不是自由文本。
 */

// ============================================================
// 基础 ID 与枚举
// ============================================================

export type PackId = 'mortal' | 'genius' | 'physique' | 'mystery' | 'rebel' | 'cautious'

/** 体系本体 —— 相性系统的地基。见 SPEC 第 5 章。 */
export type Essence = 'qi' | 'body' | 'spirit' | 'law' | 'will' | 'shi'

/** 六维属性 */
export type AttrKey = 'root' | 'wits' | 'temper' | 'luck' | 'insight' | 'charm'

/** 长期变量 —— 每个事件必须至少改写其中一项。见 SPEC 2.1 检查表第 1 条。 */
export type VarKey =
  | 'currency' // 通用货币
  | 'power' // 修炼能量（修为）
  | 'rare_mat' // 突破材料
  | 'favor' // 阵营货币
  | 'debt' // 因果债务
  | 'exposure' // 暴露度
  | 'corruption' // 污染 / 心魔 / 失控
  | 'karma' // 功德 / 业力
  /**
   * 伤势 —— **注意方向：0 = 完好，100 = 油尽灯枯**。
   * 正 delta = 受伤加重，负 delta = 疗伤。
   * 这与"血量"是反的：事件里"成功却受了伤"应写 hp +N。
   * 把它当血量写会让伤害变成治疗 —— content-lint 有 hp_semantics 规则专门盯这个。
   */
  | 'hp'
  /**
   * 寿元**折损**（不是年龄，也不是剩余寿命）。
   *
   * 真正决定死活的是「年龄 ≥ 寿元上限」——上限 = 当前境界的寿命 + 这个折损值。
   * 事件里写 `lifespan -N` 就是"折了 N 年寿"，写正数就是"延了 N 年寿"。
   *
   * 之所以不做成"剩余寿命"：境界表里的 80/120/200/…/25600 是**能活到多少岁**，
   * 不是"一开始就有这么多年可活"。炼气修士不是开局揣着一百二十年，
   * 而是能活到一百二十岁。突破大境界会把这个上限整个抬上去——
   * 那是突破最实在的回报之一，用"剩余寿命"模型就完全体现不出来。
   */
  | 'lifespan'

/** 判定段位 */
export type Band = 'crit' | 'success' | 'fail' | 'crit_fail'

/** 风险五档 —— UI 用颜色区分 */
export type RiskTier = '稳' | '常' | '险' | '狠' | '绝'

/** 选项意图标签 */
export type Intent =
  | 'greedy'
  | 'steady'
  | 'scheme'
  | 'flee'
  | 'evil'
  | 'social'
  | 'study'
  | 'sacrifice'

export type Stage = 'childhood' | 'entry' | 'growth' | 'turn' | 'endgame'

export const STAGE_ORDER: Stage[] = ['childhood', 'entry', 'growth', 'turn', 'endgame']

// ============================================================
// 效果
// ============================================================

export type Effect =
  | { type: 'add_var'; key: VarKey; delta: number }
  | { type: 'add_attr'; key: AttrKey; delta: number }
  | { type: 'add_item'; ref: string; quality?: string; count?: number }
  | { type: 'consume_item'; ref: string; count?: number }
  | { type: 'add_affix'; target: string; affix_id: string }
  | { type: 'set_flag'; key: string }
  | { type: 'clear_flag'; key: string }
  | { type: 'set_relation'; npc_id: string; kind: RelationKind; delta: number }
  | { type: 'queue_followup'; ref: string } // "evt_id@3-8"
  | { type: 'force_stage_jump'; stage: Stage }
  | { type: 'unlock_title'; ref: string }
  | { type: 'unlock_codex'; ref: string }
  | { type: 'learn_rule'; pack: PackId; ref: string } // 跨界习得（SPEC 6.5）
  | { type: 'trigger_end'; ref: string }
  | { type: 'modify_power_index'; delta: number }
  | { type: 'destiny_drain'; ref: string; delta: number } // 磨位面之子的气运

export type RelationKind = '师徒' | '道侣' | '仇家' | '护道人' | '盟友'

// ============================================================
// 破局条件（SPEC 4.2 —— 自由度支柱 #4 的载体）
// ============================================================

export type Condition =
  | { type: 'attr'; key: AttrKey; op: CompareOp; value: number }
  | { type: 'var'; key: VarKey; op: CompareOp; value: number }
  | { type: 'item'; ref: string; count?: number }
  /** 功能标签匹配 —— 涌现的关键：任何新物品只要带该标签，自动成为合法解法 */
  | { type: 'affordance'; ref: string; count?: number }
  | { type: 'affix_count'; ref: string; count: number }
  /** 理解即钥匙：已揭示某条隐规则 */
  | { type: 'known_rule'; ref: string }
  /** 跨界习得：已装载某体系的外来规则 */
  | { type: 'learned_rule'; pack: PackId; ref: string }
  | { type: 'flag'; ref: string }
  | { type: 'relation'; kind: RelationKind; exists?: boolean; op?: CompareOp; value?: number }
  | { type: 'faction_tier'; ref: string; op: CompareOp; value: number }
  /** 组合涌现：已完成的其他条件组 */
  | { type: 'solved_any_of'; refs: string[] }
  | { type: 'node_count'; op: CompareOp; value: number }
  | { type: 'realm_idx'; op: CompareOp; value: number }
  | { type: 'pack'; ref: PackScope }
  /** 存活位面之子数量 —— 遭遇事件的门槛（SPEC 第 6 章） */
  | { type: 'destiny_alive'; op: CompareOp; value: number }
  /** 任一存活位面之子的气运磨损比例 0–1（磨得越狠越容易杀） */
  | { type: 'destiny_worn'; op: CompareOp; value: number }
  /** 存在某原型的位面之子 */
  | { type: 'destiny_archetype'; ref: DestinyArchetype }
  | { type: 'any'; of: Condition[] }
  | { type: 'all'; of: Condition[] }
  | { type: 'not'; of: Condition }

export type CompareOp = '>=' | '<=' | '>' | '<' | '==' | '!='

// ============================================================
// 事件
// ============================================================

export interface OutcomeBand {
  effects: Effect[]
  flags_set?: string[]
  clear_flags?: string[]
  narrative?: string // 叙事池 key
  queue_followup?: string
}

export interface Resolve {
  roll: {
    base: number // 基础成功率 0–1
    attr?: AttrKey
    attr_weight?: number
  }
  /** 相性修正：克制方 +30%，被克方 −30%（SPEC 第 5 章） */
  affinity_sensitive?: boolean
  bands: Partial<Record<Band, OutcomeBand>>
}

export interface Option {
  id: string
  text: string
  intent: Intent
  risk_tier: RiskTier
  odds_hint: string // 模糊概率，不显示精确数字
  cost_hint?: string
  /**
   * 可能得到什么 —— 模糊地预告收益方向，不写精确数值。
   *
   * 玩家原话：「它没有一个切实的引导和导向说明结果会怎么样，
   * 同时玩家无法了解这些选项背后的价值」。
   * 只有代价没有收益的选项，玩家是在盲选，选完才知道值不值 ——
   * 那不是抉择，是抽奖。所以每个选项都要说得出"它可能给你什么"。
   *
   * 措辞保持模糊（「或许能得一两味好药」），既给方向又不剧透。
   */
  gain_hint?: string
  /**
   * 这条选项偏向哪条路 —— 把选择与"你想成为什么样的人"接上。
   *
   * 玩家原话：「跟玩家想成为什么样的人无关」。原设计里选项的代价
   * 只服务于"把剧本推向某个结局"，是一条封闭回路，玩家在里面看不见自己。
   * 这一栏用来标出这条路在喂养哪种人设（如「毒功一路」「守正一道」），
   * 让同一场景对不同构筑的玩家意味着不同的东西。
   */
  path_hint?: string
  requires?: Condition
  resolve?: Resolve // 无 resolve = 纯演出（1 选项的"命运已定"）
  outcome?: OutcomeBand // 无判定的直通结果
}

export interface NarrativeSpec {
  title_pool: string[]
  body_key: string // L1/L2 寻址键，见 SPEC 第 7 章
  ai_enhance?: 'none' | 'l2' | 'l3'
}

/** 事件/剧本/结局的适用体系；'*' 表示全体系通用 */
export type PackScope = PackId | '*'

export interface LooseEvent {
  id: string
  kind: 'loose'
  pack: PackScope[]
  motif: string
  stage: Stage[]
  weight: number
  tension: number // 0–10，供节奏曲线
  once_per_run?: boolean
  requires?: Condition
  cooldown?: { same_motif?: number; same_npc?: number; same_tag?: number }
  narrative: NarrativeSpec
  options: Option[]
  followups?: string[] // "evt_id@debt>=3"
  tags: string[]
  meta_unlock?: { codex?: string; title?: string }
  version: string
}

// ============================================================
// 剧本（SPEC 第 4 章 —— 智性核心）
// ============================================================

export interface HiddenRule {
  id: string
  hint: string // 揭示后显示给玩家
  reveal: Condition
}

export interface Breakthrough {
  id: string
  name: string
  /** 全部满足才成立；内部可用 any/all/not 任意嵌套 */
  conditions: Condition[]
  cost: string // 代价预览
  outcome: {
    ref: string // 结局线索 ID
    narrative: string
    effects?: Effect[]
  }
  hidden?: boolean // 未被满足前不显示在 UI 上
}

export interface Scenario {
  id: string
  kind: 'scenario'
  name: string
  pack: PackScope[]
  span: number // 占用节点数 3–8
  tension: number
  weight: number
  requires?: Condition
  /** 开局全部告知玩家 */
  rules_stated: string[]
  /** 靠属性/知识/道具揭示，UI 显示为「未解」 */
  rules_hidden: HiddenRule[]
  /** 违规即判定失败或追加惩罚 */
  forbidden: string[]
  /** 核心：多条件破局。互不包含，且必须使用 ≥3 种条件类型 */
  breakthroughs: Breakthrough[]
  /** 未破局不是「操作无效」，而是一种独立结局 */
  unsolved: { narrative: string; ref: string; effects?: Effect[] }
  version: string
}

export type AnyEvent = LooseEvent | Scenario

// ============================================================
// 位面之子（SPEC 第 6 章 —— 创新模块）
// ============================================================

export type DestinyArchetype = 'brute' | 'schemer' | 'turtle' | 'ironic' | 'tragic'

export interface FateMilestone {
  id: string
  name: string
  narrative: string
  /** 达成时对其自身属性的增益 */
  power_gain: number
  /** 达成时对世界的影响 */
  world_effect?: { region_tag?: string; danger_delta?: number; opens?: string[]; closes?: string[] }
}

export interface DestinyChild {
  id: string
  name: string
  pack: PackId // 出身体系 —— 与玩家不同
  archetype: DestinyArchetype
  /** 气运池：主角不死性 = 可耗尽的资源。见 SPEC 6.2 */
  destiny_pool: number
  destiny_max: number
  power_index: number
  realm_name: string
  /** 后台命运线：玩家每推进一步，他们也推进一步 */
  fate_line: FateMilestone[]
  fate_progress: number
  /** 命运线走完（已成道）—— 结算一次，之后不再重复增益 */
  fate_complete?: boolean
  region_tag: string
  /** 对你的关系 −100–100 */
  relation: number
  /** 智谋型专用：记录玩家对他用过的手段 */
  used_against: string[]
  /** 因「使用过的手段」而获得的抗性 */
  resistances: string[]
  alive: boolean
  /** 谶语式批注，供天机榜显示 */
  oracle_note: string
  /** 他自身的种子，保证命运线可复现 */
  seed: string
}

// ============================================================
// 世界包
// ============================================================

export interface Realm {
  idx: number
  name: string
  power_index: [number, number]
  lifespan: number | null
  breakthrough: number
  /**
   * 小境界的称呼。缺省时由引擎按境界序号推断
   * （炼气九层、筑基初期/中期/后期/圆满…）。
   * 见 engine.ts 的 subLevelsOf。
   */
  sub_names?: string[]
}

export interface WorldPack {
  pack_id: PackId
  display_name: string
  inspiration_tag: string // 只致谢风格结构，不含独创表达（SPEC 第 8 章）
  essence: Essence
  version: string
  rule_ref: string
  realms: Realm[]
  resource_map: Record<string, { name: string; tiers?: string[]; subtypes?: string[] }>
  goldfinger_slots: { id: string; name: string; rarity: string; effects: string[] }[]
  fail_modes: { id: string; trigger: string; text_ref: string }[]
  motif_weights: Record<string, number>
  tone: { narration: string; humor: number; violence: number }
}

export interface TermDict {
  pack_id: PackId
  dict: Record<string, string[]>
}

// ============================================================
// 物品与词条
// ============================================================

export interface Affix {
  id: string
  name: string
  tier: string // 凡品/灵品/宝品/仙品/道品/混沌
  /** 功能标签 —— 破局条件 affordance 匹配的依据 */
  affordance: string[]
  effects?: Effect[]
}

export interface Item {
  id: string
  name: string
  quality: string
  affixes: string[] // affix id
  affordance: string[] // 汇总的功能标签（由 affixes 派生 + 本体自带）
  desc?: string
}

// ============================================================
// 结局
// ============================================================

export interface Ending {
  id: string
  pack: PackScope[]
  tier: string
  category: string
  requires?: Condition
  title_pool: string[]
  body_key: string
  rating: { stars_rule: string; min_stars: number }
  meta_reward: { legacy_points: number; unlock: string[] }
  ai_enhance?: 'none' | 'l2' | 'l3'
}

// ============================================================
// 转世与命格
// ============================================================

export interface Origin {
  id: string
  name: string
  variant: number
  attr_mods: Partial<Record<AttrKey, number>>
  start_resources?: Partial<Record<VarKey, number>>
  inherent_flags?: string[]
  recommended_pack?: PackId
}

export interface Trait {
  id: string
  name: string
  tier: 'S' | 'A' | 'B' | 'C'
  category: '修炼向' | '战斗向' | '经营向' | '社交向' | '诡道向'
  effects: Effect[]
  excludes?: string[] // 互斥组
  desc: string
}

export interface Flaw {
  id: string
  name: string
  effects: Effect[]
  compensate: number // 补偿点数
  desc: string
}

export interface Destiny {
  id: string
  name: string
  combo: Condition // 出身+天赋组合解锁
  rule_rewrite: string
  effects: Effect[]
  desc: string
}

// ============================================================
// 运行时状态
// ============================================================

export type Attrs = Record<AttrKey, number>
export type Vars = Record<VarKey, number>

export interface Relation {
  npc_id: string
  kind: RelationKind
  value: number
}

export interface LearnedRule {
  pack: PackId
  ref: string
  name: string
  /** 习得后装在玩家身上的槽位，如 mystery 的 sanity */
  grants_slot?: string
}

export interface HistoryEntry {
  node_index: number
  event_id: string
  option_id: string
  /** 这一手是什么性质 —— 用来判断"这段时间在不在修行" */
  intent?: Intent
  roll?: number
  band?: Band
  delta: Partial<Record<VarKey | AttrKey, number>>
  scenario_id?: string
  breakthrough_id?: string
  rule_version: string
}

export interface QueuedEvent {
  event_id: string
  window: [number, number] // 在 node_index 的哪个区间内必出
}

export interface ScenarioRun {
  scenario_id: string
  started_at: number // node_index
  nodes_spent: number
  revealed_rules: string[]
  solved: string[] // 已完成的条件组 id
  attempted: string[] // 已尝试过的物品/规则 id（防重复刷）
}

export interface GameState {
  run_id: string
  seed: string
  node_index: number
  stage: Stage
  pack_id: PackId
  /** 当前年龄（岁）。随时间推进增长；与寿元上限比较决定是否寿尽 */
  age: number
  realm_idx: number
  /** 小境界序号（大境界内第几层）；无小境界的大境界恒为 0 */
  minor_idx: number
  power_index: number
  attrs: Attrs
  vars: Vars
  flags: Record<string, boolean>
  items: Item[]
  relations: Relation[]
  learned_rules: LearnedRule[]
  titles: string[]
  codex: string[]
  faction_tier: Record<string, number>
  history: HistoryEntry[]
  queue: QueuedEvent[]
  recent_motifs: string[]
  recent_tags: string[]
  recent_narrative: string[] // 玩家级去重：30 节点内不重复
  destiny_children: DestinyChild[]
  active_scenario?: ScenarioRun
  /** 已触发但玩家尚未决定是否进入的剧本 */
  pending_scenario?: string
  /** 本局已涌现过的结局线索，供结局结算 */
  ending_threads: string[]
  status: 'alive' | 'ended'
  end_reason?: string
  pending_ending?: string
  rule_version: string
  content_version: string
  /** 引擎用：当前正在呈现的事件 / 剧本 id，供存档续玩 */
  current_event_id?: string
  /** 上一个节点跨过的年数 —— 过渡句与试玩 agent 都要用它说"多少年后" */
  last_years?: number
  /** 上一个节点的境界 —— 用来判断这一步是不是突破，好写"境界跃迁"的过渡 */
  last_realm_idx?: number
  /** 上一个节点的母题 —— 用来判断这件事是不是上一件事的延续 */
  last_motif?: string
  /** 本局已经用过多少次过渡句 —— 避免同一句连着出现 */
  transition_used?: number
  /** 引擎用：本局目标节点总数（决定阶段推进节奏） */
  total_nodes: number
  /** 引擎用：本局已完成过的剧本 id，防重复 */
  completed_scenarios: string[]
  /** 引擎用：已触发过 once_per_run 的事件 id */
  fired_events: string[]
  /** 上一次日常选了什么 —— 供叙事与统计用 */
  last_daily?: string
  /** 连着闭关了几次 —— 闭关收益递减的依据（闭门造车） */
  daily_streak?: number
}

// ============================================================
// 结算输出
// ============================================================

export interface DeltaEntry {
  key: VarKey | AttrKey
  from: number
  to: number
  reason: string
}

export interface NodePresentation {
  node_index: number
  kind: 'loose' | 'scenario' | 'scenario_node' | 'encounter' | 'ending'
  event_id: string
  title: string
  lines: string[]
  mood: string
  /** 剧本专有 */
  scenario?: {
    name: string
    rules_stated: string[]
    rules_hidden: { id: string; hint: string; revealed: boolean }[]
    forbidden: string[]
    breakthroughs: { id: string; name: string; cost: string; hidden: boolean; satisfied: boolean }[]
    nodes_spent: number
    span: number
  }
  options: Option[]
  /** 剧本内的「以物/以法试之」入口 —— 离散选择，永不是自由文本 */
  trials?: TrialOption[]
  /** 剧本内的通用手段（探查/交涉/硬闯/静待/抽身） */
  actions?: ScenarioAction[]
  /** 日常节点：这一段年月怎么过，玩家自己定 */
  daily?: DailyAction[]
  /**
   * 承上启下的过渡句 —— 上一件事与这一件事之间的接缝。
   *
   * 没有它，相邻两个节点就是两张不相干的画：上一句祖父递来一卷书，
   * 下一句你已经跟着商队进了山，中间发生了什么全靠玩家自己脑补。
   * 文本池是按「母题×阶段」独立取词的，它不知道前一个节点讲过什么，
   * 所以接缝必须单独生成。
   */
  transition?: string
  /** 剧本触发时的入场抉择 —— 有这一项时，玩家还没进去 */
  scenario_entry?: ScenarioEntry
}

export interface TrialOption {
  kind: 'item' | 'rule'
  ref: string
  name: string
  affordance: string[]
}

/**
 * 剧本内的通用手段。
 *
 * 玩家反馈「剧本只能用物品和静待，没有什么可以自己进行操作的自由度」——
 * 之前的剧本里，除了翻行囊就只剩干等，那不叫解谜，叫卡住。
 * 这几种是**不依赖背包**的主动操作，让玩家在任何处境下都有牌可打。
 */
export type ScenarioActionId = 'probe' | 'parley' | 'force' | 'attune' | 'wait' | 'leave'

export interface ScenarioAction {
  id: ScenarioActionId
  name: string
  desc: string
  cost: string
  /** 主要依赖的属性，供 UI 提示成功率倾向 */
  attr?: AttrKey
}

/**
 * 日常行动 —— 每隔几个节点，玩家自己决定这段时间花在哪。
 *
 * 玩家原话：「缺乏可交互的场景（例如日常是选择修炼还是拍卖会等等这些
 * 自由度高的设计）」，以及「不是每一次事件都会增长修为的」。
 *
 * 这两条其实是同一件事：一局里玩家得有**自己分配时间**的地方。
 * 没有它，修为只能靠被动上涨（时间一推就涨），玩家也在局中没有主张。
 */
export type DailyActionId = 'cultivate' | 'roam' | 'market' | 'befriend' | 'gather'

export interface DailyAction {
  id: DailyActionId
  name: string
  desc: string
  /** 可能得到什么 —— 与选项的 gain_hint 同一套口径 */
  gain_hint: string
  cost_hint?: string
  /** 当前处境下做不做得了（如坊市没钱、无伤可疗） */
  available: boolean
  /** 不可用时说明原因 */
  blocked_reason?: string
}

/** 剧本触发时的入选项 —— 玩家有权不进去 */
export interface ScenarioEntry {
  scenario_id: string
  name: string
  /** 开场的氛围描写 */
  lines: string[]
  rules_stated: string[]
  span: number
}

export interface ResolveResult {
  delta: DeltaEntry[]
  band?: Band
  roll?: number
  presentation: NodePresentation
  state: GameState
  active_destiny?: DestinyChild
}
