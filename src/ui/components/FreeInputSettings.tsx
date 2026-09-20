/**
 * 设置页的「玄机 · 自由输入」一节。
 *
 * 这一节的分寸：**默认关，且关着时它只是一行开关**。
 * 玩家不打开，就永远不填任何东西 —— 主路径（1–4 个选项）与从前一模一样。
 *
 * 密钥的两条去向要讲清楚：
 *   · 浏览器直连 —— 只写本机 localStorage，请求从浏览器发出；
 *   · 主进程（EXE）—— 写进主进程的配置文件，渲染进程**拿不到**（推荐）。
 */

import { useEffect, useState } from 'react'
import s from './SettingsScreen.module.css'
import si from './FreeInputSettings.module.css'
import { SectionTitle } from './Shared'
import {
  DEFAULT_API_MODEL,
  DEFAULT_API_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  EMPTY_CTX,
  PROVIDER_CHOICES,
  buildIntentCtx,
  nativeBridge,
  testFreeInput,
  type NativeLlmStatus,
  type TestOutcome,
} from '@/ui/intent'
import type { FreeInputSettings as FreeCfg } from '@/ui/intent/settings'
import { IconKey, IconSpark } from '@/ui/icons'
import { useGame } from '@/ui/store'

export function FreeInputSettings() {
  const { st, dispatch } = useGame()
  const [reveal, setReveal] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<TestOutcome | null>(null)
  const [native, setNative] = useState<NativeLlmStatus | null>(null)

  const fi = st.settings.freeInput
  const set = (patch: Partial<FreeCfg>) =>
    dispatch({ type: 'settings', patch: { freeInput: { ...fi, ...patch } } })

  const bridge = nativeBridge()
  const inElectron = Boolean(bridge?.isElectron)

  // 主进程里存没存密钥 —— 只问"有没有"，密钥本身从不回传
  useEffect(() => {
    if (!fi.enabled || !bridge?.llm?.status) return
    let alive = true
    bridge.llm
      .status()
      .then((v) => {
        if (alive) setNative(v ?? {})
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [fi.enabled, bridge])

  const runTest = async () => {
    if (testing) return
    setTesting(true)
    setTest(null)
    try {
      const ctx = st.state && st.pres ? buildIntentCtx(st.state, st.pres) : EMPTY_CTX
      setTest(await testFreeInput(fi, ctx))
    } catch (err) {
      console.warn('[玄] 连通性测试异常：', err)
      setTest({ ok: false, providerId: 'rule', label: '本地规则', detail: '测试本身出了问题，已回落本地规则。' })
    } finally {
      setTesting(false)
    }
  }

  const writeToMain = async () => {
    const llm = bridge?.llm
    if (!llm?.set) return
    try {
      await llm.set({ apiKey: fi.apiKey.trim(), baseUrl: fi.apiUrl.trim(), model: fi.apiModel.trim() })
      const v = (await llm.status?.()) ?? null
      setNative(v)
      // 密钥进了主进程，就不必再留一份在 localStorage 里
      set({ apiKey: '' })
    } catch (err) {
      console.warn('[玄] 写入主进程失败：', err)
    }
  }

  const showOllama = fi.provider === 'ollama' || fi.provider === 'auto'
  const showApi = fi.provider !== 'rule' && fi.provider !== 'ollama'

  return (
    <section className={s.sec}>
      <SectionTitle
        icon={<IconSpark size={15} />}
        text="玄机 · 自由输入"
        hint="实验分支 · 默认关"
        tone="gold"
      />

      <button className={s.row} onClick={() => set({ enabled: !fi.enabled })} aria-pressed={fi.enabled}>
        <span className={s.rowIcon}>
          <IconSpark size={17} />
        </span>
        <span className={s.rowText}>
          <span className={s.rowLabel}>开启自由输入</span>
          <span className="x-tiny">
            选项下方多出一行字：写下你自己想做的事。1–4 个选项仍是主路径 —— 关着时这一行根本不会出现。
          </span>
        </span>
        <span className={`${s.switch} ${fi.enabled ? s.switchOn : ''}`}>
          <span className={s.knob} />
        </span>
      </button>

      {!fi.enabled ? (
        <p className="x-tiny" style={{ marginTop: 6 }}>
          关着 = 与从前完全一样：不多一次请求，不存一个密钥，界面里也不会多出任何东西。
        </p>
      ) : (
        <>
          <div className={si.block}>
            <p className={si.label}>由谁来听这句话</p>
            <div className={si.seg5}>
              {PROVIDER_CHOICES.map((c) => (
                <button
                  key={c.id}
                  className={`${si.segItem} ${fi.provider === c.id ? si.segOn : ''}`}
                  onClick={() => set({ provider: c.id })}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="x-tiny">
              {PROVIDER_CHOICES.find((c) => c.id === fi.provider)?.hint ?? ''}
              <br />
              无论选哪个，<strong>听不懂时都会静默落回「本地规则」</strong> ——
              不弹窗、不报错，游玩不会因为模型出问题而中断。
            </p>
          </div>

          {showApi ? (
            <div className={si.block}>
              <p className={si.label}>接口地址 / 模型</p>
              <div className={s.keyRow}>
                <input
                  className={s.input}
                  value={fi.apiUrl}
                  placeholder={DEFAULT_API_URL}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => set({ apiUrl: e.target.value })}
                />
              </div>
              <div className={s.keyRow} style={{ marginTop: 8 }}>
                <input
                  className={s.input}
                  value={fi.apiModel}
                  placeholder={DEFAULT_API_MODEL}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => set({ apiModel: e.target.value })}
                />
              </div>

              <p className={si.label} style={{ marginTop: 14 }}>
                密钥
              </p>
              <div className={s.keyRow}>
                <input
                  className={s.input}
                  type={reveal ? 'text' : 'password'}
                  value={fi.apiKey}
                  placeholder="sk-..."
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => set({ apiKey: e.target.value })}
                />
                <button className={`x-btn x-btn--sm ${s.mini}`} onClick={() => setReveal((v) => !v)}>
                  {reveal ? '隐' : '显'}
                </button>
              </div>

              {inElectron ? (
                <div className={s.keyActions} style={{ marginTop: 8 }}>
                  <button className="x-btn x-btn--sm" onClick={writeToMain} disabled={!fi.apiKey.trim()}>
                    写入主进程
                  </button>
                  <span className="x-tiny">
                    主进程：{native?.hasKey ? '已存密钥' : '未存密钥'}
                    {native?.model ? ` · ${native.model}` : ''}
                  </span>
                </div>
              ) : null}

              <p className="x-tiny" style={{ marginTop: 8 }}>
                {inElectron
                  ? 'EXE 版建议写进主进程：密钥只存在本机配置文件里，渲染进程拿不到，也没有跨域这回事。'
                  : '本作没有服务端。密钥只写入本机 localStorage，请求由你的浏览器直连发出。请用可随时吊销、额度受限的密钥。'}
              </p>
            </div>
          ) : null}

          {showOllama ? (
            <div className={si.block}>
              <p className={si.label}>本地 Ollama（无需密钥）</p>
              <div className={s.keyRow}>
                <input
                  className={s.input}
                  value={fi.ollamaUrl}
                  placeholder={DEFAULT_OLLAMA_URL}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => set({ ollamaUrl: e.target.value })}
                />
              </div>
              <div className={s.keyRow} style={{ marginTop: 8 }}>
                <input
                  className={s.input}
                  value={fi.ollamaModel}
                  placeholder={DEFAULT_OLLAMA_MODEL}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => set({ ollamaModel: e.target.value })}
                />
              </div>
              <p className="x-tiny" style={{ marginTop: 6 }}>
                本机跑着 Ollama 时它才就绪；没跑就自动跳过，不会白等。
              </p>
            </div>
          ) : null}

          <div className={si.block}>
            <div className={s.keyActions}>
              <button className="x-btn x-btn--sm" onClick={runTest} disabled={testing}>
                <IconKey size={14} />
                {testing ? '参详中…' : '连通性测试'}
              </button>
              {test ? (
                <span className={test.ok ? si.ok : si.bad}>{test.ok ? '通' : '已回落'}</span>
              ) : null}
            </div>
            {test ? <p className={si.testLine}>{test.detail}</p> : null}
          </div>

          <div className={s.aiNote}>
            <p className={s.riskTitle}>这一层不会碰数值</p>
            <p>
              模型只做一件事：把你写的那句话翻译成 8 种意图之一，并指出你想对什么东西下手。
              成败、得失、掉多少修为，全部由本地的规则引擎算 ——
              <strong>模型说错话最多是「理解偏了」，不会凭空变出好处。</strong>
              它写的旁白在上屏前会剥掉全部数字。
            </p>
          </div>
        </>
      )}
    </section>
  )
}
