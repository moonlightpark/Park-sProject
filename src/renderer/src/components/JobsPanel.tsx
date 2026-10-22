import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { agentStore, useAgentStore } from '../lib/agentStore'
import type { DiffSummary, Job } from '../lib/types'
import { t, timeAgo, toolLabels } from '../i18n/ko'
import { Icon, Modal, toast } from './ui'
import { PatchView } from './DiffView'

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

const ACTIVE = ['queued', 'starting', 'running']

/** 트래커 화면 오른쪽의 병렬 작업 목록 */
export function JobsPanel({
  jobs,
  onOpenSession,
  onClose,
  onCleared
}: {
  jobs: Job[]
  onOpenSession: (sessionId: string) => void
  onClose: () => void
  onCleared: () => void
}) {
  const permissions = useAgentStore((s) => s.permissions)
  const [diffJob, setDiffJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (job: Job, fn: () => Promise<unknown>, okMsg?: string): Promise<void> => {
    setBusy(job.id)
    try {
      const r = (await fn()) as { ok?: boolean; message?: string } | undefined
      if (r && r.ok === false) toast(r.message ?? '실패했습니다.')
      else if (okMsg) toast(okMsg)
    } catch (e) {
      toast(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const finished = jobs.some((j) => j.status === 'merged' || j.status === 'discarded')

  return (
    <div className="side-panel jobs-panel">
      <div className="panel-head">
        <Icon name="agent" />
        <span className="grow">
          {t.jobs.title} {jobs.filter((j) => ACTIVE.includes(j.status)).length > 0 && <span className="spinner" style={{ display: 'inline-block', marginLeft: 6 }} />}
        </span>
        {finished && (
          <button className="btn small" onClick={() => api.jobs.clearFinished().then(onCleared)}>
            {t.jobs.clearFinished}
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title={t.common.close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="sidebar-body">
        {jobs.length === 0 && <div className="empty-state">{t.jobs.empty}</div>}
        {jobs.map((job) => {
          const perm = permissions.find((p) => p.sessionId === job.sessionId)
          const disabled = busy === job.id
          const btn = (label: string, onClick: () => void, cls = '') => (
            <button className={`btn small ${cls}`} disabled={disabled} onClick={onClick}>
              {label}
            </button>
          )
          return (
            <div key={job.id} className={`job-row status-${job.status}`}>
              <div className="job-title">
                {ACTIVE.includes(job.status) && <span className="spinner" />}
                <span>{job.title}</span>
              </div>
              <div className="job-meta">
                <span className={`job-status s-${job.status}`}>{t.jobs.statuses[job.status]}</span>
                {perm && <span className="job-status s-conflict">{t.jobs.waiting}</span>}
                {job.worktree && <code>{job.worktree.branch}</code>}
                {job.changedFiles !== undefined && job.changedFiles > 0 && <span>{t.jobs.files(job.changedFiles)}</span>}
                <span>{timeAgo(job.updated)}</span>
              </div>
              {job.error && <div className="job-error">{job.error}</div>}
              {perm && (
                <div className="job-perm">
                  <div>
                    <b>{toolLabels[perm.toolName] ?? perm.toolName}</b>{' '}
                    <code>{String((perm.input as any)?.command ?? (perm.input as any)?.file_path ?? '').slice(0, 120)}</code>
                  </div>
                  <div className="job-actions">
                    {btn(t.agent.allow.replace(/\s*\(.*\)$/, ''), () => agentStore.answer(perm.requestId, true), 'primary')}
                    {btn(t.agent.deny, () => agentStore.answer(perm.requestId, false))}
                  </div>
                </div>
              )}
              <div className="job-actions">
                {job.status === 'queued' && btn(t.jobs.actions.cancel, () => act(job, () => api.jobs.stop(job.id)))}
                {(job.status === 'running' || job.status === 'starting') &&
                  btn(t.jobs.actions.stop, () => act(job, () => api.jobs.stop(job.id)))}
                {job.status === 'review' && btn(t.jobs.actions.merge, () => act(job, () => api.jobs.merge(job.id), t.jobs.merged), 'primary')}
                {job.status === 'conflict' &&
                  btn(t.jobs.actions.rebase, () => act(job, () => api.jobs.rebase(job.id), t.jobs.rebased), 'primary')}
                {(job.status === 'failed' || job.status === 'stopped') &&
                  btn(t.jobs.actions.resume, () => act(job, () => api.jobs.resume(job.id)), 'primary')}
                {job.worktree && !['merged', 'discarded', 'queued'].includes(job.status) && btn(t.jobs.actions.diff, () => setDiffJob(job))}
                {job.sessionId && job.status !== 'discarded' && btn(t.jobs.actions.session, () => onOpenSession(job.sessionId!))}
                {job.worktree &&
                  !['merged', 'discarded'].includes(job.status) &&
                  btn(t.jobs.actions.openWindow, () => api.workspace.openInNewWindow(job.worktree!.path))}
                {!['merged', 'discarded'].includes(job.status) && btn(t.jobs.actions.discard, () => act(job, () => api.jobs.discard(job.id)), 'danger')}
              </div>
            </div>
          )
        })}
      </div>
      {diffJob && <JobDiffModal job={diffJob} onClose={() => setDiffJob(null)} />}
    </div>
  )
}

function JobDiffModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const [diff, setDiff] = useState<DiffSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.jobs.diff(job.id).then(setDiff).catch((e: unknown) => setError(errMsg(e)))
  }, [job.id])

  return (
    <Modal title={t.jobs.diffTitle(job.title)} onClose={onClose} wide>
      <div className="modal-body" style={{ padding: 0 }}>
        {error && <div className="msg-error" style={{ margin: 16 }}>{error}</div>}
        {!diff && !error && <div className="empty-state">{t.common.loading}</div>}
        {diff && diff.files.length === 0 && <div className="empty-state">{t.jobs.noDiff}</div>}
        {diff && diff.files.length > 0 && (
          <>
            <div className="diff-files">
              <div style={{ color: 'var(--text-faint)', marginBottom: 4 }}>
                {t.jobs.files(diff.files.length)} · {t.jobs.commits(diff.commits)}
              </div>
              {diff.files.map((f) => (
                <div key={f.path}>
                  <span className="stat-add">+{f.added}</span> <span className="stat-del">−{f.removed}</span> <code>{f.path}</code>
                </div>
              ))}
            </div>
            <PatchView patch={diff.patch} />
          </>
        )}
      </div>
    </Modal>
  )
}
