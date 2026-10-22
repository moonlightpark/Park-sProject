import { useEffect, useMemo, useRef, useState } from 'react'
import { systemFonts } from '../../lib/display'
import { Icon } from '../ui'

/**
 * 이 컴퓨터에 설치된 글꼴 중에서 고르는 목록. 글꼴 이름마다 그 글꼴로 미리 보여 준다.
 * value 가 시스템 글꼴 이름이면 선택된 것으로 표시한다 (기본 묶음 이름이면 선택 없음).
 */
export function FontPicker({ value, onPick }: { value: string | null; onPick: (family: string) => void }) {
  const [open, setOpen] = useState(false)
  const [fonts, setFonts] = useState<string[] | null>(null)
  const [query, setQuery] = useState('')
  /** 아래 공간이 모자라면 위로 펼친다 */
  const [up, setUp] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    systemFonts().then(setFonts)
    search.current?.focus()
    const close = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (fonts ?? []).filter((f) => !q || f.toLowerCase().includes(q))
  }, [fonts, query])

  return (
    <div className="font-picker" ref={root}>
      <button
        className={`btn font-picker-btn${value ? ' on' : ''}`}
        onClick={(e) => {
          setUp(e.currentTarget.getBoundingClientRect().bottom + 400 > window.innerHeight)
          setOpen((v) => !v)
        }} style={value ? { fontFamily: `"${value}"` } : undefined}>
        {value ?? '시스템 글꼴에서 고르기…'}
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div className={`font-picker-pop${up ? ' up' : ''}`}>
          <div className="font-picker-search">
            <Icon name="search" size={14} />
            <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="글꼴 이름 검색 (예: Nanum, D2Coding)" spellCheck={false} />
          </div>
          <div className="font-picker-list">
            {fonts === null && <div className="font-picker-empty">글꼴 목록을 읽는 중…</div>}
            {fonts !== null && shown.length === 0 && <div className="font-picker-empty">{fonts.length ? '찾는 글꼴이 없습니다.' : '설치된 글꼴 목록을 읽을 수 없습니다.'}</div>}
            {shown.map((f) => (
              <button
                key={f}
                className={`font-picker-item${f === value ? ' on' : ''}`}
                onClick={() => {
                  onPick(f)
                  setOpen(false)
                }}
              >
                <span className="name">{f}</span>
                <span className="sample" style={{ fontFamily: `"${f}"` }}>
                  가나다 Aa 123
                </span>
              </button>
            ))}
          </div>
          {fonts && <div className="font-picker-count">글꼴 {shown.length}개</div>}
        </div>
      )}
    </div>
  )
}
