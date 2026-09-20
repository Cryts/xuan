import { describe, expect, it } from 'vitest'
import { STANCES, resolveDuel, setupDuel, waysOf } from '../src/core/duel'
import {
  dailyActions,
  duelTrigger,
  rollOpponent,
  submitDuelEntry,
} from '../src/core/engine'
import { PACK_IDS, type ContentDB } from '../src/core/content'
import { Rng } from '../src/core/rng'
import { loadContent } from '../tools/load-content'
import type { DuelOpponent, GameState, PackId, WorldPack } from '../src/core/types'

const raw = loadContent()
const content = {
  ...raw,
  packs: Object.fromEntries(PACK_IDS.map((p) => [p, raw.packs[p]])) as Record<PackId, WorldPack>,
  version: 't',
} as unknown as ContentDB

const mkState = (over: Partial<GameState> = {}): GameState => ({
  seed: 'd', node_index: 5, pack_id: 'mortal', realm_idx: 3, minor_idx: 0, power_index: 120,
  attrs: { root: 60, wits: 60, temper: 60, luck: 50, insight: 55, charm: 50 },
  vars: { currency: 100, power: 400, rare_mat: 2, favor: 20, debt: 0, exposure: 0,
          corruption: 0, karma: 0, hp: 10, lifespan: 0 },
  flags: {}, items: [], relations: [], learned_rules: [], titles: [], codex: [],
  faction_tier: {}, history: [], queue: [], recent_motifs: [], recent_tags: [],
  recent_narrative: [], destiny_children: [], ending_threads: [],
  completed_scenarios: [], fired_events: [], status: 'alive', total_nodes: 26, age: 40,
  ...over,
} as unknown as GameState)

const foe = (essence: DuelOpponent['essence'], power = 120): DuelOpponent => ({
  id: 'foe', name: '对手', essence, power_index: power, realm_name: '筑基',
})

/** 跑 N 次取胜率 —— 单次有随机，比的是趋势 */
const winRate = (setup: ReturnType<typeof setupDuel>, stance: string, way: string, n = 300) => {
  let w = 0
  for (let i = 0; i < n; i++) {
    const r = resolveDuel(mkState(), setup, stance as never, way as never, new Rng(`s${i}`))
    if (r.outcome === 'win') w++
  }
  return w / n
}

describe('斗法 · 明牌', () => {
  it('把双方实力摊开 —— 这是"明牌"的本意', () => {
    const st = mkState()
    const s = setupDuel(st, foe('body'), new Rng('x'))
    expect(s.matchup.my_power).toBeGreaterThan(0)
    expect(s.matchup.their_power).toBe(120)
    expect(s.matchup.odds).toBeGreaterThan(0)
    expect(s.matchup.odds).toBeLessThanOrEqual(1)
    // 给的是模糊档位，不是精确概率 —— 与全作的判定口径一致
    expect(['十拿九稳', '有把握', '未卜', '凶险', '九死一生']).toContain(s.matchup.odds_hint)
  })

  it('路数取本体系，加上所有跨界习得的', () => {
    const base = waysOf(mkState())
    expect(base.length).toBe(1)
    const withRules = waysOf(mkState({
      learned_rules: [
        { pack: 'mystery', ref: 'r1', name: '拟身法' },
        { pack: 'physique', ref: 'r2', name: '骨篆' },
      ],
    }))
    expect(withRules.length).toBe(3)
    expect(withRules.some((w) => w.from_pack === 'mystery')).toBe(true)
  })

  it('架势四种，各有取舍', () => {
    expect(STANCES.map((s) => s.id)).toEqual(['assault', 'guard', 'bait', 'conceal'])
    for (const s of STANCES) {
      expect(s.note, `${s.name} 缺取舍说明`).toBeTruthy()
    }
  })
})

describe('斗法 · 路数对抗', () => {
  it('**相性真的决定胜负** —— 不是装饰', () => {
    // 我方是气(mortal)。气克体 → 用本门路数打体修应当明显更占优
    const even = mkState({ power_index: 94 }) // myDuelPower ≈ 120，与对手持平
    const vsBody = setupDuel(even, foe('body'), new Rng('x'))
    const vsSpirit = setupDuel(even, foe('spirit'), new Rng('x'))
    const wBody = winRate(vsBody, 'guard', 'qi')
    const wSpirit = winRate(vsSpirit, 'guard', 'qi')
    expect(wBody, `克体 ${wBody.toFixed(2)} 应优于被灵克 ${wSpirit.toFixed(2)}`).toBeGreaterThan(wSpirit + 0.1)
  })

  it('换一条路数能改命 —— 这是跨界习得的实战价值', () => {
    // 对面是灵(spirit)。气被灵克，但体克灵。
    const setup = setupDuel(mkState({ power_index: 94 }), foe('spirit'), new Rng('x'))
    const asQi = winRate(setup, 'guard', 'qi')
    const asBody = winRate(setup, 'guard', 'body')
    expect(asBody, `用体打灵 ${asBody.toFixed(2)} 应优于用气 ${asQi.toFixed(2)}`).toBeGreaterThan(asQi + 0.1)
  })

  it('**四种架势期望相当，差别在起伏** —— 没有一个是必选项', () => {
    // 我方 power_index 94 时 myDuelPower ≈ 120，对面也是 120，是真正的势均力敌
    const setup = setupDuel(mkState({ power_index: 94 }), foe('qi', 120), new Rng('x'))
    const rates = (['assault', 'guard', 'bait', 'conceal'] as const).map((sid) => ({
      sid,
      win: winRate(setup, sid, 'qi', 600),
    }))
    // 每一个都不该是碾压或被碾压
    for (const r of rates) {
      expect(r.win, `${r.sid} 胜率 ${r.win.toFixed(2)}`).toBeGreaterThan(0.25)
      expect(r.win, `${r.sid} 胜率 ${r.win.toFixed(2)}`).toBeLessThan(0.75)
    }
    // 也不该有哪个明显压过别人 —— 那它就是必选项
    const spread = Math.max(...rates.map((r) => r.win)) - Math.min(...rates.map((r) => r.win))
    expect(spread, `架势间胜率差 ${spread.toFixed(2)} 过大`).toBeLessThan(0.35)
  })

  it('打三轮，且给出可读战报', () => {
    const setup = setupDuel(mkState(), foe('qi'), new Rng('x'))
    const r = resolveDuel(mkState(), setup, 'guard', 'qi', new Rng('z'))
    expect(r.rounds.length).toBe(3)
    for (const rd of r.rounds) expect(rd.line.length).toBeGreaterThan(0)
    expect(['win', 'lose', 'draw']).toContain(r.outcome)
  })

  it('实力悬殊时结果基本注定', () => {
    const strong = setupDuel(mkState({ power_index: 500 }), foe('qi', 30), new Rng('x'))
    expect(winRate(strong, 'guard', 'qi')).toBeGreaterThan(0.9)
    const weak = setupDuel(mkState({ power_index: 20 }), foe('qi', 400), new Rng('x'))
    expect(winRate(weak, 'guard', 'qi')).toBeLessThan(0.1)
  })
})

describe('斗法 · 杀与放', () => {
  it('只有赢下来才谈得上取人性命', async () => {
    const { canKill } = await import('../src/core/duel')
    const setup = setupDuel(mkState(), foe('qi'), new Rng('x'))
    expect(canKill(setup, { outcome: 'win', rounds: [], momentum: { mine: 1, theirs: 0 }, summary: '' })).toBe(true)
    expect(canKill(setup, { outcome: 'lose', rounds: [], momentum: { mine: 0, theirs: 1 }, summary: '' })).toBe(false)
    expect(canKill(setup, { outcome: 'draw', rounds: [], momentum: { mine: 1, theirs: 1 }, summary: '' })).toBe(false)
  })

  it('杀的所得高于放，但有因果与暴露的代价', () => {
    const s = setupDuel(mkState(), foe('qi'), new Rng('x'))
    expect(s.spoils.kill.power).toBeGreaterThan(s.spoils.win.power)
    expect(s.spoils.kill_cost.debt).toBeGreaterThan(0)
    expect(s.spoils.kill_cost.karma).toBeLessThan(0)
    expect(s.spoils.kill_cost.exposure).toBeGreaterThan(0)
  })
})

describe('斗法 · 对手生成', () => {
  it('优先挑在世的位面之子 —— 打主角是最刺激的事', () => {
    let destiny = 0
    for (let i = 0; i < 60; i++) {
      const st = mkState({
        destiny_children: [{
          id: 'dc1', name: '陆焚天', pack: 'genius', archetype: 'brute',
          destiny_pool: 3, destiny_max: 3, power_index: 200, realm_name: '斗者',
          fate_line: [], fate_progress: 2, region_tag: 'wild', relation: 0,
          used_against: [], resistances: [], alive: true, oracle_note: '命线如刀。', seed: 's',
        }],
      })
      const o = rollOpponent(st, new Rng(`o${i}`), content)
      if (o.is_destiny) destiny++
    }
    expect(destiny).toBeGreaterThan(10)
  })

  it('没有位面之子时捏一个同代散修，路数取自别的体系', () => {
    for (let i = 0; i < 20; i++) {
      const o = rollOpponent(mkState(), new Rng(`n${i}`), content)
      expect(o.name.length).toBeGreaterThan(0)
      expect(o.power_index).toBeGreaterThan(0)
    }
  })
})

describe('斗法 · 是奇遇不是日常', () => {
  it('**日常里没有"寻斗"这一项**', () => {
    const acts = dailyActions(mkState())
    expect(acts.map((a: { id: string }) => a.id)).not.toContain('duel')
    // 日常是"安排"，斗法是"际遇" —— 日程表上不该有打架
    expect(acts.map((a: { id: string }) => a.id).sort()).toEqual(
      ['befriend', 'cultivate', 'gather', 'market', 'roam'],
    )
  })

  it('触发条件来自你做过的事，不是你想不想打', () => {
    // 白纸一张：没人来找你
    let fired = 0
    for (let i = 0; i < 200; i++) {
      if (duelTrigger(mkState({ vars: { ...mkState().vars, debt: 0, exposure: 0 } }), new Rng(`q${i}`))) fired++
    }
    expect(fired).toBe(0)

    // 债台高筑：仇家上门
    let withDebt = 0
    for (let i = 0; i < 200; i++) {
      if (duelTrigger(mkState({ vars: { ...mkState().vars, debt: 60 } }), new Rng(`d${i}`))) withDebt++
    }
    expect(withDebt, '欠了债应当有人来收').toBeGreaterThan(40)

    // 暴露过高：被认出来
    let withExposure = 0
    for (let i = 0; i < 200; i++) {
      if (duelTrigger(mkState({ vars: { ...mkState().vars, exposure: 70 } }), new Rng(`e${i}`))) withExposure++
    }
    expect(withExposure).toBeGreaterThan(30)
  })

  it('境界太低时不会被拦 —— 还没到能跟人动手的地步', () => {
    let fired = 0
    for (let i = 0; i < 200; i++) {
      const st = mkState({ power_index: 2, vars: { ...mkState().vars, debt: 90 } })
      if (duelTrigger(st, new Rng(`l${i}`))) fired++
    }
    expect(fired).toBe(0)
  })

  it('刚打完没多久不会又被堵住', () => {
    const st = mkState({ vars: { ...mkState().vars, debt: 90 }, last_duel_node: 4, node_index: 5 })
    let fired = 0
    for (let i = 0; i < 200; i++) if (duelTrigger(st, new Rng(`r${i}`))) fired++
    expect(fired).toBe(0)
  })

  it('剧本里不插斗法 —— 免得打断破局', () => {
    const st = mkState({
      vars: { ...mkState().vars, debt: 90 },
      active_scenario: { scenario_id: 'x', started_at: 0, nodes_spent: 1, revealed_rules: [], solved: [], attempted: [] },
    })
    let fired = 0
    for (let i = 0; i < 200; i++) if (duelTrigger(st, new Rng(`s${i}`))) fired++
    expect(fired).toBe(0)
  })

  it('遭遇时给出「出手 / 避开」两条路', () => {
    const st = mkState()
    const setup = setupDuel(st, foe('qi'), new Rng('x'))
    // 明牌里必须有可据以决断的东西：胜算档位
    expect(setup.matchup.odds_hint).toBeTruthy()
    expect(setup.ways.length).toBeGreaterThan(0)
    expect(setup.stances.length).toBe(4)
  })
})

describe('斗法 · 打不打的抉择', () => {
  it('**避开不推进即时的节点，但有代价**', () => {
    const base = mkState()
    const st = mkState({ pending_duel: setupDuel(base, foe('qi'), new Rng('x')) })
    const favor0 = st.vars.favor
    const karma0 = st.vars.karma

    const r = submitDuelEntry(st, false, content)
    expect(r.ok).toBe(true)
    expect(r.state.pending_duel, '避开后不该还挂着这一场').toBeUndefined()
    expect(r.state.vars.favor, '避战要折颜面').toBeLessThan(favor0)
    expect(r.state.vars.karma, '转身走了，心里记着').toBeLessThan(karma0)
    // 避开**不是死** —— 调研结论：惩罚落在声望上，不落在存亡上
    expect(r.state.status).toBe('alive')
    expect(r.state.node_index).toBeGreaterThan(st.node_index)
  })

  it('**出手不推进节点，只打开架势选择**', () => {
    const base = mkState()
    const st = mkState({ pending_duel: setupDuel(base, foe('qi'), new Rng('x')) })
    const r = submitDuelEntry(st, true, content)
    expect(r.ok).toBe(true)
    expect(r.state.duel_committed, '出手后该进入选架势的阶段').toBe(true)
    expect(r.state.pending_duel, '这一场还挂着').toBeTruthy()
    expect(r.state.node_index, '出手本身不花时间').toBe(st.node_index)
  })

  it('没有待决斗法时，两个动作都安全失败', () => {
    const st = mkState()
    expect(submitDuelEntry(st, true, content).ok).toBe(false)
    expect(submitDuelEntry(st, false, content).ok).toBe(false)
  })
})
