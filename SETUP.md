# 本地跑起来

三种跑法，按你想做的事选。**游戏本体不需要下载任何模型**——它现在是纯静态的，所有文本都在仓库里。

---

## 一、改代码 / 看效果（最常用）

```bash
git clone git@github.com:Cryts/xuan.git
cd xuan
npm install          # 大约 1 分钟
npm run dev          # → http://localhost:5173/
```

改任何文件浏览器里立刻热更新。这是迭代的主要方式。

**常用命令**

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发（热重载） |
| `npm test` | 单元测试（86 个） |
| `npm run lint:content` | **内容门禁**：IP 禁用词、境界曲线、剧本科解性、正文可达性、阶段覆盖 |
| `npm run check:core` | 核心纯度：`src/core` 不得引入浏览器 API |
| `npx tsx tools/playtest.ts 500` | **试玩 agent**：500 局自动试玩，产出 `playtest-findings.md` |
| `npx tsx tools/sim.ts 1000` | 蒙特卡洛平衡验证（三种玩家原型对比） |
| `npx tsx tools/originality-report.ts` | 原创性报告：全部专名 vs 原著名单 |
| `npm run build` | 生产构建 → `dist/` |

推送到 `main` 后 GitHub Actions 会自动跑完整门禁并部署到 https://cryts.github.io/xuan/ 。

---

## 二、让试玩 agent 长期跑（发现问题、积累经验）

这是你要的「不断发现问题积累经验」的部分。它不需要浏览器、不需要模型——`game-core` 是纯 TS，在 Node 里直接跑。

```bash
# 跑一轮并生成清单
npx tsx tools/playtest.ts 2000

# 看结果
cat playtest-findings.md
```

清单会告诉你：空节点、破不了的剧本、从未出现的结局、从未抽中的事件、行囊对不上的功能标签。

想让它**持续**跑，用 cron 每天跑一次并对比：

```bash
# 每天凌晨 3:17 跑一轮，结果追加到历史里
17 3 * * * cd ~/xuan && npx tsx tools/playtest.ts 3000 >> playtest-history.log 2>&1
```

> 为什么避开整点：整点是所有人设 cron 的时间，机器会挤在一起。错开几分钟没人在意，但省事。

---

## 三、接本地模型（要自由输入/意图识别时才需要）

自由输入那个分支需要意图识别。**现阶段建议先接 API**（见下），把接口留好；真要跑本地时再装 Ollama。

### 3.1 最省事：先接 API

不需要下载任何模型。在游戏的**设置页**填入 API Key 即可（存在浏览器 `localStorage`，只在本机使用）。

代码层面走的是 `IntentProvider` 接口，之后换实现只改配置：

```ts
// src/ui/intent.ts（示意）
export interface IntentProvider {
  classify(input: string, ctx: GameContext): Promise<IntentResult>
}
```

三种实现可互换：`ApiProvider`（直连模型）/ `OllamaProvider`（本地）/ `RuleProvider`（纯规则兜底）。

### 3.2 装本地模型：Ollama

```bash
# Linux / macOS
curl -fsSL https://ollama.com/install.sh | sh

# 拉一个中文够用的中小模型
ollama pull qwen2.5:7b        # 约 4.7 GB，中文最好
# 或更小的（跑得动就行）：
ollama pull qwen2.5:3b        # 约 2 GB
```

**硬件参考**（意图识别是短分类任务，不需要大模型）：

| 模型 | 显存/内存 | 说明 |
|---|---|---|
| `qwen2.5:3b` | ~3 GB | 够用，最快 |
| `qwen2.5:7b` | ~6 GB | 中文明显更好，推荐 |
| `glm4:9b` | ~8 GB | 中文强，稍慢 |

**让游戏连上它**：Ollama 默认监听 `http://localhost:11434`，且**允许跨域**（需设 `OLLAMA_ORIGINS`）：

```bash
OLLAMA_ORIGINS='*' ollama serve
```

然后在游戏设置页把 Provider 选成 `ollama`，地址填 `http://localhost:11434`。**密钥那一栏留空**。

> 注意：本地模型这条路只在**你自己的机器上**成立——浏览器访问 `localhost` 是访问你自己的机器。公开部署的版本用不了它，那是浏览器安全模型决定的，不是代码问题。

### 3.3 完全不想装东西：浏览器内置小模型

把 0.5B–1.5B 的模型跑在浏览器里（WebLLM / transformers.js），保持纯静态部署。代价是首次要下载 1–4 GB、手机上基本跑不动、每次推理等几秒。适合做演示，不适合日常迭代。

---

## 四、部署

推送到 `main` 即自动部署（`.github/workflows/deploy.yml`）。

首次需要在仓库设置里开一次 Pages：
**Settings → Pages → Source 选 "GitHub Actions"**。

工作流会依次跑：内容门禁 → 核心纯度 → 单元测试 → 构建 → 部署。
**任一门禁失败就不会上线**——这是故意的，防止违反 IP 规范或缺正文的内容溜上去。

---

## 五、目录速览

```
src/core/        纯 TS 引擎（零浏览器依赖，可在 Node 独立跑）
  engine.ts        状态机 · 调度器 · 剧本推进 · 结局结算
  conditions.ts    破局条件求值（13 种条件类型 + any/all/not）
  destiny.ts       位面之子：气运护体、智谋型反制
  affinity.ts      相性环（气→体→灵→则→意→气，势不入环）
src/content/     全部内容（6 体系包 / 553 事件 / 12 剧本 / 64 结局）
  narrative/       叙事池，多文件合并（l2.json 基座 + l2_*.json 增量）
src/ui/          React 视图层
tools/           门禁与验证工具
docs/            设计文档与调研
```
