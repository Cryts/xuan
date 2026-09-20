/**
 * 主界面（事件页）—— 顶部状态条 + 中部叙事区（逐字） + 底部选项卡片。
 *
 * 选项卡片必须让玩家看见三件事：风险档位、模糊概率、代价。
 * 我们刻意不显示精确成功率：那是「算计」，不是「修行」。
 */

import { useMemo, useState } from 'react'
import s from './EventScreen.module.css'
import { StatusBar } from './StatusBar'
import { Typewriter } from './Typewriter'
import { BagSheet } from './BagPanel'
import { RevealOverlay, Seal } from './Shared'
import type { NodePresentation, Option } from '@/core/types'
import { IconRisk } from '@/ui/icons'
import { sfxPage, sfxTap } from '@/ui/sfx'
import { useGame } from '@/ui/store'
import { BAND_STYLE, INTENT_DESC, INTENT_NAMES, RISK_STYLE, moodName } from '@/ui/text'

function OptionCard({
  opt,
  index,
  onPick,
}: {
  opt: Option
  index: number
  onPick: (o: Option) => void
}) {
  const risk = RISK_STYLE[opt.risk_tier] ?? RISK_STYLE['常']
  return (
    <button
      className={s.opt}
      style={{ ['--risk' as string]: risk.color, ['--edge' as string]: risk.edge }}
      onClick={() => onPick(opt)}
    >
      <span className={s.optRow}>
        <span className={s.risk}>{opt.risk_tier}</span>
        <span className={s.optText}>{opt.text}</span>
      </span>
      <span className={s.optMeta}>
        <span className={s.odds}>{opt.odds_hint}</span>
        {opt.cost_hint ? <span className={s.cost}>代价 · {opt.cost_hint}</span> : null}
        <span className={s.intent}>
          {INTENT_NAMES[opt.intent] ?? '行'} · {INTENT_DESC[opt.intent] ?? ''}
        </span>
      </span>
      <span className={s.optIndex}>{index + 1}</span>
    </button>
  )
}

export function EventScreen({ pres, onHeaven }: { pres: NodePresentation; onHeaven: () => void }) {
  const { st, dispatch } = useGame()
  const sound = st.settings.sound
  const motion = st.settings.motion

  const lines = useMemo(() => (pres.lines.length > 0 ? pres.lines : ['……']), [pres])
  const nodeKey = `${pres.node_index}:${pres.event_id}`
  const [bagOpen, setBagOpen] = useState(false)

  // 记录「哪一节已经打完字」，而不是布尔值 —— 换节点时不残留上一节的完成态
  const [typedKey, setTypedKey] = useState<string | null>(null)
  const typed = typedKey === nodeKey

  const band = st.banner?.kind === 'band' ? BAND_STYLE[st.banner.text] : undefined

  const pick = (o: Option) => {
    sfxTap(sound)
    dispatch({ type: 'play/option', optionId: o.id })
  }

  if (!st.state) return null

  return (
    <div className={s.wrap}>
      <StatusBar
        state={st.state}
        content={st.content}
        onHeaven={onHeaven}
        onSettings={() => dispatch({ type: 'openSettings' })}
        onBag={() => setBagOpen(true)}
      />

      <main className={s.main} key={nodeKey}>
        <article className={`x-card ${s.narr}`}>
          <div className={s.narrBody}>
            <span className={s.nodeTag}>
              第 <b className="x-num">{pres.node_index + 1}</b> 节
              <i>·</i>
              {moodName(pres.mood)}
            </span>
            {/* 承上启下的接缝。刻意做得比正文轻——它是过场，不是内容 */}
            {pres.transition ? (
              <p className={s.transition} key={`t-${nodeKey}`}>
                {pres.transition}
              </p>
            ) : null}
            <Typewriter
              key={nodeKey}
              lines={lines}
              instant={!motion}
              className={s.lines}
              lineClassName={s.line}
              onDone={() => {
                setTypedKey(nodeKey)
                sfxPage(sound)
              }}
            />
            {!typed ? <span className={s.skip}>轻触跳过</span> : null}

            {band && st.banner ? (
              <div className={s.verdict}>
                <span className="x-band" style={{ color: band.color }}>
                  {band.text}
                </span>
                <span className="x-tiny">{band.desc}</span>
              </div>
            ) : null}
          </div>

          {/* 竖排标题：容器自适应宽，绝不裁字（见 theme.css .x-vtitle 注释） */}
          <div className={s.titleCol}>
            <span className="x-vtitle">{pres.title}</span>
          </div>
        </article>

        <section className={s.opts} data-ready={typed ? '1' : '0'}>
          {typed
            ? pres.options.map((o, i) => (
                <div key={o.id} className={`${s.optWrap} x-in`} style={{ animationDelay: `${i * 70}ms` }}>
                  <OptionCard opt={o} index={i} onPick={pick} />
                </div>
              ))
            : null}
          {typed && pres.options.length === 0 ? (
            <div className={s.sealed}>
              <Seal text="命" tone="plain" />
              <span className="x-small">此局无选项 —— 命运已定。</span>
            </div>
          ) : null}
        </section>
      </main>

      {pres.options.some((o) => o.risk_tier === '绝') ? (
        <div className={s.warnLine}>
          <IconRisk size={13} />
          <span>此处有「绝」档 —— 九死一生，或有大机缘。</span>
        </div>
      ) : null}

      <BagSheet open={bagOpen} onClose={() => setBagOpen(false)} />
      <RevealOverlay open={st.banner?.kind === 'reveal'} text={st.banner?.detail} />
    </div>
  )
}
