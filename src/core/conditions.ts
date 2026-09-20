/**
 * 破局条件求值器 —— 自由度支柱 #4 的实现。见 SPEC 4.2。
 *
 * 设计要点：剧本不预设解法，只预设**破局条件组**。
 * 玩家用哪一组破局，决定走向哪个结局。设计师写条件，不写解法。
 *
 * 13 种条件类型 + any/all/not 任意嵌套 = 组合爆炸即自由度。
 * 其中 affordance / learned_rule / solved_any_of 三种是涌现的来源：
 *   - affordance   新物品只要带该标签，自动成为合法解法
 *   - learned_rule 跨界习得的规则直接打开新通路（与 6.5 咬合）
 *   - solved_any_of 条件组之间可以互相组合出隐藏通路
 */

import type {
  AttrKey,
  CompareOp,
  Condition,
  GameState,
  Item,
  PackId,
  VarKey,
} from './types'

export interface EvalContext {
  state: GameState
  /** 当前剧本已完成的条件组 id */
  solvedInScenario?: string[]
  /** 当前剧本已消耗的节点数 */
  scenarioNodesSpent?: number
}

function cmp(left: number, op: CompareOp, right: number): boolean {
  switch (op) {
    case '>=':
      return left >= right
    case '<=':
      return left <= right
    case '>':
      return left > right
    case '<':
      return left < right
    case '==':
      return left === right
    case '!=':
      return left !== right
  }
}

/** 汇总一件物品的全部功能标签（本体自带 + 词条派生）。由 content 层预计算后写入 item.affordance。 */
export function itemAffordances(item: Item): string[] {
  return item.affordance ?? []
}

export function countAffordance(state: GameState, ref: string): number {
  return (state.items ?? []).filter((it) => itemAffordances(it).includes(ref)).length
}

export function countAffix(state: GameState, ref: string): number {
  return (state.items ?? []).filter((it) => it.affixes.includes(ref)).length
}

export function hasRelation(state: GameState, kind: string): boolean {
  return (state.relations ?? []).some((r) => r.kind === kind && r.value > 0)
}

export function relationValue(state: GameState, kind: string): number {
  return (state.relations ?? []).filter((r) => r.kind === kind).reduce((a, r) => a + r.value, 0)
}

/**
 * 求值单个条件。
 * 注意：求值必须是**纯函数**——同一份存档同一节点，求值结果必须一致，否则回放会崩。
 */
export function evaluate(cond: Condition, ctx: EvalContext): boolean {
  const { state } = ctx

  // 存档可能来自旧版本、或由测试/工具构造，字段未必齐全。
  // 求值失败不该让整局崩掉 —— 缺字段一律按"无"处理。
  const items = state.items ?? []

  const learned = state.learned_rules ?? []
  const flags = state.flags ?? {}

  switch (cond.type) {
    case 'attr': {
      const v = state.attrs?.[cond.key as AttrKey] ?? 0
      return cmp(v, cond.op, cond.value)
    }
    case 'var': {
      const v = state.vars?.[cond.key as VarKey] ?? 0
      return cmp(v, cond.op, cond.value)
    }
    case 'item': {
      const n = items.filter((it) => it.id === cond.ref).length
      return n >= (cond.count ?? 1)
    }
    case 'affordance': {
      // 涌现关键：只认功能标签，不认具体物品
      return countAffordance(state, cond.ref) >= (cond.count ?? 1)
    }
    case 'affix_count':
      return countAffix(state, cond.ref) >= cond.count
    case 'known_rule':
      return (ctx.solvedInScenario ?? []).includes(cond.ref) ||
        flags[`rule_known:${cond.ref}`] === true
    case 'learned_rule':
      return learned.some(
        (r) => r.pack === (cond.pack as PackId) && r.ref === cond.ref,
      )
    case 'flag':
      return flags[cond.ref] === true
    case 'relation': {
      const exists = hasRelation(state, cond.kind)
      if (cond.exists === true) return exists
      if (cond.exists === false) return !exists
      if (cond.op !== undefined && cond.value !== undefined) {
        return cmp(relationValue(state, cond.kind), cond.op, cond.value)
      }
      return exists
    }
    case 'faction_tier':
      // 存档可能来自旧版本，字段缺失不该让整局崩掉
      return cmp(state.faction_tier?.[cond.ref] ?? 0, cond.op, cond.value)
    case 'solved_any_of':
      // 组合涌现：某几条通路完成后，可触发隐藏通路
      return cond.refs.some((r) => (ctx.solvedInScenario ?? []).includes(r))
    case 'node_count':
      return cmp(ctx.scenarioNodesSpent ?? 0, cond.op, cond.value)
    case 'realm_idx':
      return cmp(state.realm_idx, cond.op, cond.value)
    case 'pack':
      return state.pack_id === cond.ref
    case 'destiny_alive':
      return cmp(state.destiny_children.filter((d) => d.alive).length, cond.op, cond.value)
    case 'destiny_worn': {
      const alive = state.destiny_children.filter((d) => d.alive)
      if (alive.length === 0) return false
      // 取磨损最狠的那一位 —— 遭遇事件按"最有机会的那个"来判定
      const worst = Math.max(
        ...alive.map((d) => (d.destiny_max > 0 ? 1 - d.destiny_pool / d.destiny_max : 0)),
      )
      return cmp(worst, cond.op, cond.value)
    }
    case 'destiny_archetype':
      return state.destiny_children.some((d) => d.alive && d.archetype === cond.ref)
    case 'any':
      return cond.of.some((c) => evaluate(c, ctx))
    case 'all':
      return cond.of.every((c) => evaluate(c, ctx))
    case 'not':
      return !evaluate(cond.of, ctx)
  }
}

/** 全部满足才成立 */
export function evaluateAll(conds: Condition[], ctx: EvalContext): boolean {
  return conds.every((c) => evaluate(c, ctx))
}

/** 人类可读描述，供 UI 显示"你还差什么" */
export function describe(cond: Condition): string {
  const A: Record<string, string> = {
    root: '根骨',
    wits: '悟性',
    temper: '心性',
    luck: '气运',
    insight: '机敏',
    charm: '魅力',
    currency: '灵石',
    power: '修为',
    rare_mat: '材料',
    favor: '声望',
    debt: '因果',
    exposure: '暴露',
    corruption: '污染',
    karma: '功德',
    hp: '伤势',
    lifespan: '寿元',
  }
  switch (cond.type) {
    case 'attr':
      return `${A[cond.key] ?? cond.key} ${cond.op} ${cond.value}`
    case 'var':
      return `${A[cond.key] ?? cond.key} ${cond.op} ${cond.value}`
    case 'item':
      return `持有「${cond.ref}」${cond.count && cond.count > 1 ? `×${cond.count}` : ''}`
    case 'affordance':
      return `持有一件具「${cond.ref}」之能的物事`
    case 'affix_count':
      return `持有 ${cond.count} 件带「${cond.ref}」词条之物`
    case 'known_rule':
      return `勘破隐规则`
    case 'learned_rule':
      return `已习得「${cond.pack}」系法门`
    case 'flag':
      return `需有前因`
    case 'relation':
      if (cond.exists === true) return `身边有${cond.kind}`
      if (cond.exists === false) return `身边无${cond.kind}`
      return `${cond.kind} ${cond.op} ${cond.value}`
    case 'faction_tier':
      return `${cond.ref} 声望 ${cond.op} ${cond.value}`
    case 'solved_any_of':
      return `已通晓另一条路`
    case 'node_count':
      return `时刻 ${cond.op} ${cond.value}`
    case 'realm_idx':
      return `境界 ${cond.op} ${cond.value}`
    case 'pack':
      return `需出身「${cond.ref}」`
    case 'destiny_alive':
      return `天命未绝者 ${cond.op} ${cond.value} 人`
    case 'destiny_worn':
      return `气运已被磨去 ${(cond.value * 100).toFixed(0)}%`
    case 'destiny_archetype':
      return `遇到某类天命之人`
    case 'any':
      return `（${cond.of.map(describe).join(' 或 ')}）`
    case 'all':
      return cond.of.map(describe).join('、')
    case 'not':
      return `非（${describe(cond.of)}）`
  }
}

/** 条件组的人类可读摘要 */
export function describeAll(conds: Condition[]): string {
  return conds.map(describe).join(' ＋ ')
}
