import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { agentStore } from '../lib/agentStore'
import type { Job, TrackerItem, TrackerPriority, TrackerStatus, TrackerType } from '../lib/types'
import { t, timeAgo } from '../i18n/ko'
import { Icon, Modal, toast } from '../components/ui'
import { JobsPanel } from '../components/JobsPanel'
import { useFeature, useProject } from '../lib/project'

const STATUSES: TrackerStatus[] = ['todo', 'in-progress', 'review', 'done']
const TYPES = Object.keys(t.tracker.types) as TrackerType[]
const PRIORITIES = Object.keys(t.tracker.priorities) as TrackerPriority[]

type Draft = Partial<TrackerItem> & { title: string }

export function TrackerMode({ onOpenAgent }: { onOpenAgent: (sessionId: string) => void }) {
  const [items, setItems] = useState<TrackerItem[]>([])
  const [typeFilter, setTypeFilter] = useState<TrackerType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Draft | null>(null)
  const [dropCol, setDropCol] = useState<TrackerStatus | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showJobs, setShowJobs] = useState(false)
  const parallelOn = useFeature('parallel')
  const trackerCfg = useProject()?.tracker
  const statuses = trackerCfg?.showDone === false ? STATUSES.filter((s) => s !== 'done') : STATUSES

  useEffect(() => {
    api.jobs.list().then((list: Job[]) => {
      setJobs(list)
      if (list.some((j) => ['queued', 'starting', 'running', 'review', 'conflict'].includes(j.status))) setShowJobs(true)
    })
    return api.jobs.onUpdated((job: Job) =>
      setJobs((list) => (list.some((j) => j.id === job.id) ? list.map((j) => (j.id === job.id ? job : j)) : [job, ...list]))
    )
  }, [])

  // 끝난 작업 지우기 후에는 목록을 다시 읽는다
  const reloadJobs = useCallback(() => api.jobs.list().then(setJobs), [])

  /** 항목마다 가장 최근의 작업 (보드 카드에 상태를 표시) */
  const jobByItem = useMemo(() => {
    const m = new Map<string, Job>()
    for (const j of jobs) if (!m.has(j.itemId) && j.status !== 'discarded') m.set(j.itemId, j)
    return m
  }, [jobs])
  const activeJobs = jobs.filter((j) => ['queued', 'starting', 'running'].includes(j.status)).length

  const toggleSelect = (id: string): void =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const runParallel = async (ids: string[]): Promise<void> => {
    if (!ids.length) return
    try {
      const pf = await api.jobs.preflight()
      if (!pf.isRepo || !pf.hasCommits) return toast(t.jobs.notRepo)
      if (pf.dirty > 0 && !confirm(t.jobs.dirtyConfirm(pf.dirty))) return
      const r = await api.jobs.start(ids)
      if (r.started.length) toast(t.jobs.started(r.started.length) + (r.skipped.length ? ' ' + t.jobs.skipped(r.skipped.length) : ''))
      else if (r.skipped.length) toast(t.jobs.skipped(r.skipped.length))
      setSelected(new Set())
      setShowJobs(true)
      setEditing(null)
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }

  const load = useCallback(() => api.tracker.list().then(setItems), [])
  useEffect(() => {
    load()
    const offTree = api.workspace.onTreeChanged(load)
    const offFile = api.workspace.onFileChanged((p: string) => p.includes('/.nimbalyst/trackers/') && load())
    return () => (offTree(), offFile())
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(
      (i) =>
        (typeFilter === 'all' || i.type === typeFilter) &&
        (!q || i.title.toLowerCase().includes(q) || i.tags.some((tag) => tag.toLowerCase().includes(q)))
    )
  }, [items, typeFilter, query])

  const save = async (draft: Draft): Promise<void> => {
    if (!draft.title.trim()) return toast('제목을 입력하세요.')
    await api.tracker.save(draft)
    setEditing(null)
    load()
  }

  const move = async (id: string, status: TrackerStatus): Promise<void> => {
    const item = items.find((i) => i.id === id)
    if (!item || item.status === status) return
    setItems((list) => list.map((i) => (i.id === id ? { ...i, status } : i)))
    await api.tracker.save({ ...item, status })
    load()
  }

  const sendToAgent = async (item: Draft): Promise<void> => {
    const s = await agentStore.create(item.title)
    const prompt =
      `다음 트래커 항목을 처리해 주세요.\n\n` +
      `- 유형: ${t.tracker.types[item.type ?? 'task']}\n- 제목: ${item.title}\n` +
      (item.id ? `- 파일: .nimbalyst/trackers/${item.id}.md\n` : '') +
      `\n${item.body ?? ''}\n\n작업을 마치면 해당 트래커 파일의 status 를 review 로 바꿔 주세요.`
    agentStore.send(s.id, prompt)
    if (item.id) await api.tracker.save({ ...item, status: 'in-progress' })
    setEditing(null)
    onOpenAgent(s.id)
  }

  return (
    <div className="tracker">
      <div className="tracker-toolbar">
        <div className="filter">
          <button className={typeFilter === 'all' ? 'on' : ''} onClick={() => setTypeFilter('all')}>
            {t.tracker.all} {items.length}
          </button>
          {TYPES.map((ty) => (
            <button key={ty} className={typeFilter === ty ? 'on' : ''} onClick={() => setTypeFilter(ty)}>
              {t.tracker.types[ty]} {items.filter((i) => i.type === ty).length || ''}
            </button>
          ))}
        </div>
        <span className="grow" />
        {parallelOn && selected.size > 0 && (
          <>
            <button className="btn" onClick={() => setSelected(new Set())}>
              {t.jobs.clearSelection}
            </button>
            <button className="btn primary" onClick={() => runParallel([...selected])}>
              <Icon name="agent" size={14} /> {t.jobs.run(selected.size)}
            </button>
          </>
        )}
        {parallelOn && (
        <button className={`btn${showJobs ? ' primary' : ''}`} onClick={() => setShowJobs((v) => !v)} title={t.jobs.title}>
          {activeJobs > 0 && <span className="spinner" />} {t.jobs.title} {jobs.filter((j) => !['merged', 'discarded'].includes(j.status)).length || ''}
        </button>
        )}
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.tracker.search} style={{ width: 200 }} />
        <button
          className="btn primary"
          onClick={() => setEditing({ title: '', type: typeFilter === 'all' ? (trackerCfg?.defaultType ?? 'task') : typeFilter, status: 'todo', priority: 'medium', tags: [], body: '' })}
        >
          <Icon name="plus" size={14} /> {t.tracker.newItem}
        </button>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div className={`board${selected.size ? ' selecting' : ''}`}>
        {statuses.map((status) => {
          const col = filtered.filter((i) => i.status === status)
          return (
            <div
              key={status}
              className={`column${dropCol === status ? ' drop' : ''}`}
              onDragOver={(e) => (e.preventDefault(), setDropCol(status))}
              onDragLeave={() => setDropCol(null)}
              onDrop={(e) => {
                setDropCol(null)
                move(e.dataTransfer.getData('text/x-tracker'), status)
              }}
            >
              <div className="column-head">
                {t.tracker.statuses[status]} <span className="count">{col.length}</span>
              </div>
              <div className="column-body">
                {col.length === 0 && <div className="column-empty">{t.tracker.emptyColumn}</div>}
                {col.map((item) => {
                  const job = jobByItem.get(item.id)
                  return (
                  <div
                    key={item.id}
                    className={`card${selected.has(item.id) ? ' selected' : ''}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/x-tracker', item.id)}
                    onClick={(e) => (parallelOn && (e.metaKey || e.ctrlKey || selected.size) ? toggleSelect(item.id) : setEditing(item))}
                  >
                    {parallelOn && <input
                      type="checkbox"
                      className="sel-box"
                      title={t.jobs.select}
                      checked={selected.has(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(item.id)}
                    />}
                    <div className="ctitle">{item.title}</div>
                    <div className="cmeta">
                      {job && job.status !== 'merged' && (
                        <span className="pill job" title={job.worktree?.branch}>
                          {['queued', 'starting', 'running'].includes(job.status) && <span className="spinner" />}
                          {t.jobs.statuses[job.status]}
                        </span>
                      )}
                      <span className={`pill type-${item.type}`}>{t.tracker.types[item.type]}</span>
                      {item.priority !== 'medium' && <span className={`pill prio-${item.priority}`}>{t.tracker.priorities[item.priority]}</span>}
                      {item.tags.map((tag) => (
                        <span key={tag} className="pill">
                          #{tag}
                        </span>
                      ))}
                      <span className="pill" style={{ background: 'none' }}>
                        {item.updated && timeAgo(Date.parse(item.updated))}
                      </span>
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {parallelOn && showJobs && (
        <JobsPanel
          jobs={jobs}
          onOpenSession={onOpenAgent}
          onClose={() => setShowJobs(false)}
          onCleared={reloadJobs}
        />
      )}
      </div>
      {editing && (
        <ItemEditor
          draft={editing}
          onClose={() => setEditing(null)}
          onSave={save}
          onSendToAgent={sendToAgent}
          onRunParallel={parallelOn && editing.id ? () => runParallel([editing.id!]) : undefined}
          onDelete={async () => {
            if (editing.id && confirm(t.tracker.deleteConfirm)) {
              await api.tracker.delete(editing.id)
              setEditing(null)
              load()
            }
          }}
        />
      )}
    </div>
  )
}

function ItemEditor({
  draft: initial,
  onClose,
  onSave,
  onDelete,
  onSendToAgent,
  onRunParallel
}: {
  draft: Draft
  onClose: () => void
  onSave: (d: Draft) => void
  onDelete: () => void
  onSendToAgent: (d: Draft) => void
  onRunParallel?: () => void
}) {
  const [d, setD] = useState<Draft>(initial)
  const [tags, setTags] = useState((initial.tags ?? []).join(', '))
  const value = (): Draft => ({ ...d, tags: tags.split(',').map((x) => x.trim()).filter(Boolean) })
  return (
    <Modal
      title={initial.id ? initial.title : t.tracker.newItem}
      onClose={onClose}
      wide
      footer={
        <>
          {initial.id && (
            <button className="btn danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
              <Icon name="trash" size={14} /> {t.tracker.delete}
            </button>
          )}
          {onRunParallel && (
            <button className="btn" onClick={onRunParallel} title={t.settings.parallelHint}>
              <Icon name="agent" size={14} /> {t.jobs.runOne}
            </button>
          )}
          <button className="btn" onClick={() => onSendToAgent(value())} disabled={!d.title.trim()}>
            <Icon name="agent" size={14} /> {t.tracker.sendToAgent}
          </button>
          <button className="btn" onClick={onClose}>
            {t.tracker.cancel}
          </button>
          <button className="btn primary" onClick={() => onSave(value())}>
            {t.tracker.save}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <div className="field">
          <label>{t.tracker.fields.title}</label>
          <input autoFocus value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>{t.tracker.fields.type}</label>
            <select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value as TrackerType })}>
              {TYPES.map((x) => (
                <option key={x} value={x}>
                  {t.tracker.types[x]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t.tracker.fields.status}</label>
            <select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as TrackerStatus })}>
              {STATUSES.map((x) => (
                <option key={x} value={x}>
                  {t.tracker.statuses[x]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t.tracker.fields.priority}</label>
            <select value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as TrackerPriority })}>
              {PRIORITIES.map((x) => (
                <option key={x} value={x}>
                  {t.tracker.priorities[x]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>{t.tracker.fields.tags}</label>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        <div className="field">
          <label>{t.tracker.fields.body}</label>
          <textarea rows={10} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} style={{ resize: 'vertical', lineHeight: 1.6 }} />
        </div>
      </div>
    </Modal>
  )
}
