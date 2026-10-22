import { existsSync } from 'fs'
import path from 'path'
import os from 'os'

const isWin = process.platform === 'win32'

/**
 * 실행 파일을 찾을 폴더들. GUI 로 실행된 앱은 셸의 PATH 를 다 물려받지 못하므로
 * 흔한 설치 위치를 앞에 보충한다.
 */
export function binDirs(): string[] {
  const home = os.homedir()
  const common = isWin
    ? [
        path.join(home, '.local', 'bin'),
        process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : '',
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : '',
        path.join(home, 'scoop', 'shims')
      ]
    : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), path.join(home, '.bun/bin')]
  return [...common, ...(process.env.PATH ?? '').split(path.delimiter)].filter(Boolean)
}

/** Windows 에서 실행 파일로 붙여 볼 확장자. exeOnly 면 .exe 만 (SDK 처럼 셸 없이 바로 실행해야 할 때). */
const exts = (exeOnly: boolean): string[] => (isWin ? (exeOnly ? ['.exe'] : ['.exe', '.cmd', '.bat', '']) : [''])

/** 이름 후보 중 처음 찾은 실행 파일의 전체 경로 */
export function findBinary(names: string[], opts: { exeOnly?: boolean; extraDirs?: string[] } = {}): string | null {
  const dirs = [...(opts.extraDirs ?? []), ...binDirs()]
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of exts(!!opts.exeOnly)) {
        const p = path.join(dir, name + ext)
        if (existsSync(p)) return p
      }
    }
  }
  return null
}

/** 보충한 PATH 를 넣은 환경 변수 (에이전트·CLI 실행용) */
export function shellEnv(): Record<string, string> {
  const env = { ...(process.env as Record<string, string>) }
  // Windows 는 환경 변수 이름이 대소문자를 가리지 않아 'Path' 로 들어 있을 수 있다
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  env[key] = [...new Set(binDirs())].join(path.delimiter)
  return env
}
