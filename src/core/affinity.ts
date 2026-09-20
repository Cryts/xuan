/**
 * 相性系统 —— 跨体系对抗的地基。见 SPEC 第 5 章。
 *
 * 每条相克边都由小说逻辑支撑，不是随便连的：
 *   气 克 体 —— 灵气可淬炼、亦可侵蚀肉身
 *   体 克 灵 —— 以力破巧，蛮力冲垮精神
 *   灵 克 则 —— 认知可以理解、污染、扭曲规则
 *   则 克 意 —— 天地规则碾压逆天意志
 *   意 克 气 —— 意志强行催动、打散能量
 *   势 —— 不入环：不克人、不被克，但极难被杀（替身/后手）
 */

import type { Essence, PackId } from './types'

/** 相克环：key 克 value */
export const COUNTERS: Record<Essence, Essence | null> = {
  qi: 'body', // 气克体
  body: 'spirit', // 体克灵
  spirit: 'law', // 灵克则
  law: 'will', // 则克意
  will: 'qi', // 意克气
  shi: null, // 势不入环
}

export const ESSENCE_NAMES: Record<Essence, string> = {
  qi: '气',
  body: '体',
  spirit: '灵',
  law: '则',
  will: '意',
  shi: '势',
}

export const PACK_ESSENCE: Record<PackId, Essence> = {
  mortal: 'qi',
  genius: 'qi',
  physique: 'body',
  mystery: 'spirit',
  rebel: 'will',
  cautious: 'shi',
}

export type AffinityResult = 'counter' | 'countered' | 'neutral'

/**
 * 判定 a 对 b 的相性。
 * - counter   : a 克 b，a 的判定 +30%
 * - countered : a 被 b 克，a 的判定 −30%
 * - neutral   : 同本体、或任一方为「势」
 */
export function affinityOf(a: Essence, b: Essence): AffinityResult {
  if (a === b) return 'neutral'
  if (a === 'shi' || b === 'shi') return 'neutral' // 势不入环
  if (COUNTERS[a] === b) return 'counter'
  if (COUNTERS[b] === a) return 'countered'
  return 'neutral'
}

const AFFINITY_MODIFIER: Record<AffinityResult, number> = {
  counter: 0.3,
  countered: -0.3,
  neutral: 0,
}

/** 相性对判定成功率的绝对加成（加到 base 上，最终会被 clamp 到合法区间） */
export function affinityModifier(a: Essence, b: Essence): number {
  return AFFINITY_MODIFIER[affinityOf(a, b)]
}

/** 给 UI 用的一句话解释 */
export function affinityHint(a: Essence, b: Essence): string {
  const r = affinityOf(a, b)
  const an = ESSENCE_NAMES[a]
  const bn = ESSENCE_NAMES[b]
  if (r === 'counter') return `${an}克${bn} —— 你的本体压制对方`
  if (r === 'countered') return `${bn}克${an} —— 你的本体被对方压制`
  return `${an}与${bn}不相克`
}
