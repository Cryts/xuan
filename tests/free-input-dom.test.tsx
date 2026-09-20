// @vitest-environment jsdom
/**
 * 自由输入 —— **真实 DOM 交互**（jsdom + Testing Library）。
 *
 * 为什么单独一个文件：其余测试要么是纯函数（reducer / 规则 / 内容校验），要么是
 * SSR 字符串断言。它们都很好，但问不出那一句最要紧的话 ——
 * 「玩家真的打字、真的按回车，这条路走通了吗」。
 *
 * 所以这里用 `// @vitest-environment jsdom` 单独把作用域切到 jsdom，
 * 让其余 170 个测试继续跑在 node 里，不为这一个文件变慢
 * （详见 vite.config.ts 的 test 一节）。
 *
 * 覆盖的是输入行这一层的**每个出口**：
 *   开关关着 = 不存在 → 打字 → 回车 → 交 provider → 回显 → 收尾，
 *   外加截断、空输入、提交中禁用、五种 outcome 的回显文案、数字剥离。
 */

import { useEffect, useReducer, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventScreen } from '@/ui/components/EventScreen'
import { FreeEcho } from '@/ui/components/FreeEcho'
import { FreeInput } from '@/ui/components/FreeInput'
import type { FreeActionReport } from '@/core/engine'
import { FREE_INPUT_MAX } from '@/core/intent'
import type { NodePresentation, ScenarioEntry } from '@/core/types'
import {
  GameCtx,
  initState,
  reducer,
  type AppState,
  type FreeEcho as FreeEchoState,
  type GameBag,
} from '@/ui/store'
import type { ClassifyOutcome, FreeInputSettings, IntentCtx } from '@/ui/intent'

/* ============================================================
   一、夹具
   ============================================================ */

/** 固定 runId：开局状态完全可复现，断言才敢写死 */
const RUN_ID = 'run_dom_fixture'

const ENABLED: FreeInputSettings = {
  enabled: true,
  provider: 'rule', // 规则层离线、确定、永不失败 —— 拿它当"模型"最好断言
  apiUrl: '',
  apiModel: '',
  apiKey: '',
  ollamaUrl: '',
  ollamaModel: '',
}

/**
 * 唯一被拦的出口是 classifyFreeAction —— 为了造出"模型还在参详"的那几秒。
 * 其余一切都走真货：真 provider、真 reducer、真引擎、真组件树。
 */
const mocks = vi.hoisted(() => ({
  classify: vi.fn(),
  real: undefined as
    | undefined
    | ((input: string, ctx: IntentCtx, fi: FreeInputSettings) => Promise<ClassifyOutcome>),
}))

vi.mock('@/ui/intent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/intent')>()
  mocks.real = actual.classifyFreeAction
  return { ...actual, classifyFreeAction: (...args: unknown[]) => mocks.classify(...args) }
})

beforeEach(() => {
  mocks.classify.mockReset()
  // 默认：调用即真算 —— 只有明确要"挂住"的用例才覆盖它
  mocks.classify.mockImplementation((...a: unknown[]) => mocks.real!(...(a as [string, IntentCtx, FreeInputSettings])))
})

afterEach(() => {
  // vitest 配的是 globals:false，Testing Library 不会自动挂 afterEach，
  // 不清 DOM 的话第二个用例会撞见第一个用例留下的输入框。
  cleanup()
  vi.unstubAllGlobals()
})

/** 把最新的 GameBag 抓出来 —— 组件树里的 dispatch 才会推动真 reducer */
const box: { bag: GameBag | null } = { bag: null }

function Harness() {
  const [st, dispatch] = useReducer(reducer, undefined, initState)
  const heaven: GameBag['heaven'] = []
  useEffect(() => {
    box.bag = { st, dispatch, heaven }
  })
  return (
    <GameCtx.Provider value={{ st, dispatch, heaven }}>
      {/* 真界面：状态条 + 正文 + 选项卡片 + 回显 + 输入行，与玩家看到的同一棵树 */}
      {st.state && st.pres && st.screen === 'play' ? <EventScreen pres={st.pres} onHeaven={() => undefined} /> : null}
    </GameCtx.Provider>
  )
}

/** 开一局：打开开关 → 转世 → 等输入行出现（motion 关掉，正文不打字，选项立刻可点） */
async function boot(opts: { enabled?: boolean } = {}) {
  box.bag = null
  const user = userEvent.setup()
  render(<Harness />)
  const bag = () => box.bag!
  bag().dispatch({
    type: 'settings',
    patch: { motion: false, freeInput: { ...ENABLED, enabled: opts.enabled ?? true } },
  })
  bag().dispatch({ type: 'genesis/begin', runId: RUN_ID })
  // 这两下 dispatch 在 act 之外，冲一下让它们真的落进树里（开关关着时没有输入框可等）
  await act(async () => undefined)
  return { user, bag }
}

const presKey = (p: NodePresentation) => `${p.node_index}:${p.event_id}`

/** 选项卡片：真界面里由 EventScreen 渲染，只在正文打完字（data-ready=1）后出现 */
function optionButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('section[data-ready="1"] button'))
}

const submitButton = (input: HTMLElement) => input.closest('form')!.querySelector('button[type="submit"]')!

/** 手搓一个回显 —— 用来把五种 outcome 逐一喂给 FreeEcho */
function echoBag(report: FreeActionReport, over: Partial<FreeEchoState> = {}): GameBag {
  const st: AppState = {
    ...initState(),
    screen: 'play',
    free: {
      input: '抢过他手里的书',
      provider: 'rule',
      intent: { intent: 'greedy', confidence: 0.5, approach: '夺那卷书' },
      report,
      ...over,
    },
  }
  return { st, dispatch: vi.fn(), heaven: [] }
}

const draw = (node: ReactElement, bag: GameBag) =>
  render(<GameCtx.Provider value={bag}>{node}</GameCtx.Provider>)

const DIGITS = /[0-9０-９]/

/* ============================================================
   二、开关：关着 = 这个功能不存在
   ============================================================ */

describe('输入行的开关', () => {
  it('开关关着时，事件页里没有输入框，也没有任何请求发出', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { user, bag } = await boot({ enabled: false })
    expect(bag().st.pres).not.toBeNull() // 局已经开了，是"开关"在挡，不是"还没开局"
    expect(bag().st.settings.freeInput.enabled).toBe(false)

    expect(screen.queryByLabelText('自由输入')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.querySelectorAll('input')).toHaveLength(0)
    expect(document.querySelector('form')).toBeNull()

    // 玩家乱敲一通，也不该惊动任何人
    await user.keyboard('我不管我要抢{Enter}')
    expect(mocks.classify).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(bag().st.free).toBeNull()
  })

  it('开关打开后，输入行出现在选项下方（不抢主路，按钮默认点不动）', async () => {
    const { bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement

    expect(input.tagName).toBe('INPUT')
    expect(input.placeholder).toContain('或者，写下你自己想做的')
    expect(input.maxLength).toBe(FREE_INPUT_MAX)
    expect(input.disabled).toBe(false)

    // 空输入时「行」是禁用的 —— 一眼就知道还没什么可送
    const btn = submitButton(input) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toBe('行')
    expect(bag().st.free).toBeNull()
  })

  it('结局呈现 / 剧本入场 / 尚未开局 —— 这三种时候输入行都不给', async () => {
    const { bag } = await boot()
    await screen.findByLabelText('自由输入')
    const pres = bag().st.pres!

    const cases: Array<[string, NodePresentation, AppState]> = [
      ['结局', { ...pres, kind: 'ending' }, bag().st],
      [
        '剧本入场',
        {
          ...pres,
          scenario_entry: { scenario_id: 'scn_x', name: '某局', lines: [], rules_stated: [], span: 3 } as ScenarioEntry,
        },
        bag().st,
      ],
      ['尚未开局', pres, { ...bag().st, state: null }],
    ]

    for (const [name, p, st] of cases) {
      const view = draw(<FreeInput pres={p} />, { ...bag(), st })
      expect(view.container.querySelector('input'), `${name}时不该有输入框`).toBeNull()
      expect(view.container.querySelector('form'), `${name}时不该有表单`).toBeNull()
      view.unmount()
    }
  })
})

/* ============================================================
   三、打字 → 回车 → 交 provider → 回显
   ============================================================ */

describe('打字 → 回车 → 提交', () => {
  it('回车把玩家写的那句话原样送进 provider，结果回显在同一页上', async () => {
    const { user, bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement

    await user.type(input, '抢过他手里的书')
    expect(input.value).toBe('抢过他手里的书')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(bag().st.free).not.toBeNull())

    // ① 交给 provider 的，就是玩家写的那句话 —— 一个字不多、一个字不少
    expect(mocks.classify).toHaveBeenCalledTimes(1)
    expect(mocks.classify.mock.calls[0][0]).toBe('抢过他手里的书')

    // ② 引擎跑完，回显记在 state 上
    const echo = bag().st.free!
    expect(echo.input).toBe('抢过他手里的书')
    expect(echo.provider).toBe('rule')
    expect(echo.report.outcome).toBeTruthy()

    // ③ 屏幕上真的看得见：原话 + 「系统怎么理解」
    expect(screen.getByText('系统怎么理解你写的这句话')).toBeTruthy()
    expect(screen.getByText('「抢过他手里的书」')).toBeTruthy()
    expect(screen.getByText('本地规则')).toBeTruthy()

    // ④ 送出去之后输入框自己清干净，不会把上一句话留着又送一遍
    expect(input.value).toBe('')
    expect((submitButton(input) as HTMLButtonElement).disabled).toBe(true)
  })

  it('点「行」按钮与按回车走的是同一条路', async () => {
    const { user, bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement

    await user.type(input, '先看看四周的动静')
    const btn = submitButton(input)
    expect((btn as HTMLButtonElement).disabled).toBe(false)
    await user.click(btn)

    await waitFor(() => expect(bag().st.free).not.toBeNull())
    expect(mocks.classify.mock.calls[0][0]).toBe('先看看四周的动静')
    expect(bag().st.free!.input).toBe('先看看四周的动静')
  })

  it('provider 万一真抛了异常，原话还给玩家、不留半条回显、锁也解开', async () => {
    mocks.classify.mockImplementation(() => Promise.reject(new Error('接口炸了')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const { user, bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement
    await user.type(input, '抢过他手里的书')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(input.disabled).toBe(false))
    expect(input.value).toBe('抢过他手里的书') // 没丢，改一改还能再送
    expect(bag().st.free).toBeNull()
    expect(screen.queryByText('系统怎么理解你写的这句话')).toBeNull()
    warn.mockRestore()
  })

  it('「收起」把回显撤掉，页面上不再有它', async () => {
    const { user, bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement
    await user.type(input, '抢过他手里的书{Enter}')
    await screen.findByText('系统怎么理解你写的这句话')

    await user.click(screen.getByRole('button', { name: '收起' }))

    await waitFor(() => expect(bag().st.free).toBeNull())
    expect(screen.queryByText('系统怎么理解你写的这句话')).toBeNull()
  })
})

/* ============================================================
   四、提交中：锁住，不许连点
   ============================================================ */

describe('参详期间（提交在途）', () => {
  it('输入框与按钮都禁用，再按回车也不会重复提交；结束后恢复', async () => {
    let release: ((v: ClassifyOutcome) => void) | undefined
    mocks.classify.mockImplementation(() => new Promise<ClassifyOutcome>((res) => (release = res)))

    const { user, bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement
    await user.type(input, '抢过他手里的书')
    await user.keyboard('{Enter}')

    // 挂住了：输入行整行锁死
    expect(mocks.classify).toHaveBeenCalledTimes(1)
    expect(input.disabled).toBe(true)
    expect((submitButton(input) as HTMLButtonElement).disabled).toBe(true)
    expect((submitButton(input) as HTMLButtonElement).textContent).toBe('参详…')
    expect(screen.getByText('正在参详')).toBeTruthy()
    expect(input.value).toBe('')

    // 连按：真浏览器里输入框已禁用，这里直接把表单提交打进去，考的是那一层 guard
    fireEvent.submit(input.closest('form')!)
    fireEvent.keyDown(document.body, { key: 'Enter', code: 'Enter' })
    expect(mocks.classify).toHaveBeenCalledTimes(1)
    expect(bag().st.free).toBeNull()

    // 模型回来了：解锁，结果照常落地
    const out = await mocks.real!('抢过他手里的书', { scene: '', options: [], possessions: [] }, bag().st.settings.freeInput)
    await act(async () => {
      release!(out)
      await Promise.resolve()
    })

    await waitFor(() => expect(bag().st.free).not.toBeNull())
    // 这一手推进了节点，EventScreen 的 <main key={nodeKey}> 会整棵重挂 ——
    // 上面那个 input 已经是拆下来的旧节点，锁的状态要问**现在**这个。
    const live = (await screen.findByLabelText('自由输入')) as HTMLInputElement
    expect(live.disabled).toBe(false)
    expect((submitButton(live) as HTMLButtonElement).textContent).toBe('行')
    expect(live.value).toBe('')
  })
})

/* ============================================================
   五、截断与空输入
   ============================================================ */

describe('输入的边界', () => {
  it('打字超过上限就打不进去了，送出去的正好是上限那一段', async () => {
    const { user, bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement
    const long = '夺'.repeat(FREE_INPUT_MAX + 40)

    await user.type(input, long)
    expect(input.value.length).toBe(FREE_INPUT_MAX)
    expect(input.value).toBe('夺'.repeat(FREE_INPUT_MAX))

    await user.keyboard('{Enter}')
    await waitFor(() => expect(bag().st.free).not.toBeNull())

    expect((mocks.classify.mock.calls[0][0] as string).length).toBe(FREE_INPUT_MAX)
    expect(bag().st.free!.input).toBe('夺'.repeat(FREE_INPUT_MAX))
  })

  it('粘贴一整本书也只会留下上限那一段', async () => {
    const { user, bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement

    await user.click(input)
    await user.paste('把'.repeat(FREE_INPUT_MAX * 5))
    expect(input.value.length).toBe(FREE_INPUT_MAX)

    await user.keyboard('{Enter}')
    await waitFor(() => expect(bag().st.free).not.toBeNull())
    expect((mocks.classify.mock.calls[0][0] as string).length).toBe(FREE_INPUT_MAX)
    expect(bag().st.free!.input.length).toBe(FREE_INPUT_MAX)
  })

  it('万一值被脚本/自动填充塞到超长，回显与结算也只认前 120 字', async () => {
    const { bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement

    // maxlength 只管得住"人打进去的"，管不住程序写进去的 —— 下游得自己兜住
    fireEvent.change(input, { target: { value: '夺'.repeat(FREE_INPUT_MAX * 3) } })
    expect(input.value.length).toBe(FREE_INPUT_MAX * 3)
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(bag().st.free).not.toBeNull())
    expect(bag().st.free!.input.length).toBe(FREE_INPUT_MAX)
    expect(screen.getByText(`「${'夺'.repeat(FREE_INPUT_MAX)}」`)).toBeTruthy()
  })

  it('只敲空白字符，回车与点击都不提交', async () => {
    const { user, bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement

    await user.type(input, '   ')
    expect(input.value).toBe('   ')
    // 空输入连按钮都点不动
    expect((submitButton(input) as HTMLButtonElement).disabled).toBe(true)

    await user.keyboard('{Enter}')
    await user.click(submitButton(input))
    // 就算表单真被提交了（脚本 / 回车），那一层 guard 也得挡住
    fireEvent.submit(input.closest('form')!)

    expect(mocks.classify).not.toHaveBeenCalled()
    expect(bag().st.free).toBeNull()
  })
})

/* ============================================================
   六、回显：系统怎么理解你写的这句话
   ============================================================ */

describe('FreeEcho 回显', () => {
  const CASES: Array<[FreeActionReport['outcome'], string]> = [
    ['mapped', '照旧法行事'],
    ['trial', '你拿出了它'],
    ['novel', '你自辟了一条路'],
    ['grounded', '你摸了摸行囊，里面并没有'],
    ['refused', '这一手，你没有真的动'],
  ]

  it.each(CASES)('outcome = %s 时，说的是「%s」', (outcome, copy) => {
    const view = draw(
      <FreeEcho />,
      echoBag({ outcome, understood: '你打算对眼前这场面，抢过他手里的书。', narration: ['你按自己的想法动了手。'] }),
    )
    const text = view.container.textContent ?? ''
    expect(text).toContain('系统怎么理解你写的这句话')
    expect(text).toContain(copy)
    expect(text).toContain('本地规则') // 谁听懂的，写在脸上
    expect(text).toContain('「抢过他手里的书」') // 原话回显
  })

  it('没有回显时，什么都不渲染', () => {
    const view = draw(<FreeEcho />, { ...echoBag({ outcome: 'novel' }), st: { ...initState(), free: null } })
    expect(view.container.textContent).toBe('')
  })

  it('跨体系融合（fuse）有显眼的标记：合印 + 一句话说明', () => {
    const fused = draw(
      <FreeEcho />,
      echoBag({ outcome: 'novel', fuse: true, band: 'success', understood: '你打算对眼前这场面，抢过他手里的书。' }),
    )
    const aside = fused.container.querySelector('aside')!
    expect(aside.getAttribute('data-fuse')).toBe('1')
    expect(aside.textContent).toContain('两套本不相干的规矩，在这里接上了')
    expect(aside.querySelectorAll('.x-seal').length).toBeGreaterThanOrEqual(2) // 题头一枚 + 正文一枚
    expect(fused.container.textContent).toContain('成功') // 段位照常给
    fused.unmount()

    const plain = draw(<FreeEcho />, echoBag({ outcome: 'novel', fuse: false }))
    const pAside = plain.container.querySelector('aside')!
    expect(pAside.getAttribute('data-fuse')).toBe('0')
    expect(pAside.textContent).not.toContain('两套本不相干的规矩')
  })

  it('数字剥离：回显上不留阿拉伯数字（原话、旁白、听成的说法都一样）', () => {
    const view = draw(
      <FreeEcho />,
      echoBag(
        {
          outcome: 'novel',
          understood: '你打算对眼前这场面，用成力气。', // 上游 sanitizeReport 已剥过
          narration: ['你数了数，得灵石120枚，第3次试它，约3.5成把握，至多分得20。'],
        },
        { input: '第3次拿5瓶药', intent: { intent: 'greedy', confidence: 0.5, approach: '用2成力气' } },
      ),
    )
    const text = view.container.textContent ?? ''
    expect(text).not.toMatch(DIGITS)
    expect(text).toContain('你数了数，得枚') // 数字与量词一起没了，话还连着
    expect(text).toContain('（听成：用力气）') // "2成"整体剥掉 —— "成"是量词
    expect(text).toContain('「第拿瓶药」')
  })

  it('数字剥离：真跑一遍也剥干净（玩家在输入行里写的数字同样不上屏）', async () => {
    const { user, bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement

    await user.type(input, '第7次试着用3成力气夺宝')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(bag().st.free).not.toBeNull())

    // 交给 provider 的还是原话（数字由引擎剥，不在这一层改玩家的字）
    expect(mocks.classify.mock.calls[0][0]).toBe('第7次试着用3成力气夺宝')
    // 但上屏的每一个字都过闸
    const aside = document.querySelector('aside')!
    expect(aside.textContent ?? '').not.toMatch(DIGITS)
    expect(aside.textContent).toContain('系统怎么理解你写的这句话')
  })
})

/* ============================================================
   七、已知缺陷（不是"通过"，是"记在案上"）
   ============================================================ */

/**
 * 【现象】提交在路上时，输入行锁住了，**但选项卡片还能点**。
 *   点下去 → 节点推进 → 这一手的结果才回来 —— 而 reducer 是拿"此刻的
 *   pres/state"去落地的（src/ui/store.ts 的 `case 'free/result'`），
 *   于是玩家写在**上一个场面**里的一句话，落在了**下一个场面**上，
 *   还又推了一格。
 *
 * 【复现】provider 用模型（api / ollama / native，最多 8 秒）：写一句 →
 *   回车 → 等得不耐烦，点了面前的选项 → 结果回来时你看回显里的
 *   「你打算对……」说的已经是新场面的事了。规则层是微秒级，看不见；
 *   这正是"自由输入只有接了模型才显形"的那一类问题。
 *
 * 【建议改法（UI 层，不碰 core）】把呈现身份随结果一起带走，过期的丢掉：
 *      dispatch({ type: 'free/result', …, at: `${pres.node_index}:${pres.event_id}` })
 *      case 'free/result': {
 *        if (action.at !== `${pres.node_index}:${pres.event_id}`) return { ...st, toast: '你写的那一句慢了半步 —— 局面已经换了。' }
 *   或者反过来：参详期间把选项卡片也一起禁用（busy 提到 store 里）。
 *
 * 【这条测试为什么长这样】vitest 3.2 没有 `it.failing`，所以手搓一个：
 *   现在缺陷在，它绿；**谁把它修好了，这条会立刻转红** —— 那时候请把它
 *   改成普通的 `it(...)`，把 catch 删掉。
 */
describe('回归：参详期间换局面（此前是真缺陷，已修）', () => {
  // 这两条原先写成"在案"——断言缺陷仍然存在，修好后自动转红。
  // 缺陷已修，所以它们现在反过来断言**正确行为**，并在注释里留下原委。
  // 根因是同一个：模型调用最多要等八秒，而等待期间局面是活的。

  it('过期的一手被丢掉，不在新场面上再推一格', async () => {
    let release: ((v: ClassifyOutcome) => void) | undefined
    mocks.classify.mockImplementation(() => new Promise<ClassifyOutcome>((res) => (release = res)))

    const { user, bag } = await boot()
    const input = (await screen.findByLabelText('自由输入')) as HTMLInputElement
    const started = presKey(bag().st.pres!)

    await user.type(input, '抢过他手里的书')
    await user.keyboard('{Enter}')
    expect(mocks.classify).toHaveBeenCalledTimes(1)

    // 参详期间玩家点了选项，往前走了一格
    await user.click(optionButtons()[0])
    await waitFor(() => expect(presKey(bag().st.pres!)).not.toBe(started))
    const afterClick = presKey(bag().st.pres!)

    // 模型这才回来 —— 这一手是冲着**上一个**场面说的
    const out = await mocks.real!(
      '抢过他手里的书',
      { scene: '', options: [], possessions: [] },
      bag().st.settings.freeInput,
    )
    await act(async () => {
      release!(out)
      await Promise.resolve()
    })

    // 节点不再往前走，并明确告诉玩家"慢了半步"
    await waitFor(() => expect(bag().st.toast ?? '').toContain('慢了半步'))
    expect(presKey(bag().st.pres!), '过期的一手不该落在新场面上').toBe(afterClick)
    expect(bag().st.free, '过期的结果不该写回显').toBeNull()
  })

  it('锁存在 store 里，换节点重挂之后仍然是锁着的', async () => {
    let release: ((v: ClassifyOutcome) => void) | undefined
    mocks.classify.mockImplementation(() => new Promise<ClassifyOutcome>((res) => (release = res)))

    const { user, bag } = await boot()
    const first = (await screen.findByLabelText('自由输入')) as HTMLInputElement
    const started = presKey(bag().st.pres!)
    await user.type(first, '抢过他手里的书')
    await user.keyboard('{Enter}')
    expect(first.disabled).toBe(true)

    await user.click(optionButtons()[0])
    await waitFor(() => expect(presKey(bag().st.pres!)).not.toBe(started))

    const second = (await screen.findByLabelText('自由输入')) as HTMLInputElement
    expect(second).not.toBe(first) // 确实是重挂出来的新的一行
    expect(mocks.classify).toHaveBeenCalledTimes(1) // 第一句还在路上
    expect(second.disabled, '路上还有一句话时，输入行不该解锁').toBe(true)

    // 收尾：把在途的那一句放回来，别留给下一个用例
    const out = await mocks.real!(
      '抢过他手里的书',
      { scene: '', options: [], possessions: [] },
      bag().st.settings.freeInput,
    )
    await act(async () => {
      release!(out)
      await Promise.resolve()
    })
    await waitFor(() => expect(bag().st.freeBusy).toBe(false))
  })
})
