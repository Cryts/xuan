/**
 * 斗法 —— 明牌比试 + 路数对抗。
 *
 * 设计（玩家定的）：
 *   明牌     斗法前把双方摊开，玩家选择**以什么路数、带什么架势**进场，
 *            这个选择给后面的对抗上 buff。
 *   路数对抗 实际攻防。用的是已有的**六本体相性环**（气→体→灵→则→意→气），
 *            不是另起一套。
 *
 * 为什么用相性环而不是新造一套：它本来就在（SPEC 第 5 章），
 * 而且顺带让「跨界习得」有了实战价值 —— 你在剧本里学来的别家法门，
 * 可以在斗法里换一条路数打。**学了的规则第一次真正能用来打人。**
 *
 * 调研结论也支持这个方向：这类游戏普遍把战斗降维成"属性门槛比较"，
 * 惩罚落在声望/次数上而不是角色存亡上（想不想修真、修真江湖、修仙式人生）。
 * 所以本模块不模拟血条拉锯，只做**三轮定胜负**，且败者通常不死。
 *
 * 但玩家要的"可以杀"也实现了：杀死是**单独一个选择**，有独立的奖惩，
 * 不是败者的默认下场。
 */

import { COUNTERS, ESSENCE_NAMES, PACK_ESSENCE, affinityOf } from './affinity'
import type { Rng } from './rng'
import type {
  AffinityResult,
  DuelOpponent,
  DuelSetup,
  DuelSpoils,
  Essence,
  GameState,
  LearnedRule,
  Stance,
  StanceId,
  StanceOption,
} from './types'

// ============================================================
// 明牌
// ============================================================


export const STANCES: Stance[] = [
  {
    id: 'assault',
    name: '强攻',
    desc: '一上来就压过去，不给对方喘息的余地。',
    attack: 1.32,
    defense: 0.76,
    swing: 1.9,
    note: '打得最凶，也最容易崩',
  },
  {
    id: 'guard',
    name: '稳守',
    desc: '先立于不败，等他露出破绽。',
    attack: 0.84,
    defense: 1.22,
    swing: 0.45,
    note: '赢不快，也输不惨',
  },
  {
    id: 'bait',
    name: '诱敌',
    desc: '头一轮故意示弱，引他all-in，再翻回来。',
    attack: 1.00,
    defense: 1.00,
    swing: 1.0,
    note: '首轮吃亏，后两轮翻回来',
  },
  {
    id: 'conceal',
    name: '藏拙',
    desc: '不露底。他看不透你走的是哪一路。',
    attack: 0.96,
    defense: 0.98,
    swing: 0.8,
    note: '他头一轮看不透你',
  },
]

const ODDS_HINTS: [number, string][] = [
  [0.85, '十拿九稳'],
  [0.68, '有把握'],
  [0.5, '未卜'],
  [0.32, '凶险'],
  [0, '九死一生'],
]

function oddsHint(p: number): string {
  for (const [t, w] of ODDS_HINTS) if (p >= t) return w
  return '九死一生'
}

/** 我方能用的全部路数 —— 本体系一条，加上所有跨界习得的 */
export function waysOf(state: GameState): StanceOption[] {
  const own = PACK_ESSENCE[state.pack_id]
  const out: StanceOption[] = []
  const seen = new Set<Essence>()

  out.push({
    essence: own,
    name: `${ESSENCE_NAMES[own]}字诀`,
    affinity: 'neutral',
    hint: '你本门的路数，最熟',
  })
  seen.add(own)

  for (const r of state.learned_rules ?? []) {
    const e = PACK_ESSENCE[(r as LearnedRule).pack]
    if (!e || seen.has(e)) continue
    seen.add(e)
    out.push({
      essence: e,
      name: r.name,
      from_pack: (r as LearnedRule).pack,
      affinity: 'neutral',
      hint: '从别的位面学来的，本门弟子不会',
    })
  }
  return out
}

/** 我方战力 —— 与引擎的 power_index 同源，另加心性与根骨的修正 */
export function myDuelPower(state: GameState): number {
  const armed = (state.items ?? []).filter((i) => (i.affordance ?? []).length > 0).length
  return Math.round(
    state.power_index * (1 + state.attrs.root / 400) + armed * 4 + state.attrs.temper / 5,
  )
}

/** 摆出明牌 */
export function setupDuel(
  state: GameState,
  opponent: DuelOpponent,
  rng: Rng,
  spoils?: DuelSpoils,
): DuelSetup {
  const my = myDuelPower(state)
  const theirs = opponent.power_index
  const baseAff = affinityOf(PACK_ESSENCE[state.pack_id], opponent.essence)

  // 明牌不是把公式给玩家，是给一个**能据以决断的方位**。
  // 战力比为主，相性做修正 —— 与引擎其它地方同一套口径。
  const ratio = my / Math.max(1, my + theirs)
  const affBonus = baseAff === 'counter' ? 0.12 : baseAff === 'countered' ? -0.12 : 0
  const odds = Math.max(0.05, Math.min(0.95, ratio + affBonus))

  const ways = waysOf(state).map((w) => ({
    ...w,
    affinity: affinityOf(w.essence, opponent.essence),
  }))

  return {
    opponent,
    stances: STANCES,
    ways,
    matchup: {
      my_power: my,
      their_power: theirs,
      odds,
      odds_hint: oddsHint(odds),
      base_affinity: baseAff,
    },
    spoils:
      spoils ??
      {
        win: {
          power: Math.round(theirs * 0.35),
          currency: 30 + Math.round(theirs * 0.2),
          rare_mat: 1,
          favor: 6,
        },
        kill: {
          power: Math.round(theirs * 0.6),
          currency: 60 + Math.round(theirs * 0.4),
          rare_mat: 2,
        },
        kill_cost: { debt: 10, exposure: 6, karma: -8 },
      },
  }
}

// ============================================================
// 路数对抗
// ============================================================

export interface DuelRound {
  index: number
  /** 我方本轮走的路数 */
  my_way: Essence
  /** 本轮相性 */
  affinity: AffinityResult
  /** 双方本轮的推进值 */
  my_push: number
  their_push: number
  /** 谁赢了这一轮 */
  winner: 'me' | 'them' | 'even'
  /** 一句话战报 */
  line: string
}

export interface DuelResult {
  rounds: DuelRound[]
  outcome: 'win' | 'lose' | 'draw'
  /** 我的累计推进 / 对方的 */
  momentum: { mine: number; theirs: number }
  /** 供叙事 */
  summary: string
}

const AFFINITY_PUSH: Record<AffinityResult, number> = {
  counter: 1.3,
  neutral: 1.0,
  countered: 0.72,
}

const ROUND_VERBS: Record<AffinityResult, string> = {
  counter: '你的路数克着他',
  neutral: '两下里平分秋色',
  countered: '你的路数被他压着',
}

/**
 * 打一场。三轮定胜负。
 *
 * 每轮的推进 = 双方战力比 × 路数相性 × 架势修正 × 一点随机。
 * 之所以只打三轮：文字游戏里拉锯十轮没人看，三轮刚好够讲一个"先吃亏
 * 后翻盘"或者"一上来就被压死"的故事。
 */
export function resolveDuel(
  state: GameState,
  setup: DuelSetup,
  stanceId: StanceId,
  wayEssence: Essence,
  rng: Rng,
): DuelResult {
  const stance = STANCES.find((s) => s.id === stanceId) ?? STANCES[0]!
  const aff = affinityOf(wayEssence, setup.opponent.essence)
  const affMul = AFFINITY_PUSH[aff]

  const my = setup.matchup.my_power
  const theirs = Math.max(1, setup.matchup.their_power)
  const powerRatio = my / (my + theirs)

  const rounds: DuelRound[] = []
  let mine = 0
  let theirs_total = 0

  for (let i = 0; i < 3; i++) {
    // 诱敌：首轮吃亏，撑住之后翻回来
    let atk = stance.attack
    if (stance.id === 'bait') atk = i === 0 ? 0.5 : 1.27
    // 藏拙：首轮对方读不准你
    const theirRead = stance.id === 'conceal' && i === 0 ? 0.7 : 1

    // 起伏由架势决定：强攻大起大落，稳守几乎没有浪
    const spreadMe = (stance.swing ?? 1) * 0.22
    const spreadThem = 0.18
    const rollMe = 1 + (rng.next() * 2 - 1) * spreadMe
    const rollThem = 1 + (rng.next() * 2 - 1) * spreadThem

    const myPush = Math.round(powerRatio * 100 * affMul * atk * rollMe)
    // defense 要**除**，不是乘。
    //
    // 写反过一次：`* stance.defense` 意味着"守势"让对方的推进更大 ——
    // 稳守变成了自杀，实测负率 97%，而强攻 100% 全胜。
    // 一个只能进攻的战斗系统是没有抉择的，所以这里是除。
    const theirPush = Math.round(((1 - powerRatio) * 100 * theirRead * rollThem) / stance.defense)

    mine += myPush
    theirs_total += theirPush

    const winner: DuelRound['winner'] =
      myPush > theirPush * 1.08 ? 'me' : theirPush > myPush * 1.08 ? 'them' : 'even'

    rounds.push({
      index: i + 1,
      my_way: wayEssence,
      affinity: aff,
      my_push: myPush,
      their_push: theirPush,
      winner,
      line:
        winner === 'me'
          ? `第${['一', '二', '三'][i]}合：${ROUND_VERBS[aff]}，你抢了先手。`
          : winner === 'them'
            ? `第${['一', '二', '三'][i]}合：他压住了你，你退半步。`
            : `第${['一', '二', '三'][i]}合：互换一招，谁也没占着便宜。`,
    })
  }

  const outcome: DuelResult['outcome'] =
    mine > theirs_total * 1.03 ? 'win' : theirs_total > mine * 1.03 ? 'lose' : 'draw'

  const summary =
    outcome === 'win'
      ? `${setup.opponent.name}退了半步，手垂下去——这一场是你的。`
      : outcome === 'lose'
        ? `你的气力先散。${setup.opponent.name}没有追。`
        : `两人同时收手。谁也没赢，谁也没输。`

  return { rounds, outcome, momentum: { mine, theirs: theirs_total }, summary }
}

/** 杀死对方的判定 —— 赢了之后才谈得上 */
export function canKill(setup: DuelSetup, result: DuelResult): boolean {
  // 只有赢下来才谈得上取人性命；平局与落败都没这个余地
  return result.outcome === 'win'
}

/** 相克链与类型：供引擎与 UI 复用，不必再从 types 里各导一遍 */
export { COUNTERS }
export type { DuelOpponent, DuelSetup, DuelSpoils, Stance, StanceId, StanceOption }
