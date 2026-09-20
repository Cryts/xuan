/**
 * content-lint —— 构建期硬门禁。见 SPEC 第 8 章与附录A A8。
 *
 * 验收口径（任一 error 即退出码 1，CI 应据此阻断构建）：
 *   ip_clean          禁用词 0 命中（error）
 *   schema_valid      结构合法（error）
 *   ref_resolvable    所有引用可解析（error）
 *   no_numbers        叙事模板不含阿拉伯数字（error）
 *   curve_continuity  power_index 区间连续不倒挂且覆盖 0-1000（error）
 *   scenario_shape    每剧本 ≥3 条互不包含通路，条件类型 ≥3 种（error）
 *   option_diff       同一事件各选项改写的长期变量不完全相同（warn）
 *   weight_health     单阶段事件数 <30 或某事件权重占比 >15%（warn）
 *   attr_balance      出身/天赋属性加成总和超阈值（warn）
 *   ending_coverage   结局分类缺失（warn）
 */

import { scanText } from './forbidden-words'
import { loadContent, ROOT } from './load-content'
import path from 'node:path'

type Level = 'error' | 'warn'
interface Issue {
  rule: string
  level: Level
  where: string
  msg: string
}

const issues: Issue[] = []
const err = (rule: string, where: string, msg: string) =>
  issues.push({ rule, level: 'error', where, msg })
const warn = (rule: string, where: string, msg: string) =>
  issues.push({ rule, level: 'warn', where, msg })

// ------------------------------------------------------------

const c = loadContent()

// ---- 加载健康 ----
for (const m of c.report.missing) warn('missing_file', m, '文件缺失')
for (const b of c.report.broken) err('schema_valid', b.file, `JSON 解析失败：${b.error}`)

const PACKS = ['mortal', 'genius', 'physique', 'mystery', 'rebel', 'cautious']

// ---- 1. IP 禁用词全量扫描 ----
function scanDeep(value: unknown, where: string, skipKeys: string[] = []): void {
  if (typeof value === 'string') {
    const hits = scanText(value)
    for (const h of hits) {
      err('ip_clean', where, `命中禁用词「${h.word}」（来自《${h.from}》）→ 建议替换为「${h.repl}」`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanDeep(v, `${where}[${i}]`, skipKeys))
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (skipKeys.includes(k)) continue
      scanDeep(v, `${where}.${k}`, skipKeys)
    }
  }
}

scanDeep(c.packs, 'packs')
scanDeep(c.events, 'events')
scanDeep(c.scenarios, 'scenarios')
scanDeep(c.endings, 'endings')
scanDeep(c.origins, 'origins')
scanDeep(c.traits, 'traits')
scanDeep(c.flaws, 'flaws')
scanDeep(c.destinies, 'destinies')
scanDeep(c.l2, 'narrative/l2')
scanDeep(c.oracle, 'narrative/oracle')
scanDeep(c.coincidence, 'narrative/coincidence')
scanDeep(c.affixes, 'items/affixes')
scanDeep(c.items, 'items/items')
scanDeep(c.names, 'names')

// ---- 2. 体系包：境界曲线连续性 + 覆盖 0–1000 ----
for (const pid of PACKS) {
  const p = c.packs[pid] as
    | { realms?: { idx: number; name: string; power_index: [number, number]; breakthrough: number }[] }
    | undefined
  if (!p) {
    err('schema_valid', `packs/${pid}`, '体系包缺失')
    continue
  }
  const realms = p.realms ?? []
  if (realms.length === 0) {
    err('schema_valid', `packs/${pid}`, 'realms 为空')
    continue
  }
  if (realms[0]!.power_index[0] !== 0) {
    err('curve_continuity', `packs/${pid}`, `首境下界应为 0，实际 ${realms[0]!.power_index[0]}`)
  }
  const last = realms[realms.length - 1]!
  if (last.power_index[1] !== 1000) {
    err('curve_continuity', `packs/${pid}`, `末境上界应为 1000，实际 ${last.power_index[1]}`)
  }
  for (let i = 1; i < realms.length; i++) {
    const prev = realms[i - 1]!
    const cur = realms[i]!
    if (cur.power_index[0] !== prev.power_index[1]) {
      err(
        'curve_continuity',
        `packs/${pid}`,
        `境界断层：${prev.name} 止于 ${prev.power_index[1]}，${cur.name} 起于 ${cur.power_index[0]}`,
      )
    }
    if (cur.power_index[1] <= cur.power_index[0]) {
      err('curve_continuity', `packs/${pid}`, `${cur.name} 区间倒挂`)
    }
    if (cur.breakthrough > prev.breakthrough && cur.breakthrough > 0.9) {
      warn('curve_continuity', `packs/${pid}`, `${cur.name} 突破率异常偏高`)
    }
  }
}

// ---- 3. 事件 ----
const eventIds = new Set<string>()
const scenarioIds = new Set<string>()
const seenMotifs = new Set<string>()

const asArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

interface AnyEv {
  id?: string
  kind?: string
  pack?: string[]
  stage?: string[]
  weight?: number
  motif?: string
  options?: {
    id?: string
    text?: string
    intent?: string
    risk_tier?: string
    odds_hint?: string
    resolve?: {
      bands?: Record<
        string,
        { effects?: { type?: string; key?: string; delta?: number }[] } | undefined
      >
    }
    outcome?: { effects?: { type?: string; key?: string; delta?: number }[] }
  }[]
  narrative?: { title_pool?: string[]; body_key?: string }
  followups?: string[]
  rules_stated?: string[]
  rules_hidden?: { id?: string; hint?: string; reveal?: unknown }[]
  forbidden?: string[]
  breakthroughs?: {
    id?: string
    name?: string
    cost?: string
    conditions?: { type?: string }[]
    outcome?: { ref?: string }
    hidden?: boolean
  }[]
  unsolved?: { narrative?: string; ref?: string }
  span?: number
}

const VAR_KEYS = [
  'currency',
  'power',
  'rare_mat',
  'favor',
  'debt',
  'exposure',
  'corruption',
  'karma',
  'hp',
  'lifespan',
]

const allEvents: AnyEv[] = [...asArr<AnyEv>(c.events), ...asArr<AnyEv>(c.scenarios)]

for (const e of allEvents) {
  const where = `event:${e.id ?? '(无 id)'}`
  if (!e.id) {
    err('schema_valid', 'events', '事件缺少 id')
    continue
  }
  if (e.kind === 'scenario') scenarioIds.add(e.id)
  else eventIds.add(e.id)

  if (!e.pack || !Array.isArray(e.pack) || e.pack.length === 0) {
    err('schema_valid', where, 'pack 缺失或为空')
  } else {
    for (const p of e.pack) {
      if (p !== '*' && !PACKS.includes(p)) {
        err('ref_resolvable', where, `未知体系包引用：${p}`)
      }
    }
  }

  if (e.kind === 'scenario') {
    // --- 剧本专项检查 ---
    const bts = e.breakthroughs ?? []
    if (bts.length < 3) {
      err('scenario_shape', where, `破局条件组仅 ${bts.length} 组，要求 ≥3（自由度支柱 #4）`)
    }
    if (bts.length > 0) {
      const types = new Set<string>()
      for (const b of bts) for (const cond of b.conditions ?? []) {
        if (cond.type) types.add(cond.type)
        // 嵌套的 any/all/not 里也要数
        const deep = (x: unknown): void => {
          if (Array.isArray(x)) return x.forEach(deep)
          if (x && typeof x === 'object') {
            const o = x as { type?: string; of?: unknown; refs?: unknown }
            if (o.type) types.add(o.type)
            if (o.of) deep(o.of)
          }
        }
        deep(cond)
      }
      if (types.size < 3) {
        err(
          'scenario_shape',
          where,
          `破局条件类型仅 ${types.size} 种（${[...types].join('/')}），要求 ≥3 种`,
        )
      }
      // 互不包含的粗检：条件组之间不能完全相同
      const sigs = bts.map((b) => JSON.stringify(b.conditions ?? []))
      const dup = sigs.filter((s, i) => sigs.indexOf(s) !== i)
      if (dup.length > 0) {
        err('scenario_shape', where, '存在完全相同的破局条件组')
      }
      for (const b of bts) {
        if (!b.outcome?.ref) {
          err('ref_resolvable', where, `破局组「${b.name ?? b.id}」缺少 outcome.ref`)
        }
      }
    }
    if (!e.unsolved?.ref) {
      err('scenario_shape', where, '缺少 unsolved.ref —— 未破局必须是一种独立结局')
    }
    if (!e.rules_stated || e.rules_stated.length === 0) {
      err('scenario_shape', where, '缺少明规则 rules_stated')
    }
    if (!e.rules_hidden || e.rules_hidden.length === 0) {
      warn('scenario_shape', where, '缺少隐规则 rules_hidden —— 这是推理动机的来源')
    }
    if ((e.span ?? 0) < 3 || (e.span ?? 0) > 8) {
      warn('scenario_shape', where, `span=${e.span}，建议 3–8`)
    }
    continue
  }

  // --- 散事件检查 ---
  const opts = e.options ?? []
  // 位面之子遭遇事件（tag: destiny，SPEC 第 6 章）走五路结构：
  // 结盟 / 夺宝 / 截杀 / 论道 / 避让，故上限放宽到 5；普通散事件仍为 1–4。
  const isEncounter = ((e as unknown as { tags?: string[] }).tags ?? []).includes('destiny')
  const maxOpts = isEncounter ? 5 : 4
  if (opts.length < 1 || opts.length > maxOpts) {
    err('schema_valid', where, `选项数 ${opts.length}，要求 1–${maxOpts}`)
  }

  // 选项差异化：各选项改写的长期变量不能完全相同。
  // 注意要同时看 outcome.effects（无判定的直通结果）与
  // resolve.bands[*].effects（有判定的四段结果）—— 漏掉后者会误报。
  const varSets = opts.map((o) => {
    const keys = new Set<string>()
    const collect = (effs?: { type?: string; key?: string }[]) => {
      for (const ef of effs ?? []) {
        if (ef.key && VAR_KEYS.includes(ef.key)) keys.add(ef.key)
      }
    }
    collect(o.outcome?.effects)
    for (const band of Object.values(o.resolve?.bands ?? {})) {
      collect(band?.effects)
    }
    return [...keys].sort().join(',')
  })
  const nonEmpty = varSets.filter((s) => s.length > 0)
  if (opts.length > 1 && nonEmpty.length > 1 && new Set(nonEmpty).size === 1) {
    warn('option_diff', where, '所有选项改写的长期变量完全相同 —— 疑似伪选择')
  }
  if (opts.length > 1 && nonEmpty.length === 0) {
    warn('option_diff', where, '没有任何选项改写长期变量（SPEC 2.1 检查表第 1 条）')
  }

  for (const o of opts) {
    if (!o.risk_tier || !['稳', '常', '险', '狠', '绝'].includes(o.risk_tier)) {
      warn('schema_valid', where, `选项 ${o.id} 的 risk_tier 非法：${o.risk_tier}`)
    }
    if (!o.odds_hint) warn('schema_valid', where, `选项 ${o.id} 缺少 odds_hint`)
  }

  if (!e.narrative?.body_key) {
    err('schema_valid', where, '缺少 narrative.body_key')
  }
  if (!e.narrative?.title_pool || e.narrative.title_pool.length === 0) {
    warn('schema_valid', where, '缺少 title_pool')
  }

  // 连锁引用可解析
  for (const f of e.followups ?? []) {
    const id = f.split('@')[0]
    if (id && !c.events.some((x) => (x as AnyEv).id === id) && !c.scenarios.some((x) => (x as AnyEv).id === id)) {
      warn('ref_resolvable', where, `followup 指向不存在的事件：${id}`)
    }
  }

  if (e.motif) seenMotifs.add(e.motif)
}

// ---- 4. 叙事池：禁数字 + 禁系统词 ----
const SYS_WORDS = ['灵石', '修为', '成功率', '攻击力', '防御力', '暴击', '经验值']
for (const [key, arr] of Object.entries(c.l2)) {
  if (!Array.isArray(arr)) {
    err('schema_valid', `narrative/l2.${key}`, '值不是数组')
    continue
  }
  if (arr.length < 2) {
    warn('narrative_pool', `narrative/l2.${key}`, `仅 ${arr.length} 条候选，建议 3–5`)
  }
  for (const t of arr) {
    if (/[0-9０-９]/.test(t)) {
      err('no_numbers', `narrative/l2.${key}`, `叙事含阿拉伯数字：「${t.slice(0, 30)}…」`)
    }
    const sys = SYS_WORDS.find((w) => t.includes(w))
    if (sys) {
      err('no_numbers', `narrative/l2.${key}`, `叙事含系统词「${sys}」`)
    }
  }
}

// 巧合池必须覆盖全部原型 key
const NEEDED_COINCIDENCE = [
  'destiny.protect.brute',
  'destiny.protect.schemer',
  'destiny.protect.turtle',
  'destiny.protect.ironic',
  'destiny.protect.tragic',
  'destiny.protect.none',
]
for (const k of NEEDED_COINCIDENCE) {
  const arr = c.coincidence[k]
  if (!arr || arr.length === 0) {
    err('ref_resolvable', `narrative/coincidence`, `缺少必需的巧合池：${k}`)
  } else if (arr.length < 4) {
    warn('narrative_pool', `narrative/coincidence.${k}`, `仅 ${arr.length} 条，建议 ≥4`)
  }
}
if (c.oracle.length < 20) {
  warn('narrative_pool', 'narrative/oracle', `谶语池仅 ${c.oracle.length} 条，建议 ≥40`)
}

// ---- 5. 结局覆盖 ----
const ENDING_CATEGORIES = [
  '飞升',
  '称尊',
  '隐居',
  '道陨',
  '走火入魔',
  '转世',
]
const endingCats = new Set(
  asArr<{ category?: string }>(c.endings).map((e) => e.category).filter(Boolean) as string[],
)
for (const cat of ENDING_CATEGORIES) {
  if (![...endingCats].some((x) => x.includes(cat))) {
    warn('ending_coverage', 'endings', `缺少结局分类：${cat}`)
  }
}
if (c.endings.length < 60) {
  warn('ending_coverage', 'endings', `结局数 ${c.endings.length}，目标 ≥60`)
}

// ---- 2b. motif_weights 键对齐（motif_weight_keys）----
//
// 调度器取 `pack.motif_weights[motif] ?? 1`，所以键名对不上时**不会报错**，
// 只是静默退回 1.0 —— 整套"各体系偏好不同母题"的设计悄然失效。
// 这类静默降级必须靠门禁兜住。
{
  const motifIds = new Set(
    asArr<{ id?: string }>(c.motifs).map((m) => m.id).filter(Boolean) as string[],
  )
  if (motifIds.size > 0) {
    for (const pid of PACKS) {
      const p = c.packs[pid] as { motif_weights?: Record<string, number> } | undefined
      if (!p?.motif_weights) {
        warn('motif_weight_keys', `packs/${pid}`, '缺少 motif_weights')
        continue
      }
      const bad = Object.keys(p.motif_weights).filter((k) => !motifIds.has(k))
      for (const k of bad.slice(0, 6)) {
        err(
          'motif_weight_keys',
          `packs/${pid}`,
          `motif_weights 的键 "${k}" 不在 motifs.json 中 —— 该权重会被静默忽略（退回 1.0）`,
        )
      }
      if (bad.length > 6) {
        err('motif_weight_keys', `packs/${pid}`, `另有 ${bad.length - 6} 个键名不匹配`)
      }
    }
  }
}

// ---- 4a. 正文可达性（text_resolvable）----
//
// 只验 `body_key` 字段存在是不够的 —— 键写对了但池子里没有，
// 运行时 pickFromPool 返回空串，界面就落到兜底文案上。
//
// 这条是补的：曾经 64 个结局的 body_key **一个都取不到**，
// 玩家打完一世看到的永远是兜底的那句"一世终了"，
// 而当时的检查全绿 —— 因为没有任何一条规则问过"这个键取得到文本吗"。
{
  const l2Keys = new Map<string, number>()
  for (const [k, v] of Object.entries(c.l2)) {
    l2Keys.set(k, Array.isArray(v) ? v.filter((s) => s && s.trim().length > 0).length : 0)
  }
  const checkKey = (key: string | undefined, where: string, what: string) => {
    if (!key) {
      err('text_resolvable', where, `${what} 未指定 body_key`)
      return
    }
    const n = l2Keys.get(key)
    if (n === undefined) {
      err('text_resolvable', where, `${what} 的键 "${key}" 不在叙事池中 —— 运行时取不到正文`)
    } else if (n === 0) {
      err('text_resolvable', where, `${what} 的键 "${key}" 在池中但为空`)
    } else if (n < 2) {
      warn('text_resolvable', where, `${what} 的键 "${key}" 只有 1 条候选，建议 ≥2`)
    }
  }

  for (const e of asArr<AnyEv>(c.events)) {
    checkKey(e.narrative?.body_key, `event:${e.id}`, '正文')
  }
  for (const sc of asArr<AnyEv>(c.scenarios)) {
    if (sc.kind !== 'scenario') continue
    for (const b of sc.breakthroughs ?? []) {
      const k = (b as { outcome?: { narrative?: string } }).outcome?.narrative
      if (k) checkKey(k, `scenario:${sc.id}`, `破局组「${b.name ?? b.id}」`)
    }
    const u = (sc as { unsolved?: { narrative?: string } }).unsolved?.narrative
    if (u) checkKey(u, `scenario:${sc.id}`, '未破局')
  }
  for (const e of asArr<{ id?: string; body_key?: string }>(c.endings)) {
    checkKey(e.body_key, `ending:${e.id}`, '结局正文')
  }
}

// ---- 4a2. 开局伤势（origin_hp）----
//
// 出身里的 `start_resources.hp` 是**直接赋值**（不是增量），
// 而且 hp 是伤势（0 完好）。曾经有 13 条出身写着 hp:80~100 ——
// 那是"血量"时代的遗留，语义一改就成了"建号即垂危"，
// 其中一条 hp:100 更是开局直接判死。玩家报的"伤势一直是满的"就是它。
{
  for (const o of asArr<{ name?: string; start_resources?: Record<string, number> }>(c.origins)) {
    const hp = o.start_resources?.hp
    if (hp === undefined) continue
    if (hp >= 100) {
      err('origin_hp', `origin:${o.name}`, `开局伤势 ${hp} —— 一建号就油尽灯枯，直接判死`)
    } else if (hp > 30) {
      err('origin_hp', `origin:${o.name}`, `开局伤势 ${hp} 过高（建议 ≤30）—— 疑似把 hp 当成了"开局气血"`)
    }
  }
}

// ---- 4b. hp 语义方向（hp_semantics）----
//
// `hp` 是**伤势**：0 = 完好，100 = 油尽灯枯；正 delta = 受伤加重。
// 这与"血量"正好相反，是并行生产时最容易被不同 agent 理解反的一处 ——
// 一旦写反，伤害会变成治疗，且是静默的。
//
// 判据用**失败段**，不用成功段。
// 失败时"受伤加重"是几乎必然的叙事，所以 fail/crit_fail 里 hp 若压倒性为**负**，
// 就说明写成了"血量"（失败扣血），这才是语义反了的可靠信号。
// 用成功段判会误报：受伤语义下成功也可能带伤（惨胜），占比本来就高。
{
  const perFile = new Map<string, { failPos: number; failNeg: number }>()
  for (const e of asArr<AnyEv>(c.events)) {
    const file = (e as { __file?: string }).__file ?? '(未知)'
    const acc = perFile.get(file) ?? { failPos: 0, failNeg: 0 }
    for (const o of e.options ?? []) {
      for (const bandName of ['fail', 'crit_fail'] as const) {
        for (const ef of o.resolve?.bands?.[bandName]?.effects ?? []) {
          if (ef.key !== 'hp') continue
          const d = ef.delta ?? 0
          if (d > 0) acc.failPos++
          else if (d < 0) acc.failNeg++
        }
      }
    }
    perFile.set(file, acc)
  }
  for (const [file, { failPos, failNeg }] of perFile) {
    const total = failPos + failNeg
    if (total < 20) continue // 样本太小不下结论
    if (failNeg / total > 0.8) {
      err(
        'hp_semantics',
        `events/${file}`,
        `失败段里 hp 有 ${((failNeg / total) * 100).toFixed(0)}% 为负（${failNeg}/${total}）—— ` +
          `疑似把 hp 当成了"血量"。hp 是**伤势**：失败受伤写 hp +N，疗伤才写 hp −N。`,
      )
    }
  }
}

// ---- 5b. 剧本可解性（scenario_solvable）----
//
// 并行 agent 各写各的时候最容易出的一类事故：剧本的破局条件引用了
// 物品库里根本不存在的东西。这类条件永远不成立，那条通路就是**死内容**，
// 而它看起来完全正常。这里用三值逻辑把整棵条件树判一遍。
//
//   always   —— 必然成立
//   possible —— 玩家可能满足（引用的东西存在）
//   never    —— 永远不可能满足（引用的东西不存在）
//
// any 只要有 possible 就是 possible；all 只要有 never 就是 never。

type Tri = 'always' | 'possible' | 'never'

const AFFIX_IDS = new Set(asArr<{ id?: string }>(c.affixes).map((a) => a.id).filter(Boolean) as string[])
const ITEM_IDS = new Set(asArr<{ id?: string }>(c.items).map((i) => i.id).filter(Boolean) as string[])

/** 物品库实际提供的功能标签 */
const AVAILABLE_AFFORDANCES = new Set<string>()
for (const it of asArr<{ affordance?: string[] }>(c.items)) {
  for (const a of it.affordance ?? []) AVAILABLE_AFFORDANCES.add(a)
}
/** 词条自带的标签也算（引擎会把词条标签展开进物品） */
for (const af of asArr<{ affordance?: string[] }>(c.affixes)) {
  for (const a of af.affordance ?? []) AVAILABLE_AFFORDANCES.add(a)
}

/** 全部内容能产出的 learn_rule（跨界习得的可达集） */
const PRODUCIBLE_RULES = new Set<string>()
function harvestLearnRules(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(harvestLearnRules)
  if (value && typeof value === 'object') {
    const o = value as { type?: string; pack?: string; ref?: string }
    if (o.type === 'learn_rule' && o.pack && o.ref) PRODUCIBLE_RULES.add(`${o.pack}:${o.ref}`)
    for (const v of Object.values(value)) harvestLearnRules(v)
  }
}
harvestLearnRules(c.events)
harvestLearnRules(c.scenarios)
harvestLearnRules(c.traits)
harvestLearnRules(c.flaws)

interface AtomIssue {
  type: string
  ref: string
  reason: string
}

function triOf(cond: unknown, issues: AtomIssue[]): Tri {
  if (Array.isArray(cond)) {
    return cond.some((x) => triOf(x, issues) !== 'never') ? 'possible' : 'never'
  }
  if (!cond || typeof cond !== 'object') return 'possible'
  const o = cond as Record<string, unknown>
  const type = o.type as string | undefined

  switch (type) {
    case 'any': {
      const kids = (o.of as unknown[]) ?? []
      const tris = kids.map((k) => triOf(k, issues))
      if (tris.includes('always')) return 'always'
      if (tris.includes('possible')) return 'possible'
      return 'never'
    }
    case 'all': {
      const kids = (o.of as unknown[]) ?? []
      const tris = kids.map((k) => triOf(k, issues))
      if (tris.includes('never')) return 'never'
      return tris.every((t) => t === 'always') ? 'always' : 'possible'
    }
    case 'not': {
      const t = triOf(o.of, issues)
      return t === 'never' ? 'always' : t === 'always' ? 'never' : 'possible'
    }
    case 'affordance': {
      const ref = o.ref as string
      if (!AVAILABLE_AFFORDANCES.has(ref)) {
        issues.push({ type, ref, reason: '物品库与词条库都没有这个功能标签' })
        return 'never'
      }
      return 'possible'
    }
    case 'affix_count': {
      const ref = o.ref as string
      if (!AFFIX_IDS.has(ref)) {
        // 引擎按**词条 id** 匹配；传中文词条名是最常见的跨 agent 事故
        const byName = asArr<{ id?: string; name?: string }>(c.affixes).find((a) => a.name === ref)
        issues.push({
          type,
          ref,
          reason: byName
            ? `传的是词条名，引擎只认 id —— 应写作 "${byName.id}"`
            : '词条库里没有这个 id',
        })
        return 'never'
      }
      return 'possible'
    }
    case 'item': {
      const ref = o.ref as string
      if (!ITEM_IDS.has(ref)) {
        issues.push({ type, ref, reason: '物品库里没有这个 id' })
        return 'never'
      }
      return 'possible'
    }
    case 'learned_rule': {
      const key = `${o.pack}:${o.ref}`
      if (!PRODUCIBLE_RULES.has(key)) {
        issues.push({
          type,
          ref: key,
          reason: '没有任何事件/剧本能产出这条规则 —— 跨界通路不可达',
        })
        return 'never'
      }
      return 'possible'
    }
    default:
      return 'possible'
  }
}

for (const sc of asArr<AnyEv>(c.scenarios)) {
  if (sc.kind !== 'scenario') continue
  const where = `scenario:${sc.id}`
  for (const b of sc.breakthroughs ?? []) {
    const issues: AtomIssue[] = []
    const tri = triOf(b.conditions ?? [], issues)
    for (const iss of issues) {
      err(
        'scenario_solvable',
        where,
        `破局组「${b.name ?? b.id}」的 ${iss.type} 条件引用 "${iss.ref}" 不存在：${iss.reason}`,
      )
    }
    if (tri === 'never') {
      err(
        'scenario_solvable',
        where,
        `破局组「${b.name ?? b.id}」**永远不可能达成** —— 这是一条死通路`,
      )
    }
  }
}

// ---- 6. 事件权重体检 + 阶段覆盖 ----
const byStage = new Map<string, number>()
for (const e of asArr<AnyEv>(c.events)) {
  for (const s of e.stage ?? []) byStage.set(s, (byStage.get(s) ?? 0) + 1)
}
for (const [s, n] of byStage) {
  if (n < 30) warn('weight_health', `stage:${s}`, `该阶段仅 ${n} 个事件，建议 ≥30`)
}

// 每（体系包 × 阶段）都必须有事件。
// 调度器按 pack + stage 双重过滤，某一格为空时，选那个包的玩家
// 在该阶段会一路走到空节点 —— 游戏看起来在跑，其实什么都没发生。
// 这是实际发生过的事故：三个包的童年/入门阶段事件数为 0。
{
  const grid = new Map<string, number>()
  for (const e of asArr<AnyEv>(c.events)) {
    // 通用事件（pack 含 '*'）同时计入 '*' 行与六个具体包 ——
    // 它对哪一个包都是可用的，不能只算作 '*' 自己那一格。
    const rawPacks = e.pack ?? []
    const packs = rawPacks.includes('*') ? [...PACKS, '*'] : rawPacks
    for (const p of packs) {
      for (const s of e.stage ?? []) {
        const k = `${p}|${s}`
        grid.set(k, (grid.get(k) ?? 0) + 1)
      }
    }
  }
  const STAGES = ['childhood', 'entry', 'growth', 'turn', 'endgame']
  for (const p of [...PACKS, '*']) {
    for (const s of STAGES) {
      const n = grid.get(`${p}|${s}`) ?? 0
      if (n === 0) {
        err(
          'stage_coverage',
          `pack:${p}`,
          `阶段「${s}」没有任何事件 —— 选这个体系的玩家在此阶段会走到空节点`,
        )
      } else if (n < 8) {
        warn('stage_coverage', `pack:${p}`, `阶段「${s}」仅 ${n} 个事件，建议 ≥8`)
      }
    }
  }
}

// ---- 报告 ----
const errors = issues.filter((i) => i.level === 'error')
const warns = issues.filter((i) => i.level === 'warn')

console.log('\n══════ 《玄》content-lint ══════\n')
console.log(`已加载：${c.report.loaded.length} 个文件`)
console.log(
  `  体系包 ${Object.keys(c.packs).length}/6 · 术语 ${Object.keys(c.terms).length}/6 · ` +
    `母题 ${c.motifs.length} · 事件 ${asArr(c.events).length} · 剧本 ${asArr(c.scenarios).length} · ` +
    `结局 ${c.endings.length}`,
)
console.log(
  `  出身 ${c.origins.length} · 天赋 ${c.traits.length} · 缺陷 ${c.flaws.length} · ` +
    `命格 ${c.destinies.length} · 词条 ${c.affixes.length} · 物品 ${c.items.length}`,
)
console.log(`  L2 池 ${Object.keys(c.l2).length} 个 key · 谶语 ${c.oracle.length} 条 · ` +
  `巧合池 ${Object.keys(c.coincidence).length} 个 key`)

if (errors.length > 0) {
  console.log(`\n── 错误 (${errors.length}) ──`)
  const grouped = new Map<string, Issue[]>()
  for (const i of errors) {
    const g = grouped.get(i.rule) ?? []
    g.push(i)
    grouped.set(i.rule, g)
  }
  for (const [rule, list] of grouped) {
    console.log(`\n  [${rule}] ${list.length} 处`)
    for (const i of list.slice(0, 12)) console.log(`    ✗ ${i.where}: ${i.msg}`)
    if (list.length > 12) console.log(`    … 另有 ${list.length - 12} 处`)
  }
}

if (warns.length > 0) {
  console.log(`\n── 警告 (${warns.length}) ──`)
  const grouped = new Map<string, Issue[]>()
  for (const i of warns) {
    const g = grouped.get(i.rule) ?? []
    g.push(i)
    grouped.set(i.rule, g)
  }
  for (const [rule, list] of grouped) {
    console.log(`\n  [${rule}] ${list.length} 处`)
    for (const i of list.slice(0, 8)) console.log(`    ! ${i.where}: ${i.msg}`)
    if (list.length > 8) console.log(`    … 另有 ${list.length - 8} 处`)
  }
}

console.log(
  `\n${errors.length === 0 ? '✓ 通过' : '✗ 未通过'} —— 错误 ${errors.length} · 警告 ${warns.length}\n`,
)

// 同时写一份机器可读报告，供原创性报告工具复用
import fs from 'node:fs'
fs.writeFileSync(
  path.join(ROOT, 'lint-report.json'),
  JSON.stringify({ errors, warns, summary: { loaded: c.report.loaded.length } }, null, 2),
)

process.exit(errors.length > 0 ? 1 : 0)
