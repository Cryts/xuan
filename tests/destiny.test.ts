import { describe, expect, it } from 'vitest'
import {
  ARCHETYPE_NAMES,
  adaptSchemer,
  advanceFate,
  checkDestinyProtection,
  encounterModifier,
  generateDestinyChildren,
  killDestinyChild,
} from '../src/core/destiny'
import { PACK_IDS } from '../src/core/content'
import { Rng } from '../src/core/rng'
import type { DestinyChild, FateMilestone, GameState, PackId } from '../src/core/types'

/** 六个包都要有命运线模板 —— 位面之子来自**非玩家**的包，只给 mortal 会拿不到命运线 */
const fateTemplates: Partial<Record<PackId, FateMilestone[]>> = Object.fromEntries(
  PACK_IDS.map((p) => [
    p,
    Array.from({ length: 8 }, (_, i) => ({
      id: `fm_${p}_${i}`,
      name: `${p}里程碑${i}`,
      narrative: '……',
      power_gain: 20,
    })),
  ]),
) as Partial<Record<PackId, FateMilestone[]>>

function gen(count = 3, playerPack: PackId = 'mortal'): DestinyChild[] {
  return generateDestinyChildren({
    seed: 'test-seed',
    playerPack,
    allPacks: PACK_IDS,
    count,
    realmNames: { mortal: ['凡人', '炼气', '筑基'] },
    fateTemplates,
    regionTags: ['wild', 'cave'],
    oraclePool: ['天机未明。'],
  })
}

describe('位面之子生成', () => {
  it('生成数量正确，且全部来自与玩家不同的体系包', () => {
    const kids = gen(3, 'mortal')
    expect(kids.length).toBe(3)
    for (const k of kids) expect(k.pack).not.toBe('mortal')
  })

  it('同一 seed 完全可复现', () => {
    const a = gen(3)
    const b = gen(3)
    expect(a.map((k) => `${k.name}${k.pack}${k.archetype}${k.destiny_pool}`)).toEqual(
      b.map((k) => `${k.name}${k.pack}${k.archetype}${k.destiny_pool}`),
    )
  })

  it('count=0 时不生成', () => {
    expect(gen(0).length).toBe(0)
  })

  it('气运池初始为满', () => {
    for (const k of gen(3)) expect(k.destiny_pool).toBe(k.destiny_max)
  })

  it('每个原型都有中文名与说明', () => {
    for (const k of gen(5)) {
      expect(ARCHETYPE_NAMES[k.archetype]).toBeTruthy()
    }
  })
})

describe('气运护体 —— 主角不死性是可耗尽的资源', () => {
  it('气运池为 0 时不再受庇佑', () => {
    const kid = gen(1)[0]!
    kid.destiny_pool = 0
    for (let i = 0; i < 50; i++) {
      const r = checkDestinyProtection(kid, new Rng(`r${i}`))
      expect(r.protected).toBe(false)
      expect(r.coincidenceKey).toBe('destiny.protect.none')
    }
  })

  it('每次庇佑扣除一点气运池', () => {
    const kid = gen(1)[0]!
    kid.destiny_pool = 20
    kid.destiny_max = 20
    const before = kid.destiny_pool
    let protectedCount = 0
    for (let i = 0; i < 20; i++) {
      const r = checkDestinyProtection(kid, new Rng(`s${i}`))
      if (r.protected) protectedCount++
    }
    expect(protectedCount).toBeGreaterThan(0)
    expect(kid.destiny_pool).toBe(before - protectedCount)
  })

  it('气运越低，受庇佑概率越低 —— 磨光环是可行的', () => {
    const make = (pool: number, max: number): number => {
      const kid = gen(1)[0]!
      let hits = 0
      const TRIALS = 400
      for (let i = 0; i < TRIALS; i++) {
        kid.destiny_pool = pool
        kid.destiny_max = max
        if (checkDestinyProtection(kid, new Rng(`p${i}`)).protected) hits++
      }
      return hits / TRIALS
    }
    const high = make(10, 10)
    const low = make(1, 10)
    expect(high).toBeGreaterThan(low)
  })

  it('庇佑的巧合 key 按原型区分', () => {
    const kid = gen(1)[0]!
    kid.destiny_pool = 999
    kid.destiny_max = 999
    kid.archetype = 'turtle' // 苟道型庇佑概率最高
    const r = checkDestinyProtection(kid, new Rng('x'))
    if (r.protected) expect(r.coincidenceKey).toContain('turtle')
  })
})

describe('智谋型的反制 —— 会读你的牌', () => {
  it('只有智谋型会长抗性', () => {
    for (const arch of ['brute', 'turtle', 'ironic', 'tragic'] as const) {
      const kid = gen(1)[0]!
      kid.archetype = arch
      kid.used_against = ['火攻']
      adaptSchemer(kid)
      expect(kid.resistances).toEqual([])
    }
  })

  it('智谋型每次只读懂一种手段', () => {
    const kid = gen(1)[0]!
    kid.archetype = 'schemer'
    kid.used_against = ['火攻', '偷袭']
    adaptSchemer(kid)
    expect(kid.resistances.length).toBe(1)
    expect(kid.resistances[0]).toBe('火攻')
    adaptSchemer(kid)
    expect(kid.resistances.length).toBe(2)
  })

  it('已长出抗性的手段不再重复添加', () => {
    const kid = gen(1)[0]!
    kid.archetype = 'schemer'
    kid.used_against = ['火攻']
    adaptSchemer(kid)
    adaptSchemer(kid)
    adaptSchemer(kid)
    expect(kid.resistances).toEqual(['火攻'])
  })

  it('抗性显著提升庇佑概率', () => {
    const trial = (withResist: boolean): number => {
      let hits = 0
      const N = 500
      for (let i = 0; i < N; i++) {
        const kid = gen(1)[0]!
        kid.archetype = 'schemer'
        kid.destiny_pool = 3
        kid.destiny_max = 6
        if (withResist) kid.resistances = ['火攻']
        if (checkDestinyProtection(kid, new Rng(`q${i}`), '火攻').protected) hits++
      }
      return hits / N
    }
    expect(trial(true)).toBeGreaterThan(trial(false))
  })
})

describe('命运线推进', () => {
  it('推进是可复现的 —— 同一节点号结果一致', () => {
    const a = gen(1)[0]!
    const b = gen(1)[0]!
    const ra = advanceFate(a, 7)
    const rb = advanceFate(b, 7)
    expect(ra.advanced).toBe(rb.advanced)
    expect(a.fate_progress).toBe(b.fate_progress)
  })

  it('里程碑推进时战力增长', () => {
    const kid = gen(1)[0]!
    // 找任一能推进的节点
    let advanced = false
    for (let n = 1; n < 60; n++) {
      const before = kid.power_index
      if (advanceFate(kid, n).advanced) {
        expect(kid.power_index).toBeGreaterThan(before)
        advanced = true
        break
      }
    }
    expect(advanced).toBe(true)
  })

  it('命运线走完后只结算一次，不无限增长', () => {
    const kid = gen(1)[0]!
    kid.fate_progress = kid.fate_line.length
    const before = kid.power_index
    for (let n = 1; n < 80; n++) advanceFate(kid, n)
    // 只应有一次 +80 的成道增益
    expect(kid.power_index).toBe(Math.min(1000, before + 80))
    expect(kid.fate_complete).toBe(true)
  })
})

describe('截杀与继承', () => {
  it('杀死位面之子会继承他的因果 —— 杀主角是要还的', () => {
    const kid = gen(1)[0]!
    kid.fate_progress = 3
    const reward = killDestinyChild(kid)
    expect(kid.alive).toBe(false)
    expect(reward.inherited_debt).toBeGreaterThan(0)
    expect(reward.title).toContain('弑主')
    expect(reward.goldfinger_pack).toBe(kid.pack)
  })

  it('命运线走得越远，继承的因果越重', () => {
    const a = gen(1)[0]!
    const b = gen(1)[0]!
    a.fate_progress = 0
    b.fate_progress = 5
    expect(killDestinyChild(b).inherited_debt).toBeGreaterThan(
      killDestinyChild(a).inherited_debt,
    )
  })
})

describe('遭遇修正', () => {
  it('气运被磨得越多，玩家对抗修正越高', () => {
    const kid = gen(1)[0]!
    const state = { pack_id: 'mortal' } as GameState
    kid.destiny_pool = kid.destiny_max
    const fresh = encounterModifier(state, kid)
    kid.destiny_pool = 0
    const worn = encounterModifier(state, kid)
    expect(worn).toBeGreaterThan(fresh)
  })
})
