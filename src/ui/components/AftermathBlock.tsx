/**
 * 「刚才那一手」—— 选项结算之后的结果正文。
 *
 * 这个块是补一条**从来没通过**的数据路径：`EngineResult.narrative` 由
 * `submitOption` 产出、在引擎里躺了很久，而 `afterEngine` 只收
 * `state / presentation / delta / band` 四样 —— 于是玩家每次选完，
 * 看到的"结果"其实是把开场白再念一遍（实测 2181 条段位引用 0% 可解析，
 * 后来内容侧修好了引用，但显示路径还是断的）。
 *
 * 三条设计约束，都来自实测，不是口味：
 *
 * 1. **不新开一屏。** 结果正文在 **100%** 的选择上都会出现 —— 它是每一拍的
 *    常驻件，不是偶发件。给它一屏 = 一局二三十次多余点击。
 * 2. **不逐字。** 选项被 `typed` 闸着（见 `EventScreen`），逐字是强制性等待。
 *    再插一个打字机 = 每拍多等约三秒。而且语义上，逐字是"正在展开"的语法，
 *    段位判决已经落定，它该被**给**出来，不是被**演**出来。
 * 3. **挂在两个屏上**（`EventScreen` + `ScenarioScreen`）。实测 7.2% 的下一屏
 *    走 `ScenarioScreen` / `EndingScreen` —— 只挂事件页会让那 7.2% 静默消失，
 *    而数据层与状态层的测试**测不出**这种消失。所以 `screens.test` 里
 *    有一条专钉它。
 *
 * 四档的区分落在**壳**上而不是文字上：实测只有 44.7% 的段位槽写了
 * 分档正文，其余 55.3% 回落到不分档的池子 —— 正文承担不了分档。
 * 壳由三样构成（字 / 色 / 左边框），其中**那枚字是必需项不是装饰**：
 * WCAG 2.1 SC 1.4.1 要求不能只靠颜色传达信息。
 */

import s from './AftermathBlock.module.css'
import { Seal } from './Shared'
import { useGame } from '@/ui/store'
import { BAND_STYLE } from '@/ui/text'
import { stripNumbers } from '@/core/narrative'

/** 段位 → 壳上那一枚字。四档各一个字，含"没有段位"那一档。 */
const BAND_SEAL: Record<string, string> = {
  crit: '极',
  success: '成',
  fail: '阻',
  crit_fail: '厄',
}

export function AftermathBlock() {
  const { st } = useGame()
  const after = st.aftermath
  if (!after || after.lines.length === 0) return null

  const band = after.band ? BAND_STYLE[after.band] : undefined
  const seal = after.band ? BAND_SEAL[after.band] : undefined
  // 数值剥离：结果正文走的是 L2 池，构建期 `no_numbers` 已经拦过一道，
  // 但这里再兜一层 —— 与 `FreeEcho` 的旁白同一条纪律。
  const lines = after.lines.map((l) => stripNumbers(l)).filter((l) => l.length > 0)
  if (lines.length === 0) return null

  return (
    <section
      className={s.wrap}
      style={{ ['--edge' as string]: band?.color ?? 'rgba(242,234,217,.28)' }}
      aria-label="刚才那一手"
    >
      <header className={s.head}>
        <span className={s.title}>刚才那一手</span>
        {seal ? <Seal text={seal} tone="plain" /> : null}
      </header>
      <div className={s.body}>
        {lines.map((l, i) => (
          <p key={i} className={s.line}>
            {l}
          </p>
        ))}
      </div>
    </section>
  )
}
