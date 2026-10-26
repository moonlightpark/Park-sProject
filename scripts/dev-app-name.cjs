/**
 * 개발 실행(npm run dev)은 node_modules 의 Electron.app 을 그대로 띄우므로
 * macOS 상단 메뉴·Dock 에 앱 이름이 'Electron' 으로 나온다. 그 번들의 Info.plist 이름만 BakPro 로 바꾼다.
 * 헬퍼는 'Electron Helper' 이름으로 먼저 찾으므로 CFBundleName 을 바꿔도 실행에는 문제가 없다.
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const NAME = 'BakPro'
// Dock 툴팁에 보일 이름 (설치용 앱과 같게)
const DISPLAY = '박프로'

if (process.platform !== 'darwin') process.exit(0)

const app = path.join(__dirname, '../node_modules/electron/dist/Electron.app')
const plist = path.join(app, 'Contents/Info.plist')
if (!fs.existsSync(plist)) process.exit(0)

const read = (key) => {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return null
  }
}

let changed = false
for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  const value = read(key)
  if (value === NAME) continue
  const op = value === null ? `Add :${key} string ${NAME}` : `Set :${key} ${NAME}`
  execFileSync('/usr/libexec/PlistBuddy', ['-c', op, plist])
  changed = true
}

// Dock 툴팁은 번들 파일 이름(Electron.app)을 보여 주므로, 지역화된 표시 이름을 쓰도록 한다
if (read('LSHasLocalizedDisplayName') !== 'true') {
  const op = read('LSHasLocalizedDisplayName') === null ? 'Add :LSHasLocalizedDisplayName bool true' : 'Set :LSHasLocalizedDisplayName true'
  execFileSync('/usr/libexec/PlistBuddy', ['-c', op, plist])
  changed = true
}
const strings = `"CFBundleDisplayName" = "${DISPLAY}";\n"CFBundleName" = "${NAME}";\n`
for (const lang of ['en', 'ko']) {
  const file = path.join(app, 'Contents/Resources', `${lang}.lproj`, 'InfoPlist.strings')
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === strings) continue
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, strings, 'utf8')
  changed = true
}

// macOS 가 예전 이름을 기억하고 있으므로 번들을 갱신했다고 알린다
if (changed) {
  const now = new Date()
  fs.utimesSync(app, now, now)
  try {
    execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', app])
  } catch {
    /* 등록을 갱신하지 못해도 다음 실행부터는 대개 반영된다 */
  }
}
