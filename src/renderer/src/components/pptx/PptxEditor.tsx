import { useCallback, useEffect, useRef, useState } from 'react'
import { init } from 'pptx-preview'
import { api } from '../../lib/api'
import { Icon, toast } from '../ui'
import { PptxDoc, type SlideInfo } from './pptxModel'

const errText = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

/**
 * .pptx 보기·편집. 가운데에 슬라이드를 차례로 그리고, 오른쪽 패널에서 고른 슬라이드의 글자를 고치거나
 * 슬라이드를 복제·삭제·이동한다. 고친 내용은 바로 다시 그려 보여 주고, 자동 저장이 켜져 있으면 곧 파일에 쓴다.
 */
export default function PptxEditor({
  path,
  autosave,
  onDirty,
  onSaved,
  registerSave
}: {
  path: string
  autosave: boolean
  onDirty: (dirty: boolean) => void
  /** 파일에 쓴 직후 (파일 감시가 이것을 바깥 변경으로 착각하지 않게) */
  onSaved: () => void
  /** ⌘S·탭 닫기 때 부를 저장 함수를 알려 준다 */
  registerSave: (save: (() => Promise<void>) | null) => void
}) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [index, setIndex] = useState(0)
  const [info, setInfo] = useState<SlideInfo | null>(null)
  /** 실행 취소 등으로 모델을 다시 읽으면 올려서 글자 칸을 새 내용으로 다시 만든다 */
  const [infoRev, setInfoRev] = useState(0)
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirtyState] = useState(false)
  const [canUndo, setCanUndo] = useState(false)

  const docRef = useRef<PptxDoc | null>(null)
  const bytesRef = useRef<Uint8Array | null>(null)
  const undoStack = useRef<Uint8Array[]>([])
  const dirtyRef = useRef(false)
  const pending = useRef(false)
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const viewRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  const setDirty = (v: boolean): void => {
    dirtyRef.current = v
    setDirtyState(v)
    onDirty(v)
  }

  const refreshInfo = (i: number): void => {
    const doc = docRef.current
    if (!doc) return
    const j = Math.max(0, Math.min(i, doc.order.length - 1))
    setIndex(j)
    setCount(doc.order.length)
    setInfo(doc.slideInfo(j))
    setInfoRev((n) => n + 1)
  }

  // 처음 열 때 파일을 읽는다
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await api.fs.readBinary(path)
        const doc = await PptxDoc.load(data)
        if (!alive) return
        docRef.current = doc
        bytesRef.current = data
        setBytes(data)
        refreshInfo(0)
      } catch (e) {
        if (alive) setError(errText(e))
      }
    })()
    return () => {
      alive = false
      clearTimeout(commitTimer.current)
    }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(commitTimer.current)
    if (pending.current) await commit()
    if (!dirtyRef.current || !bytesRef.current) return
    try {
      await api.fs.writeBinary(path, bytesRef.current)
      onSaved()
      setDirty(false)
    } catch (e) {
      toast(errText(e))
    }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    registerSave(save)
    return () => registerSave(null)
  }, [save, registerSave])

  /** 고친 모델을 새 pptx 로 만들어 화면에 반영한다 (실행 취소용으로 이전 상태를 쌓아 둔다) */
  const commit = async (): Promise<void> => {
    pending.current = false
    const doc = docRef.current
    if (!doc) return
    const next = await doc.toBytes()
    if (bytesRef.current) {
      undoStack.current.push(bytesRef.current)
      if (undoStack.current.length > 30) undoStack.current.shift()
      setCanUndo(true)
    }
    bytesRef.current = next
    setBytes(next)
    setDirty(true)
    if (autosave) {
      clearTimeout(commitTimer.current)
      commitTimer.current = setTimeout(() => void save(), 1200)
    }
  }

  const scheduleCommit = (): void => {
    pending.current = true
    setDirty(true)
    clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => void commit(), 700)
  }

  const run = async (op: (doc: PptxDoc) => Promise<void> | void, nextIndex: number): Promise<void> => {
    const doc = docRef.current
    if (!doc) return
    clearTimeout(commitTimer.current)
    try {
      await op(doc)
      await commit()
      refreshInfo(nextIndex)
    } catch (e) {
      toast(errText(e))
    }
  }

  const undo = async (): Promise<void> => {
    const prev = undoStack.current.pop()
    if (!prev) return
    clearTimeout(commitTimer.current)
    pending.current = false
    docRef.current = await PptxDoc.load(prev)
    bytesRef.current = prev
    setBytes(prev)
    setCanUndo(undoStack.current.length > 0)
    setDirty(true)
    refreshInfo(index)
    if (autosave) commitTimer.current = setTimeout(() => void save(), 1200)
  }

  // 화면 너비에 맞춰 슬라이드 크기를 정한다
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    // 스크롤 막대가 생기고 없어지는 정도의 작은 변화는 무시한다 (다시 그리기가 꼬리를 무는 깜빡임 방지)
    const measure = (): void => {
      const next = Math.min(1100, Math.max(320, el.clientWidth - 48))
      setWidth((prev) => (Math.abs(prev - next) < 24 ? prev : next))
    }
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(measure, 120)
    })
    measure()
    ro.observe(el)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [error])

  // 슬라이드를 그린다 (내용이나 너비가 바뀔 때마다 다시)
  useEffect(() => {
    const view = viewRef.current
    const doc = docRef.current
    if (!view || !bytes || !doc || !width) return
    let done = false
    let cancelled = false
    const height = Math.round((width * doc.size.cy) / doc.size.cx)
    // 새 슬라이드는 보이지 않는 곳에 그린 뒤 다 되면 바꿔 끼운다 (그리는 동안 화면이 비거나 크기가 출렁이지 않게)
    const stage = document.createElement('div')
    stage.className = 'pptx-stage'
    view.appendChild(stage)
    const previewer = init(stage, { width, height, mode: 'list' })
    previewer
      .preview(bytes.slice().buffer)
      .then(() => {
        if (cancelled) return
        const scroll = scrollRef.current?.scrollTop ?? 0
        for (const child of Array.from(view.children)) if (child !== stage) child.remove()
        stage.className = ''
        done = true
        if (scrollRef.current) scrollRef.current.scrollTop = scroll
        markSlides()
      })
      .catch((e: unknown) => !cancelled && setError(errText(e)))
    return () => {
      cancelled = true
      // 아직 그리던 것만 치운다. 이미 바꿔 끼운 화면은 다음 그림이 준비될 때까지 그대로 둔다
      if (!done) stage.remove()
    }
  }, [bytes, width]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 그려진 슬라이드 요소들 (미리보기 라이브러리가 만든 것) */
  const slideEls = (): HTMLElement[] => Array.from(viewRef.current?.querySelectorAll<HTMLElement>(':scope > div:not(.pptx-stage) .pptx-preview-slide-wrapper') ?? [])

  const markSlides = (): void => slideEls().forEach((el, i) => el.classList.toggle('pptx-selected', i === indexRef.current))
  const indexRef = useRef(index)
  indexRef.current = index
  useEffect(markSlides, [index]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectFromClick = (e: React.MouseEvent): void => {
    const hit = (e.target as HTMLElement).closest('.pptx-preview-slide-wrapper')
    const i = slideEls().indexOf(hit as HTMLElement)
    if (i >= 0) refreshInfo(i)
  }

  const goto = (i: number): void => {
    refreshInfo(i)
    slideEls()[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  if (error) {
    return (
      <div className="empty-state">
        <div>이 프레젠테이션을 열 수 없습니다.</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{error}</div>
        <button className="btn small" onClick={() => api.fs.openDefault(path)}>
          기본 앱에서 열기
        </button>
      </div>
    )
  }

  return (
    <div className="pptx-editor">
      <div className="pptx-main">
        <div className="pptx-bar">
          <button className="icon-btn" title="실행 취소" onClick={undo} disabled={!canUndo}>
            <Icon name="undo" />
          </button>
          <span className="sep" />
          <button className="btn small" onClick={() => goto(index - 1)} disabled={index <= 0}>
            ◀
          </button>
          <span className="pptx-page">{count ? `${index + 1} / ${count}` : '불러오는 중…'}</span>
          <button className="btn small" onClick={() => goto(index + 1)} disabled={index >= count - 1}>
            ▶
          </button>
          <span className="grow" />
          {!autosave && (
            <button className="btn small primary" onClick={() => void save()} disabled={!dirty}>
              저장
            </button>
          )}
          <button className="btn small" onClick={() => api.fs.openDefault(path).catch((e: unknown) => toast(errText(e)))} title="PowerPoint·Keynote 등 기본 앱에서 열기">
            기본 앱에서 열기
          </button>
        </div>
        <div className="pptx-scroll" ref={scrollRef} onClick={selectFromClick}>
          <div ref={viewRef} className="pptx-view" />
        </div>
      </div>

      <aside className="pptx-panel">
        <div className="pptx-panel-head">
          <strong>슬라이드 {count ? index + 1 : ''}</strong>
          <span className="grow" />
          <button className="icon-btn" title="앞으로 옮기기" onClick={() => run((d) => d.move(index, -1), index - 1)} disabled={index <= 0}>
            ↑
          </button>
          <button className="icon-btn" title="뒤로 옮기기" onClick={() => run((d) => d.move(index, 1), index + 1)} disabled={index >= count - 1}>
            ↓
          </button>
          <button className="icon-btn" title="복제" onClick={() => run((d) => d.duplicate(index), index + 1)}>
            <Icon name="clipboard" size={15} />
          </button>
          <button className="icon-btn" title="삭제" onClick={() => run((d) => d.remove(index), index)} disabled={count <= 1}>
            <Icon name="trash" size={15} />
          </button>
        </div>
        <div className="pptx-blocks">
          {info?.blocks.length === 0 && <div className="pptx-empty">이 슬라이드에는 고칠 수 있는 글자가 없습니다.</div>}
          {info?.blocks.map((b, i) => (
            <label key={`${infoRev}#${i}`} className="pptx-block">
              <span>{b.name}</span>
              <textarea
                defaultValue={b.text.replace(/\u000b/g, '↵')}
                rows={Math.min(8, Math.max(1, b.text.split('\n').length))}
                spellCheck={false}
                onChange={(e) => {
                  // 문단 안 줄바꿈(↵)은 원래의 줄바꿈 문자로 되돌린다
                  docRef.current?.setText(index, i, e.target.value.replace(/↵/g, '\u000b'))
                  scheduleCommit()
                }}
              />
            </label>
          ))}
        </div>
        <div className="pptx-hint">글자의 글꼴·색은 각 문단의 첫 글자 서식을 따릅니다. 줄마다 한 문단이 됩니다.</div>
      </aside>
    </div>
  )
}
