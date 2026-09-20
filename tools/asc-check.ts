/**
 * 登顶率核查 —— 各体系包的"最高境界被够到的比例"。
 *
 * 存在的理由：飞升类结局的条件写的是**绝对序号** `realm_idx >= 9`，
 * 而各包的阶梯长度根本不一样（灰雾之秘 10 层、太古遗蜕 18 层）。
 * 同一个 9，在 10 层的包里是顶上那一层，在 18 层的包里还不到一半。
 * 于是飞升率这个数**把两件不同的事混在一起**，看不出是谁的问题。
 * 这个脚本按包拆开看，一眼就能看出是长阶梯的包在灌水。
 */
import { buildContentDB } from './load-content'
import { PACK_IDS } from '../src/core/content'
import {
  bindContent, presentCurrent, startRun, submitDaily, submitOption, submitScenarioEntry,
} from '../src/core/engine'
import { rollGenesis } from '../src/core/genesis'
import { Rng } from '../src/core/rng'

const content = buildContentDB()
bindContent(content)

const RUNS = Number(process.argv[2] ?? 2000)
const tally = new Map<string, { n: number; top: number; idx9: number; rmax: number }>()

for (let i = 0; i < RUNS; i++) {
  const rng = new Rng(`asc-${i}`)
  const pack = PACK_IDS[i % PACK_IDS.length]!
  const g = rollGenesis(rng, content.origins, content.traits, content.flaws, pack)
  let s = startRun({
    runId: `a${i}`, seed: `asc-${i}`, packId: pack, originId: g.originId,
    traitIds: g.traitIds, flawId: g.flawId, content, destinyCount: 0,
  })
  let guard = 0
  while (s.status === 'alive' && guard++ < 200) {
    const p = presentCurrent(s, content)
    if (p.daily) { s = submitDaily(s, 'cultivate', content).state; continue }
    if (p.scenario_entry) { s = submitScenarioEntry(s, false, content).state; continue }
    const ev = content.events.find((e) => e.id === p.event_id)
    if (p.options.length > 0 && ev) {
      s = submitOption(s, p.options[rng.int(0, p.options.length - 1)]!.id, content, ev).state
      continue
    }
    break
  }
  const t = tally.get(pack) ?? { n: 0, top: 0, idx9: 0, rmax: 0 }
  t.n++
  if (s.realm_idx >= content.packs[pack]!.realms.length - 1) t.top++
  if (s.realm_idx >= 9) t.idx9++
  t.rmax = Math.max(t.rmax, s.realm_idx)
  tally.set(pack, t)
}

console.log('每包 ' + (RUNS / PACK_IDS.length) + ' 局\n')
console.log('体系包'.padEnd(12) + '层数'.padStart(6) + '到顶'.padStart(9) + 'idx≥9'.padStart(9) + '最高'.padStart(8))
for (const p of PACK_IDS) {
  const t = tally.get(p)!
  const n = content.packs[p]!.realms.length
  console.log(
    (content.packs[p]?.display_name ?? p).padEnd(12) +
      String(n).padStart(5) +
      ((t.top / t.n) * 100).toFixed(1).padStart(8) + '%' +
      ((t.idx9 / t.n) * 100).toFixed(1).padStart(8) + '%' +
      `${t.rmax}/${n - 1}`.padStart(9),
  )
}
