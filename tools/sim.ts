/**
 * 蒙特卡洛平衡验证 —— SPEC 第 10 章验收标准的客观依据。
 *
 * 跑法：npx tsx tools/sim.ts [每档局数]
 *
 * 关键设计：不用"均匀随机选"来模拟玩家 —— 那只能反映出内容里哪个 intent
 * 标注得多，测不出支配性策略。改为模拟**三种有倾向的玩家原型**，
 * 比较他们的终局表现。若某一档显著优于其他，即存在支配路线。
 *
 * game-core 是纯 TS，同一套规则既跑游戏也跑十万局模拟。
 */

import { loadContent } from './load-content'
import type { ContentDB, Motif, NameBank } from '../src/core/content'
import { PACK_IDS } from '../src/core/content'
import {
  advanceNode,
  presentCurrent,
  resolveEnding,
  startRun,
  submitOption,
  submitTrial,
} from '../src/core/engine'
import { rollGenesis } from '../src/core/genesis'
import { Rng } from '../src/core/rng'
import type {
  Affix,
  Destiny,
  Ending,
  FateMilestone,
  Flaw,
  Item,
  LooseEvent,
  Option,
  Origin,
  PackId,
  Scenario,
  Trait,
  WorldPack,
} from '../src/core/types'

const RUNS = Number(process.argv[2] ?? 800)

const raw = loadContent()

function buildContentDB(): ContentDB {
  const packs = Object.fromEntries(PACK_IDS.map((p) => [p, raw.packs[p]])) as Record<PackId, WorldPack>
  for (const p of PACK_IDS) {
    if (!packs[p]) throw new Error(`体系包 ${p} 缺失，无法模拟`)
  }
  return {
    packs,
    terms: raw.terms as ContentDB['terms'],
    motifs: raw.motifs as Motif[],
    events: raw.events as LooseEvent[],
    scenarios: raw.scenarios as Scenario[],
    endings: raw.endings as Ending[],
    origins: raw.origins as Origin[],
    traits: raw.traits as Trait[],
    flaws: raw.flaws as Flaw[],
    destinies: raw.destinies as Destiny[],
    l2: raw.l2,
    oracle: raw.oracle,
    coincidence: raw.coincidence,
    fateTemplates: raw.fateTemplates as Partial<Record<PackId, FateMilestone[]>>,
    names: (raw.names ?? {
      surname: [],
      given_male: [],
      given_female: [],
      dao_title: { element: [], noun: [], suffix: [] },
      sect: { place: [], suffix: [] },
    }) as NameBank,
    affixes: raw.affixes as Affix[],
    items: raw.items as Item[],
    version: 'sim',
  }
}

const content = buildContentDB()

// ============================================================
// 玩家原型 —— 不同倾向的玩家，用来检测支配路线
// ============================================================

type Archetype = 'aggressive' | 'steady' | 'schemer'

/** 每个原型对各 intent 的偏好权重（0 = 基本不选） */
const PREFERENCE: Record<Archetype, Record<string, number>> = {
  aggressive: {
    greedy: 5, evil: 3, sacrifice: 2,
    steady: 0.6, scheme: 1, flee: 0.2, social: 0.8, study: 0.5,
  },
  steady: {
    steady: 5, flee: 3, scheme: 2,
    greedy: 0.5, evil: 0.05, sacrifice: 0.3, social: 1, study: 1.5,
  },
  schemer: {
    scheme: 5, study: 4, social: 2,
    greedy: 1, steady: 1.2, flee: 1, evil: 0.6, sacrifice: 1.5,
  },
}

function pickOption(opts: Option[], arch: Archetype, rng: Rng): Option {
  const prefs = PREFERENCE[arch]
  const weights = opts.map((o) => prefs[o.intent] ?? 1)
  return rng.weighted(opts, weights)
}

// ============================================================

interface RunStat {
  nodes: number
  pack: PackId
  archetype: Archetype
  ending: string
  stars: number
  realm_idx: number
  realms_total: number
  power_index: number
  destinyTotal: number
  destinySlain: number
  destinyWorn: number
  scenarioSolved: number
  learnedRules: number
  intentCounts: Map<string, number>
}

function simulateOne(runIndex: number, arch: Archetype): RunStat | null {
  const rng = new Rng(`sim-${arch}-${runIndex}`)
  const pack = PACK_IDS[rng.int(0, PACK_IDS.length - 1)]!
  const g = rollGenesis(rng, content.origins, content.traits, content.flaws, pack)

  let state = startRun({
    runId: `sim-${arch}-${runIndex}`,
    seed: `sim-${arch}-${runIndex}`,
    packId: pack,
    originId: g.originId,
    traitIds: g.traitIds,
    flawId: g.flawId,
    content,
    destinyCount: rng.int(0, 3),
  })

  const intentCounts = new Map<string, number>()
  let guard = 0
  let scenarioSolved = 0

  while (state.status === 'alive' && guard < 300) {
    guard++
    const pres = presentCurrent(state, content)

    // 剧本中：模拟"翻找行囊"——优先试没试过的
    if (pres.kind === 'scenario' && pres.trials && pres.trials.length > 0) {
      const tried = new Set(state.active_scenario?.attempted ?? [])
      const fresh = pres.trials.filter((t) => !tried.has(t.ref))
      const pool = fresh.length > 0 ? fresh : pres.trials
      const t = pool[rng.int(0, pool.length - 1)]!
      const before = state.ending_threads.length
      const res = submitTrial(state, t.kind, t.ref, content)
      state = res.state
      if (state.ending_threads.length > before) scenarioSolved++
      continue
    }

    const opts = pres.options
    if (opts.length === 0) {
      // 无选项可走：强制推进一步，避免死循环
      state = { ...state, node_index: state.node_index + 1 }
      if (state.node_index >= state.total_nodes) {
        state = { ...state, status: 'ended', end_reason: 'nodes' }
      }
      continue
    }

    const opt = pickOption(opts, arch, rng)
    intentCounts.set(opt.intent, (intentCounts.get(opt.intent) ?? 0) + 1)

    const ev = content.events.find((e) => e.id === pres.event_id)
    if (!ev) {
      // 取不到事件对象（例如呈现的是兜底节点）。必须走 advanceNode，
      // 否则时间不推进、日常修炼不结算，战力会被系统性低估 —— 这是
      // 之前"三个体系包均战力为 0"的真正原因：模拟侧的统计口径错了。
      state = advanceNode({ ...state, fired_events: [...state.fired_events, pres.event_id] }, content)
      continue
    }

    state = submitOption(state, opt.id, content, ev).state
  }

  const end = resolveEnding(state, content)
  const realms = content.packs[state.pack_id]?.realms ?? []

  return {
    nodes: state.node_index,
    pack,
    archetype: arch,
    ending: end.ending?.category ?? '未定',
    stars: end.stars,
    realm_idx: state.realm_idx,
    realms_total: realms.length,
    power_index: state.power_index,
    destinyTotal: state.destiny_children.length,
    destinySlain: state.destiny_children.filter((d) => !d.alive).length,
    destinyWorn: state.destiny_children.reduce(
      (a, d) => a + (d.destiny_max > 0 ? 1 - d.destiny_pool / d.destiny_max : 0),
      0,
    ),
    scenarioSolved,
    learnedRules: state.learned_rules.length,
    intentCounts,
  }
}

// ============================================================

console.log(`\n══════ 《玄》蒙特卡洛模拟：${RUNS} 局 × 3 玩家原型 ══════\n`)

const byArch = new Map<Archetype, RunStat[]>()
const t0 = Date.now()
let errors = 0

for (const arch of ['aggressive', 'steady', 'schemer'] as Archetype[]) {
  const stats: RunStat[] = []
  for (let i = 0; i < RUNS; i++) {
    try {
      const s = simulateOne(i, arch)
      if (s) stats.push(s)
    } catch (e) {
      errors++
      if (errors <= 3) console.error(`[${arch}] 第 ${i} 局异常：`, (e as Error).message)
    }
  }
  byArch.set(arch, stats)
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
const all = [...byArch.values()].flat()

if (all.length === 0) {
  console.error('没有任何一局跑完 —— 内容库可能不完整。先跑 npm run lint:content。')
  process.exit(1)
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
const pct = (n: number, d: number) => `${((n / Math.max(1, d)) * 100).toFixed(1)}%`

function diversity(values: string[]): number {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const n = values.length
  let H = 0
  for (const c of counts.values()) {
    const p = c / n
    if (p > 0) H -= p * Math.log(p)
  }
  return H / Math.log(Math.max(2, counts.size))
}

console.log(`模拟完成：${all.length} 局 · 耗时 ${elapsed}s${errors ? ` · ${errors} 局异常` : ''}\n`)

// ── 节奏 ──
const avgNodes = avg(all.map((s) => s.nodes))
console.log('── 时长与节奏 ──')
console.log(`  平均节点数    ${avgNodes.toFixed(1)}  （目标 20–30）`)
console.log(`  估算单局时长  ${((avgNodes * 15) / 60).toFixed(1)} 分钟  （目标 5–8）`)
console.log(`  平均评星      ${avg(all.map((s) => s.stars)).toFixed(2)} / 5`)
const realmProgress = avg(all.map((s) => s.realm_idx / Math.max(1, s.realms_total - 1))) * 100
console.log(
  `  平均境界进度  ${realmProgress.toFixed(0)}%` +
    `   （平均最高战力 ${avg(all.map((s) => s.power_index)).toFixed(0)} / 1000）`,
)

// ── 结局分布 ──
const byEnding = new Map<string, number>()
for (const s of all) byEnding.set(s.ending, (byEnding.get(s.ending) ?? 0) + 1)
console.log('\n── 结局分布 ──')
for (const [cat, n] of [...byEnding.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${cat.padEnd(10, '　')} ${pct(n, all.length).padStart(6)}  ${'█'.repeat(Math.round((n / all.length) * 38))}`)
}
if (byEnding.size > 14) console.log(`  … 另有 ${byEnding.size - 14} 类`)
const deathRate =
  [...byEnding.entries()]
    .filter(([c]) => /道陨|入魔|殉道|清算/.test(c))
    .reduce((a, [, n]) => a + n, 0) / all.length
console.log(`\n  道陨类占比    ${(deathRate * 100).toFixed(1)}%  （阈值 ≤40%）`)
console.log(`  结局多样性    ${diversity(all.map((s) => s.ending)).toFixed(3)}`)

// ── 玩家原型对比（支配性策略检测）──
console.log('\n── 玩家原型对比（支配性策略检测）──')
console.log('  原型'.padEnd(12) + '均节点'.padStart(8) + '均评星'.padStart(8) + '均战力'.padStart(8) + '破局'.padStart(7) + '习得规则'.padStart(10) + '截杀'.padStart(7))
const archScore = new Map<Archetype, number>()
for (const [arch, stats] of byArch) {
  const score = avg(stats.map((s) => s.power_index))
  archScore.set(arch, score)
  console.log(
    `  ${arch}`.padEnd(12) +
      avg(stats.map((s) => s.nodes)).toFixed(1).padStart(8) +
      avg(stats.map((s) => s.stars)).toFixed(2).padStart(8) +
      score.toFixed(0).padStart(8) +
      avg(stats.map((s) => s.scenarioSolved)).toFixed(2).padStart(7) +
      avg(stats.map((s) => s.learnedRules)).toFixed(2).padStart(10) +
      stats.reduce((a, s) => a + s.destinySlain, 0).toString().padStart(7),
  )
}
const scores = [...archScore.values()]
const best = Math.max(...scores)
const worst = Math.min(...scores)
const spread = worst > 0 ? (best - worst) / worst : 0
console.log(`\n  最优/最劣原型战力差 ${(spread * 100).toFixed(1)}%  （>20% 视为存在支配路线）`)

// ── 各体系包 ──
const byPack = new Map<string, RunStat[]>()
for (const s of all) {
  const arr = byPack.get(s.pack) ?? []
  arr.push(s)
  byPack.set(s.pack, arr)
}
console.log('\n── 各体系包表现 ──')
for (const [p, arr] of byPack) {
  console.log(
    `  ${(content.packs[p as PackId]?.display_name ?? p).padEnd(12)}` +
      `均战力 ${avg(arr.map((s) => s.power_index)).toFixed(0).padStart(5)}` +
      `  均评星 ${avg(arr.map((s) => s.stars)).toFixed(2)}` +
      `  结局 ${new Set(arr.map((s) => s.ending)).size} 种`,
  )
}

// ── 位面之子 ──
console.log('\n── 位面之子（创新模块）──')
const withDestiny = all.filter((s) => s.destinyTotal > 0).length
const slain = all.reduce((a, s) => a + s.destinySlain, 0)
const totalDC = all.reduce((a, s) => a + s.destinyTotal, 0)
const wornAvg = avg(all.filter((s) => s.destinyTotal > 0).map((s) => s.destinyWorn / s.destinyTotal))
console.log(`  有天命降临的局  ${pct(withDestiny, all.length)}`)
console.log(`  平均每局        ${(totalDC / all.length).toFixed(2)} 位`)
console.log(`  平均磨损度      ${(wornAvg * 100).toFixed(1)}%  （玩家把主角光环磨掉了多少）`)
console.log(`  被截杀          ${slain} 位  （${totalDC > 0 ? ((slain / totalDC) * 100).toFixed(1) : '0'}%）`)

// ── 剧本 ──
console.log('\n── 剧本 ──')
console.log(`  平均每局破局    ${avg(all.map((s) => s.scenarioSolved)).toFixed(2)} 次`)
console.log(`  平均习得外来规则 ${avg(all.map((s) => s.learnedRules)).toFixed(2)} 条`)

// ── 验收 ──
console.log('\n── 验收判定 ──')
const checks: [string, boolean, string][] = [
  ['平均节点数 20–30', avgNodes >= 20 && avgNodes <= 30, avgNodes.toFixed(1)],
  ['估算时长 4–10 分钟', (avgNodes * 15) / 60 >= 4 && (avgNodes * 15) / 60 <= 10, `${((avgNodes * 15) / 60).toFixed(1)} 分`],
  ['道陨率 ≤40%', deathRate <= 0.4, `${(deathRate * 100).toFixed(1)}%`],
  ['结局多样性 ≥0.5', diversity(all.map((s) => s.ending)) >= 0.5, diversity(all.map((s) => s.ending)).toFixed(3)],
  ['成长能到后期（均战力 ≥200）', avg(all.map((s) => s.power_index)) >= 200, avg(all.map((s) => s.power_index)).toFixed(0)],
  ['无支配性原型（差 ≤20%）', spread <= 0.2, `${(spread * 100).toFixed(1)}%`],
  ['剧本可达（每局 ≥0.3 次破局）', avg(all.map((s) => s.scenarioSolved)) >= 0.3, avg(all.map((s) => s.scenarioSolved)).toFixed(2)],
  ['位面之子可被截杀', slain > 0, `${slain} 位`],
  ['跨界习得可用', avg(all.map((s) => s.learnedRules)) > 0, avg(all.map((s) => s.learnedRules)).toFixed(2)],
]
let pass = 0
for (const [name, ok, val] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(30)} ${val}`)
  if (ok) pass++
}
console.log(`\n  ${pass}/${checks.length} 项通过\n`)

process.exit(pass >= checks.length - 1 ? 0 : 1)
