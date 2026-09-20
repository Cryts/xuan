/**
 * 共用零件 —— 印章、标签、条、点列、抽屉、星。
 * 一律薄封装：造型交给 theme.css 的全局类，布局交给各屏自己的 module。
 */

import type { ReactNode } from 'react'
import s from './Shared.module.css'
import { IconClose } from '@/ui/icons'

/* ---------- 水墨底 ---------- */
export function InkBackdrop({ dense = false }: { dense?: boolean }) {
  return (
    <div className={dense ? `${s.ink} ${s.inkDense}` : s.ink} aria-hidden>
      <span className={s.blobA} />
      <span className={s.blobB} />
      <span className={s.blobC} />
      <span className={s.grain} />
    </div>
  )
}

/* ---------- 印章 ---------- */
export function Seal({
  text,
  tone = 'cinnabar',
  className,
}: {
  text: string
  tone?: 'cinnabar' | 'gold' | 'jade' | 'plain'
  className?: string
}) {
  return <span className={`x-seal ${s.seal} ${s[`seal_${tone}`]} ${className ?? ''}`}>{text}</span>
}

/* ---------- 标签 ---------- */
export function Chip({
  children,
  tone = 'plain',
  title,
}: {
  children: ReactNode
  tone?: 'plain' | 'gold' | 'jade' | 'cinnabar'
  title?: string
}) {
  return (
    <span className={`x-chip ${tone !== 'plain' ? `x-chip--${tone}` : ''}`} title={title}>
      {children}
    </span>
  )
}

/* ---------- 小节标题 ---------- */
export function SectionTitle({
  icon,
  text,
  hint,
  tone = 'plain',
}: {
  icon?: ReactNode
  text: string
  hint?: string
  tone?: 'plain' | 'gold' | 'jade' | 'cinnabar'
}) {
  return (
    <div className={`${s.secTitle} ${s[`sec_${tone}`]}`}>
      {icon ? <span className={s.secIcon}>{icon}</span> : null}
      <h3 className={s.secText}>{text}</h3>
      {hint ? <span className={s.secHint}>{hint}</span> : null}
      <span className={s.secRule} />
    </div>
  )
}

/* ---------- 数值条 ---------- */
export function Meter({
  value,
  max,
  accent,
  height = 3,
}: {
  value: number
  max: number
  accent?: string
  height?: number
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="x-bar" style={{ height }}>
      <span className="x-bar__fill" style={{ width: `${pct}%`, ['--accent' as string]: accent }} />
    </div>
  )
}

/* ---------- 气运点列 ---------- */
export function Pips({ filled, total, size = 9 }: { filled: number; total: number; size?: number }) {
  const n = Math.max(total, filled, 1)
  return (
    <span className="x-pips" style={{ gap: size > 10 ? 4 : 3 }}>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={i < filled ? 'x-pip x-pip--on' : 'x-pip'}
          style={{ width: size, height: size }}
        />
      ))}
    </span>
  )
}

/* ---------- 时刻刻度 ---------- */
export function Ticks({ used, total }: { used: number; total: number }) {
  const n = Math.max(total, 1)
  return (
    <span className="x-ticks">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={
            i < used
              ? i >= n - 2
                ? 'x-tick x-tick--hot'
                : 'x-tick x-tick--used'
              : 'x-tick'
          }
        />
      ))}
    </span>
  )
}

/* ---------- 抽屉 ---------- */
export function Sheet({
  open,
  title,
  hint,
  onClose,
  children,
}: {
  open: boolean
  title: string
  hint?: string
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <>
      <div className="x-mask" onClick={onClose} />
      <div className="x-sheet x-grain" role="dialog" aria-label={title}>
        <div className="x-sheet__head">
          <div className={s.sheetTitle}>
            <span className="x-h3">{title}</span>
            {hint ? <span className="x-tiny">{hint}</span> : null}
          </div>
          <button className={s.iconBtn} onClick={onClose} aria-label="关闭">
            <IconClose size={18} />
          </button>
        </div>
        <div className="x-sheet__body">{children}</div>
      </div>
    </>
  )
}

/* ---------- 五星 ---------- */
export function Stars({ n, size = 15 }: { n: number; size?: number }) {
  return (
    <span className={s.stars} aria-label={`评星 ${n}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          className={i < n ? s.starOn : s.starOff}
          aria-hidden
        >
          <path
            d="M12 2.4 14.5 9.5 21.6 12 14.5 14.5 12 21.6 9.5 14.5 2.4 12 9.5 9.5Z"
            fill="currentColor"
          />
        </svg>
      ))}
    </span>
  )
}

/* ---------- 空态 ---------- */
export function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className={s.empty}>
      <span className={s.emptyMark}>空</span>
      <p className="x-small">{text}</p>
      {hint ? <p className="x-tiny">{hint}</p> : null}
    </div>
  )
}
