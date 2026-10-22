import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, basename, isInside, isMarkdown } from '../lib/api'
import { bus } from '../lib/bus'
import { panels, setActiveDoc, usePanels } from '../lib/panels'
import { agentStore, useAgentStore } from '../lib/agentStore'
import type { Settings, TreeNode } from '../lib/types'
import { t } from '../i18n/ko'
import { FileTree, NewFileDialog } from '../components/FileTree'
import { MarkdownEditor } from '../components/markdown/MarkdownEditor'
import { CodeEditor } from '../components/CodeEditor'
import { SpreadsheetEditor, isSpreadsheet } from '../components/SpreadsheetEditor'
import { isExcalidraw, isPptx } from '../lib/api'
import { HtmlPreview, isHtml } from '../components/HtmlPreview'
import { PdfViewer, isPdf } from '../components/PdfViewer'
import { MediaPlayer, isMedia } from '../components/MediaPlayer'
import { ImageViewer, isImage } from '../components/ImageViewer'
import { LegacyPptViewer, isLegacyPpt } from '../components/LegacyPptViewer'
import { SqlDiagram } from '../components/sql/SqlDiagram'

const isSql = (p: string): boolean => /\.sql$/i.test(p)
import { DiffView, computeDiff } from '../components/DiffView'
import { HistoryPanel } from '../components/HistoryPanel'
import { TerminalPanel } from '../components/TerminalPanel'
import { ContextMenu, Icon, MenuEntry, toast } from '../components/ui'

interface Doc {
  path: string
  content: string
  saved: string
  /** 편집기를 다시 만들어야 할 때 올린다 (디스크에서 다시 읽음, 복원 등) */
  version: number
  externalChange: boolean
}

// 그림 편집기는 크기가 커서 .excalidraw 파일을 처음 열 때 불러온다
const ExcalidrawEditor = lazy(() => import('../components/ExcalidrawEditor'))
const PptxEditor = lazy(() => import('../components/pptx/PptxEditor'))
const HwpEditor = lazy(() => import('../components/HwpEditor'))
const isHwp = (p: string): boolean => /\.hwpx?$/i.test(p)
/** 편집기가 직접 읽고 저장하는 이진 문서 (pptx·hwp) */
const isBinaryDoc = (p: string): boolean => isPptx(p) || isHwp(p)

const BINARY = /\.(ppt|pps|pot|png|jpe?g|jfif|pjpeg|avif|gif|webp|bmp|ico|pdf|zip|gz|tar|mp3|m4a|aac|wav|flac|ogg|oga|opus|mp4|m4v|mov|webm|ogv|woff2?|ttf|otf|dmg|exe|dylib|so|sqlite|db)$/i

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

export function FilesMode({ workspace, settings }: { workspace: string; settings: Settings }) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [closed, setClosed] = useState<string[]>([])
  const [historySel, setHistorySel] = useState<string | null>(null)
  const [historyText, setHistoryText] = useState<string | null>(null)
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const { history: showHistory, terminal: showTerminal, sidebar: showSidebar } = usePanels()
  const setShowHistory = (v: boolean): void => panels.set({ history: v })
  const [sourceMode, setSourceMode] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [newFile, setNewFile] = useState(false)
  const [reviewBefore, setReviewBefore] = useState<string | null>(null)

  const docsRef = useRef(docs)
  docsRef.current = docs
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const lastAutoSnapshot = useRef<Record<string, number>>({})
  /** 우리가 방금 쓴 내용. 감시자가 이 변경을 외부 변경으로 착각하지 않게 한다 */
  const ownWrites = useRef<Record<string, string>>({})
  /** pptx 처럼 편집기가 직접 저장하는 이진 파일: 저장 함수와 마지막으로 쓴 시각 */
  const binarySavers = useRef<Record<string, () => Promise<void>>>({})
  const binaryWrittenAt = useRef<Record<string, number>>({})

  const aiEdits = useAgentStore((s) => s.aiEdits)
  const doc = docs.find((d) => d.path === active) ?? null
  const aiEdit = active ? aiEdits[active] : undefined

  const loadTree = useCallback(() => api.workspace.tree().then(setTree), [])
  useEffect(() => {
    loadTree()
    return api.workspace.onTreeChanged(loadTree)
  }, [loadTree])

  // 열린 탭을 작업공간별로 기억했다가 다시 연다
  const tabsKey = `tabs:${workspace}`
  const restored = useRef(false)
  useEffect(() => {
    if (!restored.current) return
    try {
      localStorage.setItem(tabsKey, JSON.stringify({ paths: [...new Set(docs.map((d) => d.path))], active }))
    } catch {
      /* 저장소를 쓸 수 없으면 무시 */
    }
  }, [docs, active, tabsKey])

  const updateDoc = (path: string, patch: Partial<Doc> | ((d: Doc) => Partial<Doc>)): void =>
    setDocs((ds) => ds.map((d) => (d.path === path ? { ...d, ...(typeof patch === 'function' ? patch(d) : patch) } : d)))

  const open = useCallback(async (path: string) => {
    setActive(path)
    setHistorySel(null)
    if (docsRef.current.some((d) => d.path === path)) return
    if (BINARY.test(path) || isBinaryDoc(path)) {
      // 빠르게 두 번 열어도 탭이 하나만 생기게 (상태가 아직 반영되기 전일 수 있다)
      setDocs((ds) => (ds.some((d) => d.path === path) ? ds : [...ds, { path, content: '', saved: '', version: 0, externalChange: false }]))
      return
    }
    try {
      const content: string = await api.fs.read(path)
      setDocs((ds) => (ds.some((d) => d.path === path) ? ds : [...ds, { path, content, saved: content, version: 0, externalChange: false }]))
    } catch (e) {
      toast(errMsg(e))
    }
  }, [])

  const restoring = useRef(false)
  useEffect(() => {
    // 개발 모드(StrictMode)에서 효과가 두 번 돌아도 한 번만 되살린다
    if (restoring.current) return
    restoring.current = true
    let saved: { paths: string[]; active: string | null } | null = null
    try {
      saved = JSON.parse(localStorage.getItem(tabsKey) ?? 'null')
    } catch {
      saved = null
    }
    ;(async () => {
      // 예전 버전이 같은 파일을 여러 번 저장해 두었을 수 있어 중복을 걸러 낸다
      for (const p of new Set(saved?.paths ?? [])) await open(p)
      if (saved?.active) setActive(saved.active)
      restored.current = true
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const write = useCallback(async (path: string, content: string, snapshot?: 'manual' | 'auto' | 'restore') => {
    ownWrites.current[path] = content
    await api.fs.write(path, content, snapshot)
    updateDoc(path, { saved: content })
    if (snapshot) setHistoryRefresh((n) => n + 1)
  }, [])

  const save = useCallback(
    async (path: string | null = active) => {
      const d = docsRef.current.find((x) => x.path === path)
      if (!d || BINARY.test(d.path)) return
      if (isBinaryDoc(d.path)) return binarySavers.current[d.path]?.()
      clearTimeout(saveTimers.current[d.path])
      try {
        await write(d.path, d.content, 'manual')
        lastAutoSnapshot.current[d.path] = Date.now()
      } catch (e) {
        toast(errMsg(e))
      }
    },
    [active, write]
  )

  const onEdit = (path: string, content: string): void => {
    updateDoc(path, { content })
    if (!settings.autosave) return
    clearTimeout(saveTimers.current[path])
    saveTimers.current[path] = setTimeout(() => {
      const due = Date.now() - (lastAutoSnapshot.current[path] ?? 0) > settings.historyIntervalSec * 1000
      if (due) lastAutoSnapshot.current[path] = Date.now()
      write(path, content, due ? 'auto' : undefined).catch((e) => toast(errMsg(e)))
    }, 800)
  }

  /** 여러 탭을 한 번에 닫는다 (고친 내용이 있는 탭은 저장한 뒤) */
  const closeMany = (paths: string[]): void => {
    const drop = new Set(paths)
    for (const d of docsRef.current) if (drop.has(d.path) && d.content !== d.saved) save(d.path)
    setDocs((ds) => {
      const next = ds.filter((x) => !drop.has(x.path))
      if (active && drop.has(active)) setActive(next[next.length - 1]?.path ?? null)
      return next
    })
    setClosed((c) => [...paths, ...c.filter((x) => !drop.has(x))].slice(0, 20))
  }
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const tabMenuItems = (path: string): (MenuEntry | 'sep')[] => {
    const all = docs.map((d) => d.path)
    const idx = all.indexOf(path)
    const items: (MenuEntry | 'sep')[] = [
      { label: '닫기', onClick: () => close(path) },
      { label: '다른 탭 모두 닫기', onClick: () => closeMany(all.filter((p) => p !== path)) },
      { label: '오른쪽 탭 모두 닫기', onClick: () => closeMany(all.slice(idx + 1)) },
      { label: '저장된 탭 모두 닫기', onClick: () => closeMany(docs.filter((d) => d.content === d.saved).map((d) => d.path)) },
      { label: '모두 닫기', onClick: () => closeMany(all), danger: true },
      'sep',
      { label: '경로 복사', onClick: () => void navigator.clipboard.writeText(path).then(() => toast('경로를 복사했습니다.')) },
      { label: t.files.reveal ?? 'Finder에서 보기', onClick: () => void api.fs.reveal(path) }
    ]
    return items
  }

  const close = (path: string): void => {
    const d = docsRef.current.find((x) => x.path === path)
    if (d && d.content !== d.saved) save(path)
    setDocs((ds) => {
      const idx = ds.findIndex((x) => x.path === path)
      const next = ds.filter((x) => x.path !== path)
      if (active === path) setActive(next[Math.min(idx, next.length - 1)]?.path ?? null)
      return next
    })
    setClosed((c) => [path, ...c.filter((x) => x !== path)].slice(0, 20))
  }

  // 디스크 변경 감지: AI 편집이면 검토 화면으로, 아니면 다시 불러온다
  useEffect(
    () =>
      api.workspace.onFileChanged(async (path: string) => {
        const d = docsRef.current.find((x) => x.path === path)
        if (!d) return
        // 이미지·PDF 같은 이진 파일은 글자로 비교하지 않고 다시 불러오기만 한다
        if (BINARY.test(path)) return updateDoc(path, (x) => ({ version: x.version + 1 }))
        if (isBinaryDoc(path)) {
          // 우리가 막 저장한 것이 아니고 고치던 내용도 없으면 다시 불러온다
          if (Date.now() - (binaryWrittenAt.current[path] ?? 0) < 3000) return
          if (d.content === d.saved) updateDoc(path, (x) => ({ version: x.version + 1 }))
          else updateDoc(path, { externalChange: true })
          return
        }
        const disk: string = await api.fs.read(path).catch(() => null)
        if (disk === null || disk === d.content || disk === ownWrites.current[path]) return
        if (agentStore.get().aiEdits[path]) {
          updateDoc(path, (x) => ({ content: disk, saved: disk, version: x.version + 1 }))
        } else if (d.content === d.saved) {
          updateDoc(path, (x) => ({ content: disk, saved: disk, version: x.version + 1 }))
        } else {
          updateDoc(path, { externalChange: true })
        }
        setHistoryRefresh((n) => n + 1)
      }),
    []
  )

  // AI 편집 검토: 편집 직전 스냅샷을 읽어 둔다
  useEffect(() => {
    setReviewBefore(null)
    if (!aiEdit || !active) return
    if (!aiEdit.beforeSnapshotId) return setReviewBefore('')
    api.history.read(active, aiEdit.beforeSnapshotId).then(setReviewBefore).catch(() => setReviewBefore(''))
  }, [aiEdit, active])

  // AI 가 수정한 파일이 아직 열려 있지 않으면 자동으로 열어 검토하게 한다
  useEffect(() => {
    for (const p of Object.keys(aiEdits)) {
      if (p.startsWith(workspace) && !docsRef.current.some((d) => d.path === p)) open(p)
    }
  }, [aiEdits, workspace, open])

  // 허가를 거부해 실제로 바뀐 것이 없으면 검토 상태를 자동으로 닫는다
  const aiRunning = useAgentStore((s) => (aiEdit ? !!s.running[aiEdit.sessionId] : false))
  useEffect(() => {
    if (active && aiEdit && !aiRunning && reviewBefore !== null && doc && reviewBefore === doc.content) {
      agentStore.clearAiEdit(active)
    }
  }, [active, aiEdit, aiRunning, reviewBefore, doc])

  const acceptReview = async (): Promise<void> => {
    if (!active) return
    const disk: string = await api.fs.read(active)
    await api.history.save(active, disk, 'ai-after')
    updateDoc(active, (x) => ({ content: disk, saved: disk, version: x.version + 1 }))
    agentStore.clearAiEdit(active)
    setHistoryRefresh((n) => n + 1)
  }

  const rejectReview = async (): Promise<void> => {
    if (!active || reviewBefore === null) return
    await write(active, reviewBefore, 'restore')
    updateDoc(active, (x) => ({ content: reviewBefore, saved: reviewBefore, version: x.version + 1 }))
    agentStore.clearAiEdit(active)
  }

  // 이력 항목 선택 시 내용을 읽어 비교 화면에 쓴다
  useEffect(() => {
    setHistoryText(null)
    if (active && historySel) api.history.read(active, historySel).then(setHistoryText)
  }, [active, historySel])

  const restoreSnapshot = async (id: string): Promise<void> => {
    if (!active) return
    const text: string = await api.history.read(active, id)
    await write(active, text, 'restore')
    updateDoc(active, (x) => ({ content: text, saved: text, version: x.version + 1 }))
    setHistorySel(null)
    toast('복원했습니다.')
  }

  // AI 영역(창 오른쪽 열)이 현재 문서를 첨부할 수 있게 알려 준다
  useEffect(() => {
    setActiveDoc(active)
    return () => setActiveDoc(null)
  }, [active])

  useEffect(
    () =>
      bus.on((cmd, arg) => {
        switch (cmd) {
          case 'save':
            return void save()
          case 'close-tab':
            return void (active && close(active))
          case 'reopen-tab':
            if (closed[0]) {
              open(closed[0])
              setClosed((c) => c.slice(1))
            }
            return
          case 'new-file':
            return setNewFile(true)
          case 'toggle-ai':
            return panels.toggle('ai')
          case 'toggle-terminal':
            return panels.toggle('terminal')
          case 'toggle-history':
            return panels.toggle('history')
          case 'find':
            return setFindOpen(true)
          case 'refresh-tree':
            return void loadTree()
          case 'open-file':
            return void open(arg as string)
        }
      }),
    [active, closed, open, save, loadTree] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const reviewStats = useMemo(
    () => (aiEdit && reviewBefore !== null && doc ? computeDiff(reviewBefore, doc.content) : null),
    [aiEdit, reviewBefore, doc]
  )

  const saverRegistrars = useRef<Record<string, (save: (() => Promise<void>) | null) => void>>({})
  const registerBinarySaver = (p: string) =>
    (saverRegistrars.current[p] ??= (save) => {
      if (save) binarySavers.current[p] = save
      else delete binarySavers.current[p]
    })

  // HWP 편집기는 iframe 메시지 구독을 다시 하지 않도록 경로마다 같은 함수를 넘긴다
  const dirtyMarkers = useRef<Record<string, (dirty: boolean) => void>>({})
  const markBinaryDirty = (p: string) => (dirtyMarkers.current[p] ??= (dirty) => updateDoc(p, { content: dirty ? '*' : '' }))
  const markBinarySaved = useCallback((p: string) => void (binaryWrittenAt.current[p] = Date.now()), [])

  const renderBody = () => {
    if (!doc) {
      return (
        <div className="empty-state">
          <Icon name="md" size={40} />
          <h2>{t.files.empty}</h2>
          <div>{t.files.emptyHint}</div>
        </div>
      )
    }
    if (isImage(doc.path)) return <ImageViewer key={doc.path} path={doc.path} version={doc.version} />
    if (isPptx(doc.path)) {
      const p = doc.path
      return (
        <Suspense fallback={<div className="empty-state">{t.common.loading}</div>}>
          <PptxEditor
            key={`${p}#${doc.version}`}
            path={p}
            autosave={settings.autosave}
            onDirty={(dirty) => updateDoc(p, { content: dirty ? '*' : '' })}
            onSaved={() => (binaryWrittenAt.current[p] = Date.now())}
            registerSave={registerBinarySaver(p)}
          />
        </Suspense>
      )
    }
    if (isPdf(doc.path)) return <PdfViewer path={doc.path} version={doc.version} />
    if (isLegacyPpt(doc.path)) return <LegacyPptViewer key={doc.path} path={doc.path} version={doc.version} />
    if (isMedia(doc.path)) return <MediaPlayer path={doc.path} version={doc.version} />
    if (isHwp(doc.path)) {
      const p = doc.path
      return (
        <Suspense fallback={<div className="empty-state">{t.common.loading}</div>}>
          <HwpEditor
            key={`${p}#${doc.version}`}
            path={p}
            onDirty={markBinaryDirty(p)}
            onSaved={markBinarySaved}
            registerSave={registerBinarySaver(p)}
          />
        </Suspense>
      )
    }
    if (BINARY.test(doc.path)) {
      return <div className="empty-state">이 형식의 파일은 미리 볼 수 없습니다.</div>
    }
    if (aiEdit && reviewBefore !== null) {
      return (
        <div className="editor-scroll">
          <DiffView before={reviewBefore} after={doc.content} />
        </div>
      )
    }
    if (historySel) {
      return (
        <div className="editor-scroll">
          {historyText === null ? <div className="empty-state">{t.common.loading}</div> : <DiffView before={historyText} after={doc.content} />}
        </div>
      )
    }
    if (isMarkdown(doc.path) && !sourceMode) {
      return (
        <MarkdownEditor
          docKey={`${doc.path}#${doc.version}`}
          docPath={doc.path}
          initialMarkdown={doc.content}
          onChange={(md) => onEdit(doc.path, md)}
          findOpen={findOpen}
          onCloseFind={() => setFindOpen(false)}
        />
      )
    }
    if (isHtml(doc.path) && !sourceMode) {
      return <HtmlPreview path={doc.path} savedKey={doc.saved} appTheme={settings.theme} onViewSource={() => setSourceMode(true)} />
    }
    if (isSql(doc.path) && !sourceMode) {
      return <SqlDiagram content={doc.content} onViewSource={() => setSourceMode(true)} />
    }
    if (isExcalidraw(doc.path) && !sourceMode) {
      return (
        <Suspense fallback={<div className="empty-state">{t.common.loading}</div>}>
          <ExcalidrawEditor key={`${doc.path}#${doc.version}`} content={doc.content} theme={settings.theme} onChange={(v) => onEdit(doc.path, v)} />
        </Suspense>
      )
    }
    if (isSpreadsheet(doc.path) && !sourceMode) {
      return <SpreadsheetEditor key={`${doc.path}#${doc.version}`} path={doc.path} content={doc.content} onChange={(v) => onEdit(doc.path, v)} />
    }
    if (isMarkdown(doc.path)) {
      return (
        <textarea
          key={`${doc.path}#${doc.version}`}
          className="source-editor"
          defaultValue={doc.content}
          spellCheck={false}
          onChange={(e) => onEdit(doc.path, e.target.value)}
        />
      )
    }
    const code = <CodeEditor path={doc.path} value={doc.content} onChange={(v) => onEdit(doc.path, v)} theme={settings.theme} fontSize={settings.editorFontSize} />
    if (isHtml(doc.path) || isSql(doc.path)) {
      // HTML·SQL 코드 편집 중에는 오른쪽 아래 버튼으로 미리보기·관계도로 돌아간다
      return (
        <div className="floating-host">
          {code}
          <button className="btn floating-corner" onClick={() => setSourceMode(false)}>
            {isSql(doc.path) ? '관계도 보기' : '미리보기'}
          </button>
        </div>
      )
    }
    return code
  }

  return (
    <div className="mode-body">
      <div className="sidebar" style={showSidebar ? undefined : { display: 'none' }}>
        <FileTree
          root={workspace}
          nodes={tree}
          activePath={active}
          onOpen={open}
          onRenamed={(from, to) => {
            setDocs((ds) => ds.map((d) => (d.path === from ? { ...d, path: to } : isInside(d.path, from) ? { ...d, path: to + d.path.slice(from.length) } : d)))
            if (active === from) setActive(to)
          }}
          onDeleted={(p) => {
            setDocs((ds) => ds.filter((d) => d.path !== p && !isInside(d.path, p)))
            if (active && (active === p || isInside(active, p))) setActive(null)
          }}
        />
      </div>
      <div className="editor-area">
        {docs.length > 0 && (
          <div className="tabs">
            {docs.map((d) => (
              <div
                key={d.path}
                className={`tab${d.path === active ? ' active' : ''}`}
                onClick={() => {
                  setActive(d.path)
                  setHistorySel(null)
                }}
                onAuxClick={(e) => e.button === 1 && close(d.path)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setTabMenu({ x: e.clientX, y: e.clientY, path: d.path })
                }}
                title={d.path}
              >
                {aiEdits[d.path] && <span style={{ color: 'var(--accent)' }}>✦</span>}
                <span className="label">{basename(d.path)}</span>
                {d.content !== d.saved ? <span className="dot" title={t.files.unsaved} /> : null}
                <button className="x" onClick={(e) => (e.stopPropagation(), close(d.path))}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {doc && aiEdit && reviewBefore !== null && (
          <div className="review-bar">
            <span>✦</span>
            <span className="msg">{t.review.title}</span>
            {reviewStats && (
              <>
                <span className="stat-add">
                  {t.review.added} +{reviewStats.added}
                </span>
                <span className="stat-del">
                  {t.review.removed} −{reviewStats.removed}
                </span>
              </>
            )}
            <button className="btn primary small" onClick={acceptReview} disabled={aiRunning}>
              {t.review.accept}
            </button>
            <button className="btn small" onClick={rejectReview} disabled={aiRunning}>
              {t.review.reject}
            </button>
          </div>
        )}
        {doc?.externalChange && (
          <div className="review-bar">
            <span className="msg">{t.files.externalChange}</span>
            <button
              className="btn small primary"
              onClick={async () => {
                if (isBinaryDoc(doc.path)) return updateDoc(doc.path, (x) => ({ content: '', saved: '', version: x.version + 1, externalChange: false }))
                const disk: string = await api.fs.read(doc.path)
                updateDoc(doc.path, (x) => ({ content: disk, saved: disk, version: x.version + 1, externalChange: false }))
              }}
            >
              {t.files.reload}
            </button>
            <button className="btn small" onClick={() => (updateDoc(doc.path, { externalChange: false }), save(doc.path))}>
              {t.files.keepMine}
            </button>
          </div>
        )}
        {doc && !aiEdit && !BINARY.test(doc.path) && (
          <div className="doc-toolbar" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <span className="status">{doc.content === doc.saved ? t.files.saved : t.files.unsaved}</span>
            <span className="grow" />
            {(isMarkdown(doc.path) || isSpreadsheet(doc.path) || isExcalidraw(doc.path) || isHtml(doc.path) || isSql(doc.path)) && (
              <button
                className={`icon-btn${sourceMode ? ' active' : ''}`}
                title={sourceMode ? (isSpreadsheet(doc.path) ? '표로 보기' : isExcalidraw(doc.path) ? '그림으로 보기' : isHtml(doc.path) ? '미리보기' : isSql(doc.path) ? '관계도 보기' : t.editor.rich) : t.editor.source}
                onClick={() => setSourceMode((v) => !v)}
              >
                <Icon name="code" />
              </button>
            )}
          </div>
        )}
        <div className="editor-split">
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{renderBody()}</div>
          {showHistory && doc && !BINARY.test(doc.path) && !isBinaryDoc(doc.path) && (
            <HistoryPanel
              path={doc.path}
              refreshKey={historyRefresh}
              selected={historySel}
              onSelect={setHistorySel}
              onRestore={restoreSnapshot}
              onClose={() => (setShowHistory(false), setHistorySel(null))}
            />
          )}
        </div>
        {showTerminal && <TerminalPanel theme={settings.theme} onClose={() => panels.set({ terminal: false })} />}
      </div>
      {tabMenu && <ContextMenu x={tabMenu.x} y={tabMenu.y} items={tabMenuItems(tabMenu.path)} onClose={() => setTabMenu(null)} />}
      {newFile && <NewFileDialog root={workspace} onCreated={open} onClose={() => setNewFile(false)} />}
    </div>
  )
}
