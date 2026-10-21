import { useSyncExternalStore } from 'react'
import { api } from './api'

export interface ProjectFeatures {
  git: boolean
  tracker: boolean
  wiki: boolean
  parallel: boolean
  aiPanel: boolean
  terminal: boolean
  mermaid: boolean
}

export interface ProjectSettings {
  features: ProjectFeatures
  agent: { model: string; permissionMode: '' | 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'; instructions: string }
  wiki: { dir: string }
  tracker: { defaultType: 'task' | 'bug' | 'plan' | 'idea' | 'decision' | 'feature'; showDone: boolean }
}

/** 이 창에 열린 프로젝트의 설정 (.nimbalyst/project.json) */
let state: ProjectSettings | null = null
const listeners = new Set<() => void>()
const set = (s: ProjectSettings | null): void => {
  state = s
  listeners.forEach((l) => l())
}

export const projectStore = {
  async load(): Promise<void> {
    set(await api.project.get())
  },
  async update(patch: Partial<{ features: Partial<ProjectFeatures>; agent: Partial<ProjectSettings['agent']>; wiki: Partial<ProjectSettings['wiki']>; tracker: Partial<ProjectSettings['tracker']> }>): Promise<void> {
    set(await api.project.update(patch))
  },
  subscribe(): () => void {
    return api.project.onChanged((p: ProjectSettings) => set(p))
  }
}

export function useProject(): ProjectSettings | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state
  )
}

/** 기능이 켜져 있는지. 설정을 아직 못 읽었으면 켜진 것으로 본다 */
export function useFeature(key: keyof ProjectFeatures): boolean {
  const p = useProject()
  return p ? p.features[key] : true
}
