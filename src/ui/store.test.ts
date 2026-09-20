/**
 * UI 状态机冒烟 —— 只管一件事：**不管内容库长什么样，界面都不许崩。**
 *
 * 内容 JSON 由其他 agent 并行生成、且随时在变；这里断言的都是与内容无关的
 * 不变量（能开局、能推进、能收尾），不锁具体条目数量。
 */

import { describe, expect, it } from 'vitest'
import { presentCurrent } from '@/core/engine'
import { PACK_IDS } from '@/core/content'
import type { PackId } from '@/core/types'
import {
  clearSave,
  initState,
  makeRunId,
  makeSeedString,
  readSave,
  reducer,
  writeSave,
  type AppState,
} from './store'

function begin(pack: PackId): AppState {
  let st = initState()
  st = reducer(st, { type: 'genesis/setPack', pack })
  return reducer(st, { type: 'genesis/begin', runId: makeRunId() })
}

/** 一路选第一项（剧本内则试第一件物事），直到终局或用尽步数 */
function play(steps: number, pack: PackId) {
  let st = begin(pack)
  for (let i = 0; i < steps; i++) {
    if (st.screen !== 'play') break
    const p = st.pres!
    if (p.kind === 'scenario') {
      const t = (p.trials ?? [])[0]
      st = t
        ? reducer(st, { type: 'play/trial', kind: t.kind, ref: t.ref })
        : reducer(st, { type: 'play/wait' })
      continue
    }
    const opt = p.options[0]
    expect(opt).toBeDefined()
    st = reducer(st, { type: 'play/option', optionId: opt!.id })
  }
  return st
}

describe('UI 状态机', () => {
  it('六个体系包都能开局，且不会卡死在半路', () => {
    for (const p of PACK_IDS) {
      const st = play(40, p)
      expect(['play', 'ending']).toContain(st.screen)
      expect(st.state!.pack_id).toBe(p)
      expect(st.state!.node_index).toBeGreaterThan(0)
    }
  })

  it('走到终局时有可展示的结局卷轴', () => {
    const st = play(60, 'mortal')
    if (st.screen === 'ending') {
      expect(st.state!.status).toBe('ended')
      expect(st.ending).not.toBeNull()
      expect(st.ending!.title.length).toBeGreaterThan(0)
      expect(st.ending!.lines.length).toBeGreaterThan(0)
      expect(st.ending!.stars).toBeGreaterThanOrEqual(1)
    }
  })

  it('剧本界面数据链完整：明/隐规则、禁制、破局组、可试之物', () => {
    const base = begin('mystery')
    const content = base.content
    if (content.scenarios.length === 0) return // 内容未就绪时跳过，不算失败
    const sc = content.scenarios[0]!
    const withRun = {
      ...base.state!,
      active_scenario: {
        scenario_id: sc.id,
        started_at: 0,
        nodes_spent: 0,
        revealed_rules: [],
        solved: [],
        attempted: [],
      },
    }
    let st: AppState = { ...base, state: withRun, pres: presentCurrent({ ...withRun }, content) }

    expect(st.pres!.kind).toBe('scenario')
    expect(st.pres!.scenario!.rules_stated.length).toBeGreaterThan(0)
    expect(st.pres!.scenario!.breakthroughs.length).toBeGreaterThan(0)

    // 「静观其变」必须能推进时刻，否则行囊空时玩家会卡死
    const before = st.state!.node_index
    st = reducer(st, { type: 'play/wait' })
    expect(st.state!.node_index).toBeGreaterThan(before)

    // 「试之」也要能走通（哪怕是空试）
    if (st.screen === 'play' && st.pres!.kind === 'scenario') {
      const ref = st.pres!.trials?.[0]?.ref ?? '__none__'
      st = reducer(st, { type: 'play/trial', kind: 'item', ref })
      expect(['play', 'ending']).toContain(st.screen)
    }
  })

  it('一键随机不会崩，内容库始终可用', () => {
    let st = initState()
    for (let i = 0; i < 6; i++) st = reducer(st, { type: 'genesis/roll', seed: makeSeedString() })
    expect(st.gen.traitIds.length).toBe(3)
    expect(Object.keys(st.content.packs).length).toBe(6)
    expect(st.content.origins.length).toBeGreaterThan(0)
  })

  it('存档可续：写入后 resume 能回到同一节点', () => {
    if (typeof window === 'undefined') return // node 环境无 localStorage，跳过
    const st = play(6, 'cautious')
    if (!st.state || st.screen !== 'play') return
    writeSave(st.state)
    expect(readSave()?.node_index).toBe(st.state.node_index)
    clearSave()
    expect(readSave()).toBeNull()
  })
})
