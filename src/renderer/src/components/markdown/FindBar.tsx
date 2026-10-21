import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui'
import { t } from '../../i18n/ko'

declare const Highlight: { new (...ranges: Range[]): unknown }

/** 문서 안 찾기. CSS Custom Highlight API 로 일치 항목을 칠한다. */
export function FindBar({ rootSelector, onClose }: { rootSelector: string; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [ranges, setRanges] = useState<Range[]>([])
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  useEffect(() => {
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    const root = document.querySelector(rootSelector)
    const found: Range[] = []
    if (root && query) {
      const q = query.toLowerCase()
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const text = node.textContent?.toLowerCase() ?? ''
        let i = text.indexOf(q)
        while (i >= 0 && found.length < 1000) {
          const r = document.createRange()
          r.setStart(node, i)
          r.setEnd(node, i + q.length)
          found.push(r)
          i = text.indexOf(q, i + q.length)
        }
      }
    }
    setRanges(found)
    setIndex(0)
    highlights?.set('find', new Highlight(...found))
    return () => {
      highlights?.delete('find')
      highlights?.delete('find-current')
    }
  }, [query, rootSelector])

  useEffect(() => {
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    const r = ranges[index]
    if (!r) return
    highlights?.set('find-current', new Highlight(r))
    r.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [ranges, index])

  const move = (d: number): void => {
    if (ranges.length) setIndex((i) => (i + d + ranges.length) % ranges.length)
  }

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        value={query}
        placeholder={t.editor.find}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') move(e.shiftKey ? -1 : 1)
          if (e.key === 'Escape') onClose()
        }}
      />
      <span className="cnt">{ranges.length ? `${index + 1}/${ranges.length}` : '0/0'}</span>
      <button className="icon-btn" onClick={() => move(-1)} title="이전">
        ↑
      </button>
      <button className="icon-btn" onClick={() => move(1)} title="다음">
        ↓
      </button>
      <button className="icon-btn" onClick={onClose} title={t.common.close}>
        <Icon name="x" />
      </button>
    </div>
  )
}
