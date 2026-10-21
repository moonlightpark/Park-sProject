import { net, protocol } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.apng', '.tif', '.tiff'])

/**
 * 마크다운 문서 속 로컬 이미지를 보여 주는 local-file:// 프로토콜.
 * 개발 모드 페이지(http://localhost)는 file:// 을 직접 열 수 없어서 메인 프로세스가 대신 읽어 준다.
 * 주소 모양: local-file://f/<인코딩된 절대 경로>. 이미지 파일만 돌려준다.
 */
export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'local-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
}

export function handleLocalFile(): void {
  protocol.handle('local-file', (req) => {
    const file = decodeURIComponent(new URL(req.url).pathname)
    if (!IMAGE_EXT.has(path.extname(file).toLowerCase())) return new Response('이미지 파일만 열 수 있습니다.', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
