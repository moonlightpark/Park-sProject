import { net, protocol } from 'electron'
import path from 'path'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { Readable } from 'stream'
import { pathToFileURL } from 'url'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.jfif', '.pjpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.apng', '.tif', '.tiff'])

/**
 * 마크다운 문서 속 로컬 이미지를 보여 주는 local-file:// 프로토콜.
 * 개발 모드 페이지(http://localhost)는 file:// 을 직접 열 수 없어서 메인 프로세스가 대신 읽어 준다.
 * 주소 모양: local-file://f/<인코딩된 절대 경로> (Windows 는 local-file://f/C:/...). 이미지 파일만 돌려준다.
 */
export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'local-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    { scheme: 'local-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

const toFile = (url: string): string => decodeURIComponent(new URL(url).pathname).replace(/^\/([A-Za-z]:)/, '$1')

/**
 * HTML 미리보기용 local-preview:// 프로토콜. 페이지가 옆에 둔 css·js·이미지를 상대 경로로 읽을 수 있게
 * 파일 종류는 가리지 않되, 열려 있는 작업공간 안의 파일만 돌려준다 (allowed 가 판단).
 * 주소 모양: local-preview://f/<인코딩된 절대 경로>
 */
export function handleLocalPreview(allowed: (file: string) => boolean): void {
  protocol.handle('local-preview', async (req) => {
    const file = toFile(req.url)
    if (!allowed(file)) return new Response('작업공간 밖의 파일은 열 수 없습니다.', { status: 403 })
    // 동영상·음악은 원하는 위치로 건너뛸 때 Range 요청을 보낸다 (file:// 읽기는 이를 무시하므로 직접 잘라 준다)
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') ?? '')
    if (range) return partial(file, range[1], range[2])
    const res = await net.fetch(pathToFileURL(file).toString())
    // 편집 내용을 바로 보여 주려면 캐시하지 않는다
    const headers = new Headers(res.headers)
    headers.set('Cache-Control', 'no-store')
    headers.set('Accept-Ranges', 'bytes')
    return new Response(res.body, { status: res.status, headers })
  })
}

const RANGE_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.pdf': 'application/pdf'
}

/** 'bytes=시작-끝' 요청에 파일의 그 부분만 206 으로 돌려준다 */
async function partial(file: string, from: string, to: string): Promise<Response> {
  const { size } = await stat(file)
  let start = from === '' ? Math.max(0, size - Number(to)) : Number(from)
  let end = from !== '' && to !== '' ? Math.min(Number(to), size - 1) : size - 1
  if (from === '') end = size - 1
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  start = Math.max(0, start)
  end = Math.max(start, end)
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': RANGE_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }
  })
}

export function handleLocalFile(): void {
  protocol.handle('local-file', (req) => {
    // Windows 경로는 /C:/... 로 들어오므로 앞의 / 를 뗀다
    const file = toFile(req.url)
    if (!IMAGE_EXT.has(path.extname(file).toLowerCase())) return new Response('이미지 파일만 열 수 있습니다.', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
