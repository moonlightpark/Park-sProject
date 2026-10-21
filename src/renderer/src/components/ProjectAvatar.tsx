import type { Settings } from '../lib/types'

const PALETTE = ['#8bc34a', '#5b8def', '#e0794c', '#b56be0', '#3fb8a8', '#e0b13f', '#e05c7a', '#6c7ae0']

/** 경로마다 늘 같은 색이 나오도록 해시로 고른다 */
export function autoColor(path: string): string {
  let h = 0
  for (const ch of path) h = (h * 31 + ch.charCodeAt(0)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

/** "Nimbalyst Tutorial" → "NT", "박프로 튜토리얼" → "박튜", "demo-ws" → "DW" */
export function defaultInitials(name: string): string {
  const words = name.split(/[\s_\-.]+/).filter(Boolean)
  const pick = words.length > 1 ? words.slice(0, 2).map((w) => [...w][0]) : [...(words[0] ?? '?')].slice(0, 2)
  return pick.join('').toUpperCase()
}

export type Appearance = Settings['projectAppearance'][string]

export function ProjectAvatar({ path, name, appearance, size = 28 }: { path: string; name: string; appearance?: Appearance; size?: number }) {
  const color = appearance?.color || autoColor(path)
  const initials = appearance?.initials?.trim() || defaultInitials(name)
  const style = { width: size, height: size, borderRadius: size * 0.26, fontSize: size * (initials.length > 2 ? 0.32 : 0.4) }
  if (appearance?.image) return <img className="project-avatar" src={appearance.image} alt={name} style={style} />
  return (
    <span className="project-avatar" style={{ ...style, background: color }}>
      {initials}
    </span>
  )
}
