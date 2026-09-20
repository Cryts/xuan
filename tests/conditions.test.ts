import { describe, expect, it } from 'vitest'
import { countAffordance, describe as describeCond, evaluate, evaluateAll } from '../src/core/conditions'
import type { Condition, GameState, Item } from '../src/core/types'

function mkState(over: Partial<GameState> = {}): GameState {
  return {
    run_id: 't',
    seed: 't',
    node_index: 5,
    stage: 'growth',
    pack_id: 'mortal',
    realm_idx: 3,
    power_index: 120,
    attrs: { root: 50, wits: 70, temper: 40, luck: 55, insight: 60, charm: 30 },
    vars: {
      currency: 100,
      power: 200,
      rare_mat: 0,
      favor: 0,
      debt: 3,
      exposure: 5,
      corruption: 10,
      karma: -5,
      hp: 80,
      lifespan: 200,
    },
    flags: { bottle_owned: true },
    items: [],
    relations: [],
    learned_rules: [],
    titles: [],
    codex: [],
    faction_tier: { cloud_sect: 2 },
    history: [],
    queue: [],
    recent_motifs: [],
    recent_tags: [],
    recent_narrative: [],
    destiny_children: [],
    ending_threads: [],
    status: 'alive',
    rule_version: '2026-09',
    content_version: '1',
    total_nodes: 24,
    completed_scenarios: [],
    fired_events: [],
    ...over,
  }
}

const item = (id: string, affordance: string[]): Item => ({
  id,
  name: id,
  quality: '灵品',
  affixes: [],
  affordance,
})

describe('条件求值器 —— 自由度支柱 #4 的核心', () => {
  it('attr 六种比较', () => {
    const s = mkState()
    const cases: [Condition, boolean][] = [
      [{ type: 'attr', key: 'wits', op: '>=', value: 70 }, true],
      [{ type: 'attr', key: 'wits', op: '>', value: 70 }, false],
      [{ type: 'attr', key: 'charm', op: '<=', value: 30 }, true],
      [{ type: 'attr', key: 'charm', op: '<', value: 30 }, false],
      [{ type: 'attr', key: 'root', op: '==', value: 50 }, true],
      [{ type: 'attr', key: 'root', op: '!=', value: 50 }, false],
    ]
    for (const [c, want] of cases) expect(evaluate(c, { state: s })).toBe(want)
  })

  it('var 长期变量', () => {
    const s = mkState()
    expect(evaluate({ type: 'var', key: 'debt', op: '>=', value: 3 }, { state: s })).toBe(true)
    expect(evaluate({ type: 'var', key: 'karma', op: '<', value: 0 }, { state: s })).toBe(true)
  })

  it('flag 布尔标记', () => {
    const s = mkState()
    expect(evaluate({ type: 'flag', ref: 'bottle_owned' }, { state: s })).toBe(true)
    expect(evaluate({ type: 'flag', ref: 'nope' }, { state: s })).toBe(false)
  })

  it('faction_tier 阵营声望', () => {
    const s = mkState()
    expect(evaluate({ type: 'faction_tier', ref: 'cloud_sect', op: '>=', value: 2 }, { state: s })).toBe(true)
    expect(evaluate({ type: 'faction_tier', ref: 'unknown', op: '>=', value: 1 }, { state: s })).toBe(false)
  })

  it('relation 关系存在性', () => {
    const s = mkState({ relations: [{ npc_id: 'a', kind: '道侣', value: 10 }] })
    expect(evaluate({ type: 'relation', kind: '道侣', exists: true }, { state: s })).toBe(true)
    expect(evaluate({ type: 'relation', kind: '仇家', exists: true }, { state: s })).toBe(false)
    expect(evaluate({ type: 'relation', kind: '仇家', exists: false }, { state: s })).toBe(true)
  })

  it('node_count 时间压力', () => {
    const s = mkState()
    expect(
      evaluate({ type: 'node_count', op: '>=', value: 4 }, { state: s, scenarioNodesSpent: 5 }),
    ).toBe(true)
    expect(
      evaluate({ type: 'node_count', op: '>=', value: 4 }, { state: s, scenarioNodesSpent: 3 }),
    ).toBe(false)
  })
})

describe('affordance —— 涌现的关键', () => {
  it('只认功能标签，不认具体物品', () => {
    const s = mkState({
      items: [item('sword_a', ['破甲']), item('talisman_x', ['镇魂']), item('lamp', ['照明'])],
    })
    expect(evaluate({ type: 'affordance', ref: '镇魂' }, { state: s })).toBe(true)
    expect(evaluate({ type: 'affordance', ref: '破甲' }, { state: s })).toBe(true)
    expect(evaluate({ type: 'affordance', ref: '隔水' }, { state: s })).toBe(false)
  })

  it('任何带该标签的物品都是合法解法 —— 不需要预设', () => {
    const s = mkState({ items: [item('unknown_future_item', ['镇魂'])] })
    expect(evaluate({ type: 'affordance', ref: '镇魂' }, { state: s })).toBe(true)
  })

  it('count 可以要求多件', () => {
    const s = mkState({ items: [item('a', ['破甲']), item('b', ['破甲'])] })
    expect(evaluate({ type: 'affordance', ref: '破甲', count: 2 }, { state: s })).toBe(true)
    expect(evaluate({ type: 'affordance', ref: '破甲', count: 3 }, { state: s })).toBe(false)
    expect(countAffordance(s, '破甲')).toBe(2)
  })
})

describe('learned_rule —— 跨界习得直接打开新通路（与 SPEC 6.5 咬合）', () => {
  it('未习得时不成立', () => {
    const s = mkState()
    expect(
      evaluate({ type: 'learned_rule', pack: 'mystery', ref: 'rule_playacting' }, { state: s }),
    ).toBe(false)
  })

  it('习得后成立 —— 论道的回报', () => {
    const s = mkState({
      learned_rules: [{ pack: 'mystery', ref: 'rule_playacting', name: '拟身法' }],
    })
    expect(
      evaluate({ type: 'learned_rule', pack: 'mystery', ref: 'rule_playacting' }, { state: s }),
    ).toBe(true)
    // 不同体系的规则不互相顶替
    expect(
      evaluate({ type: 'learned_rule', pack: 'physique', ref: 'rule_playacting' }, { state: s }),
    ).toBe(false)
  })
})

describe('逻辑组合 —— 组合爆炸即自由度', () => {
  it('any 任一成立', () => {
    const s = mkState()
    const c: Condition = {
      type: 'any',
      of: [
        { type: 'attr', key: 'root', op: '>=', value: 999 },
        { type: 'attr', key: 'wits', op: '>=', value: 70 },
      ],
    }
    expect(evaluate(c, { state: s })).toBe(true)
  })

  it('all 全部成立', () => {
    const s = mkState()
    const c: Condition = {
      type: 'all',
      of: [
        { type: 'attr', key: 'wits', op: '>=', value: 70 },
        { type: 'attr', key: 'root', op: '>=', value: 999 },
      ],
    }
    expect(evaluate(c, { state: s })).toBe(false)
  })

  it('not 取反', () => {
    const s = mkState()
    expect(evaluate({ type: 'not', of: { type: 'flag', ref: 'bottle_owned' } }, { state: s })).toBe(false)
  })

  it('三层嵌套可求值', () => {
    const s = mkState()
    const c: Condition = {
      type: 'any',
      of: [
        {
          type: 'all',
          of: [
            { type: 'attr', key: 'wits', op: '>=', value: 70 },
            { type: 'not', of: { type: 'flag', ref: 'missing' } },
          ],
        },
        { type: 'flag', ref: 'also_missing' },
      ],
    }
    expect(evaluate(c, { state: s })).toBe(true)
  })
})

describe('solved_any_of —— 条件组之间可组合出隐藏通路', () => {
  it('未通任何路时不成立', () => {
    const s = mkState()
    expect(
      evaluate({ type: 'solved_any_of', refs: ['solve_light', 'solve_bargain'] }, { state: s, solvedInScenario: [] }),
    ).toBe(false)
  })

  it('通了其中一条即成立', () => {
    const s = mkState()
    expect(
      evaluate(
        { type: 'solved_any_of', refs: ['solve_light', 'solve_bargain'] },
        { state: s, solvedInScenario: ['solve_bargain'] },
      ),
    ).toBe(true)
  })
})

describe('known_rule —— 理解即钥匙', () => {
  it('已揭示的隐规则可作为破局条件', () => {
    const s = mkState()
    expect(evaluate({ type: 'known_rule', ref: 'rule_literal' }, { state: s, solvedInScenario: [] })).toBe(false)
    expect(
      evaluate({ type: 'known_rule', ref: 'rule_literal' }, { state: s, solvedInScenario: ['rule_literal'] }),
    ).toBe(true)
  })

  it('全局 flag 形式也可', () => {
    const s = mkState({ flags: { 'rule_known:rule_statue': true } })
    expect(evaluate({ type: 'known_rule', ref: 'rule_statue' }, { state: s })).toBe(true)
  })
})

describe('求值是纯函数 —— 回放的前提', () => {
  it('同一份 state 多次求值结果一致', () => {
    const s = mkState()
    const c: Condition = { type: 'attr', key: 'wits', op: '>=', value: 70 }
    const results = Array.from({ length: 10 }, () => evaluate(c, { state: s }))
    expect(new Set(results).size).toBe(1)
  })

  it('求值不修改 state', () => {
    const s = mkState()
    const snapshot = JSON.stringify(s)
    evaluateAll(
      [
        { type: 'attr', key: 'wits', op: '>=', value: 70 },
        { type: 'flag', ref: 'bottle_owned' },
      ],
      { state: s },
    )
    expect(JSON.stringify(s)).toBe(snapshot)
  })
})

describe('条件描述（UI 显示"还差什么"）', () => {
  it('各类条件都能生成可读文本', () => {
    const conds: Condition[] = [
      { type: 'attr', key: 'wits', op: '>=', value: 70 },
      { type: 'var', key: 'debt', op: '>=', value: 3 },
      { type: 'item', ref: '青冥瓶', count: 2 },
      { type: 'affordance', ref: '镇魂' },
      { type: 'learned_rule', pack: 'mystery', ref: 'x' },
      { type: 'relation', kind: '道侣', exists: true },
      { type: 'any', of: [{ type: 'flag', ref: 'a' }, { type: 'flag', ref: 'b' }] },
      { type: 'not', of: { type: 'flag', ref: 'c' } },
    ]
    for (const c of conds) {
      const d = describeCond(c)
      expect(typeof d).toBe('string')
      expect(d.length).toBeGreaterThan(0)
    }
  })

  it('属性名走中文而非内部键', () => {
    expect(describeCond({ type: 'attr', key: 'wits', op: '>=', value: 70 })).toContain('悟性')
    expect(describeCond({ type: 'attr', key: 'wits', op: '>=', value: 70 })).not.toContain('wits')
  })
})
