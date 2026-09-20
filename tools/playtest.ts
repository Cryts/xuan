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
  bindContent,
  buyItem,
  leaveShop,
  presentCurrent,

  resolveEnding,
  startRun,
  submitOmenPass,
  submitOmenTake,
  submitOption,
  submitScenarioAction,
  submitDaily,
  submitDuelAftermath,
  submitDuelEntry,
  submitDuelStance,
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
  NodePresentation,
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
bindContent(content)

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

/**
 * 一个节点算不算"没法操作"。
 *
 * 判据是**有没有可交互的面**，不是"options 是不是空的"。
 *
 * 这里栽过一次，代价很大：判定原先只认 options，于是 `__daily__`、
 * `__duel__`、`__duel_after__` 这三个由**专用面板**（日常表 / 明牌 /
 * 战后处置）承接的节点被当成了空节点 —— 而判定跑在这些面板的分支**之前**
 * 并 `continue`，把节点直接推走了。结果是试玩 agent 三百局里
 * **没执行过一次日常行动、没打过一场斗法**（findings 里 4522 次"空节点"
 * 全是误报），而 #31 的支配性正是这个工具量的。
 *
 * **测量的工具瞎了，比被测的东西坏了更糟 —— 它会把结论一起带偏。**
 * 所以判据列在这里，而不是散在 if 里：以后再加专用面板，
 * 往这里加一项，别去动那个 if。
 */
function hasPanel(p: NodePresentation): boolean {
  return (
    p.options.length > 0 ||
    Boolean(p.scenario_entry) ||
    Boolean(p.trials?.length) ||
    Boolean(p.actions?.length) ||
    Boolean(p.daily?.length) || // 日常面板
    Boolean(p.duel) || // 斗法：遭遇与明牌
    Boolean(p.duel_result) || // 斗法：战后处置
    Boolean(p.shop) || // 坊市：货架（买/卖/离开都在这一屏，options 是空的）
    Boolean(p.omen) // 奇遇「接不接」（选项由引擎合成，这里认的是那个标记）
  )
}

/* ---------- 通畅性：事件之间的接缝 ----------
   玩家反馈「前一个在说祖父给书，下一个突然就跟领队进山」——
   每个节点都是独立取词的，彼此不知道对方讲过什么。
   这类断裂有可计算的部分：相邻两拍有没有共用的意象、
   有没有承接句、是不是同一件事紧挨着重复。 */
/* ---------- 结果正文：它到底有没有到玩家眼前 ----------
   这一段单独立出来，是因为它栽过：`EngineResult.narrative` 在引擎里
   一直有位，而 UI 侧的 `afterEngine` 从来没接过它 —— 数据是好的，
   玩家一个字也看不到，测试全绿。

   两条读数：
     · 结果正文覆盖率 —— 每一手都该有一句话；它是 100% 封顶的覆盖率，不是比率
     · 与开场白逐字全同率 —— 玩家刚读完开场白，选完之后又读一遍同一段。
       这不是"重复率高"，是**这一段根本没在说结果**。
       实测修复前 28.9%（走段位池的 0%、走 body_key 回落的 38.6%）。 */
const aftermath = {
  picks: 0,
  withText: 0,
  sameAsIntro: 0,
  seen: new Set<string>(),
}
/** 本节点的开场白正文（按 `事件@节点` 存），供"逐字全同"那条判据比对 */
const introText = new Map<string, string>()

/* ---------- 奇遇通道 ---------- */
const omenBoard = {
  gates: 0,
  shopGates: 0,
  eventGates: 0,
  take: 0,
  pass: 0,
  shopOffers: 0,
  shopBought: 0,
  seen: new Map<string, number>(),
}

/* ---------- 链条兑现：声明了 chain.next 的，后来真的来了没有 ---------- */
const chainBoard = {
  declared: 0,
  realized: 0,
}
const pendingChain: { id: string }[] = []
/** 本局被任何事件声明为"下一拍"的事件 id —— 「有意连锁」判据用它，不再用死字段 */
const declaredChainTargets = new Set<string>()

const continuity = {
  nodes: 0,
  withTransition: 0,
  bareCuts: [] as string[],      // 相邻节点标签零重叠、且没有过渡句
  motifRepeats: [] as string[],  // 同一母题紧挨着出现，且不是有意的连锁
  motifChains: 0,                // 有意连锁（上一件事的 followup 指向这一件）—— 不算问题
  stageJumps: 0,
  stageJumpsBare: 0,
}
let prevTags: string[] = []
let prevMotif: string | undefined
let prevStage: string | undefined

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
  // 每局都要把"上一拍"清空 —— 这四个是模块级的，
  // 不清的话新一局的第一个节点会拿去跟**上一局的最后一件**比对，
  // 报出一堆 @node 0 的假硬切。
  prevTags = []
  prevMotif = undefined
  prevStage = undefined
  declaredChainTargets.clear()
  pendingChain.length = 0

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
    if (pres.kind !== 'ending' && !hasPanel(pres)) {
      emptyNodes.push(`${pres.event_id} (node ${s.node_index}, ${pack})`)
      s = { ...s, node_index: s.node_index + 1, status: s.node_index + 1 >= s.total_nodes ? 'ended' : 'alive' }
      continue
    }

    // 奇遇：接不接。会琢磨的玩家：坊市多半接（灵石就是拿来花的），
    // 奇遇事件看手上有多少余力。
    if (pres.kind === 'encounter' && pres.omen) {
      omenBoard.gates++
      omenBoard.seen.set(pres.omen.key, (omenBoard.seen.get(pres.omen.key) ?? 0) + 1)
      if (pres.omen.kind === 'shop') omenBoard.shopGates++
      else omenBoard.eventGates++
      const take = pres.omen.kind === 'shop' ? true : rng.chance(0.55)
      if (take) omenBoard.take++
      else omenBoard.pass++
      s = take ? submitOmenTake(s, content).state : submitOmenPass(s, content).state
      continue
    }

    // 坊市：买不推进节点，离开才推进。会琢磨的玩家买得起就买。
    if (pres.shop) {
      omenBoard.shopOffers += pres.shop.items.length
      const afford = pres.shop.items.find((x) => x.stock > 0 && s.vars.currency >= x.price)
      if (afford && rng.chance(0.6)) {
        omenBoard.shopBought++
        s = buyItem(s, afford.item.id, content).state
      }
      s = leaveShop(s, content).state
      continue
    }

    // 斗法：遭遇（打不打）/ 选架势 / 战后处置
    if (pres.duel_result) {
      s = submitDuelAftermath(s, rng.chance(0.35), content).state
      continue
    }
    if (pres.duel && s.duel_committed) {
      const way = pres.duel.ways[rng.int(0, pres.duel.ways.length - 1)]!.essence
      const stances = ['assault', 'guard', 'bait', 'conceal'] as const
      s = submitDuelStance(s, stances[rng.int(0, 3)]!, way, content).state
      continue
    }
    if (pres.event_id === '__duel_encounter__') {
      // 胜算太差就避 —— 这正是明牌要让人能做的判断
      const odds = pres.duel?.matchup.odds ?? 0.5
      s = submitDuelEntry(s, odds >= 0.42, content).state
      continue
    }

    // 日常节点：会琢磨的玩家优先闭关养伤，伤好了再去游历找机缘
    if (pres.daily) {
      const acts = pres.daily.filter((a) => a.available)
      const want = s.vars.hp >= 40 ? 'roam' : 'cultivate'
      const pick = acts.find((a) => a.id === want) ?? acts[0]!
      s = submitDaily(s, pick.id, content).state
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

    // 结果正文的这一拍：先记下开场白，选完再比对（结果正文是不是把开场白重念了一遍）
    if (pres.lines.length > 0) introText.set(`${pres.event_id}@${pres.node_index}`, pres.lines.join('\n'))
    if (pendingChain.some((c) => c.id === pres.event_id)) chainBoard.realized++


    const evForContinuity = content.events.find((e) => e.id === pres.event_id)
    if (evForContinuity) {
      continuity.nodes++
      if (pres.transition) continuity.withTransition++

      // 阶段跃迁有没有交代
      if (prevStage && prevStage !== s.stage) {
        continuity.stageJumps++
        if (!pres.transition) continuity.stageJumpsBare++
      }

      // 同一母题紧挨着重复 —— 读起来像卡带。
      // 但要区分"有意连锁"：上一件事声明的链条正指向这一件，
      // 那是同一段情节的下一拍，本就该接着讲，不算重复。
      //
      // ⚠️ 判据原先读的是 `prevEvent.followups` —— **那个字段引擎根本不读**
      // （见 `content-lint` 的 `followups_dead_field`）。于是这里会把
      // "两个碰巧撞在一起的同母题事件"算成"有意连锁"，把真重复洗成好事。
      // 这又是"If the instrument is blind, it drags the conclusion with it"：
      // 它不是在漏报，是在**给错误背书**。
      // 现在改读引擎真的会入队的两处：段位 `queue_followup` 与 `chain.next`。
      if (prevMotif && evForContinuity.motif === prevMotif) {
        if (declaredChainTargets.has(evForContinuity.id)) continuity.motifChains++
        else continuity.motifRepeats.push(`${evForContinuity.motif} @node ${s.node_index}`)
      }

      // 硬切：跟上一拍毫无共用意象，而且没有任何承接
      if (prevTags.length > 0) {
        const shared = evForContinuity.tags.filter((t) => prevTags.includes(t))
        if (shared.length === 0 && !pres.transition) {
          continuity.bareCuts.push(`${prevMotif ?? '?'} → ${evForContinuity.motif} @node ${s.node_index}`)
        }
      }
      prevTags = evForContinuity.tags
      prevMotif = evForContinuity.motif
      prevStage = s.stage
    }

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
    const res = submitOption(s, opt.id, content, ev)

    // ---- 结果正文：到了玩家眼前没有 ----
    aftermath.picks++
    const lines = res.narrative?.lines ?? []
    if (lines.length > 0) {
      aftermath.withText++
      const text = lines.join('\n')
      aftermath.seen.add(text)
      const intro = introText.get(`${pres.event_id}@${pres.node_index}`)
      if (intro && text === intro) aftermath.sameAsIntro++
    }

    // ---- 链条兑现：声明了的下一拍，后来真的来了没有 ----
    const bands = ev.options.find((o) => o.id === opt.id)?.resolve?.bands ?? {}
    const declared = [
      ...(ev.chain?.next ?? []).map((n) => n.id),
      ...Object.values(bands).map((b) => String(b.queue_followup ?? '')).filter(Boolean),
    ].map((x) => x.split('@')[0]!)
    if (declared.length > 0) {
      chainBoard.declared++
      for (const id of declared) {
        pendingChain.push({ id })
        declaredChainTargets.add(id)
      }
    }

    s = res.state
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
L.push(`- 平均局内节点数：**${avgLen.toFixed(1)}**（目标 30–42，与 sim.ts 同一条门禁）`)
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

L.push(`## 七、事件衔接（通畅性）`)
L.push(``)
{
  const cov = continuity.nodes > 0 ? (continuity.withTransition / continuity.nodes) * 100 : 0
  L.push(`- 有承接句的节点：**${continuity.withTransition} / ${continuity.nodes}**（${cov.toFixed(1)}%）`)
  L.push(`- 阶段跃迁：${continuity.stageJumps} 次，其中没有交代的 ${continuity.stageJumpsBare} 次`)

  if (continuity.bareCuts.length === 0) {
    L.push(`- ✓ 没有出现「上一拍与这一拍毫无共用意象、且中间没有承接」的硬切`)
  } else {
    L.push(`- ✗ **${continuity.bareCuts.length} 处硬切**（上一件事与这一件事完全无关，中间没有说话）：`)
    for (const c of continuity.bareCuts.slice(0, 10)) L.push(`    - ${c}`)
    if (continuity.bareCuts.length > 10) L.push(`    - … 另有 ${continuity.bareCuts.length - 10} 处`)
  }

  if (continuity.motifChains > 0) {
    L.push(`- 有意连锁：${continuity.motifChains} 次（上一件事的 followup 正指向下一件，同一段情节的下一拍，不算问题）`)
  }
  if (continuity.motifRepeats.length === 0) {
    L.push(`- ✓ 没有无来由的母题紧邻重复`)
  } else {
    L.push(`- ✗ **${continuity.motifRepeats.length} 处母题紧邻重复**：`)
    for (const c of continuity.motifRepeats.slice(0, 8)) L.push(`    - ${c}`)
  }
  L.push(``)
  L.push(`> 这些是**结构判据**，能筛出"两件事之间没有接缝"。`)
  L.push(`> 筛不出"读起来别扭" —— 那需要模型通读连续几段，属于语义检查。`)
}
L.push(``)

L.push(`## 八、奇遇通道与结果正文`)
L.push(``)
{
  const perRun = (omenBoard.gates / Math.max(1, RUNS)).toFixed(2)
  L.push(`- 奇遇闸门：**${omenBoard.gates}** 次（${perRun}/局）· 坊市 ${omenBoard.shopGates} · 奇遇事件 ${omenBoard.eventGates}`)
  L.push(`- 接 / 不接：${omenBoard.take} / ${omenBoard.pass}`)
  L.push(`- 坊市：上架 ${omenBoard.shopOffers} 件次 · 成交 ${omenBoard.shopBought} 件`)
  if (omenBoard.gates === 0) {
    L.push(`- ✗ **一次奇遇都没有** —— 86 个奇遇事件白写了，而且不报错`)
  }
  const uniqOmen = omenBoard.seen.size
  L.push(`- 出现过的奇遇内容：**${uniqOmen}** 个不同 key`)
  L.push(``)
  const cov = (aftermath.withText / Math.max(1, aftermath.picks)) * 100
  L.push(`- 结果正文覆盖率：**${aftermath.withText} / ${aftermath.picks}**（${cov.toFixed(1)}%）· 不同文本 ${aftermath.seen.size} 条`)
  L.push(`- 与开场白**逐字全同**：**${aftermath.sameAsIntro}**（${((aftermath.sameAsIntro / Math.max(1, aftermath.picks)) * 100).toFixed(1)}%）`)
  L.push(``)
  L.push(`> 覆盖率是**100% 封顶的覆盖率**，不是比率 —— 每一手都该有一句结果正文，`)
  L.push(`> 低于 100% 就是显示路径断了（这一条曾经整整断过：数据在引擎里，UI 从没接过）。`)
  L.push(`> "逐字全同"不是重复率高，是**那一段根本没在说结果**，只是把开场白又念了一遍。`)
  L.push(``)
}
L.push(``)

L.push(`## 九、事件链的兑现`)
L.push(``)
if (chainBoard.declared === 0) {
  L.push(`本轮没有事件声明 chain.next / queue_followup。`)
} else {
  const rate = (chainBoard.realized / chainBoard.declared) * 100
  L.push(`- 声明了下一拍的事件：${chainBoard.declared} 次 · 真的兑现：${chainBoard.realized} 次（**${rate.toFixed(1)}%**）`)
  L.push(``)
  L.push(`> 修之前这个数长期是 **0.21%**（8/3840 节点）：保底队列被剧本前置链占着，`)
  L.push(`> 而 `+'`pickNextEvent`'+` 的保底路径只取 `+'`forced[0]`'+` —— 排在队尾的链条永远轮不到。`)
  L.push(`> 修法是把 `+'`queue_followup`'+` 改成**插队首**（剧本铺垫照旧插队尾），不取消任何一边。`)
}
L.push(``)

L.push(`## 十、行囊对不上的功能标签`)
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
