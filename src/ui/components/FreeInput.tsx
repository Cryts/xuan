/**
 * 自由输入的输入行 —— 「还有一个办法」。
 *
 * 三条设计约束，一条都不能松：
 *
 *   1. **默认关。** 开关没打开时这个组件直接返回 null：DOM 里没有输入框、
 *      没有多出来的一个字节，一切与没有它时完全一样。
 *   2. **不占主视觉。** 1–4 个选项才是主路径。这里是一行安静的字，
 *      没有卡片、没有边框盒子、没有必填标记 —— 像"另外还有一个办法"，
 *      不像一张要填的表。
 *   3. **只把话变成意图。** 判定与结算全在 core：这里算出的 IntentResult
 *      交给 reducer 里的 submitFreeAction，模型碰不到任何数值。
 */

import { useState, type FormEvent } from 'react'
import s from './FreeInput.module.css'
import { FREE_INPUT_MAX } from '@/core/intent'
import type { NodePresentation } from '@/core/types'
import { buildIntentCtx, classifyFreeAction, PROVIDER_LABELS } from '@/ui/intent'
import type { ProviderChoice } from '@/ui/intent'
import { sfxTap } from '@/ui/sfx'
import { useGame } from '@/ui/store'

/** 提示里那半句"这句话谁来听" */
const CHOICE_HINT: Record<ProviderChoice, string> = {
  auto: '自动择取',
  rule: '本地规则',
  api: '浏览器直连',
  ollama: '本地 Ollama',
  native: '主进程',
}

export function FreeInput({ pres }: { pres: NodePresentation }) {
  const { st, dispatch } = useGame()
  const [value, setValue] = useState('')
  // 锁从 store 读，不用 useState：事件页的 main 带 key，一换节点整棵重挂，
  // 组件内的锁会被重置，第一句还在路上输入行就解锁了。
  const busy = st.freeBusy

  const fi = st.settings.freeInput
  const state = st.state

  // 开关关着 = 这个功能不存在。剧本入场那一刻也不给 —— 那时还没有"局"可动。
  if (!fi.enabled || !state || pres.kind === 'ending' || pres.scenario_entry) return null

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const text = value.trim()
    if (text.length === 0 || busy) return

    sfxTap(st.settings.sound)
    setValue('')
    // 局面身份随这一手一起送出去 —— 参详期间局面若换了，结果会被丢掉，
    // 而不是拿去跟新场面较劲。
    const at = `${pres.node_index}:${pres.event_id}`
    dispatch({ type: 'free/pending' })
    try {
      // 这一步可能会等模型（最多 8 秒），所以必须留在 reducer 外面 ——
      // reducer 是纯函数，不能等 I/O。失败一律在 intent 层静默回落规则层。
      const out = await classifyFreeAction(text, buildIntentCtx(state, pres), fi)
      dispatch({ type: 'free/result', input: text, intent: out.intent, provider: out.provider, at })
    } catch (err) {
      // classifyFreeAction 名义上永不抛 —— 真抛了也只当这一手没写
      console.warn('[玄] 自由输入提交异常：', err)
      setValue(text)
      dispatch({ type: 'free/unlock' })
    }
  }

  return (
    <form className={s.row} onSubmit={submit}>
      <span className={s.mark} aria-hidden>
        或
      </span>
      <input
        className={s.input}
        value={value}
        maxLength={FREE_INPUT_MAX}
        disabled={busy}
        spellCheck={false}
        autoComplete="off"
        placeholder="或者，写下你自己想做的…"
        aria-label="自由输入"
        onChange={(e) => setValue(e.target.value)}
      />
      <button className={s.go} type="submit" disabled={busy || value.trim().length === 0}>
        {busy ? '参详…' : '行'}
      </button>
      <span className={s.hint}>
        {busy ? '正在参详' : `回车送上 · ${CHOICE_HINT[fi.provider] ?? PROVIDER_LABELS.rule}`}
      </span>
    </form>
  )
}
