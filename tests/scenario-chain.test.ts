import { describe, expect, it } from 'vitest'
import { PACK_IDS, type ContentDB } from '../src/core/content'
import {
  advanceNode, presentCurrent, startRun,
  submitDaily, submitDuelAftermath, submitDuelEntry, submitDuelStance,
  submitOption, submitScenarioAction, submitScenarioEntry, submitTrial,
} from '../src/core/engine'
import { rollGenesis } from '../src/core/genesis'
import { Rng } from '../src/core/rng'
import { loadContent } from '../tools/load-content'
import type { GameState, PackId, Scenario, WorldPack } from '../src/core/types'

const raw = loadContent()
const content = {
  ...raw,
  packs: Object.fromEntries(PACK_IDS.map((p) => [p, raw.packs[p]])) as Record<PackId, WorldPack>,
  version: 't',
} as unknown as ContentDB

const scenarioIds = new Set(content.scenarios.map((s) => s.id))

/**
 * 完整走一局，记录每一拍看见的 event_id。
 *
 * **必须在每次 advanceNode 之后 presentCurrent** —— 队列条目带窗口，
 * 只推节点不呈现的话，那一拍一过条目就被当成"窗口已过期"清掉，
 * 看起来像"从没排上队"，其实是测试没给它登场的机会。
 */
function playRun(seed: string, maxNodes = 60, cfg: ContentDB = content, pack: PackId = 'mortal') {
  const rng = new Rng(`p-${seed}`)
  const g = rollGenesis(rng, cfg.origins, cfg.traits, cfg.flaws, pack)
  let s = startRun({
    runId: seed, seed, packId: pack, originId: g.originId,
    traitIds: g.traitIds, flawId: g.flawId, content: cfg, destinyCount: 0,
  })
  const seen: string[] = []
  const queueLens: number[] = []
  let guard = 0
  while (s.status === 'alive' && guard++ < maxNodes) {
    const p = presentCurrent(s, cfg)
    seen.push(p.event_id)
    queueLens.push(s.queue.length)

    if (p.duel_result) { s = submitDuelAftermath(s, false, cfg).state; continue }
    if (p.duel && s.duel_committed) {
      s = submitDuelStance(s, 'guard', p.duel.ways[0]!.essence, cfg).state
      continue
    }
    if (p.event_id === '__duel_encounter__') { s = submitDuelEntry(s, false, cfg).state; continue }
    if (p.daily) { s = submitDaily(s, 'roam', cfg).state; continue }
    if (p.scenario_entry) { s = submitScenarioEntry(s, true, cfg).state; continue }
    if (p.kind === 'scenario' && s.active_scenario) {
      const t = (p.trials ?? [])[0]
      if (t) s = submitTrial(s, t.kind, t.ref, cfg).state
      else s = submitScenarioAction(s, 'wait', cfg).state
      continue
    }
    if (p.options.length > 0) {
      const ev = cfg.events.find((e) => e.id === p.event_id)
      if (ev) { s = submitOption(s, p.options[rng.int(0, p.options.length - 1)]!.id, cfg, ev).state; continue }
    }
    s = advanceNode(s, cfg)
  }
  return { state: s, seen, queueLens }
}

describe('剧本前置链', () => {
  /**
   * 队列**必须出队**。同一个坑栽过三次，这条盯的是第三次：
   * 条目烧完还留在 `state.queue` 里，于是任何"队列里有没有 X"的判断
   * 从此恒为真 —— 前置链的 `queuedScenario` 正是这么判的，
   * 结果一局只排得出一个剧本，实测剧本破局率从 0.90 腰斩到 0.46。
   */
  it('队列不会只进不出 —— 长度有界，且确实排过队', () => {
    let everQueued = 0
    let maxLen = 0
    for (const seed of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) {
      const { queueLens } = playRun(seed)
      maxLen = Math.max(maxLen, ...queueLens)
      everQueued += queueLens.filter((n) => n > 0).length
    }
    expect(maxLen, '队列从来没排过东西 = 前置链根本没跑').toBeGreaterThan(0)
    expect(maxLen, '队列长度失控 = 出队坏了').toBeLessThan(12)
    expect(everQueued, '六局里应当有若干拍队列非空').toBeGreaterThan(0)
  })

  it('过期与已出过的条目会被剔掉，未开窗的必须留着', () => {
    const base = playRun('prune').state
    const withStale: GameState = {
      ...base,
      node_index: 30,
      fired_events: ['evt_mortal_cave_relic_03'],
      queue: [
        { event_id: 'evt_mortal_cave_relic_03', window: [10, 12] }, // 已出过
        { event_id: 'evt_mortal_market_bargain_01', window: [5, 9] }, // 窗口早过
        { event_id: 'evt_mortal_auction_01', window: [40, 44] }, // 还没开窗，要留
      ],
    }
    const ids = advanceNode(withStale, content).queue.map((q) => q.event_id)
    expect(ids).not.toContain('evt_mortal_cave_relic_03')
    expect(ids).not.toContain('evt_mortal_market_bargain_01')
    expect(ids, '未开窗的条目不该被清掉，否则排队白排').toContain('evt_mortal_auction_01')
  })

  it('同一节点重复呈现结果一致 —— pickNextEvent 不许改状态', () => {
    const s = playRun('idem').state
    const a = presentCurrent(s, content)
    const b = presentCurrent(s, content)
    expect(a.event_id).toBe(b.event_id)
  })

  it('剧本登场之前会先出现同母题的铺垫', () => {
    // 给一个剧本挂上铺垫母题，权重拉到必定被选中。
    //
    // **pack 必须放成 '*'** —— 各剧本绑着自己的体系，`scn_cautious_*`
    // 在 mortal 局里压根进不了候选池，那样测出来的"没铺垫"是脚手架的问题。
    const sc = content.scenarios[0] as Scenario
    const motif = (content.events[0] as { motif: string }).motif
    const patched = {
      ...content,
      scenarios: content.scenarios.map((s) =>
        s.id === sc.id
          ? ({ ...s, leadup_motifs: [motif], weight: 100000, pack: ['*'] } as Scenario)
          : s,
      ),
    } as ContentDB

    let verified = false
    for (const seed of ['lead-1', 'lead-2', 'lead-3', 'lead-4', 'lead-5', 'lead-6', 'lead-7', 'lead-8']) {
      const { seen } = playRun(seed, 60, patched)
      const at = seen.findIndex((id) => id === sc.id || id === '__scenario_entry__')
      if (at < 0) continue
      const before = seen.slice(0, at)
      if (before.some((id) => patched.events.find((e) => e.id === id)?.motif === motif)) {
        verified = true
        break
      }
    }
    expect(verified, '八个种子里应当至少有一局：先见同母题铺垫，再见该剧本').toBe(true)
  })

  it('一局之内排得出不止一个剧本 —— 队列不能被头一个卡死', () => {
    // 这条是"队列只进不出"的直接复发闸门：修好之前 `queuedScenario`
    // 在第一个剧本排上队之后**恒为真**，一局只排得出一个。
    let multi = 0
    for (let i = 0; i < 25; i++) {
      const { seen } = playRun(`multi-${i}`)
      const n = seen.filter((id) => scenarioIds.has(id) || id === '__scenario_entry__').length
      if (n >= 2) multi++
    }
    expect(multi, '二十五局里应当有若干局遇到两个以上剧本').toBeGreaterThan(0)
  })
})
