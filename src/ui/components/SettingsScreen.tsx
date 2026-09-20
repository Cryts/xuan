/**
 * 设置页 —— 音效 / 动效 / 字号 / L3 API Key。
 *
 * API Key 的风险提示不是免责套话，是必须讲清楚的三件事：
 *   1. Key 只存在这台设备的 localStorage，本作没有服务端；
 *   2. 请求由浏览器直连 Anthropic，Key 会出现在这一条请求里；
 *   3. 生成的卷轴是 AI 文本，会明确标注，且可一键退回原有文本。
 */

import { useState } from 'react'
import s from './SettingsScreen.module.css'
import { FreeInputSettings } from './FreeInputSettings'
import { Chip, SectionTitle } from './Shared'
import { clearSave, contentStats, useGame, type FontScale } from '@/ui/store'
import {
  IconBack,
  IconKey,
  IconMotion,
  IconMute,
  IconSound,
  IconTextSize,
  IconTrash,
} from '@/ui/icons'

function Toggle({
  on,
  onChange,
  label,
  hint,
  icon,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
  icon: React.ReactNode
}) {
  return (
    <button className={s.row} onClick={() => onChange(!on)} aria-pressed={on}>
      <span className={s.rowIcon}>{icon}</span>
      <span className={s.rowText}>
        <span className={s.rowLabel}>{label}</span>
        <span className="x-tiny">{hint}</span>
      </span>
      <span className={`${s.switch} ${on ? s.switchOn : ''}`}>
        <span className={s.knob} />
      </span>
    </button>
  )
}

const FS_OPTIONS: Array<{ id: FontScale; label: string }> = [
  { id: 'sm', label: '小' },
  { id: 'md', label: '中' },
  { id: 'lg', label: '大' },
]

export function SettingsScreen() {
  const { st, dispatch } = useGame()
  const [reveal, setReveal] = useState(false)
  const [draft, setDraft] = useState(st.settings.apiKey)
  const [saved, setSaved] = useState(false)

  const set = (patch: Partial<typeof st.settings>) => dispatch({ type: 'settings', patch })

  return (
    <div className={s.wrap}>
      <header className={s.head}>
        <button className={s.headBtn} onClick={() => dispatch({ type: 'goto', screen: st.returnTo })}>
          <IconBack size={18} />
        </button>
        <h1 className="x-h2">设 置</h1>
        <span className={s.spacer} />
      </header>

      <div className={s.body}>
        <section className={s.sec}>
          <SectionTitle text="体感" hint="随时可改" />
          <Toggle
            on={st.settings.sound}
            onChange={(v) => set({ sound: v })}
            label="音效"
            hint="木鱼与磬，全部由波形合成，不加载音频文件"
            icon={st.settings.sound ? <IconSound size={17} /> : <IconMute size={17} />}
          />
          <Toggle
            on={st.settings.motion}
            onChange={(v) => set({ motion: v })}
            label="动效"
            hint="关闭后取消一切过渡与动画；系统「减弱动态效果」始终优先"
            icon={<IconMotion size={17} />}
          />
        </section>

        <section className={s.sec}>
          <SectionTitle icon={<IconTextSize size={15} />} text="字号" hint="三档" />
          <div className={s.seg}>
            {FS_OPTIONS.map((o) => (
              <button
                key={o.id}
                className={`${s.segItem} ${st.settings.fontScale === o.id ? s.segOn : ''}`}
                onClick={() => set({ fontScale: o.id })}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className={s.demo}>风声穿过松林，他睁开眼 —— 此句用于预览字号。</p>
        </section>

        <section className={s.sec}>
          <SectionTitle icon={<IconKey size={15} />} text="L3 · 玄机" hint="可选，不填也能完整游玩" tone="gold" />

          <div className={s.keyRow}>
            <input
              className={s.input}
              type={reveal ? 'text' : 'password'}
              value={draft}
              placeholder="sk-ant-..."
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setDraft(e.target.value)
                setSaved(false)
              }}
            />
            <button className={`x-btn x-btn--sm ${s.mini}`} onClick={() => setReveal((v) => !v)}>
              {reveal ? '隐' : '显'}
            </button>
          </div>

          <div className={s.keyActions}>
            <button
              className="x-btn x-btn--sm"
              onClick={() => {
                set({ apiKey: draft.trim() })
                setSaved(true)
              }}
            >
              保存到本机
            </button>
            {st.settings.apiKey ? (
              <button
                className="x-btn x-btn--sm x-btn--quiet"
                onClick={() => {
                  setDraft('')
                  set({ apiKey: '' })
                  setSaved(false)
                }}
              >
                清除
              </button>
            ) : null}
            {saved ? <Chip tone="jade">已存在此设备</Chip> : null}
          </div>

          <div className={s.risk}>
            <p className={s.riskTitle}>风险提示 · 务必先读</p>
            <ul>
              <li>本作没有服务端。Key 只写入本机 localStorage，不会上传到任何第三方。</li>
              <li>
                生成时由你的浏览器<strong>直连 Anthropic 官方接口</strong>（会带上
                <code>anthropic-dangerous-direct-browser-access</code> 头），Key 会出现在这条请求里。
              </li>
              <li>请使用可随时吊销、额度受限的 Key；不要在公用设备上填写。</li>
              <li>浏览器扩展、公共电脑、共享账号环境下填 Key 都有泄露风险。</li>
            </ul>
          </div>

          <div className={s.aiNote}>
            <p className={s.riskTitle}>关于「AI 生成」标识</p>
            <p>
              本作的正文、事件、结局，全部来自构建期预生成的内容库，<strong>不调用任何实时模型</strong>。
              只有在结局页主动点下「以玄机重写此卷」时，才会实时生成一段卷轴文本；
              该段文本会始终带有<span className={s.gold}>「AI 生成」</span>标记，并可一键退回原有文本。
              它属于锦上添花，不属于本作的内容本体。
            </p>
          </div>
        </section>

        {/* 玄机 · 自由输入 —— 默认关，关着时这一节只有一行开关 */}
        <FreeInputSettings />

        <section className={s.sec}>
          <SectionTitle text="本局与内容" />
          <p className="x-small">{contentStats(st.content)}</p>
          <p className="x-tiny" style={{ marginTop: 6 }}>
            内容在构建期静态打包，运行时只读；关掉网络同样可玩。
          </p>
          <div className={s.danger}>
            <button
              className="x-btn x-btn--sm"
              onClick={() => {
                clearSave()
                dispatch({ type: 'abandon' })
              }}
            >
              <IconTrash size={14} />
              焚去此世存档
            </button>
            <span className="x-tiny">仅清除本机存档，不影响轮回点与内容库。</span>
          </div>
        </section>

        <p className={s.sign}>《玄》 · 可切换修炼体系的文字修仙 · v1.0</p>
      </div>
    </div>
  )
}
