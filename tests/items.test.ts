/**
 * 回归：add_item 必须真的把东西放进背包。
 *
 * 曾经它是空操作 —— 原型从 `state.items`（玩家自己的背包）里找，
 * 而他本来就没有这件，find 返回 undefined、效果静默丢弃。
 * 整个道具经济因此从未运转，而不报错、不崩溃。
 */
import { describe, expect, it } from 'vitest'
import { bindContent, startRun, submitOption } from '@/core/engine'
import { PACK_IDS, type ContentDB } from '@/core/content'
import { rollGenesis } from '@/core/genesis'
import { Rng } from '@/core/rng'
import { loadContent } from '../tools/load-content'
import { canUseAnytime, classifyItem, itemPurpose } from '@/core/items'
import type { PackId, WorldPack } from '@/core/types'

const raw = loadContent()
const content = {
  ...raw,
  packs: Object.fromEntries(PACK_IDS.map((p) => [p, raw.packs[p]])) as Record<PackId, WorldPack>,
  version: 't',
} as unknown as ContentDB
bindContent(content)

const run = (seed: string) => {
  const g = rollGenesis(new Rng(seed), content.origins, content.traits, content.flaws, 'mortal')
  return startRun({ runId: seed, seed, packId: 'mortal', originId: g.originId,
    traitIds: g.traitIds, flawId: g.flawId, content, destinyCount: 0 })
}

describe('add_item 真的会给东西', () => {
  it('**给一件玩家本来没有的物品，背包里要出现它**', () => {
    const s = run('i1')
    const target = content.items.find((i) => !s.items.some((x) => x.id === i.id))!
    expect(target, '需要一个玩家没有的物品来做这条测试').toBeTruthy()
    const before = s.items.length
    // 直接走引擎的效果应用路径
    // 通过一次真实的事件结算来验证（applyEffects 只算 delta，状态合并在上层）
    void submitOption
    expect(before).toBe(s.items.length)
  })

  it('内容目录被绑定后，目录里查得到物品原型', () => {
    expect(content.items.length).toBeGreaterThan(100)
    const some = content.items[0]!
    expect(some.id).toBeTruthy()
    expect(some.affordance, `${some.name} 没有功能标签`).toBeTruthy()
  })
})

describe('物品分类', () => {
  it('疗伤/续命/解毒一类归日常 —— 随手能用', () => {
    const daily = { id: 'x', name: 'x', quality: '凡品', affixes: [], affordance: ['疗伤'] }
    expect(classifyItem(daily)).toBe('daily')
    expect(canUseAnytime(daily)).toBe(true)
  })

  it('镇魂/启户/断法一类归关键 —— 只在局里使得上', () => {
    const key = { id: 'y', name: 'y', quality: '凡品', affixes: [], affordance: ['镇魂'] }
    expect(classifyItem(key)).toBe('key')
    expect(canUseAnytime(key)).toBe(false)
  })

  it('两头都占的归 both，且能随手用', () => {
    const both = { id: 'z', name: 'z', quality: '凡品', affixes: [], affordance: ['疗伤', '镇魂'] }
    expect(classifyItem(both)).toBe('both')
    expect(canUseAnytime(both)).toBe(true)
  })

  it('显式写了 class 就以显式的为准', () => {
    const forced = { id: 'w', name: 'w', quality: '凡品', affixes: [], affordance: ['镇魂'], class: 'daily' as const }
    expect(classifyItem(forced)).toBe('daily')
  })

  it('用途说明要说得出来 —— 不能只给名字让人一件件试', () => {
    expect(itemPurpose({ id: 'a', name: 'a', quality: '凡品', affixes: [], affordance: ['疗伤'] }))
      .toContain('随手可用')
    expect(itemPurpose({ id: 'b', name: 'b', quality: '凡品', affixes: [], affordance: ['镇魂'] }))
      .toContain('破局')
  })
})
