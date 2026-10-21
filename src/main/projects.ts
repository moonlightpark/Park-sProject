import { app } from 'electron'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import { getSettings } from './settings'
import { saveItem } from './tracker'

/** 시작 화면의 최근 프로젝트 한 줄 */
export interface ProjectEntry {
  path: string
  name: string
  exists: boolean
  /** 마크다운 파일 수. MD_LIMIT 를 넘으면 MD_LIMIT 로 멈추고 capped=true */
  mdCount: number
  mdCapped: boolean
  lastOpened: number | null
}

const MD_LIMIT = 20
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '.venv', 'venv', 'Pods', 'target'])

/** 큰 프로젝트에서도 빨리 끝나도록 MD_LIMIT 개를 넘으면 세기를 멈춘다 */
async function countMarkdown(root: string): Promise<{ count: number; capped: boolean }> {
  let count = 0
  const queue = [root]
  let visitedDirs = 0
  while (queue.length && count <= MD_LIMIT && visitedDirs < 2000) {
    const dir = queue.shift()!
    visitedDirs++
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue
      if (e.isDirectory()) queue.push(path.join(dir, e.name))
      else if (/\.(md|markdown)$/i.test(e.name) && ++count > MD_LIMIT) break
    }
  }
  return count > MD_LIMIT ? { count: MD_LIMIT, capped: true } : { count, capped: false }
}

export async function listProjects(): Promise<ProjectEntry[]> {
  const s = getSettings()
  return Promise.all(
    s.recentWorkspaces.map(async (p) => {
      const exists = existsSync(p)
      const md = exists ? await countMarkdown(p) : { count: 0, capped: false }
      return {
        path: p,
        name: path.basename(p),
        exists,
        mdCount: md.count,
        mdCapped: md.capped,
        lastOpened: s.recentOpened[p] ?? null
      }
    })
  )
}

export function tutorialPath(): string {
  return path.join(app.getPath('documents'), '박프로 튜토리얼')
}

const TUTORIAL: Record<string, string> = {
  '1. 시작하기.md': `# 박프로 튜토리얼에 오신 것을 환영합니다

이 폴더는 직접 만져 보며 배우는 연습용 프로젝트입니다. 마음껏 고치고 지워도 됩니다.

## 둘러보기

- [ ] 왼쪽 **탐색기**에서 다른 문서를 열어 보세요.
- [ ] 이 체크박스를 눌러 완료 표시를 해 보세요.
- [ ] ⌘P 로 파일 이름을 검색해 열어 보세요.
- [ ] ⌘2 로 **에이전트 모드**, ⌘3 으로 **트래커 모드**로 가 보세요.

## 다음 문서

1. \`2. 문서 편집.md\` — 서식, 표, 코드 블록
2. \`3. AI 에이전트.md\` — Claude 에게 일 맡기기
3. \`4. 트래커.md\` — 할 일과 병렬 작업
4. \`5. 다이어그램.md\` — Mermaid 다이어그램
`,
  '2. 문서 편집.md': `# 문서 편집

줄 맨 앞에서 마크다운 기호를 입력하면 바로 서식으로 바뀝니다.

| 입력 | 결과 |
| --- | --- |
| \`# \` | 제목 1 |
| \`## \` | 제목 2 |
| \`- \` | 글머리 목록 |
| \`1. \` | 번호 목록 |
| \`[ ] \` | 체크리스트 |
| \`> \` | 인용 |
| \`\`\`\`\`\` | 코드 블록 |

**굵게**(⌘B), *기울임*(⌘I), \`인라인 코드\`, [링크](https://example.com)(⌘K) 도 쓸 수 있습니다.

> 문서는 자동으로 저장되고, ⌘⇧H 로 **문서 이력**을 열면 예전 버전과 비교하거나 되돌릴 수 있습니다.

\`\`\`javascript
// 코드 블록은 문법 강조가 됩니다
function 인사(이름) {
  return \`안녕하세요, \${이름}님!\`
}
\`\`\`
`,
  '3. AI 에이전트.md': `# AI 에이전트

박프로는 이 컴퓨터에 설치된 **Claude Code** 로 에이전트를 실행합니다.

## AI 도우미 (⌘⇧A)

문서를 연 채로 오른쪽 패널에 요청해 보세요.

- "이 문서를 세 줄로 요약해 줘"
- "아래 목록에 항목 두 개를 더 추가해 줘"

AI 가 문서를 고치면 노란 막대가 나타나고, 바뀐 부분을 확인한 뒤 **수락** 하거나 **되돌리기** 할 수 있습니다.

## 실습용 목록

- 사과
- 바나나
`,
  '4. 트래커.md': `# 트래커

⌘3 으로 **트래커 모드**를 열면 작업·버그·기획·아이디어를 칸반 보드로 관리할 수 있습니다.

- 카드를 끌어 상태를 바꿉니다.
- 카드를 눌러 내용을 고치거나 **에이전트에게 맡기기** 를 누릅니다.

## 병렬 작업

git 저장소에서는 카드를 여러 개 선택하고 **병렬 실행** 을 누르면,
항목마다 별도의 git worktree 에서 에이전트가 동시에 일합니다.
끝나면 **변경 보기 → 병합** 으로 결과를 합칩니다.

이 튜토리얼 폴더에도 예시 카드가 들어 있습니다.
`,
  '5. 다이어그램.md': `# 다이어그램

\`mermaid\` 코드 블록을 쓰면 아래에 다이어그램이 그려집니다. 코드를 고치면 바로 바뀝니다.

\`\`\`mermaid
graph LR
  아이디어 --> 기획
  기획 --> 개발
  개발 --> 검토
  검토 -->|수정 필요| 개발
  검토 --> 배포
\`\`\`

\`\`\`mermaid
sequenceDiagram
  사용자->>에이전트: 작업 요청
  에이전트->>파일: 수정
  에이전트-->>사용자: 결과 요약
\`\`\`
`
}

/** 튜토리얼 폴더가 없으면 예제 문서와 트래커 카드를 만들어 둔다 */
export async function ensureTutorial(): Promise<string> {
  const dir = tutorialPath()
  if (existsSync(dir)) return dir
  await fs.mkdir(dir, { recursive: true })
  for (const [name, content] of Object.entries(TUTORIAL)) await fs.writeFile(path.join(dir, name), content, 'utf8')
  await saveItem(dir, { title: '튜토리얼 문서 모두 읽어 보기', type: 'task', status: 'in-progress', body: '1~5번 문서를 차례로 열어 보세요.' })
  await saveItem(dir, { title: 'AI 도우미로 문서 요약해 보기', type: 'idea', priority: 'low', body: '3번 문서를 열고 ⌘⇧A 로 요약을 요청해 보세요.' })
  await saveItem(dir, { title: '다이어그램에 "테스트" 단계 추가', type: 'feature', priority: 'high', body: '5번 문서의 첫 다이어그램에서 개발과 검토 사이에 테스트 단계를 넣어 보세요.' })
  return dir
}
