import { useEffect, useState } from 'react'
import { api, basename } from '../lib/api'
import { t } from '../i18n/ko'
import { Icon } from './ui'
import { ProjectAvatar, Appearance } from './ProjectAvatar'

interface OpenProject {
  workspace: string
  current: boolean
  windowId: number
}

/** 상단 표시줄의 프로젝트 이름. 누르면 열린 프로젝트 창 목록과 새 창 열기 메뉴가 나온다. */
export function ProjectSwitcher({ workspace, recent, appearance = {} }: { workspace: string; recent: string[]; appearance?: Record<string, Appearance> }) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<OpenProject[]>([])

  useEffect(() => {
    if (!open) return
    api.workspace.listOpen().then(setProjects)
    const close = (): void => setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [open])

  const openPaths = new Set(projects.map((p) => p.workspace))
  const others = recent.filter((d) => !openPaths.has(d) && d !== workspace).slice(0, 6)
  const run = (fn: () => unknown) => () => {
    setOpen(false)
    fn()
  }

  return (
    <div style={{ position: 'relative' }} onMouseDown={(e) => e.stopPropagation()}>
      <button className="project-switch" onClick={() => setOpen((v) => !v)} title={workspace}>
        <ProjectAvatar path={workspace} name={basename(workspace)} appearance={appearance[workspace]} size={20} />
        <span className="ws-name">{basename(workspace)}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="ctx-menu project-menu">
          <div className="menu-label">{t.projects.open}</div>
          {projects.map((p) => (
            <button key={p.windowId} onClick={run(() => !p.current && api.workspace.focus(p.windowId))} title={p.workspace}>
              <span className="check">{p.current ? '✓' : ''}</span>
              <ProjectAvatar path={p.workspace} name={basename(p.workspace)} appearance={appearance[p.workspace]} size={18} />
              <span className="pname">{basename(p.workspace)}</span>
              <span className="ppath">{p.workspace}</span>
            </button>
          ))}
          <hr />
          <button onClick={run(() => api.workspace.pickNewWindow())}>
            <span className="check" />
            {t.projects.openNewWindow}
          </button>
          <button onClick={run(() => api.workspace.newWindow())}>
            <span className="check" />
            {t.projects.newWindow}
          </button>
          {others.length > 0 && (
            <>
              <hr />
              <div className="menu-label">
                {t.projects.recent} — {t.projects.openRecentNewWindow}
              </div>
              {others.map((d) => (
                <button key={d} onClick={run(() => api.workspace.openInNewWindow(d))} title={d}>
                  <span className="check" />
                  <ProjectAvatar path={d} name={basename(d)} appearance={appearance[d]} size={18} />
                  <span className="pname">{basename(d)}</span>
                  <span className="ppath">{d}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
