import { useSyncExternalStore } from 'react'

/** 상단 바의 토글 버튼과 각 모드 화면이 함께 쓰는 패널 열림 상태. 창마다 따로 두고, 마지막 상태는 새 창의 기본값이 된다 */
export interface Panels {
  /** 왼쪽 탐색 영역 (파일 트리 / 세션 목록) */
  sidebar: boolean
  /** 오른쪽 AI 도우미 영역 */
  ai: boolean
  history: boolean
  terminal: boolean
  /** AI 영역 폭(px) */
  aiWidth: number
}

const KEY = 'panels'
let state: Panels = { sidebar: true, ai: false, history: false, terminal: false, aiWidth: 380 }
try {
  state = { ...state, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
} catch {
  /* 저장된 값이 없거나 읽을 수 없으면 기본값 */
}
const listeners = new Set<() => void>()

function set(patch: Partial<Panels>): void {
  state = { ...state, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* 무시 */
  }
  listeners.forEach((l) => l())
}

export const panels = {
  get: () => state,
  set,
  toggle: (k: keyof Panels) => set({ [k]: !state[k] })
}

export function usePanels(): Panels {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state
  )
}

/** 파일 모드에서 지금 열려 있는 문서. AI 영역이 프롬프트에 첨부한다 */
let activeDoc: string | null = null
const docListeners = new Set<() => void>()

export function setActiveDoc(path: string | null): void {
  if (activeDoc === path) return
  activeDoc = path
  docListeners.forEach((l) => l())
}

export function useActiveDoc(): string | null {
  return useSyncExternalStore(
    (l) => (docListeners.add(l), () => docListeners.delete(l)),
    () => activeDoc
  )
}
