import { useEffect, useRef, useState } from 'react'
import { api, basename, join } from './lib/api'
import { bus } from './lib/bus'
import { agentStore, useAgentStore } from './lib/agentStore'
import type { Settings } from './lib/types'
import { t } from './i18n/ko'
import { WELCOME_DOC } from './i18n/welcome'
import { FilesMode } from './modes/FilesMode'
import { AgentMode } from './modes/AgentMode'
import { TrackerMode } from './modes/TrackerMode'
import { QuickOpen, SearchModal, ShortcutsModal } from './components/Palettes'
import { Icon, ToastHost } from './components/ui'
import { TitleBar } from './components/TitleBar'
import { panels, usePanels } from './lib/panels'
import { AiPanel } from './components/AiPanel'
import { Rail, Mode } from './components/Rail'
import { GitMode } from './modes/GitMode'
import { WikiMode } from './modes/WikiMode'
import { projectStore, useProject } from './lib/project'
import { UserInfoModal } from './components/ProjectModals'
import { AppSettingsView, AppPage } from './components/settings/AppSettingsView'
import { ProjectSettingsView, ProjectPage } from './components/settings/ProjectSettingsView'
import { playSound } from './lib/sound'
import { editorFontCss, effectiveDisplay, setProjectDisplay } from './lib/display'
import { Launcher } from './components/Launcher'

type Overlay = 'quick-open' | 'search' | 'shortcuts' | 'user-info' | null
/** 전체 화면 설정 (애플리케이션 / 프로젝트) */
type SettingsScreen = { kind: 'app'; page?: AppPage } | { kind: 'project'; page?: ProjectPage } | null

/** 파일 모드에서 처리해야 하는 메뉴 명령 */
const FILE_COMMANDS = new Set(['save', 'close-tab', 'reopen-tab', 'new-file', 'toggle-terminal', 'toggle-history', 'find', 'refresh-tree', 'open-terminal'])

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<Mode>('files')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [screen, setScreen] = useState<SettingsScreen>(null)
  const [agentFocus, setAgentFocus] = useState<string | null>(null)
  const running = useAgentStore((s) => s.running)
  const permissions = useAgentStore((s) => s.permissions)
  const panelState = usePanels()
  const runningCount = Object.values(running).filter(Boolean).length

  useEffect(() => {
    api.settings.get().then(setSettings)
    api.workspace.current().then((w: string | null) => {
      setWorkspace(w)
      setReady(true)
    })
    // 마지막 작업공간이 늦게 열리는 경우를 위해 잠시 기다렸다가 환영 화면을 보여준다
    const timer = setTimeout(() => setReady(true), 400)
    const offs = [
      api.settings.onChanged(setSettings),
      api.workspace.onOpened((dir: string) => {
        setWorkspace(dir)
        setReady(true)
      }),
      api.agent.onEvent((e) => agentStore.handleEvent(e))
    ]
    return () => {
      clearTimeout(timer)
      offs.forEach((off) => off())
    }
  }, [])

  useEffect(() => {
    if (!workspace) return
    agentStore.load()
    projectStore.load()
    return projectStore.subscribe()
  }, [workspace])

  // 꺼진 기능의 화면에 있으면 파일 화면으로 돌아간다
  const project = useProject()
  useEffect(() => {
    const f = project?.features
    if (!f) return
    if ((mode === 'git' && !f.git) || (mode === 'tracker' && !f.tracker) || (mode === 'wiki' && !f.wiki)) setMode('files')
    if (!f.aiPanel && panels.get().ai) panels.set({ ai: false })
    if (!f.terminal && panels.get().terminal) panels.set({ terminal: false })
  }, [project, mode])

  // 에이전트가 끝나면 메인 프로세스가 소리를 요청한다 (설정 → 알림)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  useEffect(() => {
    const offs = [
      api.notify.onSound(() => {
        const s = settingsRef.current
        if (s?.soundEnabled) playSound(s.soundType, s.soundVolume)
      }),
      api.onFocusSession((id: string) => {
        setAgentFocus(id)
        setMode('agent')
      })
    ]
    return () => offs.forEach((o) => o())
  }, [])

  // 화면 설정: 프로젝트 모양에 정한 값이 있으면 그것을, 없으면 애플리케이션 기본값을 쓴다
  const display = settings ? effectiveDisplay(settings, workspace) : null
  useEffect(() => {
    if (!display) return
    const root = document.documentElement
    root.dataset.theme = display.theme
    api.setTheme(display.theme)
    root.style.setProperty('--editor-font-size', `${display.editorFontSize}px`)
    root.style.setProperty('--editor-font-family', editorFontCss(display.editorFont))
  }, [display?.theme, display?.editorFontSize, display?.editorFont]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (display) api.setZoom(display.uiScale)
  }, [display?.uiScale]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!display || api.platform === 'darwin') return
    // Windows 창 버튼은 페이지 밖에서 그려지므로 테마 색과 배율을 직접 알려 준다
    const css = getComputedStyle(document.documentElement)
    api.setTitleBarOverlay({
      color: css.getPropertyValue('--panel').trim() || '#fbfbfc',
      symbolColor: css.getPropertyValue('--text').trim() || '#1d1f24',
      height: 40 * display.uiScale
    })
  }, [display?.theme, display?.uiScale]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 메뉴와 상단 바가 함께 쓰는 명령 처리 */
  const runCommand = async (cmd: string): Promise<void> => {
    if (cmd === 'open-settings') return setScreen({ kind: 'app' })
    if (cmd === 'shortcuts') return setOverlay('shortcuts')
    if (cmd.startsWith('theme-') && settings) {
      const theme = cmd.slice(6) as 'light' | 'dark' | 'crystal'
      return workspace ? setProjectDisplay(settings, workspace, { theme }) : void api.settings.update({ theme })
    }
    if (!workspace) return
    switch (cmd) {
      case 'mode-files':
        return setMode('files')
      case 'mode-agent':
        return setMode('agent')
      case 'mode-tracker':
        return setMode('tracker')
      case 'mode-wiki':
        return setMode('wiki')
      case 'mode-git':
        return setMode('git')
      case 'quick-open':
        return setOverlay('quick-open')
      case 'search':
        return setOverlay('search')
      case 'toggle-ai':
        // AI 영역은 창 단위 열이라 파일·트래커 모드에서 쓴다. 에이전트 모드에서는 파일 모드로 옮겨 연다
        if (mode === 'agent') {
          setMode('files')
          return panels.set({ ai: true })
        }
        return panels.toggle('ai')
      case 'toggle-sidebar':
        if (mode === 'tracker') setMode('files')
        return panels.toggle('sidebar')
      case 'new-session':
        setMode('agent')
        return void setTimeout(() => bus.emit(cmd))
      case 'open-terminal':
        setMode('files')
        return panels.set({ terminal: true })
      case 'welcome': {
        const p = join(workspace, '박프로 시작하기.md')
        await api.fs.createFile(p, WELCOME_DOC).catch(() => undefined)
        return openFile(p)
      }
    }
    if (FILE_COMMANDS.has(cmd) && mode !== 'files') {
      setMode('files')
      return void setTimeout(() => bus.emit(cmd))
    }
    bus.emit(cmd)
  }

  useEffect(
    () => api.onMenu((cmd: string) => void runCommand(cmd)),
    [workspace, mode] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const openFile = (p: string): void => {
    setMode('files')
    setTimeout(() => bus.emit('open-file', p))
  }

  if (!settings || !ready) return null

  // 아래 화면들은 프로젝트에 맞춘 테마·글꼴 크기를 쓴다
  const shown = display ? { ...settings, theme: display.theme, editorFontSize: display.editorFontSize } : settings

  if (!workspace) {
    return (
      <>
        {screen?.kind === 'app' ? (
          <AppSettingsView settings={settings} hasWorkspace={false} onClose={() => setScreen(null)} onOpenFeatures={() => undefined} onOpenWiki={() => undefined} />
        ) : (
          <Launcher appearance={settings.projectAppearance} />
        )}
        <ToastHost />
        {overlay === 'shortcuts' && <ShortcutsModal onClose={() => setOverlay(null)} />}
      </>
    )
  }

  return (
    <div className="app-shell">
      <TitleBar
        workspace={workspace}
        mode={mode}
        recent={settings.recentWorkspaces}
        appearance={settings.projectAppearance ?? {}}
        runningCount={runningCount}
        waitingCount={permissions.length}
        onNewSession={() => void runCommand('new-session')}
        onCommand={(cmd) => void runCommand(cmd)}
        onShowAgent={() => setMode('agent')}
      />
      {/* 설정 화면을 여는 동안에도 탭·세션 상태를 지키도록 작업 화면은 숨기기만 한다 */}
      <div className="app" style={screen ? { display: 'none' } : undefined}>
      <Rail
        mode={mode}
        setMode={setMode}
        workspace={workspace}
        settings={settings}
        badgeAgent={runningCount > 0 || permissions.length > 0}
        onOpenOverlay={(o) => {
          if (o === 'settings') setScreen({ kind: 'app' })
          else if (o === 'project-settings') setScreen({ kind: 'project', page: 'appearance' })
          else if (o === 'features') setScreen({ kind: 'project', page: 'extensions' })
          else setOverlay(o)
        }}
      />
      <main className="main">
        {/* 탭·세션 상태를 지키기 위해 모드 화면은 숨기기만 한다 */}
        <div style={{ display: mode === 'files' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
          <FilesMode key={workspace} workspace={workspace} settings={shown} />
        </div>
        <div style={{ display: mode === 'agent' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
          <AgentMode key={workspace} settings={settings} focusSessionId={agentFocus} />
        </div>
        {mode === 'git' && (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <GitMode workspace={workspace} onOpenTerminal={() => void runCommand('open-terminal')} />
          </div>
        )}
        {mode === 'wiki' && (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <WikiMode
              workspace={workspace}
              onOpenAgent={(id) => {
                setAgentFocus(id)
                setMode('agent')
              }}
            />
          </div>
        )}
        {mode === 'tracker' && (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <TrackerMode
              onOpenAgent={(id) => {
                setAgentFocus(id)
                setMode('agent')
              }}
            />
          </div>
        )}
      </main>
      {panelState.ai && mode !== 'agent' && project?.features.aiPanel !== false && <AiPanel key={workspace} workspace={workspace} settings={shown} />}
      </div>
      {screen?.kind === 'app' && (
        <AppSettingsView
          key={screen.page ?? 'app'}
          settings={settings}
          initialPage={screen.page}
          hasWorkspace
          onClose={() => setScreen(null)}
          onOpenFeatures={() => setScreen({ kind: 'project', page: 'extensions' })}
          onOpenWiki={() => {
            setScreen(null)
            setMode('wiki')
          }}
        />
      )}
      {screen?.kind === 'project' && (
        <ProjectSettingsView
          key={screen.page ?? 'project'}
          workspace={workspace}
          settings={settings}
          initialPage={screen.page}
          onClose={() => setScreen(null)}
          onOpenFile={(p) => {
            setScreen(null)
            openFile(p)
          }}
        />
      )}
      {overlay === 'quick-open' && <QuickOpen root={workspace} onOpen={openFile} onClose={() => setOverlay(null)} />}
      {overlay === 'search' && <SearchModal root={workspace} onOpen={openFile} onClose={() => setOverlay(null)} />}
      {overlay === 'shortcuts' && <ShortcutsModal onClose={() => setOverlay(null)} />}
      {overlay === 'user-info' && <UserInfoModal onClose={() => setOverlay(null)} />}
      <ToastHost />
    </div>
  )
}
