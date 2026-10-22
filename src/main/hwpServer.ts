import { app } from 'electron'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { createReadStream, existsSync, promises as fsp } from 'fs'
import { randomBytes } from 'crypto'
import path from 'path'

/**
 * HWP 편집기(rhwp-studio)를 띄우는 로컬 웹 서버 (127.0.0.1, 빈 포트).
 * rhwp 편집기 SDK 는 http(s) 주소에서만 동작해서 file:// 대신 이 서버로 제공한다.
 *
 * - / 아래: 빌드해 둔 rhwp-studio 정적 파일 (scripts/build-rhwp-studio.mjs)
 * - /__host/: 앱과 편집기를 잇는 페이지
 * - /__file?token=&path=: 문서 읽기(GET)·저장(POST). 토큰이 맞고, 열린 작업공간 안의 .hwp/.hwpx 만 허용
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}

/** 빌드된 편집기 위치 (개발: 저장소의 resources, 배포: 앱의 Resources) */
export function studioDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'rhwp-studio') : path.join(app.getAppPath(), 'resources', 'rhwp-studio')
}

let server: Promise<{ origin: string; token: string }> | null = null

export function startHwpServer(allowed: (file: string) => boolean): Promise<{ origin: string; token: string }> {
  if (server) return server
  const root = studioDir()
  if (!existsSync(path.join(root, 'index.html'))) {
    return Promise.reject(new Error('HWP 편집기가 빌드되어 있지 않습니다. 개발 환경이라면 npm run build:hwp 를 먼저 실행하세요.'))
  }
  const token = randomBytes(24).toString('hex')
  server = new Promise((resolve, reject) => {
    let host = ''
    const srv = createServer((req, res) => {
      // 다른 웹사이트가 DNS 를 바꿔 이 서버에 접근하는 것을 막는다
      if (req.headers.host !== host) return end(res, 403, 'forbidden')
      handle(req, res, root, token, allowed).catch((e) => end(res, 500, String(e?.message ?? e)))
    })
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (!addr || typeof addr === 'string') return reject(new Error('HWP 서버 주소를 알 수 없습니다.'))
      host = `127.0.0.1:${addr.port}`
      resolve({ origin: `http://${host}`, token })
    })
  })
  server.catch(() => (server = null))
  return server
}

function end(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}

async function handle(req: IncomingMessage, res: ServerResponse, root: string, token: string, allowed: (file: string) => boolean): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/__file') {
    const file = url.searchParams.get('path') ?? ''
    if (url.searchParams.get('token') !== token) return end(res, 403, '권한이 없습니다.')
    if (!/\.hwpx?$/i.test(file) || !path.isAbsolute(file) || !allowed(file)) return end(res, 403, '작업공간 안의 HWP 파일만 열 수 있습니다.')
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' })
      createReadStream(file).on('error', (e) => res.destroy(e)).pipe(res)
      return
    }
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      // 임시 파일에 쓴 뒤 바꿔 끼워, 쓰다가 끊겨도 원본이 깨지지 않게 한다
      const tmp = `${file}.${process.pid}.tmp`
      await fsp.writeFile(tmp, Buffer.concat(chunks))
      await fsp.rename(tmp, file)
      return end(res, 200, 'ok')
    }
    return end(res, 405, 'method not allowed')
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return end(res, 405, 'method not allowed')
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const file = path.resolve(root, '.' + rel)
  if (!file.startsWith(root + path.sep)) return end(res, 403, 'forbidden')
  const stat = await fsp.stat(file).catch(() => null)
  if (!stat?.isFile()) return end(res, 404, 'not found')
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(stat.size),
    'Cache-Control': 'no-cache'
  })
  if (req.method === 'HEAD') return void res.end()
  createReadStream(file).pipe(res)
}
