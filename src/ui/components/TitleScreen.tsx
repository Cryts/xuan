/**
 * 启动页 —— 一滴墨落进宣纸，晕开成「玄」。
 */

import { useEffect, useState } from 'react'
import s from './TitleScreen.module.css'
import { InkBackdrop } from './Shared'
import { IconRebirth, IconScroll, IconSettings } from '@/ui/icons'
import { contentStats, useGame } from '@/ui/store'

export function TitleScreen() {
  const { st, dispatch } = useGame()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), st.settings.motion ? 460 : 0)
    return () => window.clearTimeout(t)
  }, [st.settings.motion])

  const stats = contentStats(st.content)
  const bare = st.content.events.length === 0 && st.content.scenarios.length === 0

  return (
    <div className={s.wrap}>
      <InkBackdrop dense />

      <div className={s.center}>
        <div className={s.markWrap}>
          <span className={s.drop} aria-hidden />
          <h1 className={s.mark}>玄</h1>
        </div>
        <p className={s.sub}>可切换修炼体系的文字修仙</p>
        <p className={s.slogan}>一世一命格 · 一剧本一推理 · 一榜一天机</p>
      </div>

      <div className={`${s.actions} ${ready ? s.actionsOn : ''}`}>
        <button
          className={`x-btn x-btn--primary x-btn--block ${s.big}`}
          onClick={() => dispatch({ type: 'goto', screen: 'genesis' })}
        >
          <IconRebirth size={17} />
          入 轮 回
        </button>

        {st.resumable ? (
          <button className={`x-btn x-btn--block`} onClick={() => dispatch({ type: 'resume' })}>
            <IconScroll size={16} />
            续 前 世
          </button>
        ) : null}

        <button className={`x-btn x-btn--quiet x-btn--block`} onClick={() => dispatch({ type: 'openSettings' })}>
          <IconSettings size={16} />
          设 置
        </button>
      </div>

      <footer className={s.footer}>
        <span className="x-tiny">{stats}</span>
        {bare ? (
          <span className={`x-tiny ${s.warn}`}>内容库尚空 —— 以兜底节点运行，不误开局</span>
        ) : null}
      </footer>
    </div>
  )
}
