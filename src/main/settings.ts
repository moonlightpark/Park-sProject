import Store from 'electron-store'

export type ThemeName = 'light' | 'dark' | 'crystal'
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface AppSettings {
  theme: ThemeName
  recentWorkspaces: string[]
  lastWorkspace: string | null
  /** 최근 프로젝트를 마지막으로 연 시각 (경로 → ms) */
  recentOpened: Record<string, number>
  claudePath: string
  model: string
  permissionMode: AgentPermissionMode
  autosave: boolean
  editorFontSize: number
  historyIntervalSec: number
  /** 병렬 작업 동시 실행 수 */
  maxParallel: number
  /** 병렬 작업 에이전트의 권한 모드 */
  parallelPermissionMode: AgentPermissionMode
  /* 알림 */
  soundEnabled: boolean
  soundType: 'chime' | 'bell' | 'pop' | 'custom'
  soundVolume: number
  customSoundPath: string
  osNotify: boolean
  osNotifyWhenFocused: boolean
  notifyBlocked: boolean
  /* 에이전트 기능 */
  showThinking: boolean
  /** 저장된 Anthropic API 키를 Claude 로그인 대신 쓸지 */
  useApiKey: boolean
  /** 프로젝트 모양 (이 컴퓨터에만 저장): 경로 → 이니셜·색·이미지(작게 줄인 data URL) */
  projectAppearance: Record<string, { initials?: string; color?: string; image?: string; theme?: 'light' | 'dark' | 'crystal'; uiScale?: number; editorFontSize?: number; editorFont?: 'system' | 'gothic' | 'serif' | 'mono' }>
}

const defaults: AppSettings = {
  theme: 'light',
  recentWorkspaces: [],
  lastWorkspace: null,
  recentOpened: {},
  claudePath: '',
  model: '',
  permissionMode: 'default',
  autosave: true,
  editorFontSize: 16,
  historyIntervalSec: 60,
  maxParallel: 3,
  parallelPermissionMode: 'acceptEdits',
  soundEnabled: true,
  soundType: 'chime',
  soundVolume: 100,
  customSoundPath: '',
  osNotify: true,
  osNotifyWhenFocused: false,
  notifyBlocked: true,
  showThinking: true,
  useApiKey: false,
  projectAppearance: {}
}

export const store = new Store<AppSettings>({ name: 'settings', defaults })

export function getSettings(): AppSettings {
  return { ...defaults, ...store.store }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  for (const [k, v] of Object.entries(patch)) store.set(k as keyof AppSettings, v as never)
  return getSettings()
}

export function addRecentWorkspace(dir: string): void {
  const s = getSettings()
  const list = [dir, ...s.recentWorkspaces.filter((d) => d !== dir)].slice(0, 30)
  const recentOpened = Object.fromEntries(
    Object.entries({ ...s.recentOpened, [dir]: Date.now() }).filter(([k]) => list.includes(k))
  )
  updateSettings({ recentWorkspaces: list, lastWorkspace: dir, recentOpened })
}

export function removeRecentWorkspace(dir: string): void {
  const s = getSettings()
  const recentOpened = { ...s.recentOpened }
  delete recentOpened[dir]
  updateSettings({ recentWorkspaces: s.recentWorkspaces.filter((d) => d !== dir), recentOpened })
}

export function resetSettings(): AppSettings {
  const keep = { recentWorkspaces: getSettings().recentWorkspaces, recentOpened: getSettings().recentOpened }
  store.clear()
  return updateSettings(keep)
}
