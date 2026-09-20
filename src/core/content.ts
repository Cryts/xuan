/**
 * 内容库加载与索引。
 *
 * 全部内容在构建期确定，运行时只读。这是「无实时 AIGC 内容面」的实现基础，
 * 也是纯静态部署的前提（SPEC 第 7、8 章）。
 */

import type {
  Affix,
  Destiny,
  Ending,
  Flaw,
  FateMilestone,
  Item,
  LooseEvent,
  Origin,
  PackId,
  Scenario,
  TermDict,
  Trait,
  WorldPack,
} from './types'

export interface Motif {
  id: string
  name: string
  source_archetype: string
  param_slots: string[]
  option_intents: string[]
  outcome_tendency: string[]
  risk_by_pack: Partial<Record<PackId, string>>
}

export interface NameBank {
  surname: string[]
  given_male: string[]
  given_female: string[]
  dao_title: { element: string[]; noun: string[]; suffix: string[] }
  sect: { place: string[]; suffix: string[] }
}

export interface ContentDB {
  packs: Record<PackId, WorldPack>
  terms: Partial<Record<PackId, TermDict>>
  motifs: Motif[]
  events: LooseEvent[]
  scenarios: Scenario[]
  endings: Ending[]
  origins: Origin[]
  traits: Trait[]
  flaws: Flaw[]
  destinies: Destiny[]
  /** L2 预生成叙事池：key → 候选文本 */
  l2: Record<string, string[]>
  oracle: string[]
  /** 天意庇佑的"合理巧合"池，按原型分 key */
  coincidence: Record<string, string[]>
  fateTemplates: Partial<Record<PackId, FateMilestone[]>>
  names: NameBank
  affixes: Affix[]
  items: Item[]
  version: string
}

export const PACK_IDS: PackId[] = [
  'mortal',
  'genius',
  'physique',
  'mystery',
  'rebel',
  'cautious',
]

/** 按 pack 建立事件索引，避免每节点全量扫描 */
export function indexEventsByPack(events: LooseEvent[]): Map<PackId | '*', LooseEvent[]> {
  const m = new Map<PackId | '*', LooseEvent[]>()
  for (const e of events) {
    const packs = e.pack.includes('*' as PackId) ? (['*'] as const) : e.pack
    for (const p of packs) {
      const arr = m.get(p) ?? []
      arr.push(e)
      m.set(p, arr)
    }
  }
  return m
}

/** 按 stage 再切一层，调度器只在这一小撮里抽样 */
export function indexEventsByStage(
  events: LooseEvent[],
): Map<string, LooseEvent[]> {
  const m = new Map<string, LooseEvent[]>()
  for (const e of events) {
    for (const s of e.stage) {
      const arr = m.get(s) ?? []
      arr.push(e)
      m.set(s, arr)
    }
  }
  return m
}

export function itemsById(items: Item[]): Map<string, Item> {
  return new Map(items.map((i) => [i.id, i]))
}

export function affixesById(affixes: Affix[]): Map<string, Affix> {
  return new Map(affixes.map((a) => [a.id, a]))
}

/** 把物品的词条展开成功能标签 —— 破局条件 affordance 匹配的依据 */
export function resolveAffordances(item: Item, affixes: Map<string, Affix>): string[] {
  const set = new Set<string>(item.affordance ?? [])
  for (const a of item.affixes) {
    const aff = affixes.get(a)
    if (aff) for (const tag of aff.affordance) set.add(tag)
  }
  return [...set]
}
