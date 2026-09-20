/**
 * 坊市面板 —— 奇遇通道的第二个 turn。
 *
 * 三条形态约束，都出自冻结的 `omen` 契约与玩法组方案：
 *
 * 1. **买不推进节点，离开才推进。** 与「吃药不该花掉一段年月」同构
 *    （`useItem`），保住"进店耗一拍、店内可买任意多笔"。
 * 2. **限购与涨价必须写在脸上。** 限购是"这种来路不明的东西，掌柜一次只出手两件"，
 *    涨价是"你买得越多，他开价越高"。玩家看不见就会以为是 bug ——
 *    **提示必须与行为对得上**。
 * 3. **货架不由你当前缺什么决定。** 所以这里不显示"你在剧本里可能需要什么"，
 *    也不排序 —— 摊上有什么就是什么。那是奇遇感的地基。
 */

import s from './ShopPanel.module.css'
import { Seal } from './Shared'
import { useGame, SHOP_LEAVE, SHOP_SELL_PREFIX } from '@/ui/store'
import { classifyItem } from '@/core/items'

export function ShopPanel() {
  const { st, dispatch } = useGame()
  const stock = st.pres?.shop
  if (!stock) return null

  const currency = st.state?.vars.currency ?? 0
  // 能卖出去的：剧情物品（key / both）。纯日常用物掌柜不收 ——
  // 那不是刁难，是堵死"日常消耗品 → 灵石"这条 faucet。
  const sellable = (st.state?.items ?? []).filter((i) => classifyItem(i) !== 'daily')

  return (
    <section className={s.panel}>
      <div className={s.head}>
        <span className={s.mark} aria-hidden>
          市
        </span>
        <span className={s.headText}>摊上摆着这些</span>
        <span className={s.purse}>
          囊中 <b className="x-num">{Math.round(currency)}</b>
        </span>
      </div>

      <ul className={s.shelf}>
        {stock.items.map(({ item, price, stock: left }) => {
          const sold = left <= 0
          const afford = !sold && currency >= price
          const blocked = stock.bought_here >= 2 && !sold
          return (
            <li key={item.id} className={s.row} data-out={sold ? '1' : '0'}>
              <span className={s.name}>{item.name}</span>
              <span className={s.quality}>{item.quality}</span>
              <span className={s.desc}>{item.desc ?? ''}</span>
              <span className={s.price}>
                {sold ? '已售' : <b className="x-num">{price}</b>}
              </span>
              <button
                type="button"
                className={s.buy}
                disabled={!afford || blocked}
                title={
                  sold
                    ? '这一件已经卖掉了'
                    : blocked
                      ? '掌柜一次只出手两件 —— 出了这个门再来'
                      : afford
                        ? undefined
                        : '灵石不够'
                }
                onClick={() => dispatch({ type: 'play/option', optionId: item.id })}
              >
                买
              </button>
            </li>
          )
        })}
      </ul>

      {stock.items.length === 0 ? <p className={s.empty}>摊上是空的。</p> : null}

      {sellable.length > 0 ? (
        <div className={s.sellBox}>
          <span className={s.sellHint}>不要的，他可以折价收</span>
          <div className={s.sellRow}>
            {sellable.slice(0, 8).map((i) => (
              <button
                key={i.id}
                type="button"
                className={s.sellBtn}
                onClick={() => dispatch({ type: 'play/option', optionId: `${SHOP_SELL_PREFIX}${i.id}` })}
              >
                卖 · {i.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={s.foot}>
        <Seal text="去" tone="plain" />
        <button
          type="button"
          className={s.leave}
          onClick={() => dispatch({ type: 'play/option', optionId: SHOP_LEAVE })}
        >
          离开
        </button>
        <span className={s.footHint}>买了也还站在这儿；走出去，这一程才算过。</span>
      </div>
    </section>
  )
}
