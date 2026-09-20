/**
 * 根组件 —— 只做三件事：挂 Context、切屏、管全局副作用（主题属性 / 存档 / 提示淡出）。
 *
 * 所有业务逻辑都在 store.ts 的 reducer 里；这里不碰任何数值。
 */

import { useEffect, useMemo, useReducer, useState } from 'react'
import { EndingScreen } from './components/EndingScreen'
import { EventScreen } from './components/EventScreen'
import { GenesisScreen } from './components/GenesisScreen'
import { HeavenBoard } from './components/HeavenBoard'
import { ScenarioScreen } from './components/ScenarioScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { DeltaFloats } from './components/DeltaFloats'
import { TitleScreen } from './components/TitleScreen'
import { sfxReveal } from './sfx'
import {
  GameCtx,
  buildHeavenBoard,
  clearSave,
  initState,
  reducer,
  saveSettings,
  writeSave,
  type GameBag,
} from './store'

export function App() {
  const [st, dispatch] = useReducer(reducer, undefined, initState)
  const [heavenOpen, setHeavenOpen] = useState(false)

  const heaven = useMemo(
    () => (st.state ? buildHeavenBoard(st.state, st.content) : []),
    [st.state, st.content],
  )

  const bag: GameBag = useMemo(() => ({ st, dispatch, heaven }), [st, heaven])

  /* ---- 主题属性：动效开关 / 字号三档，落到 <html> 上供 CSS 变量读取 ---- */
  useEffect(() => {
    const el = document.documentElement
    el.dataset.motion = st.settings.motion ? 'on' : 'off'
    el.dataset.fs = st.settings.fontScale
  }, [st.settings.motion, st.settings.fontScale])

  useEffect(() => {
    saveSettings(st.settings)
  }, [st.settings])

  /* ---- 存档：活着就写，终局就焚 ---- */
  useEffect(() => {
    if (!st.state) return
    if (st.state.status === 'ended') clearSave()
    else writeSave(st.state)
  }, [st.state])

  /* ---- 提示自动消失 ---- */
  useEffect(() => {
    if (!st.toast) return
    const t = window.setTimeout(() => dispatch({ type: 'toast', text: null }), 2600)
    return () => window.clearTimeout(t)
  }, [st.toast])

  useEffect(() => {
    if (!st.banner) return
    const t = window.setTimeout(
      () => dispatch({ type: 'banner/clear' }),
      st.banner.kind === 'band' ? 2800 : 3800,
    )
    return () => window.clearTimeout(t)
  }, [st.banner])

  /* ---- 浮字停留后清除 ---- */
  useEffect(() => {
    if (st.floats.length === 0) return
    const t = window.setTimeout(() => dispatch({ type: 'floats/clear' }), 1700)
    return () => window.clearTimeout(t)
  }, [st.floats])

  /* ---- 隐规则揭示：一记磬声 ---- */
  useEffect(() => {
    if (st.justRevealed.length > 0 && st.settings.sound) sfxReveal(true)
  }, [st.justRevealed, st.settings.sound])

  /* ---- 重开 / 回卷首 ---- */
  const restart = () => {
    clearSave()
    dispatch({ type: 'abandon' })
    dispatch({ type: 'goto', screen: 'genesis' })
  }
  const toTitle = () => {
    clearSave()
    dispatch({ type: 'abandon' })
  }

  return (
    <GameCtx.Provider value={bag}>
      <div className="x-app">
        {st.screen === 'title' ? <TitleScreen /> : null}
        {st.screen === 'genesis' ? <GenesisScreen /> : null}
        {st.screen === 'settings' ? <SettingsScreen /> : null}

        {st.screen === 'play' && st.pres ? (
          st.pres.kind === 'scenario' ? (
            <ScenarioScreen pres={st.pres} onHeaven={() => setHeavenOpen(true)} />
          ) : (
            <EventScreen pres={st.pres} onHeaven={() => setHeavenOpen(true)} />
          )
        ) : null}

        {st.screen === 'ending' ? <EndingScreen onRestart={restart} onTitle={toTitle} /> : null}

        <DeltaFloats floats={st.floats} motion={st.settings.motion} />

        {st.toast ? <div className="x-toast">{st.toast}</div> : null}

        <HeavenBoard open={heavenOpen} onClose={() => setHeavenOpen(false)} />
      </div>
    </GameCtx.Provider>
  )
}
