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
  | 'lifespan' // 寿元

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
  realm_idx: number
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
  /** 本局已涌现过的结局线索，供结局结算 */
  ending_threads: string[]
  status: 'alive' | 'ended'
  end_reason?: string
  pending_ending?: string
  rule_version: string
  content_version: string
  /** 引擎用：当前正在呈现的事件 / 剧本 id，供存档续玩 */
  current_event_id?: string
  /** 引擎用：本局目标节点总数（决定阶段推进节奏） */
  total_nodes: number
  /** 引擎用：本局已完成过的剧本 id，防重复 */
  completed_scenarios: string[]
  /** 引擎用：已触发过 once_per_run 的事件 id */
  fired_events: string[]
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
}

export interface TrialOption {
  kind: 'item' | 'rule'
  ref: string
  name: string
  affordance: string[]
}

export interface ResolveResult {
  delta: DeltaEntry[]
  band?: Band
  roll?: number
  presentation: NodePresentation
  state: GameState
  active_destiny?: DestinyChild
}
