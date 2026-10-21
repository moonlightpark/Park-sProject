import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, basename } from '../lib/api'
import { agentStore } from '../lib/agentStore'
import { usePanels } from '../lib/panels'
import { useProject } from '../lib/project'
import { t, timeAgo } from '../i18n/ko'
import { MarkdownEditor } from '../components/markdown/MarkdownEditor'
import { Icon, InputDialog, toast } from '../components/ui'

interface Page {
  path: string
  title: string
  updated: number
  size: number
}

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

/** 로컬 위키 (nimbalyst-local/wiki). 페이지 목록·검색·편집과, 에이전트에게 위키 정리를 맡기는 기능 */
export function WikiMode({ workspace, onOpenAgent }: { workspace: string; onOpenAgent: (sessionId: string) => void }) {
  const { sidebar } = usePanels()
  const wikiRel = useProject()?.wiki.dir ?? 'nimbalyst-local/wiki'
  const wikiDirRef = useRef(wikiRel)
  wikiDirRef.current = wikiRel
  const [pages, setPages] = useState<Page[]>([])
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [doc, setDoc] = useState<{ content: string; version: number } | null>(null)
  const [creating, setCreating] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const lastWritten = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dir = useRef<string>('')
  const activeRef = useRef<string | null>(null)
  activeRef.current = active

  const load = useCallback(async () => {
    dir.current = await api.wiki.ensure()
    const list: Page[] = await api.wiki.list()
    setPages(list)
    setActive((a) => a ?? list.find((p) => p.title === '홈')?.path ?? list[0]?.path ?? null)
  }, [])

  useEffect(() => {
    setActive(null)
    load()
  }, [wikiRel, load])

  useEffect(() => {
    const offs = [
      api.workspace.onTreeChanged(load),
      api.workspace.onFileChanged(async (p: string) => {
        if (!p.includes(`/${wikiDirRef.current}/`)) return
        load()
        // 에이전트가 지금 열린 페이지를 고쳤으면 다시 불러온다
        if (p === activeRef.current) {
          const text: string = await api.fs.read(p).catch(() => null)
          if (text !== null && text !== lastWritten.current) setDoc((d) => ({ content: text, version: (d?.version ?? 0) + 1 }))
        }
      })
    ]
    return () => offs.forEach((o) => o())
  }, [load])

  useEffect(() => {
    setDoc(null)
    if (!active) return
    api.fs
      .read(active)
      .then((text: string) => setDoc({ content: text, version: 0 }))
      .catch((e: unknown) => toast(errMsg(e)))
  }, [active])

  const onEdit = (md: string): void => {
    if (!active) return
    const target = active
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      lastWritten.current = md
      api.fs.write(target, md).catch((e: unknown) => toast(errMsg(e)))
    }, 700)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pages.filter((p) => !q || p.title.toLowerCase().includes(q))
  }, [pages, query])

  const askAi = async (): Promise<void> => {
    const s = await agentStore.create('위키 정리')
    agentStore.send(s.id, t.wiki.aiPrompt(wikiRel))
    onOpenAgent(s.id)
  }

  const current = pages.find((p) => p.path === active)

  return (
    <div className="mode-body">
      <div className="sidebar" style={sidebar ? undefined : { display: 'none' }}>
        <div className="sidebar-header">
          <span className="title">
            {t.wiki.title} <span className="alpha-tag">{t.wiki.alpha}</span>
          </span>
          <button className="icon-btn" title={t.wiki.newPage} onClick={() => setCreating(true)}>
            <Icon name="filePlus" size={15} />
          </button>
        </div>
        <div style={{ padding: '0 8px 8px' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.wiki.search} style={{ width: '100%' }} />
        </div>
        <div className="sidebar-body">
          {filtered.length === 0 && <div className="git-empty">{t.wiki.empty}</div>}
          {filtered.map((p) => {
            const depth = p.title.split('/').length - 1
            return (
              <div
                key={p.path}
                className={`tree-row${p.path === active ? ' active' : ''}`}
                style={{ paddingLeft: 10 + depth * 14 }}
                onClick={() => setActive(p.path)}
                title={p.title}
              >
                <Icon name="md" size={14} />
                <span className="name">{basename(p.title)}</span>
              </div>
            )
          })}
        </div>
        <div style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={askAi}>
            <Icon name="sparkle" size={14} /> {t.wiki.ai}
          </button>
        </div>
      </div>
      <div className="editor-area">
        {doc && active ? (
          <>
            <div className="git-view-head">
              <Icon name="globe" size={14} />
              <b>{current?.title ?? basename(active)}</b>
              {current && <span className="usage-sub">{t.wiki.updated(timeAgo(current.updated))}</span>}
              <span className="grow" />
              <button className="icon-btn" title={t.editor.find} onClick={() => setFindOpen(true)}>
                <Icon name="search" size={14} />
              </button>
            </div>
            <MarkdownEditor
              docKey={`${active}#${doc.version}`}
              docPath={active}
              initialMarkdown={doc.content}
              onChange={onEdit}
              findOpen={findOpen}
              onCloseFind={() => setFindOpen(false)}
            />
          </>
        ) : (
          <div className="empty-state">
            <Icon name="globe" size={40} />
            <div>{t.wiki.selectHint}</div>
          </div>
        )}
      </div>
      {creating && (
        <InputDialog
          title={t.wiki.newPagePrompt}
          initial="새 페이지"
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            try {
              const p: string = await api.wiki.create(name)
              await load()
              setActive(p)
            } catch (e) {
              toast(errMsg(e))
            }
          }}
        />
      )}
    </div>
  )
}
