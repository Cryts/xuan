/**
 * 音效 —— 全部由 WebAudio 合成，不加载任何音频文件（主包零体积代价）。
 *
 * 音色取向：木鱼 / 磬 / 纸页。短、干、无混响尾巴，与「克制留白」一致。
 * 尊重设置页的开关；AudioContext 在首次用户手势时才创建。
 */

interface AudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext
}

let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    ctx = null
  }
  return ctx
}

/** 一声「磬」：正弦 + 极快衰减 */
function strike(freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  const c = ac()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const t = c.currentTime
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.86), t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

export interface SfxGate {
  on: boolean
}

/** 选择一项：轻叩 */
export function sfxTap(on: boolean): void {
  if (!on) return
  strike(660, 0.1, 0.035, 'triangle')
}

/** 翻页 / 推进 */
export function sfxPage(on: boolean): void {
  if (!on) return
  strike(420, 0.16, 0.028, 'sine')
}

/** 参透 / 破局：三连磬 */
export function sfxReveal(on: boolean): void {
  if (!on) return
  strike(784, 0.5, 0.045)
  window.setTimeout(() => strike(1174, 0.6, 0.032), 90)
}

/** 大失败 / 结局：低钟 */
export function sfxToll(on: boolean): void {
  if (!on) return
  strike(196, 0.9, 0.05, 'sine')
  window.setTimeout(() => strike(147, 1.1, 0.038), 120)
}
