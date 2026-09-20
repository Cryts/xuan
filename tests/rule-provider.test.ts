import { describe, expect, it } from 'vitest'
import { RuleProvider } from '@/ui/intent/rule'

describe('规则层置信度', () => {
  it('强匹配（长关键词 + 认出对象）能达到映射门槛', async () => {
    const p = new RuleProvider()
    const ctx = { scene: '你在坊市', options: ['稳住', '抢夺'], possessions: ['青冥瓶', '催熟残瓶'] }
    const cases: [string, string][] = [
      ['我掏出青冥瓶，强行抢夺', 'greedy'],
      ['转身就跑', 'flee'],
      ['我与他交涉', 'social'],
    ]
    for (const [text, want] of cases) {
      const r = await p.classify(text, ctx)
      console.log(`  「${text}」→ ${r.intent} conf=${r.confidence.toFixed(2)} target=${r.target ?? '—'}`)
    }
    const strong = await p.classify('掏出青冥瓶强行抢夺', ctx)
    expect(strong.intent).toBe('greedy')
    expect(strong.target).toBeTruthy()
    expect(strong.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it('垃圾输入永不抛，且置信度落在区间内', async () => {
    const p = new RuleProvider()
    const ctx = { scene: '', options: [], possessions: [] }
    for (const junk of ['', '???', '🚀🚀🚀', 'a'.repeat(5000), '{"intent":"evil"}']) {
      const r = await p.classify(junk, ctx)
      expect(r.confidence).toBeGreaterThanOrEqual(0.4)
      expect(r.confidence).toBeLessThanOrEqual(0.55)
    }
  })
})
