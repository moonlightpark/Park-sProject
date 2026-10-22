import { useEffect, useRef, useState } from 'react'
import { api, basename } from '../lib/api'
import { toast } from './ui'

interface HostMessage {
  source: 'bakpro-hwp'
  type: 'loaded' | 'dirty' | 'clean' | 'saved' | 'error'
  id?: number
  message?: string
  path?: string
  canSave?: boolean
}

/**
 * HWP/HWPX 보기·편집. HOP 과 같은 rhwp 편집기(rhwp-studio)를 앱 안의 로컬 서버로 띄운다.
 * 메뉴·도구 모음·표·서식 편집은 rhwp 편집기 그대로이고, 저장(⌘S·탭 닫기)은 앱이 요청해 HWP 로 내보내 쓴다.
 * HWPX 는 원본을 덮어쓰지 않고 같은 이름의 .hwp 로 저장한다 (HOP 과 같이 HWPX 저장은 아직 막아 둠).
 */
export default function HwpEditor({
  path,
  onDirty,
  onSaved,
  registerSave
}: {
  path: string
  onDirty: (dirty: boolean) => void
  onSaved: (savedPath: string) => void
  registerSave: (save: (() => Promise<void>) | null) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [server, setServer] = useState<{ origin: string; token: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const hwpx = /\.hwpx$/i.test(path)
  const pending = useRef(new Map<number, { resolve: () => void; reject: (e: Error) => void }>())
  const seq = useRef(0)

  useEffect(() => {
    api
      .hwpServer()
      .then(setServer)
      .catch((e: unknown) => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)))
  }, [])

  // 편집기 페이지가 보내는 상태를 받는다 (우리 서버에서 온 메시지만)
  useEffect(() => {
    if (!server) return
    const onMessage = (e: MessageEvent): void => {
      const m = e.data as HostMessage
      if (e.origin !== server.origin || e.source !== frame.current?.contentWindow || m?.source !== 'bakpro-hwp') return
      if (m.type === 'loaded') setLoaded(true)
      else if (m.type === 'dirty' || m.type === 'clean') {
        setDirty(m.type === 'dirty')
        onDirty(m.type === 'dirty')
      }
      else if (m.type === 'saved') {
        setDirty(false)
        onDirty(false)
        onSaved(m.path ?? path)
        if (m.path && m.path !== path) toast(`${basename(m.path)} 로 저장했습니다.`)
        if (m.id !== undefined) pending.current.get(m.id)?.resolve()
      } else if (m.type === 'error') {
        if (m.id !== undefined) pending.current.get(m.id)?.reject(new Error(m.message))
        else setError(m.message ?? '알 수 없는 오류')
      }
      if (m.id !== undefined) pending.current.delete(m.id)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [server, path, onDirty, onSaved])

  const save = async (): Promise<void> => {
    const win = frame.current?.contentWindow
    if (!win || !server || !loaded) return
    const id = ++seq.current
    const done = new Promise<void>((resolve, reject) => pending.current.set(id, { resolve, reject }))
    win.postMessage({ target: 'bakpro-hwp', type: 'save', id }, server.origin)
    try {
      await done
    } catch (e) {
      toast(`저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    registerSave(() => saveRef.current())
    return () => registerSave(null)
  }, [registerSave])

  if (error) {
    return (
      <div className="empty-state">
        <div>HWP 문서를 열 수 없습니다.</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', maxWidth: 520, textAlign: 'center' }}>{error}</div>
        <button className="btn small" onClick={() => api.fs.openDefault(path)}>
          기본 앱에서 열기
        </button>
      </div>
    )
  }

  return (
    <div className="html-preview">
      <div className="html-preview-bar">
        <span className="name" title={path}>
          {basename(path)}
          {hwpx && <span className="hwp-note"> · HWPX 는 저장할 때 같은 이름의 .hwp 로 저장됩니다</span>}
        </span>
        <span className="grow" />
        <button className="btn small primary" onClick={() => void save()} disabled={!loaded || !dirty} title="⌘S">
          저장
        </button>
        <button className="btn small" onClick={() => api.fs.openDefault(path).catch((e: unknown) => toast(String(e)))} title="HOP·한글 등 기본 앱에서 열기">
          기본 앱에서 열기
        </button>
      </div>
      {server && (
        <iframe
          ref={frame}
          className="html-preview-frame"
          src={`${server.origin}/__host/?token=${server.token}&path=${encodeURIComponent(path)}`}
          title={basename(path)}
          allow="clipboard-read; clipboard-write"
        />
      )}
    </div>
  )
}
