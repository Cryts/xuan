# 附录 A：资源库 Schema 与可复用样例

> 用途：本附录是「构造阶段」的**直接输入**。每个 JSON 都可当作模板批量复制、改参数、跑 lint。
> 约定：所有 ID 使用 `snake_case`；数值一律走字符串表达式或区间，方便热更；文本一律走 `*_pool` 引用模板 ID，不写死在事件里。

---

## A0. 内容目录组织

```
content/
├── manifest.json                 # 版本 + hash + 分包索引
├── packs/
│   ├── mortal/                   # 凡人流（原创名：青冥仙途）
│   │   ├── pack.json             # 体系包主配置
│   │   ├── realms.json
│   │   ├── terms.json
│   │   ├── fail_modes.json
│   │   └── motif_weights.json
│   ├── genius/ … physique/ … mystery/ … rebel/ … cautious/
├── events/
│   ├── motifs.json               # 32+ 母题定义
│   ├── instances/                # 实例化事件，按阶段分文件
│   │   ├── childhood.json  entry.json  growth.json  turn.json  endgame.json
│   │   └──清算/debt_events.json
├── narrative/
│   ├── templates.json            # 变量槽模板
│   ├── flavor.json               # 旁白/谶语/判词
│   └── names/                    # 姓/名/道号/地名/宗门/法宝/丹药
├── items/{items.json, affixes.json}
├── world/{npcs.json, factions.json, regions.json}
├── meta/{endings.json, codex.json, origins.json, traits.json, flaws.json, destinies.json}
├── balance/{curves.json, probabilities.json, economy.json}
└── prompts/{narrative.json, safety.json, classify.json}
```

---

## A1. World Pack 样例（凡人流 · 原创命名版）

```jsonc
{
  "pack_id": "mortal",
  "display_name": "青冥仙途",
  "inspiration_tag": "凡人流（慢热经营 / 稳健逆袭）",
  "version": "1.0.0",
  "rule_ref": "engine@2026-09",
  "realms": [
    { "idx": 0,  "name": "凡人", "power_index": [0, 5],    "lifespan": 80,     "breakthrough": 1.00 },
    { "idx": 1,  "name": "炼气", "power_index": [5, 15],   "lifespan": 120,    "breakthrough": 0.90 },
    { "idx": 2,  "name": "筑基", "power_index": [15, 35],  "lifespan": 200,    "breakthrough": 0.78 },
    { "idx": 3,  "name": "结丹", "power_index": [35, 70],  "lifespan": 400,    "breakthrough": 0.68 },
    { "idx": 4,  "name": "元婴", "power_index": [70, 120], "lifespan": 800,    "breakthrough": 0.58 },
    { "idx": 5,  "name": "化神", "power_index": [120, 180],"lifespan": 1600,   "breakthrough": 0.50 },
    { "idx": 6,  "name": "炼虚", "power_index": [180, 250],"lifespan": 3200,   "breakthrough": 0.44 },
    { "idx": 7,  "name": "合体", "power_index": [250, 330],"lifespan": 6400,   "breakthrough": 0.38 },
    { "idx": 8,  "name": "大乘", "power_index": [330, 430],"lifespan": 12800,  "breakthrough": 0.32 },
    { "idx": 9,  "name": "渡劫", "power_index": [430, 560],"lifespan": 25600,  "breakthrough": 0.24 },
    { "idx": 10, "name": "真仙", "power_index": [560, 700],"lifespan": null,   "breakthrough": 0.18 },
    { "idx": 11, "name": "金仙", "power_index": [700, 850],"lifespan": null,   "breakthrough": 0.14 },
    { "idx": 12, "name": "大罗", "power_index": [850, 1000],"lifespan": null,  "breakthrough": 0.10 }
  ],
  "resource_map": {
    "currency":  { "name": "灵石", "tiers": ["下品", "中品", "高品", "极品"] },
    "power":     { "name": "灵力" },
    "rare_mat":  { "name": "灵药", "subtypes": ["灵草", "灵丹", "灵矿"] },
    "favor":     { "name": "宗门贡献" },
    "debt":      { "name": "因果" },
    "corruption":{ "name": "心魔", "enabled": true, "threshold": 60 }
  },
  "goldfinger_slots": [
    { "id": "bottle", "name": "催熟残瓶", "rarity": "S", "effects": ["herb_growth_x3", "exposure+2"] },
    { "id": "old_man", "name": "残魂导师", "rarity": "A", "effects": ["teach_skill", "debt+1"] }
  ],
  "fail_modes": [
    { "id": "resource_drought", "trigger": "currency<10 && rare_mat==0", "text_ref": "flavor_drought" },
    { "id": "robbed",  "trigger": "debt>=5", "text_ref": "flavor_robbed" },
    { "id": "heart_demon", "trigger": "corruption>=80", "text_ref": "flavor_heart_demon" }
  ],
  "motif_weights": {
    "m_cave_relic": 1.6, "m_mystic_treasure": 1.4, "m_market_bargain": 1.5,
    "m_sect_tournament": 1.0, "m_tribulation": 1.2, "m_sealed_object": 0.3,
    "m_outer_god_whisper": 0.0
  },
  "tone": { "narration": "克制、冷静、留白", "humor": 0.15, "violence": 0.3 }
}
```

### 术语词典（terms.json 片段）

```jsonc
{
  "pack_id": "mortal",
  "dict": {
    "LEVEL_UP":       ["突破", "结丹", "破境"],
    "COMBAT":         ["斗法", "御剑", "斗法台"],
    "LOOT":           ["遗府", "法宝", "灵药"],
    "RISK":           ["心魔", "天劫", "仇家"],
    "BOND":           ["师徒", "道侣", "护道人"],
    "CULTIVATE":      ["吐纳", "闭关", "打坐"],
    "REALM_NAME":     ["境界"],
    "UI_CURRENCY":    ["灵石"],
    "UI_POWER":       ["修为"],
    "UI_LIFESPAN":    ["寿元"],
    "PLACE_SUFFIX":   ["山", "谷", "渊", "崖", "洞", "原"],
    "SECT_SUFFIX":    ["宗", "门", "派", "阁", "观"]
  }
}
```

### 术语去 IP 化对照（构造时必查）

| 类型 | 原著词（避免直接使用） | 原创替代表达 |
|---|---|---|
| 法宝 | 掌天瓶 | 催熟残瓶 / 青冥瓶 / 沐灵瓶 |
| 异宝榜 | 异火榜 | 炎灵谱 / 天火录 |
| 功法名词 | 大衍诀、青元剑诀 | 演天诀、青冥剑经 |
| 组织 | 魂殿、塔罗会 | 幽冥殿、灰雾议团 |
| 血脉设定 | 至尊骨、荒古圣体 | 太古骨篆、莽荒体 |
| 序列体系 | 序列 9 / 途径名 | 阶位九品 / 各自原创途径名（如"观星者""执灯人"） |
| 地名 | 云岚宗、天焚炼气塔 | 云隐宗、焚天炼气塔 |

**执行规则**：`content-lint` 内置禁用词表（≥300 词），命中即构建失败。

---

## A2. 事件实例完整样例（四选项）

```jsonc
{
  "id": "evt_mortal_cave_bottle",
  "pack": ["mortal"],
  "motif": "m_cave_relic",
  "stage": ["childhood", "entry"],
  "weight": 100,
  "tension": 3,
  "once_per_run": true,
  "requires": {
    "realm_idx": "<=2",
    "attrs": { "luck": ">=30" },
    "flags_none": ["bottle_owned"],
    "region_tag": ["wild"]
  },
  "cooldown": { "same_motif": 5 },
  "narrative": {
    "title_pool": ["雾锁寒潭", "残府遗光"],
    "body_pool": ["narr_cave_bottle_a", "narr_cave_bottle_b"],
    "ai_enhance": "optional"
  },
  "options": [
    {
      "id": "a", "intent": "greedy", "risk_tier": "险", "odds_hint": "未卜",
      "text": "伸手触碰瓶口残存的液滴",
      "resolve": {
        "roll": { "base": 0.55, "attr": "wits", "attr_weight": 0.15 },
        "bands": [
          { "band": "crit", "narrative": "narr_bottle_crit",
            "effects": [
              { "type": "add_item", "ref": "item_bottle", "quality": "仙品" },
              { "type": "add_attr", "key": "luck", "delta": 10 },
              { "type": "set_flag", "key": "bottle_owned" }
            ],
            "flags_set": ["bottle_owned", "goldfinger_tier_S"] },
          { "band": "success", "narrative": "narr_bottle_ok",
            "effects": [
              { "type": "add_item", "ref": "item_bottle", "quality": "灵品" },
              { "type": "add_var", "key": "exposure", "delta": 2 }
            ],
            "flags_set": ["bottle_owned"] },
          { "band": "fail", "narrative": "narr_bottle_fail",
            "effects": [
              { "type": "add_var", "key": "power", "delta": -50 },
              { "type": "add_var", "key": "hp", "delta": -20 }
            ] },
          { "band": "crit_fail", "narrative": "narr_bottle_critfail",
            "effects": [
              { "type": "add_var", "key": "corruption", "delta": 15 },
              { "type": "add_var", "key": "debt", "delta": 2 },
              { "type": "set_flag", "key": "cursed" }
            ],
            "queue_followup": "evt_debt_robbery@3-8" }
        ]
      }
    },
    {
      "id": "b", "intent": "steady", "risk_tier": "稳", "odds_hint": "有把握",
      "text": "先以符箓试探禁制，再取瓶",
      "requires": { "items_any": ["talisman_ward"] },
      "resolve": {
        "roll": { "base": 0.75, "attr": "wits", "attr_weight": 0.20 },
        "bands": [
          { "band": "crit", "effects": [{ "type": "add_item", "ref": "item_bottle", "quality": "宝品" }, { "type": "add_var", "key": "wits", "delta": 2 }], "flags_set": ["bottle_owned"] },
          { "band": "success", "effects": [{ "type": "add_item", "ref": "item_bottle", "quality": "凡品" }], "flags_set": ["bottle_owned"] },
          { "band": "fail", "effects": [{ "type": "consume_item", "ref": "talisman_ward" }, { "type": "add_var", "key": "power", "delta": -20 }] },
          { "band": "crit_fail", "effects": [{ "type": "add_var", "key": "hp", "delta": -35 }], "queue_followup": "evt_injured_recover@1-3" }
        ]
      }
    },
    {
      "id": "c", "intent": "social", "risk_tier": "常", "odds_hint": "有把握",
      "text": "将残瓶带回师门，换取贡献与庇护",
      "requires": { "faction_tier": ">=2" },
      "resolve": {
        "roll": { "base": 0.85, "attr": "charm", "attr_weight": 0.15 },
        "bands": [
          { "band": "crit", "effects": [{ "type": "add_var", "key": "favor", "delta": 120 }, { "type": "add_var", "key": "currency", "delta": 300 }, { "type": "unlock_title", "ref": "title_loyal" }] },
          { "band": "success", "effects": [{ "type": "add_var", "key": "favor", "delta": 60 }, { "type": "add_var", "key": "currency", "delta": 120 }] },
          { "band": "fail", "effects": [{ "type": "add_var", "key": "favor", "delta": 20 }] },
          { "band": "crit_fail", "effects": [{ "type": "add_var", "key": "exposure", "delta": 5 }, { "type": "add_var", "key": "debt", "delta": 3 }], "queue_followup": "evt_debt_robbery@2-6" }
        ]
      }
    },
    {
      "id": "d", "intent": "flee", "risk_tier": "稳", "odds_hint": "十拿九稳",
      "text": "记下方位，待筑基后再来",
      "resolve": {
        "roll": { "base": 0.95 },
        "bands": [
          { "band": "success", "effects": [{ "type": "set_flag", "key": "cave_marked" }, { "type": "add_var", "key": "temper", "delta": 3 }],
            "queue_followup": "evt_mortal_cave_return@6-15" },
          { "band": "fail", "effects": [{ "type": "add_var", "key": "luck", "delta": -3 }] }
        ]
      }
    }
  ],
  "followups": ["evt_mortal_bottle_exposed@debt>=3"],
  "tags": ["goldfinger", "cave", "early"],
  "meta_unlock": { "codex": "bottle", "title": "掌瓶者" },
  "version": "1.0.0"
}
```

### 效果类型枚举（effects.type 全表）

| type | 参数 | 说明 |
|---|---|---|
| `add_var` / `sub_var` | key, delta / expr | 资源与长期变量（currency/power/favor/debt/exposure/corruption/karma/hp/lifespan） |
| `add_attr` | key(root/wits/temper/luck/wits2/charm), delta | 六维属性 |
| `add_item` / `consume_item` | ref, quality?, count? | 物品 |
| `add_affix` | target, affix_id | 词条 |
| `set_flag` / `clear_flag` | key | 分支标记 |
| `set_relation` | npc_id, kind, delta | 师徒/道侣/仇家 |
| `queue_followup` | evt_id@min-max | 连锁事件与窗口 |
| `force_stage_jump` | stage | 阶段跳跃 |
| `unlock_title` / `unlock_codex` | ref | 元进度 |
| `trigger_end` | ending_id | 直接结局 |
| `modify_power_index` | delta / expr | 直接改境界进度（谨慎使用） |

---

## A3. 叙事模板样例（变量槽）

```jsonc
{
  "id": "narr_cave_bottle_a",
  "slot_schema": ["location", "weather", "npc_role", "item", "realm"],
  "body": [
    "{weather}的{location}里，断碑半没入水。你拨开腐叶，露出半只{item}，釉面浮着一层薄霜。",
    "身后传来极轻的呼吸声——不是兽。你握紧{weapon}，缓缓转身。",
    "雾散处，只余一串湿脚印，通向更深的黑暗。"
  ],
  "variables": {
    "weather": ["雾", "细雨", "残雪", "月色"],
    "location": ["寒潭", "断崖石窟", "荒庙地宫", "枯井"],
    "npc_role": ["采药人", "散修", "守墓人"],
    "item": ["青冥瓶", "残破玉葫芦", "青铜小鼎"],
    "weapon": ["木剑", "铁剑", "符箓"]
  },
  "mood": "eerie",
  "forbid_numbers": true
}
```

**模板工程规则：**
- 每条模板 2–4 段，每段 ≤60 字；
- 变量槽必须在 `variables` 中定义，缺值用中性默认；
- `forbid_numbers=true` 的模板禁止出现阿拉伯数字与资源词；
- 同事件 3–8 个变体，变体间至少替换 2 个变量槽。

---

## A4. 结局库样例

```jsonc
{
  "id": "end_ascend_plain",
  "pack": ["*"],
  "tier": "A",
  "category": "飞升",
  "requires": { "realm_idx": ">=10", "corruption": "<40", "karma": ">=-20" },
  "title_pool": ["白日飞升", "天门开"],
  "body_ref": "narr_end_ascend_a",
  "rating": { "stars_rule": "power_index/200 + karma/50 - debt/20", "min_stars": 3 },
  "meta_reward": { "legacy_points": 30, "unlock": ["origin_immortal_shard", "codex_ascend"] },
  "ai_enhance": "required",
  "ai_budget": { "max_tokens": 260, "temperature": 0.8 }
}
```

**结局分类覆盖（≥60 条首发）**：飞升（5 变体）、称尊/一界之主（4）、隐居（4）、道陨（6）、走火入魔（4）、沦为他人道果（3）、转世再来（4）、封印自身（3）、屠尽仇寇（3）、以身殉道（3）、成谜失踪（3）、诡秘终局（成神/失控/外神容器，6）、苟道长寿（3）、凡尘终老（3）、因果清算（4）、特殊彩蛋（2）。

---

## A5. 命名库与组合规则

```jsonc
{
  "surname": ["沈", "陆", "姜", "云", "裴", "燕", "竺", "容", "谢", "百里", "第五", "澹台"],
  "given_male": ["砚", "舟", "珩", "澈", "寻", "照", "野", "辞", "度", "青崖"],
  "given_female": ["蘅", "疏", "琳", "窈", "霜", "眠", "素", "绫", "婳"],
  "dao_title_rule": "{element}+{noun}+{suffix}",
  "element": ["青", "玄", "赤", "素", "幽", "太一", "无相"],
  "noun": ["冥", "崖", "澜", "枢", "灯", "舟", "尘"],
  "suffix": ["子", "真人", "道人", "散人", "上人", "仙子", "尊者"],
  "sect_rule": "{place}+{sect_suffix}",
  "pill_rule": "{effect}+{color/material}+丹",
  "weapon_rule": "{prefix}+{material}+{type}",
  "constraints": {
    "max_length": 4,
    "forbid_real_brands": true,
    "forbid_obscene_homophone": true,
    "uniqueness_check": "global"
  }
}
```

生成后跑三项检查：撞原著名词检测、重名检测、谐音不雅检测。

---

## A6. 提示词库样例

### A6.1 叙事生成（L3）

```text
【角色】你是国风文字修仙游戏的叙事官，只负责"描写"，不负责"判定"。
【世界】体系：{pack_name}；术语表：{term_snippet}；当前境界：{realm_name}；地点：{location}；语气：{tone}。
【任务】根据下面的"事件结果"，写一段 {n_lines} 行的短描写，每行不超过 60 字。
【输入】母题：{motif}；选项意图：{intent}；判定段位：{band}；可用变量：{slots}
【硬性约束】
1. 禁止出现任何数字、货币名、属性名、资源名、成功率、系统词；
2. 禁止出现现实品牌、联系方式、外链、政治与色情内容；
3. 不得改变既定结果：{band} 的基调是 {band_tone}；
4. 使用 {pack_name} 的术语词表，不要混入其他体系的名词；
5. 只输出 JSON：{title, lines[], mood, forbidden_check_passed}
【示例】
输入：母题=山洞遗府，意图=greedy，段位=crit
输出：{"title":"寒潭遗光","lines":["断碑后浮出半只青冥瓶，釉上凝着千年霜。","你指尖刚触瓶口，识海便绽开一缕清明。","雾里似有人低诵：此物，等你很久了。"],"mood":"eerie","forbidden_check_passed":true}
```

### A6.2 安全审核（输出侧）

```text
你是内容安全审核器。对给定文本输出 JSON：{level: safe|review|block, hits:[类型], rewrite_hint}
类型枚举：violence, erotic, politics, real_person, brand, contact, suicide, hate, minor_unsafe, offworld_terms, number_leak
规则：出现数值或资源词 → number_leak（触发降级为模板）；出现现实品牌/联系方式 → block；涉及未成年人不宜 → block。
```

### A6.3 意图分类（仅在开放输入试点时启用）

```text
把玩家输入映射到白名单意图之一：[cultivate, explore, rest, trade, fight, flee, talk, use_item, ask_info, other]
只输出 {intent, confidence, entities[]}。无法映射时返回 other，并给出拒绝话术模板 ID。
```

---

## A7. API 契约样例

```jsonc
// POST /turn/submit
{
  "run_id": "r_7f3a", "node_index": 12, "option_id": "b",
  "idempotency_key": "r_7f3a:12",
  "content_version": "1.12.3", "rule_version": "2026-09"
}
// 200
{
  "request_id": "req_x",
  "delta": [
    { "key": "power", "from": 1240, "to": 1360, "reason": "cultivate" },
    { "key": "exposure", "from": 4, "to": 6, "reason": "evt_mortal_cave_bottle:b" }
  ],
  "band": "success",
  "narrative": { "title": "雾锁寒潭", "lines": ["……"], "mood": "eerie", "source": "L1" },
  "next": { "node_index": 13, "event_id": "evt_growth_beast", "options_preview": 3 },
  "state": { "realm_idx": 2, "power_index": 28, "lifespan": 196, "hp": 80, "corruption": 0, "debt": 2 },
  "rng_proof": { "seed": "srv:9c1e...", "roll": 0.62 }
}
```

---

## A8. 内容校验（content-lint）规则清单

| 规则 | 说明 | 级别 |
|---|---|---|
| `schema_valid` | 全部 JSON 通过 JSON Schema | error |
| `ref_resolvable` | 所有 `*_pool` / `ref` / `followup` ID 存在 | error |
| `no_ip_terms` | 命中禁用词表（原著名词） | error |
| `no_numbers_in_narrative` | `forbid_numbers` 模板出现数字 | error |
| `option_diff` | 同一事件各选项改写的长期变量不可完全相同 | warn |
| `weight_health` | 单阶段事件数 <30 或某事件权重占比 >15% | warn |
| `attr_balance` | 出身/天赋属性加成总和超阈值 | warn |
| `curve_montinuity` | 境界 power_index 区间不连续或倒挂 | error |
| `ending_coverage` | 结局分类缺失 | warn |
| `sim_10k` | 蒙特卡洛 1 万局的结局分布与时长分布超阈值 | warn |

---

## A9. 蒙特卡洛模拟输出样例（balance 验证）

```jsonc
{
  "runs": 100000,
  "avg_duration_min": 6.4,
  "avg_nodes": 24.3,
  "ending_distribution": { "飞升": 0.06, "道陨": 0.31, "隐居": 0.12, "走火入魔": 0.09, "其他": 0.42 },
  "death_by_realm": { "炼气": 0.08, "筑基": 0.19, "结丹": 0.24, "元婴": 0.22, "化神": 0.17, "更高": 0.10 },
  "build_diversity_index": 0.71,
  "inflation_curve": { "node_10": 1.0, "node_20": 2.3, "node_30": 5.8 },
  "verdict": "pass"
}
```

**验收阈值建议**：平均时长 5–8 分钟；道陨率 ≤40%；build 多样性 ≥0.65；通胀曲线末段不超过首段 8 倍。
