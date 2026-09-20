/**
 * 选项后果预告 —— 从选项**自己的效果**派生，而不是手写。
 *
 * 为什么是派生：
 *
 * 玩家反馈原话是「玩家无法了解这些选项背后的价值」「没有告诉玩家选了之后
 * 有可能发生的变化」。字段和界面早就做好了（`gain_hint` / `path_hint`，
 * `EventScreen` 一直在渲染），但**内容一条都没有** —— 实测 1629 个选项里
 * `gain_hint` 0 条、`path_hint` 0 条。界面上于是永远不显示。
 *
 * 这正是本项目反复吃亏的那一类：**结构齐备、内容是空的，且不报错**。
 * 手写一千六百条文案还会再腐化一次 —— 内容改了文案不改，预告就开始撒谎，
 * 而撒谎的代价比没有预告更大（《杀戮尖塔》的教训：Mega Crit 做过模糊预告，
 * 又明确否掉，因为玩家反而要算更多；真正不能忍的是**说得不准**）。
 *
 * 所以这里从 `resolve.bands` / `outcome.effects` 直接读出结果，翻译成人话。
 * 好处有三：改内容预告自动跟着变，不会漂；新加的事件天生就有预告；
 * 作者想写风味文案时，`option.gain_hint` 一填就覆盖派生值。
 *
 * 输出受与叙事同一套约束：**第二人称、不超过两小句、无阿拉伯数字、
 * 无资源名与系统词**（见 CLAUDE.md 的文本禁区）。
 */

import type { Effect, Option, VarKey } from './types'

/** 把一条效果翻成短语；翻不出来就返回 null（宁可不说，也不瞎说） */
function phraseOf(eff: Effect): string | null {
  switch (eff.type) {
    case 'add_var':
      return varPhrase(eff.key, eff.delta)
    case 'add_item':
      return '或有一物入手'
    case 'learn_rule':
      return '窥见别家的法门'
    case 'unlock_codex':
      return '长一番见闻'
    case 'unlock_title':
      return '得一个名号'
    case 'add_affix':
      return '手中物事添了灵性'
    case 'destiny_drain':
      return '磨去他一分气运'
    case 'modify_power_index':
      return eff.delta >= 0 ? '道行见长' : '道行受损'
    default:
      return null
  }
}

/** 变量 → 人话。门槛的取法宁粗勿细：说清方向与量级，不报数字 */
function varPhrase(key: VarKey, d: number): string | null {
  switch (key) {
    case 'power':
      if (d >= 12) return '修为大进'
      if (d >= 5) return '修为见长'
      if (d > 0) return '修为略进'
      if (d === 0) return null
      return '修为倒退'
    case 'hp':
      // hp 是**伤势**：正 delta = 伤得更重
      if (d <= -12) return '伤势大减'
      if (d < 0) return '伤势见轻'
      if (d >= 12) return '伤及筋骨'
      return '略有磕碰'
    case 'currency':
      if (d >= 15) return '进项颇丰'
      if (d > 0) return '有些进项'
      return '破费'
    case 'rare_mat':
      return d > 0 ? '得些材料' : null
    case 'corruption':
      return d > 0 ? '心魔暗生' : '心境清明了些'
    case 'debt':
      return d > 0 ? '欠下因果' : '了却一桩因果'
    case 'exposure':
      return d > 0 ? '露了形迹' : null
    case 'favor':
      return d > 0 ? '结下人情' : '折了颜面'
    case 'karma':
      return d > 0 ? '积了些功德' : '损了功德'
    case 'lifespan':
      return d < 0 ? '折损寿元' : null
    default:
      return null
  }
}

/**
 * 一组效果的合成短语。
 *
 * 同一个变量只留**最先出现的那条** —— 调用方按「重→轻」拼（crit 在前、
 * success 在后），所以先到的就是更重的那档。不去重会拼出
 * 「成则修为见长，修为略进」这种自相矛盾的话（crit 给十二点、success 给一点，
 * 两条都翻成短语并列，读起来像在说两件事）。
 *
 * 至多两句：预告是给人做判断用的，不是清单。
 */
function summarize(effects: Effect[] | undefined): string {
  if (!effects || effects.length === 0) return ''
  const out: string[] = []
  const seenVars = new Set<string>()
  for (const e of effects) {
    if (e.type === 'add_var') {
      if (seenVars.has(e.key)) continue
      seenVars.add(e.key)
    }
    const p = phraseOf(e)
    if (p && !out.includes(p)) out.push(p)
  }
  return out.slice(0, 2).join('，')
}

/** 这一手会不会有下文（结构性效果，不是即时收益） */
function followupOf(effects: Effect[] | undefined): string {
  if (!effects) return ''
  const has = (t: Effect['type']) => effects.some((e) => e.type === t)
  if (has('trigger_end')) return '这一手会定你这一世的收场'
  if (has('queue_followup')) return '此事不会就此了结'
  if (has('set_relation')) return '从此多一层牵扯'
  if (has('set_flag') || has('learn_rule')) return '会留下一处伏笔'
  return ''
}

export interface OptionPreview {
  /** 「或可得 · …」 */
  gain?: string
  /** 「…」—— 结构性的后果，通常是伏笔 */
  path?: string
}

/**
 * 派生一个选项的预告。
 *
 * 有判定的选项分「成 / 败」两半说 —— 玩家要知道的正是**赌注是什么**。
 * 没有判定的选项只说得益，因为它没有失败的那一面。
 */
export function optionPreview(opt: Option): OptionPreview {
  const withRoll = opt.resolve?.bands
  let gain = ''
  let path = ''

  if (withRoll) {
    const bands = withRoll
    const good = [
      ...(bands.crit?.effects ?? []),
      ...(bands.success?.effects ?? []),
    ]
    const bad = [...(bands.fail?.effects ?? []), ...(bands.crit_fail?.effects ?? [])]
    const g = summarize(good)
    const b = summarize(bad)
    if (g && b) gain = `成则${g}；败则${b}`
    else if (g) gain = g
    else if (b) gain = `不成则${b}`
    path = followupOf([...good, ...bad])
  } else {
    const effects = opt.outcome?.effects
    gain = summarize(effects)
    path = followupOf(effects)
  }

  return { gain: gain || undefined, path: path || undefined }
}

/**
 * 取一个选项最终要显示的预告 —— 作者写了就用作者的，没写才派生。
 *
 * 顺序不能反：作者文案是有意为之的风味，派生只是兜底。
 */
export function previewFor(opt: Option): OptionPreview {
  const derived = optionPreview(opt)
  return {
    gain: opt.gain_hint ?? derived.gain,
    path: opt.path_hint ?? derived.path,
  }
}
