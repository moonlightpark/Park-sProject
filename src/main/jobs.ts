import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import * as agent from './agent'
import * as tracker from './tracker'
import * as wt from './worktree'
import { getSettings } from './settings'

/**
 * 병렬 작업: 트래커 항목 하나마다 git worktree 하나와 에이전트 세션 하나를 만들어 동시에 돌린다.
 * 동시에 도는 수는 설정의 maxParallel 로 제한하고, 나머지는 대기열에서 기다린다.
 */

export type JobStatus =
  | 'queued' // 차례를 기다리는 중
  | 'starting' // worktree 를 만드는 중
  | 'running' // 에이전트가 일하는 중
  | 'review' // 끝났고 병합을 기다림
  | 'failed' // 에이전트가 실패함 (worktree 는 남아 있음)
  | 'conflict' // 병합 충돌
  | 'stopped' // 사용자가 멈췄거나 앱이 꺼져 중단됨
  | 'merged' // 기준 브랜치에 병합됨
  | 'discarded' // 버림

export interface Job {
  id: string
  workspace: string
  itemId: string
  title: string
  status: JobStatus
  sessionId?: string
  worktree?: wt.WorktreeInfo
  error?: string
  changedFiles?: number
  model?: string
  created: number
  updated: number
}

type Emit = (workspace: string, channel: string, payload: unknown) => void

const ACTIVE: JobStatus[] = ['queued', 'starting', 'running']
const jobsCache = new Map<string, Job[]>()
let emit: Emit = () => undefined

export function setEmitter(fn: Emit): void {
  emit = fn
}

function storeFile(workspace: string): string {
  const hash = crypto.createHash('sha1').update(path.resolve(workspace)).digest('hex').slice(0, 16)
  return path.join(app.getPath('userData'), 'jobs', hash + '.json')
}

export async function listJobs(workspace: string): Promise<Job[]> {
  const cached = jobsCache.get(workspace)
  if (cached) return cached
  let list: Job[] = []
  try {
    list = JSON.parse(await fs.readFile(storeFile(workspace), 'utf8'))
  } catch {
    list = []
  }
  // 앱이 꺼지는 바람에 끊긴 작업은 '중단됨' 으로 표시한다 (worktree 는 그대로 남아 있어 이어서 할 수 있다)
  for (const j of list) if (ACTIVE.includes(j.status)) Object.assign(j, { status: 'stopped', error: '앱이 종료되어 중단되었습니다.' })
  jobsCache.set(workspace, list)
  return list
}

const saveTimers = new Map<string, NodeJS.Timeout>()
function persist(workspace: string): void {
  clearTimeout(saveTimers.get(workspace))
  saveTimers.set(
    workspace,
    setTimeout(async () => {
      saveTimers.delete(workspace)
      await fs.mkdir(path.dirname(storeFile(workspace)), { recursive: true })
      await fs.writeFile(storeFile(workspace), JSON.stringify(jobsCache.get(workspace) ?? []), 'utf8')
    }, 200)
  )
}

function update(job: Job, patch: Partial<Job>): void {
  Object.assign(job, patch, { updated: Date.now() })
  persist(job.workspace)
  emit(job.workspace, 'jobs:updated', job)
}

async function find(workspace: string, jobId: string): Promise<Job> {
  const job = (await listJobs(workspace)).find((j) => j.id === jobId)
  if (!job) throw new Error('작업을 찾을 수 없습니다.')
  return job
}

export interface Preflight {
  isRepo: boolean
  hasCommits: boolean
  branch: string | null
  dirty: number
}

/** 병렬 작업을 시작하기 전에 저장소 상태를 확인한다 */
export async function preflight(workspace: string): Promise<Preflight> {
  if (!(await wt.isGitRepo(workspace))) return { isRepo: false, hasCommits: false, branch: null, dirty: 0 }
  const commits = await wt.hasCommits(workspace)
  return {
    isRepo: true,
    hasCommits: commits,
    branch: commits ? await wt.currentBranch(workspace).catch(() => null) : null,
    dirty: await wt.dirtyCount(workspace)
  }
}

export async function startJobs(
  workspace: string,
  itemIds: string[],
  opts: { model?: string } = {}
): Promise<{ started: string[]; skipped: { itemId: string; reason: string }[] }> {
  const pf = await preflight(workspace)
  if (!pf.isRepo) throw new Error('병렬 작업은 git 저장소에서만 쓸 수 있습니다. 터미널에서 git init 후 첫 커밋을 만드세요.')
  if (!pf.hasCommits) throw new Error('커밋이 하나도 없습니다. 첫 커밋을 만든 뒤 다시 시도하세요.')
  if (!pf.branch) throw new Error('브랜치를 체크아웃한 상태에서 시작하세요.')

  const list = await listJobs(workspace)
  const started: string[] = []
  const skipped: { itemId: string; reason: string }[] = []
  for (const itemId of itemIds) {
    const item = await tracker.getItem(workspace, itemId)
    if (!item) {
      skipped.push({ itemId, reason: '항목을 찾을 수 없음' })
      continue
    }
    // 같은 항목을 두 에이전트가 맡지 않게 막는다
    const open = list.find((j) => j.itemId === itemId && !['merged', 'discarded'].includes(j.status))
    if (open) {
      skipped.push({ itemId, reason: '이미 진행 중인 작업이 있음' })
      continue
    }
    const job: Job = {
      id: crypto.randomUUID(),
      workspace,
      itemId,
      title: item.title,
      status: 'queued',
      model: opts.model,
      created: Date.now(),
      updated: Date.now()
    }
    list.unshift(job)
    started.push(job.id)
    emit(workspace, 'jobs:updated', job)
  }
  persist(workspace)
  pump(workspace)
  return { started, skipped }
}

/** 빈 자리가 있으면 대기 중인 작업을 꺼내 시작한다 */
function pump(workspace: string): void {
  const list = jobsCache.get(workspace) ?? []
  const max = Math.max(1, getSettings().maxParallel)
  let active = list.filter((j) => j.status === 'starting' || j.status === 'running').length
  // 먼저 들어온 작업부터 (목록은 최신순이므로 뒤에서부터)
  for (const job of [...list].reverse()) {
    if (active >= max) break
    if (job.status !== 'queued') continue
    active++
    run(job).catch((e) => update(job, { status: 'failed', error: e instanceof Error ? e.message : String(e) }))
  }
}

function buildPrompt(item: tracker.TrackerItem, w: wt.WorktreeInfo): string {
  return [
    '당신은 트래커 항목 하나를 맡아 처리하는 병렬 작업 에이전트입니다.',
    `작업 폴더는 git worktree 입니다: ${w.path} (브랜치 ${w.branch}, 기준 ${w.baseBranch}).`,
    '다른 에이전트들이 같은 저장소의 다른 worktree 에서 동시에 일하고 있습니다. 반드시 이 작업 폴더 안의 파일만 수정하세요.',
    '.nimbalyst/ 폴더는 앱이 관리하므로 수정하지 마세요. 커밋은 앱이 자동으로 하므로 직접 하지 않아도 됩니다.',
    '작업을 마치면 무엇을 바꿨는지, 확인이 필요한 점은 무엇인지 한국어로 짧게 요약하세요.',
    '',
    `## 항목: ${item.title}`,
    `- ID: ${item.id}`,
    `- 유형: ${item.type} / 우선순위: ${item.priority}`,
    item.tags.length ? `- 태그: ${item.tags.join(', ')}` : '',
    '',
    item.body.trim() || '(본문 없음 — 제목을 보고 필요한 작업을 판단하세요)'
  ]
    .filter((l) => l !== null)
    .join('\n')
}

async function run(job: Job, followUp?: string): Promise<void> {
  const workspace = job.workspace
  const item = await tracker.getItem(workspace, job.itemId)
  if (!item) throw new Error('트래커 항목이 삭제되었습니다.')

  if (!job.worktree) {
    update(job, { status: 'starting', error: undefined })
    const key = `${job.itemId}-${job.id.slice(0, 4)}`
    const worktree = await wt.createWorktree(workspace, key)
    const session = await agent.createSession(workspace, `[병렬] ${item.title}`, { cwd: worktree.path, trackerId: item.id })
    update(job, { worktree, sessionId: session.id })
    await tracker.updateItem(workspace, item.id, { status: 'in-progress', assignee: session.id, branch: worktree.branch })
  }
  update(job, { status: 'running', error: undefined })

  const emitAgent = (e: agent.AgentEvent): void => emit(workspace, 'agent:event', e)
  const outcome = await agent.sendMessage(
    workspace,
    job.sessionId!,
    followUp ?? buildPrompt(item, job.worktree!),
    emitAgent,
    { model: job.model, permissionMode: getSettings().parallelPermissionMode }
  )

  // 사용자가 그 사이 버렸다면 더 할 일이 없다
  if (job.status === 'discarded') return
  let changedFiles = 0
  try {
    await wt.commitAll(job.worktree!.root, `${item.title} (${item.id})`)
    changedFiles = (await wt.diffSummary(job.worktree!)).files.length
  } catch (e) {
    outcome.ok = false
    outcome.error = `자동 커밋 실패: ${e instanceof Error ? e.message : e}`
  }
  if (outcome.ok) {
    update(job, { status: 'review', changedFiles })
    await tracker.updateItem(workspace, item.id, { status: 'review' })
  } else {
    update(job, { status: outcome.error === '중지됨' ? 'stopped' : 'failed', error: outcome.error, changedFiles })
  }
  pump(workspace)
}

export async function stopJob(workspace: string, jobId: string): Promise<void> {
  const job = await find(workspace, jobId)
  if (job.status === 'queued') {
    update(job, { status: 'stopped', error: '대기 중에 취소했습니다.' })
    return
  }
  if (job.sessionId) await agent.stopSession(job.sessionId)
}

/** 중단·실패한 작업을 같은 worktree 와 세션에서 이어서 한다 */
export async function resumeJob(workspace: string, jobId: string, message?: string): Promise<void> {
  const job = await find(workspace, jobId)
  if (ACTIVE.includes(job.status)) return
  if (!job.worktree) {
    update(job, { status: 'queued', error: undefined })
    pump(workspace)
    return
  }
  const text = message?.trim() || '이전 작업이 끝나지 않았습니다. 지금까지의 진행 상황을 확인하고 이어서 마무리해 주세요.'
  run(job, text).catch((e) => update(job, { status: 'failed', error: e instanceof Error ? e.message : String(e) }))
}

export async function jobDiff(workspace: string, jobId: string): Promise<wt.DiffSummary> {
  const job = await find(workspace, jobId)
  if (!job.worktree) return { files: [], patch: '', commits: 0 }
  return wt.diffSummary(job.worktree)
}

export async function mergeJob(workspace: string, jobId: string): Promise<{ ok: boolean; message?: string }> {
  const job = await find(workspace, jobId)
  if (!job.worktree || ACTIVE.includes(job.status)) return { ok: false, message: '지금은 병합할 수 없는 상태입니다.' }
  await wt.commitAll(job.worktree.root, `${job.title} (${job.itemId})`)
  const r = await wt.mergeIntoBase(workspace, job.worktree, `병렬 작업 병합: ${job.title} (${job.itemId})`)
  if (!r.ok) {
    update(job, { status: r.conflict ? 'conflict' : job.status, error: r.message })
    return { ok: false, message: r.message }
  }
  await wt.removeWorktree(workspace, job.worktree, true)
  update(job, { status: 'merged', error: undefined })
  await tracker.updateItem(workspace, job.itemId, { status: 'done', assignee: undefined, branch: undefined })
  return { ok: true }
}

export async function rebaseJob(workspace: string, jobId: string): Promise<{ ok: boolean; message?: string }> {
  const job = await find(workspace, jobId)
  if (!job.worktree) return { ok: false, message: 'worktree 가 없습니다.' }
  await wt.commitAll(job.worktree.root, `${job.title} (${job.itemId})`)
  const r = await wt.rebaseOntoBase(job.worktree)
  if (r.ok) update(job, { status: 'review', error: undefined })
  else update(job, { status: 'conflict', error: r.message })
  return r.ok ? { ok: true } : { ok: false, message: r.message }
}

export async function discardJob(workspace: string, jobId: string): Promise<void> {
  const job = await find(workspace, jobId)
  const wasActive = ACTIVE.includes(job.status)
  update(job, { status: 'discarded' })
  if (wasActive && job.sessionId) await agent.stopSession(job.sessionId)
  if (job.worktree) await wt.removeWorktree(workspace, job.worktree, true).catch(() => undefined)
  await tracker.updateItem(workspace, job.itemId, { status: 'todo', assignee: undefined, branch: undefined })
  pump(workspace)
}

/** 끝난(병합·버림) 작업 기록을 목록에서 지운다 */
export async function clearFinished(workspace: string): Promise<void> {
  const list = await listJobs(workspace)
  jobsCache.set(
    workspace,
    list.filter((j) => !['merged', 'discarded'].includes(j.status))
  )
  persist(workspace)
}
