/**
 * L3 —— 结局卷轴的实时生成（可选）。
 *
 * 设计前提（SPEC 第 7 章）：
 *   - 底座是 L2 预生成池，**没有 Key 也完整可玩**；
 *   - L3 只是「以玄机重写此卷」的一次额外润色，玩家自备 Key；
 *   - Key 只存本机 localStorage，请求由浏览器直连发出，不经任何第三方。
 *
 * 实现说明：这里用裸 fetch 而非 @anthropic-ai/sdk —— 本作有「主包要小」的硬约束，
 * 而这个调用是单次、无工具、无流式的极小面；引 SDK 只为这一个请求不划算。
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-8'
const VERSION = '2023-06-01'

export interface L3Input {
  apiKey: string
  /** 已结算的事实：境界、战力、因果、结局名等 */
  facts: string[]
  /** L2 原文，供模型改写而非凭空编造 */
  baseLines: string[]
  baseTitle: string
  verdict: string
  stars: number
}

export interface L3Result {
  title: string
  lines: string[]
}

const SYSTEM = `你是《玄》这款水墨修仙文字游戏的卷轴写手。
你的任务：为玩家这一世的终局，写一段克制的、似偈非偈的结局卷轴。

硬约束：
- 全文中文，半文半白，古意，留白。绝不出现阿拉伯数字、资源名、属性名、成功率等系统词。
- 不出现任何现实品牌、网址、联系方式。
- 不模仿、不引用任何已出版小说的专有名词。
- 语气克制，不煽情，不堆砌形容词。宁短勿长。
- 只依据给定的事实写，不得新增未经给出的事件。

输出格式（严格遵守，不要任何多余说明）：
第一行：标题，四到八字。
第二行：空行。
随后三行：正文，每行不超过三十字。`

/** 无 Key、断网、被拒、超时 —— 一律返回 null，由调用方回落 L2 */
export async function generateScroll(input: L3Input, timeoutMs = 45000): Promise<L3Result | null> {
  const key = input.apiKey.trim()
  if (!key) return null

  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)

  const user = [
    `结局：${input.baseTitle}（评语「${input.verdict}」，星级 ${input.stars}）`,
    '这一世的事实：',
    ...input.facts.map((f) => `· ${f}`),
    '',
    '既有的卷轴底稿（可改写、可重写，但不要改变事实走向）：',
    ...input.baseLines.map((l) => `· ${l}`),
    '',
    '请写出这一卷。',
  ].join('\n')

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': VERSION,
        // 浏览器直连所需；服务端会校验该头，缺失则被 CORS 拦下
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      }),
    })

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      console.warn(`[玄] L3 生成失败：HTTP ${resp.status}`, detail.slice(0, 400))
      return null
    }

    const data = (await resp.json()) as {
      content?: Array<{ type: string; text?: string }>
      stop_reason?: string
    }
    if (data.stop_reason === 'refusal') {
      console.warn('[玄] L3 生成被拒绝，回落 L2。')
      return null
    }
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim()
    if (!text) return null

    const lines = text
      .split('\n')
      .map((l) => l.replace(/^[·\-—*\s]+/, '').trim())
      .filter(Boolean)

    if (lines.length === 0) return null
    const title = lines[0]!.slice(0, 12)
    const body = lines.slice(1).slice(0, 5)
    return { title, lines: body.length > 0 ? body : input.baseLines }
  } catch (err) {
    console.warn('[玄] L3 生成异常，回落 L2。', err)
    return null
  } finally {
    window.clearTimeout(timer)
  }
}
