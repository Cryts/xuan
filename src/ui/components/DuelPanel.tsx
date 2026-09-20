/**
 * 斗法面板 —— 两个阶段共用。
 *
 * 一、选路数与架势（已经决定要打了）
 * 二、战后处置：杀，还是放
 *
 * 「打不打」那一步不在这里 —— 它走的是事件页的普通选项卡片，
 * 因为那本质上是**一次抉择**，与其它事件的选项长得一样才对。
 * 斗法该是奇遇，不是另开一个界面。
 */

import { useState } from 'react'
import { useGame } from '@/ui/store'
import { ESSENCE_LABEL, affinityWord } from '@/ui/text'
import type { Essence, StanceId } from '@/core/types'
import s from './DuelPanel.module.css'

const AFFINITY_CLASS: Record<string, string> = {
  counter: 'counter',
  countered: 'countered',
  neutral: 'neutral',
}

export function DuelPanel() {
  const { st, dispatch } = useGame()
  const [stance, setStance] = useState<StanceId>('guard')
  const [way, setWay] = useState<Essence | null>(null)

  const duel = st.pres?.duel
  const after = st.pres?.duel_result

  // ── 二、战后处置 ──
  if (after) {
    return (
      <section className={s.panel}>
        <div className={s.head}>
          <span className={s.mark} aria-hidden>
            决
          </span>
          <span>胜负已分</span>
        </div>
        <ol className={s.rounds}>
          {after.rounds.map((r) => (
            <li key={r.index} className={`${s.round} ${s[r.winner] ?? ''}`}>
              {r.line}
            </li>
          ))}
        </ol>
        <p className={s.summary}>{after.summary}</p>

        <div className={s.actions}>
          {after.can_kill ? (
            <button
              type="button"
              className={`${s.action} ${s.kill}`}
              onClick={() => dispatch({ type: 'play/duel-after', kill: true })}
            >
              <span className={s.actionName}>取他性命</span>
              <span className={s.actionHint}>
                得 {after.kill_spoils.power} 修为、{after.kill_spoils.currency} 灵石 ·{' '}
                但背 {after.kill_cost.debt} 因果、{after.kill_cost.exposure} 暴露
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className={`${s.action} ${s.spare}`}
            onClick={() => dispatch({ type: 'play/duel-after', kill: false })}
          >
            <span className={s.actionName}>放他走</span>
            <span className={s.actionHint}>
              得 {after.win_spoils.power} 修为、{after.win_spoils.currency} 灵石 · 积一点功德
            </span>
          </button>
        </div>
      </section>
    )
  }

  if (!duel) return null

  const picked = way ?? duel.ways[0]!.essence
  const pickedWay = duel.ways.find((w) => w.essence === picked)

  return (
    <section className={s.panel}>
      {/* 明牌：把双方摊开。这是"斗法前选择"的依据 ——
          不看清楚就选架势，等于闭眼押注。 */}
      <div className={s.board}>
        <div className={s.side}>
          <span className={s.sideLabel}>你</span>
          <span className={s.sideNum}>{duel.matchup.my_power}</span>
        </div>
        <div className={s.vs}>
          <span className={s.odds}>{duel.matchup.odds_hint}</span>
          <span className={s.vsWord}>对</span>
        </div>
        <div className={s.side}>
          <span className={s.sideLabel}>{duel.opponent.name}</span>
          <span className={s.sideNum}>{duel.matchup.their_power}</span>
        </div>
      </div>

      {/* 路数：可以切到跨界学来的那几条。学了别家的法门，这里第一次能用来打人 */}
      <div className={s.block}>
        <div className={s.blockHead}>走哪一路</div>
        <div className={s.ways}>
          {duel.ways.map((w) => (
            <button
              key={`${w.essence}-${w.from_pack ?? 'own'}`}
              type="button"
              className={`${s.way} ${picked === w.essence ? s.wayOn : ''} ${s[AFFINITY_CLASS[w.affinity] ?? ''] ?? ''}`}
              onClick={() => setWay(w.essence)}
            >
              <span className={s.wayName}>{w.name}</span>
              <span className={s.wayEss}>{ESSENCE_LABEL[w.essence]}</span>
              <span className={s.wayAff}>{affinityWord(w.affinity)}</span>
              {w.from_pack ? <span className={s.wayFrom}>别家</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* 架势：真正的取舍是赌一把还是稳扎稳打，不是攻高守低 */}
      <div className={s.block}>
        <div className={s.blockHead}>怎么打</div>
        <div className={s.stances}>
          {duel.stances.map((x) => (
            <button
              key={x.id}
              type="button"
              className={`${s.stance} ${stance === x.id ? s.stanceOn : ''}`}
              onClick={() => setStance(x.id)}
            >
              <span className={s.stanceName}>{x.name}</span>
              <span className={s.stanceDesc}>{x.desc}</span>
              {x.note ? <span className={s.stanceNote}>{x.note}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {pickedWay ? <p className={s.readout}>{pickedWay.hint}</p> : null}

      <button
        type="button"
        className={s.go}
        onClick={() => dispatch({ type: 'play/duel-stance', stance, way: picked })}
      >
        出手
      </button>
    </section>
  )
}
