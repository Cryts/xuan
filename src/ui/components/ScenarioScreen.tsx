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
import { FreeEcho } from './FreeEcho'
import { FreeInput } from './FreeInput'
import { RevealOverlay, Seal, SectionTitle, Ticks } from './Shared'
import type {
  Breakthrough,
  Condition,
  NodePresentation,
  ScenarioActionId,
  ScenarioEntry,
} from '@/core/types'
import { IconBag, IconLock, IconRisk, IconRule, IconScroll, IconSpark } from '@/ui/icons'
import { sfxTap } from '@/ui/sfx'
import { useGame } from '@/ui/store'
import { ATTR_SHORT, scenarioOf, unmetText } from '@/ui/text'

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

  /* ---------- 入场抉择：剧本先摆在你面前，进不进由你 ----------
     引擎在「刚触发」那一拍给的仍是剧本呈现（pending 已落、active 还空，
     尚未带上 scenario_entry）。这一拍按状态判定：还没进去，就还是入场态 ——
     否则玩家会在没选择入场的情况下看见「手段」，一按便落空。 */
  const entry = useMemo<ScenarioEntry | undefined>(() => {
    if (pres.scenario_entry) return pres.scenario_entry
    const pending = Boolean(state?.pending_scenario) && !state?.active_scenario
    if (!pending || !pres.scenario) return undefined
    return {
      scenario_id: pres.event_id,
      name: pres.scenario.name,
      lines: pres.lines,
      rules_stated: pres.scenario.rules_stated,
      span: pres.scenario.span,
    }
  }, [pres, state?.pending_scenario, state?.active_scenario])

  if (entry && state) {
    return (
      <EntryView
        entry={entry}
        pres={pres}
        onHeaven={onHeaven}
        onBag={() => setBagOpen(true)}
        onEnter={() => dispatch({ type: 'play/entry', enter: true })}
        onSkip={() => dispatch({ type: 'play/entry', enter: false })}
        sound={sound}
      />
    )
  }

  if (!sc || !state) return null

  const revealedIds = new Set(sc.rules_hidden.filter((r) => r.revealed).map((r) => r.id))
  const justRevealed = new Set(st.justRevealed)
  const solvedCount = sc.breakthroughs.filter((b) => b.satisfied).length
  const trials = pres.trials ?? []
  const actions = pres.actions ?? []
  const itemCount = trials.filter((t) => t.kind === 'item').length

  const doAction = (id: ScenarioActionId) => {
    sfxTap(sound)
    dispatch({ type: 'play/action', id })
  }

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
        {/* 上一次自由输入被听成了什么 */}
        <FreeEcho />

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
            每动一手耗去一刻。刻尽仍未破局，此局就此了结 —— 线索留下，人还在。
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

        {/* ---------- 通用手段：不依赖行囊，人人可用 ---------- */}
        {actions.length > 0 ? (
          <section className={s.sec}>
            <SectionTitle
              icon={<IconScroll size={15} />}
              text="手段"
              hint="不翻行囊也能做的事 · 各耗一刻"
              tone="jade"
            />
            <div className={s.acts}>
              {actions.map((a) => (
                <button key={a.id} className={s.act} onClick={() => doAction(a.id)}>
                  <span className={s.actTop}>
                    <span className={s.actName}>{a.name}</span>
                    {a.attr ? <span className={s.actAttr}>{ATTR_SHORT[a.attr]}</span> : null}
                  </span>
                  <span className={s.actDesc}>{a.desc}</span>
                  <span className={s.actCost}>{a.cost}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* 「还有一个办法」——摆在手段下方。默认关，见 FreeInput */}
        <FreeInput pres={pres} />

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

      <RevealOverlay open={st.banner?.kind === 'reveal'} text={st.banner?.detail} />
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

/**
 * 入场抉择 —— 剧本先摆在你面前。
 *
 * 触发即入、入则卡死，等于剥夺了选择权：玩家反馈「我的认知里剧本只是一个
 * 随机触发的剧本类事件」。现在它先给你看全貌（名、氛围、明规则、占几刻），
 * 再让你自己决定进去还是绕开。绕开不是白绕过 —— 引擎记一笔代价，
 * 且此局本局不再出现。
 */
function EntryView({
  entry,
  pres,
  onHeaven,
  onBag,
  onEnter,
  onSkip,
  sound,
}: {
  entry: ScenarioEntry
  pres: NodePresentation
  onHeaven: () => void
  /** 行囊：**入场这一拍是最需要看见行囊的时刻**（进不进、带什么进去破局），
   *  偏偏只有它漏传了这个回调 —— StatusBar 落到 bagStatic 分支，
   *  行囊渲染成不可点的 <span>。另外两处（EventScreen / ScenarioScreen 主视图）
   *  都传了。玩家唯一需要做"带什么进去"决定的时刻，是唯一看不到行囊的时刻。 */
  onBag: () => void
  onEnter: () => void
  onSkip: () => void
  sound: boolean
}) {
  const { st, dispatch } = useGame()
  const [bagOpenLocal, setBagOpenLocal] = useState(false)
  const state = st.state
  if (!state) return null
  const lines = entry.lines.length > 0 ? entry.lines : pres.lines

  return (
    <div className={s.wrap}>
      <StatusBar
        state={state}
        content={st.content}
        compact
        onHeaven={onHeaven}
        onBag={onBag}
        onSettings={() => dispatch({ type: 'openSettings' })}
      />

      <TrialPanel open={bagOpenLocal} onClose={() => setBagOpenLocal(false)} pres={pres} />

      <main className={s.main}>
        <header className={`x-card x-card--key ${s.entryHead}`}>
          <span className={s.entryKicker}>
            <IconScroll size={13} />
            一桩剧本 · 尚未入局
          </span>
          <h2 className="x-h1">{entry.name}</h2>
          <span className={s.entrySpan}>
            约 <b className="x-num">{entry.span}</b> 刻 · 不入亦可
          </span>
        </header>

        <section className={s.sec}>
          {/* 怎么走到这里的 —— 剧本是随机撞上的，得有个来路 */}
          {pres.transition ? <p className={s.enterTransition}>{pres.transition}</p> : null}
          <p className={s.entryLine}>{lines.join('')}</p>
        </section>

        {entry.rules_stated.length > 0 ? (
          <section className={s.sec}>
            <SectionTitle icon={<IconRule size={15} />} text="此处明面上的规矩" hint="开局即知" tone="cinnabar" />
            <ul className={s.stated}>
              {entry.rules_stated.map((r, i) => (
                <li key={i} className={s.statedItem}>
                  <span className={s.statedNo}>{CN[i] ?? i + 1}</span>
                  <span className={s.statedText}>{r}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className={s.tail}>
          <span className="x-tiny">
            进去，才知道隐在明面之下的那几条；绕开，你只是错过 —— 不是死。
            但错过的地方，这一世不会再遇上第二次。
          </span>
        </div>
      </main>

      <footer className={s.foot}>
        <button
          className={`x-btn x-btn--gold ${s.bagBtn}`}
          onClick={() => {
            sfxTap(sound)
            onEnter()
          }}
        >
          进 去
        </button>
        <button
          className={`x-btn x-btn--quiet ${s.waitBtn}`}
          onClick={() => {
            sfxTap(sound)
            onSkip()
          }}
        >
          绕 开
        </button>
      </footer>
    </div>
  )
}
