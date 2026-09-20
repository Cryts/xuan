/** 端到端验证：走真实的 UI store（浏览器用的那一套），从转世玩到结局。 */
import { describe, expect, it } from 'vitest'
import { initState, loadContent, reducer, type AppState } from '@/ui/store'

const content = loadContent()
const act = (st: AppState, a: Parameters<typeof reducer>[1]) => reducer(st, a)

describe('端到端：一局完整对局', () => {
  it('从转世到结局，主链路走得通', () => {
    let st = initState()
    st = act(st, { type: 'genesis/setPack', pack: 'mortal' })
    st = act(st, { type: 'genesis/begin', runId: 'e2e-run-1' })

    expect(st.state, '开局后应当有对局状态').toBeTruthy()
    expect(st.screen).toBe('play')

    const ids = new Set<string>()
    let steps = 0
    let scenarioTouches = 0

    while (st.screen === 'play' && steps < 300) {
      steps++
      const p = st.pres
      if (!p) { console.log('!! pres 为空，中止'); break }
      if (p.kind === 'ending') break
      ids.add(p.event_id)
      if (p.kind === 'scenario') scenarioTouches++

      if (p.scenario_entry) {
        st = act(st, { type: 'play/entry', enter: steps % 3 !== 0 })
      } else if (p.kind === 'scenario' && p.actions?.length) {
        const a = p.actions[steps % (p.actions.length - 1)]!
        st = act(st, { type: 'play/action', id: a.id })
      } else if (p.kind === 'scenario' && p.trials?.length) {
        const t = p.trials[steps % p.trials.length]!
        st = act(st, { type: 'play/trial', kind: t.kind, ref: t.ref })
      } else if (p.options.length > 0) {
        st = act(st, { type: 'play/option', optionId: p.options[steps % p.options.length]!.id })
      } else {
        st = act(st, { type: 'play/wait' })
      }
    }

    const nodes = st.state?.node_index ?? 0
    console.log(`【端到端】节点 ${nodes} / 步数 ${steps} / 不同节点 ${ids.size} / 剧本节点 ${scenarioTouches} / screen=${st.screen}`)

    expect(steps, '不应触发死循环保护').toBeLessThan(300)
    expect(nodes, '应当推进到终局').toBeGreaterThanOrEqual(15)
    expect(ids.size, '应当遇到大量不同节点').toBeGreaterThanOrEqual(8)
    expect(st.ending, '必须拿到结局').toBeTruthy()
    expect(st.ending!.title.length).toBeGreaterThan(0)
    expect(st.ending!.stars).toBeGreaterThanOrEqual(1)
    console.log(`【结局】「${st.ending!.title}」${st.ending!.stars}★ · ${st.ending!.lines[0]?.slice(0, 30)}`)
  })

  it('六个体系包都能开局并推进', () => {
    for (const pack of ['mortal', 'genesis' && 'genius', 'physique', 'mystery', 'rebel', 'cautious'] as const) {
      let st = initState()
      st = act(st, { type: 'genesis/setPack', pack })
      st = act(st, { type: 'genesis/begin', runId: `e2e-${pack}` })

      const ids = new Set<string>()
      let steps = 0
      while (st.screen === 'play' && steps < 300) {
        steps++
        const p = st.pres
        if (!p || p.kind === 'ending') break
        ids.add(p.event_id)
        if (p.scenario_entry) {
          st = act(st, { type: 'play/entry', enter: steps % 3 !== 0 })
        } else if (p.kind === 'scenario' && p.actions?.length) {
          const a = p.actions[steps % (p.actions.length - 1)]!
          st = act(st, { type: 'play/action', id: a.id })
        } else if (p.kind === 'scenario' && p.trials?.length) {
          const t = p.trials[steps % p.trials.length]!
          st = act(st, { type: 'play/trial', kind: t.kind, ref: t.ref })
        } else if (p.options.length > 0) {
          st = act(st, { type: 'play/option', optionId: p.options[steps % p.options.length]!.id })
        } else {
          st = act(st, { type: 'play/wait' })
        }
      }
      const nodes = st.state?.node_index ?? 0
      console.log(`【${pack}】节点 ${nodes} · 不同节点 ${ids.size} · 结局 ${st.ending?.title ?? '—'}`)
      expect(nodes, `${pack} 推进不动`).toBeGreaterThanOrEqual(12)
      expect(ids.size, `${pack} 遇到的节点太少`).toBeGreaterThanOrEqual(6)
    }
  })
})
