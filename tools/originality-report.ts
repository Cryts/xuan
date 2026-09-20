/**
 * 原创性报告 —— 发布前的人工过审清单。见 SPEC 第 8 章。
 *
 * 构建期硬门禁（content-lint）拦得住禁用词表里的精确命中，
 * 但拦不住"形近"与"改一个字"的情况。这份报告把全部高辨识度名词
 * 摊开来给人看，是最后一道人工闸。
 *
 * 跑法：npx tsx tools/originality-report.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadContent, ROOT } from './load-content'
import { FORBIDDEN } from './forbidden-words'

const c = loadContent()

/** 通用修真词（可保留），从高辨识度审查中排除 */
const COMMON = new Set([
  '炼气', '筑基', '结丹', '金丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫',
  '真仙', '金仙', '大罗', '凡人', '宗门', '长老', '弟子', '师兄', '师姐',
  '丹药', '灵石', '法宝', '灵草', '妖兽', '秘境', '洞府', '坊市', '拍卖',
  '天劫', '因果', '心魔', '寿元', '修为', '境界', '功法', '灵根', '神识',
  '散修', '道侣', '道友', '前辈', '掌门', '真君', '真人', '仙子',
])

const PROPER_NOUN_RE = /[一-龥]{2,6}(丹|诀|经|录|谱|册|典|珠|石|符|剑|刀|钟|塔|鼎|瓶|镜|印|幡|炉|阵|会|阁|殿|宫|观|寺|院|门|宗|派|教|帮|盟|城|山|海|渊|谷|渊|界|域|洲|府|族|体|骨|血|瞳|道|术|法|身|神|仙|魔|妖|虫|兽)/g

/** word → 出现位置集合 */
const nouns = new Map<string, Set<string>>()

function collect(value: unknown, where: string): void {
  if (typeof value === 'string') {
    if (COMMON.has(value)) return
    const matches = value.match(PROPER_NOUN_RE)
    if (!matches) return
    for (const m of matches) {
      if (m.length < 2 || COMMON.has(m)) continue
      const set = nouns.get(m) ?? new Set<string>()
      set.add(where)
      nouns.set(m, set)
    }
    return
  }
  if (Array.isArray(value)) return value.forEach((v, i) => collect(v, `${where}[${i}]`))
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, `${where}.${k}`)
  }
}

collect(c.packs, 'packs')
collect(c.motifs, 'motifs')
collect(c.events, 'events')
collect(c.scenarios, 'scenarios')
collect(c.endings, 'endings')
collect(c.items, 'items')
collect(c.affixes, 'affixes')
collect(c.names, 'names')

/** 与禁用词的形近检测：共享 2 个以上汉字且长度接近 */
function nearMiss(word: string): { hit: string; from: string } | null {
  for (const f of FORBIDDEN) {
    if (f.word.length < 3) continue
    let shared = 0
    for (const ch of new Set(word)) {
      if (f.word.includes(ch)) shared++
    }
    if (shared >= 2 && Math.abs(word.length - f.word.length) <= 1 && word !== f.word) {
      return { hit: f.word, from: f.from }
    }
  }
  return null
}

console.log('\n══════ 《玄》原创性报告 ══════\n')
console.log(`扫描范围：${nobles()} 个唯一高辨识度名词\n`)

function nobles(): number {
  return nouns.size
}

// 按出现次数排序
const sorted = [...nouns.entries()].sort((a, b) => b[1].size - a[1].size)

let flagged = 0
const lines: string[] = []

for (const [word] of sorted) {
  // 与禁用词表精确相同 —— content-lint 已经会拦，这里再列一次
  const exact = FORBIDDEN.find((f) => f.word === word)
  const near = nearMiss(word)

  if (exact) {
    flagged++
    lines.push(`  ✗ [精确命中] ${word}  ← 《${exact.from}》，须替换为「${exact.repl}」`)
  } else if (near) {
    flagged++
    lines.push(`  ⚠ [形近存疑] ${word}  ← 与《${near.from}》的「${near.hit}」相近，请人工确认`)
  }
}

if (flagged === 0) {
  console.log('✓ 未发现精确命中或形近存疑的名词\n')
} else {
  console.log(`发现 ${flagged} 处需要人工确认：\n`)
  for (const l of lines) console.log(l)
  console.log('')
}

// 全量清单（供人工通读）
console.log('── 全部高辨识度名词（按出现广度排序）──\n')
const preview = sorted.slice(0, 120)
for (let i = 0; i < preview.length; i += 4) {
  const row = preview
    .slice(i, i + 4)
    .map(([w, s]) => `${w}`.padEnd(12) + `×${String(s.size).padStart(3)}`)
    .join('  ')
  console.log('  ' + row)
}
if (sorted.length > 120) console.log(`\n  … 另有 ${sorted.length - 120} 个名词，见完整输出`)

const report = {
  generated: 'build-time',
  total_nouns: sorted.length,
  flagged: flagged,
  details: lines,
  all_nouns: sorted.map(([w, s]) => ({ word: w, seen_in: [...s].slice(0, 5), count: s.size })),
}

fs.writeFileSync(
  path.join(ROOT, 'originality-report.json'),
  JSON.stringify(report, null, 2),
)

console.log(`\n完整报告已写入 originality-report.json`)
console.log(`\n人工过审要点：`)
console.log(`  1. 逐个确认「形近存疑」项 —— 改一个字不算原创`)
console.log(`  2. 通读全量清单，凭记忆判断是否眼熟`)
console.log(`  3. 境界序列属通用设定可保留；法宝/功法/组织/地名/人名必须原创`)
console.log(`  4. 情节只保留母题骨架，不得复制具体桥段与台词\n`)

process.exit(flagged > 0 ? 1 : 0)
