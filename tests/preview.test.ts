import { describe, expect, it } from 'vitest'
import { PACK_IDS, type ContentDB } from '../src/core/content'
import { previewFor } from '../src/core/preview'
import { loadContent } from '../tools/load-content'
import type { LooseEvent, Option, PackId, WorldPack } from '../src/core/types'

const raw = loadContent()
const content = {
  ...raw,
  packs: Object.fromEntries(PACK_IDS.map((p) => [p, raw.packs[p]])) as Record<PackId, WorldPack>,
  version: 't',
} as unknown as ContentDB

const allOptions: { ev: string; opt: Option }[] = []
for (const ev of content.events as LooseEvent[]) {
  for (const o of ev.options ?? []) allOptions.push({ ev: ev.id, opt: o })
}

describe('选项后果预告', () => {
  /**
   * 这条是本文件的**主要存在理由** —— 它是"预告变空"那类静默失效的闸门。
   *
   * `gain_hint` / `path_hint` 两个字段做了、`EventScreen` 也一直在渲染，
   * 但内容 1629 个选项里一条都没填（0 / 1629），界面上于是永远不显示，
   * 而且**不报错**。改成从效果派生之后，风险变了但没消失：
   * 内容里冒出一个派生函数不认识的新效果，那个选项的预告又会静默变空。
   */
  it('全库每个选项都至少有一条预告 —— 派生不认识新效果就会在这里断', () => {
    const empty = allOptions.filter(({ opt }) => {
      const p = previewFor(opt)
      return !p.gain && !p.path
    })
    expect(
      empty.map(({ ev, opt }) => `${ev}/${opt.id}`).slice(0, 20),
      `这些选项的预告是空的（多半是出现了 optionPreview 不认识的效果类型）`,
    ).toEqual([])
  })

  it('衍生文案不含阿拉伯数字 —— 与叙事同一套文本禁区', () => {
    const bad: string[] = []
    for (const { ev, opt } of allOptions) {
      const p = previewFor(opt)
      for (const t of [p.gain, p.path]) {
        if (t && /[0-9]/.test(t)) bad.push(`${ev}/${opt.id}: ${t}`)
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
  })

  it('有判定的选项分「成 / 败」两面说', () => {
    const opt = allOptions.find(({ opt }) => opt.resolve?.bands?.fail && opt.resolve?.bands?.success)
    expect(opt, '内容里应当有带判定的选项').toBeTruthy()
    const p = previewFor(opt!.opt)
    expect(p.gain).toContain('成则')
    expect(p.gain).toContain('败则')
  })

  it('同一变量不并列两档 —— 不产出「修为见长，修为略进」这种自相矛盾', () => {
    for (const { opt } of allOptions) {
      const g = previewFor(opt).gain ?? ''
      const head = g.split('；')[0] ?? ''
      const parts = head.replace(/^成则/, '').split('，').filter((x) => x.includes('修为'))
      expect(parts.length, `「${g}」把修为说了两遍`).toBeLessThanOrEqual(1)
    }
  })

  it('作者写了文案就以作者的为准 —— 派生只是兜底', () => {
    const opt: Option = {
      id: 'x',
      text: '试',
      intent: 'steady',
      risk_tier: '稳',
      gain_hint: '作者的话',
      outcome: { effects: [{ type: 'add_var', key: 'power', delta: 3 }] },
    } as Option
    expect(previewFor(opt).gain).toBe('作者的话')
  })

  it('伤势方向不能读反 —— hp 是伤势，正 delta = 伤得更重', () => {
    const hurt = { id: 'h', text: 't', intent: 'greedy', risk_tier: '险', outcome: { effects: [{ type: 'add_var', key: 'hp', delta: 20 }] } } as Option
    const healed = { id: 'c', text: 't', intent: 'steady', risk_tier: '稳', outcome: { effects: [{ type: 'add_var', key: 'hp', delta: -20 }] } } as Option
    expect(previewFor(hurt).gain).toBe('伤及筋骨')
    expect(previewFor(healed).gain).toBe('伤势大减')
  })
})
