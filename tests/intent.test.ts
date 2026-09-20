import { describe, expect, it } from 'vitest'
import { groundTarget, resolveFreeAction, INTENT_WHITELIST } from '../src/core/intent'
import { Rng } from '../src/core/rng'
import type { GameState, Item, NodePresentation } from '../src/core/types'

const item = (id: string, name: string, affordance: string[]): Item => ({
  id, name, quality: '灵品', affixes: [], affordance,
})

function mkState(over: Partial<GameState> = {}): GameState {
  return {
    seed: 't', node_index: 3, pack_id: 'mortal', realm_idx: 2, minor_idx: 0, power_index: 60,
    attrs: { root: 50, wits: 60, temper: 50, luck: 50, insight: 55, charm: 45 },
    vars: { currency: 50, power: 200, rare_mat: 0, favor: 0, debt: 0, exposure: 0,
            corruption: 0, karma: 0, hp: 10, lifespan: 0 },
    flags: {}, items: [item('it1', '青冥瓶', ['镇魂', '聚运'])],
    relations: [], learned_rules: [], titles: [], codex: [], faction_tier: {},
    history: [], queue: [], recent_motifs: [], recent_tags: [], recent_narrative: [],
    destiny_children: [], ending_threads: [], completed_scenarios: [], fired_events: [],
    status: 'alive', total_nodes: 24, age: 30,
    ...over,
  } as unknown as GameState
}

const loosePres = (opts: NodePresentation['options']): NodePresentation =>
  ({ node_index: 3, kind: 'loose', event_id: 'e1', title: '', lines: [], mood: '', options: opts })

const scenPres = (trials: NodePresentation['trials']): NodePresentation =>
  ({ node_index: 3, kind: 'scenario', event_id: 's1', title: '', lines: [], mood: '',
     options: [], trials })

describe('自由输入：落地校验（安全阀）', () => {
  it('提到的物品在行囊里 → 能落地', () => {
    const g = groundTarget('青冥瓶', mkState())
    expect(g?.kind).toBe('item')
  })

  it('名字只要包含得上就认（玩家不会一字不差）', () => {
    expect(groundTarget('青冥', mkState())?.kind).toBe('item')
    expect(groundTarget('那个瓶子', mkState())?.kind).not.toBe('item')
  })

  it('**提到的物品不在行囊里 → 落不了地**', () => {
    expect(groundTarget('掌天瓶', mkState())).toBeNull()
    expect(groundTarget('异火', mkState())).toBeNull()
  })

  it('提到没有的东西不会被当成收益 —— 给的是 grounded 而非 novel', () => {
    const r = resolveFreeAction(
      { intent: 'greedy', target: '异火', confidence: 0.95 },
      { state: mkState(), pres: loosePres([]), rng: new Rng('x') },
    )
    expect(r.kind).toBe('grounded')
    if (r.kind === 'grounded') expect(r.reason).toContain('异火')
  })

  it('习得的跨体系规则也能落地', () => {
    const s = mkState({
      learned_rules: [{ pack: 'mystery', ref: 'rule_x', name: '拟身法' }],
    })
    const g = groundTarget('拟身法', s)
    expect(g?.kind).toBe('rule')
  })
})

describe('自由输入：映射', () => {
  it('意图对得上既有选项且把握够高 → 走原规则', () => {
    const opts = [
      { id: 'a', text: '抢', intent: 'greedy' as const, risk_tier: '险' as const, odds_hint: '未卜' },
      { id: 'b', text: '退', intent: 'flee' as const, risk_tier: '稳' as const, odds_hint: '十拿九稳' },
    ]
    const r = resolveFreeAction(
      { intent: 'flee', confidence: 0.9 },
      { state: mkState(), pres: loosePres(opts), rng: new Rng('x') },
    )
    expect(r.kind).toBe('mapped')
    if (r.kind === 'mapped') expect(r.option.intent).toBe('flee')
  })

  it('把握不够高就不擅自替玩家选 —— 宁可开新路', () => {
    const opts = [
      { id: 'a', text: '抢', intent: 'greedy' as const, risk_tier: '险' as const, odds_hint: '未卜' },
    ]
    const r = resolveFreeAction(
      { intent: 'greedy', confidence: 0.2 },
      { state: mkState(), pres: loosePres(opts), rng: new Rng('x') },
    )
    expect(r.kind).toBe('novel')
  })

  it('剧本里提到行囊中的物事 → 落到「以物试之」', () => {
    const r = resolveFreeAction(
      { intent: 'scheme', target: '青冥瓶', confidence: 0.8 },
      {
        state: mkState(),
        pres: scenPres([{ kind: 'item', ref: 'it1', name: '青冥瓶', affordance: ['镇魂'] }]),
        rng: new Rng('x'),
      },
    )
    expect(r.kind).toBe('trial')
  })

  it('意图不在白名单 → 拒绝', () => {
    const r = resolveFreeAction(
      { intent: 'teleport' as never, confidence: 0.9 },
      { state: mkState(), pres: loosePres([]), rng: new Rng('x') },
    )
    expect(r.kind).toBe('refused')
  })
})

describe('自由输入：跨体系融合', () => {
  it('拿甲体系的法门去用 → 判为融合尝试', () => {
    const s = mkState({ pack_id: 'mortal', learned_rules: [{ pack: 'mystery', ref: 'r', name: '拟身法' }] })
    const r = resolveFreeAction(
      { intent: 'scheme', target: '拟身法', confidence: 0.6 },
      { state: s, pres: loosePres([]), rng: new Rng('x') },
    )
    expect(r.kind).toBe('novel')
    if (r.kind === 'novel') expect(r.fuse).toBe(true)
  })

  it('用本体系的法门不算融合', () => {
    const s = mkState({ pack_id: 'mortal', learned_rules: [{ pack: 'mortal', ref: 'r', name: '演天诀' }] })
    const r = resolveFreeAction(
      { intent: 'study', target: '演天诀', confidence: 0.6 },
      { state: s, pres: loosePres([]), rng: new Rng('x') },
    )
    if (r.kind === 'novel') expect(r.fuse).toBe(false)
  })

  it('空口白话（没提到任何身上之物）成功率被压低', () => {
    let novels = 0
    let crits = 0
    for (let i = 0; i < 400; i++) {
      const r = resolveFreeAction(
        { intent: 'greedy', approach: '我凭空造出一把剑', confidence: 1 },
        { state: mkState({ items: [] }), pres: loosePres([]), rng: new Rng(`n${i}`) },
      )
      if (r.kind === 'novel') { novels++; if (r.band === 'crit') crits++ }
    }
    expect(novels).toBeGreaterThan(300)
    // 无凭无据的大成功应当罕见
    expect(crits / novels).toBeLessThan(0.2)
  })
})

describe('意图白名单', () => {
  it('覆盖全部既有 intent', () => {
    expect(INTENT_WHITELIST.length).toBe(8)
  })
})
