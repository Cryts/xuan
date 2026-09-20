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
  /**
   * 距顶不超过 N 层 —— **"登顶"必须按阶梯比例说，不能按绝对序号说**。
   *
   * 事故：飞升类结局写的是 `realm_idx >= 9`。各体系包的阶梯长度并不一样
   * （灰雾之秘 10 层、太古遗蜕 18 层），于是同一个 9：
   *   灰雾之秘  = 顶上那一层      → 该包飞升率 0%
   *   太古遗蜕  = 才过半          → 该包飞升率 64%
   * 全体 25% 的"飞升率"里，几乎全是这两个长阶梯的包在灌水，
   * 而报表上它只显示成一个数，看不出是谁的问题。
   *
   * `value: N` 意为"还差 N 层到顶"，对所有包都是同一件事。
   */
  | { type: 'realm_top'; value: number }
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
  /**
   * 事件级正文 —— 优先于 `body_key`。
   *
   * 键名约定 **`evt.<事件 id>`**，不按序号派生：事件 id 末尾都是 `_NN`，
   * 但 `(母题, 阶段, 序号)` 这个组合有 119 组冲突（`evt_mortal_auction_03`
   * 与 `evt_genius_auction_03` 会派生到同一个 key）。用 id 做 key 零歧义。
   *
   * 取不到时**静默回落 `body_key`**，所以 `content-lint` 有一条
   * `narrative_key_resolvable` 盯着它。
   */
  self_key?: string
  /**
   * 余波 —— 选项结算之后那一段。
   *
   * 回落顺序是 `band.narrative` → `after_key` → `body_key`。
   * 最后那一级就是"把开场白当结局再念一遍"，所以夹在中间的这一级很要紧：
   * 一段话管四个段位，比给每个段位补词便宜得多。
   */
  after_key?: string
  /** 回望 —— 承接上一拍的正文（用在 `pickNextEvent` 之外的场景，如系列第二拍起） */
  before_key?: string
  /** 本事件的槽位覆盖：`renderTemplate` 的 `{location}` 之类 */
  slots?: Record<string, string[]>
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
  /**
   * ⚠️ **引擎不读这个字段**（只在 `chain.next` / `queue_followup` 上生效）。
   *
   * 全库 57 个事件声明了它，一条也没兑现过。它是早期设计（`"evt_id@debt>=3"`
   * 想表达"满足条件才接"），后来被 `OutcomeBand.queue_followup` 取代，
   * 现在由 `chain.next` 承接。`content-lint` 的 `followups_dead_field` 盯着它只许降不许升。
   *
   * 留在类型里是因为试玩仪表还用它做"有意连锁"的判据 ——
   * 那条判据本身也是错的（拿一个不生效的字段去解释重复），别照抄。
   */
  followups?: string[]
  /**
   * 渠道。缺省 `'chain'`（成系列）；`'omen'` = 一次性奇遇。
   *
   * **链式事件不写这个字段** —— 能派生就不要手写。
   * 奇遇绕过 `cooldown.same_motif` / `same_tag` / `stage` 过滤：
   * 奇遇的本分就是"在不该来的时候来"，而调度器的本分是维持节奏，
   * 这两件事必须分通道，同一条通道里它们会互相抵消。
   */
  channel?: 'chain' | 'omen'
  /** 仅奇遇用：距上次奇遇至少隔几拍。内容侧若声明更大的值，这一拍作废（保持每内容语义） */
  omen_gap?: number
  /**
   * 显式系列 —— 「这件事之后，按哪条分支接哪一件」。
   *
   * 比 `followups` 强的地方：带分支（`if`）、带根（`root`）。
   * 入队时**插队首**，因为它承诺的是"紧接着"；而
   * `planScenarioChain` 的铺垫继续插队尾 —— 见 `engine.ts` 的 `queue_followup` 分支。
   */
  chain?: {
    root: string
    next: { id: string; window?: string; if?: Band }[]
  }
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
  /**
   * 这个剧本由哪些**母题**在前文里铺垫 —— 「剧本是前面一路选择的收束」的接口。
   *
   * 引擎在 `advanceNode` 里规划：剧本露面之前，先按这些母题从事件池里
   * 挑 2~4 拍插进去。铺垫事件本来就带 `add_item`，于是玩家**带着一路攒下的
   * 东西**走进剧本，而不是空手撞上一个谜题 —— 这正是"关联性解法"的来源。
   *
   * 为什么不写具体事件 id：母题是数据轴，事件会随内容增删。
   * 声明母题，新加的事件自动进入铺垫池，不用回来改 18 个剧本。
   *
   * 引擎侧的兜底：一个母题都匹配不上时**直接让剧本登场**，不阻塞。
   * 内容没跟上时剧本照常触发，只是少了铺垫。
   */
  leadup_motifs?: string[]
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

/**
 * 物品的分野 —— 玩家定的：
 *   日常物品  随手可用（丹药、符箓、遁符……），任何时候都能掏出来
 *   剧本关键  只在特定局面里说得通（镇魂、启户、断法……），
 *             是破局用的，不该在赶路时随便消耗掉
 *
 * 不分家的后果很荒唐：一瓶疗伤丹你只能在剧本里喝，
 * 而出了剧本它就一直躺在行囊里占地方。
 *
 * `both` 是给那些两头都说得通的（如一张既能护身又能镇邪的符）。
 */
export type ItemClass = 'daily' | 'key' | 'both'

export interface Item {
  id: string
  name: string
  quality: string
  affixes: string[] // affix id
  affordance: string[] // 汇总的功能标签（由 affixes 派生 + 本体自带）
  /** 缺省由 affordance 派生，见 core/items.ts 的 classifyItem */
  class?: ItemClass
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
// 斗法（实现见 core/duel.ts）
// ============================================================

export type StanceId = 'assault' | 'guard' | 'bait' | 'conceal'
export type AffinityResult = 'counter' | 'countered' | 'neutral'

export interface Stance {
  id: StanceId
  name: string
  desc: string
  attack: number
  defense: number
  /**
   * 起伏：这一场你打得有多飘。
   *
   * 架势真正的差别**不在攻守**——斗法比的是谁推得多，而"削他"与"涨我"
   * 在数学上是同一根轴，所以"攻高守低"这种设计是假的取舍。
   * 真正的取舍是**赌一把还是稳扎稳打**：期望相当，方差不同。
   * 强攻能翻天也能崩盘，稳守赢不快也输不惨。
   */
  swing: number
  note?: string
}

export interface StanceOption {
  essence: Essence
  name: string
  from_pack?: PackId
  affinity: AffinityResult
  hint: string
}

export interface DuelOpponent {
  id: string
  name: string
  essence: Essence
  power_index: number
  realm_name: string
  is_destiny?: boolean
  fate_progress?: number
  note?: string
}

export interface DuelSpoils {
  win: { power: number; currency: number; rare_mat: number; favor: number }
  kill: { power: number; currency: number; rare_mat: number }
  kill_cost: { debt: number; exposure: number; karma: number }
}

export interface DuelSetup {
  opponent: DuelOpponent
  stances: Stance[]
  ways: StanceOption[]
  matchup: {
    my_power: number
    their_power: number
    odds: number
    odds_hint: string
    base_affinity: AffinityResult
  }
  spoils: DuelSpoils
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
  /**
   * 上一次结算的性质 —— 供 `composeTransition` 的"回望"那一级用。
   *
   * `echo_class` **由规则派生，不许内容自己标**（见 `deriveEchoClass`）：
   * 内容能自己标，就会为了想要的接缝去标错的档，而接缝说什么
   * 必须由"刚才真的发生了什么"决定。
   */
  last_outcome?: {
    event_id: string
    motif: string
    echo_class: EchoClass
    band?: Band
  }
  /**
   * 距上次奇遇呈现过去了多少拍。**每推进一拍 +1，含日常拍、斗法拍、剧本拍。**
   *
   * 在剧本里蹲久了、出来第一拍必是奇遇的那种节拍器效果，靠"照常 +1"避免：
   * 让路只是不做判定，不是把计数器冻住。
   */
  nodes_since_omen: number
  /** 最近呈现过的奇遇/商店 key —— 同一内容三拍内不得重复（含"不得连任"） */
  recent_omen: string[]
  /**
   * 玩家在"接不接"那一拍选了**接下** —— 记下真身的 key，
   * 让同一拍的第二屏呈现它本体（事件给正文与选项 / 坊市给货架）。
   *
   * 强调一遍：真身那一屏**不重新抽**。清了它（`advanceNode`）这一拍才算过去。
   */
  omen_open?: string
  /** 真身的类型，与 `omen_open` 同时写、同时清 */
  omen_open_kind?: 'event' | 'shop'
  /**
   * 上一步位面之子推进了什么（`advanceFate` 的 `milestone.narrative`）。
   *
   * 每推进一拍重算、不累加：它要讲的是"刚刚这一步"，攒着讲就成了一篇编年史。
   */
  destiny_notes: string[]
  /**
   * 奇遇轮到谁。`omen_rotation` 是**数组而不是布尔翻转** ——
   * 将来要加第三类奇遇（如游方术士）不用改 schema。
   */
  omen_turn: string
  omen_rotation: string[]
  /** 本局在坊市买过 / 卖过多少件（跨奇遇累计，涨价依据） */
  shop_bought: number
  shop_sold: number
  /**
   * 本次进店的货架。
   *
   * **存下来而不是每次重算**：`buildShopStock` 的种子由 `node_index` 定，
   * 重算会得到同一批货 —— 于是刚买走的那件又回到架子上，`stock` 形同虚设。
   * 买与卖**不推进节点**（与 `useItem` 同构），所以这一格里的货架必须是**活的**。
   */
  shop_stock?: ShopStock
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
  /**
   * 「游历」的偏好只作用于**紧随其后的那一拍**。
   *
   * 只靠 `last_daily === 'roam'` 判是不行的：它一旦写上就再没人清掉，
   * 于是此后每一拍都被当成"刚游历回来"。记下节点号，偏好自然过期，
   * 且同一节点重渲染时结果一致（`presentCurrent` 用 node_index 做种子重抽）。
   */
  last_daily_node?: number
  /** 斗法：已摆开明牌。duel_committed 为假时是在问"打不打" */
  pending_duel?: DuelSetup
  /** 玩家已经决定出手，接下来该选路数与架势了 */
  duel_committed?: boolean
  /** 这一场是怎么找上来的（仇家/被认出/命线交汇…），供叙事 */
  duel_reason?: string
  /** 上一次斗法发生在第几拍 —— 免得刚打完又被人堵住 */
  last_duel_node?: number
  /** 斗法：已打完，等玩家决定杀还是放 */
  pending_duel_result?: DuelOutcome
  /** 连着闭关了几次 —— 闭关收益递减的依据（闭门造车） */
  daily_streak?: number
  /**
   * 一局之内闭过关的总次数（不因中间做了别的而清零）。
   *
   * 递减原本按**连续**次数算，于是只要中间插一次游历/坊市，计数就归零 ——
   * 而日常每四拍才来一次，玩家天然会岔着做，这条规则**实际上从不生效**。
   * 「闭门造车」说的是一段时间里只顾着一件事，按一局累计才对。
   */
  daily_cultivate_total?: number
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
  /** 斗法·明牌：双方摊开，玩家选择以什么路数、带什么架势进场 */
  duel?: DuelSetup
  /** 斗法·结果：打完了，谈怎么处置 */
  duel_result?: DuelOutcome
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
  /**
   * 坊市货架。**是字段不是新 `kind`** ——
   * 与 `daily?: DailyAction[]` / `duel?: DuelSetup` 同构。
   *
   * 真身用 `kind:'loose'` + 这一项；"接不接"那一拍用 `kind:'encounter'`。
   * `tools/playtest.ts` 的 `hasPanel()` 必须认得它，否则试玩 agent 会把
   * 整个坊市当成空节点**强制跳过，而且不报错**（CLAUDE.md 登记过这个坑）。
   */
  shop?: ShopStock
  /** 奇遇“接不接”那一拍：引擎合成的两个选项之外，还要知道接下去是什么 */
  omen?: { key: string; kind: 'event' | 'shop' }
  /**
   * 位面之子这一步推进了什么 —— 「他在推命运线」的那句话。
   *
   * 出处是 `advanceFate` 的返回值：那个返回值**被丢掉了很久**，
   * 于是 54 个里程碑叙事一条也没到过玩家眼前（`world_effect` 的 41 条同理，
   * 那一半还没接，见 `advanceNode`）。
   */
  destiny_notes?: string[]
}

/**
 * 坊市货架。
 *
 * `bought_here` 与 `GameState.shop_bought` **必须分开**：
 * 前者是"这次进店的限购判据"，后者是"本局累计的涨价依据"。
 * 混用会让限购在第二次进店时失效（第二次进来 `bought_here` 还带着上次的数）。
 */
export interface ShopStock {
  node_index: number
  items: { item: Item; price: number; stock: number }[]
  /** 本次进店已成交笔数（限购判据） */
  bought_here: number
}

/** 回望档 —— `composeTransition` 最高优先级那一级的四个取值 */
export type EchoClass = 'cost' | 'gain' | 'escape' | 'debt'

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
export type DailyActionId = 'cultivate' | 'roam' | 'market' | 'befriend' | 'gather' | 'duel'

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

/**
 * 斗法的结果 —— 打赢之后才谈得上处置。
 * 杀死是**单独一个选择**，不是败者的默认下场。
 */
export interface DuelOutcome {
  opponent: DuelOpponent
  outcome: 'win' | 'lose' | 'draw'
  rounds: { index: number; affinity: string; winner: string; line: string }[]
  summary: string
  momentum: { mine: number; theirs: number }
  win_spoils: DuelSpoils['win']
  kill_spoils: DuelSpoils['kill']
  kill_cost: DuelSpoils['kill_cost']
  can_kill: boolean
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
