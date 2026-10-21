import { promises as fs } from 'fs'
import path from 'path'
import { getProject } from './project'

/** 로컬 위키: 원본과 같이 프로젝트 안의 폴더(기본 nimbalyst-local/wiki, 프로젝트 설정에서 변경)에 마크다운 페이지를 모은다 */
export async function wikiDir(workspace: string): Promise<string> {
  return path.join(workspace, (await getProject(workspace)).wiki.dir)
}

export interface WikiPage {
  path: string
  /** 위키 폴더 기준 경로 (확장자 제외) */
  title: string
  updated: number
  size: number
}

export async function listPages(workspace: string): Promise<WikiPage[]> {
  const root = await wikiDir(workspace)
  const pages: WikiPage[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (/\.md$/i.test(e.name)) {
        const st = await fs.stat(p)
        pages.push({ path: p, title: path.relative(root, p).replace(/\.md$/i, ''), updated: st.mtimeMs, size: st.size })
      }
    }
  }
  await walk(root)
  return pages.sort((a, b) => a.title.localeCompare(b.title, 'ko'))
}

/** 위키 폴더가 없으면 홈 페이지와 함께 만든다 */
export async function ensureWiki(workspace: string, projectName: string): Promise<string> {
  const root = await wikiDir(workspace)
  await fs.mkdir(root, { recursive: true })
  const home = path.join(root, '홈.md')
  try {
    await fs.access(home)
  } catch {
    await fs.writeFile(
      home,
      `# ${projectName} 위키\n\n이 프로젝트에 대한 지식을 모아 두는 곳입니다. 왼쪽 목록에서 페이지를 만들거나, **AI로 위키 정리**를 눌러 에이전트에게 맡겨 보세요.\n`,
      'utf8'
    )
  }
  return root
}

export async function createPage(workspace: string, title: string): Promise<string> {
  const clean = title.trim().replace(/[\\:*?"<>|]/g, '').replace(/\.md$/i, '')
  if (!clean) throw new Error('페이지 이름을 입력하세요.')
  const root = await wikiDir(workspace)
  const p = path.join(root, clean + '.md')
  if (!p.startsWith(root)) throw new Error('잘못된 페이지 이름')
  await fs.mkdir(path.dirname(p), { recursive: true })
  try {
    await fs.access(p)
    throw new Error('같은 이름의 페이지가 이미 있습니다.')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  await fs.writeFile(p, `# ${path.basename(clean)}\n\n`, 'utf8')
  return p
}
