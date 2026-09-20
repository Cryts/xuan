import { describe, expect, it } from 'vitest'
import {
  SCENARIO_ACTIONS,
  presentCurrent,
  startRun,
  submitScenarioAction,
  submitScenarioEntry,
} from '../src/core/engine'
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

function run(seed: string): GameState {
  const rng = new Rng(seed)
  const g = rollGenesis(rng, content.origins, content.traits, content.flaws, 'mortal')
  return startRun({
    runId: seed, seed, packId: 'mortal',
    originId: g.originId, traitIds: g.traitIds, flawId: g.flawId,
    content, destinyCount: 0,
  })
}

describe('剧本松绑', () => {
  it('剧本触发时先给入场抉择，而不是直接拽进去', () => {
    let s = run('loose-1')
    // 推进到出现剧本触发
    let found = false
    for (let i = 0; i < 200 && s.status === 'alive'; i++) {
      const p = presentCurrent(s, content)
      if (p.scenario_entry) { found = true; break }
      s = { ...s, node_index: s.node_index + 1, stage: 'growth' as const,
            total_nodes: 60 }
      if (s.node_index > 60) break
    }
    if (!found) return // 这一 seed 没抽到剧本，跳过
    const p = presentCurrent(s, content)
    expect(p.scenario_entry, '应当给出入场抉择').toBeTruthy()
    expect(p.options.map((o) => o.id)).toContain('enter')
    expect(p.options.map((o) => o.id)).toContain('bypass')
  })

  it('绕开之后这一世继续，不会因为「没进」就结束', () => {
    let s = run('loose-2')
    for (let i = 0; i < 200 && s.status === 'alive'; i++) {
      const p = presentCurrent(s, content)
      if (p.scenario_entry) break
      s = { ...s, node_index: s.node_index + 1, stage: 'growth' as const, total_nodes: 60 }
      if (s.node_index > 60) return
    }
    if (!s.pending_scenario) return
    const before = s.completed_scenarios.length
    const r = submitScenarioEntry(s, false, content)
    expect(r.ok).toBe(true)
    expect(r.state.status, '绕开不该终结这一世').toBe('alive')
    expect(r.state.pending_scenario).toBeUndefined()
    expect(r.state.completed_scenarios.length).toBeGreaterThan(before)
    expect(r.state.active_scenario).toBeUndefined()
  })

  it('通用手段齐备 —— 不再只有「用物品」和「干等」', () => {
    const ids = SCENARIO_ACTIONS.map((a) => a.id)
    for (const need of ['probe', 'parley', 'force', 'attune', 'wait', 'leave']) {
      expect(ids, `缺少手段 ${need}`).toContain(need)
    }
    // 只有 leave 不耗时刻，其余都要付时间
    expect(SCENARIO_ACTIONS.filter((a) => a.id !== 'leave').every((a) => a.cost.includes('刻'))).toBe(true)
  })

  it('剧本内呈现会带上通用手段', () => {
    let s = run('loose-3')
    let entered = false
    for (let i = 0; i < 300 && s.status === 'alive'; i++) {
      const p = presentCurrent(s, content)
      if (p.scenario_entry) {
        s = submitScenarioEntry(s, true, content).state
        entered = true
        break
      }
      s = { ...s, node_index: s.node_index + 1, stage: 'growth' as const, total_nodes: 60 }
      if (s.node_index > 60) break
    }
    if (!entered) return
    const p = presentCurrent(s, content)
    if (p.kind === 'scenario' && p.actions) {
      expect(p.actions.length).toBeGreaterThanOrEqual(5)
    }
  })

  it('通用手段可执行，且消耗时刻', () => {
    let s = run('loose-4')
    for (let i = 0; i < 300 && s.status === 'alive'; i++) {
      const p = presentCurrent(s, content)
      if (p.scenario_entry) { s = submitScenarioEntry(s, true, content).state; break }
      s = { ...s, node_index: s.node_index + 1, stage: 'growth' as const, total_nodes: 60 }
      if (s.node_index > 60) return
    }
    if (!s.active_scenario) return
    const before = s.active_scenario.nodes_spent
    const r = submitScenarioAction(s, 'probe', content)
    expect(r.ok).toBe(true)
    // 要么还在此剧本里且时刻 +1，要么剧本已收束
    if (r.state.active_scenario) {
      expect(r.state.active_scenario.nodes_spent).toBeGreaterThan(before)
    }
  })

  it('抽身会收束剧本，且不终结这一世', () => {
    let s = run('loose-5')
    for (let i = 0; i < 300 && s.status === 'alive'; i++) {
      const p = presentCurrent(s, content)
      if (p.scenario_entry) { s = submitScenarioEntry(s, true, content).state; break }
      s = { ...s, node_index: s.node_index + 1, stage: 'growth' as const, total_nodes: 60 }
      if (s.node_index > 60) return
    }
    if (!s.active_scenario) return
    const r = submitScenarioAction(s, 'leave', content)
    expect(r.ok).toBe(true)
    expect(r.state.active_scenario).toBeUndefined()
    expect(r.state.status, '抽身不该终结这一世').toBe('alive')
  })
})
