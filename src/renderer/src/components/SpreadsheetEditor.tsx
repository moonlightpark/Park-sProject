import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Icon } from './ui'

/** 행 높이·머리글 크기 (px) */
const RH = 24
const HEAD_H = 24
const ROW_HEAD_W = 48
const DEFAULT_W = 100
const MIN_W = 40

interface Pos {
  r: number
  c: number
}

interface Format {
  delim: string
  eol: string
  trailingNewline: boolean
  bom: boolean
}

type Grid = string[][]

// ---------- CSV 읽기·쓰기 ----------

export const isSpreadsheet = (p: string): boolean => /\.(csv|tsv)$/i.test(p)

function detectFormat(path: string, text: string): Format {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  const count = (ch: string): number => firstLine.split(ch).length - 1
  const delim = /\.tsv$/i.test(path) ? '\t' : count(';') > count(',') ? ';' : ','
  return { delim, eol: text.includes('\r\n') ? '\r\n' : '\n', trailingNewline: /\r?\n$/.test(text), bom: text.charCodeAt(0) === 0xfeff }
}

/** 따옴표로 감싼 칸(쉼표·줄바꿈·"" 포함)까지 읽는다 */
export function parseDelimited(text: string, d: string): Grid {
  const rows: Grid = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
      } else field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === d) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (ch === '\r' && text[i + 1] === '\n') i++
    } else field += ch
    i++
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function quote(v: string, d: string): string {
  return v.includes(d) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** 원래 파일에 있던 크기는 지키고, 화면에서 늘어난 빈 행·열만 잘라 저장한다 */
function serialize(grid: Grid, f: Format, base: { rows: number; cols: number }): string {
  const empty = (row: string[] | undefined): boolean => !row || row.every((v) => v === '')
  let rows = grid.length
  while (rows > base.rows && empty(grid[rows - 1])) rows--
  let cols = 0
  for (let r = 0; r < rows; r++) cols = Math.max(cols, grid[r].length)
  while (cols > base.cols && grid.slice(0, rows).every((row) => (row[cols - 1] ?? '') === '')) cols--
  const lines: string[] = []
  for (let r = 0; r < rows; r++) {
    const cells: string[] = []
    for (let c = 0; c < cols; c++) cells.push(quote(grid[r][c] ?? '', f.delim))
    lines.push(cells.join(f.delim))
  }
  return (f.bom ? '﻿' : '') + lines.join(f.eol) + (f.trailingNewline && lines.length ? f.eol : '')
}

// ---------- 주소·수식 ----------

export function colName(c: number): string {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function parseRef(ref: string): Pos | null {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim())
  if (!m) return null
  let c = 0
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r: Number(m[2]) - 1, c: c - 1 }
}

const asNumber = (v: string): number | null => {
  const s = v.trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

type Val = number | string | boolean
class FormulaError extends Error {}

interface Token {
  t: 'num' | 'str' | 'ref' | 'range' | 'fn' | 'op'
  v: string
}

function tokenize(src: string): Token[] {
  const re = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\$?[A-Za-z]+\$?\d+:\$?[A-Za-z]+\$?\d+)|(\$?[A-Za-z]+\$?\d+)(?![A-Za-z(])|([A-Za-z_][A-Za-z0-9_.]*)\s*(?=\()|("(?:[^"]|"")*")|(<=|>=|<>|[-+*/^(),&<>=%]))/y
  const out: Token[] = []
  const end = src.trimEnd().length
  while (re.lastIndex < end) {
    const m = re.exec(src)
    if (!m) throw new FormulaError('#ERR')
    if (m[1]) out.push({ t: 'num', v: m[1] })
    else if (m[2]) out.push({ t: 'range', v: m[2] })
    else if (m[3]) out.push({ t: 'ref', v: m[3] })
    else if (m[4]) out.push({ t: 'fn', v: m[4].toUpperCase() })
    else if (m[5]) out.push({ t: 'str', v: m[5].slice(1, -1).replace(/""/g, '"') })
    else if (m[6]) out.push({ t: 'op', v: m[6] })
  }
  return out
}

const num = (x: Val): number => {
  if (typeof x === 'number') return x
  if (typeof x === 'boolean') return x ? 1 : 0
  if (x === '') return 0
  const n = asNumber(x)
  if (n === null) throw new FormulaError('#VALUE!')
  return n
}

const FUNCS: Record<string, (args: Val[][]) => Val> = {
  SUM: (a) => a.flat().reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0),
  AVERAGE: (a) => {
    const ns = a.flat().filter((v): v is number => typeof v === 'number')
    if (!ns.length) throw new FormulaError('#DIV/0!')
    return ns.reduce((s, v) => s + v, 0) / ns.length
  },
  MIN: (a) => Math.min(...a.flat().filter((v): v is number => typeof v === 'number')),
  MAX: (a) => Math.max(...a.flat().filter((v): v is number => typeof v === 'number')),
  COUNT: (a) => a.flat().filter((v) => typeof v === 'number').length,
  COUNTA: (a) => a.flat().filter((v) => v !== '').length,
  ROUND: (a) => {
    const p = 10 ** num(a[1]?.[0] ?? 0)
    return Math.round(num(a[0][0]) * p) / p
  },
  ABS: (a) => Math.abs(num(a[0][0])),
  IF: (a) => (num(a[0][0]) ? (a[1]?.[0] ?? true) : (a[2]?.[0] ?? false))
}

/** = 로 시작하는 칸의 값을 계산한다. 범위(A1:B3)는 함수 인자로만 쓸 수 있다. */
function evalFormula(src: string, cell: (p: Pos) => Val): Val {
  const toks = tokenize(src)
  let i = 0
  const isOp = (v: string): boolean => toks[i]?.t === 'op' && toks[i].v === v
  const expect = (v: string): void => {
    if (!isOp(v)) throw new FormulaError('#ERR')
    i++
  }

  const compare = (): Val => {
    const a = concat()
    for (const op of ['<=', '>=', '<>', '=', '<', '>']) {
      if (!isOp(op)) continue
      i++
      const b = concat()
      const [x, y] = typeof a === 'number' || typeof b === 'number' ? [num(a), num(b)] : [String(a), String(b)]
      return op === '=' ? x === y : op === '<>' ? x !== y : op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y
    }
    return a
  }
  const concat = (): Val => {
    let a = add()
    while (isOp('&')) {
      i++
      a = String(a) + String(add())
    }
    return a
  }
  const add = (): Val => {
    let a = mul()
    while (isOp('+') || isOp('-')) {
      const op = toks[i++].v
      const b = mul()
      a = op === '+' ? num(a) + num(b) : num(a) - num(b)
    }
    return a
  }
  const mul = (): Val => {
    let a = pow()
    while (isOp('*') || isOp('/')) {
      const op = toks[i++].v
      const b = num(pow())
      if (op === '/' && b === 0) throw new FormulaError('#DIV/0!')
      a = op === '*' ? num(a) * b : num(a) / b
    }
    return a
  }
  const pow = (): Val => {
    let a = unary()
    while (isOp('^')) {
      i++
      a = num(a) ** num(unary())
    }
    return a
  }
  const unary = (): Val => {
    if (isOp('-')) return i++, -num(unary())
    if (isOp('+')) return i++, num(unary())
    let v = primary()
    if (isOp('%')) i++, (v = num(v) / 100)
    return v
  }
  const range = (ref: string): Val[] => {
    const [a, b] = ref.split(':').map(parseRef)
    if (!a || !b) throw new FormulaError('#REF!')
    const out: Val[] = []
    for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
      for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) out.push(cell({ r, c }))
    return out
  }
  const primary = (): Val => {
    const tok = toks[i++]
    if (!tok) throw new FormulaError('#ERR')
    if (tok.t === 'num') return Number(tok.v)
    if (tok.t === 'str') return tok.v
    if (tok.t === 'ref') {
      const p = parseRef(tok.v)
      if (!p) throw new FormulaError('#REF!')
      return cell(p)
    }
    if (tok.t === 'fn') {
      const fn = FUNCS[tok.v]
      if (!fn) throw new FormulaError('#NAME?')
      expect('(')
      const args: Val[][] = []
      while (!isOp(')')) {
        args.push(toks[i]?.t === 'range' ? range(toks[i++].v) : [compare()])
        if (!isOp(')')) expect(',')
      }
      i++
      return fn(args)
    }
    if (tok.t === 'op' && tok.v === '(') {
      const v = compare()
      expect(')')
      return v
    }
    throw new FormulaError('#ERR')
  }

  const v = compare()
  if (i < toks.length) throw new FormulaError('#ERR')
  return v
}

const fmtVal = (v: Val): string =>
  typeof v === 'number' ? (Number.isFinite(v) ? String(Number(v.toPrecision(12))) : '#NUM!') : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v

/** 글자 수로 열 너비를 어림한다 (한글 등 넓은 글자는 두 배) */
function autoWidths(grid: Grid): number[] {
  const w: number[] = []
  for (const row of grid.slice(0, 200)) {
    row.forEach((v, c) => {
      let n = 0
      for (const ch of v.slice(0, 60)) n += ch.charCodeAt(0) > 0x2e80 ? 2 : 1
      w[c] = Math.max(w[c] ?? 0, n)
    })
  }
  return w.map((n) => Math.min(280, Math.max(64, n * 7 + 18)))
}

// ---------- 편집기 ----------

export function SpreadsheetEditor({ path, content, onChange }: { path: string; content: string; onChange: (text: string) => void }) {
  const [init] = useState(() => {
    const format = detectFormat(path, content)
    const grid = parseDelimited(format.bom ? content.slice(1) : content, format.delim)
    return { format, grid, widths: autoWidths(grid) }
  })
  const [grid, setGrid] = useState<Grid>(init.grid)
  const [colW, setColW] = useState<number[]>(init.widths)
  const [headerRow, setHeaderRow] = useState(true)
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 })
  const [focus, setFocus] = useState<Pos>({ r: 0, c: 0 })
  const [draft, setDraftState] = useState<string | null>(null)
  /** 'type' 은 입력하자마자 편집 (화살표가 다음 칸으로), 'edit' 는 F2·더블클릭 편집 (화살표가 글자 사이 이동) */
  const [editMode, setEditMode] = useState<'type' | 'edit'>('type')
  const [view, setView] = useState({ top: 0, height: 800 })

  const base = useRef({ rows: init.grid.length, cols: Math.max(0, ...init.grid.map((r) => r.length)) })
  const undoStack = useRef<Grid[]>([])
  const redoStack = useRef<Grid[]>([])
  const gridRef = useRef(grid)
  gridRef.current = grid
  const draftRef = useRef(draft)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const formulaRef = useRef<HTMLInputElement>(null)
  const dragging = useRef(false)

  const setDraft = (v: string | null): void => {
    draftRef.current = v
    setDraftState(v)
  }

  const dataCols = useMemo(() => Math.max(0, ...grid.map((r) => r.length)), [grid])
  const nRows = Math.max(grid.length + 50, 100, focus.r + 20)
  const nCols = Math.max(dataCols + 5, 26, focus.c + 5)
  const width = (c: number): number => colW[c] ?? DEFAULT_W
  const lefts = useMemo(() => {
    const out = [0]
    for (let c = 0; c < nCols; c++) out.push(out[c] + (colW[c] ?? DEFAULT_W))
    return out
  }, [colW, nCols])

  const raw = (p: Pos): string => grid[p.r]?.[p.c] ?? ''

  // 수식 결과는 표가 바뀔 때마다 새로 계산해 둔다
  const values = useMemo(() => {
    const cache = new Map<string, Val>()
    const visiting = new Set<string>()
    const get = (p: Pos): Val => {
      const key = `${p.r},${p.c}`
      const hit = cache.get(key)
      if (hit !== undefined) return hit
      const v = grid[p.r]?.[p.c] ?? ''
      let out: Val
      if (!v.startsWith('=') || v.length < 2) out = asNumber(v) ?? v
      else if (visiting.has(key)) throw new FormulaError('#CYCLE!')
      else {
        visiting.add(key)
        try {
          out = evalFormula(v.slice(1), get)
        } catch (e) {
          if (!(e instanceof FormulaError)) throw e
          out = e.message || '#ERR'
        } finally {
          visiting.delete(key)
        }
      }
      cache.set(key, out)
      return out
    }
    return get
  }, [grid])

  const commit = useCallback((next: Grid) => {
    undoStack.current.push(gridRef.current)
    if (undoStack.current.length > 200) undoStack.current.shift()
    redoStack.current = []
    gridRef.current = next
    setGrid(next)
    onChangeRef.current(serialize(next, init.format, base.current))
  }, [init.format])

  const setCells = (cells: { r: number; c: number; v: string }[]): void => {
    const next = gridRef.current.slice()
    let changed = false
    for (const { r, c, v } of cells) {
      if ((next[r]?.[c] ?? '') === v) continue
      while (next.length <= r) next.push([])
      const row = next[r] === gridRef.current[r] ? next[r].slice() : next[r]
      while (row.length <= c) row.push('')
      row[c] = v
      next[r] = row
      changed = true
    }
    if (changed) commit(next)
  }

  const history = (from: { current: Grid[] }, to: { current: Grid[] }): void => {
    const g = from.current.pop()
    if (!g) return
    to.current.push(gridRef.current)
    gridRef.current = g
    setGrid(g)
    onChangeRef.current(serialize(g, init.format, base.current))
  }
  const undo = (): void => history(undoStack, redoStack)
  const redo = (): void => history(redoStack, undoStack)

  const sel = {
    r1: Math.min(anchor.r, focus.r),
    r2: Math.max(anchor.r, focus.r),
    c1: Math.min(anchor.c, focus.c),
    c2: Math.max(anchor.c, focus.c)
  }

  const focusInput = (): void => inputRef.current?.focus({ preventScroll: true })
  useEffect(focusInput, [])

  const commitDraft = (): void => {
    const v = draftRef.current
    if (v === null) return
    setDraft(null)
    setCells([{ ...focus, v }])
  }

  const select = (p: Pos, extend = false): void => {
    const q = { r: Math.max(0, p.r), c: Math.max(0, p.c) }
    setFocus(q)
    if (!extend) setAnchor(q)
  }

  // 키보드로 옮긴 칸이 화면 밖이면 스크롤한다 (고정된 머리글 만큼 빼고 계산)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const top = focus.r * RH
    const visH = el.clientHeight - HEAD_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + RH > el.scrollTop + visH) el.scrollTop = top + RH - visH
    const left = lefts[focus.c]
    const visW = el.clientWidth - ROW_HEAD_W
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (left + width(focus.c) > el.scrollLeft + visW) el.scrollLeft = left + width(focus.c) - visW
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = (): void => setView({ top: el.scrollTop, height: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const up = (): void => void (dragging.current = false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // ---------- 행·열 편집 ----------

  const rangeCells = (v: (r: number, c: number) => string): { r: number; c: number; v: string }[] => {
    const out: { r: number; c: number; v: string }[] = []
    for (let r = sel.r1; r <= Math.min(sel.r2, grid.length - 1); r++) for (let c = sel.c1; c <= sel.c2; c++) out.push({ r, c, v: v(r, c) })
    return out
  }

  const insertRow = (at: number): void => {
    const next = grid.slice()
    while (next.length < at) next.push([])
    next.splice(at, 0, [])
    if (at < base.current.rows) base.current.rows++
    commit(next)
  }
  const insertCol = (at: number): void => {
    if (at < base.current.cols) base.current.cols++
    commit(grid.map((row) => (row.length > at ? [...row.slice(0, at), '', ...row.slice(at)] : row)))
    setColW((w) => [...w.slice(0, at), DEFAULT_W, ...w.slice(at)])
  }
  const deleteRows = (): void => {
    const n = Math.max(0, Math.min(sel.r2, grid.length - 1) - sel.r1 + 1)
    if (!n) return
    base.current.rows = Math.max(0, base.current.rows - Math.max(0, Math.min(n, base.current.rows - sel.r1)))
    commit([...grid.slice(0, sel.r1), ...grid.slice(sel.r1 + n)])
    select({ r: sel.r1, c: focus.c })
  }
  const deleteCols = (): void => {
    const n = sel.c2 - sel.c1 + 1
    base.current.cols = Math.max(0, base.current.cols - Math.max(0, Math.min(n, base.current.cols - sel.c1)))
    commit(grid.map((row) => [...row.slice(0, sel.c1), ...row.slice(sel.c2 + 1)]))
    setColW((w) => [...w.slice(0, sel.c1), ...w.slice(sel.c2 + 1)])
    select({ r: focus.r, c: sel.c1 })
  }
  const sort = (dir: 1 | -1): void => {
    const start = headerRow ? 1 : 0
    const c = focus.c
    const body = grid.slice(start)
    body.sort((a, b) => {
      const x = a[c] ?? ''
      const y = b[c] ?? ''
      if (x === '' || y === '') return x === y ? 0 : x === '' ? 1 : -1
      const nx = asNumber(x)
      const ny = asNumber(y)
      return dir * (nx !== null && ny !== null ? nx - ny : x.localeCompare(y, 'ko'))
    })
    commit([...grid.slice(0, start), ...body])
  }

  // ---------- 복사·붙여넣기 (엑셀·구글 시트와 같은 탭 구분 형식) ----------

  const copyText = (): string => {
    const lines: string[] = []
    for (let r = sel.r1; r <= sel.r2; r++) {
      const cells: string[] = []
      for (let c = sel.c1; c <= sel.c2; c++) cells.push(quote(raw({ r, c }), '\t'))
      lines.push(cells.join('\t'))
    }
    return lines.join('\n')
  }

  const paste = (text: string): void => {
    const rows = parseDelimited(text.replace(/\r?\n$/, ''), '\t')
    if (!rows.length) return
    if (rows.length === 1 && rows[0].length === 1 && (sel.r1 !== sel.r2 || sel.c1 !== sel.c2)) {
      const v = rows[0][0]
      const cells: { r: number; c: number; v: string }[] = []
      for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) cells.push({ r, c, v })
      return setCells(cells)
    }
    setCells(rows.flatMap((row, dr) => row.map((v, dc) => ({ r: sel.r1 + dr, c: sel.c1 + dc, v }))))
    setAnchor({ r: sel.r1, c: sel.c1 })
    setFocus({ r: sel.r1 + rows.length - 1, c: sel.c1 + Math.max(...rows.map((r) => r.length)) - 1 })
  }

  // ---------- 키보드 ----------

  const pageRows = Math.max(1, Math.floor((view.height - HEAD_H) / RH) - 1)

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing) return
    const mod = e.metaKey || e.ctrlKey
    if (draftRef.current !== null) {
      if (e.key === 'Escape') return e.preventDefault(), setDraft(null)
      if (e.key === 'Enter' && e.altKey) {
        e.preventDefault()
        const el = e.currentTarget
        const v = el.value.slice(0, el.selectionStart) + '\n' + el.value.slice(el.selectionEnd)
        const at = el.selectionStart + 1
        setDraft(v)
        requestAnimationFrame(() => el.setSelectionRange(at, at))
        return
      }
      const moves: Record<string, [number, number]> = { Enter: [e.shiftKey ? -1 : 1, 0], Tab: [0, e.shiftKey ? -1 : 1] }
      if (editMode === 'type') Object.assign(moves, { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] })
      const m = moves[e.key]
      if (m) {
        e.preventDefault()
        commitDraft()
        select({ r: focus.r + m[0], c: focus.c + m[1] })
      }
      return
    }

    const dataEnd = { r: Math.max(0, grid.length - 1), c: Math.max(0, dataCols - 1) }
    const arrows: Record<string, Pos> = {
      ArrowUp: { r: mod ? 0 : focus.r - 1, c: focus.c },
      ArrowDown: { r: mod ? dataEnd.r : focus.r + 1, c: focus.c },
      ArrowLeft: { r: focus.r, c: mod ? 0 : focus.c - 1 },
      ArrowRight: { r: focus.r, c: mod ? dataEnd.c : focus.c + 1 },
      PageUp: { r: focus.r - pageRows, c: focus.c },
      PageDown: { r: focus.r + pageRows, c: focus.c },
      Home: { r: mod ? 0 : focus.r, c: 0 }
    }
    if (arrows[e.key]) return e.preventDefault(), select(arrows[e.key], e.shiftKey)
    if (e.key === 'Tab') return e.preventDefault(), select({ r: focus.r, c: focus.c + (e.shiftKey ? -1 : 1) })
    if (e.key === 'Enter') return e.preventDefault(), select({ r: focus.r + (e.shiftKey ? -1 : 1), c: focus.c })
    if (e.key === 'F2') {
      e.preventDefault()
      setEditMode('edit')
      return setDraft(raw(focus))
    }
    if (e.key === 'Delete' || e.key === 'Backspace') return e.preventDefault(), setCells(rangeCells(() => ''))
    if (mod && e.key.toLowerCase() === 'z') return e.preventDefault(), e.shiftKey ? redo() : undo()
    if (mod && e.key.toLowerCase() === 'y') return e.preventDefault(), redo()
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setAnchor(dataEnd)
      return setFocus({ r: 0, c: 0 })
    }
  }

  // 아무 칸도 편집 중이 아닐 때 글자를 치면 (한글 조합 포함) 그 글자로 편집을 시작한다
  const onInput = (v: string): void => {
    if (draftRef.current === null) setEditMode('type')
    setDraft(v)
  }

  // ---------- 마우스 ----------

  const cellAt = (e: MouseEvent): Pos | null => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-r]')
    return el ? { r: Number(el.dataset.r), c: Number(el.dataset.c) } : null
  }

  const onMouseDown = (e: MouseEvent): void => {
    const p = cellAt(e)
    if (!p || e.button !== 0) return
    e.preventDefault()
    commitDraft()
    if (p.c < 0) {
      // 행 번호: 행 전체 선택 (커서는 그 행의 첫 칸)
      setAnchor({ r: e.shiftKey ? anchor.r : p.r, c: Math.max(dataCols - 1, 0) })
      setFocus({ r: p.r, c: 0 })
    } else if (p.r < 0) {
      // 열 머리글: 열 전체 선택 (커서는 그 열의 첫 칸)
      setAnchor({ r: Math.max(grid.length - 1, 0), c: e.shiftKey ? anchor.c : p.c })
      setFocus({ r: 0, c: p.c })
    } else select(p, e.shiftKey)
    dragging.current = p.r >= 0 && p.c >= 0
    focusInput()
  }

  const onMouseOver = (e: MouseEvent): void => {
    if (!dragging.current) return
    const p = cellAt(e)
    if (p && p.r >= 0 && p.c >= 0 && (p.r !== focus.r || p.c !== focus.c)) setFocus(p)
  }

  const onDoubleClick = (e: MouseEvent): void => {
    const p = cellAt(e)
    if (!p || p.r < 0 || p.c < 0) return
    select(p)
    setEditMode('edit')
    setDraft(raw(p))
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) (el.focus({ preventScroll: true }), el.setSelectionRange(el.value.length, el.value.length))
    })
  }

  const startResize = (e: MouseEvent, c: number): void => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const w0 = width(c)
    const move = (ev: globalThis.MouseEvent): void =>
      setColW((w) => {
        const next = w.slice()
        for (let i = next.length; i < c; i++) next[i] = DEFAULT_W
        next[c] = Math.max(MIN_W, w0 + ev.clientX - x0)
        return next
      })
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---------- 화면 ----------

  const first = Math.max(0, Math.floor(view.top / RH) - 5)
  const last = Math.min(nRows - 1, Math.ceil((view.top + view.height) / RH) + 5)
  const cols = Array.from({ length: nCols }, (_, c) => c)

  const stats = useMemo(() => {
    let count = 0
    let numbers = 0
    let sum = 0
    for (let r = sel.r1; r <= Math.min(sel.r2, grid.length - 1); r++) {
      for (let c = sel.c1; c <= sel.c2; c++) {
        if (raw({ r, c }) === '') continue
        count++
        const v = values({ r, c })
        if (typeof v === 'number') (numbers++, (sum += v))
      }
    }
    return { count, numbers, sum }
  }, [sel.r1, sel.r2, sel.c1, sel.c2, grid, values]) // eslint-disable-line react-hooks/exhaustive-deps

  const editing = draft !== null
  const selLabel = `${colName(sel.c1)}${sel.r1 + 1}` + (sel.r1 !== sel.r2 || sel.c1 !== sel.c2 ? `:${colName(sel.c2)}${sel.r2 + 1}` : '')

  return (
    <div className="sheet">
      {/* 버튼을 눌러도 키보드 포커스는 표에 남겨 둔다 */}
      <div className="doc-toolbar sheet-toolbar" onMouseDown={(e) => (e.target as HTMLElement).tagName !== 'INPUT' && e.preventDefault()}>
        <button className="icon-btn" title="실행 취소" onClick={undo} disabled={!undoStack.current.length}>
          <Icon name="undo" />
        </button>
        <button className="icon-btn" title="다시 실행" onClick={redo} disabled={!redoStack.current.length}>
          <Icon name="redo" />
        </button>
        <span className="sep" />
        <button className="btn small" onClick={() => insertRow(sel.r1)} title="선택한 행 위에 빈 행을 넣습니다">
          행 위에 추가
        </button>
        <button className="btn small" onClick={() => insertRow(sel.r2 + 1)}>
          행 아래 추가
        </button>
        <button className="btn small" onClick={() => insertCol(sel.c1)}>
          열 왼쪽 추가
        </button>
        <button className="btn small" onClick={() => insertCol(sel.c2 + 1)}>
          열 오른쪽 추가
        </button>
        <button className="btn small" onClick={deleteRows}>
          행 삭제
        </button>
        <button className="btn small" onClick={deleteCols}>
          열 삭제
        </button>
        <span className="sep" />
        <button className="btn small" onClick={() => sort(1)} title={`${colName(focus.c)} 열 기준 오름차순`}>
          오름차순 ↑
        </button>
        <button className="btn small" onClick={() => sort(-1)} title={`${colName(focus.c)} 열 기준 내림차순`}>
          내림차순 ↓
        </button>
        <label className="sheet-check" title="첫 행을 굵게 표시하고 정렬에서 뺍니다">
          <input type="checkbox" checked={headerRow} onChange={(e) => setHeaderRow(e.target.checked)} /> 첫 행은 머리글
        </label>
      </div>

      <div className="sheet-bar">
        <input
          key={selLabel}
          className="sheet-name"
          defaultValue={selLabel}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const [a, b] = e.currentTarget.value.split(':').map(parseRef)
            if (a) (setAnchor(a), setFocus(b ?? a), focusInput())
          }}
          title="칸 주소 (예: B3) 를 입력하고 Enter 로 이동"
        />
        <span className="sheet-fx">fx</span>
        <input
          ref={formulaRef}
          className="sheet-formula"
          value={draft ?? raw(focus)}
          onChange={(e) => {
            setEditMode('edit')
            setDraft(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') (e.preventDefault(), commitDraft(), focusInput())
            else if (e.key === 'Escape') (e.preventDefault(), setDraft(null), focusInput())
          }}
          onBlur={(e) => e.relatedTarget !== inputRef.current && commitDraft()}
          spellCheck={false}
        />
      </div>

      <div
        className="sheet-scroll"
        ref={scrollRef}
        onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        onMouseDown={onMouseDown}
        onMouseOver={onMouseOver}
        onDoubleClick={onDoubleClick}
      >
        <div className="sheet-canvas" style={{ width: ROW_HEAD_W + lefts[nCols], height: HEAD_H + nRows * RH }}>
          <div className="sheet-head" style={{ width: ROW_HEAD_W + lefts[nCols] }}>
            <div className="sheet-corner" />
            {cols.map((c) => (
              <div key={c} className={`sheet-colhead${c >= sel.c1 && c <= sel.c2 ? ' on' : ''}`} style={{ width: width(c) }} data-r={-1} data-c={c}>
                {colName(c)}
                <span className="sheet-resize" onMouseDown={(e) => startResize(e, c)} />
              </div>
            ))}
          </div>
          <div style={{ height: first * RH }} />
          {Array.from({ length: last - first + 1 }, (_, i) => first + i).map((r) => (
            <div key={r} className={`sheet-row${headerRow && r === 0 ? ' header' : ''}`}>
              <div className={`sheet-rowhead${r >= sel.r1 && r <= sel.r2 ? ' on' : ''}`} data-r={r} data-c={-1}>
                {r + 1}
              </div>
              {cols.map((c) => {
                const text = raw({ r, c })
                const v = text.startsWith('=') ? values({ r, c }) : text
                const shown = fmtVal(v)
                const inSel = r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2
                const cls =
                  'sheet-cell' +
                  (inSel ? ' sel' : '') +
                  (typeof v === 'number' || (typeof v === 'string' && asNumber(v) !== null) ? ' num' : '') +
                  (typeof v === 'string' && v.startsWith('#') && text.startsWith('=') ? ' err' : '')
                return (
                  <div key={c} className={cls} style={{ width: width(c) }} data-r={r} data-c={c} title={shown.length > 20 ? shown : undefined}>
                    {shown}
                  </div>
                )
              })}
            </div>
          ))}
          <div
            className="sheet-cursor"
            style={{ top: HEAD_H + focus.r * RH, left: ROW_HEAD_W + lefts[focus.c], width: width(focus.c), height: RH }}
          />
          <textarea
            ref={inputRef}
            className={`sheet-input${editing ? ' editing' : ''}`}
            style={{ top: HEAD_H + focus.r * RH, left: ROW_HEAD_W + lefts[focus.c], minWidth: width(focus.c), height: RH }}
            value={draft ?? ''}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={(e) => e.relatedTarget !== formulaRef.current && commitDraft()}
            onCopy={(e) => {
              if (editing) return
              e.preventDefault()
              e.clipboardData.setData('text/plain', copyText())
            }}
            onCut={(e) => {
              if (editing) return
              e.preventDefault()
              e.clipboardData.setData('text/plain', copyText())
              setCells(rangeCells(() => ''))
            }}
            onPaste={(e) => {
              if (editing) return
              e.preventDefault()
              paste(e.clipboardData.getData('text/plain'))
            }}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="sheet-status">
        <span>
          {grid.length}행 × {dataCols}열
        </span>
        <span className="grow" />
        {stats.count > 1 && <span>개수 {stats.count}</span>}
        {stats.numbers > 0 && stats.count > 1 && (
          <>
            <span>합계 {fmtVal(stats.sum)}</span>
            <span>평균 {fmtVal(stats.sum / stats.numbers)}</span>
          </>
        )}
      </div>
    </div>
  )
}
