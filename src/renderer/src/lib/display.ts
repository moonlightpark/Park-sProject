import { api } from './api'
import type { ProjectAppearance, Settings } from './types'

/** 프로젝트 모양 → 화면 설정. 프로젝트에 정한 값이 없으면 애플리케이션 기본값을 쓴다 */
export interface Display {
  theme: Settings['theme']
  uiScale: number
  editorFontSize: number
  editorFont: NonNullable<ProjectAppearance['editorFont']>
}

export const UI_SCALES = [0.9, 1, 1.1, 1.25] as const

export const EDITOR_FONTS: Record<'system' | 'gothic' | 'serif' | 'mono', string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Pretendard', 'Noto Sans KR', sans-serif",
  gothic: "'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif",
  serif: "'AppleMyungjo', 'Nanum Myeongjo', 'Noto Serif KR', 'Batang', serif",
  mono: "'SF Mono', 'D2Coding', Menlo, monospace"
}

const isPreset = (f: string): f is keyof typeof EDITOR_FONTS => f in EDITOR_FONTS

/** 편집기 글꼴 설정 → CSS font-family. 시스템 글꼴 이름이면 그 글꼴을 먼저 쓰고, 없는 글자는 기본 글꼴로 */
export function editorFontCss(font: string): string {
  return isPreset(font) ? EDITOR_FONTS[font] : `"${font.replace(/["\\]/g, '')}", ${EDITOR_FONTS.system}`
}

let fontList: Promise<string[]> | null = null
/** 이 컴퓨터에 설치된 글꼴 이름 (가나다·ABC 순). 처음 한 번만 읽고 기억한다 */
export function systemFonts(): Promise<string[]> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
  if (!query) return Promise.resolve([])
  fontList ??= query()
    .then((fonts) => [...new Set(fonts.map((f) => f.family))].filter((f) => !f.startsWith('.')).sort((a, b) => a.localeCompare(b, 'ko')))
    .catch(() => ((fontList = null), []))
  return fontList
}

export function effectiveDisplay(settings: Settings, workspace: string | null): Display {
  const a = (workspace && settings.projectAppearance?.[workspace]) || {}
  return {
    theme: a.theme ?? settings.theme,
    uiScale: a.uiScale ?? 1,
    editorFontSize: a.editorFontSize ?? settings.editorFontSize,
    editorFont: a.editorFont ?? 'system'
  }
}

/** 이 프로젝트의 화면 설정을 바꾼다. undefined 를 넘기면 그 항목은 기본값으로 돌아간다 */
export function setProjectDisplay(settings: Settings, workspace: string, patch: Partial<ProjectAppearance>): void {
  const all = { ...(settings.projectAppearance ?? {}) }
  const next: ProjectAppearance = { ...(all[workspace] ?? {}), ...patch }
  for (const k of Object.keys(next) as (keyof ProjectAppearance)[]) if (next[k] === undefined || next[k] === '') delete next[k]
  if (Object.keys(next).length) all[workspace] = next
  else delete all[workspace]
  api.settings.update({ projectAppearance: all })
}
