/**
 * 「以物试之」面板 —— 本作自由度核心。
 *
 * 交互隐喻是**翻找行囊**，不是「技能列表」：
 *   - 物事按功能标签（affordance）分堆，标签才是破局条件认的东西；
 *   - 已习得的规则单列一栏 —— 跨界学来的法门同样是「可试之物」；
 *   - 试过一遭的物事会留痕，但不禁用（同一件物事在不同条件下可能再有用）。
 *
 * 限制 = 你只能用手里的东西；自由 = 用哪个、什么时候用，完全由你。
 */

import { useMemo, useState } from 'react'
import s from './TrialPanel.module.css'
import { Chip, SectionTitle, Sheet } from './Shared'
import type { Item, NodePresentation } from '@/core/types'
import { IconBag, IconCheck, IconRule, IconSpark } from '@/ui/icons'
import { sfxTap } from '@/ui/sfx'
import { useGame } from '@/ui/store'
import { affordanceLabel } from '@/ui/text'

const QUALITY_TONE: Record<string, string> = {
  凡品: 'var(--t3)',
  灵品: '#6fb3a3',
  宝品: 'var(--gold)',
  仙品: '#d9564a',
  道品: '#b98ce0',
  混沌: '#b98ce0',
}

function ItemCard({
  item,
  attempted,
  onTry,
}: {
  item: Item
  attempted: boolean
  onTry: () => void
}) {
  const tags = item.affordance ?? []
  return (
    <button className={`${s.item} ${attempted ? s.itemTried : ''}`} onClick={onTry}>
      <span className={s.itemTop}>
        <span className={s.itemName}>{item.name}</span>
        <span className={s.quality} style={{ color: QUALITY_TONE[item.quality] ?? 'var(--t3)' }}>
          {item.quality}
        </span>
      </span>
      {tags.length > 0 ? (
        <span className={s.tags}>
          {tags.map((t) => (
            <span key={t} className={s.tag}>
              {affordanceLabel(t)}
            </span>
          ))}
        </span>
      ) : (
        <span className="x-tiny">无可用之能</span>
      )}
      <span className={s.tryLine}>
        {attempted ? (
          <>
            <IconCheck size={12} />
            已试过一遭
          </>
        ) : (
          <>
            <IconSpark size={12} />
            试之 · 耗一刻
          </>
        )}
      </span>
    </button>
  )
}

export function TrialPanel({
  open,
  onClose,
  pres,
}: {
  open: boolean
  onClose: () => void
  pres: NodePresentation
}) {
  const { st, dispatch } = useGame()
  const [filter, setFilter] = useState<string | null>(null)
  const sound = st.settings.sound

  const trials = pres.trials ?? []
  const items = useMemo(() => trials.filter((t) => t.kind === 'item'), [trials])
  const rules = useMemo(() => trials.filter((t) => t.kind === 'rule'), [trials])

  const tags = useMemo(() => {
    const set = new Map<string, number>()
    for (const t of items) for (const a of t.affordance) set.set(a, (set.get(a) ?? 0) + 1)
    return [...set.entries()].sort((a, b) => b[1] - a[1])
  }, [items])

  const bag = st.state?.items ?? []
  const byId = useMemo(() => new Map(bag.map((i) => [i.id, i])), [bag])
  const attempted = st.state?.active_scenario?.attempted ?? []

  const shown = filter ? items.filter((t) => t.affordance.includes(filter)) : items

  const attempt = (kind: 'item' | 'rule', ref: string) => {
    sfxTap(sound)
    onClose()
    dispatch({ type: 'play/trial', kind, ref })
  }

  return (
    <Sheet
      open={open}
      title="行 囊"
      hint={`${bag.length} 件物事 · ${rules.length} 条法门`}
      onClose={onClose}
    >
      {tags.length > 0 ? (
        <div className={s.filters}>
          <button
            className={`${s.filter} ${filter === null ? s.filterOn : ''}`}
            onClick={() => setFilter(null)}
          >
            全部 {items.length}
          </button>
          {tags.map(([t, n]) => (
            <button
              key={t}
              className={`${s.filter} ${filter === t ? s.filterOn : ''}`}
              onClick={() => setFilter(filter === t ? null : t)}
            >
              {affordanceLabel(t)} {n}
            </button>
          ))}
        </div>
      ) : null}

      <section className={s.sec}>
        <SectionTitle icon={<IconBag size={15} />} text="物事" hint="点一件试之" />
        {shown.length > 0 ? (
          <div className={s.grid}>
            {shown.map((t) => {
              const it = byId.get(t.ref)
              const model: Item = it ?? {
                id: t.ref,
                name: t.name,
                quality: '凡品',
                affixes: [],
                affordance: t.affordance,
              }
              return (
                <ItemCard
                  key={`${t.kind}:${t.ref}`}
                  item={model}
                  attempted={attempted.includes(t.ref)}
                  onTry={() => attempt(t.kind, t.ref)}
                />
              )
            })}
          </div>
        ) : (
          <p className="x-small">
            {items.length === 0 ? '行囊空空。没有物事可试。' : '此标签下无物。'}
          </p>
        )}
      </section>

      {rules.length > 0 ? (
        <section className={s.sec}>
          <SectionTitle
            icon={<IconRule size={15} />}
            text="已习得的法门"
            hint="跨界学来的规则亦是钥匙"
            tone="gold"
          />
          <div className={s.ruleList}>
            {rules.map((t) => (
              <button
                key={t.ref}
                className={`${s.rule} ${attempted.includes(t.ref) ? s.itemTried : ''}`}
                onClick={() => attempt(t.kind, t.ref)}
              >
                <IconRule size={14} />
                <span className={s.ruleName}>{t.name}</span>
                <span className="x-tiny">试之 · 耗一刻</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <p className={s.footNote}>
        试错不是「操作无效」：物事会耗去，时刻会走。但一件物事不中，未必是它无用
        —— 也许是此刻的条件还未凑齐。
      </p>

      {items.length === 0 && rules.length === 0 ? (
        <div className={s.emptyHint}>
          <Chip tone="cinnabar">无物可试</Chip>
          <span className="x-small">退出此卷，静观其变，或可苟全。</span>
        </div>
      ) : null}
    </Sheet>
  )
}
