/**
 * SQL 파일에서 테이블 구조(CREATE TABLE·ALTER TABLE … FOREIGN KEY)를 읽는다.
 * PostgreSQL·MySQL·SQLite·SQL Server 의 흔한 문법을 대상으로 한 가벼운 해석기 — 실행은 하지 않는다.
 */

export interface Column {
  name: string
  type: string
  pk: boolean
  fk: boolean
  notNull: boolean
  unique: boolean
}

export interface Table {
  name: string
  columns: Column[]
  /** 소스에서 CREATE TABLE 이 시작하는 줄 (1부터) */
  line: number
}

export interface Relation {
  from: string
  fromCols: string[]
  to: string
  toCols: string[]
}

export interface Schema {
  tables: Table[]
  relations: Relation[]
}

/** 주석을 같은 길이의 공백으로 바꾼다 (줄 번호를 지키려고 줄바꿈은 남김) */
function stripComments(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const n = sql[i + 1]
    if (c === "'" || c === '"' || c === '`') {
      const end = findQuoteEnd(sql, i)
      out += sql.slice(i, end)
      i = end
    } else if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') (out += ' '), i++
    } else if (c === '#' && (i === 0 || sql[i - 1] === '\n')) {
      // MySQL 줄 주석
      while (i < sql.length && sql[i] !== '\n') (out += ' '), i++
    } else if (c === '/' && n === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end < 0 ? sql.length : end + 2
      out += sql.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
    } else (out += c), i++
  }
  return out
}

function findQuoteEnd(s: string, start: number): number {
  const q = s[start]
  let i = start + 1
  while (i < s.length) {
    if (s[i] === q) {
      if (s[i + 1] === q) i += 2
      else return i + 1
    } else i++
  }
  return s.length
}

/** 괄호·따옴표 밖의 구분자로 나눈다 */
function splitTop(s: string, sep: string): { text: string; start: number }[] {
  const parts: { text: string; start: number }[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') i = findQuoteEnd(s, i) - 1
    else if (c === '[') i = Math.max(i, s.indexOf(']', i))
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === sep && depth === 0) {
      parts.push({ text: s.slice(from, i), start: from })
      from = i + 1
    }
  }
  parts.push({ text: s.slice(from), start: from })
  return parts
}

/** "public"."users" · `users` · [dbo].[users] → public.users */
const unquote = (name: string): string =>
  name
    .trim()
    .split(/\s*\.\s*/)
    .map((p) => p.replace(/^["`[]|["`\]]$/g, ''))
    .join('.')

const IDENT = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[\\p{L}_][\\p{L}\\p{N}_$]*)'
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`
const identList = (s: string): string[] => splitTop(s, ',').map((p) => unquote(p.text.trim().split(/\s+/)[0])).filter(Boolean)

/** 다른 이름(스키마 없이 쓴 참조)도 같은 테이블로 이어 준다 */
function resolveTable(tables: Table[], name: string): string {
  const lower = name.toLowerCase()
  const exact = tables.find((t) => t.name.toLowerCase() === lower)
  if (exact) return exact.name
  const short = lower.split('.').pop()
  return tables.find((t) => t.name.toLowerCase().split('.').pop() === short)?.name ?? name
}

export function parseSchema(sql: string): Schema {
  const text = stripComments(sql)
  const tables: Table[] = []
  const relations: Relation[] = []
  /** ALTER 로 붙인 기본 키, 테이블 끝에 따로 적은 UNIQUE (모든 문장을 읽은 뒤 반영) */
  const pendingPk: [string, string[]][] = []
  const pendingUnique: [Table, string][] = []
  const pendingCols: [string, string, string][] = []
  const lineAt = (offset: number): number => sql.slice(0, offset).split('\n').length

  for (const stmt of splitTop(text, ';')) {
    const s = stmt.text
    const create = new RegExp(String.raw`^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})\s*\(`, 'iu').exec(s)
    if (create) {
      const open = create.index + create[0].length - 1
      const body = bodyInParens(s, open)
      const lead = s.length - s.trimStart().length
      const table: Table = { name: unquote(create[1]), columns: [], line: lineAt(stmt.start + lead) }
      const pks: string[] = []
      for (const part of splitTop(body, ',')) {
        const item = part.text.trim()
        if (!item) continue
        const def = item.replace(/^CONSTRAINT\s+\S+\s+/i, '')
        let m: RegExpExecArray | null
        if ((m = /^PRIMARY\s+KEY\s*(?:\w+\s*)?\(([^)]*)\)/i.exec(def))) pks.push(...identList(m[1]))
        else if ((m = new RegExp(String.raw`^FOREIGN\s+KEY\s*(?:${IDENT}\s*)?\(([^)]*)\)\s*REFERENCES\s+(${QNAME})\s*(?:\(([^)]*)\))?`, 'iu').exec(def))) {
          relations.push({ from: table.name, fromCols: identList(m[1]), to: unquote(m[2]), toCols: m[3] ? identList(m[3]) : [] })
        } else if (/^(UNIQUE|KEY|INDEX|FULLTEXT|SPATIAL|CHECK|EXCLUDE|PERIOD|LIKE)\b/i.test(def)) {
          const u = /^UNIQUE\s*(?:KEY|INDEX)?\s*(?:\S+\s*)?\(([^)]*)\)/i.exec(def)
          if (u && identList(u[1]).length === 1) {
            const col = identList(u[1])[0]
            pendingUnique.push([table, col])
          }
        } else {
          const col = new RegExp(String.raw`^(${IDENT})\s*(.*)$`, 'su').exec(item)
          if (!col) continue
          const rest = col[2]
          const type = columnType(rest)
          const name = unquote(col[1])
          const ref = new RegExp(String.raw`REFERENCES\s+(${QNAME})\s*(?:\(([^)]*)\))?`, 'iu').exec(rest)
          if (ref) relations.push({ from: table.name, fromCols: [name], to: unquote(ref[1]), toCols: ref[2] ? identList(ref[2]) : [] })
          table.columns.push({
            name,
            type,
            pk: /\bPRIMARY\s+KEY\b/i.test(rest),
            fk: !!ref,
            notNull: /\bNOT\s+NULL\b/i.test(rest) || /\bPRIMARY\s+KEY\b/i.test(rest),
            unique: /\bUNIQUE\b/i.test(rest)
          })
        }
      }
      for (const pk of pks) {
        const c = table.columns.find((x) => x.name.toLowerCase() === pk.toLowerCase())
        if (c) (c.pk = true), (c.notNull = true)
      }
      tables.push(table)
      continue
    }

    // ALTER TABLE a ADD [CONSTRAINT x] FOREIGN KEY (c) REFERENCES b (d)  — 한 문장에 여러 개도
    const alter = new RegExp(String.raw`^\s*ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(${QNAME})`, 'iu').exec(s)
    if (alter) {
      const from = unquote(alter[1])
      const fkRe = new RegExp(String.raw`FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+(${QNAME})\s*(?:\(([^)]*)\))?`, 'giu')
      for (const m of s.matchAll(fkRe)) relations.push({ from, fromCols: identList(m[1]), to: unquote(m[2]), toCols: m[3] ? identList(m[3]) : [] })
      const pkRe = /PRIMARY\s+KEY\s*\(([^)]*)\)/gi
      for (const m of s.matchAll(pkRe)) pendingPk.push([from, identList(m[1])])
      // ADD [COLUMN] 이름 자료형 …  (ADD CONSTRAINT·FOREIGN KEY 등은 위에서 처리)
      const colRe = new RegExp(String.raw`\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?!(?:CONSTRAINT|FOREIGN|PRIMARY|UNIQUE|INDEX|KEY|CHECK)\b)(${IDENT})\s+([^,]+)`, 'giu')
      for (const m of s.matchAll(colRe)) pendingCols.push([from, unquote(m[1]), m[2]])
    }
  }

  for (const [name, col, rest] of pendingCols) {
    const t = tables.find((x) => x.name === resolveTable(tables, name))
    if (!t || t.columns.some((c) => c.name.toLowerCase() === col.toLowerCase())) continue
    const ref = new RegExp(String.raw`REFERENCES\s+(${QNAME})\s*(?:\(([^)]*)\))?`, 'iu').exec(rest)
    if (ref) relations.push({ from: t.name, fromCols: [col], to: unquote(ref[1]), toCols: ref[2] ? identList(ref[2]) : [] })
    t.columns.push({ name: col, type: columnType(rest), pk: /\bPRIMARY\s+KEY\b/i.test(rest), fk: !!ref, notNull: /\bNOT\s+NULL\b/i.test(rest), unique: /\bUNIQUE\b/i.test(rest) })
  }

  // ALTER 로 나중에 붙인 기본 키·고유 키·외래 키 표시
  for (const [name, cols] of pendingPk) {
    const t = tables.find((x) => x.name === resolveTable(tables, name))
    for (const col of cols) {
      const c = t?.columns.find((x) => x.name.toLowerCase() === col.toLowerCase())
      if (c) (c.pk = true), (c.notNull = true)
    }
  }
  for (const [t, col] of pendingUnique) {
    const c = t.columns.find((x) => x.name.toLowerCase() === col.toLowerCase())
    if (c) c.unique = true
  }
  for (const r of relations) {
    r.from = resolveTable(tables, r.from)
    r.to = resolveTable(tables, r.to)
    const from = tables.find((t) => t.name === r.from)
    for (const col of r.fromCols) {
      const c = from?.columns.find((x) => x.name.toLowerCase() === col.toLowerCase())
      if (c) c.fk = true
    }
    // 참조 열을 안 쓰면 상대 테이블의 기본 키
    if (!r.toCols.length) r.toCols = tables.find((t) => t.name === r.to)?.columns.filter((c) => c.pk).map((c) => c.name) ?? []
  }
  return { tables, relations: relations.filter((r) => tables.some((t) => t.name === r.from) && tables.some((t) => t.name === r.to)) }
}

/** 열 정의에서 자료형만: 제약 조건 키워드 앞까지 (예: varchar(255), numeric(10, 2), timestamp with time zone) */
function columnType(rest: string): string {
  return rest
    .split(/\s+(?=(?:NOT\s+NULL|NULL|PRIMARY|REFERENCES|DEFAULT|UNIQUE|CHECK|CONSTRAINT|COLLATE|GENERATED|AUTO_INCREMENT|AUTOINCREMENT|IDENTITY|COMMENT|ON\s+UPDATE)\b)/i)[0]
    .trim()
    .replace(/\s+/g, ' ')
}

/** 여는 괄호 위치에서 짝이 맞는 닫는 괄호까지의 안쪽 */
function bodyInParens(s: string, open: number): string {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') i = findQuoteEnd(s, i) - 1
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return s.slice(open + 1, i)
  }
  return s.slice(open + 1)
}
