/**
 * 核心纯度检查 —— SPEC 第 9 章的架构约束。
 *
 * src/core 必须零平台依赖：不 import DOM、浏览器 API、React、Node API。
 * 这是「同一套代码既跑游戏也跑十万局蒙特卡洛」的前提，不能靠自觉，要靠闸门。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CORE = path.resolve(__dirname, '..', 'src', 'core')

const BANNED_IMPORTS = [
  'react',
  'react-dom',
  'node:',
  'fs',
  'path',
  'process',
  'zustand',
  'axios',
]

const BANNED_GLOBALS = [
  'document',
  'window',
  'localStorage',
  'sessionStorage',
  'navigator',
  'fetch',
  'XMLHttpRequest',
  'requestAnimationFrame',
]

interface Violation {
  file: string
  line: number
  kind: string
  text: string
}

const violations: Violation[] = []

function walk(dir: string): string[] {
  const out: string[] = []
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (f.endsWith('.ts') || f.endsWith('.tsx')) out.push(p)
  }
  return out
}

for (const file of walk(CORE)) {
  const rel = path.relative(path.resolve(__dirname, '..'), file)
  const lines = fs.readFileSync(file, 'utf8').split('\n')

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return

    // import 检查
    const imp = line.match(/^\s*import\s+.*?from\s+['"]([^'"]+)['"]/)
    if (imp) {
      const src = imp[1]!
      for (const bad of BANNED_IMPORTS) {
        if (src === bad || src.startsWith(bad)) {
          violations.push({ file: rel, line: i + 1, kind: 'import', text: `import 自 ${src}` })
        }
      }
    }

    // 全局对象检查（排除类型位置与注释）
    for (const g of BANNED_GLOBALS) {
      const re = new RegExp(`(?<![\\w.'"\`])${g}\\s*[.(\\[]`)
      if (re.test(line)) {
        violations.push({ file: rel, line: i + 1, kind: 'global', text: `使用了 ${g}` })
      }
    }
  })
}

console.log('\n══════ 《玄》game-core 纯度检查 ══════\n')

if (violations.length === 0) {
  console.log('✓ src/core 零平台依赖 —— 可在 Node 中独立跑模拟\n')
  process.exit(0)
}

console.log(`✗ 发现 ${violations.length} 处越界：\n`)
for (const v of violations) {
  console.log(`  ${v.file}:${v.line}  [${v.kind}] ${v.text}`)
}
console.log('\n提示：这些依赖会破坏「核心可独立模拟」的架构约束（SPEC 第 9 章）。')
console.log('     若确有需要，请把该逻辑移到 src/ui 或 tools/ 下。\n')
process.exit(1)
