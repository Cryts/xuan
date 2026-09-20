/**
 * 天机榜 —— 创新模块的界面。
 *
 * 这一屏只回答一个问题：**他现在还剩几次「主角不死」？**
 * 所以气运点列是整屏的视觉中心，其余信息都是它的注脚。
 * 谶语批注用竖排书法排版，刻意与数据区拉开气质。
 */

import s from './HeavenBoard.module.css'
import { Chip, Empty, Pips, SectionTitle, Sheet } from './Shared'
import { ARCHETYPE_DESC } from '@/core/destiny'
import type { HeavenBoardRow } from '@/core/engine'
import { IconHeaven, IconSpark } from '@/ui/icons'
import { useGame } from '@/ui/store'
import { powerTier, relationText } from '@/ui/text'

function Row({ r }: { r: HeavenBoardRow }) {
  const rel = relationText(r.relation)
  const worn = r.destiny_max - r.destiny_pool
  const fatePct = r.fate_total > 0 ? (r.fate_progress / r.fate_total) * 100 : 0

  return (
    <article className={`${s.row} ${r.alive ? '' : s.dead}`}>
      <header className={s.head}>
        <div className={s.who}>
          <h3 className={s.name}>{r.name}</h3>
          <span className="x-tiny">
            {r.packName} · {r.archetypeName}
          </span>
        </div>
        <div className={s.power}>
          <span className={s.powerNum}>{r.power_index}</span>
          <span className="x-tiny">{powerTier(r.power_index)}</span>
        </div>
      </header>

      {/* 气运条 —— 本屏的核心视觉 */}
      <div className={s.qiyun}>
        <div className={s.qiyunTop}>
          <span className={s.qiyunLabel}>气运</span>
          <span className={`${s.qiyunNum} x-num`}>
            {r.destiny_pool}
            <i>/</i>
            {r.destiny_max}
          </span>
          {worn > 0 ? <span className={s.worn}>已磨去 {worn}</span> : null}
          {!r.alive ? <Chip tone="cinnabar">已陨</Chip> : null}
        </div>
        <Pips filled={r.destiny_pool} total={r.destiny_max} size={12} />
        <p className={s.qiyunHint}>
          {r.destiny_pool === 0
            ? '气运见底 —— 巧合再也编不出来了，此刻下手，他真的会死。'
            : `还余 ${r.destiny_pool} 次「天意庇佑」；每一次都是一个看着像巧合的救场。`}
        </p>
      </div>

      {/* 命运线 */}
      <div className={s.fate}>
        <div className={s.fateTop}>
          <span className="x-tiny">命运线</span>
          <span className="x-tiny x-num">
            已走 {r.fate_progress} / {r.fate_total} 步
          </span>
        </div>
        <span className="x-bar" style={{ height: 2 }}>
          <span className="x-bar__fill" style={{ width: `${fatePct}%`, ['--accent' as string]: 'var(--gold)' }} />
        </span>
        <p className={s.fateNext}>
          下一步 · <b>{r.fate_next}</b>
        </p>
      </div>

      {/* 关系 / 抗性 */}
      <div className={s.meta}>
        <span className={s[`rel_${rel.tone}`]}>对你 · {rel.text}</span>
        {r.relation !== 0 ? <span className="x-tiny x-num">({r.relation > 0 ? '+' : ''}{r.relation})</span> : null}
        {r.resistances.length > 0 ? (
          <span className={s.resist}>
            已生抗性
            {r.resistances.map((x) => (
              <Chip key={x} tone="cinnabar">
                {x}
              </Chip>
            ))}
          </span>
        ) : null}
      </div>

      {/* 谶语 —— 竖排 */}
      <div className={s.oracle}>
        <span className={s.oracleTag}>谶</span>
        <p className="x-calli">{r.oracle_note}</p>
      </div>

      <p className={s.desc}>{ARCHETYPE_DESC[archKey(r.archetypeName)] ?? ''}</p>
    </article>
  )
}

/** 原型名 → key；内容层若改了名字则退回空 */
function archKey(name: string): keyof typeof ARCHETYPE_DESC {
  const hit = (Object.keys(ARCHETYPE_DESC) as Array<keyof typeof ARCHETYPE_DESC>).find(
    (k) => ARCHETYPE_DESC[k] === name,
  )
  return hit ?? 'brute'
}

export function HeavenBoard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { heaven } = useGame()
  const alive = heaven.filter((h) => h.alive).length

  return (
    <Sheet
      open={open}
      title="天 机 榜"
      hint={heaven.length === 0 ? '榜上无人' : `${alive} 位在世 · 共 ${heaven.length} 人`}
      onClose={onClose}
    >
      <div className={s.intro}>
        <IconHeaven size={16} />
        <p className="x-small">
          他们不是站着等你触发的 NPC。你每走一步，他们也走一步 —— 你不去动他，他也会越来越强。
        </p>
      </div>

      {heaven.length === 0 ? (
        <Empty text="此世榜上无名。" hint="未生成位面之子：本局无天命可猎。" />
      ) : (
        <div className={s.list}>
          {heaven.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </div>
      )}

      <div className={s.foot}>
        <SectionTitle icon={<IconSpark size={15} />} text="怎么用这张榜" tone="gold" />
        <ul className={s.tips}>
          <li>气运未尽时动他，多半会被一个「合理的巧合」救走 —— 只是白费力气，还结下因果。</li>
          <li>先磨气运：每次对抗都会扣池子。池子见底，才是真正下杀手的时刻。</li>
          <li>智谋型会读你的牌：同一手段用两次，第二次他带着抗性来。</li>
          <li>杀了他，他的一切归你 —— 包括他的仇家。</li>
        </ul>
      </div>
    </Sheet>
  )
}
