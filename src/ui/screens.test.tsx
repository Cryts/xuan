/**
 * 全屏渲染冒烟 —— 用 react-dom/server 把七个界面各渲染一遍。
 *
 * 目的不是断言像素，而是确保：Context 接线正确、CSS Module 类名取得到、
 * 内容缺失时不会抛错、每屏该出现的关键信息确实出现了。
 */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { buildHeavenBoard, presentCurrent, resolveEnding } from '@/core/engine'
import { EndingScreen } from './components/EndingScreen'
import { EventScreen } from './components/EventScreen'
import { GenesisScreen } from './components/GenesisScreen'
import { HeavenBoard } from './components/HeavenBoard'
import { ScenarioScreen } from './components/ScenarioScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { TitleScreen } from './components/TitleScreen'
import { GameCtx, initState, makeRunId, reducer, type AppState, type GameBag } from './store'

function bagOf(st: AppState): GameBag {
  return {
    st,
    dispatch: () => undefined,
    heaven: st.state ? buildHeavenBoard(st.state, st.content) : [],
  }
}

const draw = (node: React.ReactElement, bag: GameBag) =>
  renderToString(<GameCtx.Provider value={bag}>{node}</GameCtx.Provider>)

function started(pack: 'mortal' | 'mystery' = 'mortal'): AppState {
  let st = initState()
  st = reducer(st, { type: 'genesis/setPack', pack })
  return reducer(st, { type: 'genesis/begin', runId: makeRunId() })
}

describe('界面渲染', () => {
  it('启动页', () => {
    const st = initState()
    const html = draw(<TitleScreen />, bagOf(st))
    expect(html).toContain('玄')
    expect(html).toContain('入 轮 回')
  })

  it('转世页：出身 / 天赋 / 缺陷 / 体系本体都在', () => {
    const st = initState()
    const html = draw(<GenesisScreen />, bagOf(st))
    expect(html).toContain('转 世')
    expect(html).toContain('出身')
    expect(html).toContain('天赋')
    expect(html).toContain('缺陷')
    expect(html).toContain('本体')  // 说明文案里的「本体」二字
  })

  it('事件页：状态条 + 选项的风险/概率/代价', () => {
    const st = started()
    const html = draw(<EventScreen pres={st.pres!} onHeaven={() => undefined} />, bagOf(st))
    expect(html).toContain('寿元')
    expect(html).toContain('修为')
    expect(html).toContain('x-vtitle') // 竖排标题
  })

  it('剧本页：明规则 / 隐规则 / 禁制 / 破局 / 以物试之', () => {
    const base = started('mystery')
    const content = base.content
    const sc = content.scenarios[0]!
    const withRun = {
      ...base.state!,
      active_scenario: {
        scenario_id: sc.id,
        started_at: 0,
        nodes_spent: 0,
        revealed_rules: [],
        solved: [],
        attempted: [],
      },
    }
    const st: AppState = { ...base, state: withRun, pres: presentCurrent({ ...withRun }, content) }
    const html = draw(<ScenarioScreen pres={st.pres!} onHeaven={() => undefined} />, bagOf(st))
    expect(html).toContain('明规则')
    expect(html).toContain('禁制')
    expect(html).toContain('破局条件组')
    expect(html).toContain('以物试之')
    expect(html).toContain('静观其变')
    if (sc.rules_hidden.length > 0) expect(html).toContain('未解')
  })

  it('天机榜：气运与谶语', () => {
    const st = started()
    const html = draw(<HeavenBoard open onClose={() => undefined} />, bagOf(st))
    expect(html).toContain('天 机 榜')
    if ((st.state?.destiny_children.length ?? 0) > 0) {
      expect(html).toContain('气运')
      expect(html).toContain('x-calli') // 竖排书法批注
    }
  })

  it('结局页：卷轴 + 评星 + 再入轮回', () => {
    const st = started()
    const ended = { ...st.state!, status: 'ended' as const, end_reason: 'nodes' }
    const withEnd: AppState = { ...st, state: ended, ending: resolveEnding(ended, st.content) }
    const html = draw(<EndingScreen onRestart={() => undefined} onTitle={() => undefined} />, bagOf(withEnd))
    expect(html).toContain('再 入 轮 回')
    expect(html).toContain('卷')  // 卷轴容器
  })

  it('设置页：动效开关 / 字号 / API Key 风险提示', () => {
    const st: AppState = { ...initState(), screen: 'settings' }
    const html = draw(<SettingsScreen />, bagOf(st))
    expect(html).toContain('音效')
    expect(html).toContain('动效')
    expect(html).toContain('字号')
    expect(html).toContain('风险提示')
    expect(html).toContain('AI 生成')
  })
})
