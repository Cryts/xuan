/**
 * 转世页 —— 抽命格：出身 + 3 天赋 + 1 缺陷 + 体系包。
 * 目标：三十秒内能开局。所有槽位均可点开重选，「一键随机」一步到位。
 */

import { useMemo, useState } from 'react'
import s from './GenesisScreen.module.css'
import { Chip, Seal, SectionTitle, Sheet } from './Shared'
import { ESSENCE_NAMES } from '@/core/affinity'
import { PACK_IDS } from '@/core/content'
import type { AttrKey, Effect, PackId, Trait } from '@/core/types'
import { ATTR_NAMES } from '@/core/genesis'
import { IconBag, IconCheck, IconClose, IconKey, IconRebirth, IconSpark, IconTrash } from '@/ui/icons'
import { makeRunId, makeSeedString, useGame } from '@/ui/store'
import { VAR_NAMES, packTag } from '@/ui/text'

type Slot = null | 'origin' | 'trait0' | 'trait1' | 'trait2' | 'flaw'

function effectText(e: Effect): string {
  switch (e.type) {
    case 'add_attr':
      return `${ATTR_NAMES[e.key as AttrKey]} ${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)}`
    case 'add_var':
      return `${VAR_NAMES[e.key] ?? e.key} ${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)}`
    case 'add_item':
      return '得一件旧物'
    case 'set_flag':
    case 'clear_flag':
      return ''
    default:
      return ''
  }
}

const TIER_TONE: Record<Trait['tier'], 'gold' | 'jade' | 'plain' | 'cinnabar'> = {
  S: 'gold',
  A: 'jade',
  B: 'plain',
  C: 'plain',
}

export function GenesisScreen() {
  const { st, dispatch } = useGame()
  const [slot, setSlot] = useState<Slot>(null)
  const { content, gen } = st

  const origin = useMemo(
    () => content.origins.find((o) => o.id === gen.originId) ?? content.origins[0],
    [content.origins, gen.originId],
  )
  const traits = useMemo(
    () => gen.traitIds.map((id) => content.traits.find((t) => t.id === id)).filter(Boolean) as Trait[],
    [content.traits, gen.traitIds],
  )
  const flaw = useMemo(() => content.flaws.find((f) => f.id === gen.flawId), [content.flaws, gen.flawId])

  const attrMods = useMemo(() => {
    const acc: Partial<Record<AttrKey, number>> = { ...(origin?.attr_mods ?? {}) }
    for (const t of traits) {
      for (const e of t.effects) {
        if (e.type === 'add_attr') acc[e.key] = (acc[e.key] ?? 0) + e.delta
      }
    }
    for (const e of flaw?.effects ?? []) {
      if (e.type === 'add_attr') acc[e.key] = (acc[e.key] ?? 0) + e.delta
    }
    return acc
  }, [origin, traits, flaw])

  const pickPack = (p: PackId) => dispatch({ type: 'genesis/setPack', pack: p })

  return (
    <div className={s.wrap}>
      <header className={s.head}>
        <button className={s.headBtn} onClick={() => dispatch({ type: 'goto', screen: 'title' })}>
          <IconClose size={17} />
        </button>
        <div className={s.headMid}>
          <h1 className="x-h2">转 世</h1>
          <span className="x-tiny">命格既定，路仍由你走</span>
        </div>
        <button
          className={s.headBtn}
          onClick={() => dispatch({ type: 'genesis/roll', seed: makeSeedString() })}
          aria-label="重掷命格"
        >
          <IconSpark size={17} />
        </button>
      </header>

      <div className={s.body}>
        {/* ---------- 出身 ---------- */}
        <section className={s.sec}>
          <SectionTitle icon={<IconKey size={15} />} text="出身" hint="点此更换" />
          <button className={`x-card ${s.slot}`} onClick={() => setSlot('origin')}>
            <div className={s.slotTop}>
              <span className="x-h3">{origin?.name ?? '未名'}</span>
              {origin?.recommended_pack ? (
                <Chip tone="jade">宜 {packTag(content, origin.recommended_pack)}</Chip>
              ) : null}
            </div>
            <div className={s.mods}>
              {(Object.keys(attrMods) as AttrKey[]).map((k) => (
                <span key={k} className={`${s.mod} ${(attrMods[k] ?? 0) >= 0 ? s.modUp : s.modDown}`}>
                  {ATTR_NAMES[k]} {attrMods[k]! >= 0 ? '+' : '−'}
                  {Math.abs(attrMods[k]!)}
                </span>
              ))}
            </div>
          </button>
        </section>

        {/* ---------- 天赋 ---------- */}
        <section className={s.sec}>
          <SectionTitle icon={<IconSpark size={15} />} text="天赋" hint="三枚 · 点此更换" />
          <div className={s.traits}>
            {[0, 1, 2].map((i) => {
              const t = traits[i]
              return (
                <button
                  key={i}
                  className={`x-card ${s.traitCard}`}
                  onClick={() => setSlot(`trait${i}` as Slot)}
                >
                  {t ? (
                    <>
                      <div className={s.slotTop}>
                        <span className="x-h3">{t.name}</span>
                        <Seal text={t.tier} tone={TIER_TONE[t.tier]} />
                      </div>
                      <span className="x-tiny">{t.category}</span>
                      <p className={s.desc}>{t.desc}</p>
                      <div className={s.mods}>
                        {t.effects.map(effectText).filter(Boolean).map((x, j) => (
                          <span key={j} className={s.mod}>
                            {x}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <span className="x-small">空 · 点此择一</span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        {/* ---------- 缺陷 ---------- */}
        <section className={s.sec}>
          <SectionTitle icon={<IconTrash size={15} />} text="缺陷" hint="一桩 · 点此更换" tone="cinnabar" />
          <button className={`x-card ${s.slot} ${s.flaw}`} onClick={() => setSlot('flaw')}>
            {flaw ? (
              <>
                <div className={s.slotTop}>
                  <span className="x-h3">{flaw.name}</span>
                  <Chip tone="gold">补偿 {flaw.compensate} 点</Chip>
                </div>
                <p className={s.desc}>{flaw.desc}</p>
                <div className={s.mods}>
                  {flaw.effects.map(effectText).filter(Boolean).map((x, j) => (
                    <span key={j} className={`${s.mod} ${s.modDown}`}>
                      {x}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <span className="x-small">无缺 · 点此择一</span>
            )}
          </button>
        </section>

        {/* ---------- 体系包 ---------- */}
        <section className={s.sec}>
          <SectionTitle icon={<IconBag size={15} />} text="体系" hint="六选一 · 本体定相性" />
          <div className={s.packs}>
            {PACK_IDS.map((p) => {
              const pack = content.packs[p]
              const on = gen.packId === p
              const essence = pack?.essence ?? 'qi'
              return (
                <button
                  key={p}
                  className={`${s.pack} ${on ? s.packOn : ''}`}
                  onClick={() => pickPack(p)}
                  aria-pressed={on}
                >
                  <span className={s.benti} data-shi={essence === 'shi' ? '1' : undefined}>
                    {ESSENCE_NAMES[essence]}
                  </span>
                  <span className={s.packName}>{pack?.display_name ?? p}</span>
                  <span className="x-tiny">{pack?.inspiration_tag ?? packTag(content, p)}</span>
                  {on ? (
                    <span className={s.packMark}>
                      <IconCheck size={13} />
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
          <p className={s.note}>
            本体「气·体·灵·则·意」成相克环，克者判定增益、被克者减损；「势」不入环，不克人亦不被克，
            但极难被杀。
          </p>
        </section>
      </div>

      <footer className={s.foot}>
        <button
          className="x-btn x-btn--block"
          onClick={() => dispatch({ type: 'genesis/roll', seed: makeSeedString() })}
        >
          <IconSpark size={16} />
          一 键 随 机
        </button>
        <button
          className="x-btn x-btn--primary x-btn--block"
          onClick={() => dispatch({ type: 'genesis/begin', runId: makeRunId() })}
        >
          <IconRebirth size={16} />
          入 轮 回
        </button>
      </footer>

      {/* ---------- 选择抽屉 ---------- */}
      <Sheet
        open={slot === 'origin'}
        title="择 出 身"
        hint={`${content.origins.length} 种`}
        onClose={() => setSlot(null)}
      >
        <ul className={s.pickList}>
          {content.origins.map((o) => (
            <li key={o.id}>
              <button
                className={`${s.pick} ${gen.originId === o.id ? s.pickOn : ''}`}
                onClick={() => {
                  dispatch({ type: 'genesis/setOrigin', id: o.id })
                  setSlot(null)
                }}
              >
                <span className="x-h3">{o.name}</span>
                <span className={s.pickMods}>
                  {Object.entries(o.attr_mods).map(([k, v]) => (
                    <span key={k} className={s.mod}>
                      {ATTR_NAMES[k as AttrKey]} {v >= 0 ? '+' : '−'}
                      {Math.abs(v)}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet
        open={slot?.startsWith('trait') ?? false}
        title="择 天 赋"
        hint={`已选 ${traits.length} / 3`}
        onClose={() => setSlot(null)}
      >
        <ul className={s.pickList}>
          {content.traits.map((t) => {
            const idx = slot?.startsWith('trait') ? Number(slot.slice(5)) : 0
            return (
              <li key={t.id}>
                <button
                  className={`${s.pick} ${gen.traitIds[idx] === t.id ? s.pickOn : ''}`}
                  onClick={() => {
                    dispatch({ type: 'genesis/setTrait', index: idx, id: t.id })
                    setSlot(null)
                  }}
                >
                  <div className={s.slotTop}>
                    <span className="x-h3">{t.name}</span>
                    <Seal text={t.tier} tone={TIER_TONE[t.tier]} />
                    <Chip>{t.category}</Chip>
                  </div>
                  <p className={s.desc}>{t.desc}</p>
                  <div className={s.mods}>
                    {t.effects.map(effectText).filter(Boolean).map((x, j) => (
                      <span key={j} className={s.mod}>
                        {x}
                      </span>
                    ))}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </Sheet>

      <Sheet
        open={slot === 'flaw'}
        title="择 缺 陷"
        hint={`${content.flaws.length} 种`}
        onClose={() => setSlot(null)}
      >
        <ul className={s.pickList}>
          {content.flaws.map((f) => (
            <li key={f.id}>
              <button
                className={`${s.pick} ${gen.flawId === f.id ? s.pickOn : ''}`}
                onClick={() => {
                  dispatch({ type: 'genesis/setFlaw', id: f.id })
                  setSlot(null)
                }}
              >
                <div className={s.slotTop}>
                  <span className="x-h3">{f.name}</span>
                  <Chip tone="gold">补偿 {f.compensate}</Chip>
                </div>
                <p className={s.desc}>{f.desc}</p>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  )
}
