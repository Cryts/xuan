/**
 * 判定与结算 —— 规则独占状态层。见 SPEC / 上游第 7 章。
 *
 * 四段式：crit / success / fail / crit_fail
 * 伪随机保底：连续 2 次 fail 后，crit/success 权重 +30%（最多叠 2 层）
 *
 * 所有函数都是纯函数：不改传入的 state，返回新的 delta。
 * 这是回放与蒙特卡洛的前提。
 */

import { affinityModifier, PACK_ESSENCE } from './affinity'
import type { Rng } from './rng'
import type {
  AttrKey,
  Band,
  DeltaEntry,
  Effect,
  GameState,
  HistoryEntry,
  Resolve,
  VarKey,
} from './types'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** 连续失败次数（从 history 尾部数）—— 保底机制的纯函数实现，无需额外状态字段 */
export function consecutiveFails(history: HistoryEntry[]): number {
  let n = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const b = history[i]!.band
    if (b === 'fail' || b === 'crit_fail') n++
    else break
  }
  return n
}

/** 保底加成：连续失败后提升上段权重，最多叠 2 层 */
export function pityBonus(history: HistoryEntry[]): number {
  return Math.min(2, Math.max(0, consecutiveFails(history) - 1)) * 0.15
}

export interface RollOutcome {
  band: Band
  roll: number
  p: number
}

/**
 * 判定一次。
 * @param opponentPack 有相性对抗时对方的体系包；无对抗传 undefined
 */
export function rollBand(
  resolve: Resolve,
  state: GameState,
  rng: Rng,
  opponentPack?: GameState['pack_id'],
): RollOutcome {
  const { base, attr, attr_weight } = resolve.roll

  let p = base
  if (attr) {
    const v = state.attrs[attr as AttrKey] ?? 0
    p += v * (attr_weight ?? 0)
  }
  // 相性修正（SPEC 第 5 章）：克制 +30%，被克 −30%
  if (resolve.affinity_sensitive && opponentPack) {
    p += affinityModifier(PACK_ESSENCE[state.pack_id], PACK_ESSENCE[opponentPack])
  }
  p = clamp(p, 0.05, 0.95)

  // 大成功率受气运影响；大失败率受心性影响
  const crit = clamp(0.07 + state.attrs.luck * 0.001, 0.02, 0.25)
  const cfail = clamp(0.12 - state.attrs.temper * 0.0008, 0.03, 0.2)

  // 保底：连续失败后把中段权重往好的一面推
  const pity = pityBonus(state.history)
  const pAdj = clamp(p + pity, 0.05, 0.97)

  const mid = 1 - crit - cfail
  const successSpan = pAdj * mid
  const failSpan = (1 - pAdj) * mid

  const roll = rng.next()
  let band: Band
  if (roll < crit) band = 'crit'
  else if (roll < crit + successSpan) band = 'success'
  else if (roll < crit + successSpan + failSpan) band = 'fail'
  else band = 'crit_fail'

  return { band, roll, p: pAdj }
}

export interface AppliedEffects {
  delta: DeltaEntry[]
  followups: string[]
}

/**
 * 应用一组效果，返回 delta（不修改传入 state —— 调用方负责合并）。
 */
export function applyEffects(
  effects: Effect[],
  state: GameState,
  reason: string,
): AppliedEffects {
  const delta: DeltaEntry[] = []
  const followups: string[] = []

  // 同一组效果里可能有多个 add_var 指向同一个 key（例如成功却受伤，
  // 同时给修为和伤势）。必须**累加**到同一个运行值上：
  // 若各自基于原始值算 to，后写的会覆盖先写的，静默丢掉前面的收益。
  const original = new Map<string, number>()
  const running = new Map<string, number>()

  const bump = (key: string, base: number, d: number, clampFn: (v: number) => number) => {
    if (!original.has(key)) original.set(key, base)
    const cur = running.has(key) ? running.get(key)! : base
    running.set(key, clampFn(cur + d))
  }

  const flush = () => {
    for (const [key, to] of running) {
      const from = original.get(key)!
      if (to !== from) delta.push({ key: key as VarKey | AttrKey, from, to, reason })
    }
    original.clear()
    running.clear()
  }

  for (const eff of effects) {
    switch (eff.type) {
      case 'add_var': {
        const k = eff.key as VarKey
        bump(k, state.vars[k] ?? 0, eff.delta, (v) => clampVar(k, v))
        break
      }
      case 'add_attr': {
        const k = eff.key as AttrKey
        bump(k, state.attrs[k] ?? 0, eff.delta, (v) => clamp(v, 0, 100))
        break
      }
      case 'queue_followup':
        followups.push(eff.ref)
        break
      default:
        // 其余效果（add_item / set_flag / learn_rule / unlock_* …）
        // 由 engine 的状态合并阶段处理，此处只登记
        break
    }
  }

  flush()
  return { delta, followups }
}

/** 变量各自的合法区间 —— 从上游 6.4 长期变量总表来 */
export function clampVar(key: VarKey, v: number): number {
  switch (key) {
    case 'debt':
    case 'exposure':
    case 'corruption':
      return clamp(v, 0, 100)
    case 'karma':
      return clamp(v, -100, 100)
    case 'hp':
      return clamp(v, 0, 100)
    case 'lifespan':
      return Math.max(0, v)
    case 'power':
      // 上界要留出 POWER_TO_INDEX 的换算余量：累积修为封到 1000 的话，
      // power_index 永远到不了 1000，境界阶梯有一半是够不着的。
      return clamp(v, 0, 4200)
    default:
      return Math.max(0, v)
  }
}

/** 合并 delta 到一份新的 state（不可变更新） */
export function mergeDelta(state: GameState, delta: DeltaEntry[]): GameState {
  const vars = { ...state.vars }
  const attrs = { ...state.attrs }
  for (const d of delta) {
    if (d.key in vars) vars[d.key as VarKey] = d.to
    else if (d.key in attrs) attrs[d.key as AttrKey] = d.to
  }
  // power_index 不在这里改 —— 它由 vars.power 经 recomputeProgress 反推，
  // 两处都写会互相打架。
  return { ...state, vars, attrs }
}
