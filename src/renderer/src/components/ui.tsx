import { ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../i18n/ko'

const paths: Record<string, string> = {
  files: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  agent: 'M12 3l2.2 4.6L19 9l-3.6 3.4.9 5L12 15l-4.3 2.4.9-5L5 9l4.8-1.4z',
  tracker: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm7.4 3a7.5 7.5 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.4 7.4 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.4 7.4 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  plus: 'M12 5v14M5 12h14',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v5M9.5 13.5h5',
  filePlus: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 12v6M9 15h6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  x: 'M6 6l12 12M18 6L6 18',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  send: 'M4 12l16-8-6 16-2-6z',
  stop: 'M7 7h10v10H7z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  folderOpen: 'M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1H7.5L4 19H5L3 17z',
  md: 'M4 6h16v12H4zM7 15V9l2.5 3L12 9v6M15 9v6M13 13l2 2 2-2',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M10 5h8M6 19h8M14 5l-4 14',
  strike: 'M5 12h14M16 7a4 3 0 0 0-8 0c0 4 8 2 8 6a4 3 0 0 1-8 0',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  ul: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  ol: 'M10 6h10M10 12h10M10 18h10M4 5l1-1v4M4 14h2l-2 3h2',
  check: 'M4 6l2 2 3-3M4 14l2 2 3-3M12 7h8M12 15h8',
  quote: 'M7 7h4v4H8v3H5v-4zM15 7h4v4h-3v3h-3v-4z',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  hr: 'M4 12h16',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  database: 'M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z',
  shield: 'M12 3l7 3v6c0 4.4-3 7.9-7 9-4-1.1-7-4.6-7-9V6zM9 12l2 2 4-4',
  palette: 'M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.2-1-1.6-1-2.6s.8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11.5h0M10 7.5h0M14.5 7.5h0',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  flask: 'M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7.5 14h9',
  cloud: 'M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z',
  key: 'M8 14a4 4 0 1 1 3.5-6H21v3h-2v3h-3v-3h-4.5A4 4 0 0 1 8 14z',
  square: 'M6 6h12v12H6z',
  hexagon: 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z',
  slash: 'M15 4L9 20',
  store: 'M4 9l1.5-5h13L20 9M4 9h16v2a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0zM5 12v8h14v-8',
  puzzle: 'M10 4a2 2 0 0 1 4 0v2h4v4h-2a2 2 0 0 0 0 4h2v4h-4v-2a2 2 0 0 0-4 0v2H6v-4h2a2 2 0 0 0 0-4H6V6h4z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h0M8 17h0',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM14.5 9a2.5 2 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2A2.5 2 0 0 1 9.5 15M12 6v1.5M12 16.5V18',
  nodes: 'M12 5a2 2 0 1 0 0 .01M5 18a2 2 0 1 0 0 .01M19 18a2 2 0 1 0 0 .01M12 7v4M12 11l-6 5M12 11l6 5',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.8c2.2.6 3.5 2.6 3.5 5.2',
  clipboard: 'M9 4h6v3H9zM7 5.5H5v15h14v-15h-2M8.5 11h7M8.5 15h5',
  robot: 'M7 8h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM12 4v4M9.5 13h0M14.5 13h0M3 13v2M21 13v2',
  github: 'M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-.9-2.4c3-.3 6-1.4 6-6.5a5 5 0 0 0-1.4-3.5 4.6 4.6 0 0 0-.1-3.5s-1.1-.3-3.6 1.4a12.4 12.4 0 0 0-6.5 0C6 1.3 4.9 1.6 4.9 1.6a4.6 4.6 0 0 0-.1 3.5A5 5 0 0 0 3.4 8.6c0 5.1 3 6.2 6 6.5a3 3 0 0 0-.9 2.4V21',
  sidebarLeft: 'M4 5h16v14H4zM9.5 5v14',
  panelRight: 'M4 5h16v14H4zM14.5 5v14M17 9h0M17 12h0',
  gitTree: 'M6 4v10M6 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 10c0 4-6 3-11 6',
  caret: 'M8 10l4 4 4-4',
  attach: 'M20 11l-8 8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7'
}

export function Icon({ name, size = 16 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] ?? paths.file} />
    </svg>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide
}: {
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        {title && (
          <div className="modal-head">
            <span className="grow">{title}</span>
            <button className="icon-btn" onClick={onClose} title={t.common.close}>
              <Icon name="x" />
            </button>
          </div>
        )}
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** window.prompt 은 Electron 에서 동작하지 않으므로 대신 쓰는 입력 대화상자 */
export function InputDialog({
  title,
  initial = '',
  onSubmit,
  onClose
}: {
  title: string
  initial?: string
  onSubmit: (v: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // 확장자 앞까지만 선택해 바로 이름을 고칠 수 있게 한다
    const dot = initial.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial])
  const submit = (): void => {
    if (value.trim()) onSubmit(value.trim())
    onClose()
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn primary" onClick={submit}>
            {t.common.ok}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          }}
        />
      </div>
    </Modal>
  )
}

export interface MenuEntry {
  label: string
  onClick: () => void
  danger?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: (MenuEntry | 'sep')[]
  onClose: () => void
}) {
  useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])
  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it === 'sep' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            style={it.danger ? { color: 'var(--danger)' } : undefined}
            onClick={() => {
              it.onClick()
              onClose()
            }}
          >
            {it.label}
          </button>
        )
      )}
    </div>
  )
}

let toastSetter: ((msg: string | null) => void) | null = null

export function toast(msg: string): void {
  toastSetter?.(msg)
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    toastSetter = setMsg
    return () => {
      toastSetter = null
    }
  }, [])
  useEffect(() => {
    if (!msg) return
    const id = setTimeout(() => setMsg(null), 2600)
    return () => clearTimeout(id)
  }, [msg])
  return msg ? <div className="toast">{msg}</div> : null
}
