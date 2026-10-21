import { promises as fs } from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { watch, FSWatcher } from 'fs'

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

const IGNORED = new Set([
  'node_modules', '.git', '.DS_Store', 'dist', 'out', 'build', '.next', '.nuxt', '.cache', '.turbo', 'coverage',
  '.venv', 'venv', '__pycache__', 'target', 'Pods', 'DerivedData', '.gradle', '.idea'
])

export async function readTree(root: string, depth = 0): Promise<TreeNode[]> {
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: TreeNode[] = []
  for (const e of entries) {
    if (IGNORED.has(e.name)) continue
    // 숨김 파일과 폴더는 트리에 표시하지 않는다
    if (e.name.startsWith('.')) continue
    const p = path.join(root, e.name)
    if (e.isDirectory()) {
      nodes.push({ name: e.name, path: p, type: 'dir', children: depth < 8 ? await readTree(p, depth + 1) : [] })
    } else if (e.isFile()) {
      nodes.push({ name: e.name, path: p, type: 'file' })
    }
  }
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ko') : a.type === 'dir' ? -1 : 1))
  return nodes
}

export function assertInside(root: string, target: string): string {
  const resolved = path.resolve(target)
  const rel = path.relative(path.resolve(root), resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('작업공간 밖의 경로에는 접근할 수 없습니다.')
  return resolved
}

export async function readFile(p: string): Promise<string> {
  return fs.readFile(p, 'utf8')
}

export async function writeFile(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, content, 'utf8')
}

export async function createFile(p: string, content = ''): Promise<void> {
  try {
    await fs.access(p)
    throw new Error('같은 이름의 파일이 이미 있습니다.')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  await writeFile(p, content)
}

export async function createDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true })
}

export async function rename(from: string, to: string): Promise<void> {
  await fs.rename(from, to)
}

export async function remove(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true })
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

/** ripgrep 이 있으면 사용하고, 없으면 단순 탐색으로 대체한다. */
export async function search(root: string, query: string): Promise<SearchHit[]> {
  if (!query.trim()) return []
  const rg = await findRipgrep()
  if (rg) {
    return new Promise((resolve) => {
      const hits: SearchHit[] = []
      const child = spawn(rg, ['--json', '-i', '-F', '--max-count', '20', '-g', '!node_modules', query, root])
      let buf = ''
      child.stdout.on('data', (d) => {
        buf += d.toString()
        let idx
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx)
          buf = buf.slice(idx + 1)
          try {
            const msg = JSON.parse(line)
            if (msg.type === 'match' && hits.length < 500) {
              hits.push({
                path: msg.data.path.text,
                line: msg.data.line_number,
                text: String(msg.data.lines.text ?? '').trimEnd().slice(0, 300)
              })
            }
          } catch {
            /* 부분 줄 무시 */
          }
        }
      })
      child.on('close', () => resolve(hits))
      child.on('error', () => resolve(hits))
    })
  }
  const hits: SearchHit[] = []
  const q = query.toLowerCase()
  const walk = async (nodes: TreeNode[]): Promise<void> => {
    for (const n of nodes) {
      if (hits.length >= 500) return
      if (n.type === 'dir') await walk(n.children ?? [])
      else if (/\.(md|markdown|txt|ts|tsx|js|jsx|json|css|html|py|yaml|yml)$/i.test(n.name)) {
        const text = await fs.readFile(n.path, 'utf8').catch(() => '')
        text.split('\n').forEach((l, i) => {
          if (l.toLowerCase().includes(q)) hits.push({ path: n.path, line: i + 1, text: l.slice(0, 300) })
        })
      }
    }
  }
  await walk(await readTree(root))
  return hits
}

let rgPath: string | null | undefined
async function findRipgrep(): Promise<string | null> {
  if (rgPath !== undefined) return rgPath
  for (const c of ['/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg']) {
    try {
      await fs.access(c)
      return (rgPath = c)
    } catch {
      /* 다음 후보 */
    }
  }
  return (rgPath = null)
}

export async function listAllFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) n.type === 'dir' ? walk(n.children ?? []) : out.push(n.path)
  }
  walk(await readTree(root))
  return out
}

/**
 * 재귀 fs.watch 를 쓴다. macOS 와 Windows 에서는 OS 이벤트 하나로 전체 트리를 감시하므로
 * 큰 프로젝트에서도 파일 핸들이 모자라지 않는다. 창마다 하나씩 만들고, 돌려받은 함수로 멈춘다.
 */
export function watchWorkspace(
  root: string,
  onTreeChange: () => void,
  onFileChange: (p: string) => void
): () => void {
  let watcher: FSWatcher | null = null
  let treeTimer: NodeJS.Timeout | null = null
  const fileTimers = new Map<string, NodeJS.Timeout>()
  try {
    watcher = watch(root, { recursive: true }, (event, name) => {
      if (!name) return
      const rel = name.toString()
      const parts = rel.split(path.sep)
      // .nimbalyst(트래커) 는 감시하되 그 밖의 무거운 폴더는 무시한다
      if (parts.some((s) => IGNORED.has(s))) return
      const abs = path.join(root, rel)
      if (event === 'rename') {
        if (treeTimer) clearTimeout(treeTimer)
        treeTimer = setTimeout(onTreeChange, 200)
      }
      clearTimeout(fileTimers.get(abs))
      fileTimers.set(
        abs,
        setTimeout(() => {
          fileTimers.delete(abs)
          onFileChange(abs)
        }, 150)
      )
    })
    watcher.on('error', (e) => console.error('[watch]', e))
  } catch (e) {
    console.error('[watch] 감시를 시작하지 못했습니다', e)
  }
  return () => {
    watcher?.close()
    if (treeTimer) clearTimeout(treeTimer)
    fileTimers.forEach((t) => clearTimeout(t))
  }
}
