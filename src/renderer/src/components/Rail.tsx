import { ReactNode, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { panels, usePanels } from '../lib/panels'
import { useProject } from '../lib/project'
import { effectiveDisplay, setProjectDisplay } from '../lib/display'
import type { Settings } from '../lib/types'
import { t } from '../i18n/ko'
import { Icon, toast } from './ui'

export type Mode = 'git' | 'files' | 'agent' | 'tracker' | 'wiki'

interface UsageWindow {
  utilization: number
  resetsAt: number | null
}
export interface UsageState {
  claude: { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null; updatedAt: number } | null
  account: { email?: string; organization?: string; subscriptionType?: string; apiProvider?: string } | null
  codexInstalled: boolean
  geminiInstalled: boolean
}

const relTime = (ms: number): string => {
  const diff = ms - Date.now()
  const abs = Math.abs(diff)
  const m = Math.round(abs / 60000)
  const text = m < 1 ? '곧' : m < 60 ? `${m}분` : m < 60 * 24 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${Math.floor(m / 1440)}일`
  if (m < 1) return diff > 0 ? '곧' : '방금'
  return diff > 0 ? `${text} 후` : `${text} 전`
}

const levelColor = (u: number): string => (u >= 80 ? 'var(--danger)' : u >= 50 ? 'var(--warn)' : 'var(--ok)')

/** 레일 아이콘 오른쪽으로 펼쳐지는 작은 창 */
function Popover({
  anchor,
  title,
  children,
  wide
}: {
  anchor: (open: boolean, toggle: () => void) => ReactNode
  title: string
  children: (close: () => void) => ReactNode
  wide?: boolean
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [open])
  return (
    <div className="rail-pop-wrap" onMouseDown={(e) => e.stopPropagation()}>
      {anchor(open, () => setOpen((v) => !v))}
      {open && (
        <div className={`rail-pop${wide ? ' wide' : ''}`}>
          <div className="rail-pop-title">{title}</div>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** 사용률을 고리 모양으로 보여 주는 작은 아이콘 */
function UsageRing({ value, label }: { value: number | null; label: string }) {
  const r = 12
  const c = 2 * Math.PI * r
  return (
    <span className="usage-ring" aria-label={label}>
      <svg width="30" height="30" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r={r} fill="none" stroke="var(--border)" strokeWidth="2.4" />
        {value !== null && (
          <circle
            cx="15"
            cy="15"
            r={r}
            fill="none"
            stroke={levelColor(value)}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray={`${(Math.min(100, value) / 100) * c} ${c}`}
            transform="rotate(-90 15 15)"
          />
        )}
      </svg>
      <span className="usage-text">{value === null ? '--' : `${Math.round(value)}%`}</span>
    </span>
  )
}

export function UsageBar({ title, w }: { title: string; w: UsageWindow | null }) {
  if (!w) return null
  return (
    <div className="usage-row">
      <div className="usage-head">
        <span>{title}</span>
        <b style={{ color: levelColor(w.utilization) }}>
          {w.utilization}% {t.usage.used}
        </b>
      </div>
      <div className="usage-bar">
        <span style={{ width: `${Math.min(100, w.utilization)}%`, background: levelColor(w.utilization) }} />
      </div>
      {w.resetsAt && <div className="usage-sub">{t.usage.resets(relTime(w.resetsAt))}</div>}
    </div>
  )
}

export function Rail({
  mode,
  setMode,
  workspace,
  settings,
  badgeAgent,
  onOpenOverlay
}: {
  mode: Mode
  setMode: (m: Mode) => void
  workspace: string
  settings: Settings
  badgeAgent: boolean
  /** 사용자 메뉴에서 여는 창 */
  onOpenOverlay: (o: 'settings' | 'project-settings' | 'features' | 'user-info') => void
}) {
  const p = usePanels()
  const project = useProject()
  const f = project?.features
  const [usage, setUsage] = useState<UsageState | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    api.usage.get().then(setUsage)
    return api.usage.onUpdated(setUsage)
  }, [])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      setUsage(await api.usage.refresh())
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  const modeBtn = (m: Mode, icon: string, title: string, extra?: ReactNode) => (
    <button className={`rail-btn${mode === m ? ' active' : ''}`} onClick={() => setMode(m)} title={title}>
      <Icon name={icon} size={18} />
      {extra}
    </button>
  )

  const five = usage?.claude?.fiveHour?.utilization ?? null
  const perm = settings.permissionMode
  const account = usage?.account

  return (
    <nav className="rail">
      {f?.git !== false && modeBtn('git', 'gitTree', t.rail.git)}
      {modeBtn('files', 'code', t.rail.files)}
      {modeBtn('agent', 'agent', t.rail.agent, badgeAgent ? <span className="badge" /> : null)}
      {f?.tracker !== false && modeBtn('tracker', 'database', t.rail.tracker)}
      {f?.wiki !== false && modeBtn('wiki', 'globe', t.rail.wiki, <sup className="alpha">α</sup>)}

      <span className="spacer" />

      {f?.terminal !== false && (
      <button
        className={`rail-btn${p.terminal && mode === 'files' ? ' active' : ''}`}
        title={t.rail.terminal}
        onClick={() => {
          if (mode !== 'files') {
            setMode('files')
            panels.set({ terminal: true })
          } else panels.toggle('terminal')
        }}
      >
        <Icon name="terminal" size={18} />
      </button>
      )}
      <span className="rail-sep" />

      <Popover
        title={t.rail.claude}
        wide
        anchor={(open, toggle) => (
          <button className={`rail-btn ring${open ? ' on' : ''}`} onClick={toggle} title={t.rail.claude}>
            <UsageRing value={five} label={t.rail.claude} />
          </button>
        )}
      >
        {() => (
          <div className="rail-pop-body">
            {usage?.claude ? (
              <>
                <UsageBar title={t.usage.fiveHour} w={usage.claude.fiveHour} />
                <UsageBar title={t.usage.sevenDay} w={usage.claude.sevenDay} />
                <div className="usage-sub">{t.usage.updated(relTime(usage.claude.updatedAt))}</div>
              </>
            ) : (
              <div className="usage-sub">{t.usage.none}</div>
            )}
            <button className="btn small" disabled={refreshing} onClick={refresh} title={t.usage.refreshHint}>
              {refreshing ? t.usage.refreshing : t.usage.refresh}
            </button>
          </div>
        )}
      </Popover>
      <Popover
        title={t.rail.codex}
        anchor={(open, toggle) => (
          <button className={`rail-btn ring${open ? ' on' : ''}`} onClick={toggle} title={t.rail.codex}>
            <UsageRing value={null} label={t.rail.codex} />
          </button>
        )}
      >
        {() => (
          <div className="rail-pop-body">
            <div className="usage-sub">{usage?.codexInstalled ? t.usage.installed : t.usage.notInstalled}</div>
            <div className="usage-sub">{t.usage.notConnected}</div>
          </div>
        )}
      </Popover>
      <Popover
        title={t.rail.gemini}
        anchor={(open, toggle) => (
          <button className={`rail-btn ring${open ? ' on' : ''}`} onClick={toggle} title={t.rail.gemini}>
            <UsageRing value={null} label={t.rail.gemini} />
          </button>
        )}
      >
        {() => (
          <div className="rail-pop-body">
            <div className="usage-sub">{usage?.geminiInstalled ? t.usage.installed : t.usage.notInstalled}</div>
            <div className="usage-sub">{t.usage.notConnected}</div>
          </div>
        )}
      </Popover>

      <Popover
        title={t.permissionPopover.title}
        wide
        anchor={(open, toggle) => (
          <button className={`rail-btn${open ? ' on' : ''}`} onClick={toggle} title={`${t.rail.permission}: ${t.agent.permissionModes[perm]}`}>
            <Icon name="shield" size={18} />
            <span className={`perm-dot perm-${perm}`} />
          </button>
        )}
      >
        {(close) => (
          <div className="rail-pop-body">
            <div className="usage-sub">{t.permissionPopover.hint}</div>
            {(Object.keys(t.agent.permissionModes) as Settings['permissionMode'][]).map((k) => (
              <button
                key={k}
                className={`perm-option${perm === k ? ' on' : ''}`}
                onClick={() => {
                  api.settings.update({ permissionMode: k })
                  close()
                }}
              >
                <span className={`perm-dot static perm-${k}`} />
                <span>
                  <b>{t.agent.permissionModes[k]}</b>
                  <span className="usage-sub">{t.permissionPopover.desc[k]}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Popover>

      <Popover
        title={t.rail.theme}
        anchor={(open, toggle) => (
          <button className={`rail-btn${open ? ' on' : ''}`} onClick={toggle} title={t.rail.theme}>
            <Icon name="palette" size={18} />
          </button>
        )}
      >
        {(close) => (
          <div className="rail-pop-body">
            {(Object.keys(t.settings.themes) as Settings['theme'][]).map((k) => (
              <button
                key={k}
                className={`perm-option${effectiveDisplay(settings, workspace).theme === k ? ' on' : ''}`}
                onClick={() => {
                  // 테마는 프로젝트 모양 설정이다 (이 프로젝트에만 적용)
                  setProjectDisplay(settings, workspace, { theme: k })
                  close()
                }}
              >
                <span className={`theme-swatch theme-${k}`} />
                <b>{t.settings.themes[k]}</b>
              </button>
            ))}
          </div>
        )}
      </Popover>

      <Popover
        title={t.rail.user}
        wide
        anchor={(open, toggle) => (
          <button className={`rail-btn${open ? ' on' : ''}`} onClick={toggle} title={account?.email ?? t.rail.user} style={{ marginBottom: 8 }}>
            <Icon name="user" size={18} />
          </button>
        )}
      >
        {(close) => (
          <div className="rail-pop-body">
            {account && (
              <div className="account">
                <div className="avatar">{(account.email ?? '?').slice(0, 1).toUpperCase()}</div>
                <div style={{ minWidth: 0 }}>
                  <b className="ellipsis">{account.email ?? '—'}</b>
                  {account.subscriptionType && <div className="usage-sub">{account.subscriptionType}</div>}
                </div>
              </div>
            )}
            {account && <hr />}
            {(
              [
                ['settings', 'settings', t.userMenu.appSettings, t.userMenu.appSettingsDesc],
                ['project-settings', 'folder', t.userMenu.projectSettings, t.userMenu.projectSettingsDesc],
                ['features', 'plus', t.userMenu.features, t.userMenu.featuresDesc],
                ['user-info', 'user', t.userMenu.userInfo, t.userMenu.userInfoDesc]
              ] as const
            ).map(([key, icon, label, desc]) => (
              <button key={key} className="perm-option" onClick={() => (close(), onOpenOverlay(key))}>
                <span className="menu-icon">
                  <Icon name={icon} size={15} />
                </span>
                <span>
                  <b>{label}</b>
                  <span className="usage-sub">{desc}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Popover>
    </nav>
  )
}
