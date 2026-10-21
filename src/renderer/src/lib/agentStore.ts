import { useSyncExternalStore } from 'react'
import { api } from './api'
import type { AgentEvent, AgentSession, ChatItem } from './types'

export interface PendingPermission {
  requestId: string
  sessionId: string
  toolName: string
  input: unknown
}

export interface AiEdit {
  path: string
  beforeSnapshotId: string | null
  sessionId: string
}

interface State {
  /** 세션 목록을 한 번이라도 읽었는지 */
  loaded: boolean
  sessions: AgentSession[]
  running: Record<string, boolean>
  streaming: Record<string, string>
  permissions: PendingPermission[]
  /** AI 가 수정했고 아직 검토하지 않은 파일들 (경로 → 수정 직전 스냅샷) */
  aiEdits: Record<string, AiEdit>
}

let state: State = { loaded: false, sessions: [], running: {}, streaming: {}, permissions: [], aiEdits: {} }
const listeners = new Set<() => void>()

function set(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  listeners.forEach((l) => l())
}

export function useAgentStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => selector(state)
  )
}

export const agentStore = {
  get: () => state,

  async load(): Promise<void> {
    const sessions: AgentSession[] = await api.agent.list()
    set({ loaded: true, sessions, running: {}, streaming: {}, permissions: [], aiEdits: {} })
  },

  async create(title?: string): Promise<AgentSession> {
    const s: AgentSession = await api.agent.create(title)
    set((st) => ({ sessions: [s, ...st.sessions.filter((x) => x.id !== s.id)] }))
    return s
  },

  async rename(id: string, title: string): Promise<void> {
    await api.agent.rename(id, title)
    set((st) => ({ sessions: st.sessions.map((s) => (s.id === id ? { ...s, title } : s)) }))
  },

  async remove(id: string): Promise<void> {
    await api.agent.delete(id)
    set((st) => ({ sessions: st.sessions.filter((s) => s.id !== id) }))
  },

  async send(id: string, text: string, opts?: { model?: string; permissionMode?: string }): Promise<void> {
    set((st) => ({ running: { ...st.running, [id]: true } }))
    await api.agent.send(id, text, opts)
  },

  stop: (id: string) => api.agent.stop(id),

  answer(requestId: string, allow: boolean): void {
    api.agent.permission(requestId, allow)
    set((st) => ({ permissions: st.permissions.filter((p) => p.requestId !== requestId) }))
  },

  clearAiEdit(path: string): void {
    set((st) => {
      const next = { ...st.aiEdits }
      delete next[path]
      return { aiEdits: next }
    })
  },

  /** 이 화면이 모르는 세션의 이벤트가 오면 목록만 다시 읽는다 */
  async refresh(): Promise<void> {
    const sessions: AgentSession[] = await api.agent.list()
    set({ sessions })
  },

  handleEvent(e: AgentEvent): void {
    if ('sessionId' in e && !state.sessions.some((s) => s.id === e.sessionId)) {
      agentStore.refresh()
    }
    switch (e.type) {
      case 'item':
        set((st) => ({
          sessions: st.sessions.map((s) =>
            s.id === e.sessionId ? { ...s, items: [...s.items, e.item as ChatItem], updated: Date.now() } : s
          ),
          // 완성된 assistant 메시지가 오면 스트리밍 중이던 글은 지운다
          streaming: e.item.kind === 'assistant' ? { ...st.streaming, [e.sessionId]: '' } : st.streaming
        }))
        break
      case 'delta':
        set((st) => ({ streaming: { ...st.streaming, [e.sessionId]: (st.streaming[e.sessionId] ?? '') + e.text } }))
        break
      case 'status':
        set((st) => ({
          running: { ...st.running, [e.sessionId]: e.running },
          streaming: e.running ? st.streaming : { ...st.streaming, [e.sessionId]: '' },
          permissions: e.running ? st.permissions : st.permissions.filter((p) => p.sessionId !== e.sessionId)
        }))
        break
      case 'permission':
        set((st) => ({ permissions: [...st.permissions, { ...e }] }))
        break
      case 'session-updated':
        set((st) => ({ sessions: st.sessions.map((s) => (s.id === e.session.id ? { ...s, ...e.session } : s)) }))
        break
      case 'ai-edit':
        if (e.phase === 'before') {
          set((st) =>
            // 같은 파일을 여러 번 고치면 처음 고치기 직전 상태를 기준으로 삼는다
            st.aiEdits[e.path]
              ? {}
              : { aiEdits: { ...st.aiEdits, [e.path]: { path: e.path, beforeSnapshotId: e.snapshotId, sessionId: e.sessionId } } }
          )
        }
        break
    }
  }
}
