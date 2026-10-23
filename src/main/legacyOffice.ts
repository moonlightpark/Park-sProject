import { app } from 'electron'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, promises as fsp } from 'fs'
import path from 'path'

/**
 * 예전 Office 문서(.ppt·.doc·.xls) 미리보기. macOS 의 Quick Look(내장 Office 변환기)으로 HTML 을 만든 뒤,
 * 그 안의 도형 이미지(PDF)를 PNG 로 바꿔 Chromium 에서도 보이게 한다. 결과는 파일 내용별로 캐시한다.
 * .xls 는 시트마다 HTML 이 따로 생기고 탭 전환을 스크립트로 하므로, 시트 목록을 읽어 앱이 직접 탭을 그린다.
 */

export interface LegacyPreview {
  /** 처음 보여 줄 HTML */
  html: string
  /** .xls 시트 (이름·HTML 경로). 다른 형식은 빈 배열 */
  sheets: { name: string; html: string }[]
}

type Kind = 'ppt' | 'doc' | 'xls'
const kindOf = (file: string): Kind => (/\.(xls|xlt)$/i.test(file) ? 'xls' : /\.(doc|dot)$/i.test(file) ? 'doc' : 'ppt')

/** 앱 화면에 맞게: 슬라이드·페이지를 가운데로, 바깥 배경은 앱 색에 가깝게 */
const PAGE_STYLE: Record<Kind, string> = {
  ppt:
    'body{margin:0;padding:24px 0;display:flex;flex-direction:column;align-items:center;background:#e9eaee}' +
    'div.slide{margin:0 0 20px!important;box-shadow:0 1px 6px rgba(0,0,0,.18)!important}' +
    '@media (prefers-color-scheme: dark){body{background:#2a2926}}',
  doc:
    'html{background:#e9eaee}body{margin:0!important;padding:24px 0}' +
    'body>div{background:#fff;margin:0 auto 20px!important;box-shadow:0 1px 6px rgba(0,0,0,.18)}' +
    '@media (prefers-color-scheme: dark){html{background:#2a2926}}',
  // 원래 글자가 10px 이라 작다 → 키우고, 셀 내용이 옆 칸을 덮지 않게 자른다
  xls: 'body{margin:0;background:#fff;zoom:1.25}td{overflow:hidden;text-overflow:ellipsis}'
}

export const cacheRoot = (): string => path.join(app.getPath('userData'), 'office-preview')

const scriptPath = (): string =>
  app.isPackaged ? path.join(process.resourcesPath, 'scripts', 'pdf2png.js') : path.join(app.getAppPath(), 'resources', 'scripts', 'pdf2png.js')

const run = (cmd: string, args: string[], timeout = 120_000): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)))
  )

/** 같은 파일을 동시에 여러 번 변환하지 않게 */
const inflight = new Map<string, Promise<LegacyPreview>>()

/** 미리보기 HTML 의 경로를 돌려준다 (없으면 만든다) */
export function legacyPreview(file: string): Promise<LegacyPreview> {
  if (process.platform !== 'darwin') return Promise.reject(new Error('예전 Office 형식 미리보기는 macOS 에서만 지원합니다. 기본 앱에서 열어 주세요.'))
  return fsp.stat(file).then((st) => {
    const key = createHash('sha1').update(`v2\0${file}\0${st.size}\0${st.mtimeMs}`).digest('hex').slice(0, 20)
    let job = inflight.get(key)
    if (!job) {
      job = build(file, key).finally(() => inflight.delete(key))
      inflight.set(key, job)
    }
    return job
  })
}

async function build(file: string, key: string): Promise<LegacyPreview> {
  const root = cacheRoot()
  const dir = path.join(root, key)
  const meta = path.join(dir, 'preview.json')
  if (existsSync(meta)) return withDir(dir, JSON.parse(await fsp.readFile(meta, 'utf8')))

  const kind = kindOf(file)
  const tmp = `${dir}.tmp-${process.pid}`
  await fsp.rm(tmp, { recursive: true, force: true })
  await fsp.mkdir(tmp, { recursive: true })
  let result: LegacyPreview
  try {
    await run('/usr/bin/qlmanage', ['-p', '-o', tmp, file])
    const bundle = (await fsp.readdir(tmp)).find((n) => n.endsWith('.qlpreview'))
    const out = bundle && path.join(tmp, bundle)
    if (!out || !existsSync(path.join(out, 'Preview.html'))) throw new Error('이 파일의 미리보기를 만들 수 없습니다.')
    await run('/usr/bin/osascript', ['-l', 'JavaScript', scriptPath(), out, '2'])

    // 시트 목록: <div class="TabViewItem …"><div class="TabHeader">이름</div><a href="AttachmentN.html">
    const preview = await fsp.readFile(path.join(out, 'Preview.html'), 'utf8')
    const sheets =
      kind === 'xls'
        ? [...preview.matchAll(/<div class="TabHeader">([\s\S]*?)<\/div>\s*<a href="(Attachment\d+\.html)"/g)].map((m) => ({ name: decodeEntities(m[1]), html: m[2] }))
        : []
    const pages = sheets.length ? sheets.map((x) => x.html) : ['Preview.html']
    for (const name of pages) {
      const page = (await fsp.readFile(path.join(out, name), 'utf8'))
        .replace(/(src=["'])(Attachment\d+\.pdf)(["'])/gi, '$1$2.png$3')
        .replace('</head>', `<style>${PAGE_STYLE[kind]}</style></head>`)
      await fsp.writeFile(path.join(out, name === 'Preview.html' ? 'index.html' : name), page)
    }
    result = { html: sheets[0]?.html ?? 'index.html', sheets }
    await fsp.writeFile(path.join(out, 'preview.json'), JSON.stringify(result))
    await fsp.rm(dir, { recursive: true, force: true })
    await fsp.rename(out, dir)
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true })
  }
  void prune(root)
  return withDir(dir, result)
}

/** 캐시에 적어 둔 상대 경로를 절대 경로로 */
const withDir = (dir: string, r: LegacyPreview): LegacyPreview => ({
  html: path.join(dir, r.html),
  sheets: r.sheets.map((x) => ({ name: x.name, html: path.join(dir, x.html) }))
})

const decodeEntities = (s: string): string =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()

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
