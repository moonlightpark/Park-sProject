import { useEffect, useMemo, useState } from 'react'
import { agentStore, useAgentStore } from '../lib/agentStore'
import { bus } from '../lib/bus'
import { usePanels } from '../lib/panels'
import type { Settings } from '../lib/types'
import { t, timeAgo } from '../i18n/ko'
import { Chat } from '../components/Chat'
import { ContextMenu, Icon, InputDialog } from '../components/ui'

export function AgentMode({ settings, focusSessionId }: { settings: Settings; focusSessionId: string | null }) {
  const sessions = useAgentStore((s) => s.sessions)
  const running = useAgentStore((s) => s.running)
  const permissions = useAgentStore((s) => s.permissions)
  const [activeId, setActiveId] = useState<string | null>(() => sessions[0]?.id ?? null)
  const { sidebar: showSidebar } = usePanels()
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  useEffect(() => {
    if (focusSessionId) setActiveId(focusSessionId)
  }, [focusSessionId])

  const sorted = useMemo(() => [...sessions].sort((a, b) => b.updated - a.updated), [sessions])
  const waiting = useMemo(() => new Set(permissions.map((p) => p.sessionId)), [permissions])

  useEffect(() => {
    if (!activeId || !sessions.some((s) => s.id === activeId)) setActiveId(sorted[0]?.id ?? null)
  }, [sessions, activeId, sorted])

  const newSession = async (): Promise<void> => {
    const s = await agentStore.create()
    setActiveId(s.id)
  }

  useEffect(
    () =>
      bus.on((cmd) => {
        if (cmd === 'new-session') newSession()
        if (cmd === 'stop-agent' && activeId) agentStore.stop(activeId)
        if (cmd === 'approve' || cmd === 'reject') {
          const p = agentStore.get().permissions.find((x) => x.sessionId === activeId)
          if (p) agentStore.answer(p.requestId, cmd === 'approve')
        }
      }),
    [activeId]
  )

  const renameTarget = sessions.find((s) => s.id === renaming)

  return (
    <div className="mode-body">
      <div className="sidebar" style={showSidebar ? undefined : { display: 'none' }}>
        <div className="sidebar-header">
          <span className="title">{t.agent.sessions}</span>
          <button className="icon-btn" title={t.agent.newSession} onClick={newSession}>
            <Icon name="plus" size={15} />
          </button>
        </div>
        <div className="sidebar-body">
          {sorted.length === 0 && <div className="empty-state">{t.agent.noSessions}</div>}
          {sorted.map((s) => (
            <div
              key={s.id}
              className={`session-row${s.id === activeId ? ' active' : ''}`}
              onClick={() => setActiveId(s.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, id: s.id })
              }}
            >
              <div className="stitle">
                {waiting.has(s.id) ? <span className="wait-dot" title="승인 대기" /> : running[s.id] ? <span className="live-dot" /> : null}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
              </div>
              <div className="smeta">
                {s.cwd && s.cwd !== s.workspace && <span title={s.cwd}>🌿 worktree · </span>}
                {timeAgo(s.updated)} · 메시지 {s.items.filter((i) => i.kind === 'user').length}개
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="editor-area">
        {activeId ? (
          <Chat key={activeId} sessionId={activeId} settings={settings} />
        ) : (
          <div className="empty-state">
            <Icon name="agent" size={40} />
            <h2>{t.agent.emptyChat}</h2>
            <div>{t.agent.emptyChatHint}</div>
            <button className="btn primary" onClick={newSession} style={{ marginTop: 12 }}>
              <Icon name="plus" size={14} /> {t.agent.newSession}
            </button>
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: t.agent.rename, onClick: () => setRenaming(menu.id) },
            'sep',
            {
              label: t.agent.delete,
              danger: true,
              onClick: () => {
                if (confirm(t.agent.deleteConfirm)) agentStore.remove(menu.id)
              }
            }
          ]}
        />
      )}
      {renameTarget && (
        <InputDialog
          title={t.agent.rename}
          initial={renameTarget.title}
          onClose={() => setRenaming(null)}
          onSubmit={(v) => agentStore.rename(renameTarget.id, v)}
        />
      )}
    </div>
  )
}
