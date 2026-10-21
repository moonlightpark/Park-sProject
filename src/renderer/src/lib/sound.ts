import { api } from './api'

/** 완료 알림 소리. 기본 소리는 파일 없이 Web Audio 로 합성하고, '사용자 지정'은 고른 파일을 재생한다 */
export type SoundType = 'chime' | 'bell' | 'pop' | 'custom'

let ctx: AudioContext | null = null
const audio = (): AudioContext => (ctx ??= new AudioContext())

function tone(ac: AudioContext, out: AudioNode, freq: number, start: number, dur: number, type: OscillatorType, peak: number): void {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(gain).connect(out)
  osc.start(start)
  osc.stop(start + dur + 0.05)
}

export async function playSound(type: SoundType, volumePercent: number): Promise<void> {
  const volume = Math.max(0, Math.min(100, volumePercent)) / 100
  if (volume === 0) return
  if (type === 'custom') {
    const url: string | null = await api.notify.readSound()
    if (!url) return playSound('chime', volumePercent)
    const el = new Audio(url)
    el.volume = volume
    await el.play().catch(() => undefined)
    return
  }
  const ac = audio()
  if (ac.state === 'suspended') await ac.resume()
  const master = ac.createGain()
  master.gain.value = volume * 0.5
  master.connect(ac.destination)
  const now = ac.currentTime + 0.02
  if (type === 'chime') {
    tone(ac, master, 880, now, 0.5, 'sine', 0.6)
    tone(ac, master, 1318.5, now + 0.12, 0.7, 'sine', 0.5)
  } else if (type === 'bell') {
    for (const [mult, peak] of [
      [1, 0.6],
      [2.76, 0.25],
      [5.4, 0.12]
    ])
      tone(ac, master, 660 * mult, now, 1.4, 'sine', peak)
  } else {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.frequency.setValueAtTime(900, now)
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.09)
    gain.gain.setValueAtTime(0.8, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
    osc.connect(gain).connect(master)
    osc.start(now)
    osc.stop(now + 0.15)
  }
}
