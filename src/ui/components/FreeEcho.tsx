/**
 * 「系统怎么理解你写的这句话」—— 自由输入的回显。
 *
 * 这一块是自由输入能不能成立的**关键**。玩家写了一句自然语言，
 * 系统把它听成了什么、落到了哪条规矩上、是照旧法行事还是自辟新路 ——
 * 全都得当场说清楚。否则自由输入就成了抽奖：写十次，中一次，
 * 另外九次玩家不知道自己做错了什么。
 *
 * 四种结果给四种说法（mapped / trial / novel / grounded / refused），
 * 「跨体系融合」另给一个显眼的标记 —— 那是玩家最想要的那种涌现。
 */

import s from './FreeEcho.module.css'
import { Chip, Seal } from './Shared'
import { FREE_INPUT_MAX } from '@/core/intent'
import { stripNumbers } from '@/core/narrative'
import type { FreeActionReport } from '@/core/engine'
import { PROVIDER_LABELS } from '@/ui/intent'
import { useGame } from '@/ui/store'
import { BAND_STYLE, INTENT_DESC, INTENT_NAMES } from '@/ui/text'

type OutcomeKind = FreeActionReport['outcome']

const OUTCOME_COPY: Record<OutcomeKind, { title: string; hint: string }> = {
  mapped: {
    title: '照旧法行事',
    hint: '这句话对上了既有的一条路 —— 呈现与结算，一字不改地走原来的规矩。',
  },
  trial: {
    title: '你拿出了它',
    hint: '以物试之 —— 走的是剧本里原本的破局条件，成败由条件组决定。',
  },
  novel: {
    title: '你自辟了一条路',
    hint: '既有的路都对不上。这一手以你的属性判定成败，得失比寻常事件小。',
  },
  grounded: {
    title: '你摸了摸行囊，里面并没有…',
    hint: '东西不在身上，这一手落不了地。只走了时间 —— 这不是失败，更不是「你错了」。',
  },
  refused: {
    title: '这一手，你没有真的动',
    hint: '没能听出你要做什么。换一种说法，再写一次。',
  },
}

export function FreeEcho() {
  const { st, dispatch } = useGame()
  const echo = st.free
  if (!echo) return null

  const { report, intent } = echo
  const copy = OUTCOME_COPY[report.outcome] ?? OUTCOME_COPY.novel
  const band = report.band ? BAND_STYLE[report.band] : undefined
  const fuse = Boolean(report.fuse)
  const provider = PROVIDER_LABELS[echo.provider as keyof typeof PROVIDER_LABELS] ?? echo.provider

  return (
    <aside className={`x-card ${s.wrap} ${fuse ? s.fuse : ''}`} data-fuse={fuse ? '1' : '0'}>
      <header className={s.head}>
        <span className={s.kicker}>系统怎么理解你写的这句话</span>
        <span className={s.headEnd}>
          <Chip>{provider}</Chip>
          {fuse ? <Seal text="合" tone="gold" /> : null}
          <button className={s.close} onClick={() => dispatch({ type: 'free/dismiss' })} aria-label="收起">
            收起
          </button>
        </span>
      </header>

      {/* 原话截断后回显 —— 玩家一眼能看出系统读进去的是什么 */}
      <p className={s.quote}>「{stripNumbers(echo.input).slice(0, FREE_INPUT_MAX)}」</p>

      <p className={s.understood}>{report.understood}</p>

      <p className={s.verdict}>
        <span className={s.intent}>{INTENT_NAMES[intent.intent] ?? '行'}</span>
        <b>{copy.title}</b>
        {band ? (
          <span className={s.band} style={{ color: band.color }}>
            {band.text}
          </span>
        ) : null}
        {report.landing ? <span className={s.landing}>落在 · {report.landing}</span> : null}
      </p>

      <p className={s.hint}>
        {copy.hint}
        {intent.approach ? <span className={s.approach}>（听成：{stripNumbers(intent.approach)}）</span> : null}
      </p>

      {fuse ? (
        <p className={s.fuseLine}>
          <Seal text="合" tone="gold" />
          两套本不相干的规矩，在这里接上了 —— 这是玩家自己走出来的一条路。
        </p>
      ) : null}

      {/* 旁白：模型写的（已剥数值），或引擎给的兜底说法 */}
      {report.narration && report.narration.length > 0 ? (
        <div className={s.narr}>
          {report.narration.map((l, i) => (
            <p key={i}>{stripNumbers(l)}</p>
          ))}
        </div>
      ) : null}

      <p className={s.note}>{INTENT_DESC[intent.intent] ?? ''} · 数值全由引擎结算，模型不参与。</p>
    </aside>
  )
}
