import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react'
import { Icon } from '../ui'
import { parseSchema, type Relation, type Table } from './sqlSchema'

const ROW_H = 24
const HEAD_H = 34
const PAD_X = 12
const COL_GAP = 120
const ROW_GAP = 36
/** 선 끝과 테이블 사이 간격 — 관계 표시(까마귀발·두 줄)가 여기에 그려진다 */
const END = 12

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 글자 너비 재기 (화면 글꼴 기준) */
const measure = (() => {
  const ctx = document.createElement('canvas').getContext('2d')!
  return (text: string, font: string): number => {
    ctx.font = font
    return ctx.measureText(text).width
  }
})()
const FONT = getComputedStyle(document.body).fontFamily || 'sans-serif'
/** 자료형은 고정폭 글꼴로 그린다 (.sql-type 과 같게) */
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

function boxWidth(t: Table): number {
  let w = measure(t.name, `600 13px ${FONT}`) + PAD_X * 2 + 20
  for (const c of t.columns) w = Math.max(w, PAD_X * 2 + 22 + measure(c.name, `12px ${FONT}`) + 24 + measure(c.type, `11px ${MONO}`))
  return Math.min(480, Math.max(170, Math.ceil(w)))
}

/**
 * 외래 키 방향으로 층을 나눠 배치한다: 다른 테이블을 참조하지 않는 테이블이 왼쪽,
 * 참조하는 테이블일수록 오른쪽. 같은 층 안에서는 연결된 테이블 높이에 맞춰 순서를 정해 선이 덜 엇갈리게 한다.
 */
function layout(tables: Table[], relations: Relation[]): Record<string, Box> {
  const parents = new Map<string, string[]>(tables.map((t) => [t.name, []]))
  for (const r of relations) if (r.from !== r.to) parents.get(r.from)?.push(r.to)
  const rank = new Map<string, number>()
  const visiting = new Set<string>()
  const rankOf = (name: string): number => {
    if (rank.has(name)) return rank.get(name)!
    if (visiting.has(name)) return 0 // 순환 참조
    visiting.add(name)
    const ps = parents.get(name) ?? []
    const r = ps.length ? 1 + Math.max(...ps.map(rankOf)) : 0
    visiting.delete(name)
    rank.set(name, r)
    return r
  }
  tables.forEach((t) => rankOf(t.name))

  const columns: Table[][] = []
  for (const t of tables) (columns[rank.get(t.name)!] ??= []).push(t)
  const heights = new Map(tables.map((t) => [t.name, HEAD_H + Math.max(1, t.columns.length) * ROW_H]))
  const boxes: Record<string, Box> = {}
  const place = (): void => {
    let x = 0
    for (const col of columns) {
      if (!col) continue
      const w = Math.max(...col.map(boxWidth))
      let y = 0
      for (const t of col) {
        boxes[t.name] = { x, y, w, h: heights.get(t.name)! }
        y += heights.get(t.name)! + ROW_GAP
      }
      x += w + COL_GAP
    }
  }
  place()
  // 연결된 테이블들의 평균 높이 순으로 다시 정렬 (두 번)
  const neighbors = new Map<string, string[]>(tables.map((t) => [t.name, []]))
  for (const r of relations) {
    neighbors.get(r.from)?.push(r.to)
    neighbors.get(r.to)?.push(r.from)
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const col of columns) {
      if (!col) continue
      const center = (n: string): number => {
        const ns = neighbors.get(n)!.filter((m) => m !== n)
        return ns.length ? ns.reduce((s, m) => s + boxes[m].y + boxes[m].h / 2, 0) / ns.length : boxes[n].y
      }
      const key = new Map(col.map((t) => [t.name, center(t.name)]))
      col.sort((a, b) => key.get(a.name)! - key.get(b.name)!)
    }
    place()
  }
  return boxes
}

/** 테이블 안에서 열의 세로 위치 (가운데) */
const rowY = (t: Table, b: Box, col: string | undefined): number => {
  const i = col ? t.columns.findIndex((c) => c.name.toLowerCase() === col.toLowerCase()) : -1
  return b.y + (i < 0 ? HEAD_H / 2 : HEAD_H + i * ROW_H + ROW_H / 2)
}

export function SqlDiagram({ content, onViewSource }: { content: string; onViewSource: () => void }) {
  const schema = useMemo(() => parseSchema(content), [content])
  const auto = useMemo(() => layout(schema.tables, schema.relations), [schema])
  /** 사용자가 끌어 옮긴 위치 (테이블 이름별) */
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({})
  const [view, setView] = useState({ x: 40, y: 40, k: 1 })
  const [active, setActive] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const fitted = useRef(false)

  const boxes = useMemo(() => {
    const out: Record<string, Box> = {}
    for (const [name, b] of Object.entries(auto)) out[name] = moved[name] ? { ...b, ...moved[name] } : b
    return out
  }, [auto, moved])

  const fit = (): void => {
    const el = host.current
    const all = Object.values(boxes)
    if (!el || !all.length) return
    const minX = Math.min(...all.map((b) => b.x))
    const minY = Math.min(...all.map((b) => b.y))
    const w = Math.max(...all.map((b) => b.x + b.w)) - minX
    const h = Math.max(...all.map((b) => b.y + b.h)) - minY
    const k = Math.min(1.2, (el.clientWidth - 80) / w, (el.clientHeight - 80) / h)
    setView({ k, x: (el.clientWidth - w * k) / 2 - minX * k, y: Math.max(40, (el.clientHeight - h * k) / 2) - minY * k })
  }
  // 처음 열 때 전체가 보이게
  useLayoutEffect(() => {
    if (!fitted.current && schema.tables.length) {
      fitted.current = true
      fit()
    }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (factor: number, cx: number, cy: number): void =>
    setView((v) => {
      const k = Math.min(3, Math.max(0.15, v.k * factor))
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }
    })

  // 휠: 스크롤은 이동, ⌘/Ctrl·핀치는 확대
  const onWheel = (e: RWheelEvent): void => {
    const r = host.current!.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top)
    else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
  }
  useEffect(() => {
    // React 의 wheel 은 passive 라 기본 동작(페이지 확대)을 막지 못해 직접 등록한다
    const el = host.current
    const stop = (e: WheelEvent): void => e.preventDefault()
    el?.addEventListener('wheel', stop, { passive: false })
    return () => el?.removeEventListener('wheel', stop)
  }, [])

  // 끌기: 빈 곳은 화면 이동, 테이블은 위치 이동
  const drag = useRef<{ kind: 'pan' | 'table'; name?: string; sx: number; sy: number; ox: number; oy: number; movedPx: number } | null>(null)
  const onPointerDown = (e: RPointerEvent, name?: string): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    if (name) drag.current = { kind: 'table', name, sx: e.clientX, sy: e.clientY, ox: boxes[name].x, oy: boxes[name].y, movedPx: 0 }
    else drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, movedPx: 0 }
  }
  const onPointerMove = (e: RPointerEvent): void => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    d.movedPx = Math.max(d.movedPx, Math.abs(dx) + Math.abs(dy))
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
    else setMoved((m) => ({ ...m, [d.name!]: { x: d.ox + dx / view.k, y: d.oy + dy / view.k } }))
  }
  const onPointerUp = (): void => {
    const d = drag.current
    drag.current = null
    // 거의 안 움직였으면 클릭: 테이블을 고르거나(연결 강조) 빈 곳이면 해제
    if (d && d.movedPx < 4) setActive(d.kind === 'table' ? (active === d.name ? null : d.name!) : null)
  }

  const related = useMemo(() => {
    if (!active) return null
    const set = new Set([active])
    for (const r of schema.relations) if (r.from === active || r.to === active) (set.add(r.from), set.add(r.to))
    return set
  }, [active, schema])

  if (!schema.tables.length) {
    return (
      <div className="floating-host">
        <div className="empty-state">
          <Icon name="database" size={36} />
          <div>CREATE TABLE 문을 찾지 못했습니다.</div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>테이블 정의가 있는 SQL 파일이면 관계도로 보여 줍니다.</div>
        </div>
        <button className="btn floating-corner" onClick={onViewSource}>
          <Icon name="code" size={14} /> 소스 보기
        </button>
      </div>
    )
  }

  const tableOf = (name: string): Table => schema.tables.find((t) => t.name === name)!

  return (
    <div className="floating-host sql-diagram">
      <div className="sql-bar">
        <span>
          테이블 {schema.tables.length}개 · 관계 {schema.relations.length}개
        </span>
        <span className="grow" />
        <span className="sql-hint">끌어서 이동 · ⌘+휠로 확대 · 테이블을 누르면 연결 강조</span>
        <button className="icon-btn" title="축소" onClick={() => zoomAt(1 / 1.2, host.current!.clientWidth / 2, host.current!.clientHeight / 2)}>
          −
        </button>
        <span className="sql-zoom">{Math.round(view.k * 100)}%</span>
        <button className="icon-btn" title="확대" onClick={() => zoomAt(1.2, host.current!.clientWidth / 2, host.current!.clientHeight / 2)}>
          +
        </button>
        <button className="btn small" onClick={fit}>
          화면에 맞춤
        </button>
        {Object.keys(moved).length > 0 && (
          <button className="btn small" onClick={() => setMoved({})}>
            배치 초기화
          </button>
        )}
      </div>
      <div ref={host} className="sql-canvas" onWheel={onWheel} onPointerDown={(e) => onPointerDown(e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <svg width="100%" height="100%">
          <defs>
            {/* 참조하는 쪽(여럿)은 까마귀발, 참조되는 쪽(하나)은 두 줄 */}
            <marker id="sql-many" viewBox="0 0 12 12" refX="0" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M0 6 H12 M0 6 L12 1 M0 6 L12 11" className="sql-marker" />
            </marker>
            <marker id="sql-one" viewBox="0 0 12 12" refX="0" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0 6 H12 M5 1 V11 M9 1 V11" className="sql-marker" />
            </marker>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {schema.relations.map((r, i) => {
              const a = boxes[r.from]
              const b = boxes[r.to]
              const y1 = rowY(tableOf(r.from), a, r.fromCols[0])
              const y2 = rowY(tableOf(r.to), b, r.toCols[0])
              let d: string
              if (r.from === r.to) {
                // 자기 참조: 오른쪽으로 고리
                const x = a.x + a.w + END
                d = `M${x},${y1} C${x + 50},${y1} ${x + 50},${y2} ${x},${y2}`
              } else if (a.x > b.x + b.w) {
                const x1 = a.x - END
                const x2 = b.x + b.w + END
                const c = Math.max(40, (x1 - x2) / 2)
                d = `M${x1},${y1} C${x1 - c},${y1} ${x2 + c},${y2} ${x2},${y2}`
              } else if (a.x + a.w < b.x) {
                const x1 = a.x + a.w + END
                const x2 = b.x - END
                const c = Math.max(40, (x2 - x1) / 2)
                d = `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`
              } else {
                // 같은 열: 오른쪽으로 돌아서
                const x1 = a.x + a.w + END
                const x2 = b.x + b.w + END
                const out = Math.max(x1, x2) + 50
                d = `M${x1},${y1} C${out},${y1} ${out},${y2} ${x2},${y2}`
              }
              const on = !related || (related.has(r.from) && related.has(r.to) && (r.from === active || r.to === active))
              return (
                <path key={i} d={d} className={`sql-edge${on ? '' : ' dim'}${related && on ? ' hot' : ''}`} markerStart="url(#sql-many)" markerEnd="url(#sql-one)">
                  <title>{`${r.from}(${r.fromCols.join(', ')}) → ${r.to}(${r.toCols.join(', ')})`}</title>
                </path>
              )
            })}
            {schema.tables.map((t) => {
              const b = boxes[t.name]
              const dim = related && !related.has(t.name)
              return (
                <g
                  key={t.name}
                  transform={`translate(${b.x},${b.y})`}
                  className={`sql-table${dim ? ' dim' : ''}${active === t.name ? ' active' : ''}`}
                  onPointerDown={(e) => onPointerDown(e, t.name)}
                >
                  <rect width={b.w} height={b.h} rx={8} className="sql-box" />
                  <path d={`M0,${HEAD_H} H${b.w}`} className="sql-line" />
                  <text x={PAD_X} y={HEAD_H / 2 + 5} className="sql-title">
                    {t.name}
                  </text>
                  {t.columns.map((c, i) => (
                    <g key={c.name} transform={`translate(0,${HEAD_H + i * ROW_H})`}>
                      {i > 0 && <path d={`M${PAD_X},0 H${b.w - PAD_X}`} className="sql-line faint" />}
                      <text x={PAD_X} y={ROW_H / 2 + 4} className={`sql-key${c.pk ? ' pk' : c.fk ? ' fk' : ''}`}>
                        {c.pk ? 'PK' : c.fk ? 'FK' : c.unique ? 'UQ' : ''}
                      </text>
                      <text x={PAD_X + 24} y={ROW_H / 2 + 4} className={`sql-col${c.notNull ? '' : ' nullable'}`}>
                        {c.name}
                      </text>
                      <text x={b.w - PAD_X} y={ROW_H / 2 + 4} textAnchor="end" className="sql-type">
                        {c.type}
                      </text>
                    </g>
                  ))}
                  <title>{`${t.name} — ${t.line}번째 줄`}</title>
                </g>
              )
            })}
          </g>
        </svg>
        <button className="btn floating-corner" onPointerDown={(e) => e.stopPropagation()} onClick={onViewSource} title="SQL 코드를 고칩니다">
          <Icon name="code" size={14} /> 소스 보기
        </button>
      </div>
    </div>
  )
}
