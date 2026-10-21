import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import yaml from 'js-yaml'

/** 트래커 항목은 작업공간의 .nimbalyst/trackers/<id>.md 에 YAML 머리말과 본문으로 저장된다. */
export type TrackerType = 'task' | 'bug' | 'plan' | 'idea' | 'decision' | 'feature'
export type TrackerStatus = 'todo' | 'in-progress' | 'review' | 'done'
export type TrackerPriority = 'low' | 'medium' | 'high' | 'critical'

export interface TrackerItem {
  id: string
  title: string
  type: TrackerType
  status: TrackerStatus
  priority: TrackerPriority
  tags: string[]
  created: string
  updated: string
  body: string
  /** 병렬 작업으로 이 항목을 맡은 에이전트 세션 */
  assignee?: string
  /** 병렬 작업 브랜치 */
  branch?: string
}

const dirOf = (root: string): string => path.join(root, '.nimbalyst', 'trackers')

function parse(id: string, text: string): TrackerItem | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!m) return null
  const meta = (yaml.load(m[1]) ?? {}) as Partial<TrackerItem>
  return {
    id,
    title: String(meta.title ?? '제목 없음'),
    type: (meta.type ?? 'task') as TrackerType,
    status: (meta.status ?? 'todo') as TrackerStatus,
    priority: (meta.priority ?? 'medium') as TrackerPriority,
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    created: String(meta.created ?? ''),
    updated: String(meta.updated ?? ''),
    body: m[2].replace(/^\n/, ''),
    ...(meta.assignee ? { assignee: String(meta.assignee) } : {}),
    ...(meta.branch ? { branch: String(meta.branch) } : {})
  }
}

function serialize(item: TrackerItem): string {
  const { body, id: _id, ...rest } = item
  // 비어 있는 선택 필드는 파일에 남기지 않는다
  const meta = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== ''))
  return `---\n${yaml.dump(meta, { lineWidth: 1000 }).trimEnd()}\n---\n\n${body}`
}

export async function listItems(root: string): Promise<TrackerItem[]> {
  const dir = dirOf(root)
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const items: TrackerItem[] = []
  for (const n of names) {
    if (!n.endsWith('.md')) continue
    const item = parse(n.slice(0, -3), await fs.readFile(path.join(dir, n), 'utf8'))
    if (item) items.push(item)
  }
  return items.sort((a, b) => b.updated.localeCompare(a.updated))
}

export async function saveItem(root: string, input: Partial<TrackerItem> & { title: string }): Promise<TrackerItem> {
  const now = new Date().toISOString()
  const id = input.id && /^[a-z0-9-]+$/.test(input.id) ? input.id : `${input.type ?? 'task'}-${crypto.randomBytes(3).toString('hex')}`
  const item: TrackerItem = {
    id,
    title: input.title,
    type: input.type ?? 'task',
    status: input.status ?? 'todo',
    priority: input.priority ?? 'medium',
    tags: input.tags ?? [],
    created: input.created || now,
    updated: now,
    body: input.body ?? '',
    assignee: input.assignee,
    branch: input.branch
  }
  await fs.mkdir(dirOf(root), { recursive: true })
  await fs.writeFile(path.join(dirOf(root), id + '.md'), serialize(item), 'utf8')
  return item
}

export async function deleteItem(root: string, id: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('잘못된 항목 ID')
  await fs.rm(path.join(dirOf(root), id + '.md'), { force: true })
}

export async function getItem(root: string, id: string): Promise<TrackerItem | null> {
  if (!/^[a-z0-9-]+$/.test(id)) return null
  const text = await fs.readFile(path.join(dirOf(root), id + '.md'), 'utf8').catch(() => null)
  return text === null ? null : parse(id, text)
}

/** 여러 작업이 동시에 같은 항목을 고치지 않도록 항목별로 순서대로 처리한다 */
const locks = new Map<string, Promise<unknown>>()

export function updateItem(root: string, id: string, patch: Partial<TrackerItem>): Promise<TrackerItem | null> {
  const key = path.join(root, id)
  const run = (locks.get(key) ?? Promise.resolve()).then(async () => {
    const item = await getItem(root, id)
    if (!item) return null
    return saveItem(root, { ...item, ...patch, id })
  })
  locks.set(key, run.catch(() => undefined))
  return run
}
