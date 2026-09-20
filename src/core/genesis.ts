/**
 * 转世 —— 命格生成。见 SPEC 2.1 检查表（属性加成总和必须均衡）。
 *
 * 设计约束：出身/天赋/缺陷的属性加成总和必须落在阈值内，
 * 否则 content-lint 的 attr_balance 规则会打回。
 */

import type { Rng } from './rng'
import type { AttrKey, Flaw, Origin, Trait } from './types'

export const ATTR_KEYS: AttrKey[] = ['root', 'wits', 'temper', 'luck', 'insight', 'charm']

export const ATTR_NAMES: Record<AttrKey, string> = {
  root: '根骨',
  wits: '悟性',
  temper: '心性',
  luck: '气运',
  insight: '机敏',
  charm: '魅力',
}

/** 六维基础值 —— 总和固定，出身/天赋在此基础上偏移 */
const BASE = 40

/** 属性加成总和上限（content-lint 的 attr_balance 阈值） */
export const ATTR_BUDGET = 45

/**
 * 属性在一局之内的**实际可达区间** —— 由蒙特卡洛实测得出，不是拍的。
 *
 * 这一组数字是被一次真实事故逼出来的：剧本的破局条件写着
 * `wits >= 85`，而实测 200 局里悟性的中位数是 43、九十分位 47、
 * **全场最高 54**。也就是说那 48 个属性门槛**一个都够不着** ——
 * 玩家解锁了全部规则仍然破不了局，因为卡住的从来不是信息。
 *
 * 写剧本的人把属性当成了"满值 100、中期角色六七十"的量表，
 * 而本作是 40 起、事件里加一两点。两边对不上，而且**不报错**。
 * 所以这里把实测值固化成常量，content-lint 拿它当闸门：
 * 剧本里任何属性门槛超过 ATTR_REACHABLE 就是 error。
 *
 * 改动成长曲线（divideInitAttrs 的 BASE、事件的 add_attr 幅度）时，
 * 这三个数要重新跑 tools 里的属性分布测量，否则闸门会失真。
 */
export const ATTR_TYPICAL = 43
export const ATTR_REACHABLE = 58

export function divideInitAttrs(
  rng: Rng,
  origin: Origin | undefined,
  traits: Trait[],
  flaw: Flaw | undefined,
): Record<AttrKey, number> {
  const attrs = Object.fromEntries(ATTR_KEYS.map((k) => [k, BASE])) as Record<AttrKey, number>

  // 出身基线偏移
  for (const [k, v] of Object.entries(origin?.attr_mods ?? {})) {
    attrs[k as AttrKey] += v as number
  }

  // 天赋与缺陷的效果里，属性类的直接落库；其余由 engine 处理
  const all = [...traits.flatMap((t) => t.effects), ...(flaw?.effects ?? [])]
  for (const e of all) {
    if (e.type === 'add_attr') attrs[e.key] += e.delta
  }

  // 小幅随机浮动，让同一套配置也不完全一样
  for (const k of ATTR_KEYS) {
    attrs[k] += rng.int(-3, 3)
  }

  for (const k of ATTR_KEYS) {
    attrs[k] = Math.max(5, Math.min(100, attrs[k]))
  }
  return attrs
}

/** 供给 content-lint：检查一套配置是否超预算 */
export function attrBudgetOf(origin: Origin | undefined, traits: Trait[], flaw: Flaw | undefined): number {
  let sum = 0
  const add = (n: number) => {
    sum += n
  }
  for (const v of Object.values(origin?.attr_mods ?? {})) add(Math.abs(v as number))
  for (const e of traits.flatMap((t) => t.effects)) {
    if (e.type === 'add_attr') add(Math.abs(e.delta))
  }
  for (const e of flaw?.effects ?? []) {
    if (e.type === 'add_attr') add(Math.abs(e.delta))
  }
  return sum
}

/** 随机抽一套推荐配置（"一键随机"用，保证 30 秒内开局） */
export interface RolledGenesis {
  originId: string
  traitIds: string[]
  flawId?: string
}

export function rollGenesis(
  rng: Rng,
  origins: Origin[],
  traits: Trait[],
  flaws: Flaw[],
  packId: string,
): RolledGenesis {
  void packId
  const origin = rng.pick(origins)

  // 先抽一个缺陷（有补偿），再抽 3 个天赋，避开互斥
  const flaw = flaws.length > 0 ? rng.pick(flaws) : undefined

  const pool = traits.slice()
  const picked: Trait[] = []
  while (picked.length < 3 && pool.length > 0) {
    const t = rng.pick(pool)
    pool.splice(pool.indexOf(t), 1)
    if (t.excludes?.some((x) => picked.some((p) => p.id === x || p.category === x))) continue
    picked.push(t)
  }

  return {
    originId: origin?.id ?? origins[0]!.id,
    traitIds: picked.map((t) => t.id),
    flawId: flaw?.id,
  }
}
