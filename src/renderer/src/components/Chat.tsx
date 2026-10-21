import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { agentStore, useAgentStore } from '../lib/agentStore'
import { useProject } from '../lib/project'
import type { ChatItem, Settings } from '../lib/types'
import { t, toolLabels } from '../i18n/ko'
import { Icon } from './ui'

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }) as string), [text])
  return <div className="msg-assistant" dangerouslySetInnerHTML={{ __html: html }} />
}

/** 도구 입력에서 한 줄로 보여줄 핵심 인자 */
function toolSummary(name: string, input: any): string {
  if (!input || typeof input !== 'object') return ''
  return String(
    input.file_path ?? input.command ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.path ?? (name === 'TodoWrite' ? `${input.todos?.length ?? 0}개 항목` : '')
  )
}

function ToolCard({
  use,
  result,
  workspace
}: {
  use: Extract<ChatItem, { kind: 'tool_use' }>
  result?: Extract<ChatItem, { kind: 'tool_result' }>
  workspace: string
}) {
  const label = toolLabels[use.name] ?? use.name
  const todos = use.name === 'TodoWrite' && Array.isArray(use.input?.todos) ? use.input.todos : null
  return (
    <details className="tool-card">
      <summary>
        <Icon name={use.name === 'Bash' ? 'terminal' : use.name.includes('Edit') || use.name === 'Write' ? 'edit' : 'file'} size={14} />
        <span className="tname">{label}</span>
        <span className="targ">{toolSummary(use.name, use.input).replace(workspace + '/', '')}</span>
        <span className={`state ${result ? (result.isError ? 'err' : 'ok') : ''}`}>
          {result ? (result.isError ? t.agent.failed : '✓') : <span className="spinner" />}
        </span>
      </summary>
      {todos ? (
        <pre>
          {todos.map((td: any) => `${td.status === 'completed' ? '☑' : td.status === 'in_progress' ? '▶' : '☐'} ${td.content}`).join('\n')}
        </pre>
      ) : (
        <pre>{JSON.stringify(use.input, null, 2)}</pre>
      )}
      {result && <pre style={result.isError ? { color: 'var(--danger)' } : undefined}>{result.content || '(출력 없음)'}</pre>}
    </details>
  )
}

export function Chat({
  sessionId,
  settings,
  placeholder,
  contextPath,
  compact
}: {
  sessionId: string
  settings: Settings
  placeholder?: string
  /** 파일 모드의 AI 도우미에서 현재 문서 경로를 프롬프트에 붙인다 */
  contextPath?: string | null
  compact?: boolean
}) {
  const session = useAgentStore((s) => s.sessions.find((x) => x.id === sessionId))
  const running = useAgentStore((s) => !!s.running[sessionId])
  const streaming = useAgentStore((s) => s.streaming[sessionId] ?? '')
  const allPermissions = useAgentStore((s) => s.permissions)
  const permissions = useMemo(() => allPermissions.filter((p) => p.sessionId === sessionId), [allPermissions, sessionId])
  const [text, setText] = useState('')
  const project = useProject()
  const defaultModel = project?.agent.model || settings.model
  const defaultMode = project?.agent.permissionMode || settings.permissionMode
  const [model, setModel] = useState(defaultModel)
  const [mode, setMode] = useState<string>(defaultMode)
  const [attach, setAttach] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => setMode(defaultMode), [defaultMode])
  useEffect(() => setModel(defaultModel), [defaultModel])
  useEffect(() => inputRef.current?.focus(), [sessionId])

  const items = session?.items ?? []
  const results = useMemo(() => {
    const m = new Map<string, Extract<ChatItem, { kind: 'tool_result' }>>()
    for (const it of items) if (it.kind === 'tool_result') m.set(it.toolUseId, it)
    return m
  }, [items])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items.length, streaming, permissions.length])

  const submit = (value = text): void => {
    const v = value.trim()
    if (!v || running) return
    const prompt = contextPath && attach ? `[현재 열린 문서: ${contextPath}]\n\n${v}` : v
    agentStore.send(sessionId, prompt, { model: model || undefined, permissionMode: mode })
    setText('')
  }

  if (!session) return null

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-inner">
          {items.length === 0 && !compact && (
            <div className="chat-empty">
              <h3>{t.agent.emptyChat}</h3>
              <div>{t.agent.emptyChatHint}</div>
              <div className="sugs">
                {t.agent.suggestions.map((s) => (
                  <button key={s} className="btn" onClick={() => submit(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {items.map((it) => {
            switch (it.kind) {
              case 'user':
                return (
                  <div key={it.id} className="msg-user">
                    {it.text.replace(/^\[현재 열린 문서: [^\]]*\]\n\n/, '')}
                  </div>
                )
              case 'assistant':
                return <Markdown key={it.id} text={it.text} />
              case 'thinking':
                if (!settings.showThinking) return null
                return (
                  <details key={it.id} className="msg-thinking">
                    <summary>{t.agent.thinking}</summary>
                    {it.text}
                  </details>
                )
              case 'tool_use':
                return <ToolCard key={it.id} use={it} result={results.get(it.id)} workspace={session.workspace} />
              case 'tool_result':
                return null
              case 'result':
                return (
                  <div key={it.id} className="msg-result">
                    {it.stopped ? '중지됨' : it.isError ? t.agent.failed : t.agent.done((it.durationMs / 1000).toFixed(1), it.costUsd.toFixed(4))}
                  </div>
                )
              case 'error':
                return (
                  <div key={it.id} className="msg-error">
                    {it.text}
                  </div>
                )
            }
          })}
          {streaming && <Markdown text={streaming} />}
          {permissions.map((p) => (
            <div key={p.requestId} className="permission-card">
              <div className="ptitle">{t.agent.permissionTitle(toolLabels[p.toolName] ?? p.toolName)}</div>
              <pre>{JSON.stringify(p.input, null, 2)}</pre>
              <div className="actions">
                <button className="btn primary" onClick={() => agentStore.answer(p.requestId, true)}>
                  {t.agent.allow}
                </button>
                <button className="btn danger" onClick={() => agentStore.answer(p.requestId, false)}>
                  {t.agent.deny}
                </button>
              </div>
            </div>
          ))}
          {running && !permissions.length && (
            <div className="running-indicator">
              <span className="spinner" /> {t.agent.running}
            </div>
          )}
        </div>
      </div>
      <div className="composer">
        <div className="composer-inner">
          <textarea
            ref={inputRef}
            rows={compact ? 2 : 3}
            value={text}
            placeholder={placeholder ?? t.agent.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 한글 조합 중 Enter 는 글자 확정이므로 전송하지 않는다
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="row">
            {contextPath && (
              <button className={`chip${attach ? ' on' : ''}`} onClick={() => setAttach(!attach)} title={contextPath}>
                📎 {t.agent.attachDoc}
              </button>
            )}
            {!compact && (
              <>
                <select value={model} onChange={(e) => setModel(e.target.value)} title={t.agent.model}>
                  <option value="">{t.agent.defaultModel}</option>
                  <option value="claude-opus-5-5">Opus 5.5</option>
                  <option value="claude-sonnet-5-5">Sonnet 5.5</option>
                  <option value="claude-haiku-5-5">Haiku 5.5</option>
                  <option value="claude-fable-5-1">Fable 5.1</option>
                </select>
              </>
            )}
            <select value={mode} onChange={(e) => setMode(e.target.value)} title={t.agent.permission}>
              {Object.entries(t.agent.permissionModes).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <span className="grow" />
            {running ? (
              <button className="btn" onClick={() => agentStore.stop(sessionId)}>
                <Icon name="stop" size={13} /> {t.agent.stop}
              </button>
            ) : (
              <button className="btn primary" onClick={() => submit()} disabled={!text.trim()}>
                <Icon name="send" size={13} /> {t.agent.send}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
