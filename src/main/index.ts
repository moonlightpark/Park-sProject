import './migrate'
import {
  app,
  BrowserWindow,
  screen,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  Menu,
  shell,
  MenuItemConstructorOptions,
  Notification
} from 'electron'
import path from 'path'
import { promises as fsp } from 'fs'
import * as ws from './workspace'
import * as history from './history'
import * as tracker from './tracker'
import * as term from './terminal'
import * as agent from './agent'
import * as jobs from './jobs'
import * as projects from './projects'
import * as gitv from './worktree'
import * as usage from './usage'
import * as wiki from './wiki'
import * as project from './project'
import * as system from './system'
import { registerLocalFileScheme, handleLocalFile } from './localFile'
import { resetSettings } from './settings'
import { addRecentWorkspace, getSettings, removeRecentWorkspace, updateSettings, AppSettings } from './settings'

/**
 * 창 하나 = 작업공간 하나. 작업 격리를 위해 파일 감시, 터미널, 에이전트 이벤트를 모두 창별로 나눈다.
 */
interface WindowCtx {
  win: BrowserWindow
  workspace: string | null
  stopWatch: (() => void) | null
}

const windows = new Map<number, WindowCtx>()

const ctxOf = (e: IpcMainInvokeEvent): WindowCtx => {
  const ctx = windows.get(e.sender.id)
  if (!ctx) throw new Error('창을 찾을 수 없습니다.')
  return ctx
}

const sendTo = (ctx: WindowCtx, channel: string, ...args: unknown[]): void => {
  if (!ctx.win.isDestroyed()) ctx.win.webContents.send(channel, ...args)
}

const broadcast = (channel: string, ...args: unknown[]): void => {
  for (const ctx of windows.values()) sendTo(ctx, channel, ...args)
}

function requireWorkspace(ctx: WindowCtx): string {
  if (!ctx.workspace) throw new Error('먼저 작업공간 폴더를 여세요.')
  return ctx.workspace
}

const findWindowFor = (dir: string): WindowCtx | undefined =>
  [...windows.values()].find((c) => c.workspace && path.resolve(c.workspace) === path.resolve(dir))

const focusedCtx = (): WindowCtx | undefined => {
  const win = BrowserWindow.getFocusedWindow()
  return win ? windows.get(win.webContents.id) : undefined
}

async function openWorkspaceIn(ctx: WindowCtx, dir: string): Promise<void> {
  // 같은 폴더가 이미 다른 창에 열려 있으면 그 창을 앞으로 가져온다
  const existing = findWindowFor(dir)
  if (existing && existing !== ctx) {
    existing.win.show()
    existing.win.focus()
    return
  }
  ctx.stopWatch?.()
  ctx.workspace = dir
  addRecentWorkspace(dir)
  ctx.stopWatch = ws.watchWorkspace(
    dir,
    () => sendTo(ctx, 'workspace:tree-changed'),
    (p) => sendTo(ctx, 'workspace:file-changed', p)
  )
  growToProjectSize(ctx.win)
  ctx.win.setTitle(`${path.basename(dir)} — 박프로`)
  if (process.platform === 'darwin') ctx.win.setRepresentedFilename(dir)
  sendTo(ctx, 'workspace:opened', dir)
  buildMenu()
}

/**
 * 폴더를 연다. 빈 창이면 그 창에서, 이미 작업공간이 열린 창이면 새 창에서 연다.
 */
async function openWorkspace(dir: string, from?: WindowCtx): Promise<void> {
  const existing = findWindowFor(dir)
  if (existing) {
    existing.win.show()
    existing.win.focus()
    return
  }
  const target = from && !from.workspace ? from : await createWindow()
  await openWorkspaceIn(target, dir)
}

async function pickWorkspace(from?: WindowCtx, opts: { newWindow?: boolean } = {}): Promise<string | null> {
  const parent = from?.win ?? BrowserWindow.getFocusedWindow() ?? undefined
  const options: Electron.OpenDialogOptions = {
    title: opts.newWindow ? '새 창에서 폴더 열기' : '작업공간 폴더 열기',
    buttonLabel: '열기',
    properties: ['openDirectory', 'createDirectory']
  }
  const r = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (r.canceled || !r.filePaths[0]) return null
  await openWorkspace(r.filePaths[0], opts.newWindow ? undefined : from)
  return r.filePaths[0]
}

const PROJECT_SIZE = { width: 1440, height: 900 }
const LAUNCHER_SIZE = { width: 1100, height: 720 }

/** 시작 화면 크기의 창에서 프로젝트를 열면 작업하기 좋은 크기로 키운다 */
function growToProjectSize(win: BrowserWindow): void {
  const b = win.getBounds()
  if (b.width >= PROJECT_SIZE.width - 100 || win.isMaximized() || win.isFullScreen()) return
  const area = screen.getDisplayMatching(b).workArea
  const width = Math.min(PROJECT_SIZE.width, area.width)
  const height = Math.min(PROJECT_SIZE.height, area.height)
  win.setBounds(
    {
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height
    },
    true
  )
}

/**
 * 창을 만든다. 작업공간이 없는 창은 프로젝트 시작 화면(폴더 열기·최근 프로젝트)을 보여 주므로
 * 시작 화면 크기로 띄우고, 프로젝트를 열면 growToProjectSize 로 키운다.
 */
function createWindow(): Promise<WindowCtx> {
  // 새 창은 현재 창에서 조금 비켜서 띄운다
  const focused = BrowserWindow.getFocusedWindow()
  const offset = focused ? { x: focused.getBounds().x + 28, y: focused.getBounds().y + 28 } : {}
  const win = new BrowserWindow({
    ...LAUNCHER_SIZE,
    ...offset,
    minWidth: 820,
    minHeight: 560,
    title: '박프로',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  const ctx: WindowCtx = { win, workspace: null, stopWatch: null }
  const id = win.webContents.id
  windows.set(id, ctx)

  win.once('ready-to-show', () => win.show())
  win.on('focus', buildMenu)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', async () => {
    ctx.stopWatch?.()
    term.killTerminalsWithPrefix(`${id}:`)
    if (ctx.workspace) {
      // 창을 닫으면 그 작업공간에서 돌던 에이전트도 멈춘다
      for (const s of await agent.listSessions(ctx.workspace).catch(() => [])) await agent.stopSession(s.id)
    }
    windows.delete(id)
      buildMenu()
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))

  return new Promise((resolve) => win.webContents.once('did-finish-load', () => resolve(ctx)))
}

/** 메뉴 명령은 지금 앞에 있는 창으로 보낸다 */
const cmd = (command: string) => () => {
  const ctx = focusedCtx()
  if (ctx) sendTo(ctx, 'menu:command', command)
}

function buildMenu(): void {
  const recent = getSettings().recentWorkspaces
  const open = [...windows.values()].filter((c) => c.workspace)
  const current = focusedCtx()
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: '박프로',
            submenu: [
              { label: '박프로 정보', role: 'about' },
              { type: 'separator' },
              { label: '설정…', accelerator: 'CmdOrCtrl+,', click: cmd('open-settings') },
              { type: 'separator' },
              { label: '박프로 가리기', role: 'hide' },
              { label: '기타 가리기', role: 'hideOthers' },
              { label: '모두 보기', role: 'unhide' },
              { type: 'separator' },
              { label: '박프로 종료', role: 'quit' }
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
    {
      label: '파일',
      submenu: [
        { label: '새 파일…', accelerator: 'CmdOrCtrl+N', click: cmd('new-file') },
        { label: '새 창 (프로젝트 시작 화면)', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { label: '새 세션', accelerator: 'CmdOrCtrl+Alt+N', click: cmd('new-session') },
        { type: 'separator' },
        { label: '폴더 열기…', accelerator: 'CmdOrCtrl+O', click: () => pickWorkspace(focusedCtx()) },
        { label: '새 창에서 폴더 열기…', accelerator: 'CmdOrCtrl+Shift+O', click: () => pickWorkspace(undefined, { newWindow: true }) },
        {
          label: '최근 프로젝트',
          submenu: recent.length
            ? [
                ...recent.map((d) => ({ label: d, click: () => openWorkspace(d, focusedCtx()) })),
                { type: 'separator' as const },
                { label: '최근 프로젝트 지우기', click: () => (updateSettings({ recentWorkspaces: [] }), buildMenu()) }
              ]
            : [{ label: '최근 프로젝트 없음', enabled: false }]
        },
        { type: 'separator' },
        { label: '저장', accelerator: 'CmdOrCtrl+S', click: cmd('save') },
        { label: '탭 닫기', accelerator: 'CmdOrCtrl+W', click: cmd('close-tab') },
        { label: '닫은 탭 다시 열기', accelerator: 'CmdOrCtrl+Shift+T', click: cmd('reopen-tab') },
        { label: '창 닫기', accelerator: 'CmdOrCtrl+Shift+W', click: () => BrowserWindow.getFocusedWindow()?.close() },
        { type: 'separator' },
        { label: '빠른 열기', accelerator: 'CmdOrCtrl+P', click: cmd('quick-open') },
        { label: '내용 검색', accelerator: 'CmdOrCtrl+Shift+F', click: cmd('search') }
      ]
    },
    {
      label: '편집',
      submenu: [
        { label: '실행 취소', role: 'undo' },
        { label: '다시 실행', role: 'redo' },
        { type: 'separator' },
        { label: '잘라내기', role: 'cut' },
        { label: '복사', role: 'copy' },
        { label: '붙여넣기', role: 'paste' },
        { label: '모두 선택', role: 'selectAll' },
        { type: 'separator' },
        { label: '찾기…', accelerator: 'CmdOrCtrl+F', click: cmd('find') }
      ]
    },
    {
      label: '보기',
      submenu: [
        { label: '파일 모드', accelerator: 'CmdOrCtrl+1', click: cmd('mode-files') },
        { label: '에이전트 모드', accelerator: 'CmdOrCtrl+2', click: cmd('mode-agent') },
        { label: '전체 아이템', accelerator: 'CmdOrCtrl+3', click: cmd('mode-tracker') },
        { label: 'Wiki', accelerator: 'CmdOrCtrl+4', click: cmd('mode-wiki') },
        { label: '깃트리', accelerator: 'CmdOrCtrl+5', click: cmd('mode-git') },
        { type: 'separator' },
        { label: '탐색 영역 열기/닫기', accelerator: 'CmdOrCtrl+\\', click: cmd('toggle-sidebar') },
        { label: 'AI 영역 열기/닫기', accelerator: 'CmdOrCtrl+Shift+A', click: cmd('toggle-ai') },
        { label: '터미널', accelerator: 'Ctrl+`', click: cmd('toggle-terminal') },
        { label: '문서 이력', accelerator: 'CmdOrCtrl+Shift+H', click: cmd('toggle-history') },
        { label: '파일 트리 새로 고침', click: cmd('refresh-tree') },
        { type: 'separator' },
        {
          label: '테마',
          submenu: [
            // 프로젝트 창에서는 그 프로젝트의 테마를, 시작 화면에서는 기본 테마를 바꾼다
            { label: '라이트', click: cmd('theme-light') },
            { label: '다크', click: cmd('theme-dark') },
            { label: '크리스탈 다크', click: cmd('theme-crystal') }
          ]
        },
        { type: 'separator' },
        { label: '실제 크기', role: 'resetZoom' },
        { label: '확대', role: 'zoomIn' },
        { label: '축소', role: 'zoomOut' },
        { label: '전체 화면', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: '새로 고침', role: 'reload' },
        { label: '개발자 도구', role: 'toggleDevTools' }
      ]
    },
    {
      label: '에이전트',
      submenu: [
        { label: '현재 작업 승인', accelerator: 'CmdOrCtrl+Enter', click: cmd('approve') },
        { label: '현재 작업 거부', accelerator: 'CmdOrCtrl+Shift+Backspace', click: cmd('reject') },
        { label: '실행 중지', accelerator: 'CmdOrCtrl+.', click: cmd('stop-agent') }
      ]
    },
    {
      label: '윈도우',
      submenu: [
        { label: '최소화', role: 'minimize' },
        { label: '확대/축소', role: 'zoom' },
        { type: 'separator' },
        { label: '열린 프로젝트', enabled: false },
        ...(open.length
          ? open.map((c, i) => ({
              label: path.basename(c.workspace!),
              type: 'checkbox' as const,
              checked: c === current,
              accelerator: i < 9 ? `CmdOrCtrl+Alt+${i + 1}` : undefined,
              click: () => (c.win.show(), c.win.focus())
            }))
          : [{ label: '없음', enabled: false }]),
        { type: 'separator' },
        { label: '모두 앞으로 가져오기', role: 'front' }
      ]
    },
    {
      label: '도움말',
      submenu: [
        { label: '키보드 단축키', accelerator: 'CmdOrCtrl+/', click: cmd('shortcuts') },
        { label: '환영 문서 열기', click: cmd('welcome') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}


/** 모든 핸들러는 호출한 창의 상태(ctx)를 첫 인자로 받는다 */
function handle(channel: string, fn: (ctx: WindowCtx, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (e, ...args) => fn(ctxOf(e), ...args))
}

/** 에이전트가 끝났거나 승인이 필요할 때 소리와 OS 알림을 낸다 (설정 → 알림) */
function registerNotifications(): void {
  const showOs = (ctx: WindowCtx | undefined, title: string, body: string, sessionId?: string): void => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent: true })
    n.on('click', () => {
      if (!ctx || ctx.win.isDestroyed()) return
      ctx.win.show()
      ctx.win.focus()
      if (sessionId) sendTo(ctx, 'agent:focus-session', sessionId)
    })
    n.show()
  }
  agent.setAgentNotifier((n) => {
    const s = getSettings()
    const ctx = [...windows.values()].find((c) => c.workspace && path.resolve(c.workspace) === path.resolve(n.workspace))
    const focused = !!ctx && ctx.win.isFocused()
    const allowOs = !focused || s.osNotifyWhenFocused
    if (n.kind === 'done') {
      if (s.soundEnabled && ctx) sendTo(ctx, 'notify:sound')
      if (s.osNotify && allowOs) {
        showOs(ctx, n.ok ? '에이전트 작업 완료' : '에이전트 작업 실패', n.ok ? n.title : `${n.title}\n${(n.error ?? '').slice(0, 120)}`, n.sessionId)
      }
    } else if (s.notifyBlocked && allowOs) {
      showOs(ctx, '승인이 필요합니다', `${n.title} — ${n.toolName}`, n.sessionId)
    }
  })

  handle('notify:test', () => showOs(focusedCtx(), '박프로 테스트 알림', '알림이 정상적으로 표시됩니다.'))
  handle('notify:open-system-settings', () => system.openSystemNotificationSettings())
  handle('notify:pick-sound', async (ctx) => {
    const r = await dialog.showOpenDialog(ctx.win, {
      title: '알림 소리 파일 선택',
      filters: [{ name: '오디오', extensions: ['mp3', 'wav', 'aiff', 'm4a', 'ogg'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    updateSettings({ customSoundPath: r.filePaths[0], soundType: 'custom' })
    broadcast('settings:changed', getSettings())
    return r.filePaths[0]
  })
  handle('notify:read-sound', async () => {
    const p = getSettings().customSoundPath
    if (!p) return null
    const ext = path.extname(p).slice(1).toLowerCase()
    const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' ? 'audio/mp4' : ext === 'ogg' ? 'audio/ogg' : ext === 'aiff' ? 'audio/aiff' : 'audio/wav'
    const data = await fsp.readFile(p).catch(() => null)
    return data ? `data:${mime};base64,${data.toString('base64')}` : null
  })
}

function registerSystem(): void {
  handle('keys:status', () => system.keyStatus())
  handle('keys:set', (_ctx, name: system.KeyName, value: string) => system.setKey(name, value))
  handle('keys:delete', (_ctx, name: system.KeyName) => system.deleteKey(name))
  handle('providers:status', (_ctx, id: string) => system.providerStatus(id, id === 'claude' ? agent.findClaude() : undefined))
  handle('system:plugins', () => system.claudePlugins())
  handle('system:mcp', (ctx) => system.mcpServers(ctx.workspace))
  handle('system:storage', () => system.storageInfo())
  handle('system:open-data-folder', () => shell.openPath(app.getPath('userData')))
  handle('system:clear-history', async (ctx) => {
    const r = await dialog.showMessageBox(ctx.win, {
      type: 'warning',
      buttons: ['모두 지우기', '취소'],
      defaultId: 1,
      cancelId: 1,
      message: '모든 문서 이력(스냅샷)을 지울까요?',
      detail: '문서 파일 자체는 지워지지 않지만, 이전 버전으로 되돌릴 수 없게 됩니다.'
    })
    if (r.response !== 0) return false
    await system.clearHistory()
    return true
  })
  handle('settings:reset', async (ctx) => {
    const r = await dialog.showMessageBox(ctx.win, {
      type: 'warning',
      buttons: ['초기화', '취소'],
      defaultId: 1,
      cancelId: 1,
      message: '애플리케이션 설정을 기본값으로 되돌릴까요?',
      detail: '최근 프로젝트 목록과 저장된 API 키는 유지됩니다.'
    })
    if (r.response !== 0) return false
    broadcast('settings:changed', resetSettings())
    return true
  })
}

function registerIpc(): void {
  registerNotifications()
  registerSystem()
  // 병렬 작업 이벤트는 그 작업공간을 연 창(들)로만 보낸다
  jobs.setEmitter((workspace, channel, payload) => {
    for (const c of windows.values()) {
      if (c.workspace && path.resolve(c.workspace) === path.resolve(workspace)) sendTo(c, channel, payload)
    }
  })
  handle('jobs:list', (ctx) => jobs.listJobs(requireWorkspace(ctx)))
  handle('jobs:preflight', (ctx) => jobs.preflight(requireWorkspace(ctx)))
  handle('jobs:start', (ctx, itemIds: string[], opts?: { model?: string }) => jobs.startJobs(requireWorkspace(ctx), itemIds, opts))
  handle('jobs:stop', (ctx, id: string) => jobs.stopJob(requireWorkspace(ctx), id))
  handle('jobs:resume', (ctx, id: string, message?: string) => jobs.resumeJob(requireWorkspace(ctx), id, message))
  handle('jobs:diff', (ctx, id: string) => jobs.jobDiff(requireWorkspace(ctx), id))
  handle('jobs:merge', (ctx, id: string) => jobs.mergeJob(requireWorkspace(ctx), id))
  handle('jobs:rebase', (ctx, id: string) => jobs.rebaseJob(requireWorkspace(ctx), id))
  handle('jobs:discard', async (ctx, id: string) => {
    const r = await dialog.showMessageBox(ctx.win, {
      type: 'warning',
      buttons: ['버리기', '취소'],
      defaultId: 1,
      cancelId: 1,
      message: '이 병렬 작업을 버릴까요?',
      detail: 'worktree 폴더와 브랜치가 삭제되고, 트래커 항목은 "할 일" 로 돌아갑니다. 되돌릴 수 없습니다.'
    })
    if (r.response !== 0) return false
    await jobs.discardJob(requireWorkspace(ctx), id)
    return true
  })
  handle('jobs:clear-finished', (ctx) => jobs.clearFinished(requireWorkspace(ctx)))

  handle('settings:get', () => getSettings())
  handle('settings:update', (_ctx, patch: Partial<AppSettings>) => {
    const s = updateSettings(patch)
    broadcast('settings:changed', s)
    return s
  })

  handle('workspace:pick', (ctx) => pickWorkspace(ctx))
  handle('workspace:pick-new-window', (ctx) => pickWorkspace(ctx, { newWindow: true }))
  handle('workspace:open', (ctx, dir: string) => openWorkspace(dir, ctx).then(() => dir))
  handle('workspace:open-in-new-window', (_ctx, dir: string) => openWorkspace(dir).then(() => dir))
  handle('workspace:new-window', () => createWindow().then(() => undefined))
  handle('workspace:list-open', (ctx) =>
    [...windows.values()]
      .filter((c) => c.workspace)
      .map((c) => ({ workspace: c.workspace!, current: c === ctx, windowId: c.win.webContents.id }))
  )
  handle('workspace:focus', (_ctx, windowId: number) => {
    const c = windows.get(windowId)
    c?.win.show()
    c?.win.focus()
  })
  handle('workspace:current', (ctx) => ctx.workspace)
  // 프로젝트 모양의 '텍스트 크기' : 창 전체 확대 배율
  handle('window:zoom', (ctx, factor: number) => ctx.win.webContents.setZoomFactor(Math.min(1.5, Math.max(0.8, Number(factor) || 1))))

  handle('git:info', (ctx) => gitv.gitInfo(requireWorkspace(ctx)))
  handle('git:changes', (ctx) => gitv.gitChanges(requireWorkspace(ctx)))
  handle('git:diff', (ctx, file: string) => gitv.gitFileDiff(requireWorkspace(ctx), file))
  handle('git:log', (ctx, limit?: number) => gitv.gitLog(requireWorkspace(ctx), limit))
  handle('git:show', (ctx, hash: string) => gitv.gitShow(requireWorkspace(ctx), hash))
  handle('git:commit', (ctx, files: string[], message: string) => gitv.gitCommit(requireWorkspace(ctx), files, message))
  handle('git:branches', (ctx) => gitv.gitBranches(requireWorkspace(ctx)))
  handle('git:switch', (ctx, branch: string) => gitv.gitSwitch(requireWorkspace(ctx), branch))
  handle('git:discard', async (ctx, file: string) => {
    const r = await dialog.showMessageBox(ctx.win, {
      type: 'warning',
      buttons: ['변경 버리기', '취소'],
      defaultId: 1,
      cancelId: 1,
      message: `'${path.basename(file)}' 의 변경을 버릴까요?`,
      detail: '마지막 커밋 상태로 되돌립니다. 새 파일이면 삭제됩니다. 되돌릴 수 없습니다.'
    })
    if (r.response !== 0) return false
    await gitv.gitDiscard(requireWorkspace(ctx), file)
    return true
  })

  // 왼쪽 레일의 사용률 · 계정
  usage.onUsageChanged((u) => broadcast('usage:updated', u))
  handle('usage:get', () => usage.getUsage())
  handle('usage:refresh', () => usage.refreshUsage(agent.findClaude(), agent.shellEnv()))

  // 프로젝트 설정 · 기능
  const toWorkspaceWindows = (workspace: string, channel: string, payload: unknown): void => {
    for (const c of windows.values()) {
      if (c.workspace && path.resolve(c.workspace) === path.resolve(workspace)) sendTo(c, channel, payload)
    }
  }
  handle('project:get', (ctx) => project.getProject(requireWorkspace(ctx)))
  handle('project:update', async (ctx, patch: Partial<project.ProjectSettings>) => {
    const ws = requireWorkspace(ctx)
    const next = await project.updateProject(ws, patch)
    toWorkspaceWindows(ws, 'project:changed', next)
    return next
  })
  handle('project:git-init', (ctx) => project.gitInit(requireWorkspace(ctx)))
  handle('project:claude-md', (ctx) => project.ensureClaudeMd(requireWorkspace(ctx)))
  handle('project:ignore-local', (ctx) => project.ignoreLocalFolder(requireWorkspace(ctx)))
  handle('project:mcp-file', (ctx) => project.ensureMcpFile(requireWorkspace(ctx)))
  handle('project:remote', (ctx) => project.remoteInfo(requireWorkspace(ctx)))
  // GitHub 페이지만 브라우저로 연다
  handle('project:open-github', (_ctx, url: string) => {
    if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/(issues|pulls|actions))?$/.test(url)) shell.openExternal(url)
  })
  handle('project:info', async (ctx) => {
    const ws = requireWorkspace(ctx)
    return {
      path: ws,
      name: path.basename(ws),
      isRepo: await gitv.isGitRepo(ws),
      hasClaudeMd: await fsp.access(path.join(ws, 'CLAUDE.md')).then(() => true, () => false)
    }
  })

  // 로컬 위키
  handle('wiki:list', (ctx) => wiki.listPages(requireWorkspace(ctx)))
  handle('wiki:ensure', (ctx) => wiki.ensureWiki(requireWorkspace(ctx), path.basename(requireWorkspace(ctx))))
  handle('wiki:create', (ctx, title: string) => wiki.createPage(requireWorkspace(ctx), title))

  // 프로젝트 시작 화면
  handle('projects:list', () => projects.listProjects())
  handle('projects:remove', (_ctx, dir: string) => {
    removeRecentWorkspace(dir)
    buildMenu()
  })
  handle('projects:reveal', (_ctx, dir: string) => shell.showItemInFolder(dir))
  handle('projects:new-folder', async (ctx) => {
    const r = await dialog.showSaveDialog(ctx.win, {
      title: '새 프로젝트 폴더 만들기',
      buttonLabel: '만들기',
      nameFieldLabel: '폴더 이름',
      defaultPath: path.join(app.getPath('documents'), '새 프로젝트'),
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (r.canceled || !r.filePath) return null
    await fsp.mkdir(r.filePath, { recursive: true })
    await openWorkspace(r.filePath, ctx)
    return r.filePath
  })
  handle('projects:tutorial', async (ctx) => {
    const dir = await projects.ensureTutorial()
    await openWorkspace(dir, ctx)
    return dir
  })
  handle('workspace:tree', (ctx) => ws.readTree(requireWorkspace(ctx)))
  handle('workspace:all-files', (ctx) => ws.listAllFiles(requireWorkspace(ctx)))
  handle('workspace:search', (ctx, q: string) => ws.search(requireWorkspace(ctx), q))

  const inside = (ctx: WindowCtx, p: string): string => ws.assertInside(requireWorkspace(ctx), p)

  handle('fs:read', (ctx, p: string) => ws.readFile(inside(ctx, p)))
  handle('fs:write', async (ctx, p: string, content: string, snapshot?: 'manual' | 'auto' | 'restore') => {
    const abs = inside(ctx, p)
    await ws.writeFile(abs, content)
    if (snapshot) await history.saveSnapshot(abs, content, snapshot)
  })
  handle('fs:create-file', (ctx, p: string, content?: string) => ws.createFile(inside(ctx, p), content))
  handle('fs:create-dir', (ctx, p: string) => ws.createDir(inside(ctx, p)))
  handle('fs:rename', (ctx, from: string, to: string) => ws.rename(inside(ctx, from), inside(ctx, to)))
  handle('fs:delete', async (ctx, p: string) => {
    const r = await dialog.showMessageBox(ctx.win, {
      type: 'warning',
      buttons: ['삭제', '취소'],
      defaultId: 1,
      cancelId: 1,
      message: `'${path.basename(p)}' 을(를) 삭제할까요?`,
      detail: '이 작업은 되돌릴 수 없습니다.'
    })
    if (r.response !== 0) return false
    await ws.remove(inside(ctx, p))
    return true
  })
  handle('fs:reveal', (ctx, p: string) => shell.showItemInFolder(inside(ctx, p)))

  handle('history:list', (ctx, p: string) => history.listSnapshots(inside(ctx, p)))
  handle('history:read', (ctx, p: string, id: string) => history.readSnapshot(inside(ctx, p), id))
  handle('history:save', (ctx, p: string, content: string, kind: history.SnapshotKind) =>
    history.saveSnapshot(inside(ctx, p), content, kind)
  )

  handle('tracker:list', (ctx) => tracker.listItems(requireWorkspace(ctx)))
  handle('tracker:save', (ctx, item: tracker.TrackerItem) => tracker.saveItem(requireWorkspace(ctx), item))
  handle('tracker:delete', (ctx, id: string) => tracker.deleteItem(requireWorkspace(ctx), id))

  // 터미널 아이디는 창마다 겹칠 수 있으므로 내부에서는 "창아이디:터미널아이디" 로 구분한다
  const termId = (ctx: WindowCtx, id: string): string => `${ctx.win.webContents.id}:${id}`
  handle('terminal:create', (ctx, id: string) =>
    term.createTerminal(
      termId(ctx, id),
      ctx.workspace ?? '',
      (data) => sendTo(ctx, 'terminal:data', id, data),
      () => sendTo(ctx, 'terminal:exit', id)
    )
  )
  handle('terminal:write', (ctx, id: string, data: string) => term.writeTerminal(termId(ctx, id), data))
  handle('terminal:resize', (ctx, id: string, cols: number, rows: number) =>
    term.resizeTerminal(termId(ctx, id), cols, rows)
  )
  handle('terminal:kill', (ctx, id: string) => term.killTerminal(termId(ctx, id)))

  handle('agent:list', (ctx) => agent.listSessions(requireWorkspace(ctx)))
  handle('agent:create', (ctx, title?: string) => agent.createSession(requireWorkspace(ctx), title))
  handle('agent:rename', (ctx, id: string, title: string) => agent.renameSession(requireWorkspace(ctx), id, title))
  handle('agent:delete', (ctx, id: string) => agent.deleteSession(requireWorkspace(ctx), id))
  handle('agent:running', (_ctx, id: string) => agent.isRunning(id))
  handle('agent:stop', (_ctx, id: string) => agent.stopSession(id))
  handle('agent:permission', (_ctx, requestId: string, allow: boolean) => agent.answerPermission(requestId, allow))
  handle('agent:send', (ctx, id: string, text: string, opts?: { model?: string; permissionMode?: string }) => {
    // 응답은 이 창으로만 이벤트로 흘려보내고, 호출 자체는 바로 돌려준다
    const emit = (e: agent.AgentEvent): void => sendTo(ctx, 'agent:event', e)
    agent.sendMessage(requireWorkspace(ctx), id, text, emit, opts).catch((err) =>
      emit({
        type: 'item',
        sessionId: id,
        item: { kind: 'error', id: String(Date.now()), text: String(err?.message ?? err), time: Date.now() }
      })
    )
  })
}

registerLocalFileScheme()
app.whenReady().then(async () => {
  handleLocalFile()
  registerIpc()
  buildMenu()
  // 앱은 항상 프로젝트 시작 화면(폴더 열기 · 새 폴더 · 최근 프로젝트)에서 시작한다
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  term.killAllTerminals()
  if (process.platform !== 'darwin') app.quit()
})
