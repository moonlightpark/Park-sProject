import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ProjectEntry } from '../lib/types'
import { t } from '../i18n/ko'
import { ContextMenu, Icon, toast } from './ui'
import { ProjectAvatar, Appearance } from './ProjectAvatar'

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

function openedLabel(ms: number | null): string {
  if (!ms) return ''
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(new Date()) - day(new Date(ms))) / 86400000)
  if (diff <= 0) return t.launcher.today
  if (diff === 1) return t.launcher.yesterday
  if (diff < 7) return t.launcher.daysAgo(diff)
  return new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
}

/** 작업공간이 없는 창에 나오는 프로젝트 시작 화면 */
export function Launcher({ appearance }: { appearance: Record<string, Appearance> }) {
  const [projects, setProjects] = useState<ProjectEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number; p: ProjectEntry } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => api.projects.list().then(setProjects), [])
  useEffect(() => {
    load()
    searchRef.current?.focus()
    // 다른 창에서 프로젝트를 열면 최근 목록이 바뀌므로 창으로 돌아올 때 다시 읽는다
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
  }, [projects, query])

  useEffect(() => setSel(0), [query])
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const run = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn()
    } catch (e) {
      toast(errMsg(e))
    }
  }

  const open = (p: ProjectEntry, newWindow = false): void => {
    if (!p.exists) {
      toast(`${t.launcher.missing}: ${p.path}`)
      return
    }
    run(() => (newWindow ? api.workspace.openInNewWindow(p.path) : api.workspace.open(p.path)))()
  }

  const remove = async (p: ProjectEntry): Promise<void> => {
    await api.projects.remove(p.path)
    load()
  }

  return (
    <div className="launcher">
      <aside className="launcher-side">
        <div className="launcher-brand">
          <div className="logo-mark">박</div>
          <span>박프로</span>
        </div>
        <div className="launcher-actions">
          <button className="btn primary big" onClick={run(() => api.workspace.pick())}>
            {t.launcher.openFolder}
          </button>
          <button className="btn big" onClick={run(() => api.projects.newFolder())}>
            {t.launcher.newFolder}
          </button>
          <button className="btn" onClick={run(() => api.projects.tutorial())}>
            {t.launcher.tutorial}
          </button>
        </div>
        <div className="launcher-search">
          <input
            ref={searchRef}
            value={query}
            placeholder={t.launcher.search}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(s + 1, filtered.length - 1)))
              if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)))
              if (e.key === 'Enter' && filtered[sel]) open(filtered[sel], e.metaKey || e.ctrlKey)
            }}
          />
        </div>
        <div className="launcher-list" ref={listRef}>
          {projects && projects.length === 0 && <div className="launcher-empty">{t.launcher.noRecent}</div>}
          {projects && projects.length > 0 && filtered.length === 0 && <div className="launcher-empty">{t.launcher.noMatch}</div>}
          {filtered.map((p, i) => (
            <div
              key={p.path}
              className={`project-item${i === sel && query ? ' sel' : ''}${p.exists ? '' : ' missing'}`}
              onClick={(e) => open(p, e.metaKey || e.ctrlKey)}
              onMouseEnter={() => setSel(i)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, p })
              }}
              title={p.path}
            >
              <ProjectAvatar path={p.path} name={p.name} appearance={appearance?.[p.path]} size={32} />
              <div className="pinfo">
                <div className="pname">{p.name}</div>
                <div className="ppath">{p.path}</div>
                <div className="pmeta">
                  {p.exists ? t.launcher.mdFiles(p.mdCount, p.mdCapped) : t.launcher.missing}
                  {p.lastOpened ? <span>{openedLabel(p.lastOpened)}</span> : null}
                </div>
              </div>
              <button
                className="icon-btn premove"
                title={t.launcher.remove}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(p)
                }}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="launcher-main">
        <div className="launcher-card">
          <div className="card-head">
            <div className="logo-mark large">박</div>
            <div>
              <h1>{t.launcher.title}</h1>
              <div className="sub">{t.launcher.subtitle}</div>
            </div>
          </div>
          <p className="intro">
            {t.launcher.intro[0]}
            <b>{t.launcher.intro[1]}</b>
            {t.launcher.intro[2]}
          </p>
          <div className="feature-grid">
            {t.launcher.features.map((f) => (
              <div key={f.title} className="feature">
                <div className={`ficon ${f.color}`}>
                  <Icon name={f.icon} size={16} />
                </div>
                <div>
                  <div className="ftitle">{f.title}</div>
                  <div className="fdesc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <hr />
          <div className="tutorial-cta">
            <button className="btn primary big glow" onClick={run(() => api.projects.tutorial())}>
              ▶&nbsp; {t.launcher.tutorial}
            </button>
            <div className="hint">{t.launcher.tutorialHint}</div>
          </div>
          <div className="or-line">
            <span>{t.launcher.or}</span>
          </div>
          <button className="open-own" onClick={run(() => api.workspace.pick())}>
            ← {t.launcher.openOwn[0]}
            <b>{t.launcher.openOwn[1]}</b>
            {t.launcher.openOwn[2]}
          </button>
        </div>
      </main>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: t.launcher.open, onClick: () => open(menu.p) },
            { label: t.launcher.openNewWindow, onClick: () => open(menu.p, true) },
            { label: t.launcher.reveal, onClick: () => api.projects.reveal(menu.p.path) },
            'sep',
            { label: t.launcher.remove, danger: true, onClick: () => remove(menu.p) }
          ]}
        />
      )}
    </div>
  )
}
