/**
 * 转世 —— 命格生成。见 SPEC 2.1 检查表（属性加成总和必须均衡）。
 *
 * 设计约束：出身/天赋/缺陷的属性加成总和必须落在阈值内，
 * 否则 content-lint 的 attr_balance 规则会打回。
 */

import type { Rng } from './rng'
import type { AttrKey, Flaw, Origin, Trait } from './types'

export const ATTR_KEYS: AttrKey[] = ['root', 'wits', 'temper', 'luck', 'insight', 'charm']

export const ATTR_NAMES: Record<AttrKey, string> = {
  root: '根骨',
  wits: '悟性',
  temper: '心性',
  luck: '气运',
  insight: '机敏',
  charm: '魅力',
}

/** 六维基础值 —— 总和固定，出身/天赋在此基础上偏移 */
const BASE = 40

/** 属性加成总和上限（content-lint 的 attr_balance 阈值） */
export const ATTR_BUDGET = 45

/**
 * 开局六维的**零和浮动幅度** —— 见 `divideInitAttrs`。
 *
 * 这个数是从"分布太窄"这条实测反推出来的，不是拍的：
 * 改动前每个属性独立 `int(-3,3)`，六维 sd 只有 **2.4~2.6**，
 * p10→p90 只差 7 点。后果不是"属性弱"，而是**每一局的"人"几乎一样** ——
 * 出生没有分化，起跑线就是同一个点，终局修为的相对阶梯位置因此
 * 只有 6.7%~8.6%（不到一个境界层），80% 的人挤在 2~3 个层里。
 *
 * 改成"六个独立骰子、减去均值"之后，**总和仍然固定**（谁也不能靠浮动
 * 白赚属性），但个体差异拉开到 sd ≈ 9.3。高点与低点之间差出三十来点，
 * 于是"这一世你是个什么样的胚子"第一次成为一件可看、可选、可赌的事 ——
 * 而 `cultivateRateMod` 正是从这里取方差。
 */
const ROLL_SPAN = 17

/**
 * 属性在一局之内的**实际可达区间** —— 由蒙特卡洛实测得出，不是拍的。
 *
 * 这一组数字是被一次真实事故逼出来的：剧本的破局条件写着
 * `wits >= 85`，而实测 200 局里悟性的中位数是 43、九十分位 47、
 * **全场最高 54**。也就是说那 48 个属性门槛**一个都够不着** ——
 * 玩家解锁了全部规则仍然破不了局，因为卡住的从来不是信息。
 *
 * 写剧本的人把属性当成了"满值 100、中期角色六七十"的量表，
 * 而本作是 40 起、事件里加一两点。两边对不上，而且**不报错**。
 * 所以这里把实测值固化成常量，content-lint 拿它当闸门：
 * 剧本里任何属性门槛超过 ATTR_REACHABLE 就是 error。
 *
 * 改动成长曲线（divideInitAttrs 的 BASE、事件的 add_attr 幅度）时，
 * 这三个数要重新跑 tools 里的属性分布测量，否则闸门会失真。
 *
 * **它们刚刚被重新量过一次** —— 因为 `ROLL_SPAN` 把开局六维的 sd
 * 从 2.5 拉到了 9.3（见上），"一局之内能到多高"整个抬了一档。
 * 500 局实测（每局取全过程中该属性的最大值）：
 *
 * | | 中位 | 九十分位 | 全场最高 |
 * |---|---|---|---|
 * | 悟性 | 43 | 56 | 66 |
 * | 机敏 | 42 | 55 | 72 |
 * | 根骨 | 42 | 55 | 71 |
 * | 心性 | 44 | 58 | 67 |
 *
 * `ATTR_TYPICAL` 取中位（没动，43）；`ATTR_REACHABLE` 取全场最高 72
 * （原来是 58，那是在 sd 2.5 的世界里量的）。
 * **注意闸门因此变松了**：58~72 这一段现在算"够得着"，
 * 但那是少数高骰局才够得着 —— 写剧本时若想让多数人过，
 * 门槛仍该贴着 `ATTR_TYPICAL` 走，而不是贴着这个上界。
 */
export const ATTR_TYPICAL = 43
export const ATTR_REACHABLE = 72

export function divideInitAttrs(
  rng: Rng,
  origin: Origin | undefined,
  traits: Trait[],
  flaw: Flaw | undefined,
): Record<AttrKey, number> {
  const attrs = Object.fromEntries(ATTR_KEYS.map((k) => [k, BASE])) as Record<AttrKey, number>

  // 出身基线偏移
  for (const [k, v] of Object.entries(origin?.attr_mods ?? {})) {
    attrs[k as AttrKey] += v as number
  }

  // 天赋与缺陷的效果里，属性类的直接落库；其余由 engine 处理
  const all = [...traits.flatMap((t) => t.effects), ...(flaw?.effects ?? [])]
  for (const e of all) {
    if (e.type === 'add_attr') attrs[e.key] += e.delta
  }

  // 零和的宽幅浮动 —— 总和不变，个体拉开。见 ROLL_SPAN 处的说明。
  //
  // 减去均值这一步是关键：不减去的话，六维**总和**本身也变成随机变量，
  // 于是"抽到高点的一组骰子"就成了纯运气加成，而出身/天赋的取舍会被它淹掉。
  // 减去之后，浮动只决定**这六个格子怎么分**，不决定分到多少。
  const raw = ATTR_KEYS.map(() => rng.int(-ROLL_SPAN, ROLL_SPAN))
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length
  ATTR_KEYS.forEach((k, i) => {
    attrs[k] += Math.round(raw[i]! - mean)
  })

  for (const k of ATTR_KEYS) {
    attrs[k] = Math.max(5, Math.min(100, attrs[k]))
  }
  return attrs
}

/**
 * 修行资质 —— 一局之内基本不变的**修为增速乘子**。
 *
 * 这是「修为终局分布」改造里最要紧的一件：拆掉 `realmFactor` 那条
 * 正反馈之后，分布的中心会下来，但**宽度不会自己变宽** ——
 * 实测"去掉正反馈"只把相对位置 sd 从 6.7~8.6% 动到 5.8~8.3%，
 * 几乎没变。方差不在反馈上，在**起跑线**上。
 *
 * 于是这里补上一个 run 级的乘子。它不是暗骰：出处就是开局界面上
 * 明明白白摆着的**根骨与悟性**（`GenesisScreen` 与 `StatusBar` 都在显示），
 * 玩家挑出身、挑天赋时就是在挑它 —— 天灵根/剑骨天成这类修炼向天赋
 * 都会把这两项顶上去。`game_balance.txt` 的 Randomization 一节要求
 * "把随机结果的选择权交给玩家"，这就是那一手：
 * **看得见的两项属性 → 看得见的成长快慢。**
 *
 * 系数怎么定的：目标是终局"相对阶梯位置"的 sd 从不到一个境界层
 * 抬到 1.5 层以上。六维零和浮动下 sd(根骨+悟性) ≈ 11.8，
 * `0.040 × 11.8 ≈ 0.47` 的乘子 sd 实测把各包的 sd 顶到 **10.0%~13.9%**
 * （改动前 7.7%~12.9%）—— 这个系数是被这条实测反推出来的，
 * 不是"看着差不多"。改 `ROLL_SPAN` 或 `CULTIVATE_BASE` 都要重扫它。
 *
 * 上下夹住是为了不出现"这一世没得玩"或"白送飞升"的极端局：
 * 夹取后乘子落在 0.55~1.6。夹子会削掉两端各约一两成的极端骰，
 * 这是有意的 —— **要的是分化，不是让谁一开局就出局。**
 */
export const RATE_PER_APTITUDE = 0.040
export const RATE_MIN = 0.55
export const RATE_MAX = 1.6

export function cultivateRateMod(attrs: Partial<Record<AttrKey, number>>): number {
  const apt = (attrs.root ?? BASE) + (attrs.wits ?? BASE) - 2 * BASE
  return Math.max(RATE_MIN, Math.min(RATE_MAX, 1 + apt * RATE_PER_APTITUDE))
}

/** 供给 content-lint：检查一套配置是否超预算 */
export function attrBudgetOf(origin: Origin | undefined, traits: Trait[], flaw: Flaw | undefined): number {
  let sum = 0
  const add = (n: number) => {
    sum += n
  }
  for (const v of Object.values(origin?.attr_mods ?? {})) add(Math.abs(v as number))
  for (const e of traits.flatMap((t) => t.effects)) {
    if (e.type === 'add_attr') add(Math.abs(e.delta))
  }
  for (const e of flaw?.effects ?? []) {
    if (e.type === 'add_attr') add(Math.abs(e.delta))
  }
  return sum
}

/** 随机抽一套推荐配置（"一键随机"用，保证 30 秒内开局） */
export interface RolledGenesis {
  originId: string
  traitIds: string[]
  flawId?: string
}

export function rollGenesis(
  rng: Rng,
  origins: Origin[],
  traits: Trait[],
  flaws: Flaw[],
  packId: string,
): RolledGenesis {
  void packId
  const origin = rng.pick(origins)

  // 先抽一个缺陷（有补偿），再抽 3 个天赋，避开互斥
  const flaw = flaws.length > 0 ? rng.pick(flaws) : undefined

  const pool = traits.slice()
  const picked: Trait[] = []
  while (picked.length < 3 && pool.length > 0) {
    const t = rng.pick(pool)
    pool.splice(pool.indexOf(t), 1)
    if (t.excludes?.some((x) => picked.some((p) => p.id === x || p.category === x))) continue
    picked.push(t)
  }

  return {
    originId: origin?.id ?? origins[0]!.id,
    traitIds: picked.map((t) => t.id),
    flawId: flaw?.id,
  }
}
