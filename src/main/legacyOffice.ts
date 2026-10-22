import { app } from 'electron'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, promises as fsp } from 'fs'
import path from 'path'

/**
 * 예전 PowerPoint(.ppt) 미리보기. macOS 의 Quick Look(내장 Office 변환기)으로 HTML 을 만든 뒤,
 * 그 안의 도형 이미지(PDF)를 PNG 로 바꿔 Chromium 에서도 보이게 한다. 결과는 파일 내용별로 캐시한다.
 */

export const cacheRoot = (): string => path.join(app.getPath('userData'), 'office-preview')

const scriptPath = (): string =>
  app.isPackaged ? path.join(process.resourcesPath, 'scripts', 'pdf2png.js') : path.join(app.getAppPath(), 'resources', 'scripts', 'pdf2png.js')

const run = (cmd: string, args: string[], timeout = 120_000): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)))
  )

/** 같은 파일을 동시에 여러 번 변환하지 않게 */
const inflight = new Map<string, Promise<string>>()

/** 미리보기 HTML 의 경로를 돌려준다 (없으면 만든다) */
export function legacyPreview(file: string): Promise<string> {
  if (process.platform !== 'darwin') return Promise.reject(new Error('.ppt 미리보기는 macOS 에서만 지원합니다. 기본 앱에서 열어 주세요.'))
  return fsp.stat(file).then((st) => {
    const key = createHash('sha1').update(`${file}\0${st.size}\0${st.mtimeMs}`).digest('hex').slice(0, 20)
    let job = inflight.get(key)
    if (!job) {
      job = build(file, key).finally(() => inflight.delete(key))
      inflight.set(key, job)
    }
    return job
  })
}

async function build(file: string, key: string): Promise<string> {
  const root = cacheRoot()
  const dir = path.join(root, key)
  const index = path.join(dir, 'index.html')
  if (existsSync(index)) return index

  const tmp = `${dir}.tmp-${process.pid}`
  await fsp.rm(tmp, { recursive: true, force: true })
  await fsp.mkdir(tmp, { recursive: true })
  try {
    await run('/usr/bin/qlmanage', ['-p', '-o', tmp, file])
    const bundle = (await fsp.readdir(tmp)).find((n) => n.endsWith('.qlpreview'))
    const html = bundle && path.join(tmp, bundle, 'Preview.html')
    if (!html || !existsSync(html)) throw new Error('이 파일의 미리보기를 만들 수 없습니다.')
    await run('/usr/bin/osascript', ['-l', 'JavaScript', scriptPath(), path.join(tmp, bundle), '2'])
    let page = await fsp.readFile(html, 'utf8')
    page = page
      .replace(/(src=["'])(Attachment\d+\.pdf)(["'])/gi, '$1$2.png$3')
      // 앱 화면에 맞게: 슬라이드를 가운데로, 배경은 앱 색에 가깝게
      .replace(
        '</head>',
        '<style>body{margin:0;padding:24px 0;display:flex;flex-direction:column;align-items:center;background:#e9eaee}' +
          'div.slide{margin:0 0 20px!important;box-shadow:0 1px 6px rgba(0,0,0,.18)!important}' +
          '@media (prefers-color-scheme: dark){body{background:#2a2926}}</style></head>'
      )
    await fsp.writeFile(path.join(tmp, bundle, 'index.html'), page)
    await fsp.rm(dir, { recursive: true, force: true })
    await fsp.rename(path.join(tmp, bundle), dir)
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true })
  }
  void prune(root)
  return index
}

/** 오래된 캐시는 30개만 남긴다 */
async function prune(root: string): Promise<void> {
  try {
    const dirs = await Promise.all(
      (await fsp.readdir(root)).map(async (n) => ({ n, t: (await fsp.stat(path.join(root, n))).mtimeMs }))
    )
    for (const d of dirs.sort((a, b) => b.t - a.t).slice(30)) await fsp.rm(path.join(root, d.n), { recursive: true, force: true })
  } catch {
    /* 캐시 정리는 실패해도 괜찮다 */
  }
}
