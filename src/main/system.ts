import { app, safeStorage, shell } from 'electron'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import { findBinary } from './bin'

/* ---------------- 저장된 API 키 (macOS 키체인으로 암호화) ---------------- */

export type KeyName = 'anthropic' | 'openai' | 'gemini'
const keysFile = (): string => path.join(app.getPath('userData'), 'keys.json')

async function readKeys(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(keysFile(), 'utf8'))
  } catch {
    return {}
  }
}

export async function keyStatus(): Promise<Record<KeyName, { set: boolean; preview: string }>> {
  const raw = await readKeys()
  const out = {} as Record<KeyName, { set: boolean; preview: string }>
  for (const k of ['anthropic', 'openai', 'gemini'] as KeyName[]) {
    const v = raw[k] ? decrypt(raw[k]) : ''
    out[k] = { set: !!v, preview: v ? `${v.slice(0, 7)}…${v.slice(-4)}` : '' }
  }
  return out
}

function decrypt(b64: string): string {
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch {
    return ''
  }
}

export async function setKey(name: KeyName, value: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('이 컴퓨터에서는 키를 암호화해 저장할 수 없습니다.')
  const v = value.trim()
  if (!v) throw new Error('키를 입력하세요.')
  const raw = await readKeys()
  raw[name] = safeStorage.encryptString(v).toString('base64')
  await fs.writeFile(keysFile(), JSON.stringify(raw), { encoding: 'utf8', mode: 0o600 })
}

export async function deleteKey(name: KeyName): Promise<void> {
  const raw = await readKeys()
  delete raw[name]
  await fs.writeFile(keysFile(), JSON.stringify(raw), { encoding: 'utf8', mode: 0o600 })
}

/** 에이전트 실행 시 환경 변수로 넘길 Anthropic 키 */
export async function getAnthropicKey(): Promise<string> {
  const raw = await readKeys()
  return raw.anthropic ? decrypt(raw.anthropic) : ''
}

/* ---------------- 에이전트 CLI 감지 ---------------- */

export interface ProviderStatus {
  id: string
  installed: boolean
  path: string | null
  version: string | null
}

const BINARIES: Record<string, string[]> = {
  claude: ['claude'],
  codex: ['codex'],
  opencode: ['opencode'],
  copilot: ['copilot', 'github-copilot-cli'],
  grok: ['grok'],
  cursor: ['cursor-agent'],
  gemini: ['gemini'],
  gh: ['gh']
}

function version(bin: string): Promise<string | null> {
  return new Promise((resolve) =>
    execFile(bin, ['--version'], { timeout: 4000 }, (err, stdout) => resolve(err ? null : stdout.trim().split('\n')[0].slice(0, 80)))
  )
}

export async function providerStatus(id: string, overridePath?: string): Promise<ProviderStatus> {
  const found = overridePath ? (existsSync(overridePath) ? overridePath : null) : findBinary(BINARIES[id] ?? [])
  return { id, installed: !!found, path: found, version: found ? await version(found) : null }
}

/* ---------------- Claude Code 플러그인 · MCP 서버 (읽기 전용) ---------------- */

export interface PluginEntry {
  id: string
  scope: string
  version: string
  installedAt: string
}

export async function claudePlugins(): Promise<PluginEntry[]> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(os.homedir(), '.claude/plugins/installed_plugins.json'), 'utf8'))
    const plugins = raw.plugins ?? {}
    return Object.entries(plugins).flatMap(([id, list]) =>
      (Array.isArray(list) ? list : [list]).map((e: any) => ({
        id,
        scope: String(e?.scope ?? ''),
        version: String(e?.version ?? ''),
        installedAt: String(e?.installedAt ?? '')
      }))
    )
  } catch {
    return []
  }
}

export interface McpEntry {
  name: string
  scope: '사용자' | '프로젝트(로컬)' | '프로젝트(.mcp.json)'
  kind: string
  /** 실행 명령 또는 URL. 환경 변수·헤더 값은 비밀일 수 있으므로 보여 주지 않는다 */
  target: string
}

function describe(cfg: any): { kind: string; target: string } {
  if (cfg?.url) return { kind: cfg.type ?? 'http', target: String(cfg.url) }
  return { kind: cfg?.type ?? 'stdio', target: [cfg?.command, ...(Array.isArray(cfg?.args) ? cfg.args : [])].filter(Boolean).join(' ') }
}

export async function mcpServers(workspace: string | null): Promise<McpEntry[]> {
  const out: McpEntry[] = []
  try {
    const user = JSON.parse(await fs.readFile(path.join(os.homedir(), '.claude.json'), 'utf8'))
    for (const [name, cfg] of Object.entries(user.mcpServers ?? {})) out.push({ name, scope: '사용자', ...describe(cfg) })
    if (workspace) {
      const proj = user.projects?.[path.resolve(workspace)]
      for (const [name, cfg] of Object.entries(proj?.mcpServers ?? {})) out.push({ name, scope: '프로젝트(로컬)', ...describe(cfg) })
    }
  } catch {
    /* 설정 파일 없음 */
  }
  if (workspace) {
    try {
      const proj = JSON.parse(await fs.readFile(path.join(workspace, '.mcp.json'), 'utf8'))
      for (const [name, cfg] of Object.entries(proj.mcpServers ?? {})) out.push({ name, scope: '프로젝트(.mcp.json)', ...describe(cfg) })
    } catch {
      /* 없음 */
    }
  }
  return out
}

/* ---------------- 저장 공간 ---------------- */

async function sizeOf(p: string): Promise<number> {
  try {
    const st = await fs.stat(p)
    if (!st.isDirectory()) return st.size
    let total = 0
    for (const e of await fs.readdir(p)) total += await sizeOf(path.join(p, e))
    return total
  } catch {
    return 0
  }
}

export async function storageInfo(): Promise<{ root: string; items: { key: string; path: string; bytes: number }[] }> {
  const root = app.getPath('userData')
  const items = [
    ['sessions', 'sessions'],
    ['history', 'history'],
    ['jobs', 'jobs'],
    ['settings', 'settings.json'],
    ['usage', 'usage.json'],
    ['keys', 'keys.json']
  ]
  return {
    root,
    items: await Promise.all(items.map(async ([key, rel]) => ({ key, path: path.join(root, rel), bytes: await sizeOf(path.join(root, rel)) })))
  }
}

export async function clearHistory(): Promise<void> {
  await fs.rm(path.join(app.getPath('userData'), 'history'), { recursive: true, force: true })
}

export function openSystemNotificationSettings(): void {
  if (process.platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension')
  else if (process.platform === 'win32') shell.openExternal('ms-settings:notifications')
}
