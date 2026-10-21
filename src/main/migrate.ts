import { app } from 'electron'
import { existsSync, renameSync, rmSync } from 'fs'
import path from 'path'

/**
 * 앱 이름이 '님바리스트' → '박프로' 로 바뀌면서 데이터 폴더(userData)도 바뀌었다.
 * 새 폴더는 Electron 이 시작할 때 이미 만들어 두므로, 다른 모듈이 저장소를 열기 전에
 * 예전 폴더의 앱 데이터(설정·세션·기록 등)만 하나씩 옮긴다. 옮긴 뒤에는 예전 쪽에 남지 않아 다시 옮기지 않는다.
 */
app.setName('박프로')
const next = app.getPath('userData')
const prev = path.join(path.dirname(next), '님바리스트')
const DATA = ['settings.json', 'sessions', 'history', 'jobs', 'usage.json', 'usage-probe', 'keys.json']
if (existsSync(prev)) {
  for (const name of DATA) {
    const from = path.join(prev, name)
    if (!existsSync(from)) continue
    try {
      rmSync(path.join(next, name), { recursive: true, force: true })
      renameSync(from, path.join(next, name))
    } catch {
      /* 옮기지 못한 항목은 새로 시작한다 */
    }
  }
}
