import { execFile } from 'child_process'
import { promises as fs, existsSync } from 'fs'
import path from 'path'

/**
 * 병렬 작업용 git worktree. 원본 Nimbalyst 와 같이 프로젝트 옆 `<이름>_worktrees/` 폴더에 만들고,
 * 브랜치는 `nimbalyst/<항목ID>` 를 쓴다.
 */

export class GitError extends Error {}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // 한글 파일명이 \354\203... 처럼 이스케이프되지 않게 한다
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LANG: 'C' } }, (err, stdout, stderr) => {
      if (err) reject(new GitError((stderr || stdout || err.message).trim()))
      else resolve(stdout)
    })
  })
}

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    return (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch {
    return false
  }
}

/** 작업공간이 저장소 최상위가 아니면 worktree 안의 같은 하위 폴더를 써야 한다 */
async function repoInfo(root: string): Promise<{ top: string; sub: string }> {
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim()
  return { top, sub: path.relative(top, root) }
}

export async function currentBranch(root: string): Promise<string> {
  const name = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (name === 'HEAD') throw new GitError('분리된 HEAD 상태에서는 병렬 작업을 시작할 수 없습니다. 브랜치를 체크아웃하세요.')
  return name
}

export async function hasCommits(root: string): Promise<boolean> {
  try {
    await git(root, ['rev-parse', 'HEAD'])
    return true
  } catch {
    return false
  }
}

/** 커밋되지 않은 변경 파일 수 (worktree 에는 포함되지 않으므로 사용자에게 알려 준다) */
export async function dirtyCount(root: string): Promise<number> {
  const out = await git(root, ['status', '--porcelain'])
  return out.split('\n').filter((l) => l.trim() && !l.includes('.nimbalyst/')).length
}

export interface WorktreeInfo {
  /** 에이전트가 일할 폴더 (작업공간이 하위 폴더면 worktree 안의 같은 하위 폴더) */
  path: string
  /** worktree 최상위 */
  root: string
  branch: string
  baseBranch: string
  baseCommit: string
}

export async function createWorktree(workspace: string, key: string): Promise<WorktreeInfo> {
  const { top, sub } = await repoInfo(workspace)
  const baseBranch = await currentBranch(workspace)
  const baseCommit = (await git(top, ['rev-parse', 'HEAD'])).trim()
  const dir = path.join(path.dirname(top), `${path.basename(top)}_worktrees`, key)
  const branch = `nimbalyst/${key}`
  if (existsSync(dir)) throw new GitError(`이미 같은 worktree 폴더가 있습니다: ${dir}`)
  await fs.mkdir(path.dirname(dir), { recursive: true })
  await git(top, ['worktree', 'add', '-b', branch, dir, baseCommit])
  return { path: path.join(dir, sub), root: dir, branch, baseBranch, baseCommit }
}

/** 에이전트가 남긴 변경을 worktree 브랜치에 커밋한다. 바뀐 것이 없으면 false */
export async function commitAll(wtRoot: string, message: string): Promise<boolean> {
  await git(wtRoot, ['add', '-A'])
  const staged = (await git(wtRoot, ['diff', '--cached', '--name-only'])).trim()
  if (!staged) return false
  await git(wtRoot, ['-c', 'user.name=Nimbalyst Agent', '-c', 'user.email=agent@nimbalyst.local', 'commit', '-q', '--no-verify', '-m', message])
  return true
}

export interface DiffSummary {
  files: { path: string; added: number; removed: number }[]
  patch: string
  commits: number
}

/** 기준 커밋 이후 이 브랜치가 바꾼 내용 (커밋된 것 + 아직 커밋 안 된 것) */
export async function diffSummary(wt: WorktreeInfo): Promise<DiffSummary> {
  await git(wt.root, ['add', '-A', '--intent-to-add']).catch(() => undefined)
  const numstat = await git(wt.root, ['diff', '--numstat', wt.baseCommit])
  const patch = await git(wt.root, ['diff', wt.baseCommit])
  const commits = Number((await git(wt.root, ['rev-list', '--count', `${wt.baseCommit}..HEAD`])).trim()) || 0
  const files = numstat
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, r, ...p] = l.split('\t')
      return { path: p.join('\t'), added: Number(a) || 0, removed: Number(r) || 0 }
    })
  return { files, patch: patch.length > 400_000 ? patch.slice(0, 400_000) + '\n… (너무 길어 잘림)' : patch, commits }
}

export type MergeResult = { ok: true } | { ok: false; conflict: boolean; message: string }

/** 원래 작업공간의 기준 브랜치에 worktree 브랜치를 병합한다. 충돌하면 병합을 취소하고 알려 준다. */
export async function mergeIntoBase(workspace: string, wt: WorktreeInfo, message: string): Promise<MergeResult> {
  const { top } = await repoInfo(workspace)
  const branchNow = await currentBranch(top)
  if (branchNow !== wt.baseBranch) {
    return { ok: false, conflict: false, message: `작업공간이 '${branchNow}' 브랜치에 있습니다. '${wt.baseBranch}' 로 바꾼 뒤 병합하세요.` }
  }
  try {
    await git(top, ['-c', 'user.name=Nimbalyst Agent', '-c', 'user.email=agent@nimbalyst.local', 'merge', '--no-ff', '--no-edit', '-m', message, wt.branch])
    return { ok: true }
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e)
    const conflict = /CONFLICT|Automatic merge failed/i.test(text)
    if (conflict) await git(top, ['merge', '--abort']).catch(() => undefined)
    return {
      ok: false,
      conflict,
      message: conflict
        ? '병합 충돌이 났습니다. 병합을 취소했습니다. worktree 창을 열어 기준 브랜치를 반영(리베이스)한 뒤 다시 시도하세요.'
        : /would be overwritten/i.test(text)
          ? '작업공간에 커밋하지 않은 변경이 있어 병합할 수 없습니다. 먼저 커밋하거나 정리하세요.'
          : text
    }
  }
}

/** 기준 브랜치의 최신 내용을 worktree 브랜치에 반영한다 (충돌 해결용) */
export async function rebaseOntoBase(wt: WorktreeInfo): Promise<MergeResult> {
  try {
    await git(wt.root, ['rebase', wt.baseBranch])
    wt.baseCommit = (await git(wt.root, ['merge-base', 'HEAD', wt.baseBranch])).trim()
    return { ok: true }
  } catch (e) {
    await git(wt.root, ['rebase', '--abort']).catch(() => undefined)
    return { ok: false, conflict: true, message: '리베이스 중 충돌이 났습니다. 에이전트에게 충돌 해결을 맡기거나 직접 해결하세요.' }
  }
}

export async function removeWorktree(workspace: string, wt: WorktreeInfo, deleteBranch: boolean): Promise<void> {
  const { top } = await repoInfo(workspace)
  await git(top, ['worktree', 'remove', '--force', wt.root]).catch(async () => {
    await fs.rm(wt.root, { recursive: true, force: true })
    await git(top, ['worktree', 'prune'])
  })
  if (deleteBranch) await git(top, ['branch', '-D', wt.branch]).catch(() => undefined)
}

export interface GitInfo {
  isRepo: boolean
  branch: string | null
  /** 커밋하지 않은 변경 파일 수 */
  dirty: number
  ahead: number
  behind: number
  worktrees: { path: string; branch: string | null; current: boolean }[]
}

/** 상단 바의 git 트리 메뉴에 보여 줄 저장소 상태 */
export async function gitInfo(workspace: string): Promise<GitInfo> {
  if (!(await isGitRepo(workspace))) return { isRepo: false, branch: null, dirty: 0, ahead: 0, behind: 0, worktrees: [] }
  const { top } = await repoInfo(workspace)
  const branch = (await git(top, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim() || null
  const dirty = (await git(top, ['status', '--porcelain']).catch(() => '')).split('\n').filter((l) => l.trim()).length
  let ahead = 0
  let behind = 0
  try {
    const [a, b] = (await git(top, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).trim().split(/\s+/)
    ahead = Number(a) || 0
    behind = Number(b) || 0
  } catch {
    /* 업스트림이 없으면 0 */
  }
  const worktrees: GitInfo['worktrees'] = []
  let cur: { path: string; branch: string | null } | null = null
  for (const line of (await git(top, ['worktree', 'list', '--porcelain']).catch(() => '')).split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) worktrees.push({ ...cur, current: path.resolve(cur.path) === path.resolve(top) })
      cur = { path: line.slice(9), branch: null }
    } else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace('refs/heads/', '')
  }
  if (cur) worktrees.push({ ...cur, current: path.resolve(cur.path) === path.resolve(top) })
  return { isRepo: true, branch, dirty, ahead, behind, worktrees }
}

/* ---------- 깃트리 화면 ---------- */

export interface GitChange {
  /** 저장소 최상위 기준 경로 */
  path: string
  /** 'M' 수정, 'A' 추가, 'D' 삭제, 'R' 이름 바꿈, '?' 새 파일(추적 안 함), 'U' 충돌 */
  status: string
  staged: boolean
}

export async function gitChanges(workspace: string): Promise<{ root: string; changes: GitChange[] }> {
  const { top } = await repoInfo(workspace)
  const out = await git(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const parts = out.split('\0')
  const changes: GitChange[] = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry) continue
    const x = entry[0]
    const y = entry[1]
    const file = entry.slice(3)
    // 이름 바꿈은 다음 칸에 원래 이름이 온다
    if (x === 'R' || x === 'C') i++
    if (file.endsWith('/')) continue
    const status = x === '?' ? '?' : x === 'U' || y === 'U' ? 'U' : x !== ' ' ? x : y
    changes.push({ path: file, status, staged: x !== ' ' && x !== '?' })
  }
  return { root: top, changes }
}

export async function gitFileDiff(workspace: string, file: string): Promise<string> {
  const { top } = await repoInfo(workspace)
  const tracked = await git(top, ['ls-files', '--error-unmatch', '--', file]).then(
    () => true,
    () => false
  )
  if (!tracked) {
    // 새 파일은 전체를 추가된 줄로 보여 준다
    return git(top, ['diff', '--no-index', '--', '/dev/null', file]).catch((e: GitError) => e.message)
  }
  const hasHead = await hasCommits(top)
  return git(top, hasHead ? ['diff', 'HEAD', '--', file] : ['diff', '--cached', '--', file])
}

export interface GitCommit {
  hash: string
  short: string
  author: string
  /** 커밋 시각 (ms) */
  time: number
  subject: string
  refs: string
  parents: number
}

export async function gitLog(workspace: string, limit = 100): Promise<GitCommit[]> {
  const { top } = await repoInfo(workspace)
  if (!(await hasCommits(top))) return []
  const out = await git(top, ['log', `-n${limit}`, '--format=%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%D%x1f%P%x1e'])
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, short, author, at, subject, refs, parents] = r.split('\x1f')
      return { hash, short, author, time: Number(at) * 1000, subject, refs, parents: parents ? parents.split(' ').length : 0 }
    })
}

export async function gitShow(workspace: string, hash: string): Promise<string> {
  if (!/^[0-9a-f]{4,40}$/.test(hash)) throw new GitError('잘못된 커밋')
  const { top } = await repoInfo(workspace)
  const out = await git(top, ['show', '--stat', '--patch', '--date=format-local:%Y-%m-%d %H:%M', '--format=%H%n%an <%ae>%n%ad%n%n%B', hash])
  return out.length > 400_000 ? out.slice(0, 400_000) + '\n… (너무 길어 잘림)' : out
}

export async function gitCommit(workspace: string, files: string[], message: string): Promise<void> {
  if (!message.trim()) throw new GitError('커밋 메시지를 입력하세요.')
  if (!files.length) throw new GitError('커밋할 파일을 고르세요.')
  const { top } = await repoInfo(workspace)
  await git(top, ['add', '-A', '--', ...files])
  await git(top, ['commit', '-q', '-m', message, '--', ...files])
}

export async function gitBranches(workspace: string): Promise<{ current: string | null; branches: string[] }> {
  const { top } = await repoInfo(workspace)
  const out = await git(top, ['branch', '--format=%(refname:short)']).catch(() => '')
  const current = (await git(top, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim() || null
  return { current, branches: out.split('\n').map((b) => b.trim()).filter(Boolean) }
}

export async function gitSwitch(workspace: string, branch: string): Promise<void> {
  const { top } = await repoInfo(workspace)
  await git(top, ['switch', branch])
}

/** 파일의 변경을 버린다. 새 파일이면 지운다 */
export async function gitDiscard(workspace: string, file: string): Promise<void> {
  const { top } = await repoInfo(workspace)
  const tracked = await git(top, ['ls-files', '--error-unmatch', '--', file]).then(
    () => true,
    () => false
  )
  if (tracked) await git(top, ['restore', '--staged', '--worktree', '--source=HEAD', '--', file])
  else await fs.rm(path.join(top, file), { force: true })
}
