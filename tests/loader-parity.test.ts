/**
 * 两套加载器必须给出一致的内容。
 *
 * 为什么要有这条：`src/ui/store.ts` 的 `loadContent()`（浏览器侧，走
 * import.meta.glob）和 `tools/load-content.ts`（Node 侧，走 fs）是**两份独立
 * 实现**，都在干"把 src/content 下的 JSON 读成一个 ContentDB"。
 *
 * 结果是：所有引擎测试、门禁、蒙特卡洛都走 Node 那套（它是对的），
 * 而线上跑的浏览器那套坏了两处却没人发现 ——
 *   1. 体系包恒取兜底，真实内容从未生效（线上跑在占位包上）
 *   2. 判据多写了一个 `!Array.isArray(effects)`，89 条词条只剩 29 条
 * 两处都是静默的：不报错，只是内容悄悄变少。
 *
 * 所以这条测试不比"能不能跑"，比**数量与关键字段是否一致**。
 */
import { describe, expect, it } from 'vitest'
import { loadContent as loadBrowser } from '@/ui/store'
import { loadContent as loadNode } from '../tools/load-content'
import { PACK_IDS } from '@/core/content'
import type { PackId } from '@/core/types'

const browser = loadBrowser()
const node = loadNode()

describe('加载器一致性：浏览器侧 vs Node 侧', () => {
  it('事件 / 剧本 / 结局 / 物品 数量一致', () => {
    expect(browser.events.length, '事件数').toBe(node.events.length)
    expect(browser.scenarios.length, '剧本数').toBe(node.scenarios.length)
    expect(browser.endings.length, '结局数').toBe(node.endings.length)
    expect(browser.items.length, '物品数').toBe(node.items.length)
    expect(browser.affixes.length, '词条数').toBe(node.affixes.length)
    expect(browser.motifs.length, '母题数').toBe(node.motifs.length)
  })

  it('叙事池 key 数一致', () => {
    expect(Object.keys(browser.l2).length, 'L2 key 数').toBe(Object.keys(node.l2).length)
  })

  it('**六个体系包都是真内容，不是兜底**', () => {
    for (const p of PACK_IDS) {
      const bp = browser.packs[p]
      const np = node.packs[p]
      expect(bp, `${p} 缺失`).toBeTruthy()
      expect(bp!.version, `${p} 是兜底包`).not.toBe('fallback')
      expect(bp!.inspiration_tag, `${p} 的来历是兜底`).not.toContain('兜底')
      // 真内容的境界表是有台阶的，兜底那套是通用梯子
      expect(bp!.realms.length, `${p} 的境界数与 Node 侧不一致`)
        .toBe(np!.realms.length)
    }
  })

  it('体系包的关键字段逐项一致（不只是数量）', () => {
    for (const p of PACK_IDS as PackId[]) {
      const b = browser.packs[p]!
      const n = node.packs[p]!
      expect(b.display_name, `${p} 显示名`).toBe(n.display_name)
      expect(b.essence, `${p} 本体`).toBe(n.essence)
      expect(b.realms.map((r) => r.name), `${p} 境界序列`).toEqual(n.realms.map((r) => r.name))
      expect(b.realms.map((r) => r.power_index), `${p} 境界曲线`)
        .toEqual(n.realms.map((r) => r.power_index))
    }
  })

  it('词条带 effects 的那批没有被丢掉', () => {
    const withEffects = browser.affixes.filter((a) => (a.effects ?? []).length > 0)
    expect(withEffects.length, '带 effects 的词条数').toBeGreaterThan(40)
    const nodeWithEffects = node.affixes.filter((a) => (a.effects ?? []).length > 0)
    expect(withEffects.length).toBe(nodeWithEffects.length)
  })

  it('物品的功能标签与 Node 侧一致（破局系统靠它）', () => {
    const tagSet = (items: { affordance?: string[] }[]) => {
      const s = new Set<string>()
      for (const it of items) for (const a of it.affordance ?? []) s.add(a)
      return [...s].sort()
    }
    const b = tagSet(browser.items)
    const n = tagSet(node.items)
    expect(b.length, `浏览器侧标签数 ${b.length}，Node 侧 ${n.length}`).toBe(n.length)
    expect(b).toEqual(n)
  })
})
