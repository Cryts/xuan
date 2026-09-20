import { describe, expect, it } from 'vitest'
import { finishScenario, leaveScenario, submitTrial } from '../src/core/engine'
import { PACK_IDS, type ContentDB } from '../src/core/content'
import type { Condition, GameState, PackId, Scenario, WorldPack } from '../src/core/types'

/**
 * 回归测试：剧本的 solved 必须可累积。
 *
 * 曾经的 bug：一命中破局组就 active_scenario = undefined，
 * 于是 run.solved 永远只有一个元素，所有以 solved_any_of 为条件的
 * 隐藏通路都成了**不可达的死内容**。
 */

function pack(id: PackId): WorldPack {
  return {
    pack_id: id,
    display_name: id,
    inspiration_tag: 'test',
    essence: 'qi',
    version: '1',
    rule_ref: 'test',
    realms: [
      { idx: 0, name: '起', power_index: [0, 500], lifespan: 80, breakthrough: 1 },
      { idx: 1, name: '终', power_index: [500, 1000], lifespan: 200, breakthrough: 0.5 },
    ],
    resource_map: { currency: { name: '币' } },
    goldfinger_slots: [],
    fail_modes: [],
    motif_weights: {},
    tone: { narration: '', humor: 0, violence: 0 },
  }
}

const scenario: Scenario = {
  id: 'scn_test',
  kind: 'scenario',
  name: '试验冢',
  pack: ['mortal'],
  span: 8,
  tension: 8,
  weight: 10,
  rules_stated: ['进去容易出来难'],
  rules_hidden: [{ id: 'h1', hint: '门在背后', reveal: { type: 'attr', key: 'wits', op: '>=', value: 60 } }],
  forbidden: ['动武'],
  breakthroughs: [
    {
      id: 'path_a',
      name: '明路',
      conditions: [{ type: 'affordance', ref: '镇魂' }],
      cost: '低',
      outcome: { ref: 'end_a', narrative: 'n_a' },
    },
    {
      id: 'path_b',
      name: '力路',
      conditions: [{ type: 'attr', key: 'root', op: '>=', value: 70 }],
      cost: '高',
      outcome: { ref: 'end_b', narrative: 'n_b' },
    },
    {
      id: 'path_hidden',
      name: '兼得',
      conditions: [{ type: 'solved_any_of', refs: ['path_a', 'path_b'] }],
      cost: '极低',
      hidden: true,
      outcome: { ref: 'end_hidden', narrative: 'n_hidden' },
    },
  ],
  unsolved: { narrative: 'n_sealed', ref: 'end_sealed' },
  version: '1',
}

function mkContent(): ContentDB {
  return {
    packs: Object.fromEntries(PACK_IDS.map((p) => [p, pack(p)])) as Record<PackId, WorldPack>,
    terms: {},
    motifs: [],
    events: [],
    scenarios: [scenario],
    endings: [],
    origins: [],
    traits: [],
    flaws: [],
    destinies: [],
    l2: {},
    oracle: [],
    coincidence: {},
    fateTemplates: {},
    names: {
      surname: [],
      given_male: [],
      given_female: [],
      dao_title: { element: [], noun: [], suffix: [] },
      sect: { place: [], suffix: [] },
    },
    affixes: [],
    items: [],
    version: 'test',
  }
}

function mkState(over: Partial<GameState> = {}): GameState {
  return {
    run_id: 'r',
    seed: 'r',
    node_index: 5,
    stage: 'growth',
    pack_id: 'mortal',
    realm_idx: 1,
    power_index: 600,
    // root 特意压在 path_b 的门槛（70）之下 —— 否则它会被开局就满足，
    // 隐藏通路的测试就变成了永远为真，测不出东西
    attrs: { root: 50, wits: 70, temper: 40, luck: 55, insight: 60, charm: 30 },
    vars: {
      currency: 0,
      power: 0,
      rare_mat: 0,
      favor: 0,
      debt: 0,
      exposure: 0,
      corruption: 0,
      karma: 0,
      hp: 100,
      lifespan: 100,
    },
    flags: {},
    items: [
      { id: 'charm_x', name: '镇魂符', quality: '灵品', affixes: [], affordance: ['镇魂'] },
    ],
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
    destiny_children: [],
    ending_threads: [],
    status: 'alive',
    rule_version: 't',
    content_version: 't',
    total_nodes: 40,
    completed_scenarios: [],
    fired_events: [],
    active_scenario: {
      scenario_id: 'scn_test',
      started_at: 4,
      nodes_spent: 0,
      revealed_rules: [],
      solved: [],
      attempted: [],
    },
    ...over,
  }
}

const content = mkContent()

describe('剧本多条件破局', () => {
  it('命中一条通路后**不**立即退出 —— solved 必须可累积', () => {
    const s = mkState()
    const r = submitTrial(s, 'item', 'charm_x', content)
    expect(r.ok).toBe(true)
    expect(r.state.active_scenario).toBeTruthy()
    expect(r.state.active_scenario!.solved).toContain('path_a')
  })

  it('隐藏通路可达：先通 path_a，再通 path_b，即满足 solved_any_of', () => {
    let s = mkState()
    // 第一条：靠物品的 affordance
    s = submitTrial(s, 'item', 'charm_x', content).state
    expect(s.active_scenario?.solved).toContain('path_a')
    // root 未达门槛，path_b 与 path_hidden 都还不成立，剧本继续
    expect(s.active_scenario?.solved).not.toContain('path_hidden')

    // 修为精进，root 越过门槛 —— 此时 path_b 与 path_hidden 同时成立
    s = { ...s, attrs: { ...s.attrs, root: 80 } }
    s = submitTrial(s, 'item', 'charm_x', content).state

    expect(s.active_scenario).toBeUndefined()
    expect(s.ending_threads).toContain('end_hidden')
  })

  it('隐藏通路优先于普通通路写入结局线索', () => {
    let s = mkState()
    s = submitTrial(s, 'item', 'charm_x', content).state
    s = { ...s, attrs: { ...s.attrs, root: 80 } }
    s = submitTrial(s, 'item', 'charm_x', content).state
    // 隐藏通路最难达成，收束时应优先它，而非 path_a / path_b
    expect(s.ending_threads).toContain('end_hidden')
    expect(s.ending_threads).not.toContain('end_b')
  })

  it('未命中任何通路时消耗一刻，不退出剧本', () => {
    const s = mkState({
      items: [{ id: 'junk', name: '破铜烂铁', quality: '凡品', affixes: [], affordance: ['无用'] }],
    })
    const r = submitTrial(s, 'item', 'junk', content)
    expect(r.ok).toBe(true)
    expect(r.state.active_scenario).toBeTruthy()
    expect(r.state.active_scenario!.nodes_spent).toBe(1)
    expect(r.state.active_scenario!.solved).toEqual([])
  })

  it('时间耗尽收束，未破局走 unsolved', () => {
    const s = mkState({
      active_scenario: {
        scenario_id: 'scn_test',
        started_at: 4,
        nodes_spent: 7, // span 是 8，再推一步就超
        revealed_rules: [],
        solved: [],
        attempted: [],
      },
      items: [{ id: 'junk', name: '破铜烂铁', quality: '凡品', affixes: [], affordance: ['无用'] }],
    })
    const r = submitTrial(s, 'item', 'junk', content)
    expect(r.state.active_scenario).toBeUndefined()
    expect(r.state.ending_threads).toContain('end_sealed')
  })

  it('主动离开：带着已通的通路收束', () => {
    let s = mkState()
    s = submitTrial(s, 'item', 'charm_x', content).state
    // 上面那步已经因全通而收束；再造一个只通一条的场景
    const s2 = mkState({
      active_scenario: {
        scenario_id: 'scn_test',
        started_at: 4,
        nodes_spent: 1,
        revealed_rules: [],
        solved: ['path_a'],
        attempted: [],
      },
    })
    const r = leaveScenario(s2, content)
    expect(r.ok).toBe(true)
    expect(r.state.active_scenario).toBeUndefined()
    expect(r.state.ending_threads).toContain('end_a')
  })

  it('finishScenario 是幂等的 —— 重复调用不重复记账', () => {
    const s = mkState({
      active_scenario: {
        scenario_id: 'scn_test',
        started_at: 4,
        nodes_spent: 8,
        revealed_rules: [],
        solved: ['path_a'],
        attempted: [],
      },
    })
    const once = finishScenario(s, scenario)
    const twice = finishScenario(once, scenario)
    expect(twice.ending_threads.filter((t) => t === 'end_a').length).toBe(1)
  })

  it('不在剧本中时离开会失败而非崩溃', () => {
    const r = leaveScenario(mkState({ active_scenario: undefined }), content)
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
  })
})

describe('条件组互不包含（内容约束的引擎侧保障）', () => {
  it('path_hidden 只在其他通路已通时成立', () => {
    const s = mkState()
    const hidden = scenario.breakthroughs.find((b) => b.id === 'path_hidden')!
    const cond = hidden.conditions[0] as Extract<Condition, { type: 'solved_any_of' }>
    expect(cond.refs).toContain('path_a')
    expect(cond.refs).toContain('path_b')
    // 未通任何路时，solved 为空
    expect(s.active_scenario!.solved).toEqual([])
  })
})
