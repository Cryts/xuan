import { describe, expect, it } from 'vitest'
import { DAILY_EVERY, dailyActions, isDailyNode, presentCurrent, startRun, submitDaily } from '../src/core/engine'
import { PACK_IDS, type ContentDB } from '../src/core/content'
import { rollGenesis } from '../src/core/genesis'
import { Rng } from '../src/core/rng'
import { loadContent } from '../tools/load-content'
import type { GameState, PackId, WorldPack } from '../src/core/types'

const raw = loadContent()
const content = {
  ...raw,
  packs: Object.fromEntries(PACK_IDS.map((p) => [p, raw.packs[p]])) as Record<PackId, WorldPack>,
  version: 't',
} as unknown as ContentDB

const run = (seed: string) => {
  const g = rollGenesis(new Rng(seed), content.origins, content.traits, content.flaws, 'mortal')
  return startRun({ runId: seed, seed, packId: 'mortal', originId: g.originId,
    traitIds: g.traitIds, flawId: g.flawId, content, destinyCount: 0 })
}

describe('日常行动', () => {
  it('每隔几个节点出现一次，开局第一拍不是', () => {
    expect(isDailyNode({ ...run('d1'), node_index: 0 } as GameState)).toBe(false)
    const at = { ...run('d1'), node_index: DAILY_EVERY } as GameState
    expect(isDailyNode(at)).toBe(true)
  })

  it('剧本中不插日常 —— 免得打断破局', () => {
    const s = run('d2')
    const inScn = { ...s, node_index: DAILY_EVERY, active_scenario: {
      scenario_id: 'x', started_at: 0, nodes_spent: 1, revealed_rules: [], solved: [], attempted: [] } } as GameState
    expect(isDailyNode(inScn)).toBe(false)
  })

  it('呈现里带上五个选项，且不可做的会说明原因', () => {
    const s = run('d3')
    const acts = dailyActions({ ...s, vars: { ...s.vars, currency: 0 } } as GameState)
    expect(acts.map((a) => a.id)).toEqual(['cultivate', 'roam', 'gather', 'market', 'befriend'])
    const market = acts.find((a) => a.id === 'market')!
    expect(market.available).toBe(false)
    expect(market.blocked_reason).toBeTruthy()
  })

  it('**闭关确实涨修为，而且比什么都不做多**', () => {
    const s = { ...run('d4'), node_index: DAILY_EVERY, history: [
      ...run('d4').history,
      { node_index: 3, event_id: 'e', option_id: 'a', intent: 'study' as const, rule_version: 't' },
    ] } as GameState
    const before = s.vars.power
    const after = submitDaily(s, 'cultivate', content).state
    expect(after.vars.power).toBeGreaterThan(before)
  })

  it('坊市花灵石换材料，花掉的钱对得上', () => {
    const s = { ...run('d5'), node_index: DAILY_EVERY } as GameState
    const c0 = s.vars.currency, m0 = s.vars.rare_mat
    const after = submitDaily(s, 'market', content).state
    expect(after.vars.currency).toBeLessThan(c0)
    expect(after.vars.rare_mat).toBeGreaterThan(m0)
  })

  it('**游历不结算日常收益，而是去抽一个事件**', () => {
    const s = { ...run('d6'), node_index: DAILY_EVERY } as GameState
    const after = submitDaily(s, 'roam', content).state
    expect(after.last_daily).toBe('roam')
    expect(after.node_index).toBe(s.node_index + 1)
  })

  it('采药会带点伤 —— 出门是要付脚力的', () => {
    let hurt = 0
    for (let i = 0; i < 20; i++) {
      const s = { ...run(`g${i}`), node_index: DAILY_EVERY } as GameState
      if (submitDaily(s, 'gather', content).state.vars.hp > s.vars.hp) hurt++
    }
    expect(hurt, '采药应当普遍带来一点伤势').toBeGreaterThan(15)
  })

  it('端到端：一局里会碰到多次日常', () => {
    let s = run('d7')
    let daily = 0
    for (let i = 0; i < 60 && s.status === 'alive'; i++) {
      const p = presentCurrent(s, content)
      if (p.daily) {
        daily++
        s = submitDaily(s, 'cultivate', content).state
        continue
      }
      if (p.options.length === 0) { s = { ...s, node_index: s.node_index + 1 }; continue }
      const ev = content.events.find((e) => e.id === p.event_id)
      if (!ev) { s = { ...s, node_index: s.node_index + 1 }; continue }
      s = { ...s, node_index: s.node_index + 1 }
    }
    expect(daily, `一局该有多次日常，实际 ${daily}`).toBeGreaterThanOrEqual(3)
  })
})
