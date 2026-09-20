import { describe, expect, it } from 'vitest'
import {
  START_AGE, UNBOUNDED_LIFESPAN, advanceNode, ageInfoOf, ageLabelOf,
  lifespanCapOf, startRun, yearsBucket, yearsPerNode, checkEnd, composeTransition,
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

function fresh(seed = 'age-test'): GameState {
  const rng = new Rng(seed)
  const g = rollGenesis(rng, content.origins, content.traits, content.flaws, 'mortal')
  return startRun({
    runId: seed, seed, packId: 'mortal', originId: g.originId,
    traitIds: g.traitIds, flawId: g.flawId, content, destinyCount: 0,
  })
}

describe('年龄与寿元是两个量', () => {
  it('开局是个少年，不是"揣着一百二十年"', () => {
    const s = fresh()
    expect(s.age).toBe(START_AGE)
    // 折损从 0 起 —— 它不是"剩余寿命"
    expect(s.vars.lifespan).toBe(0)
  })

  it('寿元上限由境界决定 —— 境界表里的数字是"能活到多少岁"', () => {
    const s = fresh()
    const realm0 = content.packs.mortal.realms[0]!
    expect(lifespanCapOf(s, content)).toBe(realm0.lifespan)
    // 不是把上限当初始值发给你
    expect(s.age).toBeLessThan(lifespanCapOf(s, content))
  })

  it('突破大境界会把寿元上限整个抬上去', () => {
    const s = fresh()
    const before = lifespanCapOf(s, content)
    // 越过第一个大境界
    const next = { ...s, realm_idx: 1, vars: { ...s.vars, power: 200 } }
    expect(lifespanCapOf(next, content)).toBeGreaterThan(before)
  })

  it('折损会压低上限，延寿会抬高', () => {
    const s = fresh()
    const base = lifespanCapOf(s, content)
    expect(lifespanCapOf({ ...s, vars: { ...s.vars, lifespan: -30 } }, content)).toBe(base - 30)
    expect(lifespanCapOf({ ...s, vars: { ...s.vars, lifespan: 40 } }, content)).toBe(base + 40)
  })

  it('年龄随时间增长，且高境界走得快', () => {
    const s = fresh()
    expect(yearsPerNode({ ...s, realm_idx: 0 })).toBeLessThan(yearsPerNode({ ...s, realm_idx: 6 }))
    const after = advanceNode(s, content)
    expect(after.age).toBeGreaterThan(s.age)
    expect(after.last_years).toBeGreaterThan(0)
  })

  it('年龄追上上限就是寿尽 —— 停在低境界会老死', () => {
    const s = fresh()
    const cap = lifespanCapOf(s, content)
    const nearDeath = { ...s, age: cap - 1 }
    expect(checkEnd(nearDeath, content).status).toBe('alive')
    expect(checkEnd({ ...s, age: cap }, content).status).toBe('ended')
    expect(checkEnd({ ...s, age: cap }, content).end_reason).toBe('lifespan')
  })

  it('真仙以上不受寿数所限', () => {
    const s = fresh()
    const immortal = { ...s, realm_idx: content.packs.mortal.realms.length - 1 }
    const info = ageInfoOf(immortal, content)
    // 末境 lifespan 为 null → 视作不限
    expect(lifespanCapOf(immortal, content)).toBeGreaterThanOrEqual(UNBOUNDED_LIFESPAN - 100000)
    expect(info.age).toBeLessThan(info.cap)
  })

  it('ageLabelOf 给出「年龄 X / 寿元 Y」', () => {
    const s = fresh()
    const label = ageLabelOf(s, content)
    expect(label).toContain('年龄')
    expect(label).toMatch(/寿元|寿数不限/)
    expect(label).not.toContain(undefined as unknown as string)
  })

  it('年数分档覆盖各跨度', () => {
    expect(yearsBucket(2)).toBe('few')
    expect(yearsBucket(10)).toBe('some')
    expect(yearsBucket(50)).toBe('many')
    expect(yearsBucket(500)).toBe('ages')
  })
})

describe('过渡句（事件衔接）', () => {
  it('开局第一拍前面没有东西可接，不产生过渡', () => {
    const s = fresh()
    expect(composeTransition({ ...s, node_index: 0 }, content, new Rng('t'))).toBeUndefined()
  })

  it('推进之后会给出过渡句', () => {
    const s = advanceNode(fresh(), content)
    const t = composeTransition(s, content, new Rng('t'))
    expect(t, '推进之后应当有承接上一件事的过渡句').toBeTruthy()
    expect(t!.length).toBeGreaterThan(0)
  })

  it('过渡句里的年数来自状态层，不是文本层编的', () => {
    let s = fresh()
    for (let i = 0; i < 12; i++) s = advanceNode(s, content)
    // 找一个用了 {years} 的档位
    const t = composeTransition({ ...s, realm_idx: 9, last_realm_idx: 9, stage: s.stage }, content, new Rng('t'))
    // 无论取到哪一条，都不该残留未替换的占位符
    if (t) expect(t).not.toContain('{years}')
  })

  it('六个体系包都能生成过渡句', () => {
    for (const p of PACK_IDS) {
      const rng = new Rng(`tr-${p}`)
      const g = rollGenesis(rng, content.origins, content.traits, content.flaws, p)
      let s = startRun({
        runId: `tr-${p}`, seed: `tr-${p}`, packId: p, originId: g.originId,
        traitIds: g.traitIds, flawId: g.flawId, content, destinyCount: 0,
      })
      s = advanceNode(s, content)
      const t = composeTransition(s, content, new Rng(`tr-${p}`))
      expect(t, `${p} 取不到过渡句`).toBeTruthy()
    }
  })
})
