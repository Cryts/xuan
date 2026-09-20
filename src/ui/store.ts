/**
 * UI 状态机 + 内容加载。
 *
 * 三条纪律：
 *   1. 所有数值判定都在 core/ 里完成，本文件只做「调用 → 存结果 → 记浮字」。
 *   2. reducer 必须是纯函数（StrictMode 会双调用）：时间戳、随机种子一律由
 *      调用方在 dispatch 时传进来，reducer 内不产生随机性。
 *   3. 内容 JSON 由别的 agent 并行生成，可能缺失/形状不一 —— 加载必须容错：
 *      缺文件不崩、缺项用合理默认填、控制台给明确警告。
 */

import { createContext, useContext } from 'react'
import {
  buildHeavenBoard,
  presentCurrent,
  resolveEnding,
  startRun,
  submitOption,
  submitTrial,
  type EndingResult,
  type HeavenBoardRow,
} from '@/core/engine'
import { rollGenesis } from '@/core/genesis'
import { Rng, deriveSeed } from '@/core/rng'
import { PACK_IDS, type ContentDB, type Motif, type NameBank } from '@/core/content'
import type {
  Affix,
  AttrKey,
  Condition,
  Destiny,
  Effect,
  Ending,
  Essence,
  FateMilestone,
  Flaw,
  GameState,
  Item,
  LooseEvent,
  NodePresentation,
  Origin,
  PackId,
  Scenario,
  Trait,
  TrialOption,
  VarKey,
  WorldPack,
} from '@/core/types'

/* ============================================================
   一、设置与存档（localStorage）
   ============================================================ */

export type FontScale = 'sm' | 'md' | 'lg'

export interface Settings {
  sound: boolean
  motion: boolean
  fontScale: FontScale
  /** L3 结局卷轴实时生成用的 API Key —— 只存在本机 */
  apiKey: string
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  motion: true,
  fontScale: 'md',
  apiKey: '',
}

const LS_SETTINGS = 'xuan.settings.v1'
const LS_SAVE = 'xuan.save.v1'

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* 隐私模式 / 配额满：静默降级，不影响游玩 */
  }
}

export function loadSettings(): Settings {
  const raw = safeGet(LS_SETTINGS)
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  safeSet(LS_SETTINGS, JSON.stringify(s))
}

export function hasSave(): boolean {
  const raw = safeGet(LS_SAVE)
  if (!raw) return false
  try {
    const o = JSON.parse(raw) as { state?: GameState }
    return Boolean(o.state && o.state.status === 'alive')
  } catch {
    return false
  }
}

export function readSave(): GameState | null {
  const raw = safeGet(LS_SAVE)
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { state?: GameState }
    return o.state ?? null
  } catch {
    return null
  }
}

export function writeSave(state: GameState): void {
  safeSet(LS_SAVE, JSON.stringify({ v: 1, state }))
}

export function clearSave(): void {
  try {
    window.localStorage.removeItem(LS_SAVE)
  } catch {
    /* 同上 */
  }
}

/* ============================================================
   二、内容加载（容错）
   ============================================================ */

type Dict = Record<string, unknown>

const isObj = (v: unknown): v is Dict => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isStrArr = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')

function modValue(m: unknown): unknown {
  if (isObj(m) && 'default' in m) return (m as Dict).default
  return m
}

const PACK_SET = new Set<string>(PACK_IDS)

interface Buckets {
  packs: Partial<Record<PackId, WorldPack>>
  origins: Origin[]
  traits: Trait[]
  flaws: Flaw[]
  destinies: Destiny[]
  motifs: Motif[]
  events: LooseEvent[]
  scenarios: Scenario[]
  endings: Ending[]
  items: Item[]
  affixes: Affix[]
  l2: Record<string, string[]>
  oracle: string[]
  coincidence: Record<string, string[]>
  fateTemplates: Partial<Record<PackId, FateMilestone[]>>
  names: NameBank | null
  terms: ContentDB['terms']
  warnings: string[]
}

function emptyBuckets(): Buckets {
  return {
    packs: {},
    origins: [],
    traits: [],
    flaws: [],
    destinies: [],
    motifs: [],
    events: [],
    scenarios: [],
    endings: [],
    items: [],
    affixes: [],
    l2: {},
    oracle: [],
    coincidence: {},
    fateTemplates: {},
    names: null,
    terms: {},
    warnings: [],
  }
}

function recordStrings(key: string, path: string, list: string[], out: Buckets): void {
  if (key.startsWith('destiny.protect')) {
    out.coincidence[key] = [...(out.coincidence[key] ?? []), ...list]
    return
  }
  if (key === 'oracle' || key === 'notes' || key === 'omens' || path.includes('oracle')) {
    out.oracle.push(...list)
    return
  }
  out.l2[key] = [...(out.l2[key] ?? []), ...list]
}

function isPack(o: Dict): boolean {
  return typeof o.pack_id === 'string' && PACK_SET.has(o.pack_id) && Array.isArray(o.realms)
}
function isNameBank(o: Dict): boolean {
  return isStrArr(o.surname) && (isStrArr(o.given_male) || isObj(o.dao_title))
}
function isScenario(o: Dict): boolean {
  return o.kind === 'scenario' || (Array.isArray(o.breakthroughs) && Array.isArray(o.rules_stated))
}
function isEvent(o: Dict): boolean {
  return o.kind === 'loose' || (isObj(o.narrative) && Array.isArray(o.options) && typeof o.motif === 'string')
}
function isOrigin(o: Dict): boolean {
  return isObj(o.attr_mods) && typeof o.name === 'string' && !o.kind && !o.effects
}
function isTrait(o: Dict): boolean {
  return typeof o.tier === 'string' && typeof o.category === 'string' && Array.isArray(o.effects)
}
function isFlaw(o: Dict): boolean {
  return typeof o.compensate === 'number' && Array.isArray(o.effects)
}
function isDestiny(o: Dict): boolean {
  return typeof o.rule_rewrite === 'string'
}
function isItem(o: Dict): boolean {
  return typeof o.quality === 'string' && Array.isArray(o.affixes)
}
function isAffix(o: Dict): boolean {
  return typeof o.tier === 'string' && Array.isArray(o.affordance) && !Array.isArray(o.effects)
}
function isEnding(o: Dict): boolean {
  return Array.isArray(o.title_pool) && isObj(o.rating)
}
function isMotif(o: Dict): boolean {
  return typeof o.source_archetype === 'string' || Array.isArray(o.param_slots)
}
function isMilestone(o: Dict): boolean {
  return typeof o.power_gain === 'number' && typeof o.name === 'string' && typeof o.narrative === 'string'
}
function isTermDict(o: Dict): boolean {
  return isObj(o.dict) && typeof o.pack_id === 'string'
}

/** 递归辨认内容 JSON：先按形状认，认不出就当容器往下走 */
function walk(v: unknown, path: string, out: Buckets, depth = 0): void {
  if (depth > 8) return

  if (Array.isArray(v)) {
    if (isStrArr(v)) {
      const seg = path.split('/').filter(Boolean)
      recordStrings(seg[seg.length - 1] ?? '', path, v, out)
      return
    }
    for (const it of v) walk(it, path, out, depth + 1)
    return
  }
  if (!isObj(v)) return

  const o = v

  if (isPack(o)) {
    const pack = o as unknown as WorldPack
    out.packs[pack.pack_id] = pack
    const ft = o.fate_templates ?? o.fateTemplates
    if (Array.isArray(ft)) {
      const ms = ft.filter((m) => isObj(m) && isMilestone(m)) as FateMilestone[]
      out.fateTemplates[pack.pack_id] = [...(out.fateTemplates[pack.pack_id] ?? []), ...ms]
    }
    return
  }
  if (isNameBank(o)) {
    out.names = o as unknown as NameBank
    return
  }
  if (isTermDict(o)) {
    out.terms[(o as unknown as { pack_id: PackId }).pack_id] = o as unknown as ContentDB['terms'][PackId]
    return
  }
  if (isScenario(o)) {
    out.scenarios.push(o as unknown as Scenario)
    return
  }
  if (isEvent(o)) {
    out.events.push(o as unknown as LooseEvent)
    return
  }
  if (isEnding(o)) {
    out.endings.push(o as unknown as Ending)
    return
  }
  if (isTrait(o)) {
    out.traits.push(o as unknown as Trait)
    return
  }
  if (isFlaw(o)) {
    out.flaws.push(o as unknown as Flaw)
    return
  }
  if (isDestiny(o)) {
    out.destinies.push(o as unknown as Destiny)
    return
  }
  if (isItem(o)) {
    out.items.push(o as unknown as Item)
    return
  }
  if (isAffix(o)) {
    out.affixes.push(o as unknown as Affix)
    return
  }
  if (isOrigin(o)) {
    out.origins.push(o as unknown as Origin)
    return
  }
  if (isMotif(o)) {
    out.motifs.push(o as unknown as Motif)
    return
  }
  if (isMilestone(o) && !('fateTemplates' in o)) {
    const seg = path.split('/').filter(Boolean)
    const packKey = seg.find((s) => PACK_SET.has(s)) as PackId | undefined
    if (packKey) {
      out.fateTemplates[packKey] = [...(out.fateTemplates[packKey] ?? []), o as unknown as FateMilestone]
      return
    }
  }
  // 命运线模板容器：{ mortal: [...], genius: [...] }
  for (const [k, val] of Object.entries(o)) {
    if (PACK_SET.has(k) && Array.isArray(val) && val.every((m) => isObj(m) && isMilestone(m))) {
      out.fateTemplates[k as PackId] = [
        ...(out.fateTemplates[k as PackId] ?? []),
        ...(val as unknown as FateMilestone[]),
      ]
      continue
    }
    walk(val, `${path}/${k}`, out, depth + 1)
  }
}

/* ---------- 缺内容时的兜底：保证 game-core 一定能跑起来 ---------- */

const FALLBACK_REALM_LADDER = [
  { idx: 0, name: '炼气', power_index: [0, 20] as [number, number], lifespan: 80, breakthrough: 0 },
  { idx: 1, name: '筑基', power_index: [20, 60] as [number, number], lifespan: 160, breakthrough: 0 },
  { idx: 2, name: '金丹', power_index: [60, 140] as [number, number], lifespan: 300, breakthrough: 0 },
  { idx: 3, name: '元婴', power_index: [140, 300] as [number, number], lifespan: 600, breakthrough: 0 },
  { idx: 4, name: '化神', power_index: [300, 600] as [number, number], lifespan: 1200, breakthrough: 0 },
  { idx: 5, name: '炼虚', power_index: [600, 1000] as [number, number], lifespan: 2400, breakthrough: 0 },
]

const FALLBACK_ESSENCE: Record<PackId, Essence> = {
  mortal: 'qi',
  genius: 'qi',
  physique: 'body',
  mystery: 'spirit',
  rebel: 'will',
  cautious: 'shi',
}

const FALLBACK_PACK_NAME: Record<PackId, string> = {
  mortal: '青冥仙途',
  genius: '炎武纪元',
  physique: '太古遗蜕',
  mystery: '灰雾之秘',
  rebel: '逆天问道',
  cautious: '苟道长生',
}

function fallbackPack(id: PackId): WorldPack {
  return {
    pack_id: id,
    display_name: FALLBACK_PACK_NAME[id],
    inspiration_tag: '内容包缺失 · 兜底',
    essence: FALLBACK_ESSENCE[id],
    version: 'fallback',
    rule_ref: '',
    realms: FALLBACK_REALM_LADDER.map((r) => ({ ...r })),
    resource_map: { currency: { name: '灵石' }, power: { name: '修为' } },
    goldfinger_slots: [],
    fail_modes: [],
    motif_weights: {},
    tone: { narration: 'neutral', humor: 0, violence: 0 },
  }
}

const FALLBACK_ORIGINS: Origin[] = [
  { id: 'origin_wanderer', name: '无名散修', variant: 1, attr_mods: { root: 4, wits: 2 } },
  { id: 'origin_clansman', name: '小族旁支', variant: 2, attr_mods: { charm: 4, luck: 2 } },
  { id: 'origin_orphan', name: '荒村孤子', variant: 3, attr_mods: { temper: 5, insight: 1 } },
]

const FALLBACK_TRAITS: Trait[] = [
  {
    id: 'trait_steady',
    name: '心若止水',
    tier: 'B',
    category: '修炼向',
    effects: [{ type: 'add_attr', key: 'temper', delta: 6 }],
    desc: '不急不躁，逆境中反而走得更稳。',
  },
  {
    id: 'trait_keen',
    name: '过目不忘',
    tier: 'B',
    category: '诡道向',
    effects: [{ type: 'add_attr', key: 'insight', delta: 6 }],
    desc: '看过一遍的东西，总能在要紧处想起来。',
  },
  {
    id: 'trait_blessed',
    name: '福缘深厚',
    tier: 'A',
    category: '社交向',
    effects: [{ type: 'add_attr', key: 'luck', delta: 7 }],
    desc: '总在恰好的时刻遇上恰好的人。',
  },
]

const FALLBACK_FLAWS: Flaw[] = [
  {
    id: 'flaw_old_wound',
    name: '旧伤未愈',
    effects: [{ type: 'add_var', key: 'hp', delta: -15 }],
    compensate: 6,
    desc: '一到阴雨天，旧伤便隐隐作痛。',
  },
]

function defaultContent(warnings: string[]): ContentDB {
  return {
    packs: Object.fromEntries(PACK_IDS.map((p) => [p, fallbackPack(p)])) as Record<PackId, WorldPack>,
    terms: {},
    motifs: [],
    events: [],
    scenarios: [],
    endings: [],
    origins: FALLBACK_ORIGINS.map((o) => ({ ...o })),
    traits: FALLBACK_TRAITS.map((t) => ({ ...t })),
    flaws: FALLBACK_FLAWS.map((f) => ({ ...f })),
    destinies: [],
    l2: {},
    oracle: [],
    coincidence: {},
    fateTemplates: {},
    names: {
      surname: ['沈', '陆', '姜', '云', '裴', '燕'],
      given_male: ['砚', '舟', '珩', '寻', '照', '临渊'],
      given_female: ['辞', '青崖', '明烛', '折雪'],
      dao_title: { element: ['玄', '太'], noun: ['冥', '一'], suffix: ['子', '真人'] },
      sect: { place: ['云隐', '青冥'], suffix: ['宗', '观'] },
    },
    affixes: [],
    items: [],
    version: warnings.length > 0 ? 'fallback' : 'empty',
  }
}

const CONTENT_MODULES = import.meta.glob('../content/**/*.json', { eager: true }) as Record<string, unknown>

let cached: ContentDB | null = null

/** 构建期确定的静态内容库；缺项一律兜底，绝不抛错。 */
export function loadContent(): ContentDB {
  if (cached) return cached
  const out = emptyBuckets()

  const paths = Object.keys(CONTENT_MODULES)
  if (paths.length === 0) {
    console.warn(
      '[玄] 未发现任何内容 JSON（src/content/**/*.json）。' +
        '当前以兜底内容运行：可正常开局与推进，但事件/剧本/结局为空。',
    )
  }

  for (const path of paths) {
    const value = modValue(CONTENT_MODULES[path])
    try {
      walk(value, path, out)
    } catch (err) {
      out.warnings.push(path)
      console.warn(`[玄] 内容文件解析失败，已跳过：${path}`, err)
    }
  }

  const base = defaultContent(out.warnings)

  const content: ContentDB = {
    packs: base.packs,
    terms: out.terms,
    motifs: out.motifs,
    events: out.events,
    scenarios: out.scenarios,
    endings: out.endings,
    origins: out.origins.length > 0 ? out.origins : base.origins,
    traits: out.traits.length > 0 ? out.traits : base.traits,
    flaws: out.flaws.length > 0 ? out.flaws : base.flaws,
    destinies: out.destinies,
    l2: out.l2,
    oracle: out.oracle,
    coincidence: out.coincidence,
    fateTemplates: out.fateTemplates,
    names: out.names ?? base.names,
    affixes: out.affixes,
    items: out.items,
    version: '2026-09',
  }

  for (const id of PACK_IDS) {
    if (!content.packs[id]) {
      content.packs[id] = fallbackPack(id)
      console.warn(`[玄] 缺少体系包内容：${id}，已用兜底包顶上。`)
    }
  }
  if (out.events.length === 0) {
    console.warn('[玄] 事件库为空 —— 引擎将走内置的「静」兜底节点。')
  }
  if (out.scenarios.length === 0) {
    console.warn('[玄] 剧本库为空 —— 本作核心玩法（推理剧本）将不会被触发。')
  }

  cached = content
  return content
}

export function contentStats(c: ContentDB): string {
  return `体系包 ${PACK_IDS.filter((p) => c.packs[p]?.version !== 'fallback').length}/6 · 事件 ${c.events.length} · 剧本 ${c.scenarios.length} · 结局 ${c.endings.length} · 物品 ${c.items.length}`
}

/* ============================================================
   三、呈现与事件对象
   ============================================================ */

/**
 * 调 presentCurrent 时传一份浅拷贝：引擎在「进入剧本」时会就地写
 * active_scenario（Object.assign），拷贝能保证 reducer 状态仍不可变。
 */
function presentSafely(
  state: GameState,
  content: ContentDB,
): { state: GameState; pres: NodePresentation } {
  const copy: GameState = { ...state }
  const pres = presentCurrent(copy, content)
  return { state: copy, pres }
}

/** 把呈现还原成引擎需要的 LooseEvent —— 内容缺该事件时用呈现内容兜底 */
function eventFromPresentation(p: NodePresentation, content: ContentDB): LooseEvent {
  const real = content.events.find((e) => e.id === p.event_id)
  if (real) return real
  return {
    id: p.event_id,
    kind: 'loose',
    pack: ['*'],
    motif: p.mood || 'unknown',
    stage: ['childhood', 'entry', 'growth', 'turn', 'endgame'],
    weight: 0,
    tension: 5,
    narrative: { title_pool: [p.title], body_key: '' },
    options: p.options,
    tags: [],
    version: 'stub',
  }
}

/* ============================================================
   四、浮字与提示
   ============================================================ */

export interface FloatItem {
  id: number
  label: string
  from: number
  to: number
  delta: number
}

export interface Banner {
  kind: 'band' | 'break' | 'unsolved' | 'reveal'
  text: string
  detail?: string
  tone: 'good' | 'bad' | 'flat' | 'gold'
}

export interface GenesisDraft {
  seed: string
  packId: PackId
  originId: string
  traitIds: string[]
  flawId?: string
}

export type Screen = 'title' | 'genesis' | 'play' | 'ending' | 'settings'

export interface AppState {
  content: ContentDB
  screen: Screen
  /** 进入设置前所在的界面，用于返回 */
  returnTo: Screen
  settings: Settings
  resumable: boolean

  gen: GenesisDraft
  state: GameState | null
  pres: NodePresentation | null
  floats: FloatItem[]
  banner: Banner | null
  toast: string | null
  /** 本次呈现里刚刚揭示的隐规则 id —— 用于「揭示那一刻」的仪式感 */
  justRevealed: string[]
  ending: EndingResult | null
  seq: number
}

export type Action =
  | { type: 'goto'; screen: Screen }
  | { type: 'openSettings' }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'genesis/roll'; seed: string }
  | { type: 'genesis/setPack'; pack: PackId }
  | { type: 'genesis/setOrigin'; id: string }
  | { type: 'genesis/setTrait'; index: number; id: string }
  | { type: 'genesis/setFlaw'; id?: string }
  | { type: 'genesis/begin'; runId: string }
  | { type: 'play/option'; optionId: string }
  | { type: 'play/trial'; kind: TrialOption['kind']; ref: string }
  | { type: 'play/wait' }
  | { type: 'floats/clear' }
  | { type: 'banner/clear' }
  | { type: 'toast'; text: string | null }
  | { type: 'resume' }
  | { type: 'abandon' }

export function makeSeedString(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function makeRunId(): string {
  return `run_${makeSeedString()}`
}

function initialGenesic(content: ContentDB): GenesisDraft {
  return rollDraft(content, makeSeedString(), 'mortal')
}

function rollDraft(content: ContentDB, seed: string, packId: PackId): GenesisDraft {
  const rng = new Rng(deriveSeed(seed, 'genesis'))
  try {
    const r = rollGenesis(rng, content.origins, content.traits, content.flaws, packId)
    return {
      seed,
      packId,
      originId: r.originId,
      traitIds: r.traitIds,
      flawId: r.flawId,
    }
  } catch (err) {
    console.warn('[玄] 命格随机失败，改用首项兜底。', err)
    return {
      seed,
      packId,
      originId: content.origins[0]?.id ?? 'origin_wanderer',
      traitIds: content.traits.slice(0, 3).map((t) => t.id),
      flawId: content.flaws[0]?.id,
    }
  }
}

export function initState(): AppState {
  const content = loadContent()
  const settings = loadSettings()
  return {
    content,
    screen: 'title',
    returnTo: 'title',
    settings,
    resumable: hasSave(),
    gen: initialGenesic(content),
    state: null,
    pres: null,
    floats: [],
    banner: null,
    toast: null,
    justRevealed: [],
    ending: null,
    seq: 0,
  }
}

/* ---------- 工具 ---------- */

function revealedIds(p: NodePresentation | null): Set<string> {
  const s = new Set<string>()
  for (const r of p?.scenario?.rules_hidden ?? []) if (r.revealed) s.add(r.id)
  return s
}

function diffRevealed(prev: NodePresentation | null, next: NodePresentation): string[] {
  const was = revealedIds(prev)
  return (next.scenario?.rules_hidden ?? []).filter((r) => r.revealed && !was.has(r.id)).map((r) => r.id)
}

function floatsFrom(delta: { key: VarKey | AttrKey; from: number; to: number }[], seq: number): FloatItem[] {
  return delta
    .filter((d) => d.to !== d.from)
    .map((d, i) => ({
      id: seq + i,
      label: VAR_LABELS[d.key] ?? d.key,
      from: d.from,
      to: d.to,
      delta: d.to - d.from,
    }))
}

const VAR_LABELS: Record<string, string> = {
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
  root: '根骨',
  wits: '悟性',
  temper: '心性',
  luck: '气运',
  insight: '机敏',
  charm: '魅力',
}

/* ============================================================
   五、reducer
   ============================================================ */

export function reducer(st: AppState, action: Action): AppState {
  switch (action.type) {
    case 'goto':
      return { ...st, screen: action.screen, toast: null }

    case 'openSettings':
      return { ...st, screen: 'settings', returnTo: st.screen === 'settings' ? st.returnTo : st.screen }

    case 'settings':
      return { ...st, settings: { ...st.settings, ...action.patch } }

    case 'genesis/roll':
      return { ...st, gen: rollDraft(st.content, action.seed, st.gen.packId) }

    case 'genesis/setPack':
      return { ...st, gen: { ...st.gen, packId: action.pack } }

    case 'genesis/setOrigin':
      return { ...st, gen: { ...st.gen, originId: action.id } }

    case 'genesis/setTrait': {
      // 三个槽位视为整体：把 id 放到 index 槽，若别处已有则与之互换，不留空槽
      const ids = [...st.gen.traitIds]
      while (ids.length < 3) ids.push('')
      const prev = ids[action.index] ?? ''
      for (let i = 0; i < ids.length; i++) if (i !== action.index && ids[i] === action.id) ids[i] = prev
      ids[action.index] = action.id
      for (let i = 0; i < 3; i++) {
        if (!ids[i]) ids[i] = st.content.traits.find((t) => !ids.includes(t.id))?.id ?? ''
      }
      return { ...st, gen: { ...st.gen, traitIds: ids.slice(0, 3) } }
    }

    case 'genesis/setFlaw':
      return { ...st, gen: { ...st.gen, flawId: action.id } }

    case 'genesis/begin': {
      const { content, gen } = st
      let state: GameState
      try {
        state = startRun({
          runId: action.runId,
          seed: deriveSeed(action.runId, 'run'),
          packId: gen.packId,
          originId: gen.originId,
          traitIds: gen.traitIds,
          flawId: gen.flawId,
          content,
        })
      } catch (err) {
        console.error('[玄] 开局失败（多为内容包缺失）', err)
        return { ...st, toast: '开局失败：内容包不完整' }
      }
      const { state: s2, pres } = presentSafely(state, content)
      return {
        ...st,
        screen: 'play',
        state: s2,
        pres,
        floats: [],
        banner: null,
        toast: null,
        justRevealed: diffRevealed(null, pres),
        ending: null,
        resumable: true,
      }
    }

    case 'resume': {
      const saved = readSave()
      if (!saved) return { ...st, resumable: false, toast: '没有可续的旧局' }
      const { state, pres } = presentSafely(saved, st.content)
      if (pres.kind === 'ending' || state.status === 'ended') {
        return {
          ...st,
          screen: 'ending',
          state,
          pres,
          ending: resolveEnding(state, st.content),
          justRevealed: [],
        }
      }
      return { ...st, screen: 'play', state, pres, floats: [], banner: null, justRevealed: [] }
    }

    case 'abandon': {
      clearSave()
      return {
        ...st,
        screen: 'title',
        state: null,
        pres: null,
        floats: [],
        banner: null,
        ending: null,
        resumable: false,
        gen: rollDraft(st.content, makeSeedString(), st.gen.packId),
      }
    }

    case 'play/option': {
      const { state, pres, content } = st
      if (!state || !pres || pres.kind === 'scenario' || pres.kind === 'ending') return st
      const ev = eventFromPresentation(pres, content)
      const res = submitOption(state, action.optionId, content, ev)
      if (!res.ok) {
        console.warn('[玄] 选项提交被拒：', res.reason)
        return { ...st, toast: res.reason ? `此路不通：${res.reason}` : '此路不通' }
      }
      return afterEngine(st, res.state, res.presentation, res.delta, res.band)
    }

    case 'play/trial': {
      const { state, content, pres } = st
      if (!state || !pres || pres.kind !== 'scenario') return st
      const before = state.active_scenario
      const res = submitTrial(state, action.kind, action.ref, content)
      if (!res.ok) {
        console.warn('[玄] 试之被拒：', res.reason)
        return { ...st, toast: res.reason ? `试之不成：${res.reason}` : '试之不成' }
      }
      const after = res.state.active_scenario
      let banner: Banner | null = null
      if (before && !after) {
        banner = res.state.pending_ending
          ? { kind: 'unsolved', text: '未破局', detail: '时限已尽。此局自成一结。', tone: 'bad' }
          : { kind: 'break', text: '破局', detail: '条件已成，路开了。', tone: 'gold' }
      } else if (after && before && after.attempted.length > before.attempted.length) {
        banner = { kind: 'band', text: '试之无果', detail: '物已耗，刻已过。', tone: 'flat' }
      }
      return afterEngine(st, res.state, res.presentation, res.delta, undefined, banner)
    }

    case 'play/wait': {
      // 无物可试时的「静观其变」：借 submitTrial 的推进逻辑耗去一刻
      const { state, content, pres } = st
      if (!state || !pres || pres.kind !== 'scenario') return st
      const res = submitTrial(state, 'item', '__wait__', content)
      if (!res.ok) return { ...st, toast: '此刻动弹不得' }
      const banner: Banner | null = !res.state.active_scenario
        ? { kind: 'unsolved', text: '未破局', detail: '时限已尽。此局自成一结。', tone: 'bad' }
        : null
      return afterEngine(st, res.state, res.presentation, res.delta, undefined, banner)
    }

    case 'floats/clear':
      return { ...st, floats: [] }

    case 'banner/clear':
      return st.banner ? { ...st, banner: null } : st

    case 'toast':
      return { ...st, toast: action.text }

    default:
      return st
  }
}

/** 引擎结算之后：落状态、记浮字、判终局、算揭示 */
function afterEngine(
  st: AppState,
  nextState: GameState,
  nextPres: NodePresentation,
  delta: { key: VarKey | AttrKey; from: number; to: number }[],
  band: string | undefined,
  bannerOverride?: Banner | null,
): AppState {
  const floats = floatsFrom(delta, st.seq + 1)
  const justRevealed = diffRevealed(st.pres, nextPres)

  let banner = bannerOverride ?? null
  if (!banner && band) {
    banner = { kind: 'band', text: band, tone: band === 'crit_fail' ? 'bad' : band === 'fail' ? 'flat' : 'good' }
  }
  if (justRevealed.length > 0) {
    banner = { kind: 'reveal', text: '参透', detail: '隐规则之一，自此洞明。', tone: 'gold' }
  }

  const ended = nextState.status === 'ended' || nextPres.kind === 'ending'
  return {
    ...st,
    state: nextState,
    pres: nextPres,
    floats,
    banner,
    justRevealed,
    toast: null,
    seq: st.seq + floats.length,
    screen: ended ? 'ending' : 'play',
    ending: ended ? resolveEnding(nextState, st.content) : null,
  }
}

/* ============================================================
   六、Context
   ============================================================ */

export interface GameBag {
  st: AppState
  dispatch: React.Dispatch<Action>
  heaven: HeavenBoardRow[]
}

export const GameCtx = createContext<GameBag | null>(null)

export function useGame(): GameBag {
  const g = useContext(GameCtx)
  if (!g) throw new Error('useGame 必须在 GameCtx.Provider 内使用')
  return g
}

export { buildHeavenBoard }
export type { EndingResult, HeavenBoardRow, Condition, Effect }
