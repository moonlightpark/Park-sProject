import { ReactNode, useEffect, useState } from 'react'
import { api, basename } from '../lib/api'
import { panels, usePanels } from '../lib/panels'
import { useFeature } from '../lib/project'
import { t } from '../i18n/ko'
import { keys } from '../lib/keys'
import { Icon } from './ui'
import { ProjectSwitcher } from './ProjectSwitcher'

import type { Mode } from './Rail'
import type { ProjectAppearance } from '../lib/types'

interface GitInfo {
  isRepo: boolean
  branch: string | null
  dirty: number
  ahead: number
  behind: number
  worktrees: { path: string; branch: string | null; current: boolean }[]
}

/** 버튼 아래로 펼쳐지는 작은 메뉴. 바깥을 누르거나 창이 포커스를 잃으면 닫힌다. */
function Dropdown({
  button,
  align = 'left',
  width = 260,
  onOpen,
  children
}: {
  button: (open: boolean, toggle: () => void) => ReactNode
  align?: 'left' | 'right'
  width?: number
  onOpen?: () => void
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    onOpen?.()
    const close = (): void => setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="tb-drop" onMouseDown={(e) => e.stopPropagation()}>
      {button(open, () => setOpen((v) => !v))}
      {open && (
        <div className="ctx-menu tb-menu" style={{ width, [align]: 0 }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function MenuItem({ label, hint, checked, onClick, disabled }: { label: ReactNode; hint?: string; checked?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="tb-item" onClick={onClick} disabled={disabled}>
      <span className="check">{checked ? '✓' : ''}</span>
      <span className="grow">{label}</span>
      {hint && <span className="kbd">{hint}</span>}
    </button>
  )
}

export function TitleBar({
  workspace,
  mode,
  recent,
  appearance,
  runningCount,
  waitingCount,
  onNewSession,
  onCommand,
  onShowAgent
}: {
  workspace: string
  mode: Mode
  recent: string[]
  appearance: Record<string, ProjectAppearance>
  runningCount: number
  waitingCount: number
  onNewSession: () => void
  onCommand: (cmd: string) => void
  onShowAgent: () => void
}) {
  const p = usePanels()
  const aiOn = useFeature('aiPanel')
  const terminalOn = useFeature('terminal')
  const gitOn = useFeature('git')
  const [git, setGit] = useState<GitInfo | null>(null)
  const loadGit = (): void => {
    api.git.info().then(setGit).catch(() => setGit(null))
  }
  useEffect(loadGit, [workspace])

  const sidebarUsable = mode !== 'tracker'

  return (
    <header className="titlebar">
      <div className="tb-left">
        <div className="tb-split">
          <button className="tb-btn" onClick={onNewSession} title={keys('⌥⌘N')}>
            <Icon name="plus" size={14} /> {t.titlebar.newSession}
          </button>
          <Dropdown
            button={(open, toggle) => (
              <button className={`tb-btn caret${open ? ' on' : ''}`} onClick={toggle} title={t.titlebar.newMenu}>
                <Icon name="caret" size={13} />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem label={t.titlebar.newAgentSession} hint={keys('⌥⌘N')} onClick={() => (close(), onNewSession())} />
                <MenuItem label={t.titlebar.newFile} hint={keys('⌘N')} onClick={() => (close(), onCommand('new-file'))} />
                <hr />
                <MenuItem label={t.titlebar.newWindow} hint={keys('⇧⌘N')} onClick={() => (close(), api.workspace.newWindow())} />
                <MenuItem label={t.titlebar.openFolderNewWindow} hint={keys('⇧⌘O')} onClick={() => (close(), api.workspace.pickNewWindow())} />
              </>
            )}
          </Dropdown>
        </div>
      </div>

      <div className="tb-center">
        <ProjectSwitcher workspace={workspace} recent={recent} appearance={appearance} />
        <span className="tb-mode">— {t.modes[mode]}</span>
      </div>

      <div className="tb-right">
        {runningCount > 0 && (
          <button className="tb-btn status" onClick={onShowAgent} title={t.titlebar.running(runningCount)}>
            <span className="spinner" /> {runningCount}
          </button>
        )}
        {waitingCount > 0 && (
          <button className="tb-btn status warn" onClick={onShowAgent}>
            {t.titlebar.waiting(waitingCount)}
          </button>
        )}

        {gitOn && (
        <Dropdown
          align="right"
          width={320}
          onOpen={loadGit}
          button={(open, toggle) => (
            <button className={`tb-btn${open ? ' on' : ''}`} onClick={toggle} title={git?.branch ? `${t.titlebar.git}: ${git.branch}` : t.titlebar.git}>
              <Icon name="gitTree" size={15} />
              {git?.isRepo && git.dirty > 0 && <span className="tb-dot" />}
              <Icon name="caret" size={12} />
            </button>
          )}
        >
          {(close) =>
            !git || !git.isRepo ? (
              <div className="tb-note">
                <b>{t.titlebar.notRepo}</b>
                <div>{t.titlebar.notRepoHint}</div>
              </div>
            ) : (
              <>
                <div className="menu-label">{t.titlebar.branch}</div>
                <div className="tb-note">
                  <b>{git.branch ?? '(HEAD)'}</b>
                  <div>
                    {t.titlebar.changes(git.dirty)}
                    {(git.ahead > 0 || git.behind > 0) && ` · ${t.titlebar.aheadBehind(git.ahead, git.behind)}`}
                  </div>
                </div>
                <hr />
                <div className="menu-label">
                  {t.titlebar.worktrees} {git.worktrees.length}
                </div>
                {git.worktrees.map((w) => (
                  <MenuItem
                    key={w.path}
                    checked={w.current}
                    label={
                      <span className="wt">
                        <span className="wt-name">{w.branch ?? basename(w.path)}</span>
                        <span className="wt-path">{w.current ? t.titlebar.currentWorktree : w.path}</span>
                      </span>
                    }
                    onClick={() => {
                      close()
                      if (!w.current) api.workspace.openInNewWindow(w.path)
                    }}
                  />
                ))}
                <hr />
                {terminalOn && <MenuItem label={t.titlebar.openTerminal} hint={keys('⌃`')} onClick={() => (close(), onCommand('open-terminal'))} />}
                <MenuItem label={t.titlebar.refresh} onClick={loadGit} />
              </>
            )
          }
        </Dropdown>
        )}

        <span className="tb-sep" />

        <button
          className={`tb-btn icon${p.sidebar && sidebarUsable ? ' active' : ''}`}
          disabled={!sidebarUsable}
          onClick={() => panels.toggle('sidebar')}
          title={t.titlebar.toggleSidebar(p.sidebar)}
        >
          <Icon name="sidebarLeft" size={16} />
        </button>

        <div className="tb-split">
          {aiOn && (
          <button
            className={`tb-btn icon${p.ai && mode !== 'agent' ? ' active' : ''}`}
            onClick={() => onCommand('toggle-ai')}
            title={t.titlebar.toggleAi(p.ai)}
          >
            <Icon name="panelRight" size={16} />
          </button>
          )}
          <Dropdown
            align="right"
            width={220}
            button={(open, toggle) => (
              <button className={`tb-btn caret${open ? ' on' : ''}`} onClick={toggle} title={t.titlebar.rightPanels}>
                <Icon name="caret" size={13} />
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="menu-label">{t.titlebar.rightPanels}</div>
                {aiOn && <MenuItem label={t.titlebar.aiPanel} hint={keys('⇧⌘A')} checked={p.ai} onClick={() => (close(), onCommand('toggle-ai'))} />}
                <MenuItem label={t.titlebar.historyPanel} hint={keys('⇧⌘H')} checked={p.history} onClick={() => (close(), onCommand('toggle-history'))} />
                {terminalOn && <MenuItem label={t.titlebar.terminalPanel} hint={keys('⌃`')} checked={p.terminal} onClick={() => (close(), onCommand('toggle-terminal'))} />}
              </>
            )}
          </Dropdown>
        </div>
      </div>
    </header>
  )
}
