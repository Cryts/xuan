# `omen` 奇遇通道契约（冻结）

> 签订：`narrative-designer`（出约）· `ux-designer`/`gameplay-designer`（会签中）· 主 AI（冻结）
> 2026-09-20。**字段名与语义不得再改** —— 内容侧已按此铺开（86 个奇遇事件，15.6%）。
> 用途：奇遇事件 + **商店**（用户裁决把商店改为奇遇事件）共用的调度通道。

## 一、字段（`LooseEvent` 上，全可选、全加法）

```jsonc
"channel": "omen",   // 缺省 'chain'。**链式事件不写这个字段**（能派生就不手写）
"omen_gap": 6        // 可选，缺省 6
```

## 二、引擎侧常量

| 常量 | 值 | 理由 |
|---|---|---|
| `OMEN_GAP_MIN` | 6 | 抽之前的全池下限；被抽中内容的 `omen_gap` 若更大，这一拍作废（保持每内容语义） |
| `OMEN_CHANCE` | 0.45 | **不能是 1** —— 否则"隔满六拍必来一次"成了节拍器，奇遇就不再是奇遇 |

`state` 新增：`nodes_since_omen: number`（每推进一拍 +1，含日常拍、斗法拍、剧本拍）、
`recent_omen: string[]`（存 key）。计数器在 **omen 被呈现给玩家的那一刻**归零（不是拒绝时）。

## 三、判定顺序（冻结）

```
1. forced = queue 中「未出过 且 node_index 在窗口内」的条目
   → 有则直接返回。**omen 在这里让路。**
     理由：铺垫排了队就必须走得完 —— 这是刚修过的一类 bug（破局率 0.73 → 1.11）
2. omen 判定
3. 常规阶梯（collect / relax / 加权抽样）
```

### 伪码（已按"不得造出空节点"修正并冻结）

```ts
/** 独立的判定函数：null 的含义**只在这里**是"这次不搞奇遇" */
function tryOmen(next: GameState, rng: Rng, content: ContentDB): LooseEvent | null {
  if (next.active_scenario || next.pending_scenario) return null
  if (next.pending_duel || next.pending_duel_result) return null
  if (isDailyNode(next)) return null
  if (next.nodes_since_omen < OMEN_GAP_MIN) return null
  if (!rng.chance(OMEN_CHANCE)) return null
  const key = pickOmenKey(next, rng, content)   // 奇遇事件 + 商店同池加权
  if (!key) return null
  if (next.nodes_since_omen < gapOf(key)) return null
  if (next.recent_omen.slice(-3).includes(key)) return null   // 同一内容三拍内不得重复（含"不得连任"）
  return lookupOmenEvent(key)
}

// pickNextEvent(next) 里：
const forced = /* 保底队列，原样 */
if (forced.length > 0) return forced[0]!
const omen = tryOmen(next, rng, content)
if (omen) return omen
// ↓ 落到常规阶梯（**绝不是 return null**）
```

**这一段被单独拎出来写，是因为原伪码的否定分支写成 `return null`，照抄进 `pickNextEvent` 会造出空节点**
（返回 null = 这一拍没有任何事件）。"空节点"是试玩 agent 最优先的卡死判据 —— 内容 agent 的原意没错，
错的是那段伪码会被 engine 侧当成 `pickNextEvent` 的片段读。

### 两条同样不许"顺手简化"的

1. **`omen_take` 之后那一屏走 `pickNextEvent` 之外的路径** —— 它呈现的是**已经抽中的那个内容本体**，
   不重新抽。否则玩家"接下了"，看到的却是另一件事。
2. **`recent_omen` 在"闸门呈现时"写入，不是"take 时"** —— 否则玩家连按两次"不接"就能刷出同一个内容。

## 四、让路规则（与已有先例同构）

| 情况 | omen |
|---|---|
| `active_scenario` 非空 | 不来（照抄 `duelTrigger` 的先例，engine.ts:1887） |
| `pending_scenario` 非空（入场屏：进不进） | 不来 |
| `pending_duel` / `pending_duel_result` 非空 | 不来 |
| `isDailyNode` 为真 | 不来（照抄 `presentCurrent` 里 `isDailyNode` 早返回排在 `duelTrigger` 之前） |
| 保底队列有强制事件 | **让路** |
| 斗法触发 | **斗法优先** |

`nodes_since_omen` 在这些情况下**照常 +1**，只是不做判定 —— 否则在剧本里蹲久了，
出来第一拍必是奇遇，反而成了可预期的节拍器。

## 五、"不绕过"的两条（必须实现，别省）

- **绕过** `cooldown.same_motif` / `cooldown.same_tag` / `stage` 过滤 —— 奇遇的本分就是"在不该来的时候来"
- **不绕过**：同一 key 不得连续两次成为 omen；同一 key 最近三拍内出现过就不再是 omen
  - 依据：试玩已在报 73 处母题紧邻重复（`playtest-findings.md` 第七节）。这个口子一开，那个数会立刻变三位数。

## 六、第一拍 = 「接不接」（呈现形态冻结）

- `NodePresentation.kind` 复用已存在的 `'encounter'`
- `options` 由**引擎合成两个**，内容侧不写、也不许写：`{id:'omen_take', text:'接下'}` / `{id:'omen_pass', text:'不接'}`
- `title` 用内容自己的（事件 = `title_pool`；商店 = 店名）。**"接不接"的语境由内容承担，不进选项文案** —— 这样商店与事件才共用同一套呈现
- `omen_take`：**不推进 `node_index`**，把真身作为**同一拍**的下一屏呈现（事件 = 自己的正文与选项；商店 = 货架）。玩家在真身里的那一次选择才推进节点
- `omen_pass`：推进一拍，写 `flags['omen_declined_' + key] = true`，**该 key 本局不再作为 omen 出现**
- 扩展位（现在不做，只留口子）：`omen_choices` 一次给三件让玩家挑

## 七、与玩法组的共同约束

**奇遇（含商店）不得按"当前剧本所需标签"抽取。** 奇遇要的是"随机撞上的东西"，
不是"正好是你缺的那件"。

- 叙事侧自证：选的六个奇遇母题（跨界规则 / 循环变量 / 双界真伪 / 界外低语 / 夺舍反杀 / 转世夺舍）
  全部是**"外来的规则闯进你的日子"**这一类，与任何剧本的破局条件无关 —— **选型时就卡死了**
- 玩法侧：商店货架同理。**商店变奇遇之后这条更重要** —— "随机撞上的正好是你缺的"是最假的随机

## 八、商店接入（2026-09-20 会签通过，替换原"同池加权"）

商店与奇遇事件**共用 `nodes_since_omen` 这一条闸**，但**分配方式改为显式轮转**，
不作同池加权竞争。

### 为什么不用同池竞争（两条理由，第二条更重要）

1. 实测：奇遇池 86 个、商店 1 个 → 商店被抽中概率约 **1.2%**，等于没有商店。
2. **同池竞争把商店的频率变成了内容量的函数** —— 今天 86 个奇遇把商店挤到 1.2%，
   明天内容加到 300 个，商店就是 0.3%。**商店会不会出现，取决于别人写了多少事件。**
   这种"由池子大小决定的频率"是结构性的脆弱，不该留在契约里。

### 定型

```
state.omen_turn: 'event' | 'shop'          // 缺省 'event'
state.omen_rotation: ['event','shop']      // 轮转表
```

- `omen_rotation` 实现成**数组而不是布尔翻转** —— 将来要加第三类奇遇（如游方术士）
  不用改 schema。当前只有两项。
- 每次 omen 闸门通过并**被呈现**，`omen_turn` 前进一格。
- **对称回落**（两侧都要有，只写单向会卡死）：
  - 轮到 `event` 但池中无合格奇遇（阶段/冷却/本局已弃过）→ 让给商店
  - 轮到 `shop` 但商店不可用（货架空/售罄/本局不该出现）→ 让给奇遇
  - **回落之后仍然前进一格**，否则会永远卡在不可用的那一方
- **gap 与 turn 的关系**：两者共用 `OMEN_GAP_MIN = 6`；
  **`shop` 可以有自己更高的 `omen_gap`** —— 轮到 shop 而 `nodes_since_omen < shop.gap` 时，
  **这一格让给 event**。这就是"要更多奇遇槽位就提高商店的 gap，不要降低奇遇的"的落地方式。
- **`OMEN_CHANCE = 0.45` 不变**：**交替管的是"轮到谁"，不管"什么时候来"。**
  时机仍然不规则，奇遇才还是奇遇。

**预期频率**：一局约 39 拍，gap 6 + 0.45 → 约每七到八拍一次闸门 → 一局约 5 次 omen →
轮流下来**商店 2~3 次、奇遇 2~3 次**，占全局节点约一成出头。

### 商店豁免 `omen_declined`（不是打补丁，是这条规则本来就不适用）

`omen_declined` 的理由只有一条：**同一件"事"反复来烦人**。这个理由在商店上两个前提都不成立：

1. **商店不是"同一件事"**：货架每次不同，它是**转换场所**不是遭遇
2. **拒绝的动机不同**：玩家拒绝商店多半是**当下买不起**，而"买不起"是会变的

**定型**：
- 商店的 key **不写入** `flags['omen_declined_*']`（**不是"写了但忽略"——别留两套读法**）
- 豁免不代表可以刷屏：**gap 与轮转照旧管着它**
- **奇遇事件保持原样**：declined 之后本局不再作为 omen 出现（奇遇是"事"，同一件事再来一次就是烦）

### 商店呈现（与 `daily` / `duel` 同构）

- `shop` 是**字段不是新 `kind`**：真身用 `kind:'loose'` + `shop?: ShopStock`
- 接不接拍用 `kind:'encounter'` —— 该值 `types.ts:680` 已声明但**全仓库零处使用**，是空保留位
- "真身里的那一次选择"对商店 = **「离开」**；买不推进节点（与 `useItem` 同构），离开才推进
  —— 保住了「进店耗一拍、店内可买任意多笔」

### ⚠️ 必须与商店引擎**同批交付**的一处

**`tools/playtest.ts` 的 `hasPanel()` 要加 `Boolean(p.shop)`。**
CLAUDE.md 登记过这个坑：漏加会让试玩 agent 把该节点当成空节点**强制跳过，而且不报错**
（今天早上真实发生过：4522 次误报、三百局没走过日常）。
