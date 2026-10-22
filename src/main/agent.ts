import { app } from 'electron'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import type { CanUseTool, HookCallback, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { getSettings } from './settings'
import { findBinary, shellEnv } from './bin'
import { saveSnapshot } from './history'
import { recordAccount, recordRateLimit } from './usage'
import { getProject } from './project'
import { getAnthropicKey } from './system'

/** 렌더러에 보여줄 대화 항목 */
export type ChatItem =
  | { kind: 'user'; id: string; text: string; time: number }
  | { kind: 'assistant'; id: string; text: string; time: number }
  | { kind: 'thinking'; id: string; text: string; time: number }
  | { kind: 'tool_use'; id: string; name: string; input: unknown; time: number }
  | { kind: 'tool_result'; id: string; toolUseId: string; content: string; isError: boolean; time: number }
  | { kind: 'result'; id: string; costUsd: number; durationMs: number; isError: boolean; stopped?: boolean; time: number }
  | { kind: 'error'; id: string; text: string; time: number }

export interface AgentSession {
  id: string
  title: string
  workspace: string
  /** 실제 작업 폴더. 병렬 작업이면 git worktree 경로, 없으면 workspace */
  cwd?: string
  /** 병렬 작업으로 만든 세션이면 담당 트래커 항목 */
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
  | { type: 'permission'; sessionId: string; requestId: string; toolName: string; input: unknown }
  | { type: 'ai-edit'; sessionId: string; phase: 'before' | 'after'; path: string; snapshotId: string | null }
  | { type: 'session-updated'; session: Omit<AgentSession, 'items'> }

type Emit = (e: AgentEvent) => void

/** 알림(소리·OS 알림)을 위한 신호. index.ts 가 등록한다 */
export type AgentNotice =
  | { kind: 'done'; workspace: string; sessionId: string; title: string; ok: boolean; error?: string }
  | { kind: 'blocked'; workspace: string; sessionId: string; title: string; toolName: string }
let notify: (n: AgentNotice) => void = () => undefined
export function setAgentNotifier(fn: (n: AgentNotice) => void): void {
  notify = fn
}

const KOREAN_PROMPT =
  '사용자는 한국어 사용자입니다. 설명, 질문, 요약 등 모든 응답은 자연스러운 한국어로 작성하세요. ' +
  '코드, 명령어, 파일 경로, 식별자는 원문 그대로 둡니다.'

const running = new Map<string, { q: Query; abort: AbortController }>()
const pendingPermissions = new Map<string, (r: { allow: boolean; always?: boolean }) => void>()
const sessionsCache = new Map<string, AgentSession[]>()

function storeFile(workspace: string): string {
  const hash = crypto.createHash('sha1').update(path.resolve(workspace)).digest('hex').slice(0, 16)
  return path.join(app.getPath('userData'), 'sessions', hash + '.json')
}

export async function listSessions(workspace: string): Promise<AgentSession[]> {
  const cached = sessionsCache.get(workspace)
  if (cached) return cached
  const raw = await fs.readFile(storeFile(workspace), 'utf8').catch(() => '[]')
  let list: AgentSession[] = []
  try {
    list = JSON.parse(raw)
  } catch {
    list = []
  }
  sessionsCache.set(workspace, list)
  return list
}

// 작업공간(창)마다 저장 타이머를 따로 둬야 여러 창이 동시에 저장해도 서로 취소되지 않는다
const saveTimers = new Map<string, NodeJS.Timeout>()
function persist(workspace: string): void {
  clearTimeout(saveTimers.get(workspace))
  saveTimers.set(workspace, setTimeout(async () => {
    saveTimers.delete(workspace)
    const list = sessionsCache.get(workspace) ?? []
    await fs.mkdir(path.dirname(storeFile(workspace)), { recursive: true })
    await fs.writeFile(storeFile(workspace), JSON.stringify(list), 'utf8')
  }, 300))
}

export async function createSession(
  workspace: string,
  title?: string,
  extra: { cwd?: string; trackerId?: string } = {}
): Promise<AgentSession> {
  const list = await listSessions(workspace)
  const s: AgentSession = {
    id: crypto.randomUUID(),
    title: title || '새 세션',
    workspace,
    ...extra,
    claudeSessionId: null,
    created: Date.now(),
    updated: Date.now(),
    items: []
  }
  list.unshift(s)
  persist(workspace)
  return s
}

export async function renameSession(workspace: string, id: string, title: string): Promise<void> {
  const s = (await listSessions(workspace)).find((x) => x.id === id)
  if (s) {
    s.title = title
    persist(workspace)
  }
}

export async function deleteSession(workspace: string, id: string): Promise<void> {
  await stopSession(id)
  const list = await listSessions(workspace)
  sessionsCache.set(
    workspace,
    list.filter((s) => s.id !== id)
  )
  persist(workspace)
}

export function isRunning(id: string): boolean {
  return running.has(id)
}

/** 사용자가 멈춘 세션. 이런 세션의 오류 결과는 실패가 아니라 '중지됨' 으로 처리한다 */
const stopRequested = new Set<string>()
let accountFetched = false

export async function stopSession(id: string): Promise<void> {
  const r = running.get(id)
  if (!r) return
  stopRequested.add(id)
  try {
    await r.q.interrupt()
  } catch {
    r.abort.abort()
  }
}

export function answerPermission(requestId: string, allow: boolean, always?: boolean): void {
  pendingPermissions.get(requestId)?.({ allow, always })
  pendingPermissions.delete(requestId)
}

export function findClaude(): string | undefined {
  const configured = getSettings().claudePath.trim()
  if (configured) return configured
  return findBinary(['claude'], { exeOnly: true, extraDirs: [path.join(os.homedir(), '.claude', 'local')] }) ?? bundledClaude()
}

/**
 * 설치된 Claude Code 가 없을 때 쓰는, SDK 와 함께 들어 있는 운영체제별 Claude Code.
 * 패키징된 앱에서는 app.asar 안의 실행 파일을 직접 실행할 수 없으므로 풀어 둔 app.asar.unpacked 쪽 경로를 쓴다.
 */
function bundledClaude(): string | undefined {
  try {
    const pkg = path.dirname(require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`))
    const bin = path.join(pkg.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`), process.platform === 'win32' ? 'claude.exe' : 'claude')
    return existsSync(bin) ? bin : undefined
  } catch {
    return undefined
  }
}

/** 에이전트 프로세스 환경. 설정에서 'API 키 사용' 을 켜면 저장된 Anthropic 키를 넘긴다 */
async function agentEnv(): Promise<Record<string, string>> {
  const env = shellEnv()
  if (getSettings().useApiKey) {
    const key = await getAnthropicKey()
    if (key) env.ANTHROPIC_API_KEY = key
  }
  return env
}

export { shellEnv }

const newId = (): string => crypto.randomUUID()

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : JSON.stringify(c)))
      .join('\n')
  }
  return JSON.stringify(content)
}

export async function sendMessage(
  workspace: string,
  sessionId: string,
  text: string,
  emit: Emit,
  opts: { model?: string; permissionMode?: string } = {}
): Promise<{ ok: boolean; error?: string }> {
  const list = await listSessions(workspace)
  const session = list.find((s) => s.id === sessionId)
  if (!session) throw new Error('세션을 찾을 수 없습니다.')
  if (running.has(sessionId)) throw new Error('이 세션은 이미 실행 중입니다.')
  const cwd = session.cwd ?? workspace
  let outcome: { ok: boolean; error?: string } = { ok: false, error: '응답 없이 끝났습니다.' }

  const push = (item: ChatItem): void => {
    session.items.push(item)
    session.updated = Date.now()
    emit({ type: 'item', sessionId, item })
    persist(workspace)
  }

  push({ kind: 'user', id: newId(), text, time: Date.now() })
  if (session.title === '새 세션') {
    session.title = text.replace(/\s+/g, ' ').slice(0, 40)
    const { items: _i, ...meta } = session
    emit({ type: 'session-updated', session: meta })
  }

  const settings = getSettings()
  // 프로젝트 설정이 있으면 애플리케이션 기본값보다 우선한다
  const project = await getProject(workspace)
  const model = opts.model || project.agent.model || settings.model || undefined
  const permissionMode = opts.permissionMode || project.agent.permissionMode || settings.permissionMode
  const appendPrompt = project.agent.instructions.trim()
    ? `${KOREAN_PROMPT}\n\n# 이 프로젝트의 추가 지시사항\n${project.agent.instructions.trim()}`
    : KOREAN_PROMPT
  const { query } = await import('@anthropic-ai/claude-agent-sdk')

  const canUseTool: CanUseTool = (toolName, input, { signal }) =>
    new Promise((resolve) => {
      const requestId = newId()
      pendingPermissions.set(requestId, ({ allow }) => {
        resolve(allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: '사용자가 거부했습니다.' })
      })
      signal.addEventListener('abort', () => {
        pendingPermissions.delete(requestId)
        resolve({ behavior: 'deny', message: '중단됨' })
      })
      emit({ type: 'permission', sessionId, requestId, toolName, input })
      notify({ kind: 'blocked', workspace, sessionId, title: session.title, toolName })
    })

  // AI 가 파일을 고치기 직전·직후에 스냅샷을 남겨 문서 화면에서 변경 검토(수락/되돌리기)를 할 수 있게 한다
  const editHook =
    (phase: 'before' | 'after'): HookCallback =>
    async (input) => {
      const toolInput = (input as { tool_input?: { file_path?: string; notebook_path?: string } }).tool_input
      const file = toolInput?.file_path ?? toolInput?.notebook_path
      if (file) {
        const abs = path.isAbsolute(file) ? file : path.join(cwd, file)
        const content = await fs.readFile(abs, 'utf8').catch(() => '')
        const snap = await saveSnapshot(abs, content, phase === 'before' ? 'ai-before' : 'ai-after').catch(() => null)
        emit({ type: 'ai-edit', sessionId, phase, path: abs, snapshotId: snap?.id ?? null })
      }
      return { continue: true }
    }

  const abort = new AbortController()
  const q = query({
    prompt: text,
    options: {
      cwd,
      resume: session.claudeSessionId ?? undefined,
      model,
      permissionMode: permissionMode as never,
      allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
      canUseTool,
      includePartialMessages: true,
      abortController: abort,
      pathToClaudeCodeExecutable: findClaude(),
      env: await agentEnv(),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: appendPrompt },
      settingSources: ['user', 'project', 'local'],
      hooks: {
        PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [editHook('before')] }],
        PostToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [editHook('after')] }]
      }
    } as never
  })
  running.set(sessionId, { q, abort })
  // 사용자 아이콘에 보여 줄 계정 정보는 앱이 켜진 뒤 한 번만 받아 둔다
  if (!accountFetched) {
    accountFetched = true
    q.accountInfo()
      .then(recordAccount)
      .catch(() => (accountFetched = false))
  }
  emit({ type: 'status', sessionId, running: true })

  try {
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      handleMessage(msg, session, push, emit, workspace)
      const m = msg as { type?: string; subtype?: string; errors?: string[] }
      if (m.type === 'result') {
        outcome = m.subtype === 'success' ? { ok: true } : { ok: false, error: m.errors?.join('\n') || m.subtype }
      }
      if (stopRequested.has(sessionId)) outcome = { ok: false, error: '중지됨' }
    }
  } catch (err) {
    if (abort.signal.aborted || stopRequested.has(sessionId)) outcome = { ok: false, error: '중지됨' }
    else {
      const text = friendlyError(err)
      outcome = { ok: false, error: text }
      push({ kind: 'error', id: newId(), text, time: Date.now() })
    }
  } finally {
    stopRequested.delete(sessionId)
    running.delete(sessionId)
    emit({ type: 'status', sessionId, running: false })
    persist(workspace)
  }
  // 사용자가 직접 멈춘 경우에는 알리지 않는다
  if (outcome.error !== '중지됨') notify({ kind: 'done', workspace, sessionId, title: session.title, ok: outcome.ok, error: outcome.error })
  return outcome
}

function handleMessage(
  msg: SDKMessage,
  session: AgentSession,
  push: (i: ChatItem) => void,
  emit: Emit,
  workspace: string
): void {
  const m = msg as Record<string, any>
  if (m.session_id && session.claudeSessionId !== m.session_id) {
    session.claudeSessionId = m.session_id
    persist(workspace)
  }
  switch (m.type) {
    case 'rate_limit_event':
      recordRateLimit(m.rate_limit_info)
      break
    case 'stream_event': {
      const ev = m.event
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && !m.parent_tool_use_id) {
        emit({ type: 'delta', sessionId: session.id, text: ev.delta.text })
      }
      break
    }
    case 'assistant': {
      for (const block of m.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) {
          push({ kind: 'assistant', id: newId(), text: block.text, time: Date.now() })
        } else if (block.type === 'thinking' && block.thinking?.trim()) {
          push({ kind: 'thinking', id: newId(), text: block.thinking, time: Date.now() })
        } else if (block.type === 'tool_use') {
          push({ kind: 'tool_use', id: block.id, name: block.name, input: block.input, time: Date.now() })
        }
      }
      break
    }
    case 'user': {
      const content = m.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            push({
              kind: 'tool_result',
              id: newId(),
              toolUseId: block.tool_use_id,
              content: stringifyToolResult(block.content).slice(0, 20000),
              isError: !!block.is_error,
              time: Date.now()
            })
          }
        }
      }
      break
    }
    case 'result': {
      push({
        kind: 'result',
        id: newId(),
        costUsd: m.total_cost_usd ?? 0,
        durationMs: m.duration_ms ?? 0,
        isError: m.subtype !== 'success',
        stopped: stopRequested.has(session.id),
        time: Date.now()
      })
      if (m.subtype !== 'success' && !stopRequested.has(session.id) && Array.isArray(m.errors) && m.errors.length) {
        push({ kind: 'error', id: newId(), text: m.errors.join('\n'), time: Date.now() })
      }
      break
    }
  }
}

function friendlyError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  if (/ENOENT|not found|spawn/i.test(text)) {
    return `Claude Code 실행 파일을 찾지 못했습니다. 설정에서 claude 경로를 지정하거나 Claude Code 를 설치하세요.\n(${text})`
  }
  if (/auth|login|api key|401/i.test(text)) {
    return `Claude 인증이 필요합니다. 터미널에서 \`claude\` 를 실행해 로그인하거나 ANTHROPIC_API_KEY 를 설정하세요.\n(${text})`
  }
  return text
}
