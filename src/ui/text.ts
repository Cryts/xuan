/**
 * UI 文案层 —— 把引擎的离散 ID 翻成人话。
 *
 * 铁律：这里只做「展示映射」，绝不参与任何数值判定。
 * 条件是否达成永远由 core/conditions.ts 的 evaluate 决定；
 * 本文件只负责在**已知未达成**的前提下，告诉玩家还差什么。
 */

import type { EvalContext } from '@/core/conditions'
import { evaluate } from '@/core/conditions'
import type { ContentDB } from '@/core/content'
import { ARCHETYPE_NAMES } from '@/core/destiny'
import { ATTR_NAMES } from '@/core/genesis'
import type {
  AttrKey,
  CompareOp,
  Condition,
  GameState,
  Intent,
  PackId,
  RiskTier,
  Scenario,
  VarKey,
} from '@/core/types'

export const VAR_NAMES: Record<VarKey, string> = {
  currency: '灵石',
  power: '修为',
  rare_mat: '材料',
  favor: '声望',
  debt: '因果',
  exposure: '暴露',
  corruption: '心魔',
  karma: '功德',
  hp: '伤势',
  lifespan: '寿元',
}

/** 六维短名 —— 状态条上横排用 */
export const ATTR_SHORT: Record<AttrKey, string> = {
  root: '根骨',
  wits: '悟性',
  temper: '心性',
  luck: '气运',
  insight: '机敏',
  charm: '魅力',
}

export const PACK_FALLBACK: Record<PackId, { name: string; tag: string }> = {
  mortal: { name: '青冥仙途', tag: '慢热经营' },
  genius: { name: '炎武纪元', tag: '热血升级' },
  physique: { name: '太古遗蜕', tag: '高强度成长' },
  mystery: { name: '灰雾之秘', tag: '解谜扮演' },
  rebel: { name: '逆天问道', tag: '长线杀伐' },
  cautious: { name: '苟道长生', tag: '低风险求生' },
}

export function packName(content: ContentDB, id: PackId): string {
  return content.packs[id]?.display_name || PACK_FALLBACK[id]?.name || id
}

export function packTag(content: ContentDB, id: PackId): string {
  return content.packs[id]?.inspiration_tag || PACK_FALLBACK[id]?.tag || ''
}

/* ============================================================
   风险五档
   ============================================================ */

export interface RiskStyle {
  /** CSS 变量色值 */
  color: string
  /** 卡面边框透明度 */
  edge: string
  label: string
}

/* 色值一律走 CSS 变量：换体系包时风险档位也跟着换色相，读法不变 */
export const RISK_STYLE: Record<RiskTier, RiskStyle> = {
  稳: { color: 'var(--jade-txt)', edge: 'rgba(var(--jade-rgb), 0.4)', label: '稳' },
  常: { color: 'rgba(var(--paper-rgb), 0.74)', edge: 'rgba(var(--paper-rgb), 0.17)', label: '常' },
  险: { color: 'var(--gold-bright)', edge: 'rgba(var(--gold-rgb), 0.42)', label: '险' },
  狠: { color: 'var(--warn)', edge: 'rgba(var(--warn-rgb), 0.46)', label: '狠' },
  绝: { color: 'var(--cinnabar-txt)', edge: 'rgba(var(--cinnabar-rgb), 0.52)', label: '绝' },
}

/* ============================================================
   品阶与成色 —— 行囊格子用
   ============================================================ */

export const QUALITY_TONE: Record<string, string> = {
  凡品: 'var(--paper-mute)',
  灵品: 'var(--jade-txt)',
  宝品: 'var(--gold-bright)',
  仙品: 'var(--cinnabar-txt)',
  道品: 'var(--spirit)',
  混沌: 'var(--spirit)',
}

export function qualityTone(quality: string): string {
  return QUALITY_TONE[quality] ?? 'var(--paper-mute)'
}

/** 宝品以上给一点辉光 —— 让高阶物事在一格格行囊里跳出来 */
export function isRare(quality: string): boolean {
  return quality === '宝品' || quality === '仙品' || quality === '道品' || quality === '混沌'
}

/* ============================================================
   告急分档 —— 只决定颜色深浅，不参与任何判定
   ============================================================ */

export type Urgency = 'calm' | 'warn' | 'dire'

/** 伤势：0 = 完好，100 = 油尽灯枯（方向与血量相反） */
export function hpUrgency(hp: number): Urgency {
  if (hp >= 60) return 'dire'
  if (hp >= 30) return 'warn'
  return 'calm'
}

/** 寿元：剩余比例越低越急 */
export function lifeUrgency(lifespan: number, max: number): Urgency {
  if (max <= 0) return 'calm'
  const ratio = lifespan / max
  if (ratio <= 0.25) return 'dire'
  if (ratio <= 0.5) return 'warn'
  return 'calm'
}

/* ============================================================
   选项意图
   ============================================================ */

export const INTENT_NAMES: Record<Intent, string> = {
  greedy: '贪',
  steady: '稳',
  scheme: '谋',
  flee: '遁',
  evil: '魔',
  social: '交',
  study: '学',
  sacrifice: '舍',
}

export const INTENT_DESC: Record<Intent, string> = {
  greedy: '为利而往',
  steady: '不冒无谓之险',
  scheme: '算计周全',
  flee: '退为上策',
  evil: '不忌邪法',
  social: '与人周旋',
  study: '以求知为先',
  sacrifice: '舍己之所有',
}

/* ============================================================
   判定的四段位
   ============================================================ */

export interface BandStyle {
  text: string
  color: string
  desc: string
}

export const BAND_STYLE: Record<string, BandStyle> = {
  crit: { text: '大成功', color: 'var(--gold)', desc: '天时在握。' },
  success: { text: '成功', color: 'var(--jade)', desc: '如愿。' },
  fail: { text: '失败', color: 'rgba(242,234,217,.5)', desc: '事与愿违。' },
  crit_fail: { text: '大失败', color: 'var(--cinnabar)', desc: '祸不单行。' },
}

/* ============================================================
   「还差什么」—— 只描述未达成项
   ============================================================ */

function opText(op: CompareOp): string {
  switch (op) {
    case '>=':
      return '不低于'
    case '<=':
      return '不高于'
    case '>':
      return '高于'
    case '<':
      return '低于'
    case '==':
      return '恰为'
    case '!=':
      return '不为'
  }
}

/** 气运磨损比例 0–1：1 表示池子已空，天命再也编不出巧合 */
export function wornOf(d: { destiny_pool: number; destiny_max: number }): number {
  return d.destiny_max > 0 ? 1 - d.destiny_pool / d.destiny_max : 0
}

function itemLabel(content: ContentDB, ref: string): string {
  return content.items.find((i) => i.id === ref)?.name ?? ref
}

/** 单条未满足条件的人话描述（含当前值对照） */
function shortfall(cond: Condition, ctx: EvalContext, content: ContentDB): string {
  const st: GameState = ctx.state
  switch (cond.type) {
    case 'attr': {
      const now = st.attrs[cond.key as AttrKey] ?? 0
      return `${ATTR_NAMES[cond.key as AttrKey]}需${opText(cond.op)}${cond.value}（今 ${now}）`
    }
    case 'var': {
      const now = st.vars[cond.key as VarKey] ?? 0
      return `${VAR_NAMES[cond.key as VarKey]}需${opText(cond.op)}${cond.value}（今 ${now}）`
    }
    case 'item':
      return `尚缺「${itemLabel(content, cond.ref)}」${cond.count && cond.count > 1 ? ` ×${cond.count}` : ''}`
    case 'affordance':
      return `尚缺一件具「${cond.ref}」之能的物事`
    case 'affix_count':
      return `尚缺 ${cond.count} 件带「${cond.ref}」词条之物`
    case 'known_rule':
      return '尚需再勘破一条隐规则'
    case 'learned_rule':
      return `尚需习得「${packName(content, cond.pack as PackId)}」系法门`
    case 'flag':
      return '尚需一段前因'
    case 'relation':
      if (cond.exists === true) return `尚需身边有位「${cond.kind}」`
      if (cond.exists === false) return `须先断了「${cond.kind}」之缘`
      return `「${cond.kind}」需${opText(cond.op ?? '>=')}${cond.value ?? 0}`
    case 'faction_tier':
      return `「${cond.ref}」声望需${opText(cond.op)}${cond.value}`
    case 'solved_any_of':
      return '尚需先通另一条路'
    case 'node_count': {
      const used = ctx.scenarioNodesSpent ?? 0
      return `尚需再耗 ${Math.max(0, cond.value - used)} 刻`
    }
    case 'realm_idx':
      return `尚需修至第 ${cond.value} 境`
    case 'pack':
      return `此路须以「${packName(content, cond.ref as PackId)}」本体行之`
    case 'destiny_alive': {
      const n = st.destiny_children.filter((d) => d.alive).length
      return `在世天命者需${opText(cond.op)}${cond.value} 人（今 ${n} 人）`
    }
    case 'destiny_worn': {
      const alive = st.destiny_children.filter((d) => d.alive)
      const worst = alive.length > 0 ? Math.max(...alive.map(wornOf)) : 0
      return `须先磨去某位天命者的气运至 ${Math.round(cond.value * 100)}%（今最狠者 ${Math.round(worst * 100)}%）`
    }
    case 'destiny_archetype': {
      const has = st.destiny_children.some((d) => d.alive && d.archetype === cond.ref)
      return has
        ? `须与「${ARCHETYPE_NAMES[cond.ref]}」的天命者了断`
        : `此世已无「${ARCHETYPE_NAMES[cond.ref]}」的天命者`
    }
    case 'any': {
      const unmet = cond.of.filter((c) => !evaluate(c, ctx))
      if (unmet.length === 0) return ''
      return unmet.map((c) => shortfall(c, ctx, content)).join('，或')
    }
    case 'all':
      return cond.of
        .filter((c) => !evaluate(c, ctx))
        .map((c) => shortfall(c, ctx, content))
        .join('、')
    case 'not':
      return `须先消去：${shortfall(cond.of, ctx, content)}`
  }
}

/** 条件组「还差什么」—— 未达成项逐条列出；全达成返回空串 */
export function unmetText(conds: Condition[], ctx: EvalContext, content: ContentDB): string {
  const parts: string[] = []
  for (const c of conds) {
    if (evaluate(c, ctx)) continue
    const t = shortfall(c, ctx, content)
    if (t) parts.push(t)
  }
  return parts.join('；')
}

/** 从呈现反查剧本对象 —— 取 conditions 全文，才能算出「还差什么」 */
export function scenarioOf(content: ContentDB, id: string): Scenario | undefined {
  return content.scenarios.find((s) => s.id === id)
}

/** 物品的功能标签美化：下划线转空格，去掉过长前缀 */
export function affordanceLabel(tag: string): string {
  return tag.replace(/[_-]/g, ' ').trim()
}

/** 战力 / 修为的粗略分档描述 */
export function powerTier(power: number): string {
  if (power >= 600) return '深不可测'
  if (power >= 400) return '一方巨擘'
  if (power >= 220) return '名动一域'
  if (power >= 100) return '崭露头角'
  if (power >= 30) return '初窥门径'
  return '尚在微末'
}

/** 关系值 → 措辞 */
export function relationText(v: number): { text: string; tone: 'good' | 'bad' | 'flat' } {
  if (v >= 60) return { text: '引为知己', tone: 'good' }
  if (v >= 25) return { text: '颇有好感', tone: 'good' }
  if (v > 5) return { text: '略亲', tone: 'good' }
  if (v <= -60) return { text: '不死不休', tone: 'bad' }
  if (v <= -25) return { text: '怀恨在心', tone: 'bad' }
  if (v < -5) return { text: '略有芥蒂', tone: 'bad' }
  return { text: '素不相识', tone: 'flat' }
}

/** 境界名（由内容包取；缺内容时给中性兜底） */
export function realmName(content: ContentDB, pack: PackId, idx: number): string {
  const realms = content.packs[pack]?.realms ?? []
  return realms[idx]?.name ?? realms[realms.length - 1]?.name ?? '未名'
}

export function realmRange(content: ContentDB, pack: PackId, idx: number): [number, number] {
  const realms = content.packs[pack]?.realms ?? []
  const r = realms[idx] ?? realms[realms.length - 1]
  return r ? [r.power_index[0], r.power_index[1]] : [0, 100]
}

/** 本境寿元上限 —— 寿元条的分母（缺内容时给 100，宁可画满也不画错） */
export function realmLifespan(content: ContentDB, pack: PackId, idx: number): number {
  const realms = content.packs[pack]?.realms ?? []
  const r = realms[idx] ?? realms[realms.length - 1]
  return r?.lifespan ?? 100
}

/** 本境序数 / 总数 —— 状态条上「第几境」的注脚 */
export function realmCount(content: ContentDB, pack: PackId): number {
  return Math.max(1, content.packs[pack]?.realms?.length ?? 1)
}
