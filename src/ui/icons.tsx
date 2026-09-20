/**
 * 手写线性 SVG 图标 —— 不引任何图标库。
 *
 * 统一规格：24×24 viewBox、线性描边 1.3、currentColor。
 * 造型取向：简、瘦、留白；不用实心块，不用圆润卡通比例。
 */

import type { CSSProperties, ReactNode } from 'react'

export interface IconProps {
  size?: number
  className?: string
  style?: CSSProperties
  strokeWidth?: number
  title?: string
}

function Svg({
  size = 20,
  className,
  style,
  strokeWidth = 1.3,
  title,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

/* ---------- 境界：三重山影 ---------- */
export const IconRealm = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 18.5h18" />
    <path d="M5.5 18.5 10 11l2.6 4.2" />
    <path d="M13.2 18.5 16.6 13l2.9 5.5" />
    <path d="M8.6 18.5h6.9" />
  </Svg>
)

/* ---------- 修为：气环 ---------- */
export const IconPower = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.6" opacity="0.4" />
    <path d="M12 4.4a7.6 7.6 0 0 1 6.6 3.8" />
    <circle cx="12" cy="12" r="2.6" />
  </Svg>
)

/* ---------- 寿元：沙漏 ---------- */
export const IconLifespan = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3.5h10" />
    <path d="M7 20.5h10" />
    <path d="M8 3.5v3.2c0 2 4 3.7 4 5.3s-4 3.3-4 5.3v3.2" />
    <path d="M16 3.5v3.2c0 2-4 3.7-4 5.3s4 3.3 4 5.3v3.2" />
  </Svg>
)

/* ---------- 因果：结 ---------- */
export const IconKarma = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.2 7.4a4 4 0 0 0 0 5.6l1.9 1.9a4 4 0 0 0 5.6-5.6l-1-1" />
    <path d="M14.8 16.6a4 4 0 0 0 0-5.6l-1.9-1.9a4 4 0 0 0-5.6 5.6l1 1" />
  </Svg>
)

/* ---------- 心魔：裂心 ---------- */
export const IconDemon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20.2 4.9 13.4a4.3 4.3 0 0 1 6.1-6l1 1 1-1a4.3 4.3 0 0 1 6.1 6Z" />
    <path d="m11.4 8.4-1.6 3.1 2.6 1-1.7 3.4" />
  </Svg>
)

/* ---------- 图鉴：简册 ---------- */
export const IconCodex = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 4.2h11.2a1.6 1.6 0 0 1 1.6 1.6v14.1H7.1a1.6 1.6 0 0 1-1.6-1.6Z" />
    <path d="M8.4 4.2v15.7" />
    <path d="M11.2 8.6h4.6" />
    <path d="M11.2 12h4.6" />
  </Svg>
)

/* ---------- 轮回：旋环 ---------- */
export const IconRebirth = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.4 12a7.4 7.4 0 1 1-2.4-5.4" />
    <path d="M19.9 3.6v3.6h-3.6" />
    <circle cx="12" cy="12" r="2.2" />
  </Svg>
)

/* ---------- 天机榜：天眼 ---------- */
export const IconHeaven = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.6 12S6.4 6.4 12 6.4 21.4 12 21.4 12 17.6 17.6 12 17.6 2.6 12 2.6 12Z" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M12 2.4v1.8" />
    <path d="M12 19.8v1.8" />
  </Svg>
)

/* ---------- 行囊：囊袋 ---------- */
export const IconBag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.4 7.6 6.6 19.2a1.4 1.4 0 0 0 1.4 1.6h8a1.4 1.4 0 0 0 1.4-1.6L15.6 7.6Z" />
    <path d="M8.6 7.6a3.4 3.4 0 0 1 6.8 0" />
    <path d="M9.6 12.6h4.8" />
  </Svg>
)

/* ---------- 规则：令签 ---------- */
export const IconRule = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.6 3.6h14.8v16.8H4.6Z" />
    <path d="M9.4 7.4v9.2" />
    <path d="M14.6 7.4v5.4" />
  </Svg>
)

/* ---------- 风险：警示 ---------- */
export const IconRisk = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.4 21 19.6H3Z" />
    <path d="M12 9.4v4.6" />
    <path d="M12 17.1h.01" />
  </Svg>
)

/* ---------- 未解：锁 ---------- */
export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.4" y="10.4" width="13.2" height="9.4" rx="1.4" />
    <path d="M8.6 10.4V7.8a3.4 3.4 0 0 1 6.8 0v2.6" />
    <path d="M12 14.4v2" />
  </Svg>
)

/* ---------- 参透：灵光 ---------- */
export const IconSpark = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.2v4" />
    <path d="M12 16.8v4" />
    <path d="M3.2 12h4" />
    <path d="M16.8 12h4" />
    <path d="m6.2 6.2 2.4 2.4" />
    <path d="m15.4 15.4 2.4 2.4" />
    <path d="m17.8 6.2-2.4 2.4" />
    <path d="m8.6 15.4-2.4 2.4" />
  </Svg>
)

/* ---------- 结构 / 交互 ---------- */
export const IconBack = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.6 5.4 8 12l6.6 6.6" />
  </Svg>
)

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.2 6.2 17.8 17.8" />
    <path d="M17.8 6.2 6.2 17.8" />
  </Svg>
)

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.4 12.6 10 17l8.6-9.6" />
  </Svg>
)

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7.4h16" />
    <path d="M4 16.6h16" />
    <circle cx="9.4" cy="7.4" r="2" />
    <circle cx="15" cy="16.6" r="2" />
  </Svg>
)

export const IconSound = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.6 9.4h3L11.6 6v12l-4-3.4h-3Z" />
    <path d="M15 9.4a3.6 3.6 0 0 1 0 5.2" />
    <path d="M17.6 6.8a7.3 7.3 0 0 1 0 10.4" />
  </Svg>
)

export const IconMute = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.6 9.4h3L11.6 6v12l-4-3.4h-3Z" />
    <path d="m15.4 10 4 4" />
    <path d="m19.4 10-4 4" />
  </Svg>
)

export const IconMotion = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.4 14.6c2.6-6 5.2-6 7.8 0s5.2 6 7.8 0" />
    <path d="M3.4 9.2c2.6-6 5.2-6 7.8 0" />
  </Svg>
)

export const IconTextSize = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.4 18.4 7.6 6.6l4.2 11.8" />
    <path d="M4.8 14.6h5.6" />
    <path d="M14.4 18.4l3-8.4 3 8.4" />
    <path d="M15.5 15.6h3.8" />
  </Svg>
)

export const IconKey = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8.2" cy="15.6" r="3.6" />
    <path d="m10.9 12.9 7.5-7.5" />
    <path d="m16.4 7.4 2 2" />
    <path d="m14.2 9.6 2 2" />
  </Svg>
)

export const IconQuill = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.4 4.6c-6 .4-9.4 3-11 6.4-1 2.2-1.5 4.6-1.5 7" />
    <path d="M6.9 18c2.8.6 5.8-.6 7.4-2.6 1.9-2.4 2-5.4 1.9-7.4" />
    <path d="M4.6 19.4h4" />
  </Svg>
)

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.4 7.4h13.2" />
    <path d="M9.4 7.4V5.6a1.2 1.2 0 0 1 1.2-1.2h2.8a1.2 1.2 0 0 1 1.2 1.2v1.8" />
    <path d="M7.4 7.4l.9 11.4a1.4 1.4 0 0 0 1.4 1.3h4.6a1.4 1.4 0 0 0 1.4-1.3l.9-11.4" />
  </Svg>
)

export const IconScroll = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 4.6h11.2v14.8H6.4Z" />
    <path d="M9.4 8.4h5.2" />
    <path d="M9.4 12h5.2" />
    <path d="M9.4 15.6h3" />
  </Svg>
)
