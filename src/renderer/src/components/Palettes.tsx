import { useEffect, useMemo, useRef, useState } from 'react'
import { api, basename, relative } from '../lib/api'
import type { SearchHit } from '../lib/types'
import { t } from '../i18n/ko'
import { Modal } from './ui'

/** 파일 이름 빠른 열기 (⌘P). 글자가 순서대로 들어 있으면 일치로 본다. */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const s = target.toLowerCase()
  let qi = 0
  let score = 0
  let streak = 0
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      qi++
      streak++
      score += streak * 2 + (i === 0 || '/._- '.includes(s[i - 1]) ? 5 : 0)
    } else streak = 0
  }
  return qi === q.length ? score - s.length * 0.05 : -1
}

export function QuickOpen({ root, onOpen, onClose }: { root: string; onOpen: (p: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.workspace.allFiles().then(setFiles)
  }, [])

  const results = useMemo(() => {
    if (!query) return files.slice(0, 50).map((f) => ({ path: f, score: 0 }))
    return files
      .map((f) => ({ path: f, score: Math.max(fuzzyScore(query, basename(f)) * 1.5, fuzzyScore(query, relative(root, f))) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
  }, [files, query, root])

  useEffect(() => setSel(0), [query])
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  return (
    <Modal onClose={onClose}>
      <div className="palette" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <input
          autoFocus
          value={query}
          placeholder={t.quickOpen.placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(s + 1, results.length - 1)))
            if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)))
            if (e.key === 'Enter' && results[sel]) {
              onOpen(results[sel].path)
              onClose()
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="empty-state">{t.quickOpen.none}</div>}
          {results.map((r, i) => (
            <div
              key={r.path}
              className={`palette-item${i === sel ? ' sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                onOpen(r.path)
                onClose()
              }}
            >
              <span>{basename(r.path)}</span>
              <span className="sub">{relative(root, r.path)}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

export function SearchModal({ root, onOpen, onClose }: { root: string; onOpen: (p: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)

  useEffect(() => {
    if (!query.trim()) return setHits(null)
    const id = setTimeout(() => api.workspace.search(query).then(setHits), 250)
    return () => clearTimeout(id)
  }, [query])

  const groups = useMemo(() => {
    const m = new Map<string, SearchHit[]>()
    for (const h of hits ?? []) m.set(h.path, [...(m.get(h.path) ?? []), h])
    return [...m.entries()]
  }, [hits])

  return (
    <Modal title={t.search.title} onClose={onClose} wide>
      <div className="palette" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <input autoFocus value={query} placeholder={t.search.placeholder} onChange={(e) => setQuery(e.target.value)} />
        <div className="palette-list">
          {hits && <div style={{ padding: '4px 12px', color: 'var(--text-faint)', fontSize: 12 }}>{t.search.count(hits.length)}</div>}
          {hits?.length === 0 && <div className="empty-state">{t.search.none}</div>}
          {groups.map(([path, list]) => (
            <div key={path} className="search-group">
              <div className="file">{relative(root, path)}</div>
              {list.map((h, i) => (
                <div
                  key={i}
                  className="search-hit"
                  onClick={() => {
                    onOpen(path)
                    onClose()
                  }}
                >
                  <span className="ln">{h.line}</span>
                  {h.text.trim()}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t.shortcuts.title} onClose={onClose}>
      <div className="modal-body">
        <table className="kbd-table">
          <tbody>
            {t.shortcuts.list.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
