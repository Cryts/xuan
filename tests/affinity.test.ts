import { describe, expect, it } from 'vitest'
import {
  COUNTERS,
  ESSENCE_NAMES,
  PACK_ESSENCE,
  affinityHint,
  affinityModifier,
  affinityOf,
} from '../src/core/affinity'
import type { Essence } from '../src/core/types'

const ESSENCES: Essence[] = ['qi', 'body', 'spirit', 'law', 'will', 'shi']

describe('相性环', () => {
  it('相克环是完整的 5 元环：每条边都成立', () => {
    // 气克体 → 体克灵 → 灵克则 → 则克意 → 意克气
    expect(COUNTERS.qi).toBe('body')
    expect(COUNTERS.body).toBe('spirit')
    expect(COUNTERS.spirit).toBe('law')
    expect(COUNTERS.law).toBe('will')
    expect(COUNTERS.will).toBe('qi')
  })

  it('势不入环 —— 不克人、不被克', () => {
    expect(COUNTERS.shi).toBeNull()
    for (const e of ESSENCES) {
      if (e === 'shi') continue
      expect(affinityOf('shi', e)).toBe('neutral')
      expect(affinityOf(e, 'shi')).toBe('neutral')
    }
  })

  it('相克关系是反对称的', () => {
    for (const a of ESSENCES) {
      for (const b of ESSENCES) {
        if (a === b) continue
        const ab = affinityOf(a, b)
        const ba = affinityOf(b, a)
        if (ab === 'counter') expect(ba).toBe('countered')
        if (ab === 'countered') expect(ba).toBe('counter')
        if (ab === 'neutral') expect(ba).toBe('neutral')
      }
    }
  })

  it('同本体中性', () => {
    for (const e of ESSENCES) expect(affinityOf(e, e)).toBe('neutral')
  })

  it('克制 +30%，被克 −30%，中性 0', () => {
    expect(affinityModifier('qi', 'body')).toBeCloseTo(0.3)
    expect(affinityModifier('body', 'qi')).toBeCloseTo(-0.3)
    expect(affinityModifier('qi', 'spirit')).toBe(0)
  })

  it('六个体系包的本体映射符合设计', () => {
    expect(PACK_ESSENCE.mortal).toBe('qi')
    expect(PACK_ESSENCE.genius).toBe('qi')
    expect(PACK_ESSENCE.physique).toBe('body')
    expect(PACK_ESSENCE.mystery).toBe('spirit')
    expect(PACK_ESSENCE.rebel).toBe('will')
    expect(PACK_ESSENCE.cautious).toBe('shi')
  })

  it('气与气之间中性（凡人与天才同本体）', () => {
    expect(affinityOf(PACK_ESSENCE.mortal, PACK_ESSENCE.genius)).toBe('neutral')
  })

  it('提示文本包含双方本体名', () => {
    expect(affinityHint('qi', 'body')).toContain(ESSENCE_NAMES.qi)
    expect(affinityHint('qi', 'body')).toContain(ESSENCE_NAMES.body)
  })
})
