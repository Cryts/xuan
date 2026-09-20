/**
 * 顶部状态条 —— 境界 / 修为环 / 寿元 / 六维。
 *
 * 设计取舍：不做满屏数字面板。六维只给极细的条 + 数值，一眼扫过即可；
 * 真正要紧的「修为环」给一个环，因为它是本作唯一的进度感来源。
 */

import s from './StatusBar.module.css'
import type { ContentDB } from '@/core/content'
import { ATTR_KEYS } from '@/core/genesis'
import type { AttrKey, GameState, VarKey } from '@/core/types'
import { IconHeaven, IconSettings } from '@/ui/icons'
import { ATTR_SHORT, realmName, realmRange } from '@/ui/text'

function PowerRing({ value, min, max }: { value: number; min: number; max: number }) {
  const p = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0
  const r = 17.5
  const c = 2 * Math.PI * r
  return (
    <div className={s.ringCol}>
      <div className={s.ringWrap}>
        <svg width="46" height="46" viewBox="0 0 46 46" className={s.ring}>
          <circle cx="23" cy="23" r={r} className={s.ringTrack} />
          <circle
            cx="23"
            cy="23"
            r={r}
            className={s.ringFill}
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - p)}
            transform="rotate(-90 23 23)"
          />
        </svg>
        <span className={`${s.ringNum} x-num`}>{value}</span>
      </div>
      <span className={s.ringLabel}>修为</span>
    </div>
  )
}

function Shallow({ label, value, max, tone }: { label: string; value: number; max: number; tone?: string }) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className={s.shallow}>
      <span className={s.shallowLabel}>{label}</span>
      <span className="x-bar" style={{ flex: 1, height: 2 }}>
        <span className="x-bar__fill" style={{ width: `${pct}%`, ['--accent' as string]: tone }} />
      </span>
      <span className={`${s.shallowNum} x-num`}>{value}</span>
    </div>
  )
}

export function StatusBar({
  state,
  content,
  compact = false,
  onHeaven,
  onSettings,
}: {
  state: GameState
  content: ContentDB
  compact?: boolean
  onHeaven: () => void
  onSettings: () => void
}) {
  const realm = realmName(content, state.pack_id, state.realm_idx)
  const [lo, hi] = realmRange(content, state.pack_id, state.realm_idx)
  const packName = content.packs[state.pack_id]?.display_name ?? state.pack_id
  const alive = state.destiny_children.filter((d) => d.alive).length

  const chips: Array<[VarKey, string, string]> = [
    ['currency', '灵石', 'rgba(242,234,217,.55)'],
    ['debt', '因果', 'var(--cinnabar)'],
    ['exposure', '暴露', '#c9743a'],
    ['corruption', '心魔', '#8f5fb0'],
    ['karma', '功德', 'var(--gold)'],
    ['rare_mat', '材料', 'var(--jade)'],
  ]

  return (
    <header className={s.bar}>
      <div className={s.top}>
        <div className={s.who}>
          <span className={s.pack}>{packName}</span>
          <span className={s.dot}>·</span>
          <span className={s.realm}>{realm}</span>
        </div>
        <div className={s.acts}>
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
          <Shallow label="寿元" value={state.vars.lifespan} max={Math.max(80, state.vars.lifespan)} tone="var(--gold)" />
          <Shallow label="伤势" value={state.vars.hp} max={100} tone="var(--cinnabar)" />
        </div>
      </div>

      {!compact ? (
        <>
          <div className={s.attrs}>
            {ATTR_KEYS.map((k: AttrKey) => {
              const v = state.attrs[k] ?? 0
              return (
                <div key={k} className={s.attr}>
                  <span className={s.attrName}>{ATTR_SHORT[k]}</span>
                  <span className="x-bar" style={{ height: 2 }}>
                    <span
                      className="x-bar__fill"
                      style={{ width: `${Math.min(100, v)}%`, ['--accent' as string]: 'rgba(242,234,217,.5)' }}
                    />
                  </span>
                  <span className={`${s.attrNum} x-num`}>{v}</span>
                </div>
              )
            })}
          </div>

          <div className={s.chips}>
            {chips
              .filter(([k]) => k === 'currency' || (state.vars[k] ?? 0) > 0)
              .map(([k, name, color]) => (
                <span key={k} className={s.chip} style={{ color }}>
                  {name}
                  <b className="x-num">{state.vars[k] ?? 0}</b>
                </span>
              ))}
            <span className={s.chipDim}>行囊 {state.items.length} 件</span>
          </div>
        </>
      ) : null}
    </header>
  )
}
