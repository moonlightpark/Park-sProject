import { useMemo } from 'react'
import { diffLines } from 'diff'
import { t } from '../i18n/ko'

interface Line {
  type: 'add' | 'del' | 'same' | 'skip'
  text: string
}

const CONTEXT = 3

export function computeDiff(before: string, after: string): { lines: Line[]; added: number; removed: number } {
  const parts = diffLines(before, after)
  const raw: Line[] = []
  let added = 0
  let removed = 0
  for (const p of parts) {
    const lines = p.value.replace(/\n$/, '').split('\n')
    for (const text of lines) {
      if (p.added) {
        raw.push({ type: 'add', text })
        added++
      } else if (p.removed) {
        raw.push({ type: 'del', text })
        removed++
      } else raw.push({ type: 'same', text })
    }
  }
  // 바뀐 줄 주변만 남기고 나머지는 접는다
  const keep = raw.map(() => false)
  raw.forEach((l, i) => {
    if (l.type !== 'same') for (let j = Math.max(0, i - CONTEXT); j <= Math.min(raw.length - 1, i + CONTEXT); j++) keep[j] = true
  })
  const lines: Line[] = []
  let skipped = 0
  raw.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) lines.push({ type: 'skip', text: `… ${skipped}줄 변경 없음 …` })
      skipped = 0
      lines.push(l)
    } else skipped++
  })
  if (skipped) lines.push({ type: 'skip', text: `… ${skipped}줄 변경 없음 …` })
  return { lines, added, removed }
}

export function DiffView({ before, after }: { before: string; after: string }) {
  const { lines } = useMemo(() => computeDiff(before, after), [before, after])
  if (!lines.some((l) => l.type === 'add' || l.type === 'del')) {
    return <div className="empty-state">{t.review.noChanges}</div>
  }
  return (
    <div className="diff">
      {lines.map((l, i) => (
        <div key={i} className={`diff-line ${l.type}`}>
          {l.type !== 'skip' && <span className="gutter">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>}
          <span>{l.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}

/** git 이 만든 통합 패치(diff/show 출력)를 줄 색으로 구분해 보여 준다 */
export function PatchView({ patch }: { patch: string }) {
  const lines = useMemo(() => patch.split('\n'), [patch])
  return (
    <div className="diff">
      {lines.map((l, i) => {
        const meta = /^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(l)
        const cls = meta || l.startsWith('@@') ? 'skip' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : 'same'
        return (
          <div key={i} className={`diff-line ${cls}`} style={cls === 'skip' ? { justifyContent: 'flex-start' } : undefined}>
            <span>{l || ' '}</span>
          </div>
        )
      })}
    </div>
  )
}
