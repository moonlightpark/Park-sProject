import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Snapshot } from '../lib/types'
import { formatDateTime, t, timeAgo } from '../i18n/ko'
import { Icon } from './ui'

/** 오른쪽 이력 패널. 항목을 고르면 편집기 자리에 현재 문서와의 차이를 보여준다. */
export function HistoryPanel({
  path,
  refreshKey,
  selected,
  onSelect,
  onRestore,
  onClose
}: {
  path: string
  refreshKey: number
  selected: string | null
  onSelect: (id: string | null) => void
  onRestore: (id: string) => void
  onClose: () => void
}) {
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null)

  useEffect(() => {
    api.history.list(path).then(setSnaps)
  }, [path, refreshKey])

  return (
    <div className="side-panel">
      <div className="panel-head">
        <Icon name="history" />
        <span className="grow">{t.history.title}</span>
        <button className="icon-btn" onClick={onClose} title={t.common.close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="sidebar-body">
        {snaps === null && <div className="empty-state">{t.common.loading}</div>}
        {snaps?.length === 0 && <div className="empty-state">{t.history.empty}</div>}
        {snaps?.map((s) => (
          <div
            key={s.id}
            className={`history-item${selected === s.id ? ' active' : ''}`}
            onClick={() => onSelect(selected === s.id ? null : s.id)}
          >
            <div className="when">{formatDateTime(s.time)}</div>
            <div className="meta">
              <span className={`kind-tag ${s.kind}`}>{t.history.kinds[s.kind]}</span>
              {timeAgo(s.time)} · {(s.size / 1024).toFixed(1)}KB
            </div>
            {selected === s.id && (
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn small primary"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRestore(s.id)
                  }}
                >
                  {t.history.restore}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
