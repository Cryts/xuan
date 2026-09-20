# 叙事方案 · 事件衔接 与 位面之子

> narrative-designer · 2026-09-20
> **本轮只出方案，未改动任何文件**（并行专家多，避免互相覆盖）。
> 文中所有示例叙事文本遵守文本禁区：第二人称「你」、3 行、每行 ≤60 字、无阿拉伯数字与系统词。
> 表格里的阿拉伯数字是**测量值**，不是叙事文本。

---

## 零、判断（先给结论）

### 问题一「事件没有衔接性」

**判断：既不是缺字段，也不是缺调度 —— 缺的是把已有字段接到文本层的那一段线。**

具体地说：`motif` / `tags` / `followups` / `param_slots` 四样东西**全都只喂给调度器**（冷却、权重、保底队列），**没有一样喂给文本层**。于是事件的"衔接"在**数据上根本不存在**，只在**排序上**存在。玩家读到的是被排在一起的段落，不是被写在一起的情节。

更重的是：**你要的"前后文完善"基础设施已经写好了，只是从来没接线。**

| 已有但从未被调用 | 位置 | 证据 |
|---|---|---|
| `Motif.param_slots` —— 每个母题六组参数槽（地点 / 守护 / 宝物 / 势力 / NPC / 风险） | `src/core/content.ts:28`，内容在 `src/content/motifs.json` | 全库 grep `param_slots`，除类型声明与该 JSON 自身外**零引用** |
| `renderTemplate()` —— 把 `{槽位}` 填成具体名词的渲染函数 | `src/core/narrative.ts:59` | 全库 grep `renderTemplate`，**只有函数定义这一处**，无调用点 |
| `narrative.slots` 类型位 | `src/core/types.ts` | 未定义 |

也就是说：`motifs.json` 里那三十二个母题、每个六组槽位（"地点：寒潭残府 / 雾岭石窟 / 无名的石阶……"）是**现成的、为"让这一拍具体起来"而写的**，而正文走的仍然是 `loose.<母题>.<阶段>` 这条固定通道 —— 一段话由四到十三个事件共用。**这才是"单独的事件只有一点字"的真正来源：不是字少，是那些字不属于那件事。**

实测：`553` 个事件只对应 `130` 个 `body_key`（均值 `4.25` 个事件共用一段，最高 `13` 个），每个 key 只有 `3` 个变体。

### 问题二「位面之子与主线无关」

**判断：他们不是"没设定关系"，而是被建成了一套与世界平行、互不相识的系统。全球的 NPC 关系基础设施已经有了，他们没接进去。**

| 已有 | 位置 | 位面之子接进去了吗 |
|---|---|---|
| `RelationKind`：师徒 / 道侣 / 仇家 / 护道人 / 盟友 | `src/core/types.ts:96` | ✗ |
| `set_relation` 效果 | `src/core/types.ts:86` | ✗ |
| `relation` 判定条件（`relationValue`） | `src/core/conditions.ts:70-74, 119-125` | ✗ |
| 手写 NPC 名录（`npc_shen_yan`、`npc_pei_wujiu`、`npc_yan_linyuan` … 共 `105` 组） | 事件与剧本 JSON | ✗ |
| 关系是**结局判据**（`endings.json` 里有 `9` 处 `relation` 条件） | `src/content/endings.json` | ✗ |
| `DestinyChild.relation: number`（"对你的关系 −100–100"） | `src/core/types.ts:324` | 字段存在，`destiny.ts:125` 生成时写死 `0`，**全代码库无任何读写**。实测 300 局里非零 `0` 次 |

**最刺眼的一条**：位面之子的名字是从 `src/core/destiny.ts:80-85` 硬编码的姓氏/名字池里抽的，而那个池子（沈、陆、姜、云、裴、燕、竺、容、谢、萧、顾、苏 / 砚、舟、珩、澈、寻、照、野、辞、度、青崖、长庚、无咎、怀瑾、惊鸿、临渊、寒山、明烛、折雪、归尘）**和 `src/content/names.json` 是同一批名字**。也就是说：手写 NPC 叫「裴无咎」，程序生成的位面之子也可能叫「裴无咎」，而两者**互不知道对方存在**，`state.relations` 与 `destiny_children` 是两张表。玩家在世界里遇到的仇家名单和天机榜上的位面之子，是两个不相干的宇宙。

**交集现在只有一种，而且是匿名的**：`src/core/engine.ts:1775` 的斗法触发（在场且存活时 `9%` 概率）→ `rollOpponent` (`:1789`) 挑一个当对手。整个过程里玩家看到的是"一个对手"，不是一个**有过往的人**。

---

## 一、问题一的结构方案

三件事缺一不可：**字段形状**（存什么）、**引擎怎么读**（谁来取）、**写作规范**（内容写什么才算合格）。只做前两件，内容会写歪；只做第三件，没有承载。

### 1.1 字段形状

在 `LooseEvent` 上**只加三个字段**（其余全部复用现有）：

```jsonc
{
  "id": "evt_mortal_waste_root_test_03",
  "motif": "m_waste_root_test",
  "stage": ["growth"],

  // 【新】渠道。chain = 成系列；omen = 一次性奇遇（见 1.4）
  "channel": "chain",
  "omen_gap": 6,                     // 仅 omen 用：距上次奇遇至少隔几拍

  "narrative": {
    "body_key": "loose.m_waste_root_test.growth",     // 保留：母题级兜底
    "self_key": "evt.evt_mortal_waste_root_test_03",  // 新：事件级正文（可选）
    "slots": { "place": ["药圃西头"], "who": ["赊账的那位掌柜"] },  // 新：本事件的槽位覆盖
    "before_key": "evt.evt_mortal_waste_root_test_03.before",      // 新：回望（承接上一拍）
    "after_key":  "evt.evt_mortal_waste_root_test_03.after"        // 新：余波（选项结算后）
  },

  // 【新】显式系列。比 followups 强的地方：带 beat 序数、带"哪条分支才接"、带根
  "chain": {
    "root": "waste_root_test",
    "beat": 3, "of": 5,
    "prev": "evt_mortal_waste_root_test_01",
    "next": [
      { "id": "evt_mortal_waste_root_test_07", "window": "1-4", "if": "fail" },
      { "id": "evt_mortal_waste_root_test_09", "window": "1-4", "if": "success" }
    ]
  }
}
```

**为什么 `self_key` 直接写 `evt.<event_id>` 而不是派生 `loose.<母题>.<阶段>.<序号>`**：

我试过按序号派生（事件 id 末尾都是 `_NN`，实测 **553 个全部符合**，可派生），但会撞车 —— `evt_mortal_auction_03` 与 `evt_genius_auction_03` 派生出同一个 key（`(母题, 阶段, 序号)` 组合里有 `119` 组冲突）。**用事件 id 做 key，零歧义，且 `evt.` 前缀与现有 `loose.` / `transition.` / `scn_` 命名不冲突。** 这一点必须写死，否则实现时会踩。

**`slots` 的值从哪来**：三级回落，全部派生，不手写 ——

```
事件级 narrative.slots  →  母题级 motifs.json 的 param_slots  →  中性默认（narrative.ts:66 的 NEUTRAL_DEFAULTS）
```

`motifs.json` 里 `param_slots` 是形如 `"地点：寒潭残府 / 雾岭石窟 / 无名的石阶 / 塌了半边的丹房"` 的字符串，需要一次性的解析（按 `：` 分名字、按 ` / ` 分候选）。这一步是**构建期**做的，不进运行时。

### 1.2 引擎怎么读

改动集中在三处，每处都是**加法**，不动现有分支：

**(a) 正文选择 —— `buildLoosePresentation`（`src/core/engine.ts:886`）**

```
key = l2[ev.narrative.self_key] ? ev.narrative.self_key         // 事件级优先
                                 : ev.narrative.body_key        // 母题级兜底
lines = splitLines(renderTemplate(pickFromPool(key).text, slots, rng))
```

`renderTemplate` 找不到槽值时已经会回落中性默认（`narrative.ts:66`），不会抛错。**降级路径保持三级不变**（事件级 → 母题级 → `雾散雾起，前路未明。`）。

**(b) 接缝 —— `composeTransition`（`src/core/engine.ts:291`）**

这是**用户抱怨的那一处**。现在它按四级优先级挑词：人生阶段 > 境界跃迁 > 寿元告急 > 年数跨度（`engine.ts:305-309`），**四级的输入全部是"过了多久"，没有一级输入是"上一件事是什么"**。所以它写出来的是：

> 往后的年月，你多半是一个人过的。／一个人过，日子就过得快。

这句话接在**任何**两拍之间都成立 —— 它就不是接缝，是过场。实测 `93.2%` 的节点有承接句（`4102 / 4402`），但那是"渲染了一句时间过渡"的覆盖率，**不是"这两拍接上了"的覆盖率**。

改法：**在四级之上加一级"回望"**，优先级最高：

```
if (state.last_outcome)  key = `transition.echo.${state.last_outcome.echo_class}`
else if (stageChanged)   key = `transition.stage.${state.stage}`
else if (realmUp)        key = 'transition.realm_up'
...
```

新增的状态只有一个，形状与 `advanceNode` 里已有的 `last_motif` 同构（`engine.ts:2228`）：

```ts
last_outcome?: {
  event_id: string
  motif: string
  echo_class: 'cost' | 'gain' | 'escape' | 'debt'   // 由 band + intent 派生
  band?: Band
}
```

`echo_class` 的派生规则（**不许内容自己标**，必须是规则算出来的）：

| 条件 | echo_class |
|---|---|
| `band ∈ {fail, crit_fail}` | `cost` |
| `band ∈ {crit, success}` | `gain` |
| `intent === 'flee'`（无论成败） | `escape` |
| 效果里含 `debt` / `exposure` 且为增 | `debt` |

新增 L2 池：`transition.echo.cost` / `.gain` / `.escape` / `.debt`，**四个 key × 四条变体 × 两行**，共 `32` 行文本。这是整个方案里唯一必须新写的一批文本，成本极低。

示例（`transition.echo.cost`）：

> 那一趟的账是慢慢显出来的。
> 先是走得慢，后来是运功慢。
> 再后来，是别人看你的眼神。

**(c) 余波 —— `outcomeNarrative`（`src/core/engine.ts:1003`）**

现在的情况：段位级没有 `narrative` key 时，它**回落到 `body_key`** —— 也就是**把开场白当结局念一遍**。实测 `4895` 个段位槽里只有 `2181` 个写了 `narrative`（`45%`），**其余五成半在重念开头**。这就是"只有一点字"的第二层。

改法：回落顺序改为 `band.narrative` → `narrative.after_key` → `body_key`。**`after_key` 是事件级派生文本**，一段话管四个段位（写"你付了代价"这种通吃句），比给 `4895` 个段位逐一补词便宜得多。

### 1.3 followups 为什么几乎没生效（实测）

不要以为这条通道在跑。它是**死的**：

| 项 | 实测 |
|---|---|
| 声明了 `queue_followup` 的事件 | `49 / 553`（`8.9%`） |
| 不同的 followup 目标 | `40` |
| **指向不存在事件的 followup** | `1` 个：`evt_physique_contingency_04`（**这是一个真实缺陷，建议先修**） |
| 运行期真正兑现的 followup 节点 | **`8 / 3840` 节点（`0.21%`）**；300 局里只有 `8` 局各出现一次，单局最多 `1` 次 |
| 试玩报告的"有意连锁" | `11` 次 / `4402` 节点 |

`parseFollowup`（`engine.ts:711`）出来的窗口是 `[node+1, node+6]`，但 `advanceNode` 里出队判据是"已出过 或 窗口过期"（`engine.ts:2255`），而 `pickNextEvent` 的保底路径**每次只取队列第一个**（`engine.ts:768-775`）。真实原因是**队列被剧本前置链占满了**：实测每拍平均有 `0.74` 条"已排未出"的条目，其中绝大部分是 `planScenarioChain` 推的铺垫（`engine.ts:2326-2333`）。**followup 排在剧本链后面，永远轮不到。**

结论：`chain.next` 必须与 `planScenarioChain` **共用一个队列优先级策略**，而不是各自 push。具体：剧本链入队时插在队列**尾部**（现状），`chain.next` 入队时插在**队首**（因为它承诺的是"紧接着"，窗口只有一到四拍）。**否则新的 chain 字段会重蹈 followups 的覆辙。**

### 1.4 奇遇（`omen`）通道

用户要的"突发的奇遇"，现在的调度器**结构上给不出来**：`pickNextEvent` 的过滤是三级收紧（`engine.ts:784-841`），`cooldown.same_motif` 与 `cooldown.same_tag` 把所有"刚见过的东西"全挡住了。**奇遇的本质是"打破节奏"，而调度器的本质是"维持节奏"。** 这两件事必须分通道。

`channel: "omen"` 的事件：

1. **绕过** `cooldown.same_motif` / `same_tag` / `stage` 过滤（它就该在不该来的时候来）；
2. **受一个全局闸**：`state.nodes_since_omen >= ev.omen_gap`，缺省 `6`；
3. **第一拍必须是"接不接"**，与斗法的「出手 / 避开」同构（这是项目已有的语法，`CLAUDE.md` 里"斗法是奇遇不是日常"那条）。接不接**不收费、不推进节点**，只记 flag。

关于第 3 点，`Game_balance` 的 Randomization 一节讲得很清楚：

> "The downside of randomization is that it takes control away from the player, potentially leading to frustration. Methods of overcoming this include **giving the player a selection of random results within which they can optimize**." —— [Game_balance § Randomization](https://en.wikipedia.org/wiki/Game_balance)

也就是说：**奇遇可以随机地来，但"摊上哪一件"要让玩家挑。** 具体做法是奇遇来的时候一次给三件（三件都是奇遇），玩家挑一件 —— 随机的边界由引擎划，边界内的选择归玩家。

### 1.5 写作规范（第三条腿，缺了前面两条会写歪）

前面两条给了承载，但没有规范的话内容会退化成"换个词说的同一段话"。规范三条，每条可判：

1. **`self_key`（事件级正文）里必须至少有一个只属于这个事件的具体名词。** 判据不是人肉看，是机器判：正文里必须出现该事件 `slots` 里至少一个槽值的实例。做不到就别写 `self_key`，回落母题级 —— **宁可共用，不要假装独有。**
2. **`chain` 事件的第一句必须是回望句。** 系列的第二拍起，正文第一行要能读出"这件事从上一拍来"。这条落在 `before_key` 上，由 1.2(b) 的 `last_outcome` 渲染。
3. **同一 `chain.root` 的事件，`echo` 的意象必须复用同一个物件。** 例：`waste_root_test` 这条根，每一拍的正文里都要出现"那几垄"或"药圃"里的同一件东西。**这正是试玩里"共用意象"判据在找的东西**，只不过它现在找的是 `tags`（见 1.6）。

### 1.6 门禁（不改工具就等于没修）

`tools/content-lint.ts` 加四条。**加功能必须同时加闸门**是项目契约，这里照办：

| 规则 | 判据 |
|---|---|
| `event_chain_resolves` | 所有 `chain.next[].id` 与 `queue_followup` 目标必须存在于内容中（现在能立刻抓出 `evt_physique_contingency_04`） |
| `event_text_selfcoverage` | `weight >= 80` 的事件必须写 `self_key`；写了 `self_key` 的，其 L2 文本必须命中至少一个 `slots` 槽值 |
| `band_narrative_floor` | 段位级 `narrative` 覆盖率不得低于当前基线（现在 `45%`），只许升不许降 |
| `omen_gap_declared` | `channel === "omen"` 的事件必须声明 `omen_gap >= 4` |

### 1.7 试玩仪表要修（否则修好了也看不见）

`tools/playtest.ts` 的 continuity 段（`:294-322`）**测不出用户说的问题**，这是必须先说清楚的一件事：

- `bareCuts` 判据是「`tags` 零重叠 **且** 没有承接句」（`:314-318`）。实测相邻两拍共用标签的比例是 **`39.5%`**（`1660 / 4203`），叠加承接句 `93.2%` 的覆盖率 → 硬切几乎是**不可能事件**，报告里恒为 `0`。**一个恒为零的指标等于没有指标。**
- `motifRepeats` 抓的是「同一母题紧邻」（实测相邻两拍共用母题只有 `1.8%`）。它抓的是**调度事故**，不是衔接质量。
- `withTransition` 的 `93.2%` 会被读成"衔接良好"，但 1.2(b) 说明了那只是"渲染了一句时间过渡"。**这是本项目最危险的一类错误：仪表读数与玩家体验反向。**

建议替换/新增三条，都能算、都不依赖模型：

| 新指标 | 定义 | 现在的读数 |
|---|---|---|
| **回望覆盖率** | 相邻两拍中，本拍渲染出了 `transition.echo.*` 的比例 | 实现后应为 `100%`；**现在是 `0%`（该 key 不存在）** |
| **空回落率** | `outcomeNarrative` 回落到 `body_key`（=重念开场白）的比例 | **约 `55%`**（`1 − 2181/4895`） |
| **followup 兑现率** | 声明了 `chain.next` 的节点里，`next` 在其窗口内真的出现的比例 | **`0.21%`** |

---

## 二、位面之子的方案

### 2.1 现状（实测 + 代码）

| 项 | 读数 |
|---|---|
| 平均每局的位面之子数 | `1.47`（`destinyCount` 取 `0–3`，`engine.ts:531`） |
| **一局里一个都没有的比例** | **`27%`**（`82 / 300`） |
| 生成的位面之子总数 | `441`（300 局） |
| 被杀数 | `20`（`4.5%`） |
| 气运被磨过的局 | `89 / 300` |
| `relation` 非零的局 | **`0`** |
| 他们与玩家的交集方式 | **只有一种**：斗法遭遇（`engine.ts:1775`，`9%`） |
| 参与剧本前置链的次数 | **`0`** —— 18 个剧本的 `leadup_motifs` 里**一个 `m_destiny_*` 都没有**（逐个查过） |

三条**已经写好、但完全没接上**的通道，这是最该先修的：

1. **`world_effect` 全废。** `advanceFate` 返回 `{ advanced, milestone, worldEffect }`（`src/core/destiny.ts:150`），但 `advanceNode` 里调用时**丢弃了返回值**（`src/core/engine.ts:2194`）。`fate_templates.json` 里 `54` 个里程碑有 **`41` 个**声明了 `world_effect`（`region_tag` / `danger_delta` / `opens` / `closes`）—— 一个都没生效。
2. **「天意庇佑」的正文玩家永远看不到。** `resolveDestinyEncounter` 把 `protection.coincidenceKey` 塞进 `recent_narrative`（`src/core/engine.ts:2145`），而 `recent_narrative` **只被 `pickFromPool` 当去重集合用**（`narrative.ts:38`）。`coincidence` 池在 `src/ui/store.ts:220-222` 被加载了，但 `grep -rn coincidence src/` **没有任何一个 `.tsx` 读它**。`coincidence.json` 里那十一组"巧合救场"文本（写得很好，"烟里走出一个背剑的老人，只说了一个字：走。"）**全部作废**。
3. **`motifs.json` 没有他们。** 三十二个母题全覆盖散事件，**七个 `m_destiny_*` 一个都没有**。位面之子是**后来插进来的，没在母题注册表里登记** —— 这就是"与主线无关"在数据上的字面证据。

### 2.2 关系模型：不新建，把 `DestinyChild` 接进 `state.relations`

**核心决定：位面之子的 `relation` 不是第二套系统，而是 `state.relations` 里的一批条目。** 理由：判定（`conditions.ts:119`）、效果（`types.ts:86`）、结局归因（`endings.json` 里 `9` 处 `relation` 条件）**全部已经能读 `state.relations`**，接进去就一次性全部可用；另起一套则要复制这三处。

具体三步：

**(a) 生成时登记。** `generateDestinyChildren`（`destiny.ts:100`）产出后，在 `startRun` 里写入 `relations`：

```ts
relations: destinies.map(d => ({ npc_id: d.id, kind: '仇家', value: 0 }))   // 初始为中性
```

更准确地说，初始 `kind` 应当是**未定**，第一次交集才定 —— 这正好是本项目"关系由行为决定"的价值观。加一个 `kind: '未识'`，第一次交集时由 `set_relation` 改写。

**(b) 让静态内容能写程序生成的人。** `set_relation` 现在只认写死的 `npc_id`（`types.ts:86`），而位面之子的 id 是 `dc_0_mortal_brute` 这类程序产物，**内容 JSON 写不出来**。这是当前最大的结构障碍。

解法是**复用已有的 `@current` 约定**，不发明新东西：`destiny_drain` 已经这么干了（`engine.ts:676-682`，注释里写明"遭遇事件是静态内容，而位面之子是程序化生成的，所以事件无法写死具体 id"）。把同一约定复制到 `set_relation`：

```jsonc
{ "type": "set_relation", "npc_id": "@current", "kind": "护道人", "delta": 20 }
```

引擎侧只需在 `applyEffectsState` 的 `set_relation` 分支加一个 `@current` 解析（与 `destiny_drain` 同一个解析函数，直接抽出来共用）。

**(c) 关系要能改命运线，否则玩家不会在意。** `relation` 不能只是个数。加一条规则：**关系值决定他命运线的走向** ——

| 关系 | 他命运线的变化 | 对玩家的意义 |
|---|---|---|
| `仇家` 高 | 命运线里程碑的 `world_effect` **朝对你不利的方向结算**（`danger_delta` 加在你所在的 `region_tag`） | 他会变成你的天灾 |
| `护道人` 高 | 他的里程碑 `opens` 的事件**对你开放**（你可以走他开的路） | 他是你的捷径 |
| `盟友` 高 | 他推进一步时，**你同步拿到一份**（他的金手指你也沾一点） | 养他等于养自己 |
| `师徒` 高 | 你能 `learn_rule` 他所在体系的一条规则（跨界习得，`types.ts:91` 已有该效果） | 六体系互通的唯一正道 |

**这一条是把 `world_effect`（那 `41` 个死里程碑）救活的地方，也是关系第一次产生机制后果。** 现在他们推命运线对玩家**零影响**，玩家当然不在意。

### 2.3 交集怎么发生

三条通道，按优先级：

**通道一（主）：进剧本前置链。** 18 个剧本的 `leadup_motifs`（`engine.ts:2317`）里加 `m_destiny_*` 母题，或更精准地加一个 `leadup_requires`。**这一条一改，位面之子立刻从"路边遭遇"变成"主线铺陈"** —— 因为前置链本来就是"剧本是前面一路选择的收束"（`engine.ts:2266` 的注释）那个机制的载体。玩家在走进剧本的几拍前，先遇到那个人。

**通道二：关系驱动的事件门槛。** 现有 `destiny_alive` / `destiny_worn` / `destiny_archetype` 三个条件（`conditions.ts:146-159`）之外，加 `destiny_relation`：

```jsonc
{ "type": "destiny_relation", "kind": "护道人", "op": ">=", "value": 20 }
```

这样内容层面就能写出"**他记得你**"的事件 —— 而不是现在"随便来一个人"。`m_destiny_pact_after` 那一组（`4` 个事件，需要 `flag_destiny_pact`）已经在尝试这件事了，实测 `45 / 300` 局触发过该 flag，但 `m_destiny_pact_after` 只兑现了 `4` 次 —— **又是被队列压死的**（同 1.3）。

**通道三：斗法遭遇（保留，但不再匿名）。** 现在 `rollOpponent`（`engine.ts:1789`）已经把对手的 `name` / `fate_progress` / `oracle_note` 带进 `DuelOpponent` 了，这是**唯一一处玩家能看到名字的地方**。把它接上关系：交手的结果写回 `relations`（赢 → `仇家` 涨；避战 → `仇家` 微涨，"你转身走了，对方记着你"，这条注释已经写在 `engine.ts:1824` 了，只是没落成数据）。

### 2.4 玩家为什么在意（这一条是核心，单独写透）

只给关系模型不够 —— 玩家凭什么在乎一个数值。三条动机，每条挂在**已有系统**上，不新造机制：

**动机一：他是你没走的那条路的活人版。**

位面之子**必定来自与玩家不同的体系包**（`destiny.ts:107` `others = allPacks.filter(p => p !== playerPack)`）。六个体系包的境界名、母题、结局各不相同。他每推进一步命运线，就是**当着你的面演示另一个体系的一层境界**。

这一条是《玄》**独有的、别的游戏给不了的**：你有六个体系包，就有六条平行的命运线。玩家在意的不是"这个 NPC 是谁"，是"**我如果选了那个体系，会变成什么样**"。这是最便宜也最强的一条，因为它不需要新内容 —— 只需要**把 `fate_line` 的里程碑推到玩家眼前**（`fate_templates.json` 里每个里程碑已有一句 `narrative`，如"他被退了婚的那一夜站在雪里，天亮时雪停了，他也换了个人。"）。而这个展示**现在根本不发生**：`advanceFate` 的 `milestone` 返回值被丢弃（`engine.ts:2194`）。

**动机二：他是你的资源，而且有两条取法（不是一条）。**

现在只有一条：杀。`killDestinyChild`（`destiny.ts:255`）给金手指（`power += 60 + wasAt*40`）+ 稀有材料 + 灵石 + 继承他的因果（`debt += 12 + 4*fate_progress`）+ 称号「弑主·某某」。**但只在你杀得死他时才拿得到**，而他的气运池设计上就是让你杀不死的（`checkDestinyProtection`）。

必须给第二条：**养他**。走他命运线的 `opens`（`41` 个里程碑里有 `opens`），他开的路你能走；关系够高时他推进一步你同步拿一份。这样"在意"第一次有了**目标函数的两端**：杀他 = 一次性、高风险、拿金手指；养他 = 长期、低风险、拿路线。**这才是一个真正的取舍，而不是"打不过就算了"。**

**动机三：他会记得你（而且这条已经实现了，只是没说出来）。**

`used_against` / `resistances` / `adaptSchemer`（`destiny.ts:196-235`）已经实现了"智谋型记录你用过的招、下次带上对应抗性"。`coincidence.json` 里连对应文本都写好了（`destiny.protect.resist.brute`："你用的还是上一回那一招。／他站在原地没有躲……／甲碎了，人还在。"）。

**这套东西现在一个字都到不了玩家眼前**（见 2.1 第 2 条）。把它接到节点呈现上，就一句话的成本，换来的是"**对手会成长**"这个体感。

**三条动机汇总一句话**：杀他是拿走他的命，养他是借他的运，绕开他是留着这条线以后再说。**「在意」的前提是"我做的事他会记住"，而记忆必须被看见。** 现在看不见，所以不在意。

---

## 三、实测依据

### 工具与口径

- `npx tsx tools/playtest.ts 300`（项目自带，结果写入 `playtest-findings.md`）
- 自建仪表 `/tmp/dig/measure.ts`、`measure2.ts`、`measure3.ts`（**未写入项目目录**，走绝对路径 import 项目模块，`bindContent` 已调）
  ⚠️ 口径差异：自建仪表对剧本用随机动作（项目自带工具用"行囊匹配"启发式），所以两者的**绝对数**不可直接互比，**结构比例**可比。

### 用户抱怨的"事件衔接"（自带工具，300 局）

```
平均局内节点数：27.1    遇到过的事件：498 / 553    遇到过的剧本：18 / 18
有承接句的节点：4102 / 4402（93.2%）
阶段跃迁：1007 次，其中没有交代的 0 次
✓ 没有出现「上一拍与这一拍毫无共用意象、且中间没有承接」的硬切
✗ 73 处母题紧邻重复
有意连锁：11 次
```

**这份报告读起来像"衔接没问题"。**

### 我的补充测量

| 指标 | 读数 | 来源 |
|---|---|---|
| followup 声明数 / 目标数 | `49 / 553` 事件、`40` 个目标 | 静态 |
| followup 目标指向不存在的事件 | `1`（`evt_physique_contingency_04`） | 静态 |
| **followup 运行期兑现** | **`8 / 3840` 节点（`0.21%`）**，300 局里只有 8 局各一次 | `measure2.ts` |
| 事件数 / `body_key` 数 | `553 / 130`（均值 `4.25`，最高 `13`） | 静态 |
| 每个 `body_key` 的变体数 | `3` | 静态 |
| 段位级 `narrative` 覆盖率 | `2181 / 4895`（`45%`）→ **约五成半在重念开场白** | 静态 |
| **相邻两拍共用母题** | `77 / 4203`（`1.8%`） | `measure3.ts` |
| **相邻两拍共用标签** | `1660 / 4203`（`39.5%`） | `measure3.ts` |
| 剧本前置链在队列中的占用 | 每拍平均 `0.74` 条已排未出 | `measure3.ts` |
| `param_slots` 引用数 | **`0`**（除类型声明） | 全库 grep |
| `renderTemplate` 调用数 | **`0`**（除函数定义） | 全库 grep |

**`39.5%` 这个数就是"硬切恒为零"的原因**：判据要"标签零重叠"，而标签重叠是常态。

### 位面之子

| 指标 | 读数 | 来源 |
|---|---|---|
| 人均生成数 / 一局一个都没有的局 | `1.47` / `27%`（`82 / 300`） | `measure.ts` |
| 被杀 / 总数 | `20 / 441`（`4.5%`） | `measure.ts` |
| `relation` 非零的局 | **`0`** | `measure.ts` |
| `m_destiny_*` 母题在节点中的占比 | `328 / 4661`（`7.0%`） | `measure.ts` |
| 其中 `m_destiny_crossing` / `first_sight` | `184` / `101` —— **两个母题占 `87%`** | `measure.ts` |
| `m_destiny_faltering` / `last_stand` | `2` / **`0`** | `measure.ts` |
| 参与剧本前置链 | **`0`**（查过全部 18 个剧本的 `leadup_motifs`） | 静态 |
| `motifs.json` 里登记 | **`0`**（7 个母题全缺） | 静态 |
| 带 `world_effect` 的里程碑 | `41 / 54`，**全部未生效** | 静态 + `engine.ts:2194` |
| `coincidence.json` 被 UI 读取 | **`0` 处**（`store.ts:220` 加载，无 `.tsx` 消费） | 全库 grep |

**读法**：位面之子的内容量（`43` 个事件）不小，触发率也不低（`7.0%` 的节点），但**内容高度集中在两个母题**（`crossing` + `first_sight` 占 `87%`），而**真正体现"他们的命运线"的母题（`faltering` / `last_stand` / `pact_after`）几乎不出现** —— 因为它们全部要求 `destiny_worn >= 0.5`（=你必须先磨掉他一半气运），而磨气运只有斗法与 `destiny_drain` 两条路，实测 300 局里只有 `2` 次和 `0` 次。**"他的命运线"这条故事线，玩家基本读不到。**

---

## 四、我认为用户要求里有问题的地方（三条，附替代案）

### 反对一：「事件应该作为一系列存在」——**不能所有事件都成系列**

依据：`Game_balance` 的 Randomization 一节 —— 随机化的代价是夺走玩家的控制感，但**纯系列化的代价更大**：玩家的控制感回来了，**意外感没了**。而仙侠的"奇遇"卖点恰恰是意外。若每一拍都接得上，玩家会在十几个节点后学会"读结构"，惊喜归零。

**替代案：分两个通道，比例固定。** `channel: "chain"`（成系列，约八成）+ `channel: "omen"`（一次性，约一至两成，且必须过"接不接"的闸）。玩家能**分辨**两者（奇遇的标题池用另一套语气），于是"接下来会接上"和"接下来不知道会发生什么"变成两种可预期的体验。**自由化与限制化结合，这里的限制就是那个比例。**

### 反对二：「单独的事件前后文要相对完善」——**方向对，但不要靠加字**

依据：`21841` 段正文已经不少了。问题不是字数，是**归属** —— `4.25` 个事件共用一段。**再写长只会让共用更严重**（写的人会被迫写更通用的句子，通用句才配得上四个事件）。

**替代案：先接线，后加字。** `motifs.json` 的 `param_slots` 与 `narrative.ts:59` 的 `renderTemplate` 是**为这件事准备的**，且已经写好、已加载、零调用。先把这条线接上（三层回落：事件级 `slots` → 母题级 `param_slots` → 中性默认），再看还剩多少事件"只有一点字"。**我预计能消掉大半抱怨，且不需要新写一万八千字。**

### 反对三：位面之子要「与主线剧情有关」——**要相关，但不要进主线**

依据：`CLAUDE.md` 第一条永久规则是"**自由度是《玄》的核心卖点**"。把位面之子写成主线，等于说"你必须处理他们"，这是**限制化压过自由化**，且他们立刻变成又一个主线任务列表 —— 而这类游戏里，主线任务列表是玩家最不关心的东西。

**替代案：他们不进主线，但他们进「前置链 + 结局归因」。** 玩家的选择是**绕开 / 利用 / 对抗 / 结盟**四种，而不是"面对"一种。具体：
- 通过 `leadup_motifs` 进剧本的**铺垫**（他们是你走进剧本的原因之一，不是剧本的内容）；
- 通过 `state.relations` 进**结局判据**（`endings.json` 已有 `9` 处 `relation` 条件，他们是新的可判对象）；
- **绝不**用 `trigger_end` 直接挂在他们身上。

一句话：**他们是变量，不是关卡。**

---

## 五、代价（说清楚会变差的地方）

1. **`echo` 那一级接缝会让"年数过渡"变少。** 现在玩家靠"又是几年"感知时间流逝；回望句优先之后，时间感会被情节感挤掉。缓解：`echo` 只在 `last_outcome` 存在时用，而日常节点 / 斗法节点不写 `last_outcome`，时间过渡仍会在那里出现。**大约六成的节点仍走时间过渡。**

2. **`omen` 通道会让"母题紧邻重复"上升。** 它绕过 `cooldown.same_motif`，而试玩已经在报 `73` 处紧邻重复。缓解：`omen` 事件必须单独过一遍母题闸（`omen` 之间仍互相冷却，只对非 `omen` 免疫）。**若不设这一条，`73` 会变成三位数。**

3. **接上 `world_effect` 会改变世界状态，可能打破已调好的平衡。** `region_tag` / `danger_delta` / `opens` / `closes` 影响什么，我没有全查（那属于 `systems-designer` 的管辖）。**建议这条单独走一次专家评审再动手**，不要跟本方案捆在一起上线 —— 它一次改变 `41` 个里程碑的行为，是本方案里风险最高的一项。

4. **事件级正文的写法会让内容工作量上升。** 我给的闸门是"`weight >= 80` 的事件必须写 `self_key`"，按当前权重分布，这会命中约一半事件。**这是有意的限制**：不设闸门的话，写的人只会挑顺手的写，剩下的一半永远共用母题文本。但代价是内容管线会变慢。

5. **关系写进 `state.relations` 后，`endings.json` 的判定面会扩大。** 那 `9` 处 `relation` 条件原本只对手写 NPC 生效，现在多了 `0–3` 个程序生成的对象，**结局分布会移动**。上线前必须跑 `npx tsx tools/sim.ts` 与 `tools/playtest.ts` 对比结局分布，**读数落在噪声里就明说测不准**，不要假装量准了。

---

## 六、给主 AI 的落地顺序建议

按"依赖关系 + 风险"排，不是按重要性排：

| 序 | 事项 | 依赖 | 风险 |
|---|---|---|---|
| 一 | 修 `evt_physique_contingency_04` 悬空引用；接 `coincidence` 到节点呈现；把 `advanceFate` 的返回值接上（仅 `milestone.narrative`，先不碰 `world_effect`） | 无 | 低 |
| 二 | `motifs.json` 补七个 `m_destiny_*`；接线 `param_slots` + `renderTemplate`；`self_key` 三级回落 | 无 | 低 |
| 三 | `transition.echo.*` 四级 L2 文本 + `last_outcome` 状态；试玩仪表加"回望覆盖率 / 空回落率 / followup 兑现率" | 二 | 低 |
| 四 | `chain` 字段 + 队首优先级；`channel: omen` + `omen_gap` + "接不接"第一拍 | 三 | 中 |
| 五 | 位面之子接入 `state.relations`；`@current` 扩到 `set_relation`；`destiny_relation` 条件 | 四 | 中 |
| 六 | `leadup_motifs` 纳入 `m_destiny_*`；关系影响命运线走向 | 五 | 中 |
| 七 | `world_effect` 真正生效 | 六 | **高 —— 单独评审** |

**门禁与工具必须与实现同批上线**（1.6 的四条 lint 规则 + 1.7 的三条指标）。**没有新指标的修复等于没有修复** —— 这一条本项目已经付过学费。

---

## 附：引用的资料

| 资料 | 关键句 |
|---|---|
| [Game balance § Aesthetics and narration](https://en.wikipedia.org/wiki/Game_balance) | "The visual impression of a game should not contradict with its balancing. On the contrary: Especially real models, e.g. historic facts, can serve as inspiration for mechanics, counters, orthogonal unit differences, intransitive relations." |
| [Game balance § Pacing](https://en.wikipedia.org/wiki/Game_balance) | "This turns balancing into **the management of dramatic structure**, generally referred to by game designers as 'pacing'." —— 奇遇的节奏是平衡问题，不只是叙事问题 |
| [Game balance § Randomization](https://en.wikipedia.org/wiki/Game_balance) | "The downside of randomization is that it takes control away from the player… Methods of overcoming this include **giving the player a selection of random results within which they can optimize**." —— `omen` 通道第一拍"接不接"的依据 |
| [Game balance § Counter](https://en.wikipedia.org/wiki/Game_balance) | "decisions that are made at the beginning of a game that cannot be revised by the player should not determine the outcome right away." —— 关系初始为"未识"、第一次交集才定的依据 |
| [Ghost Story Games](https://en.wikipedia.org/wiki/Ghost_Story_Games) | Ken Levine 的 narrative Legos："they can **distill narrative elements to key aspects that the player can learn, act upon, and affect** a non-linear narrative story, and then combine them in a way to make a player-driven, highly-replayable game."；他明说灵感来自《中土世界》的 **Nemesis System**，"provided a way to include a larger metanarrative in a game **without having to customize a lot of story or dialog for it**"；并提出 "**radical recognition**" —— 世界以**程序化**的方式回应玩家的行为，与 Telltale 式的分支对立 |
| [Judas (video game)](https://en.wikipedia.org/wiki/Judas_(video_game)) | "he had come up with the narrative Lego concept to consider **building a game without a fixed narrative, one that could be built from pre-built sections** of narrative, level design, art assets, and other aspects that could be **assembled on the fly in response to the player's actions**." |
| [Middle-earth: Shadow of Mordor](https://en.wikipedia.org/wiki/Nemesis_system) | "The game introduces the Nemesis System, which **allows the artificial intelligence of non-playable characters to remember their prior interactions** with Talion and react accordingly in subsequent encounters."；设计意图是 "**create personal stories for each player and generate memorable characters through gameplay**" —— 位面之子该对标的是这个，不是"随机 NPC" |
| [Wildermyth](https://en.wikipedia.org/wiki/Wildermyth) | Nate Austin：游戏 "**[alternates] layers of handcrafted and procedural content**"；"features a central narrative that has a defined beginning, middle and end, but it also incorporates procedural events… **These characters will also form both friendship or rival relationship with each other, and will age as time progresses.**" —— "手写与程序交替 + 人物之间有友谊/敌对关系"正是本方案要的结构 |
| [Dwarf Fortress](https://en.wikipedia.org/wiki/Dwarf_Fortress) | Legends mode："a listing of the events of historical figures… **Any notable achievement made by the player in any of the two game modes is recorded and is viewable in Legends mode.**"；Tynan Sylvester（RimWorld）："fascinated by how **the player and game could work together to create a narrative that actually worked**." —— "为什么玩家在意"的答案是**留下可回读的记录**，天命榜该做的是这件事 |
| [Procedural generation § Advantages and disadvantages](https://en.wikipedia.org/wiki/Procedural_generation) | "Most procedural generation algorithms can only use a fixed amount of parameters and assets, **leading to repetition**." —— 位面之子"内容集中在两个母题"（`87%`）正是这条 |
| [Narrative designer](https://en.wikipedia.org/wiki/Narrative_designer) | "the writer focuses on the characters within the game, while the designer focuses on **the player's experience of the story**… an active process to create a story through **a player's navigation of a dataspace**." —— 本方案的立场：事件是数据空间里的节点，不是段落 |
| [Ludonarrative dissonance](https://en.wikipedia.org/wiki/Ludonarrative_dissonance) | Hocking 论 BioShock：玩法承诺自由选择、叙事却强制单一结局，玩家被"拉出"游戏。**位面之子若做成主线任务列表，就是同一个错误**：玩法（自由）与叙事（必须面对）互斥 |

> 版本：`2026-09-20 / narrative-designer`。**本文件为方案，未改动任何代码或内容文件。**
