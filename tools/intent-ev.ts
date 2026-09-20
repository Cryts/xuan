/**
 * 风险对价表 —— 各 `intent` 的期望产出。
 *
 * 存在的理由：支配性检测（sim.ts）能告诉我们"某条路线更优"，
 * 但不能告诉我们**为什么**。看过一次 87% 的差，查下来根子在这里：
 * 「稳」类选项大多是**无判定**的保底产出，而「贪/恶」类要过判定，
 * 失败还要倒扣。若前者期望不显著低于后者，风险就没有对价 ——
 * 那"冒险"就不是抉择，是纯粹的亏。
 *
 * 这个脚本把内容里**所有选项**按 intent 摊开，算期望增量。
 * 它是工具不是门禁：数字要有解释才有意义，阈值会随内容一起变。
 */
import { loadContent } from './load-content'
import type { Effect, LooseEvent, Option } from '../src/core/types'

const content = loadContent()

const BANDS = ['crit', 'success', 'fail', 'crit_fail'] as const

/** 判定成功率：roll.base 加上属性推力 —— 这里只要一个平均值，用实测中位数估 */
const ATTR_TYPICAL = 43

function bandProbs(o: Option) {
  const r = (o as { resolve?: { roll?: { attr?: string; attr_weight?: number; base?: number } } }).resolve
  if (!r?.roll) return null
  const push = (r.roll.attr_weight ?? 0) * ATTR_TYPICAL
  const p = Math.max(0.03, Math.min(0.97, (r.roll.base ?? 0.5) + push))
  // 引擎：success 与 fail 各占（1 − 两头）的一半
  const tail = 0.06
  return { crit: tail, success: p * (1 - tail * 2), fail: (1 - p) * (1 - tail * 2), crit_fail: tail }
}

/** 一个效果对"净值"的贡献。power 记正，hp/寿元/污染/因果记负 —— 都是代价 */
const VALUED = ['power', 'currency', 'rare_mat', 'favor', 'insight', 'hp', 'lifespan', 'corruption', 'debt', 'exposure', 'karma']
// (unused)
const WEIGHT: Record<string, number> = { power: 1, hp: -1.2, currency: 0.15, rare_mat: 3, corruption: -0.8, debt: -0.5, exposure: -0.3, favor: 0.2, insight: 0.5, lifespan: -2, karma: 0.3 }

function valueOf(effects: Effect[] | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  let scalar = 0
  for (const e of effects ?? []) {
    if (e.type === 'add_var') {
      const k = (e as { key: string }).key
      if (VALUED.includes(k)) {
        out[k] = (out[k] ?? 0) + (e as { delta: number }).delta
        scalar += WEIGHT[k] * (e as { delta: number }).delta
      }
    } else if (e.type === 'add_item') scalar += 4
  }
  out['__net'] = scalar
  return out
}

interface Acc { n: number; guarded: number; net: number; power: number; hp: number; currency: number }
const byIntent = new Map<string, Acc>()
const byIntentGuarded = new Map<string, Acc>()

function bump(m: Map<string, Acc>, key: string, v: Record<string, number>) {
  const a = m.get(key) ?? { n: 0, guarded: 0, net: 0, power: 0, hp: 0, currency: 0 }
  a.n++
  a.net += v['__net'] ?? 0
  a.power += v['power'] ?? 0
  a.hp += v['hp'] ?? 0
  a.currency += v['currency'] ?? 0
  m.set(key, a)
}

let options = 0
for (const ev of content.events as LooseEvent[]) {
  for (const o of ev.options ?? []) {
    options++
    const it = o.intent ?? '(无)'
    const r = (o as { resolve?: { bands?: Record<string, { effects?: Effect[] }> } }).resolve
    const guaranteed = (o as { outcome?: { effects?: Effect[] } }).outcome
    if (!r && guaranteed) {
      // 无判定：一定拿到的产出
      bump(byIntent, it, valueOf(guaranteed.effects))
      bump(byIntentGuarded, it, valueOf(guaranteed.effects))
      const a = byIntent.get(it)!; a.guarded++
      byIntentGuarded.get(it)!.guarded++
      continue
    }
    if (r?.bands) {
      const probs = bandProbs(o) ?? { crit: 0.05, success: 0.45, fail: 0.45, crit_fail: 0.05 }
      const ev: Record<string, number> = {}
      for (const b of BANDS) {
        const v = valueOf(r.bands[b]?.effects)
        for (const [k, x] of Object.entries(v)) ev[k] = (ev[k] ?? 0) + x * (probs[b] ?? 0)
      }
      bump(byIntent, it, ev)
      // 只看成功两段：判定选项的"上限"
      const wv: Record<string, number> = {}
      const wsum = probs.crit + probs.success
      for (const b of ['crit', 'success'] as const) {
        const v = valueOf(r.bands[b]?.effects)
        for (const [k, x] of Object.entries(v)) wv[k] = (wv[k] ?? 0) + (x * probs[b]) / wsum
      }
      bump(byIntentGuarded, it, wv)
      byIntentGuarded.get(it)!.guarded++
    }
  }
}

const rows = [...byIntent.entries()].sort((a, b) => (b[1].net / b[1].n) - (a[1].net / a[1].n))
console.log(`扫过 ${options} 个选项\n`)
console.log('intent'.padEnd(12) + '选项'.padStart(6) + '无判定'.padStart(8) + '期望净值'.padStart(10) + '期望战力'.padStart(10) + '期望伤势'.padStart(10) + '期望灵石'.padStart(10))
for (const [it, a] of rows) {
  console.log(
    it.padEnd(12) + String(a.n).padStart(6) + `${((a.guarded / a.n) * 100).toFixed(0)}%`.padStart(8) +
    (a.net / a.n).toFixed(2).padStart(10) + (a.power / a.n).toFixed(1).padStart(10) +
    (a.hp / a.n).toFixed(1).padStart(10) + (a.currency / a.n).toFixed(1).padStart(10),
  )
}
console.log('\n（期望净值把战力记正、伤势/污染/因果/折损记负、物品折算为 +4。权重是主观的，看的是**排序**不是绝对值。）')
