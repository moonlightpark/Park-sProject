import type { IPty } from 'node-pty'
import os from 'os'

const terms = new Map<string, IPty>()

export function createTerminal(
  id: string,
  cwd: string,
  onData: (data: string) => void,
  onExit: () => void
): void {
  // node-pty 는 네이티브 모듈이라 필요할 때만 불러온다
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pty = require('node-pty') as typeof import('node-pty')
  const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh'
  const term = pty.spawn(shell, process.platform === 'win32' ? [] : ['-l'], {
    name: 'xterm-256color',
    cols: 100,
    rows: 24,
    cwd: cwd || os.homedir(),
    env: { ...process.env, LANG: process.env.LANG || 'ko_KR.UTF-8' } as Record<string, string>
  })
  term.onData(onData)
  term.onExit(() => {
    terms.delete(id)
    onExit()
  })
  terms.set(id, term)
}

export function writeTerminal(id: string, data: string): void {
  terms.get(id)?.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  if (cols > 0 && rows > 0) terms.get(id)?.resize(cols, rows)
}

export function killTerminal(id: string): void {
  terms.get(id)?.kill()
  terms.delete(id)
}

/** 창이 닫히면 그 창의 터미널(아이디가 prefix 로 시작)만 정리한다 */
export function killTerminalsWithPrefix(prefix: string): void {
  for (const [id, t] of terms) {
    if (id.startsWith(prefix)) {
      t.kill()
      terms.delete(id)
    }
  }
}

export function killAllTerminals(): void {
  for (const t of terms.values()) t.kill()
  terms.clear()
}
