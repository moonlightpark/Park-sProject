import { promises as fs, existsSync } from 'fs'
import path from 'path'
import { execFile } from 'child_process'

/**
 * 프로젝트별 설정. 작업공간의 .nimbalyst/project.json 에 저장해서 프로젝트와 함께 옮겨 다닌다.
 * 비어 있는 값은 애플리케이션 설정을 그대로 따른다는 뜻이다.
 */
export interface ProjectFeatures {
  git: boolean
  tracker: boolean
  wiki: boolean
  parallel: boolean
  aiPanel: boolean
  terminal: boolean
  mermaid: boolean
}

export interface ProjectSettings {
  features: ProjectFeatures
  agent: {
    /** 비우면 애플리케이션 기본 모델 */
    model: string
    /** 비우면 애플리케이션 기본 권한 모드 */
    permissionMode: '' | 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
    /** 이 프로젝트의 모든 에이전트 대화에 덧붙일 지시사항 */
    instructions: string
  }
  wiki: {
    /** 작업공간 기준 상대 경로 */
    dir: string
  }
  tracker: {
    /** 새 항목의 기본 유형 */
    defaultType: 'task' | 'bug' | 'plan' | 'idea' | 'decision' | 'feature'
    /** 보드에 '완료' 열을 보일지 */
    showDone: boolean
  }
}

export const DEFAULT_PROJECT: ProjectSettings = {
  features: { git: true, tracker: true, wiki: true, parallel: true, aiPanel: true, terminal: true, mermaid: true },
  agent: { model: '', permissionMode: '', instructions: '' },
  wiki: { dir: 'nimbalyst-local/wiki' },
  tracker: { defaultType: 'task', showDone: true }
}

const fileOf = (workspace: string): string => path.join(workspace, '.nimbalyst', 'project.json')
const cache = new Map<string, ProjectSettings>()

function merge(raw: Partial<ProjectSettings>): ProjectSettings {
  return {
    features: { ...DEFAULT_PROJECT.features, ...(raw.features ?? {}) },
    agent: { ...DEFAULT_PROJECT.agent, ...(raw.agent ?? {}) },
    wiki: { ...DEFAULT_PROJECT.wiki, ...(raw.wiki ?? {}) },
    tracker: { ...DEFAULT_PROJECT.tracker, ...(raw.tracker ?? {}) }
  }
}

export async function getProject(workspace: string): Promise<ProjectSettings> {
  const hit = cache.get(workspace)
  if (hit) return hit
  let raw: Partial<ProjectSettings> = {}
  try {
    raw = JSON.parse(await fs.readFile(fileOf(workspace), 'utf8'))
  } catch {
    raw = {}
  }
  const s = merge(raw)
  cache.set(workspace, s)
  return s
}

/** 깊은 단계까지 합쳐서 저장한다. 위키 폴더는 작업공간 밖을 가리키지 못하게 막는다 */
export async function updateProject(workspace: string, patch: Partial<ProjectSettings>): Promise<ProjectSettings> {
  const cur = await getProject(workspace)
  const next = merge({
    features: { ...cur.features, ...(patch.features ?? {}) },
    agent: { ...cur.agent, ...(patch.agent ?? {}) },
    wiki: { ...cur.wiki, ...(patch.wiki ?? {}) },
    tracker: { ...cur.tracker, ...(patch.tracker ?? {}) }
  })
  const dir = path.posix.normalize(next.wiki.dir.trim().replace(/\\/g, '/')).replace(/^\/+|\/+$/g, '')
  if (!dir || dir.startsWith('..') || path.isAbsolute(next.wiki.dir)) throw new Error('Wiki 폴더는 프로젝트 안의 상대 경로여야 합니다.')
  next.wiki.dir = dir
  await fs.mkdir(path.dirname(fileOf(workspace)), { recursive: true })
  await fs.writeFile(fileOf(workspace), JSON.stringify(next, null, 2) + '\n', 'utf8')
  cache.set(workspace, next)
  return next
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('git', args, { cwd }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)))
  )
}

/** 빠른 설정: git 저장소로 만들고 첫 커밋까지 한다 */
export async function gitInit(workspace: string): Promise<void> {
  if (existsSync(path.join(workspace, '.git'))) throw new Error('이미 git 저장소입니다.')
  await git(workspace, ['init', '-q', '-b', 'main'])
  const ignore = path.join(workspace, '.gitignore')
  if (!existsSync(ignore)) await fs.writeFile(ignore, 'node_modules/\n.DS_Store\n', 'utf8')
  await git(workspace, ['add', '-A'])
  await git(workspace, ['commit', '-q', '-m', '초기 커밋']).catch((e: Error) => {
    if (/user\.(name|email)|identity/i.test(e.message)) {
      throw new Error('git 사용자 이름·이메일이 설정되지 않았습니다. 터미널에서 git config --global user.name / user.email 을 먼저 설정하세요.')
    }
    throw e
  })
}

/** 빠른 설정: 에이전트용 지침 파일 CLAUDE.md 를 만든다 (이미 있으면 그대로 둔다) */
export async function ensureClaudeMd(workspace: string): Promise<string> {
  const p = path.join(workspace, 'CLAUDE.md')
  if (!existsSync(p)) {
    await fs.writeFile(
      p,
      `# ${path.basename(workspace)}\n\nClaude Code 에이전트가 이 프로젝트에서 일할 때 읽는 지침입니다.\n\n## 프로젝트 개요\n\n- \n\n## 작업 규칙\n\n- 답변과 문서는 한국어로 작성합니다.\n- \n\n## 자주 쓰는 명령\n\n\`\`\`bash\n\n\`\`\`\n`,
      'utf8'
    )
  }
  return p
}

/** 빠른 설정: .gitignore 에 로컬 전용 폴더(nimbalyst-local)를 넣는다 */
export async function ignoreLocalFolder(workspace: string): Promise<boolean> {
  const p = path.join(workspace, '.gitignore')
  const cur = existsSync(p) ? await fs.readFile(p, 'utf8') : ''
  if (/^\/?nimbalyst-local\/?$/m.test(cur)) return false
  await fs.writeFile(p, (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + 'nimbalyst-local/\n', 'utf8')
  return true
}

/** 프로젝트 MCP 설정 파일(.mcp.json)이 없으면 빈 틀로 만든다 */
export async function ensureMcpFile(workspace: string): Promise<string> {
  const p = path.join(workspace, '.mcp.json')
  if (!existsSync(p)) await fs.writeFile(p, JSON.stringify({ mcpServers: {} }, null, 2) + '\n', 'utf8')
  return p
}

/** origin 원격 저장소. GitHub 이면 owner/repo 를 알려 준다 */
export async function remoteInfo(workspace: string): Promise<{ url: string | null; github: { owner: string; repo: string; web: string } | null }> {
  const url = (await git(workspace, ['remote', 'get-url', 'origin']).catch(() => '')).trim() || null
  const m = url ? /github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/.exec(url) : null
  return { url, github: m ? { owner: m[1], repo: m[2], web: `https://github.com/${m[1]}/${m[2]}` } : null }
}
