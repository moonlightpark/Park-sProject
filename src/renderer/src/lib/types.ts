export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

/** 프로젝트 모양 (이 컴퓨터에만 저장). 화면 항목이 비어 있으면 애플리케이션 기본값을 따른다 */
export interface ProjectAppearance {
  initials?: string
  color?: string
  image?: string
  theme?: 'light' | 'dark' | 'crystal'
  uiScale?: number
  editorFontSize?: number
  editorFont?: 'system' | 'gothic' | 'serif' | 'mono'
}

export interface Settings {
  theme: 'light' | 'dark' | 'crystal'
  recentWorkspaces: string[]
  lastWorkspace: string | null
  claudePath: string
  model: string
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  autosave: boolean
  editorFontSize: number
  historyIntervalSec: number
  maxParallel: number
  parallelPermissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  soundEnabled: boolean
  soundType: 'chime' | 'bell' | 'pop' | 'custom'
  soundVolume: number
  customSoundPath: string
  osNotify: boolean
  osNotifyWhenFocused: boolean
  notifyBlocked: boolean
  showThinking: boolean
  useApiKey: boolean
  projectAppearance: Record<string, ProjectAppearance>
}

export interface Snapshot {
  id: string
  time: number
  kind: 'manual' | 'auto' | 'ai-before' | 'ai-after' | 'restore'
  size: number
}

export type TrackerType = 'task' | 'bug' | 'plan' | 'idea' | 'decision' | 'feature'
export type TrackerStatus = 'todo' | 'in-progress' | 'review' | 'done'
export type TrackerPriority = 'low' | 'medium' | 'high' | 'critical'

export interface TrackerItem {
  id: string
  title: string
  type: TrackerType
  status: TrackerStatus
  priority: TrackerPriority
  tags: string[]
  created: string
  updated: string
  body: string
  assignee?: string
  branch?: string
}

export type ChatItem =
  | { kind: 'user'; id: string; text: string; time: number }
  | { kind: 'assistant'; id: string; text: string; time: number }
  | { kind: 'thinking'; id: string; text: string; time: number }
  | { kind: 'tool_use'; id: string; name: string; input: any; time: number }
  | { kind: 'tool_result'; id: string; toolUseId: string; content: string; isError: boolean; time: number }
  | { kind: 'result'; id: string; costUsd: number; durationMs: number; isError: boolean; stopped?: boolean; time: number }
  | { kind: 'error'; id: string; text: string; time: number }

export interface AgentSession {
  id: string
  title: string
  workspace: string
  cwd?: string
  trackerId?: string
  claudeSessionId: string | null
  created: number
  updated: number
  items: ChatItem[]
}

export type AgentEvent =
  | { type: 'item'; sessionId: string; item: ChatItem }
  | { type: 'delta'; sessionId: string; text: string }
  | { type: 'status'; sessionId: string; running: boolean }
  | { type: 'permission'; sessionId: string; requestId: string; toolName: string; input: any }
  | { type: 'ai-edit'; sessionId: string; phase: 'before' | 'after'; path: string; snapshotId: string | null }
  | { type: 'session-updated'; session: Omit<AgentSession, 'items'> }

export interface SearchHit {
  path: string
  line: number
  text: string
}

export type JobStatus = 'queued' | 'starting' | 'running' | 'review' | 'failed' | 'conflict' | 'stopped' | 'merged' | 'discarded'

export interface Job {
  id: string
  workspace: string
  itemId: string
  title: string
  status: JobStatus
  sessionId?: string
  worktree?: { path: string; root: string; branch: string; baseBranch: string; baseCommit: string }
  error?: string
  changedFiles?: number
  created: number
  updated: number
}

export interface DiffSummary {
  files: { path: string; added: number; removed: number }[]
  patch: string
  commits: number
}

export interface ProjectEntry {
  path: string
  name: string
  exists: boolean
  mdCount: number
  mdCapped: boolean
  lastOpened: number | null
}
