import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

const invoke = (channel: string, ...args: unknown[]): Promise<any> => ipcRenderer.invoke(channel, ...args)

function on(channel: string, cb: (...args: any[]) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  settings: {
    get: () => invoke('settings:get'),
    update: (patch: unknown) => invoke('settings:update', patch),
    onChanged: (cb: (s: any) => void) => on('settings:changed', cb)
  },
  workspace: {
    pick: () => invoke('workspace:pick'),
    pickNewWindow: () => invoke('workspace:pick-new-window'),
    open: (dir: string) => invoke('workspace:open', dir),
    openInNewWindow: (dir: string) => invoke('workspace:open-in-new-window', dir),
    newWindow: () => invoke('workspace:new-window'),
    listOpen: (): Promise<{ workspace: string; current: boolean; windowId: number }[]> => invoke('workspace:list-open'),
    focus: (windowId: number) => invoke('workspace:focus', windowId),
    current: () => invoke('workspace:current'),
    tree: () => invoke('workspace:tree'),
    allFiles: () => invoke('workspace:all-files'),
    search: (q: string) => invoke('workspace:search', q),
    onOpened: (cb: (dir: string) => void) => on('workspace:opened', cb),
    onTreeChanged: (cb: () => void) => on('workspace:tree-changed', cb),
    onFileChanged: (cb: (p: string) => void) => on('workspace:file-changed', cb)
  },
  fs: {
    read: (p: string) => invoke('fs:read', p),
    readBinary: (p: string): Promise<Uint8Array> => invoke('fs:read-binary', p),
    writeBinary: (p: string, data: Uint8Array) => invoke('fs:write-binary', p, data),
    write: (p: string, content: string, snapshot?: string) => invoke('fs:write', p, content, snapshot),
    createFile: (p: string, content?: string) => invoke('fs:create-file', p, content),
    createDir: (p: string) => invoke('fs:create-dir', p),
    rename: (from: string, to: string) => invoke('fs:rename', from, to),
    delete: (p: string) => invoke('fs:delete', p),
    reveal: (p: string) => invoke('fs:reveal', p),
    openDefault: (p: string) => invoke('fs:open-default', p)
  },
  history: {
    list: (p: string) => invoke('history:list', p),
    read: (p: string, id: string) => invoke('history:read', p, id),
    save: (p: string, content: string, kind: string) => invoke('history:save', p, content, kind)
  },
  tracker: {
    list: () => invoke('tracker:list'),
    save: (item: unknown) => invoke('tracker:save', item),
    delete: (id: string) => invoke('tracker:delete', id)
  },
  terminal: {
    create: (id: string) => invoke('terminal:create', id),
    write: (id: string, data: string) => invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => invoke('terminal:resize', id, cols, rows),
    kill: (id: string) => invoke('terminal:kill', id),
    onData: (cb: (id: string, data: string) => void) => on('terminal:data', cb),
    onExit: (cb: (id: string) => void) => on('terminal:exit', cb)
  },
  agent: {
    list: () => invoke('agent:list'),
    create: (title?: string) => invoke('agent:create', title),
    rename: (id: string, title: string) => invoke('agent:rename', id, title),
    delete: (id: string) => invoke('agent:delete', id),
    running: (id: string) => invoke('agent:running', id),
    stop: (id: string) => invoke('agent:stop', id),
    permission: (requestId: string, allow: boolean) => invoke('agent:permission', requestId, allow),
    send: (id: string, text: string, opts?: unknown) => invoke('agent:send', id, text, opts),
    onEvent: (cb: (e: any) => void) => on('agent:event', cb)
  },
  git: {
    info: () => invoke('git:info'),
    changes: () => invoke('git:changes'),
    diff: (file: string) => invoke('git:diff', file),
    log: (limit?: number) => invoke('git:log', limit),
    show: (hash: string) => invoke('git:show', hash),
    commit: (files: string[], message: string) => invoke('git:commit', files, message),
    branches: () => invoke('git:branches'),
    switchBranch: (branch: string) => invoke('git:switch', branch),
    discard: (file: string) => invoke('git:discard', file)
  },
  usage: {
    get: () => invoke('usage:get'),
    refresh: () => invoke('usage:refresh'),
    onUpdated: (cb: (u: any) => void) => on('usage:updated', cb)
  },
  notify: {
    test: () => invoke('notify:test'),
    openSystemSettings: () => invoke('notify:open-system-settings'),
    pickSound: () => invoke('notify:pick-sound'),
    readSound: () => invoke('notify:read-sound'),
    onSound: (cb: () => void) => on('notify:sound', cb)
  },
  system: {
    keyStatus: () => invoke('keys:status'),
    setKey: (name: string, value: string) => invoke('keys:set', name, value),
    deleteKey: (name: string) => invoke('keys:delete', name),
    provider: (id: string) => invoke('providers:status', id),
    plugins: () => invoke('system:plugins'),
    mcp: () => invoke('system:mcp'),
    storage: () => invoke('system:storage'),
    openDataFolder: () => invoke('system:open-data-folder'),
    clearHistory: () => invoke('system:clear-history'),
    resetSettings: () => invoke('settings:reset')
  },
  setZoom: (factor: number) => invoke('window:zoom', factor),
  setTitleBarOverlay: (o: { color: string; symbolColor: string; height: number }) => invoke('window:overlay', o),
  capture: (r: { x: number; y: number; width: number; height: number }) => invoke('window:capture', r),
  hwpServer: (): Promise<{ origin: string; token: string }> => invoke('hwp:server'),
  legacyPreview: (p: string): Promise<{ html: string; sheets: { name: string; html: string }[] }> => invoke('office:legacy-preview', p),
  onFocusSession: (cb: (sessionId: string) => void) => on('agent:focus-session', cb),
  project: {
    get: () => invoke('project:get'),
    update: (patch: unknown) => invoke('project:update', patch),
    info: () => invoke('project:info'),
    gitInit: () => invoke('project:git-init'),
    claudeMd: () => invoke('project:claude-md'),
    ignoreLocal: () => invoke('project:ignore-local'),
    mcpFile: () => invoke('project:mcp-file'),
    remote: () => invoke('project:remote'),
    openGithub: (url: string) => invoke('project:open-github', url),
    onChanged: (cb: (p: any) => void) => on('project:changed', cb)
  },
  wiki: {
    list: () => invoke('wiki:list'),
    ensure: () => invoke('wiki:ensure'),
    create: (title: string) => invoke('wiki:create', title)
  },
  projects: {
    list: () => invoke('projects:list'),
    remove: (dir: string) => invoke('projects:remove', dir),
    reveal: (dir: string) => invoke('projects:reveal', dir),
    newFolder: () => invoke('projects:new-folder'),
    tutorial: () => invoke('projects:tutorial')
  },
  jobs: {
    list: () => invoke('jobs:list'),
    preflight: () => invoke('jobs:preflight'),
    start: (itemIds: string[], opts?: { model?: string }) => invoke('jobs:start', itemIds, opts),
    stop: (id: string) => invoke('jobs:stop', id),
    resume: (id: string, message?: string) => invoke('jobs:resume', id, message),
    diff: (id: string) => invoke('jobs:diff', id),
    merge: (id: string) => invoke('jobs:merge', id),
    rebase: (id: string) => invoke('jobs:rebase', id),
    discard: (id: string) => invoke('jobs:discard', id),
    clearFinished: () => invoke('jobs:clear-finished'),
    onUpdated: (cb: (job: any) => void) => on('jobs:updated', cb)
  },
  onMenu: (cb: (command: string) => void) => on('menu:command', cb),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
