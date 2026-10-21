import { useEffect, useRef, useState } from 'react'
import { agentStore, useAgentStore } from '../lib/agentStore'
import { panels, useActiveDoc, usePanels } from '../lib/panels'
import type { Settings } from '../lib/types'
import { t } from '../i18n/ko'
import { Chat } from './Chat'
import { Icon } from './ui'

const MIN_WIDTH = 300
const MAX_WIDTH = 760

/**
 * 창 오른쪽의 AI 영역. 상단 바 아래부터 창 맨 아래까지 이어지는 열로,
 * 왼쪽 가장자리를 끌어 폭을 바꿀 수 있다. 파일 모드에서는 현재 문서를 프롬프트에 첨부한다.
 */
export function AiPanel({ workspace, settings }: { workspace: string; settings: Settings }) {
  const { aiWidth } = usePanels()
  const activeDoc = useActiveDoc()
  const loaded = useAgentStore((s) => s.loaded)
  const sessions = useAgentStore((s) => s.sessions)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const creating = useRef(false)

  // 문서 도우미 세션: 작업공간마다 하나를 만들어 기억해 둔다 (세션 목록을 다 읽은 뒤에 판단)
  useEffect(() => {
    if (!loaded) return
    const key = `doc-session:${workspace}`
    const saved = localStorage.getItem(key)
    if (saved && sessions.some((s) => s.id === saved)) {
      setSessionId(saved)
      return
    }
    if (creating.current) return
    creating.current = true
    agentStore
      .create('문서 도우미')
      .then((s) => {
        localStorage.setItem(key, s.id)
        setSessionId(s.id)
      })
      .finally(() => {
        creating.current = false
      })
  }, [loaded, sessions, workspace])

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = aiWidth
    setDragging(true)
    const move = (ev: MouseEvent): void => {
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (startX - ev.clientX)))
      panels.set({ aiWidth: w })
    }
    const up = (): void => {
      setDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <aside className={`ai-column${dragging ? ' dragging' : ''}`} style={{ width: aiWidth }}>
      <div className="ai-resize" onMouseDown={startResize} onDoubleClick={() => panels.set({ aiWidth: 380 })} title="끌어서 폭 조절 (두 번 누르면 기본 폭)" />
      <div className="panel-head">
        <Icon name="sparkle" />
        <span className="grow">{t.agent.docPanel}</span>
        <button className="icon-btn" onClick={() => panels.set({ ai: false })} title={t.titlebar.toggleAi(true)}>
          <Icon name="x" />
        </button>
      </div>
      {sessionId && sessions.some((s) => s.id === sessionId) ? (
        <Chat sessionId={sessionId} settings={settings} placeholder={t.agent.docPlaceholder} contextPath={activeDoc} compact />
      ) : (
        <div className="empty-state">{t.common.loading}</div>
      )}
    </aside>
  )
}
