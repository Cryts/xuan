/**
 * 剧本界面 —— 本作最重要的界面，本质是一个**推理界面**。
 *
 * 四层信息按「确定性」由高到低排列：
 *   明规则（一定为真）→ 禁制（一定为假）→ 隐规则（未知，可参透）→ 破局条件组（目标）
 *
 * 隐规则的揭示是本作唯一需要「仪式感」的时刻：它不是数值变化，
 * 而是玩家认知的一次跃迁 —— 所以给金墨渗开 + 印章落下。
 */

import { useMemo, useState } from 'react'
import s from './ScenarioScreen.module.css'
import { StatusBar } from './StatusBar'
import { TrialPanel } from './TrialPanel'
import { Seal, SectionTitle, Ticks } from './Shared'
import type { Breakthrough, Condition, NodePresentation } from '@/core/types'
import { IconBag, IconLock, IconRisk, IconRule, IconSpark } from '@/ui/icons'
import { sfxTap } from '@/ui/sfx'
import { useGame } from '@/ui/store'
import { scenarioOf, unmetText } from '@/ui/text'

const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export function ScenarioScreen({ pres, onHeaven }: { pres: NodePresentation; onHeaven: () => void }) {
  const { st, dispatch } = useGame()
  const [bagOpen, setBagOpen] = useState(false)
  const sound = st.settings.sound

  const sc = pres.scenario
  const state = st.state
  const content = st.content

  const real = useMemo(() => scenarioOf(content, pres.event_id), [content, pres.event_id])
  const run = state?.active_scenario

  const ctx = useMemo(
    () => ({
      state: state!,
      solvedInScenario: run?.solved ?? [],
      scenarioNodesSpent: run?.nodes_spent ?? 0,
    }),
    [state, run],
  )

  if (!sc || !state) return null

  const revealedIds = new Set(sc.rules_hidden.filter((r) => r.revealed).map((r) => r.id))
  const justRevealed = new Set(st.justRevealed)
  const solvedCount = sc.breakthroughs.filter((b) => b.satisfied).length
  const trials = pres.trials ?? []
  const itemCount = trials.filter((t) => t.kind === 'item').length

  return (
    <div className={s.wrap}>
      <StatusBar
        state={state}
        content={content}
        compact
        onHeaven={onHeaven}
        onSettings={() => dispatch({ type: 'openSettings' })}
        onBag={() => setBagOpen(true)}
      />

      <main className={s.main}>
        {/* ---------- 剧名与时刻 ---------- */}
        <header className={`x-card ${s.head}`}>
          <div className={s.headRow}>
            <h2 className="x-h2">{sc.name}</h2>
            <span className={s.clock}>
              第 <b className="x-num">{Math.min(sc.nodes_spent + 1, sc.span)}</b>
              <i>/</i>
              {sc.span} 刻
            </span>
          </div>
          <Ticks used={sc.nodes_spent} total={sc.span} />
          <p className="x-tiny">
            每试一次耗去一刻。刻尽仍未破局，此局自成一结 —— 那也是一个结局，不是失败。
          </p>
        </header>

        {/* ---------- 明规则 ---------- */}
        <section className={s.sec}>
          <SectionTitle icon={<IconRule size={15} />} text="明规则" hint="开局即知 · 一定为真" tone="cinnabar" />
          <ul className={s.stated}>
            {sc.rules_stated.map((r, i) => (
              <li key={i} className={s.statedItem}>
                <span className={s.statedNo}>{CN[i] ?? i + 1}</span>
                <span className={s.statedText}>{r}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------- 隐规则 ---------- */}
        <section className={s.sec}>
          <SectionTitle
            icon={<IconSpark size={15} />}
            text="隐规则"
            hint={`已解 ${revealedIds.size} / ${sc.rules_hidden.length}`}
            tone="gold"
          />
          <ul className={s.hiddenList}>
            {sc.rules_hidden.map((r, i) => {
              const ritual = justRevealed.has(r.id)
              return r.revealed ? (
                <li key={r.id} className={`${s.hiddenOn} ${ritual ? s.ritual : ''}`}>
                  <span className={s.ritualSeal}>
                    <Seal text="解" tone="gold" />
                  </span>
                  <span className={s.hiddenBody}>
                    <span className="x-tiny">
                      隐规则 · 其{CN[i] ?? i + 1}
                      {ritual ? ' · 此刻洞明' : ''}
                    </span>
                    <p className={s.hiddenText}>{r.hint}</p>
                  </span>
                </li>
              ) : (
                <li key={r.id} className={s.hiddenOff}>
                  <IconLock size={14} />
                  <span className={s.hiddenLocked}>未解 · 其{CN[i] ?? i + 1}</span>
                  <span className="x-tiny">参透之机未至</span>
                </li>
              )
            })}
            {sc.rules_hidden.length === 0 ? (
              <li className="x-small">此局无隐情 —— 规则尽在明处，难的是做到。</li>
            ) : null}
          </ul>
        </section>

        {/* ---------- 禁制 ---------- */}
        {sc.forbidden.length > 0 ? (
          <section className={s.sec}>
            <SectionTitle icon={<IconRisk size={15} />} text="禁制" hint="犯之即罚" tone="cinnabar" />
            <ul className={s.forbidList}>
              {sc.forbidden.map((f, i) => (
                <li key={i} className={s.forbid}>
                  <IconRisk size={13} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ---------- 破局条件组 ---------- */}
        <section className={s.sec}>
          <SectionTitle
            icon={<IconSpark size={15} />}
            text="破局条件组"
            hint={`已成 ${solvedCount} / ${sc.breakthroughs.length}`}
            tone={solvedCount > 0 ? 'jade' : 'plain'}
          />
          <ul className={s.breakList}>
            {sc.breakthroughs.map((b) => (
              <BreakRow
                key={b.id}
                bt={b}
                full={real?.breakthroughs.find((x) => x.id === b.id)}
                gap={
                  b.satisfied || !real
                    ? ''
                    : unmetText(
                        real.breakthroughs.find((x) => x.id === b.id)?.conditions ?? [],
                        ctx,
                        content,
                      )
                }
              />
            ))}
          </ul>
        </section>

        <div className={s.tail}>
          <span className="x-tiny">
            设计师写条件，不写解法。任何一件带对功能标签的物事，都可能成为你没想过的那把钥匙。
          </span>
        </div>
      </main>

      {/* ---------- 底栏：以物试之 ---------- */}
      <footer className={s.foot}>
        <button
          className={`x-btn x-btn--gold ${s.bagBtn}`}
          onClick={() => {
            sfxTap(sound)
            setBagOpen(true)
          }}
        >
          <IconBag size={16} />
          以物试之
          <span className={s.bagCount}>{itemCount}</span>
        </button>
        <button
          className={`x-btn x-btn--quiet ${s.waitBtn}`}
          onClick={() => dispatch({ type: 'play/wait' })}
        >
          静观其变
        </button>
      </footer>

      <TrialPanel open={bagOpen} onClose={() => setBagOpen(false)} pres={pres} />

      {/* ---------- 参透：隐规则揭示的那一瞬 ----------
          本作唯一需要「仪式感」的时刻：不是数值变化，是认知的一次跃迁。
          故此幕独立于数值浮字，金印沉下 + 金环荡开，几秒后自行隐去。 */}
      {st.banner?.kind === 'reveal' ? (
        <div className={s.reveal} role="status" aria-live="polite">
          <span className={s.revealRing} aria-hidden />
          <span className={s.revealSeal}>参 透</span>
          <span className={s.revealText}>{st.banner.detail ?? '隐规则之一，自此洞明。'}</span>
        </div>
      ) : null}
    </div>
  )
}

function BreakRow({
  bt,
  full,
  gap,
}: {
  bt: { id: string; name: string; cost: string; hidden: boolean; satisfied: boolean }
  full: Breakthrough | undefined
  gap: string
}) {
  const [open, setOpen] = useState(false)
  const conds: Condition[] = full?.conditions ?? []
  return (
    <li className={`${s.breakRow} ${bt.satisfied ? s.breakOn : ''}`}>
      <button className={s.breakHead} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={s.breakMark}>{bt.satisfied ? '成' : '缺'}</span>
        <span className={s.breakName}>{bt.name}</span>
        {bt.hidden ? <Seal text="隐" tone="plain" /> : null}
        <span className={s.breakCost}>{bt.cost}</span>
      </button>

      {open ? (
        <div className={s.breakBody}>
          {bt.satisfied ? (
            <p className={s.breakDone}>
              <IconSpark size={13} />
              条件已足 —— 只需以物试之，路自开。
            </p>
          ) : (
            <>
              <p className={s.breakGap}>
                <span className={s.gapLabel}>还差</span>
                {gap || '未知之数'}
              </p>
              {conds.length > 0 ? (
                <p className="x-tiny">
                  共 {conds.length} 项条件；条件组的达成只看「是否已足」，不看用了什么手段。
                </p>
              ) : null}
            </>
          )}
          <p className={s.breakCostFull}>代价 · {bt.cost}</p>
        </div>
      ) : null}
    </li>
  )
}
