/**
 * 试玩 agent —— 一个「会琢磨的玩家」，用它替代人肉反复试。
 *
 *   npx tsx tools/playtest.ts [局数]
 *
 * 与 sim.ts 的区别：
 *   sim.ts   用三种**固定倾向**的假人测平衡与支配性策略；
 *   playtest 用一个**会看图说话**的玩家，目标是**挑毛病**——
 *   它翻隐规则、试匹配的行囊、比较各路代价，然后把"哪里不对劲"记下来。
 *
 * 结果累积写入 `playtest-findings.md`，每跑一次都会更新，
 * 所以它是"不断发现问题、积累经验"的那个东西。
 *
 * game-core 是纯 TS，所以这个 agent 不需要浏览器、不需要界面，
 * 直接在 Node 里把成千上万局跑完。
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadContent, ROOT } from './load-content'
import { PACK_IDS, type ContentDB } from '../src/core/content'
import {
  SCENARIO_ACTIONS,
  presentCurrent,

  resolveEnding,
  startRun,
  submitOption,
  submitScenarioAction,
  submitScenarioEntry,
  submitTrial,
} from '../src/core/engine'
import { rollGenesis } from '../src/core/genesis'
import { Rng } from '../src/core/rng'
import type {
  Affix,
  Condition,
  Destiny,
  Ending,
  FateMilestone,
  Flaw,
  Item,
  LooseEvent,
  Origin,
  PackId,
  Scenario,
  Trait,
  WorldPack,
} from '../src/core/types'
import { evaluate } from '../src/core/conditions'

const RUNS = Number(process.argv[2] ?? 400)
const raw = loadContent()

const content = {
  ...raw,
  packs: Object.fromEntries(PACK_IDS.map((p) => [p, raw.packs[p]])) as Record<PackId, WorldPack>,
  events: raw.events as LooseEvent[],
  scenarios: raw.scenarios as Scenario[],
  endings: raw.endings as Ending[],
  origins: raw.origins as Origin[],
  traits: raw.traits as Trait[],
  flaws: raw.flaws as Flaw[],
  destinies: raw.destinies as Destiny[],
  affixes: raw.affixes as Affix[],
  items: raw.items as Item[],
  fateTemplates: raw.fateTemplates as Partial<Record<PackId, FateMilestone[]>>,
  version: 'playtest',
} as unknown as ContentDB

// ============================================================
// 会琢磨的玩家
// ============================================================

const seenEvents = new Map<string, number>()
const seenScenarios = new Map<string, number>()
const seenScenarioEntered = new Map<string, number>()
const scenarioOutcomes = new Map<string, Map<string, number>>() // 剧本 → 破局组 → 次数
const seenEndings = new Map<string, number>()

/** 记录：这些剧本从未被破过任何一条路（哪怕是会琢磨的玩家也破不了） */
const scenarioNeverSolved = new Map<string, number>()
const emptyNodes: string[] = []
const runLengths: number[] = []
const affordanceMisses = new Map<string, number>()

function unmetConditions(sc: Scenario, solved: string[], state: Parameters<typeof evaluate>[1]['state']): Condition[] {
  // 找出所有还没通的条件组里、当前不满足的原子条件
  const out: Condition[] = []
  for (const b of sc.breakthroughs) {
    if (solved.includes(b.id)) continue
    for (const c of b.conditions) {
      if (!evaluate(c, { state, solvedInScenario: solved })) out.push(c)
    }
  }
  return out
}

function playOne(idx: number): void {
  const rng = new Rng(`play-${idx}`)
  const pack = PACK_IDS[rng.int(0, PACK_IDS.length - 1)]!
  const g = rollGenesis(rng, content.origins, content.traits, content.flaws, pack)

  let s = startRun({
    runId: `play-${idx}`,
    seed: `play-${idx}`,
    packId: pack,
    originId: g.originId,
    traitIds: g.traitIds,
    flawId: g.flawId,
    content,
    destinyCount: rng.int(0, 3),
  })

  let guard = 0
  while (s.status === 'alive' && guard++ < 400) {
    const pres = presentCurrent(s, content)

    // 空节点：既不让人选、也没手段 —— 玩家会卡在这里
    if (
      pres.kind !== 'ending' &&
      pres.options.length === 0 &&
      !pres.scenario_entry &&
      !pres.trials?.length &&
      !pres.actions?.length
    ) {
      emptyNodes.push(`${pres.event_id} (node ${s.node_index}, ${pack})`)
      s = { ...s, node_index: s.node_index + 1, status: s.node_index + 1 >= s.total_nodes ? 'ended' : 'alive' }
      continue
    }

    // 剧本入场：会琢磨的玩家先看规则，觉得有戏就进
    if (pres.scenario_entry) {
      const sc = content.scenarios.find((x) => x.id === pres.scenario_entry!.scenario_id)
      const worthIt = sc ? sc.breakthroughs.length >= 3 : false
      seenScenarios.set(pres.event_id, (seenScenarios.get(pres.event_id) ?? 0) + 1)
      if (worthIt) seenScenarioEntered.set(pres.event_id, (seenScenarioEntered.get(pres.event_id) ?? 0) + 1)
      s = submitScenarioEntry(s, worthIt, content).state
      continue
    }

    // 剧本中：先探规则，再拿匹配的行囊试
    if (pres.kind === 'scenario' && s.active_scenario) {
      const sc = content.scenarios.find((x) => x.id === s.active_scenario!.scenario_id)!
      const run = s.active_scenario
      const unmet = unmetConditions(sc, run.solved, s)

      // 1) 有没揭示的隐规则 → 先探（理解规则是破局的前提）
      const unrevealed = sc.rules_hidden.filter((r) => !run.revealed_rules.includes(r.id))
      const probeTried = run.attempted.includes('act:probe') && run.attempted.includes('act:attune')
      if (unrevealed.length > 0 && !probeTried) {
        const act = rng.chance(0.5) ? 'probe' : 'attune'
        s = submitScenarioAction(s, act, content).state
        continue
      }

      // 2) 行囊里有没有能对上未满足条件的
      const trials = pres.trials ?? []
      const match = trials.find((t) =>
        unmet.some(
          (c) =>
            (c.type === 'affordance' && t.affordance.includes(c.ref)) ||
            (c.type === 'learned_rule' && t.affordance.includes(c.ref)),
        ),
      )
      if (match) {
        const before = s.ending_threads.length
        s = submitTrial(s, match.kind, match.ref, content).state
        if (s.ending_threads.length > before) {
          const m = scenarioOutcomes.get(sc.id) ?? new Map()
          const last = s.ending_threads[s.ending_threads.length - 1]!
          m.set(last, (m.get(last) ?? 0) + 1)
          scenarioOutcomes.set(sc.id, m)
        }
        continue
      }

      // 3) 对不上就记一笔：玩家手里根本没有能破这条路的物件
      for (const c of unmet) {
        if (c.type === 'affordance') affordanceMisses.set(c.ref, (affordanceMisses.get(c.ref) ?? 0) + 1)
      }

      // 4) 还有余力就继续探，快没刻了才抽身
      const left = sc.span - run.nodes_spent
      if (left <= 1) {
        s = submitScenarioAction(s, 'leave', content).state
      } else {
        const acts = SCENARIO_ACTIONS.filter((a) => a.id !== 'leave' && a.id !== 'wait')
        s = submitScenarioAction(s, rng.pick(acts).id, content).state
      }

      if (s.ending_threads.length > 0) {
        const m = scenarioOutcomes.get(sc.id) ?? new Map()
        for (const t of s.ending_threads) m.set(t, (m.get(t) ?? 0) + 1)
        scenarioOutcomes.set(sc.id, m)
      }
      continue
    }

    if (pres.options.length === 0) {
      s = { ...s, node_index: s.node_index + 1 }
      if (s.node_index >= s.total_nodes) s = { ...s, status: 'ended', end_reason: 'nodes' }
      continue
    }

    seenEvents.set(pres.event_id, (seenEvents.get(pres.event_id) ?? 0) + 1)

    // 散事件：优先挑风险适中、且当前资源扛得住的
    const opt =
      pres.options.length === 1
        ? pres.options[0]!
        : rng.weighted(pres.options, pres.options.map((o) => (o.risk_tier === '绝' ? 0.4 : o.risk_tier === '狠' ? 1 : 2)))

    const ev = content.events.find((e) => e.id === pres.event_id)
    if (!ev) {
      s = { ...s, node_index: s.node_index + 1, fired_events: [...s.fired_events, pres.event_id] }
      if (s.node_index >= s.total_nodes) s = { ...s, status: 'ended', end_reason: 'nodes' }
      continue
    }
    s = submitOption(s, opt.id, content, ev).state
  }

  runLengths.push(s.node_index)
  const end = resolveEnding(s, content)
  const cat = end.ending?.category ?? '未定'
  seenEndings.set(cat, (seenEndings.get(cat) ?? 0) + 1)
  if (s.ending_threads.length === 0 && content.scenarios.length > 0) {
    // 这一局一次剧本都没破 —— 只统计确实进过剧本的
    for (const [k, n] of seenScenarioEntered) {
      if (!scenarioOutcomes.has(k)) scenarioNeverSolved.set(k, n)
    }
  }
}

// ============================================================

console.log(`\n══════ 试玩 agent：${RUNS} 局 ══════\n`)
const t0 = Date.now()
for (let i = 0; i < RUNS; i++) {
  try {
    playOne(i)
  } catch (e) {
    console.error(`第 ${i} 局异常：`, (e as Error).message)
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1)

const allEvents = content.events
const neverSeen = allEvents.filter((e) => !seenEvents.has(e.id))
const neverSeenScen = content.scenarios.filter((s) => !seenScenarios.has(s.id))
const avgLen = runLengths.reduce((a, b) => a + b, 0) / Math.max(1, runLengths.length)

const L: string[] = []
L.push(`# 试玩 agent 发现清单`)
L.push(``)
L.push(`> 自动生成 · 本次 ${RUNS} 局 · 耗时 ${secs}s · 运行时间见文件修改时间`)
L.push(``)
L.push(`## 一、体量与节奏`)
L.push(``)
L.push(`- 平均局内节点数：**${avgLen.toFixed(1)}**（目标 20–30）`)
L.push(
  `- 节点数分布：最短 ${Math.min(...runLengths)} · 最长 ${Math.max(...runLengths)}`,
)
L.push(`- 遇到过的事件：**${seenEvents.size} / ${allEvents.length}**`)
L.push(`- 遇到过的剧本：**${seenScenarios.size} / ${content.scenarios.length}**`)
L.push(`- 出现过的结局分类：**${seenEndings.size}**`)
L.push(``)

L.push(`## 二、卡住的地方（优先级最高）`)
L.push(``)
if (emptyNodes.length === 0) {
  L.push(`✓ 没有出现过"既不能选、也没手段"的空节点`)
} else {
  L.push(`✗ 出现 **${emptyNodes.length} 次**空节点 —— 玩家会在这里卡死：`)
  for (const n of [...new Set(emptyNodes)].slice(0, 15)) L.push(`  - ${n}`)
  if (new Set(emptyNodes).size > 15) L.push(`  - … 另有 ${new Set(emptyNodes).size - 15} 个`)
}
L.push(``)

L.push(`## 三、破不了的剧本`)
L.push(``)
const hard = content.scenarios.filter((s) => {
  const seen = seenScenarioEntered.get(s.id) ?? 0
  const solved = scenarioOutcomes.get(s.id)?.size ?? 0
  return seen > 0 && solved === 0
})
if (hard.length === 0) {
  L.push(`✓ 每个被进入过的剧本，这个玩家都至少破过一条路`)
} else {
  L.push(`✗ **${hard.length} 个剧本，会琢磨的玩家一条路也破不了**：`)
  for (const s of hard) L.push(`  - 《${s.name}》(${s.id}) —— 进入 ${seenScenarioEntered.get(s.id)} 次，0 破局`)
}
L.push(``)

L.push(`## 四、从未出现的剧本（可能是门槛过不去）`)
L.push(``)
if (neverSeenScen.length === 0) {
  L.push(`✓ 所有剧本都触发过`)
} else {
  for (const s of neverSeenScen) L.push(`  - 《${s.name}》(${s.id}) · 门槛 ${JSON.stringify(s.requires ?? null)}`)
}
L.push(``)

L.push(`## 五、从未出现的结局`)
L.push(``)
const unseenEndings = content.endings.filter((e) => !seenEndings.has(e.category))
if (unseenEndings.length === 0) L.push(`✓ 所有分类都达成过`)
else {
  const cats = [...new Set(unseenEndings.map((e) => e.category))]
  L.push(`以下分类在 ${RUNS} 局里一次都没出现（${cats.length} 类）：`)
  L.push(`  ${cats.join(' · ')}`)
  L.push(``)
  L.push(`> 可能是条件过苛，也可能是本批玩家的行为覆盖不到。`)
}
L.push(``)

L.push(`## 六、从未抽到的事件`)
L.push(``)
L.push(`${neverSeen.length} 个事件在这些局里一次都没被抽中（占比 ${((neverSeen.length / allEvents.length) * 100).toFixed(0)}%）。`)
L.push(`> 数量偏多说明权重或前置条件把它们压死了。`)
L.push(``)
const byStage = new Map<string, number>()
for (const e of neverSeen) for (const st of e.stage) byStage.set(st, (byStage.get(st) ?? 0) + 1)
L.push(`按阶段：${[...byStage].map(([k, v]) => `${k} ${v}`).join(' · ')}`)
L.push(``)

L.push(`## 七、行囊对不上的功能标签`)
L.push(``)
if (affordanceMisses.size === 0) L.push(`✓ 没有出现"要这个标签但身上没有"的情况`)
else {
  L.push(`玩家在剧本里需要、但身上没有的标签（次数越多说明该标签的物品越稀缺）：`)
  for (const [k, v] of [...affordanceMisses].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    L.push(`  - \`${k}\` × ${v}`)
  }
}
L.push(``)

const out = path.join(ROOT, 'playtest-findings.md')
fs.writeFileSync(out, L.join('\n'))
console.log(L.join('\n'))
console.log(`\n清单已写入 ${path.relative(process.cwd(), out)}\n`)
