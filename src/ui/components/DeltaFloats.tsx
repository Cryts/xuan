/**
 * 结算浮字 —— 数字滚动 + 上浮淡出。
 *
 * 从 from 滚到 to（约半秒），随后整条上浮消散。
 * 关闭动效时不做补间，直接显示终值。
 */

import { useEffect, useState, type ComponentType } from 'react'
import s from './DeltaFloats.module.css'
import { VAR_ICON, type IconProps } from '@/ui/icons'
import type { FloatItem } from '@/ui/store'

function useCountUp(from: number, to: number, duration: number): number {
  const [v, setV] = useState(to)
  useEffect(() => {
    if (duration <= 0 || from === to) {
      setV(to)
      return
    }
    let raf = 0
    let t0 = 0
    const step = (t: number) => {
      if (t0 === 0) t0 = t
      const k = Math.min(1, (t - t0) / duration)
      const eased = 1 - Math.pow(1 - k, 3)
      setV(Math.round(from + (to - from) * eased))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [from, to, duration])
  return v
}

function Float({ item, motion }: { item: FloatItem; motion: boolean }) {
  const v = useCountUp(item.from, item.to, motion ? 520 : 0)
  const good = item.delta > 0
  const Icon = (VAR_ICON as Record<string, ComponentType<IconProps> | undefined>)[item.key]
  return (
    <div className={`${s.row} ${good ? s.good : s.bad}`}>
      {/* 与状态条同一套图标 —— 同一个量，在哪里都是同一个形状 */}
      {Icon ? (
        <span className={s.icon}>
          <Icon size={13} />
        </span>
      ) : null}
      <span className={s.label}>{item.label}</span>
      <span className={`${s.value} x-num`}>{v}</span>
      <span className={`${s.delta} x-num`}>
        {good ? '+' : '−'}
        {Math.abs(item.delta)}
      </span>
    </div>
  )
}

export function DeltaFloats({ floats, motion }: { floats: FloatItem[]; motion: boolean }) {
  if (floats.length === 0) return null
  return (
    <div className={s.layer} aria-live="polite">
      <div className={s.stack}>
        {floats.map((f, i) => (
          <Float key={f.id} item={f} motion={motion && i < 8} />
        ))}
      </div>
    </div>
  )
}
