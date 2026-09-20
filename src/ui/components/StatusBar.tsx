/**
 * 顶部状态条 —— 境界 / 寿元 / 伤势 / 修为环 / 六维 / 资源 / 行囊。
 *
 * 信息层级（自上而下，由「我是谁」到「我有什么」）：
 *   1. 境界 —— 本作唯一不可逆的东西，给最大字号 + 本体色；
 *   2. 灵石 —— 主要通用货币，单列一个带图标与浮动提示的「钱袋」，不与杂项混排；
 *   3. 修为环 / 寿元 / 伤势 —— 三条性命相关的量，各自带图标与告急配色；
 *   4. 六维 —— 细条，扫一眼即可；
 *   5. 其余长期变量 —— 图标 + 名 + 数，压成一行；
 *   6. 行囊 —— 图标 + 件数角标。
 *
 * 全部颜色取自 CSS 变量，换体系包时整条随之换色（见 theme.css 六体系主题）。
 */

import { useEffect, useRef, useState, type ComponentType } from 'react'
import s from './StatusBar.module.css'
import type { ContentDB } from '@/core/content'
import { progressNameOf } from '@/core/engine'
import { ATTR_KEYS } from '@/core/genesis'
import type { AttrKey, GameState, VarKey } from '@/core/types'
import {
  IconBag,
  IconCurrency,
  IconDemon,
  IconExposure,
  IconFavor,
  IconHeaven,
  IconInjury,
  IconKarma,
  IconLifespan,
  IconMaterial,
  IconMerit,
  IconPower,
  IconSettings,
  type IconProps,
} from '@/ui/icons'
import { ATTR_SHORT, hpUrgency, lifeUrgency, realmCount, realmLifespan, realmRange } from '@/ui/text'

/* 一个长期变量一枚图标 —— 缺哪个补哪个，别让玩家读纯文字表 */
const VAR_ICON: Record<VarKey, ComponentType<IconProps>> = {
  currency: IconCurrency,
  power: IconPower,
  rare_mat: IconMaterial,
  favor: IconFavor,
  debt: IconKarma,
  exposure: IconExposure,
  corruption: IconDemon,
  karma: IconMerit,
  hp: IconInjury,
  lifespan: IconLifespan,
}

/** 伤势的人话分档（0 = 完好，100 = 油尽灯枯） */
function hpWord(hp: number): string {
  if (hp >= 60) return '垂危'
  if (hp >= 30) return '带伤'
  if (hp > 0) return '小伤'
  return '无碍'
}

const URGENCY_CLASS: Record<string, string> = {
  calm: s.calm,
  warn: s.warn,
  dire: s.dire,
}

/* ---------- 修为环：环内是数值，环外是本体色辉光 ---------- */
function PowerRing({ value, min, max }: { value: number; min: number; max: number }) {
  const p = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0
  const r = 18.5
  const c = 2 * Math.PI * r
  return (
    <div className={s.ringCol}>
      <div className={s.ringWrap}>
        <svg width="50" height="50" viewBox="0 0 50 50" className={s.ring}>
          <circle cx="25" cy="25" r={r} className={s.ringTrack} />
          <circle
            cx="25"
            cy="25"
            r={r}
            className={s.ringFill}
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - p)}
            transform="rotate(-90 25 25)"
          />
        </svg>
        <span className={`${s.ringNum} x-num`} key={value}>
          {value}
        </span>
      </div>
      <span className={s.ringLabel}>
        <IconPower size={11} />
        修为
      </span>
    </div>
  )
}

/* ---------- 性命线：一条带图标、会在告急时变色的量 ---------- */
function Vital({
  icon,
  label,
  word,
  value,
  max,
  urgency,
}: {
  icon: ComponentType<IconProps>
  label: string
  word: string
  value: number
  max: number
  urgency: 'calm' | 'warn' | 'dire'
}) {
  const Icon = icon
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className={`${s.vital} ${URGENCY_CLASS[urgency]}`}>
      <span className={s.vitalHead}>
        <span className={s.vitalIcon}>
          <Icon size={13} />
        </span>
        <span className={s.vitalLabel}>{label}</span>
        <span className={`${s.vitalNum} x-num`}>
          {value}
          <i>/{max}</i>
        </span>
        <span className={s.vitalWord}>{word}</span>
      </span>
      <span className="x-bar" style={{ height: 3 }}>
        <span className="x-bar__fill" style={{ width: `${pct}%`, ['--accent' as string]: 'currentColor' }} />
      </span>
    </div>
  )
}

/* ---------- 灵石：主要货币，单独一栏 ---------- */
function Coins({ value }: { value: number }) {
  const prev = useRef(value)
  const [delta, setDelta] = useState(0)

  useEffect(() => {
    const d = value - prev.current
    prev.current = value
    if (d === 0) return
    setDelta(d)
    const t = window.setTimeout(() => setDelta(0), 1800)
    return () => window.clearTimeout(t)
  }, [value])

  return (
    <div className={s.coins} title="灵石 · 通用货币">
      <IconCurrency size={16} />
      <b className={`${s.coinsNum} x-num`} key={value}>
        {value}
      </b>
      {delta !== 0 ? (
        <span className={`${s.coinsDelta} x-num`} key={`d${value}`}>
          {delta > 0 ? '+' : '−'}
          {Math.abs(delta)}
        </span>
      ) : null}
    </div>
  )
}

export function StatusBar({
  state,
  content,
  compact = false,
  onHeaven,
  onSettings,
  onBag,
}: {
  state: GameState
  content: ContentDB
  compact?: boolean
  onHeaven: () => void
  onSettings: () => void
  /** 打开行囊；不传则只显示件数，不可点 */
  onBag?: () => void
}) {
  /* 境界名走引擎的 progressNameOf：带上小境界（「炼气七层」），
     自己拼 realm.name 会看不到「几层」。 */
  const realm = progressNameOf(state, content)
  const [lo, hi] = realmRange(content, state.pack_id, state.realm_idx)
  const lifeMax = realmLifespan(content, state.pack_id, state.realm_idx)
  const realmTotal = realmCount(content, state.pack_id)
  const packName = content.packs[state.pack_id]?.display_name ?? state.pack_id
  const alive = state.destiny_children.filter((d) => d.alive).length
  const bagCount = state.items.length

  /* 其余长期变量：为 0 的不占地方，灵石单列不在此 */
  const res: VarKey[] = (['rare_mat', 'favor', 'debt', 'exposure', 'corruption', 'karma'] as VarKey[]).filter(
    (k) => (state.vars[k] ?? 0) > 0,
  )
  const RES_NAME: Record<string, string> = {
    rare_mat: '材料',
    favor: '声望',
    debt: '因果',
    exposure: '暴露',
    corruption: '心魔',
    karma: '功德',
  }

  return (
    <header className={s.bar}>
      <div className={s.top}>
        <div className={s.who}>
          <span className={s.realm}>{realm}</span>
          <span className={s.realmMeta}>
            <span className={s.pack}>{packName}</span>
            <span className={s.dot}>·</span>
            <span className={`${s.realmIdx} x-num`}>
              第 {state.realm_idx + 1}/{realmTotal} 境
            </span>
          </span>
        </div>
        <div className={s.acts}>
          <Coins value={state.vars.currency ?? 0} />
          <button className={s.act} onClick={onHeaven} aria-label="天机榜">
            <IconHeaven size={17} />
            {alive > 0 ? <span className={s.badge}>{alive}</span> : null}
          </button>
          <button className={s.act} onClick={onSettings} aria-label="设置">
            <IconSettings size={17} />
          </button>
        </div>
      </div>

      <div className={s.mid}>
        <PowerRing value={state.power_index} min={lo} max={hi} />
        <div className={s.vitals}>
          <Vital
            icon={IconLifespan}
            label="寿元"
            word={lifeUrgency(state.vars.lifespan, lifeMax) === 'dire' ? '大限将近' : '尚余'}
            value={state.vars.lifespan}
            max={lifeMax}
            urgency={lifeUrgency(state.vars.lifespan, lifeMax)}
          />
          <Vital
            icon={IconInjury}
            label="伤势"
            word={hpWord(state.vars.hp)}
            value={state.vars.hp}
            max={100}
            urgency={hpUrgency(state.vars.hp)}
          />
        </div>
      </div>

      {!compact ? (
        <div className={s.attrs}>
          {ATTR_KEYS.map((k: AttrKey) => {
            const v = state.attrs[k] ?? 0
            return (
              <div key={k} className={s.attr}>
                <span className={s.attrName}>{ATTR_SHORT[k]}</span>
                <span className="x-bar" style={{ height: 2 }}>
                  <span
                    className="x-bar__fill"
                    style={{ width: `${Math.min(100, v)}%`, ['--accent' as string]: 'rgba(var(--paper-rgb), .5)' }}
                  />
                </span>
                <span className={`${s.attrNum} x-num`}>{v}</span>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className={s.strips}>
        <div className={s.res}>
          {res.map((k) => {
            const Icon = VAR_ICON[k]
            return (
              <span key={k} className={`${s.resItem} ${s[`res_${k}`] ?? ''}`} title={RES_NAME[k]}>
                <Icon size={13} />
                <span className={s.resName}>{RES_NAME[k]}</span>
                <b className="x-num">{state.vars[k] ?? 0}</b>
              </span>
            )
          })}
          {res.length === 0 ? <span className={s.resQuiet}>身无长物</span> : null}
        </div>

        {onBag ? (
          <button className={s.bag} onClick={onBag} aria-label={`行囊 · ${bagCount} 件`}>
            <IconBag size={15} />
            <span className={s.bagName}>行囊</span>
            <span className={`${s.bagCount} x-num`}>{bagCount}</span>
          </button>
        ) : (
          <span className={s.bagStatic}>
            <IconBag size={15} />
            <span className={s.bagName}>行囊</span>
            <span className={`${s.bagCount} x-num`}>{bagCount}</span>
          </span>
        )}
      </div>
    </header>
  )
}
