# 「命数」与天命榜 —— 六体系寿命尺度的统一方案

> 作者：`worldbuilder`（世界观与体系策划） · 2026-09-20
> 状态：**方案，未实施。** 本轮只出方案与依据，不动任何代码与内容。
> 归属：设定自洽归我；**阈值标定与平衡复核归 `systems-designer`**；呈现归 `ux-designer`。

---

## 【判断】

**用户的方向对了一半：榜单要做，但榜单不是解药 —— 缺的是记账单位。**

现状不是"六个体系的寿命增减效果不一样"这么轻。实测下来是三层缺陷，
从下往上：

| | 缺陷 | 一句话 |
|---|---|---|
| **D1** | **时钟与寿元是两把尺子** | `yearsPerNode` 按**绝对序号**线性（`2 + realm_idx×4`），`realm.lifespan` 按**各包自己的指数**（每层 ×1.33~×2.0）。同一 `power_index` 下，"本境还能走几拍"六个包相差 **8.5 倍**。 |
| **D2** | **折损是绝对年数** | 事件里的 `lifespan: -5` 在境 1 值本境寿元的 4~5%，在境 9 值 0.02%~0.57%（**28 倍差**）；到了"不限寿元"的层级，全库 435 条折寿效果**完全空转**。 |
| **D3** | **结局门槛按一把不存在的尺子写** | 7 个结局带 `lifespan` 门槛，其中 4 个（`>=60/200/250/400`）在 1200 局里达成率 **0.0%**。**整个「苟道长寿」结局类永远拿不到** —— 名字就叫"活得比他们都久"的结局，靠活得久拿不到。 |

D3 是**已经在流血的伤口**，D1 是**结构病**。榜单（=展示层）能治的是"玩家看得见"，
治不了任何一条。**先换单位，再画榜。**

用经济学的词：本项目缺的是一个 **numéraire（记账单位）**。
`power_index` 已经是"修为"的记账单位（铁律：统一数值骨架），但**"寿命"没有**。
「天命榜」应当是这张单位的面板，不是它的替代品。

---

## 【实测】六体系 × 层数 × 寿命上限

固定种子脚本：`/tmp/wb_ratio.py`、`/tmp/wb_measure.ts`、`/tmp/wb_lifespan_dist.ts`。

### 表 1 · 六张表的原始尺度

| 包 | 文件 | 层数 | 起步寿元 | 上限寿元 | **增长倍率** | 首个不限寿元的层 |
|---|---|---|---|---|---|---|
| 青冥仙途 `mortal` | `src/content/packs/mortal.json` | **13** | 80 | **25600** | **×320** | idx 10 |
| 苟道长生 `cautious` | `src/content/packs/cautious.json` | **13** | 80 | 9000 | ×112.5 | idx 10 |
| 逆天问道 `rebel` | `src/content/packs/rebel.json` | **18** | 70 | 6500 | ×92.9 | idx 17 |
| 太古遗蜕 `physique` | `src/content/packs/physique.json` | **18** | 70 | 6000 | ×85.7 | idx 17 |
| 炎武纪元 `genius` | `src/content/packs/genius.json` | **12** | 80 | 5000 | ×62.5 | idx 10 |
| 灰雾之秘 `mystery` | `src/content/packs/mystery.json` | **10** | 70 | **2200** | **×31.4** | idx 9 |

> 上限差 **11.6 倍**（25600 / 2200），增长倍率差 **10.2 倍**（320 / 31.4）。
> 也就是说：**同一个"修到顶"，青冥的人比灰雾的人多活 23400 年。**

### 表 2 · 真正的病根 ——「每拍烧掉多少寿元」

`yearsPerNode = 2 + realm_idx × 4`（`src/core/engine.ts:222`）**只看绝对序号**，
各包阶梯长度不同 → 时钟上限不同（短阶梯 38 年/拍封顶，长阶梯 70 年/拍）。

于是"本境寿元 ÷ 每拍年数 = **本境可走的拍数**"这个玩家真正花掉的量，六包完全对不齐：

| `power_index` | 青冥 | 苟道 | 炎武 | 太古 | 灰雾 | 逆天 | 极差 |
|---|---|---|---|---|---|---|---|
| 50 | 20 拍 | 29 拍 | 17 拍 | 13 拍 | 18 拍 | 14 拍 | 2.2× |
| 200 | 73 | 77 | 38 | 23 | 22 | 26 | 3.5× |
| 300 | 213 | 107 | 60 | 26 | 27 | 31 | **8.2×** |
| 450 | 376 | 237 | 132 | **44** | 47 | 54 | **8.5×** |

**结论：同样是"点一下选项过一拍"，太古遗蜕的修士要付出青冥修士 8.5 倍的寿命。**
六个人坐在同一张桌子上做同样多的决定，其中四个会先老死 —— 而这件事在界面上一个字都没写。

### 表 3 · 同一笔折损在各体系里值多少

事件里 `lifespan` 取值 −30…+20，**中位 ±2..6**。以最常见的 ±5 为例：

| 境 idx | 青冥 | 炎武 | 太古 | 灰雾 | 逆天 | 苟道 |
|---|---|---|---|---|---|---|
| 1 | 4.17% | 4.55% | 5.00% | 4.55% | 5.00% | 3.85% |
| 3 | 1.25% | 2.08% | 2.94% | 1.92% | 2.63% | 1.25% |
| 5 | 0.31% | 0.83% | 1.67% | 0.83% | 1.43% | 0.42% |
| 7 | 0.08% | 0.28% | 0.96% | 0.36% | 0.83% | 0.16% |
| 9 | **0.02%** | 0.10% | **0.57%** | — | 0.50% | 0.06% |
| 16 | — | — | 0.08% | — | 0.08% | — |

低境界还算齐（约 1.2 倍差），**越往上越离谱，境 9 差 28 倍**。
而到了 `lifespan: null` 的层级，`lifespanCapOf` 返回 `UNBOUNDED_LIFESPAN = 999999`
（`src/core/engine.ts:207,230`），此后**任何折寿都是加法噪声** ——
435 条负效果、总和 −1622 年，在高境界这一段**全部是死内容**。

### 表 4 · 实测死亡原因（"随便玩"策略，固定种子）

| 包 | 寿尽 | 节点走完 | 存活 |
|---|---|---|---|
| 青冥仙途 | **0.0%** | 65.0% | 35.0% |
| 炎武纪元 | **0.0%** | 75.0% | 25.0% |
| 太古遗蜕 | **0.0%** | 69.0% | 31.0% |
| **灰雾之秘** | **11.5%** | 51.0% | 37.5% |
| 逆天问道 | **0.0%** | 24.5% | 75.5% |
| 苟道长生 | **0.0%** | 42.5% | 57.5% |

每包 200 局（1200 局总计）。0/200 的 95% 上界约 1.5%，11.5% ± 2.3%（1σ）——
**差距远在噪声之外**。同一份引擎、同一份内容，只因为抽到灰雾之秘，
老死率从 0% 变成 11.5%。

> 口径说明：这是"随机选分支"的策略，不是真人；真人突破更快、死得更少。
> 但这条结论不依赖策略：**差异完全由选包造成**，与打法无关。

### 表 5 · 结局的 `lifespan` 门槛是死内容（D3 的实证）

`src/content/endings.json` 里 7 个结局用 `lifespan` 做门槛：

| idx | 结局 id | 类别 | 门槛 |
|---|---|---|---|
| 10 | `end_seclude_vegetable_rows` | 隐居 | `>= 200` |
| 51 | `end_turtle_outlived_them_all` | **苟道长寿** | `>= 400` |
| 53 | `end_turtle_last_disciple` | **苟道长寿** | `>= 250` |
| 55 | `end_mortal_back_to_village` | 凡尘终老 | `>= 20` |
| 62 | `end_egg_same_face_again` | 特殊彩蛋 | `>= 60` |
| 17 | `end_fall_sitting_in_calm` | 道陨 | `<= 3` |
| 40 | `end_martyr_for_another` | 以身殉道 | `<= 5` |

1200 局实测终局 `vars.lifespan`：**中位 0，最大 37，均值 1.7**。

| 门槛 | 达成率 |
|---|---|
| `>= 60` | **0.0%** |
| `>= 200` | **0.0%** |
| `>= 250` | **0.0%** |
| `>= 400` | **0.0%** |

全库 **142 条延寿效果、总和只有 +376 年**，而且玩家一局只能吃到其中一小部分；
`>= 400` 这个门槛**即使吃满全库延寿也够不到**。
`clampVar('lifespan') = Math.max(0, v)`（`src/core/resolve.ts:167`）
还会让折寿先吃掉延寿，所以半数玩家的这个值恒为 0。

**⇒ 「苟道长寿」这一整个结局类（`end_turtle_*`）是不可达的死内容。**
这和上一轮 `realm_idx >= 9` 是**同一个错误的第二次发作**：
拿一个看似通用的数当门槛，而它在各包里含义不同、在量纲上还差两个数量级。

---

## 【核实】还有哪些地方仍在用绝对序号

`grep -rn "realm_idx" src/ src/content/`（已剔除 `realm_top` 相关），逐条核过语义：

### 高危 —— 与寿命 / 跨体系显示直接相关

| # | 位置 | 用法 | 后果 |
|---|---|---|---|
| 1 | `src/core/engine.ts:222` | `yearsPerNode = 2 + realm_idx*4` | 表 2 的病根。**D1 本体** |
| 2 | `src/core/engine.ts:374` | `cultivateGain` 的 `1 + realm_idx*0.2` | 同 `power_index` 下，18 层包修炼速度是 10 层包的 **4.6× vs 2.8×（+64%）** → **长阶梯包系统性更强**，这是跨体系支配性 |
| 3 | `src/core/engine.ts:465` | `healPerNode` 的 `1 + realm_idx*0.15` | 同上，3.55× vs 2.35× |
| 4 | `src/core/engine.ts:1817` | `rollOpponent`：`packs[packId].realms[state.realm_idx]` | **拿玩家的绝对序号去查别人的包**。青冥大罗（idx 12）遇灰雾之秘对手 → `realms[12]` 越界 → 显示「不明」；反向（灰雾 idx 5 遇太古）→ 显示太古第 6 层（28%），而对手实际在 56% |
| 5 | `src/core/engine.ts:1798` | `rollOpponent`：`realms[min(d.fate_progress, …)]` | **拿命线步数当境界序号**。`fate_progress` 只有 0–4，所以一个 `power_index` 600 的位面之子会显示成第二境 |
| 6 | `src/core/destiny.ts:121` + `:150` | `realm_name` 只在生成时写一次，`advanceFate` 只改 `power_index` | **位面之子的境界名永久冻结在开局**。榜上所有人永远停在"第二境" —— 这是"不同体系之子不可比"的**直接原因** |

> #5 #6 合起来就是用户说的"不同体系之子的问题"：位面之子**没有年龄、没有寿元、境界名冻结**，
> 唯有一个 `power_index` 是真的。所以现在这张榜能比的只有战力一项。

### 中危 —— 埋着的雷（当前是死字段，但会被复制）

| # | 位置 | 用法 | 后果 |
|---|---|---|---|
| 7 | `src/content/packs/physique.json:337` | `fail_modes[].trigger = "exposure>=60 && realm_idx>=8"` | 18 层包里 idx 8 = **44%**，是想说"过半"还是"登顶"？**且 `fail_modes` 目前是死字段**（`src/ui/store.ts:415` 直接置 `[]`，无任何读取点）→ 谁实现它谁踩坑 |
| 8 | `src/content/endings.json` × 5 | `rating.stars_rule` 里的 `realm_idx/2`、`realm_idx/4`（idx 17/40/52/63/…） | **死字段**：`computeStars` 完全忽略 ending（`src/core/engine.ts:2760` 有 `void ending`）。若将来实现，会原样复刻 `realm_idx>=9` |
| 9 | `src/content/endings.json` × 3 | `end_mortal_small_shop` / `end_mortal_back_to_village` / `end_mortal_school_teacher` 的 `realm_idx <= 3/2/3` | **方向相反但同类错**：`<=` 在长阶梯包更**难**（青冥 ≤3/12=25%，太古 ≤3/17=18%）。「凡尘终老」在 18 层的包里更难拿到，纯属意外 |

### 无问题（已核对）

- `src/ui/components/StatusBar.tsx:216` `第 {realm_idx+1}/{realmTotal} 境` —— **给了分母**，是对的
- `src/core/engine.ts:301` `realmUp = last_realm_idx < realm_idx` —— 同包内自比，无问题
- `src/core/engine.ts:2664-2672` `fitScore` 的 `realm_top` 分支 —— 已按相对位置，且硬门槛 `0.02` 是对的
- 6 个飞升/苟道结局的 `realm_top: 4 / 6` —— 上一轮的修法正确

### 门禁缺口（**这是 #7 #9 漏网的原因**）

`tools/content-lint.ts:780-802` 的 `realm_index_absolute`：

```ts
for (const e of c.endings as {...}[]) harvestRealmIdx(e.requires, realmIdxInEndings)
```

只扫 **`endings[].requires`** 一处，且 `harvestRealmIdx` 只收 `op === '>=' || op === '>'`
（`:784`），所以：

1. **不扫 `scenarios[].requires`** —— 剧本门槛漏网
2. **不扫 `packs[].fail_modes[].trigger`** —— #7 漏网（虽然是字符串表达式，但可正则提取）
3. **不看 `<=` 方向** —— #9 漏网
4. **不管代码里的 `realm_idx`** —— #2 #3 #4 #5 漏网

**加功能必须同时加闸门**（CLAUDE.md 工程纪律）。本方案的每一条改动都要配一条门禁。

---

## 【方案】换单位：从「年」换成「拍」

### 一、核心洞察

> **年在不同体系里不可比；「拍」（= 一次抉择 = 一个节点）天生可比。**

因为六体系共用同一个时钟的**消费侧**：1 选项 = 1 节点 = 1 拍。
玩家真正花掉的不是年，是拍。而 `power_index`（0–1000）已经是六体系共用的**产出侧**骨架。

**年不可比这一点古人早就说透了。**《庄子·逍遥游》：

> 小知不及大知，**小年不及大年**。奚以知其然也？朝菌不知晦朔，蟪蛄不知春秋，此小年也。
> 楚之南有冥灵者，以五百岁为春，五百岁为秋；上古有大椿者，以八千岁为春，八千岁为秋。

一个世界里并存着 500 倍差的时间尺度（冥灵的一春 = 500 年，大椿的一春 = 8000 年）——
**它自洽的前提是：叙述各自的"春秋"，比较时换算到同一个"春秋"。**
本项目现在缺的就是后半句。

现实里的成熟做法也是一样的：地质年代学用 **Ma（百万年）** 做统一记账单位，
而各套地层仍按各自的岩性描述。**统一的是单位，不是数值。**

### 二、统一曲线：时钟与寿元必须是同一条曲线的两个刻度

```ts
// src/core/engine.ts —— 新增。全部由 power_index 派生（统一数值骨架）
/**
 * 跨体系统一的寿元基准：该修为"应该"活到多少岁。
 * 单调递增；pi >= 顶阶起点时返回 null = 不限寿元。
 */
export function baseLifespanAt(power_index: number): number | null

/** 跨体系同一条时钟：每拍年数。**不再看 realm_idx**。 */
export function yearsPerNodeAt(power_index: number): number
```

**关键约束（自洽性论证的核心）**：时钟与寿元必须是同一条曲线的两个刻度，
否则又回到 D1。取一个跨体系常量 `MOVES_PER_LIFE`：

```
yearsPerNodeAt(pi) = baseLifespanAt(pi) / MOVES_PER_LIFE
MOVES_PER_LIFE    = 60        // 常量，六体系同一个数
```

于是：

```
余拍(任何体系、任何境界) = (寿元上限 − 年龄) / 每拍年数
                        ≈ MOVES_PER_LIFE × (1 − 年龄/寿元上限)
```

**六体系在同一 `power_index` 下的余拍被这个构造强制拉齐**（表 2 的 8.5 倍差归零）。
高境界"一次闭关几十年上百年"的手感保留（曲线单调升到约 70 年/拍），
而"停在低境界会老死"这条凡人流的恐怖也保留 —— 且**对六个包是同一件事**。

### 三、体系差异归到一处：`lifespan_bias`

体系之间的差别**不藏在曲线形状里**，而是**一个显式的、可排序的倍率**：

```jsonc
// src/content/packs/*.json —— 每包加一行（**不用重写 realms 表**）
"lifespan_bias": 1.0
```

```ts
// engine.ts
export function lifespanCapOf(state: GameState, content: ContentDB): number {
  const pack = content.packs[state.pack_id]
  const bias = pack?.lifespan_bias ?? 1.0          // 缺省必须容错，见边界 B2
  const base = baseLifespanAt(state.power_index)
  if (base === null) return UNBOUNDED_LIFESPAN
  const rated = base * bias * (1 + (state.vars.lifespan ?? 0) / 100)
  return Math.max(1, Math.round(rated))
}
```

**这就是"体系之子"的可比标尺**：不是 `25600 年 vs 2200 年`（两个不可通约的数），
而是**「寿数 1.6 倍」**（一个可排序、可说出口、可以写进榜里的差）。

**建议的初始偏性（可从现有表反推，不新拍脑袋）**：

| 包 | 本体 | 建议 `bias` | 叙述依据 |
|---|---|---|---|
| 苟道长生 `cautious` | **势** | **1.6** | 「苟道」二字的字面意思就是活得久；也补上"势不入相性环"的设定空洞 |
| 逆天问道 `rebel` | 意 | 1.2 | 以意志抗天，命硬 |
| 太古遗蜕 `physique` | 体 | 1.1 | 换皮换骨、遗蜕续命 |
| 青冥仙途 `mortal` | 气 | **1.0（基准）** | 凡人流，不偏不倚 |
| 炎武纪元 `genius` | 气 | 0.8 | 以肉身换烈度，燃得快 |
| 灰雾之秘 `mystery` | 灵 | 0.7 | 灵体离身、以替身/扮演存世，把命押在别处 |

> 反推公式：`bias_p = 该包顶层寿元 ÷ baseLifespanAt(1000)`。
> **用反推而不是新写**，六个包的相对关系不变，玩家的既有认知不用重建。

### 四、折损/延寿的归一：`lifespan` 从「年」改为「命数」

```
命数 1 点 = 本境寿元基准的 1%
```

- 事件里的 `lifespan: -5` **字面不动**，含义变成"折你本境寿元的 5%"。
- **587 条内容一条都不用改**（实测：577 条 `add_var lifespan` 效果，取值 −30…+20，中位 ±2..6）。
- 校准：在比例语义下折损落在 0.02%~30%，正是"一次天劫折你几十分之一寿"该有的量级。
- **顺带修掉两个死结**：
  (a) 高境界下折寿不再是空转，435 条负效果**全部复活**；
  (b) 凡人与真仙面对同一个天劫，代价是**同一个比例** —— 这才叫天道的公平。
      绝对年数模型下，同一个天劫对凡人是死刑、对真仙是零，那才是设定上的不自洽。

命名：`src/content/terms/physique.json` 的 `UI_LIFESPAN` **已经在用「寿数 / 命数」**。
沿用「命数」不引入新词。

### 五、结局门槛重标定（D3 的止血）

7 个 `lifespan` 门槛从「年」改「命数」，按实测分布（中位 0 / 最大 37 / 均值 1.7）÷10 取量级：

| 结局 | 现值 | 建议量级 | 依据 |
|---|---|---|---|
| `end_turtle_outlived_them_all` | `>= 400` | **`>= 40`** | "吃得极厚"档 |
| `end_turtle_last_disciple` | `>= 250` | **`>= 25`** | 中档 |
| `end_seclude_vegetable_rows` | `>= 200` | **`>= 20`** | 与苟道档拉开 |
| `end_egg_same_face_again` | `>= 60` | **`>= 8`** | 彩蛋档 |
| `end_mortal_back_to_village` | `>= 20` | **`>= 2`** | 低档 |
| `end_fall_sitting_in_calm` | `<= 3` | `<= 3` | 负向门槛，量级不变 |
| `end_martyr_for_another` | `<= 5` | `<= 5` | 同上 |

> ⚠️ 上表给的是**量级（÷10），不是终值**。终值必须由 `systems-designer` 用 2400 局复标
> （400 局时支配性比值 ±6%，读不出 1 个点的差 —— 见 CLAUDE.md 门禁阈值纪律）。

### 六、天命榜：它是什么、显示什么

**命名建议**：

- **`天机榜` 保留**（已有 UI / SPEC / 测试三处依赖：`src/ui/components/HeavenBoard.tsx`、
  `docs/superpowers/specs/2026-09-20-xuan-design.md:303`、`src/ui/screens.test.tsx:88`）。
  它回答的问题是"**他还能被杀死几次**"（气运）。
- **`命数栏`（用户说的「天命榜」）单独一栏**，回答"**他还能活多久 / 还能走几拍**"（寿元）。
  两问分栏，不污染现有的气运视觉中心。

**它是什么**：跨体系的**命数名录** —— 把玩家与每一位位面之子放在**同一把尺子**上排序。
这是本项目的 numéraire 面板。

**字段形状**（扩展 `src/core/engine.ts:2768` 的 `HeavenBoardRow`）：

```ts
export interface FateRow {
  id: string                    // 玩家本人用 '@me'
  name: string
  pack: PackId
  packName: string
  power_index: number           // 0–1000，跨体系唯一标尺（**已有**）
  realm_label: string           // 实时投影，与 progressNameOf 同源 —— **不再冻结**
  realm_rel: number             // 0–1，在**自身体系**阶梯上的相对位置（替代"第 N 境"）
  lifespan_bias: number         // 体系寿数偏性（**新**）
  lifespan_cap: number | null   // 该修为该活到多少岁；null = 不限（**新**）
  age: number | null            // 位面之子需要年龄（**新**）
  moves_left: number | null     // **余拍** —— 榜上真正可比的那一列（**新**）
  moves_tier: '灯将尽' | '日暮' | '方长' | '绵长' | '不尽'   // 派生，见下
  fate_progress: number; fate_total: number       // 已有
  destiny_pool: number; destiny_max: number       // 已有
  relation: number; alive: boolean                // 已有
  oracle_note: string                             // 已有
}
```

**`moves_tier` 必须由 `moves_left` 派生**（铁律：能派生就不要手写）：

```ts
const MOVES_TIER = (m: number | null) =>
  m === null  ? '不尽' :
  m < 3       ? '灯将尽' :
  m < 8       ? '日暮' :
  m < 20      ? '方长' :
  m < 40      ? '绵长' : '不尽'
```

**显示什么（一行的样子）**。取 `power_index = 200`、两人同龄（这是表 2 里真实的一对）：

```
你     青冥仙途 · 化神 · 第 6/13 境（42%）
       修为 200 · 寿元 1600 年 · 每拍 22 年 · 余拍 73 · 绵长

沈砚   灰雾之秘 · 阶位五品 · 第 5/10 境（44%）
       修为 200 · 寿元  400 年 · 每拍 18 年 · 余拍 22 · 方长
```

**现在的读法（破的）**：两人的修为、进度**几乎一样**（42% vs 44%），
但一个还能走 73 拍、一个只剩 22 拍 —— **而且榜上没有任何东西解释这 3.3 倍差从哪来**。
它来自"灰雾之秘的寿元曲线长得慢"这件玩家看不见的事。这是**最不该让玩家困惑的那种困惑**。

**改完之后的读法（对的）**：余拍被统一曲线拉齐（两人都约 56 拍），
差额**变成一个写得出口的数**——

```
你     青冥仙途 · 化神        修为 200 · 寿数 ×1.0 · 余拍 56 · 绵长
沈砚   灰雾之秘 · 阶位五品    修为 200 · 寿数 ×0.7 · 余拍 38 · 方长
```

（两者同龄，走同一条 `power_index` 轨迹，所以年龄与每拍年数都相同，
差额纯粹来自偏性：`余拍_m − 余拍_y = MOVES_PER_LIFE × (1 − bias) = 60 × 0.3 = 18 拍`。）

**「他的体系命薄，七成 —— 少走十八拍。」**
同样是差距，一个是谜，一个是可规划的信息。而且这个换算**是恒等式，不是估算**：
**体系偏性直接折算成"少走几拍"**，玩家可以自己心算。

### 七、怎么参与玩法（不然就只是块表）

1. **位面之子真的有了寿元**。给 `DestinyChild`（`src/core/types.ts:307`）加 `age` 与 `lifespan`，
   初值按各自包的 `lifespan_bias` 抽；`advanceFate`（`src/core/destiny.ts:150`）里用
   **同一个 `yearsPerNodeAt`** 老化 —— 两套时钟是绝对禁止的。
2. **「熬死他」成为第三条杀主角的路**。现有两条是「磨光气运」与「跨界论道习得克制规则」，
   再加一条：**寿数压过他**。
   气运是"他躲得掉"，寿元是"**他躲不掉**"。这直接解掉"位面之子与主线无关"这个已登记缺陷。
3. **天命榜给出可规划的时间表**：榜上直接写"他还有 4 拍"，
   玩家就知道"我只要活着走出这 4 拍，天命自落" —— 这是**可规划的**长线目标，
   而不是"再打他一次试试看"。
4. **它和相性环正交**：相性环（气→体→灵→则→意→气）管"**打不打得过**"，
   命数管"**熬不熬得过**"。而且"**势**不入环"这个空洞被补上了 ——
   苟道（势）在环上没有位置，**在命数榜上排第一**。
5. **为 20+ 扩容留位**：`lifespan_bias` 是标量，新包只需给自己一个数，不碰任何代码。

### 八、我否决的方案（供主 AI 与用户裁决时对照）

| 方案 | 否决理由 |
|---|---|
| **把六个包的寿元表改成同一张** | 六个体系在"寿命"这一维彻底同质，「苟道长生」这个包名就名不副实。**要统一的是刻度，不是数值。** |
| **让 `yearsPerNode` 也按包变** | 时间是世界公共量，一个位面不能有两套物理。这正是 D1 的病根，不能加码。 |
| **榜单直接排绝对年数** | `25600 vs 2200` 排出来的名次，玩家无法判断"这跟我有什么关系"。**这是 `realm_idx >= 9` 的同构版本** —— 拿一个看似通用的数，掩盖它在各包里含义不同。用户提议的「天命榜」如果只是把绝对年数排一排，就是**给不存在的统一性画了一张漂亮的图**。 |
| **只改结局门槛，不动引擎** | 只治 D3。D1/D2 会让下一次加内容时重新长出一模一样的坑。 |

---

## 【自洽性论证】

### 为什么这套设定下六个体系还说得通

1. **年还是年。** 世界只有一个，`yearsPerNodeAt(pi)` 是跨体系同一条曲线 ——
   修掉了"同一个世界里两套时钟"这个硬伤。高境界一次闭关几十年上百年的手感保留。
2. **六体系的差别被归到一处**：`lifespan_bias` 一个标量，且**可叙述**（见表）；
   它同时给出了「势」在相性环外的位置。
3. **折损变成比例之后，"天劫折寿"才真的是天劫** —— 对凡人和对真仙都是"折你几分之一"。
4. **叙述用年，比较用拍。** 界内叙述各体系寿元的差别（"冥灵以五百岁为春"），
   跨体系比较时一律换算到命数/余拍 —— 这是《庄子》"小年大年"那条线的落地，
   也是地质年代学的做法（用 Ma 统一表述，各套地层仍按各自岩性描述）。

### 边界情况（每一条都必须显式处理，否则又是静默失效）

| | 情况 | 处理 |
|---|---|---|
| **B1** | **不限寿元**（顶层 `lifespan: null`） | `baseLifespanAt` 返回 `null`，`moves_left = null`，`moves_tier = '不尽'`。**`UNBOUNDED_LIFESPAN = 999999` 这个哨兵必须保留**给 `ageInfoOf.unbounded` 用（`src/core/engine.ts:207,254`），别让 `null` 漏进 UI —— 现有 `StatusBar` 靠 `life.unbounded` 分支是**对的**，改动别把这个分支拆了 |
| **B2** | **`lifespan_bias` 缺省** | 必须默认 `1.0`。**同时加门禁**：内容包里缺这一字段报 warn —— 20+ 扩容时静默走基准是最容易发生的静默失效 |
| **B3** | **位面之子与玩家同包** | `generateDestinyChildren`（`src/core/destiny.ts:93`）已保证不同包，但 `advanceFate` 只推 `power_index`。加 age 后**必须走同一个 `yearsPerNodeAt`**，否则又是两套时钟 |
| **B4** | **折损钳在 ≥0** | `clampVar('lifespan')`（`src/core/resolve.ts:167`）会让"先延寿后折寿"的净额被吃掉。比例语义下这个钳制仍合理（**命数不为负**），但必须在提示文案里写清：**+20 命数再 −30 命数 = 0，不是 −10**。这是"命数"，不是"负债" |
| **B5** | **折损跨境界** | 比例语义下折损在**施加时**按当时基准折算；之后突破大境界，折损的绝对年数随之放大。这是**有意的**（伤了根基，越往上越显），但要在提示里说清，否则又是"提示与行为对不上" |
| **B6** | **存档兼容** | `vars.lifespan` 语义变了，旧档的数值会被重新解释。`rule_version`（`'2026-09'`）**必须升版**，加载时对旧档做一次 ×10 迁移或直接丢弃 |
| **B7** | **门禁** | `realm_index_absolute` 从"只扫 `endings[].requires`"扩到 `endings[].requires` + `scenarios[].requires` + `packs[].fail_modes[].trigger`，并覆盖 `<=` 方向；另加 `lifespan_threshold_scale` 盯结局门槛量级与内容实际发放量的比值；再加 `lifespan_bias_present` |
| **B8** | **过渡句取错档** | `yearsBucket` 的四档阈值（3/15/80，`src/core/engine.ts:273`）是按旧尺度定的。时钟换成 `baseLifespanAt(pi)/60` 后，凡人拍 ≈1.3 年、渡劫拍 ≈425 年 —— **`transition.years.*` 的素材会大面积取错档**。见【代价】1 |

---

## 【依据】

### 外部资料

1. **《庄子·逍遥游》**（ctext.org 公版）
   <https://ctext.org/zhuangzi/enjoyment-in-untroubled-ease/zh>
   关键句：「**小知不及大知，小年不及大年**。奚以知其然也？朝菌不知晦朔，蟪蛄不知春秋，此小年也。
   楚之南有冥灵者，**以五百岁为春，五百岁为秋**；上古有大椿者，**以八千岁为春，八千岁为秋**。」
   → 一个世界里并存 500 倍差的时间尺度，**自洽的前提是比较时必须先换算到同一个"春秋"**。
   **只取结构与尺度，不取句子。**

2. **劫（时间）· 维基百科** <https://zh.wikipedia.org/wiki/劫_(時間)>
   关键句：「劫数，又称劫波或劫簸（梵语：कल्प，kalpa）……意思是一段对人类来说极长或极短的时间，
   长可以长到无限长，短也可以短到一刹那。」
   换算链：「1 摩诃宇迦 = 12000 天年 = 4,320,000 太阳年……每劫总时长共 1000 个摩诃宇迦」
   「1 大劫（36,000 劫 + 36,000 瓦解期）= 311.04 万亿年」
   → 同一个词覆盖"刹那"到"311 万亿年"，靠的是**显式嵌套换算率**而不是一个统一数字。
   **跨尺度时间线的成熟做法就是"同一单位名 + 显式换算表"。**

3. **Sanderson's First Law**（官方博客原文）
   <https://www.brandonsanderson.com/blogs/blog/sandersons-first-law>
   关键句：「An author's ability to solve conflict with magic is **DIRECTLY PROPORTIONAL**
   to how well the reader understands said magic.」
   → 硬体系的判据是**读者理解度**。玩家理解不了"寿元"（因为不可比），
   按第一定律它就**不能用来解决冲突** —— 实测也确实是：五包 0% 寿尽，这一维没有参与任何冲突解决。

4. **Sanderson's Second Law** <https://www.brandonsanderson.com/blogs/blog/sandersons-second-law>
   关键句：「**Limitations > Powers**」
   → 折损/延寿这类**限制**比延寿本身更该被设计好。当前 435 条折损在高境界全是空转，
   **等于这条限制不存在**。

5. **Numéraire · Wikipedia** <https://en.wikipedia.org/wiki/Num%C3%A9raire>
   关键句：「the numéraire is a **basic standard by which value is computed**……
   serve as a **unit of account** and therefore provide a **common benchmark**
   relative to which the value of various goods and services can be measured against.」
   → 本项目缺的正是这个。`power_index` 已经是"修为"的记账单位，"寿命"没有。

6. **Order of magnitude · Wikipedia** <https://en.wikipedia.org/wiki/Order_of_magnitude>
   关键句：「Differences in order of magnitude can be measured on a **base-10 logarithmic scale**」
   → 2200 → 25600 跨一个数量级、70 → 25600 跨近三个数量级，**绝对差没有意义，必须换刻度或换单位**。

### 本项目现状（文件:行）

**引擎 / 类型**
- `src/core/engine.ts:219-224` `YEARS_BASE=2` / `YEARS_PER_REALM=4` / `yearsPerNode(state) = 2 + realm_idx*4` ← D1 本体
- `src/core/engine.ts:230-234` `lifespanCapOf = realm.lifespan + vars.lifespan`
- `src/core/engine.ts:204,207` `START_AGE=16` / `UNBOUNDED_LIFESPAN=999999`
- `src/core/engine.ts:236-263` `AgeInfo` / `ageInfoOf`（`unbounded` / `dire` 分支）
- `src/core/engine.ts:273-278` `yearsBucket` 四档（3 / 15 / 80）
- `src/core/engine.ts:372-378` `cultivateGain` 的 `realm_idx*0.2`
- `src/core/engine.ts:463-467` `healPerNode` 的 `realm_idx*0.15`
- `src/core/engine.ts:1788-1819` `rollOpponent` 两处 `realm_name` 取错（`:1798`、`:1817`）
- `src/core/engine.ts:2360-2378` `checkEnd` 寿尽判据
- `src/core/engine.ts:2664-2672` `fitScore` 的 `realm_top` 分支（**上一轮的正确修法**）
- `src/core/engine.ts:2760` `computeStars` 里 `void ending` ← 证明 `stars_rule` 是死字段
- `src/core/engine.ts:2768-2806` `HeavenBoardRow` / `buildHeavenBoard`（现有榜单数据源）
- `src/core/resolve.ts:157-176` `clampVar`；`:167-168` `case 'lifespan': Math.max(0, v)`
- `src/core/types.ts:36-51` `VarKey.lifespan` 的定义与"是折损，不是年龄也不是剩余寿命"的长注释
- `src/core/types.ts:119-132` `realm_idx` / `realm_top` 与那次事故的完整记录
- `src/core/types.ts:307-333` `DestinyChild`（**无 age、无 lifespan**）
- `src/core/types.ts:340-352` `Realm`（`lifespan: number | null`）
- `src/core/types.ts:354-373` `WorldPack`（`lifespan_bias` 要加在这里）；`:364` `fail_modes`（死字段）
- `src/core/types.ts:423` `rating: { stars_rule, min_stars }`（死字段）
- `src/core/destiny.ts:93-127` `generateDestinyChildren`；`:121` `realm_name` 只在生成时写
- `src/core/destiny.ts:150-175` `advanceFate`（只改 `power_index` / `fate_progress`，**不碰 realm_name**）
- `src/core/conditions.ts:136-143` `realm_idx` / `realm_top` 的求值

**内容**
- `src/content/packs/*.json` 六包 `realms[].lifespan`（表 1 的数据来源）
- `src/content/packs/physique.json:337` `fail_modes[].trigger = "exposure>=60 && realm_idx>=8"`
- `src/content/endings.json` 7 处 `lifespan` 门槛（idx 10/17/40/51/53/55/62，表 5）
- `src/content/endings.json` 5 处 `stars_rule` 里的 `realm_idx`（idx 17/40/52/63 等）
- `src/content/endings.json` 3 处 `realm_idx <=`（`end_mortal_*`）
- `src/content/terms/physique.json` `UI_LIFESPAN = ['寿数','命数','余年']` ← 命名依据
- 全库 `add_var lifespan` 效果 **577 条**：负 435 条（和 −1622，最小 −30）、正 142 条（和 +376，最大 +20）

**UI / 工具**
- `src/ui/components/HeavenBoard.tsx` 现有天机榜（气运为视觉中心）
- `src/ui/components/StatusBar.tsx:216` `第 {realm_idx+1}/{realmTotal} 境`（**正确，有分母**）
- `src/ui/components/StatusBar.tsx:234-250` 年龄/寿元 Vital（靠 `life.unbounded` 分支）
- `src/ui/text.ts:320-327` `powerTier`（**跨体系分档的先例，无绝对序号**）
- `src/ui/store.ts:415` `fail_modes: []` ← 证明该字段无人读
- `tools/content-lint.ts:780-802` `realm_index_absolute` 门禁（只扫 `endings[].requires`）
- `tools/asc-check.ts` 按包拆开看登顶率的先例（本方案的测量脚本应与之同源）
- `docs/superpowers/specs/2026-09-20-xuan-design.md:303` §6.3 天机榜定义

**实测脚本（一次性，放 /tmp，未入库）**
- `/tmp/wb_ratio.py` —— 表 1/2/3（每拍年数、可走拍数、折损占比）
- `/tmp/wb_measure.ts` —— 表 4（每包 200 局死亡原因 + 轨迹），`npx tsx /tmp/wb_measure.ts 1200`
- `/tmp/wb_lifespan_dist.ts` —— 表 5（终局 `vars.lifespan` 分布与门槛达成率）
- `/tmp/wb_packs.py`、`/tmp/wb_lifespan_deltas.py` —— 原始表与效果分布

---

## 【代价】会让什么变差

1. **过渡句会大面积取错档（最容易被忽略的一条）。**
   时钟从 `2+4×realm_idx` 换成 `baseLifespanAt(pi)/60` 后：凡人一拍 2 年 → **约 1.3 年**，
   渡劫一拍 38 年 → **约 425 年**。`yearsBucket` 的四档阈值（3/15/80）与
   `transition.years.*` 的 L2 素材全是按旧尺度写的 —— **"三年后"和"三百年后"会开始张冠李戴**。
   必须与 `writer` + `systems-designer` 一起重标。**这是本方案最大的一笔隐性成本。**

2. **`lifespan` 语义变更会动 577 条效果的含义**（数值不动、含义动）。
   这是优势（不用改内容），也是风险：**没有任何现有门禁能发现"含义变了"**。
   **必须先加门禁再改引擎**，顺序反了就是又一次"测试全绿但功能是死的"。

3. **`lifespan_bias` 天生是一个手写常量**，六个包各一个数，没有真相源可派生。
   缓解办法是**从现有表反推**（`bias_p = 顶层寿元 / baseLifespanAt(1000)`），
   而不是新拍六个脑袋。但反推值的相对关系会继承现有表的历史包袱。

4. **`rule_version` 必须升版，旧存档要么迁移要么废。** 会掉一部分正在玩的档。

5. **「熬死他」这条路会削弱位面之子的压迫感。**
   现在的气运池（3~9 点）已经过一轮平衡，叠加寿元后主角光环的威胁时长变短。
   建议 `systems-designer` 复核，二选一：
   要么把位面之子的 `lifespan_bias` 统一抬到 ≥1.0（让"熬死他"变成需要主动经营的路，而非默认解）；
   要么明确"熬死"只对特定原型成立（**苟道型活得久但气运厚 → 熬不动；悲剧型命短 → 熬得动**），
   这样反而强化了现有的原型差异。

6. **它是跨 `src/core` 与 `src/content` 的破坏性改动**，涉及 `types.ts` / `engine.ts` /
   `resolve.ts` / 6 个 pack JSON / `endings.json` / `destiny.ts` / `conditions.ts` /
   `content-lint.ts` / UI 三处 / 存档版本。**必须由主 AI 串行实施，不能并行改**
   （多个专家同时动会互相覆盖 —— CLAUDE.md 已登记这个坑）。

---

## 【给主 AI 的建议实施顺序】

**不要一次做完。** 分成三步，每步都能独立验收：

| 步 | 内容 | 验收 |
|---|---|---|
| **1** | **只止血**：`endings.json` 的 7 个 `lifespan` 门槛 ÷10 + 扩 `realm_index_absolute` 门禁（覆盖 `scenarios` / `fail_modes` / `<=` 方向） | 1200 局实测「苟道长寿」达成率 **从 0.0% 变成非 0**，并贴出数 |
| **2** | **换单位**：`baseLifespanAt` / `yearsPerNodeAt` / `lifespan_bias` / `lifespan` 比例语义 + 时钟换尺 + `yearsBucket` 重标 | 表 2 的 8.5 倍极差**收敛到 <1.5 倍**；六包寿尽率差 **<2 个百分点**（2400 局） |
| **3** | **画榜**：`FateRow` + 位面之子 age/lifespan + 「熬死」玩法 + `moves_left/moves_tier` | 天命榜上每个存活位面之子都有非 null 的 `moves_left`；`realm_label` 随 `power_index` 变化（不再是"第二境"） |

第 1 步今天就能做，且**风险为零**（只动 JSON 阈值与门禁）。
第 2 步是结构病的手术，**必须串行**。
第 3 步依赖第 2 步，**别提前做** —— 在没有统一单位之前画榜，
画出来的就是一张"给不存在的统一性做的漂亮图"，比不画更糟。
