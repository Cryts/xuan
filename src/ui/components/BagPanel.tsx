/**
 * 行囊 —— 格子界面。
 *
 * 一格一件物，格子上必须让人一眼读出四件事：
 *   1. 物类（剑 / 丹 / 符 / 器 / 材）—— 字形，不靠读字；
 *   2. 名与品阶 —— 品阶配色，凡品到道品一眼分层；
 *   3. **功能标签 affordance** —— 金色小签。这是剧本破局条件唯一认的东西，
 *      所以它永远在名字下面第一行，且穿金；
 *   4. 词条与成色 —— 词条给名与品阶；成色是**表现层**的（见 store.itemWear），
 *      只为让一囊旧物有自己的年岁，不参与任何结算。
 *
 * 同一个组件在两处用：剧本里的「以物试之」（可点，耗一刻）与
 * 日常查看（只读）。差别只在传不传 onTry。
 */

import { type ComponentType, type ReactNode } from 'react'
import s from './BagPanel.module.css'
import { Sheet } from './Shared'
import type { ContentDB } from '@/core/content'
import type { Item } from '@/core/types'
import {
  IconBag,
  IconCheck,
  IconKindArtifact,
  IconKindMaterial,
  IconKindPill,
  IconKindSword,
  IconKindTalisman,
  IconSpark,
  type IconProps,
} from '@/ui/icons'
import { WEAR_NAMES, affixOf, itemKind, itemWear, qualityRank, useGame, type ItemKind } from '@/ui/store'
import { affordanceLabel, isRare, qualityTone } from '@/ui/text'

const KIND_ICON: Record<ItemKind, ComponentType<IconProps>> = {
  sword: IconKindSword,
  pill: IconKindPill,
  talisman: IconKindTalisman,
  artifact: IconKindArtifact,
  material: IconKindMaterial,
}

const KIND_NAME: Record<ItemKind, string> = {
  sword: '兵器',
  pill: '丹药',
  talisman: '符令',
  artifact: '器物',
  material: '材料',
}

/** 一个物品格 */
export function BagCell({
  item,
  content,
  onTry,
  tried = false,
  actionText = '试之 · 耗一刻',
}: {
  item: Item
  content: ContentDB
  onTry?: () => void
  tried?: boolean
  actionText?: string
}) {
  const kind = itemKind(item)
  const wear = itemWear(item)
  const Glyph = KIND_ICON[kind]
  const tags = item.affordance ?? []
  const affixes = (item.affixes ?? []).map((id) => affixOf(content, id)).filter(Boolean)
  const rare = isRare(item.quality)

  const inner: ReactNode = (
    <>
      <span className={s.glyph} aria-hidden>
        <Glyph size={22} />
        <span className={s.kindTag}>{KIND_NAME[kind]}</span>
      </span>

      <span className={s.body}>
        <span className={s.head}>
          <span className={s.name}>{item.name}</span>
          <span className={s.quality} style={{ color: qualityTone(item.quality) }}>
            {item.quality}
          </span>
        </span>

        {/* 功能标签 —— 破局条件认的就是它，所以穿金、置顶 */}
        <span className={s.tags}>
          {tags.length > 0 ? (
            tags.map((t) => (
              <span key={t} className={s.tag}>
                {affordanceLabel(t)}
              </span>
            ))
          ) : (
            <span className={s.noTag}>无可用之能</span>
          )}
        </span>

        {affixes.length > 0 ? (
          <span className={s.affixes}>
            <span className={s.affixLabel}>词条</span>
            {affixes.map((a) => (
              <span
                key={a!.id}
                className={s.affix}
                style={{ color: qualityTone(a!.tier) }}
                title={(a!.affordance ?? []).map(affordanceLabel).join(' · ')}
              >
                {a!.name}
              </span>
            ))}
          </span>
        ) : null}

        {item.desc ? <span className={s.desc}>{item.desc}</span> : null}
      </span>

      <span className={s.side}>
        <span className={s.wear} data-wear={wear}>
          {WEAR_NAMES[wear]}
        </span>
        {rare ? <span className={s.rareMark}>宝光</span> : null}
        {tried ? (
          <span className={s.triedMark}>
            <IconCheck size={11} />
            已试
          </span>
        ) : null}
      </span>

      {onTry ? (
        <span className={s.action}>
          <IconSpark size={12} />
          {tried ? '再试一遭 · 耗一刻' : actionText}
        </span>
      ) : null}
    </>
  )

  const cls = `${s.cell} ${rare ? s.cellRare : ''} ${wear !== 'intact' ? s.cellWorn : ''}`
  const attrs = { 'data-kind': kind, 'data-wear': wear, 'data-rank': qualityRank(item.quality) } as const

  if (!onTry) return <div className={cls} {...attrs}>{inner}</div>

  return (
    <button className={cls} onClick={onTry} {...attrs}>
      {inner}
    </button>
  )
}

/** 格子阵列 —— 空囊时给一句人话，不留白 */
export function BagGrid({
  items,
  content,
  onTry,
  attempted = [],
  emptyText = '行囊空空。',
  emptyHint,
}: {
  items: Item[]
  content: ContentDB
  onTry?: (item: Item) => void
  attempted?: string[]
  emptyText?: string
  emptyHint?: string
}) {
  if (items.length === 0) {
    return (
      <div className={s.empty}>
        <IconBag size={22} />
        <p className="x-small">{emptyText}</p>
        {emptyHint ? <p className="x-tiny">{emptyHint}</p> : null}
      </div>
    )
  }
  return (
    <div className={s.grid}>
      {items.map((it) => (
        <BagCell
          key={it.id}
          item={it}
          content={content}
          tried={attempted.includes(it.id)}
          onTry={onTry ? () => onTry(it) : undefined}
        />
      ))}
    </div>
  )
}

/**
 * 随身行囊抽屉 —— 剧本之外（事件页）也能翻看自己有什么。
 * 只读：真正的「以物试之」发生在剧本里，那里才知道这一局认哪些条件。
 */
export function BagSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { st } = useGame()
  const items = st.state?.items ?? []
  return (
    <Sheet
      open={open}
      title="行 囊"
      hint={`${items.length} 件物事 · 破局之钥常在其中`}
      onClose={onClose}
    >
      <BagGrid
        items={items}
        content={st.content}
        emptyText="囊中无物。"
        emptyHint="物事多从散事件里来；剧本之内，它们是打开破局条件的钥匙。"
      />
      <p className={s.footNote}>
        金色小签是物事的「功能标签」—— 破局条件认的正是这枚标签，而不是某一件特定的物。
        所以一件没用的旧物，换个局可能就是唯一的钥匙。
      </p>
    </Sheet>
  )
}
