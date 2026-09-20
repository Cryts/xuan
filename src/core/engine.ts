/**
 * 引擎 —— 状态机 · 事件调度器 · 剧本推进器 · 结算。
 *
 * 全部是纯函数：给定同一份 state 与同一份 seed，输出必然一致。
 * 这保证了回放、蒙特卡洛模拟与 bug 复现（SPEC 第 1 章决策 #2）。
 *
 * 铁律：数值永不由文本层决定。这里只算数值，文本由 narrative.ts 单独选。
 */

import { evaluate } from './conditions'
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
  DeltaEntry,
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
  Scenario,
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
export const POWER_TO_INDEX = 0.5

/**
 * 由累积修为反推 power_index 与 realm_idx。
 * 这是「统一数值骨架」的落地：引擎只认 power_index，
 * 表层境界名是它经体系包查表得到的投影。
 */
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

  if (power_index === state.power_index && realm_idx === state.realm_idx) return state
  return { ...state, power_index, realm_idx }
}

/** 当前境界的表层名（各体系包不同） */
export function realmNameOf(state: GameState, content: ContentDB): string {
  const pack = content.packs[state.pack_id]
  return pack?.realms[state.realm_idx]?.name ?? '未知'
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
export const CULTIVATE_BASE = 14

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

export function cultivateGain(state: GameState): number {
  const witsFactor = 1 + state.attrs.wits / 100
  const realmFactor = 1 + state.realm_idx * 0.2
  return CULTIVATE_BASE * witsFactor * realmFactor
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
    lifespan: pack.realms[0]?.lifespan ?? 80,
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
    realm_idx: 0,
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

  // 1. 队列保底：窗口内必出
  const forced = state.queue.filter(
    (q) => state.node_index >= q.window[0] && state.node_index <= q.window[1],
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
  const weights = (evCandidates as LooseEvent[]).map((c) => {
    const base = c.weight
    const packPref = pack?.motif_weights?.[c.motif] ?? 1
    const tension = c.tension ?? 5
    // 张力拟合：离目标越远权重越低，但不为 0
    const tensionFit = 1 / (1 + Math.abs(tension - target) * 0.25)
    const luckFactor = 1 + (state.attrs.luck - 50) * 0.004
    return base * packPref * tensionFit * luckFactor
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
    options: [],
    trials: buildTrials(state, content),
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

  const effects = solved.length === 0 ? (sc.unsolved.effects ?? []) : []
  const next = applyEffectsState(state, effects, `scenario:${sc.id}:finish`)

  return {
    ...next,
    ending_threads: [...next.ending_threads, ref],
    completed_scenarios: [...next.completed_scenarios, sc.id],
    active_scenario: undefined,
  }
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
  const next = applyEffectsState(
    state,
    [
      { type: 'unlock_title', ref: reward.title },
      { type: 'add_var', key: 'debt', delta: reward.inherited_debt },
    ],
    `kill:${child.id}`,
  )
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
  next = {
    ...next,
    vars: {
      ...next.vars,
      // 上界与 clampVar('power') 保持一致：累积修为要留出换算余量，
      // 这里若再封 1000，power_index 就永远到不了 1000。
      power: Math.min(2000, next.vars.power + gain),
      hp: Math.max(0, next.vars.hp - heal),
    },
  }

  // 由累积修为反推境界 —— 每推进一步结算一次
  next = recomputeProgress(next, content)

  return checkEnd(next)
}

/** 终局判定：寿元耗尽 / 伤势归零 / 节点走完 */
export function checkEnd(state: GameState): GameState {
  if (state.status === 'ended') return state
  if (state.pending_ending) {
    return { ...state, status: 'ended', end_reason: 'ending', pending_ending: state.pending_ending }
  }
  // hp 是伤势：满值才是死，不是归零
  if (state.vars.hp >= 100) {
    return { ...state, status: 'ended', end_reason: 'hp' }
  }
  if (state.vars.lifespan <= 0) {
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

  // 剧本进行中：继续呈现剧本
  if (state.active_scenario) {
    const sc = content.scenarios.find((s) => s.id === state.active_scenario!.scenario_id)
    if (sc) {
      const rng = new Rng(makeSeed(state.seed, state.node_index, `scn:${sc.id}`))
      return buildScenarioPresentation(state, content, sc, rng)
    }
  }

  const rng = new Rng(makeSeed(state.seed, state.node_index, 'present'))
  const ev = pickNextEvent({ state, content, rng })
  if (!ev) {
    return {
      node_index: state.node_index,
      kind: 'loose',
      event_id: 'fallback',
      title: '静',
      lines: ['四下无声。你调息片刻，继续前行。'],
      mood: 'somber',
      options: [
        { id: 'a', text: '继续赶路', intent: 'steady', risk_tier: '稳', odds_hint: '十拿九稳' },
      ],
    }
  }

  // 进入剧本：初始化剧本运行时
  if (ev.kind === 'scenario' && !state.active_scenario) {
    const sc = ev as Scenario
    const withRun: GameState = {
      ...state,
      active_scenario: {
        scenario_id: sc.id,
        started_at: state.node_index,
        nodes_spent: 0,
        revealed_rules: [],
        solved: [],
        attempted: [],
      },
    }
    Object.assign(state, { active_scenario: withRun.active_scenario })
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
  const power = state.power_index / 200 // 0–5
  const karma = state.vars.karma / 80 // −1.25–1.25
  const debt = state.vars.debt / 25 // 0–4
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
