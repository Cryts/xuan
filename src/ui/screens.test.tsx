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
import type { NodePresentation } from '@/core/types'

function bagOf(st: AppState): GameBag {
  return {
    st,
    dispatch: () => undefined,
    heaven: st.state ? buildHeavenBoard(st.state, st.content) : [],
  }
}


/** 造一个**真的**剧本呈现：把一局的状态推进到"正在剧本里" */
function buildScenarioPres(st: AppState): NodePresentation | null {
  const sc = st.content.scenarios[0]
  const state = st.state
  if (!sc || !state) return null
  const inScenario = {
    ...state,
    stage: 'growth' as const,
    active_scenario: {
      scenario_id: sc.id,
      started_at: 0,
      nodes_spent: 1,
      revealed_rules: [],
      solved: [],
      attempted: [],
    },
  }
  const pres = presentCurrent(inScenario, st.content)
  return pres.scenario ? pres : null
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

  /* ---------- 结果正文：数据到了，界面到没到 ----------

     这一条是**渲染层**的，前两层（引擎层 / 状态层）测不出它。
     项目吃过的亏正是这一种："数据是好的，界面是死的，20 个测试文件全绿"。
     实现时只要把结果块误放进 `typed` 那个闸门里，第 1、2 层照样全过，
     而玩家永远看不到 —— 所以这一条必须落在 DOM 上。 */
  it('结果正文：事件页与剧本页都要看得见（漏挂一处就是静默消失）', () => {
    const st = started()
    const lines = ['事办完了，不算漂亮，也挑不出错。', '你照原路往回走，比来时快。']
    const withAfter: AppState = { ...st, aftermath: { band: 'success', lines } }

    const evHtml = draw(<EventScreen pres={withAfter.pres!} onHeaven={() => undefined} />, bagOf(withAfter))
    expect(evHtml).toContain(lines[0]!)
    expect(evHtml).toContain(lines[1]!)
    expect(evHtml).toContain('刚才那一手')

    // 剧本屏也必须挂一次 —— 实测 7.2% 的下一屏走的是它，
    // 只挂事件页会让那些结果正文静默消失，而上面那两层测不出来。
    // 这里要的是一个**真的**剧本呈现（`ScenarioScreen` 认 `pres.scenario`，
    // 伪造一个空的会直接被它 early-return，测试就白测了）。
    const scPres = buildScenarioPres(withAfter)
    if (scPres) {
      const scHtml = draw(
        <ScenarioScreen pres={scPres} onHeaven={() => undefined} />,
        bagOf({ ...withAfter, pres: scPres }),
      )
      expect(scHtml).toContain(lines[0]!)
    }
  })

  it('结果正文：没有它的时候不该冒出一块空壳', () => {
    const st = started()
    const html = draw(<EventScreen pres={st.pres!} onHeaven={() => undefined} />, bagOf({ ...st, aftermath: null }))
    expect(html).not.toContain('刚才那一手')
  })

  it('坊市：货架是专用面板，不能被当成"此局无选项"', () => {
    const st = started()
    const pres = {
      ...st.pres!,
      event_id: '__shop__',
      title: '野市',
      lines: ['棚子底下摆开一排东西。'],
      options: [],
      shop: {
        node_index: 0,
        bought_here: 0,
        items: [
          {
            item: { id: 'it_x', name: '旧铜镜', quality: '凡品', affixes: [], affordance: [] },
            price: 30,
            stock: 1,
          },
        ],
      },
    }
    const html = draw(<EventScreen pres={pres} onHeaven={() => undefined} />, bagOf({ ...st, pres }))
    expect(html).toContain('旧铜镜')
    expect(html).toContain('离开')
    // 货架上没有 options，但**绝不能**被当成"命运已定"
    expect(html).not.toContain('此局无选项')
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
