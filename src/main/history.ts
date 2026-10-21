import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * 문서 이력: 파일별로 시점 스냅샷을 userData/history/<hash>/ 아래에 저장한다.
 * kind: manual(수동 저장), auto(자동), ai-before(AI 편집 전), ai-after(AI 편집 후), restore(복원)
 */
export type SnapshotKind = 'manual' | 'auto' | 'ai-before' | 'ai-after' | 'restore'

export interface Snapshot {
  id: string
  time: number
  kind: SnapshotKind
  size: number
}

function dirFor(filePath: string): string {
  const hash = crypto.createHash('sha1').update(path.resolve(filePath)).digest('hex').slice(0, 16)
  return path.join(app.getPath('userData'), 'history', hash)
}

export async function saveSnapshot(filePath: string, content: string, kind: SnapshotKind): Promise<Snapshot | null> {
  const dir = dirFor(filePath)
  await fs.mkdir(dir, { recursive: true })
  const list = await listSnapshots(filePath)
  // 직전 스냅샷과 내용이 같으면 저장하지 않는다
  if (list[0]) {
    const prev = await fs.readFile(path.join(dir, list[0].id + '.md'), 'utf8').catch(() => null)
    if (prev === content && kind !== 'ai-before') return null
  }
  const time = Date.now()
  const id = `${time}-${kind}`
  await fs.writeFile(path.join(dir, id + '.md'), content, 'utf8')
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ path: path.resolve(filePath) }), 'utf8')
  await prune(dir, 200)
  return { id, time, kind, size: Buffer.byteLength(content) }
}

export async function listSnapshots(filePath: string): Promise<Snapshot[]> {
  const dir = dirFor(filePath)
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const snaps: Snapshot[] = []
  for (const n of names) {
    const m = /^(\d+)-([a-z-]+)\.md$/.exec(n)
    if (!m) continue
    const st = await fs.stat(path.join(dir, n))
    snaps.push({ id: `${m[1]}-${m[2]}`, time: Number(m[1]), kind: m[2] as SnapshotKind, size: st.size })
  }
  return snaps.sort((a, b) => b.time - a.time)
}

export async function readSnapshot(filePath: string, id: string): Promise<string> {
  if (!/^\d+-[a-z-]+$/.test(id)) throw new Error('잘못된 스냅샷 ID')
  return fs.readFile(path.join(dirFor(filePath), id + '.md'), 'utf8')
}

async function prune(dir: string, keep: number): Promise<void> {
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.md')).sort()
  for (const n of names.slice(0, Math.max(0, names.length - keep))) await fs.rm(path.join(dir, n))
}
