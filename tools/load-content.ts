/**
 * 内容加载器（工具侧）。
 * 与 src/ui 的加载分开：这里直接从磁盘读，容错并汇报缺项，
 * 供 content-lint 与蒙特卡洛模拟使用。
 */

import { PACK_IDS } from '../src/core/content'
import type { ContentDB } from '../src/core/content'
import type { Motif, NameBank } from '../src/core/content'
import type {
  Affix, Destiny, Ending, FateMilestone, Flaw, Item, LooseEvent,
  Origin, PackId, Scenario, Trait, WorldPack,
} from '../src/core/types'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')
export const CONTENT_DIR = path.join(ROOT, 'src', 'content')

export interface LoadReport {
  loaded: string[]
  missing: string[]
  broken: { file: string; error: string }[]
}

function readJson(file: string): unknown {
  const raw = fs.readFileSync(file, 'utf8')
  return JSON.parse(raw)
}

/** 读单个文件，不存在返回 null */
function readJsonIfExists(file: string, report: LoadReport): unknown {
  const rel = path.relative(ROOT, file)
  if (!fs.existsSync(file)) {
    report.missing.push(rel)
    return null
  }
  try {
    const v = readJson(file)
    report.loaded.push(rel)
    return v
  } catch (e) {
    report.broken.push({ file: rel, error: (e as Error).message })
    return null
  }
}

/**
 * 读一个目录下全部 json，合并成数组。
 * 每项带上 `__file` 溯源 —— 内容由多个 agent 分批生产，
 * 出问题时必须能指回是哪个文件写坏的，否则无法定位。
 */
function readDirArray(dir: string, report: LoadReport): unknown[] {
  if (!fs.existsSync(dir)) {
    report.missing.push(path.relative(ROOT, dir) + '/')
    return []
  }
  const out: unknown[] = []
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue
    const v = readJsonIfExists(path.join(dir, f), report)
    const tag = (x: unknown) => (x && typeof x === 'object' ? { ...x, __file: f } : x)
    if (Array.isArray(v)) out.push(...v.map(tag))
    else if (v && typeof v === 'object') out.push(tag(v))
  }
  return out
}

export interface RawContent {
  report: LoadReport
  packs: Record<string, unknown>
  terms: Record<string, unknown>
  motifs: unknown[]
  events: unknown[]
  scenarios: unknown[]
  endings: unknown[]
  origins: unknown[]
  traits: unknown[]
  flaws: unknown[]
  destinies: unknown[]
  l2: Record<string, string[]>
  oracle: string[]
  coincidence: Record<string, string[]>
  fateTemplates: Record<string, unknown[]>
  names: unknown
  affixes: unknown[]
  items: unknown[]
}

export function loadContent(): RawContent {
  const report: LoadReport = { loaded: [], missing: [], broken: [] }

  const packs: Record<string, unknown> = {}
  const packDir = path.join(CONTENT_DIR, 'packs')
  for (const pid of ['mortal', 'genius', 'physique', 'mystery', 'rebel', 'cautious']) {
    const v = readJsonIfExists(path.join(packDir, `${pid}.json`), report)
    if (v) packs[pid] = v
  }

  const terms: Record<string, unknown> = {}
  const termDir = path.join(CONTENT_DIR, 'terms')
  for (const pid of ['mortal', 'genius', 'physique', 'mystery', 'rebel', 'cautious']) {
    const v = readJsonIfExists(path.join(termDir, `${pid}.json`), report)
    if (v) terms[pid] = v
  }

  const metaDir = path.join(CONTENT_DIR, 'meta')
  const narrDir = path.join(CONTENT_DIR, 'narrative')

  const namesRaw = readJsonIfExists(path.join(CONTENT_DIR, 'names.json'), report)

  // 叙事池支持多文件：l2.json 是基座，l2_*.json 是分批产出的增量。
  // 分开是为了让多个内容 agent 能并行写 —— 挤在同一个文件里必然互相覆盖。
  const l2Raw: Record<string, string[]> = {}
  if (fs.existsSync(narrDir)) {
    for (const f of fs.readdirSync(narrDir).sort()) {
      if (!f.startsWith('l2') || !f.endsWith('.json')) continue
      const part = readJsonIfExists(path.join(narrDir, f), report) as Record<string, string[]> | null
      if (part) Object.assign(l2Raw, part)
    }
  }
  const oracleRaw = readJsonIfExists(path.join(narrDir, 'oracle.json'), report) as
    | { oracle?: string[] }
    | string[]
    | null
  const coincRaw = readJsonIfExists(path.join(narrDir, 'coincidence.json'), report) as
    | Record<string, string[]>
    | null
  const fateRaw = readJsonIfExists(path.join(narrDir, 'fate_templates.json'), report) as
    | Record<string, unknown[]>
    | null

  let oracle: string[] = []
  if (Array.isArray(oracleRaw)) oracle = oracleRaw
  else if (oracleRaw?.oracle) oracle = oracleRaw.oracle

  return {
    report,
    packs,
    terms,
    motifs: ((readJsonIfExists(path.join(CONTENT_DIR, 'motifs.json'), report) as unknown[]) ?? []),
    events: readDirArray(path.join(CONTENT_DIR, 'events'), report),
    scenarios: readDirArray(path.join(CONTENT_DIR, 'scenarios'), report),
    endings: ((readJsonIfExists(path.join(CONTENT_DIR, 'endings.json'), report) as unknown[]) ?? []),
    origins: ((readJsonIfExists(path.join(metaDir, 'origins.json'), report) as unknown[]) ?? []),
    traits: ((readJsonIfExists(path.join(metaDir, 'traits.json'), report) as unknown[]) ?? []),
    flaws: ((readJsonIfExists(path.join(metaDir, 'flaws.json'), report) as unknown[]) ?? []),
    destinies: ((readJsonIfExists(path.join(metaDir, 'destinies.json'), report) as unknown[]) ?? []),
    l2: l2Raw ?? {},
    oracle,
    coincidence: coincRaw ?? {},
    fateTemplates: fateRaw ?? {},
    names: namesRaw,
    affixes: ((readJsonIfExists(path.join(CONTENT_DIR, 'items', 'affixes.json'), report) as unknown[]) ?? []),
    items: ((readJsonIfExists(path.join(CONTENT_DIR, 'items', 'items.json'), report) as unknown[]) ?? []),
  }
}

// ============================================================
// RawContent → ContentDB
// ============================================================

/**
 * 把磁盘上读到的原始 JSON 组装成引擎认识的 `ContentDB`。
 *
 * 这段原先只存在于 `tools/sim.ts` 内部。提出来是因为**每一件工具都要它**
 * （模拟、试玩、平衡核查……），而各自抄一份正是本项目已经吃过亏的那类事：
 * 两份内容加载器漂移过一次，线上跑在占位内容上而没报错。
 * 组装规则只该有一份。
 */
export function buildContentDB(): ContentDB {
  const raw = loadContent()
  const packs = Object.fromEntries(PACK_IDS.map((p) => [p, raw.packs[p]])) as Record<PackId, WorldPack>
  for (const p of PACK_IDS) {
    if (!packs[p]) throw new Error(`体系包 ${p} 缺失，无法模拟`)
  }
  return {
    packs,
    terms: raw.terms as ContentDB['terms'],
    motifs: raw.motifs as Motif[],
    events: raw.events as LooseEvent[],
    scenarios: raw.scenarios as Scenario[],
    endings: raw.endings as Ending[],
    origins: raw.origins as Origin[],
    traits: raw.traits as Trait[],
    flaws: raw.flaws as Flaw[],
    destinies: raw.destinies as Destiny[],
    l2: raw.l2,
    oracle: raw.oracle,
    coincidence: raw.coincidence,
    fateTemplates: raw.fateTemplates as Partial<Record<PackId, FateMilestone[]>>,
    names: (raw.names ?? {
      surname: [],
      given_male: [],
      given_female: [],
      dao_title: { element: [], noun: [], suffix: [] },
      sect: { place: [], suffix: [] },
    }) as NameBank,
    affixes: raw.affixes as Affix[],
    items: raw.items as Item[],
    version: 'tools',
  }
}
