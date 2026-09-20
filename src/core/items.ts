/**
 * 物品的分类与使用。
 *
 * 玩家定的规则：物品分成**日常物品**与**剧本关键物品**。
 *   日常 —— 随手可用，任何时候掏出来都说得通
 *   关键 —— 只在特定局面里成立，是破局用的
 *
 * 分类不靠人去标：205 件物品一件件标注既累又会漏，而**功能标签本来就
 * 说明了它是干什么的**。`疗伤` 的当然是日常，`镇魂` 的显然是关键。
 * 所以这里由标签派生，内容侧只在两者都说得通时显式写 `class`。
 */

import type { Item, ItemClass } from './types'

/**
 * 日常向的功能标签 —— 掏出来就用，不挑场合。
 * 疗伤、续命、解毒是救命；聚运、匿形、挪移、遁地是行动；
 * 引火、照明、御风、传讯是杂用；护主、储灵、承载是携带增益。
 */
export const DAILY_AFFORDANCES = new Set([
  '疗伤', '续命', '解毒', '聚运', '匿形', '挪移', '遁地', '御风',
  '引火', '照明', '传讯', '护主', '储灵', '承载', '议价', '称量',
])

/**
 * 关键向的功能标签 —— 只在特定局面里成立。
 * 镇魂、封印、断法、破封是解局；启户、隔水、溯涧是过关；
 * 通灵、洞察、溯源是读局；缚身、惑心、召引是制人。
 */
export const KEY_AFFORDANCES = new Set([
  '镇魂', '封印', '断法', '启户', '隔水', '通灵', '洞察', '溯源',
  '缚身', '惑心', '召引', '御法', '铭刻', 'dl_ink', '噬主', '破甲',
])

/** 由标签派生物品的类别；显式写了 class 就以显式的为准 */
export function classifyItem(item: Item): ItemClass {
  if (item.class) return item.class
  const tags = item.affordance ?? []
  if (tags.length === 0) return 'daily'
  const daily = tags.filter((t) => DAILY_AFFORDANCES.has(t)).length
  const key = tags.filter((t) => KEY_AFFORDANCES.has(t)).length
  if (daily > 0 && key > 0) return 'both'
  if (key > 0) return 'key'
  return 'daily'
}

/** 能不能随手用 */
export function canUseAnytime(item: Item): boolean {
  const c = classifyItem(item)
  return c === 'daily' || c === 'both'
}

/**
 * 一件物事的用途说明 —— 界面用它告诉玩家"这东西是干嘛的"。
 * 玩家原话里有"玩家无法了解这些选项背后的价值"，物品同理：
 * 只给名字不给用途，等于让人一件件试。
 */
export function itemPurpose(item: Item): string {
  const c = classifyItem(item)
  const key = (item.affordance ?? []).filter((t) => KEY_AFFORDANCES.has(t))
  const daily = (item.affordance ?? []).filter((t) => DAILY_AFFORDANCES.has(t))
  if (c === 'key' && key.length > 0) return `破局之用 · ${key.join('、')}`
  if (c === 'daily' && daily.length > 0) return `随手可用 · ${daily.join('、')}`
  if (c === 'both') return `常备 · ${[...daily, ...key].join('、')}`
  return '一时看不出用途'
}
