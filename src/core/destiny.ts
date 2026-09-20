/**
 * 位面之子系统 —— 创新模块。见 SPEC 第 6 章。
 *
 * 三条设计主张：
 *   1. 他们不是站着等你触发的 NPC。他们在后台走自己的命运线，**会真的变强**。
 *   2. 主角不死性 = **可耗尽的气运池**。每次"天意庇佑"扣池子；
 *      池子见底，巧合再也编不出来——他就真的会死。
 *   3. 智谋型**会读你的牌**：记录你用过的手段，下次带上对应抗性。
 *      这让"磨主角光环"从体力活变成信息博弈。
 */

import { PACK_ESSENCE, affinityModifier } from './affinity'
import { Rng, deriveSeed } from './rng'
import type {
  DestinyArchetype,
  DestinyChild,
  FateMilestone,
  GameState,
  PackId,
} from './types'

export const ARCHETYPES: DestinyArchetype[] = ['brute', 'schemer', 'turtle', 'ironic', 'tragic']

export const ARCHETYPE_NAMES: Record<DestinyArchetype, string> = {
  brute: '蛮力型',
  schemer: '智谋型',
  turtle: '苟道型',
  ironic: '反套路型',
  tragic: '悲剧型',
}

export const ARCHETYPE_DESC: Record<DestinyArchetype, string> = {
  brute: '一路碾压，数值成长最快。正面打不过，只能借规则杀。',
  schemer: '成长慢，但会读你的牌——你对他用过的手段，他下次会带上抗性。',
  turtle: '气运池极深，几乎杀不死。与其为敌，不如结盟。',
  ironic: '他的「金手指」其实是诅咒。命运线的终点是自我毁灭。',
  tragic: '命运线注定失败，而他的失败会波及你。改变他的命运，是本作最难的成就。',
}

/** 各原型的初始气运池 —— 「势」系（苟道包）天生池子深 */
const BASE_POOL: Record<DestinyArchetype, number> = {
  brute: 3,
  schemer: 4,
  turtle: 7,
  ironic: 5,
  tragic: 4,
}

/** 天意庇佑的触发概率修正 */
const PROTECT_BIAS: Record<DestinyArchetype, number> = {
  brute: -0.1, // 莽夫没那么受天道眷顾
  schemer: 0.0,
  turtle: 0.2, // 苟道流最难杀
  ironic: 0.15, // 他的"庇佑"其实是把他推向毁灭
  tragic: 0.1,
}

/** 命运线推进的节点间隔：越"主角"的推进越快 */
const FATE_INTERVAL: Record<DestinyArchetype, number> = {
  brute: 4, // 升级流，快
  schemer: 7, // 慢热，靠布局
  turtle: 8,
  ironic: 5,
  tragic: 6,
}

// ============================================================
// 生成
// ============================================================

/** 名字素材 —— content 层可覆盖，此处为兜底保证 game-core 独立可跑 */
const FALLBACK_SURNAMES = ['沈', '陆', '姜', '云', '裴', '燕', '竺', '容', '谢', '萧', '顾', '苏']
const FALLBACK_GIVEN = [
  '砚', '舟', '珩', '澈', '寻', '照', '野', '辞', '度', '青崖', '长庚', '无咎',
  '怀瑾', 'временно', '惊鸿', '临渊', '寒山', '明烛', '折雪', '归尘',
].filter((s) => /^[一-龥]+$/.test(s))

export interface DestinyGenInput {
  seed: string
  playerPack: PackId
  allPacks: PackId[]
  count: number
  realmNames: Partial<Record<PackId, string[]>>
  fateTemplates: Partial<Record<PackId, FateMilestone[]>>
  regionTags: string[]
  oraclePool: string[]
}

/**
 * 生成 0–3 个位面之子。每个人来自**与玩家不同**的体系包。
 * 全部随机走各自的种子流，互不干扰 —— 保证可复现。
 */
export function generateDestinyChildren(input: DestinyGenInput): DestinyChild[] {
  const rng = new Rng(deriveSeed(input.seed, 'destiny-roster'))
  const others = input.allPacks.filter((p) => p !== input.playerPack)
  if (others.length === 0 || input.count <= 0) return []

  const packs = rng.weightedSample(others, others.map(() => 1), Math.min(input.count, others.length))

  return packs.map((pack, i) => {
    const childSeed = deriveSeed(input.seed, `destiny-${i}-${pack}`)
    const r = new Rng(childSeed)
    const archetype = r.pick(ARCHETYPES)
    const pool = BASE_POOL[archetype] + r.int(0, 2)

    // 命运线：从该体系的母题里程碑里抽 3–5 个
    const tpl = input.fateTemplates[pack] ?? []
    const steps = tpl.length > 0 ? r.weightedSample(tpl, tpl.map(() => 1), r.int(3, 5)) : []

    const realmNames = input.realmNames[pack] ?? ['未知']
    const name = `${r.pick(FALLBACK_SURNAMES)}${r.pick(FALLBACK_GIVEN)}`

    return {
      id: `dc_${i}_${pack}_${archetype}`,
      name,
      pack,
      archetype,
      destiny_pool: pool,
      destiny_max: pool,
      power_index: r.int(3, 14),
      // 写死 `realmNames[1]` 是错的：那是"第二境"，与刚生成的修为无关。
      // 位面之子从最底一层起步（power_index 只有 3~14），
      // 此后由 `advanceNode` 按他自己的修为重算 —— 见 engine 的 realmNameAt。
      realm_name: realmNames[0] ?? '未知',
      fate_line: steps,
      fate_progress: 0,
      region_tag: input.regionTags.length > 0 ? r.pick(input.regionTags) : 'wild',
      relation: 0,
      used_against: [],
      resistances: [],
      alive: true,
      oracle_note: input.oraclePool.length > 0 ? r.pick(input.oraclePool) : '天机未明。',
      seed: childSeed,
    }
  })
}

// ============================================================
// 命运线推进（后台，玩家每推进一步他们也推进一步）
// ============================================================

export interface FateAdvanceResult {
  advanced: boolean
  milestone?: FateMilestone
  /** 对世界的影响 */
  worldEffect?: FateMilestone['world_effect']
}

/**
 * 推进一个位面之子的命运线。
 * 用「节点号 % 间隔」而非随机数，保证同一 run 的可复现性。
 */
export function advanceFate(child: DestinyChild, nodeIndex: number): FateAdvanceResult {
  if (!child.alive) return { advanced: false }
  const interval = FATE_INTERVAL[child.archetype]
  const r = new Rng(deriveSeed(child.seed, `fate-@${nodeIndex}`))
  const offset = r.int(0, interval - 1)

  if ((nodeIndex + offset) % interval !== 0) return { advanced: false }

  // 命运线走完：他已走到自己故事的终点。**只结算一次**，
  // 否则每次间隔命中都会白涨战力，后期所有位面之子都会顶到满值。
  if (child.fate_progress >= child.fate_line.length) {
    if (!child.fate_complete) {
      child.fate_complete = true
      child.power_index = Math.min(1000, child.power_index + 80)
    }
    return { advanced: false }
  }

  const milestone = child.fate_line[child.fate_progress]!
  child.fate_progress += 1
  child.power_index = Math.min(1000, child.power_index + milestone.power_gain)

  // 境界名随战力推进
  return { advanced: true, milestone, worldEffect: milestone.world_effect }
}

// ============================================================
// 天意庇佑 —— 主角不死性 = 可耗尽的资源
// ============================================================

export interface ProtectCheck {
  protected: boolean
  /** 供叙事层生成"合理的巧合" */
  coincidenceKey: string
  poolAfter: number
}

/**
 * 玩家对位面之子造成致命结果时调用。
 *
 * 关键：**不是直接结算死亡，而是先过这个检定**。
 * 检定过了 → 一个合理的巧合救走他（护道人赶到 / 天雷劈偏 / 你的仇家恰在此刻杀来）。
 * 每次庇佑扣气运池。池子见底，巧合再也编不出来。
 *
 * @param means 玩家使用的手段标签（火攻/偷袭/毒/规则…），智谋型据此长抗性
 */
export function checkDestinyProtection(
  child: DestinyChild,
  rng: Rng,
  means?: string,
): ProtectCheck {
  const poolRatio = child.destiny_max > 0 ? child.destiny_pool / child.destiny_max : 0
  const bias = PROTECT_BIAS[child.archetype]

  // 抗性直接加成庇佑概率 —— 智谋型的"反制"
  const resistant = means ? child.resistances.includes(means) : false
  const resistBonus = resistant ? 0.25 : 0

  const p = Math.max(0, Math.min(0.95, poolRatio * 0.85 + bias + resistBonus))
  const roll = rng.next()
  const protectedFlag = child.destiny_pool > 0 && roll < p

  if (protectedFlag) {
    child.destiny_pool -= 1
    if (means && !child.used_against.includes(means)) child.used_against.push(means)
  }

  const coincidenceKey = protectedFlag
    ? resistant
      ? `destiny.protect.resist.${child.archetype}`
      : `destiny.protect.${child.archetype}`
    : 'destiny.protect.none'

  return { protected: protectedFlag, coincidenceKey, poolAfter: child.destiny_pool }
}

/**
 * 智谋型的反制：据玩家用过的手段长出抗性。
 * 每次玩家尝试之后调用一次。
 */
export function adaptSchemer(child: DestinyChild): void {
  if (child.archetype !== 'schemer') return
  const unseen = child.used_against.filter((m) => !child.resistances.includes(m))
  if (unseen.length === 0) return
  // 每次只"读懂"一种手段，且需要用过至少一次
  child.resistances.push(unseen[0]!)
}

/** 位面之子死亡：玩家继承他的金手指与他的因果（他的仇家从此来找你） */
export interface KillReward {
  goldfinger_pack: PackId
  goldfinger_id: string
  inherited_debt: number
  title: string
}

export function killDestinyChild(child: DestinyChild): KillReward {
  child.alive = false
  return {
    goldfinger_pack: child.pack,
    goldfinger_id: `goldfinger_${child.pack}`,
    // 继承他的因果：杀主角是要还的
    inherited_debt: 12 + child.fate_progress * 4,
    title: `弑主·${child.name}`,
  }
}

/** 玩家对某位面之子的对抗判定修正（相性 + 已磨掉的气运） */
export function encounterModifier(state: GameState, child: DestinyChild): number {
  const aff = affinityModifier(PACK_ESSENCE[state.pack_id], PACK_ESSENCE[child.pack])
  const worn = 1 - child.destiny_pool / Math.max(1, child.destiny_max)
  return aff + worn * 0.2
}

/** UI 用：气运条 */
export function destinyBar(child: DestinyChild): { filled: number; total: number; label: string } {
  return {
    filled: child.destiny_pool,
    total: child.destiny_max,
    label: '气运',
  }
}
