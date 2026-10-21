import { app } from 'electron'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import os from 'os'

/**
 * 왼쪽 레일의 사용률 표시. Claude 는 에이전트 SDK 가 대화마다 보내는 rate_limit_event 의
 * 5시간·7일 사용률을 기록한다 (키체인 자격 증명을 읽지 않는다).
 */

export interface UsageWindow {
  /** 0~100 (%) */
  utilization: number
  /** ms */
  resetsAt: number | null
}

export interface UsageState {
  claude: { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null; updatedAt: number } | null
  account: { email?: string; organization?: string; subscriptionType?: string; apiProvider?: string } | null
  codexInstalled: boolean
  geminiInstalled: boolean
}

let state: UsageState = { claude: null, account: null, codexInstalled: false, geminiInstalled: false }
let listener: (s: UsageState) => void = () => undefined
let loaded = false

const file = (): string => path.join(app.getPath('userData'), 'usage.json')

function cliInstalled(name: string): boolean {
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin'), ...(process.env.PATH ?? '').split(':')]
  return dirs.some((d) => d && existsSync(path.join(d, name)))
}

export function onUsageChanged(fn: (s: UsageState) => void): void {
  listener = fn
}

export async function getUsage(): Promise<UsageState> {
  if (!loaded) {
    loaded = true
    try {
      const saved = JSON.parse(await fs.readFile(file(), 'utf8'))
      state = { ...state, claude: saved.claude ?? null, account: saved.account ?? null }
    } catch {
      /* 처음 실행 */
    }
    state.codexInstalled = cliInstalled('codex')
    state.geminiInstalled = cliInstalled('gemini')
  }
  return state
}

function changed(): void {
  listener(state)
  fs.writeFile(file(), JSON.stringify({ claude: state.claude, account: state.account }), 'utf8').catch(() => undefined)
}

const toWindow = (w: { utilization?: number; resetsAt?: number } | undefined): UsageWindow | null =>
  w && typeof w.utilization === 'number'
    ? { utilization: Math.round(w.utilization * 1000) / 10, resetsAt: w.resetsAt ? w.resetsAt * 1000 : null }
    : null

/** SDK 의 rate_limit_info. utilization 은 0~1 비율이다 */
export function recordRateLimit(info: any): void {
  if (!info) return
  const windows = info.unifiedWindows as Record<string, { utilization?: number; resetsAt?: number }> | undefined
  const prev = state.claude
  let fiveHour = prev?.fiveHour ?? null
  let sevenDay = prev?.sevenDay ?? null
  if (windows) {
    fiveHour = toWindow(windows.five_hour) ?? fiveHour
    sevenDay = toWindow(windows.seven_day) ?? sevenDay
  } else if (typeof info.utilization === 'number') {
    if (info.rateLimitType === 'five_hour') fiveHour = toWindow(info)
    if (info.rateLimitType === 'seven_day') sevenDay = toWindow(info)
  }
  state = { ...state, claude: { fiveHour, sevenDay, updatedAt: Date.now() } }
  changed()
}

export function recordAccount(info: any): void {
  if (!info) return
  state = {
    ...state,
    account: { email: info.email, organization: info.organization, subscriptionType: info.subscriptionType, apiProvider: info.apiProvider }
  }
  changed()
}

/**
 * 사용률을 지금 다시 가져온다. 아주 짧은 질의를 하나 보내 rate_limit_event 와 계정 정보를 받는다.
 * (가장 작은 모델로 한 번 응답받으므로 비용은 아주 적다)
 */
export async function refreshUsage(claudePath: string | undefined, env: Record<string, string>): Promise<UsageState> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const cwd = path.join(app.getPath('userData'), 'usage-probe')
  await fs.mkdir(cwd, { recursive: true })
  const q = query({
    prompt: '"확인" 한 단어로만 답하세요.',
    options: {
      cwd,
      model: 'claude-haiku-5-5',
      permissionMode: 'plan',
      maxTurns: 1,
      tools: [],
      settingSources: [],
      pathToClaudeCodeExecutable: claudePath,
      env
    } as never
  })
  q.accountInfo()
    .then(recordAccount)
    .catch(() => undefined)
  for await (const m of q as AsyncIterable<any>) {
    if (m.type === 'rate_limit_event') recordRateLimit(m.rate_limit_info)
  }
  return state
}
