import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { panels, usePanels } from '../lib/panels'
import { t, timeAgo } from '../i18n/ko'
import { PatchView } from '../components/DiffView'
import { Icon, toast } from '../components/ui'

interface Change {
  path: string
  status: string
  staged: boolean
}
interface Commit {
  hash: string
  short: string
  author: string
  time: number
  subject: string
  refs: string
  parents: number
}

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

type Selection = { kind: 'file'; path: string } | { kind: 'commit'; hash: string } | null

/** 깃트리: 변경 사항을 골라 커밋하고, 커밋 기록과 각 변경 내용을 본다 */
export function GitMode({ workspace, onOpenTerminal }: { workspace: string; onOpenTerminal: () => void }) {
  const { sidebar } = usePanels()
  const [isRepo, setIsRepo] = useState<boolean | null>(null)
  const [changes, setChanges] = useState<Change[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [log, setLog] = useState<Commit[]>([])
  const [branches, setBranches] = useState<{ current: string | null; branches: string[] }>({ current: null, branches: [] })
  const [message, setMessage] = useState('')
  const [sel, setSel] = useState<Selection>(null)
  const [patch, setPatch] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const known = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    const info = await api.git.info().catch(() => null)
    setIsRepo(!!info?.isRepo)
    if (!info?.isRepo) return
    const [c, l, b] = await Promise.all([api.git.changes(), api.git.log(150), api.git.branches()])
    setChanges(c.changes)
    setLog(l)
    setBranches(b)
    // 새로 나타난 변경 파일은 기본으로 커밋 대상에 넣는다
    setChecked((prev) => {
      const next = new Set([...prev].filter((p) => c.changes.some((x: Change) => x.path === p)))
      for (const x of c.changes as Change[]) if (!known.current.has(x.path)) next.add(x.path)
      known.current = new Set(c.changes.map((x: Change) => x.path))
      return next
    })
  }, [])

  useEffect(() => {
    load()
    let timer: ReturnType<typeof setTimeout> | null = null
    const later = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 500)
    }
    const offs = [api.workspace.onTreeChanged(later), api.workspace.onFileChanged(later)]
    window.addEventListener('focus', later)
    return () => {
      offs.forEach((o) => o())
      window.removeEventListener('focus', later)
      if (timer) clearTimeout(timer)
    }
  }, [load, workspace])

  useEffect(() => {
    setPatch(null)
    if (!sel) return
    const p = sel.kind === 'file' ? api.git.diff(sel.path) : api.git.show(sel.hash)
    p.then(setPatch).catch((e: unknown) => setPatch(errMsg(e)))
  }, [sel, changes])

  const commit = async (): Promise<void> => {
    const files = changes.filter((c) => checked.has(c.path)).map((c) => c.path)
    setBusy(true)
    try {
      await api.git.commit(files, message)
      setMessage('')
      setSel(null)
      toast(t.git.committed)
      await load()
    } catch (e) {
      toast(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const allChecked = changes.length > 0 && changes.every((c) => checked.has(c.path))
  const count = useMemo(() => changes.filter((c) => checked.has(c.path)).length, [changes, checked])

  if (isRepo === false) {
    return (
      <div className="mode-body">
        <div className="empty-state">
          <Icon name="gitTree" size={40} />
          <h2>{t.git.notRepo}</h2>
          <div>{t.git.notRepoHint}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={onOpenTerminal}>
            <Icon name="terminal" size={14} /> {t.git.openTerminal}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mode-body">
      <div className="sidebar git-side" style={sidebar ? undefined : { display: 'none' }}>
        <div className="git-branch">
          <Icon name="gitTree" size={14} />
          <select
            value={branches.current ?? ''}
            title={t.git.branch}
            onChange={async (e) => {
              try {
                await api.git.switchBranch(e.target.value)
                toast(t.git.switched(e.target.value))
              } catch (err) {
                toast(errMsg(err))
              }
              load()
            }}
          >
            {branches.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button className="icon-btn" title={t.titlebar.refresh} onClick={load}>
            <Icon name="refresh" size={14} />
          </button>
        </div>

        <div className="sidebar-header">
          <span className="title">
            {t.git.changes} {changes.length || ''}
          </span>
          {changes.length > 0 && (
            <label className="git-all" title={t.git.selectAll}>
              <input
                type="checkbox"
                checked={allChecked}
                onChange={() => setChecked(allChecked ? new Set() : new Set(changes.map((c) => c.path)))}
              />
            </label>
          )}
        </div>
        <div className="git-changes">
          {changes.length === 0 && <div className="git-empty">{t.git.noChanges}</div>}
          {changes.map((c) => (
            <div
              key={c.path}
              className={`git-row${sel?.kind === 'file' && sel.path === c.path ? ' active' : ''}`}
              onClick={() => setSel({ kind: 'file', path: c.path })}
              title={c.path}
            >
              <input
                type="checkbox"
                checked={checked.has(c.path)}
                onClick={(e) => e.stopPropagation()}
                onChange={() =>
                  setChecked((s) => {
                    const n = new Set(s)
                    if (n.has(c.path)) n.delete(c.path)
                    else n.add(c.path)
                    return n
                  })
                }
              />
              <span className="gname">{c.path.split('/').pop()}</span>
              <span className="gdir">{c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : ''}</span>
              <button
                className="icon-btn gdiscard"
                title={t.git.discard}
                onClick={async (e) => {
                  e.stopPropagation()
                  try {
                    if (await api.git.discard(c.path)) load()
                  } catch (err) {
                    toast(errMsg(err))
                  }
                }}
              >
                <Icon name="undo" size={13} />
              </button>
              <span className={`gstat s-${c.status === '?' ? 'N' : c.status}`} title={t.git.statuses[c.status] ?? c.status}>
                {c.status === '?' ? 'N' : c.status}
              </span>
            </div>
          ))}
        </div>
        {changes.length > 0 && (
          <div className="git-commit">
            <textarea
              rows={3}
              value={message}
              placeholder={t.git.commitPlaceholder}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  commit()
                }
              }}
            />
            <button className="btn primary" disabled={busy || !count || !message.trim()} onClick={commit}>
              {t.git.commit(count)}
            </button>
          </div>
        )}

        <div className="sidebar-header">
          <span className="title">{t.git.history}</span>
        </div>
        <div className="git-log">
          {log.length === 0 && <div className="git-empty">{t.git.noHistory}</div>}
          {log.map((c) => (
            <div
              key={c.hash}
              className={`git-commit-row${sel?.kind === 'commit' && sel.hash === c.hash ? ' active' : ''}`}
              onClick={() => setSel({ kind: 'commit', hash: c.hash })}
              title={`${c.short} · ${c.author}`}
            >
              <span className={`gnode${c.parents > 1 ? ' merge' : ''}`} />
              <div className="gmsg">
                <div className="gsubject">
                  {c.refs &&
                    c.refs
                      .split(', ')
                      .filter(Boolean)
                      .map((r) => (
                        <span key={r} className="gref">
                          {r.replace('HEAD -> ', '')}
                        </span>
                      ))}
                  {c.subject}
                </div>
                <div className="gmeta">
                  {c.short} · {c.author} · {timeAgo(c.time)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="editor-area">
        {sel ? (
          <>
            <div className="git-view-head">
              <Icon name={sel.kind === 'file' ? 'file' : 'gitTree'} size={14} />
              <b>{sel.kind === 'file' ? sel.path : log.find((c) => c.hash === sel.hash)?.subject}</b>
              <span className="grow" />
              <button className="icon-btn" onClick={() => setSel(null)} title={t.common.close}>
                <Icon name="x" />
              </button>
            </div>
            <div className="editor-scroll">{patch === null ? <div className="empty-state">{t.common.loading}</div> : <PatchView patch={patch} />}</div>
          </>
        ) : (
          <div className="empty-state">
            <Icon name="gitTree" size={40} />
            <h2>{branches.current ?? ''}</h2>
            <div>{t.git.selectHint}</div>
            {!sidebar && (
              <button className="btn" style={{ marginTop: 10 }} onClick={() => panels.set({ sidebar: true })}>
                {t.titlebar.toggleSidebar(false)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
