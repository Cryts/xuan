import { describe, expect, it } from 'vitest'
import { progressNameOf, recomputeProgress, subLevelsOf } from '../src/core/engine'
import { PACK_IDS, type ContentDB } from '../src/core/content'
import { loadContent } from '../tools/load-content'
import type { GameState, PackId, WorldPack } from '../src/core/types'

const raw = loadContent()
const content = {
  ...raw,
  packs: Object.fromEntries(PACK_IDS.map((p) => [p, raw.packs[p]])) as Record<PackId, WorldPack>,
  version: 't',
} as unknown as ContentDB

function stateAt(power: number, pack: PackId = 'mortal'): GameState {
  const base = {
    pack_id: pack, realm_idx: 0, minor_idx: 0, power_index: 0,
    vars: { power }, attrs: {}, items: [], relations: [], learned_rules: [],
    flags: {}, faction_tier: {}, destiny_children: [],
  } as unknown as GameState
  return recomputeProgress(base, content)
}

describe('小境界', () => {
  it('凡人没有小境界', () => {
    const realm = content.packs.mortal.realms[0]!
    expect(subLevelsOf(realm, 0)).toEqual([])
  })

  it('首个大境界分九层', () => {
    const realm = content.packs.mortal.realms[1]!
    expect(subLevelsOf(realm, 1).length).toBe(9)
  })

  it('更高境界分初期/中期/后期/圆满', () => {
    const realm = content.packs.mortal.realms[3]!
    expect(subLevelsOf(realm, 3)).toEqual(['初期', '中期', '后期', '圆满'])
  })

  it('境界名会带上小境界', () => {
    // 取炼气段中间的 power_index，换算回需要的累积修为
    const realm = content.packs.mortal.realms[1]!
    const mid = (realm.power_index[0] + realm.power_index[1]) / 2
    const s = stateAt(mid / 0.26)
    const name = progressNameOf(s, content)
    expect(name, `实际得到「${name}」`).toMatch(/^炼气.+/)
  })

  it('整局走下来会经过多个小境界，而不是几级大跳', () => {
    const seen = new Set<string>()
    for (let power = 0; power <= 1400; power += 12) {
      seen.add(progressNameOf(stateAt(power), content))
    }
    // 至少经过 20 个不同的境界状态（含小境界）
    expect(seen.size, `只经过了 ${seen.size} 个境界状态：${[...seen].join('/')}`).toBeGreaterThanOrEqual(20)
  })

  it('小境界随修为单调不回退', () => {
    let lastIdx = -1
    let lastMinor = -1
    for (let power = 0; power <= 900; power += 8) {
      const s = stateAt(power)
      const flat = s.realm_idx * 100 + s.minor_idx
      expect(flat, `power=${power} 处境界回退`).toBeGreaterThanOrEqual(lastIdx < 0 ? 0 : lastIdx * 100 + lastMinor - 0)
      lastIdx = s.realm_idx
      lastMinor = s.minor_idx
    }
  })

  it('六个体系包都能算出小境界名', () => {
    for (const p of PACK_IDS) {
      const name = progressNameOf(stateAt(150, p), content)
      expect(name, `${p} 取不到境界名`).toBeTruthy()
      expect(name).not.toBe('未知')
    }
  })
})
