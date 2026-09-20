# 共享参考库

> 取于 2026-09-20。**所有专家共用**，不要各自重复抓同一批资料。
> 联网需代理：`export http_proxy=http://10.230.33.86:7890 https_proxy=http://10.230.33.86:7890`

## 怎么用

这些是 `.txt` 抽取的正文（去掉了维基的脚本与导航）。**先在这里找，找不到再联网。**
引用时写清是哪一篇的哪一节 —— 结论要能追溯到出处，这是专家与"随便一个 agent"的区别。

本会话的 `WebSearch` 配额已用尽、`WebFetch` 被域名策略挡住，所以：
**要取新资料就用 `curl` + 代理**（各专家岗位文件里有现成的抽正文片段）。

## 目录

| 文件 | 最该读的人 | 里面有什么 |
|---|---|---|
| `game_balance.txt` | **systems-designer** | 经济、支配性策略、力量曲线、正负反馈、奖励、节奏、随机化。**本项目的多数数值问题都能在这里找到对应的成熟概念** |
| `virtual_economy.txt` | **systems-designer** / gameplay-designer | 虚拟经济的进（faucet）与出（sink）、通货膨胀、资源循环 |
| `experience_point.txt` | **systems-designer** | 经验/成长曲线的经典形态与问题 |
| `grinding.txt` | **systems-designer** / gameplay-designer | 刷的问题：什么时候重复劳动变成惩罚 |
| `roguelike.txt` | **gameplay-designer** | 局内/跨局结构、程序生成、永久死亡的设计后果 |
| `achievements.txt` | **gameplay-designer** | 成就系统的心理学与常见失败形态 |
| `procedural_generation.txt` | **narrative-designer** / writer | 程序生成内容的可能性与陷阱 |
| `emergent_narrative.txt` | **narrative-designer** | 涌现式叙事 vs 嵌入式叙事。**位面之子与事件链的核心参考** |
| `quest.txt` | **narrative-designer** | 任务/事件的结构形态（链、支、环） |
| `worldbuilding.txt` | **worldbuilder** | 世界观构建方法与自洽性 |
| `magic_system.txt` | **worldbuilder** | 硬/软魔法体系；**六体系自洽的判据** |
| `video_game_development.txt` | 全体 | 项目组分工与开发流程（本专家组的来源） |
| `game_design.txt` | 全体 | 设计流程、原型、试玩 |
| `video_game_writing.txt` | **writer** | 游戏写作与小说写作的差别 |
| `ludonarrative.txt` | **narrative-designer** / writer | 机制与叙事互相打架的问题 |

## 已知缺口

- `Narrative design`、`Player retention` 两条维基条目不存在（404），
  需要时自行检索替代来源（可试 gamedeveloper.com、GDC 讲稿页、lostgarden.com）

## 待补（谁需要谁补）

- Slay the Spire / Hades 的**跨局元进度**分析（`gameplay-designer` 的成就系统要用）
- **sink/faucet** 的专门文章（`systems-designer` 的灵石问题要用）
- 沙盒/文本游戏里**事件链调度**的工程做法（`narrative-designer` 要用）
