/**
 * 结局页 —— 卷轴展开。
 *
 * 与事件页的「逐字打字」刻意相反：卷轴是**已经写好的东西**，
 * 所以用整卷展开 + 逐行浮现，而不是即时书写。
 *
 * L3（可选）：玩家自备 Key 时，可让玄机重写此卷；生成物必须带「AI 生成」标识，
 * 且随时可退回 L2 原文 —— 底稿永远是可信的那一份。
 */

import { useEffect, useMemo, useState } from 'react'
import s from './EndingScreen.module.css'
import { Chip, InkBackdrop, Seal, Stars } from './Shared'
import { sfxReveal, sfxToll } from '@/ui/sfx'
import { useGame } from '@/ui/store'
import { generateScroll, type L3Result } from '@/ui/l3'
import { IconQuill, IconRebirth, IconScroll } from '@/ui/icons'
import { packName, realmName } from '@/ui/text'

export function EndingScreen({
  onRestart,
  onTitle,
}: {
  onRestart: () => void
  onTitle: () => void
}) {
  const { st } = useGame()
  const [l3, setL3] = useState<L3Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const ending = st.ending
  const state = st.state
  const sound = st.settings.sound
  const key = st.settings.apiKey.trim()

  const facts = useMemo(() => {
    if (!state) return []
    const slain = state.destiny_children.filter((d) => !d.alive)
    const out = [
      `出身体系：${packName(st.content, state.pack_id)}`,
      `终至境界：${realmName(st.content, state.pack_id, state.realm_idx)}`,
      `战力指数：${state.power_index}`,
      `因果债务：${state.vars.debt}`,
      `功德：${state.vars.karma}`,
      `心魔：${state.vars.corruption}`,
      `历事：${state.node_index} 节`,
      `破去的剧本：${state.completed_scenarios.length} 局`,
    ]
    if (slain.length > 0) out.push(`猎杀位面之子：${slain.map((d) => d.name).join('、')}`)
    return out
  }, [state, st.content])

  useEffect(() => {
    if (!sound) return
    const t = window.setTimeout(() => sfxToll(true), 400)
    return () => window.clearTimeout(t)
  }, [sound])

  if (!ending) return null

  const title = l3?.title ?? ending.title
  const lines = l3?.lines ?? ending.lines

  const ask = async () => {
    if (!state || busy) return
    setBusy(true)
    setErr(null)
    const r = await generateScroll({
      apiKey: key,
      facts,
      baseLines: ending.lines,
      baseTitle: ending.title,
      verdict: ending.verdict,
      stars: ending.stars,
    })
    setBusy(false)
    if (!r) {
      setErr('玄机未应 —— 已仍用原有卷轴。')
      return
    }
    setL3(r)
    sfxReveal(sound)
  }

  return (
    <div className={s.wrap}>
      <InkBackdrop />

      <div className={s.scroll}>
        <span className={s.rod} />
        <article className={`x-grain ${s.paper}`}>
          <span className={s.kicker}>终</span>

          <h1 className={s.title}>{title}</h1>
          {l3 ? (
            <span className={s.aiTag}>
              <Chip tone="gold">AI 生成</Chip>
            </span>
          ) : null}

          <div className={s.rule} />

          <div className={s.lines}>
            {lines.map((l, i) => (
              <p key={i} className={s.line} style={{ animationDelay: `${420 + i * 260}ms` }}>
                {l}
              </p>
            ))}
          </div>

          <div className={s.rating}>
            <Stars n={ending.stars} size={17} />
            <span className={s.verdictSeal}>
              <Seal text={ending.verdict} tone="cinnabar" className={s.bigSeal} />
            </span>
          </div>

          <div className={s.meta}>
            <span className="x-tiny">
              轮回点 <b className="x-num">{ending.meta.legacy_points}</b>
            </span>
            {ending.meta.unlock.length > 0 ? (
              <span className="x-tiny">解锁 · {ending.meta.unlock.join('、')}</span>
            ) : null}
            <span className="x-tiny">
              {ending.ending ? `结局 · ${ending.ending.category}` : '无名之终'}
            </span>
          </div>
        </article>
        <span className={s.rod} />
      </div>

      <div className={s.actions}>
        {key ? (
          <button className="x-btn x-btn--gold x-btn--block" onClick={() => void ask()} disabled={busy}>
            <IconQuill size={16} />
            {busy ? '玄 机 运 转 中 …' : l3 ? '再 请 玄 机' : '以 玄 机 重 写 此 卷'}
          </button>
        ) : (
          <p className={s.hint}>
            于「设置」填入 API Key，可让玄机为这一世重写卷轴（AI 生成，非本作原有文本）。
          </p>
        )}
        {err ? <p className={s.err}>{err}</p> : null}
        {l3 ? (
          <button className="x-btn x-btn--quiet x-btn--block" onClick={() => setL3(null)}>
            退回原有卷轴
          </button>
        ) : null}

        <button className="x-btn x-btn--primary x-btn--block" onClick={onRestart}>
          <IconRebirth size={16} />
          再 入 轮 回
        </button>
        <button className="x-btn x-btn--quiet x-btn--block" onClick={onTitle}>
          <IconScroll size={15} />
          回 到 卷 首
        </button>
      </div>
    </div>
  )
}
