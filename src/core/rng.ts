/**
 * 确定性种子 RNG。
 *
 * 无服务端时，"确定性"换来的不是防作弊，而是**可复现**：
 * 同一个 run_id 永远跑出同一条命，平衡模拟与 bug 复现都依赖这一点。
 * 见 SPEC 第 1 章决策 #2。
 */

/** FNV-1a 32 位字符串哈希 */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 由三段构造全局种子，保证同一局同一节点永远可复现 */
export function makeSeed(runId: string, nodeIndex: number, nonce = ''): string {
  return `${runId}:${nodeIndex}:${nonce}:${hashString(`${runId}|${nodeIndex}|${nonce}`)}`
}

/** 从父种子派生一个独立子流 —— 位面之子各用各的流，互不干扰 */
export function deriveSeed(seed: string, salt: string): string {
  return `${seed}~${salt}:${hashString(`${seed}~${salt}`)}`
}

/** mulberry32：小而快，分布足够好 */
export class Rng {
  private s: number

  constructor(seed: string | number) {
    this.s = (typeof seed === 'number' ? seed : hashString(seed)) >>> 0
    if (this.s === 0) this.s = 0x9e3779b9
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [min, max] 闭区间整数 */
  int(min: number, max: number): number {
    if (max <= min) return min
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** [min, max) 浮点 */
  float(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick: 空数组')
    return arr[Math.floor(this.next() * arr.length)]!
  }

  /** 加权抽样，返回下标 */
  weightedIndex(weights: readonly number[]): number {
    let total = 0
    for (const w of weights) total += Math.max(0, w)
    if (total <= 0) return 0
    let r = this.next() * total
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]!)
      if (r <= 0) return i
    }
    return weights.length - 1
  }

  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    return items[this.weightedIndex(weights)]!
  }

  /** 无放回加权抽样 */
  weightedSample<T>(items: readonly T[], weights: readonly number[], count: number): T[] {
    const pool = items.map((v, i) => ({ v, w: Math.max(0, weights[i] ?? 0) }))
    const out: T[] = []
    while (out.length < count && pool.length > 0) {
      const idx = this.weightedIndex(pool.map((p) => p.w))
      out.push(pool[idx]!.v)
      pool.splice(idx, 1)
    }
    return out
  }

  /** Fisher-Yates 洗牌（返回新数组） */
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[a[i], a[j]] = [a[j]!, a[i]!]
    }
    return a
  }
}
