import { useState } from 'react'
import { api, basename } from '../lib/api'
import { toast } from './ui'

export const isImage = (p: string): boolean => /\.(png|jpe?g|jfif|pjpeg|gif|webp|bmp|ico|avif|svg)$/i.test(p)

/**
 * 파일 경로 → local-file: 주소. 마크다운 속 주소와 달리 실제 파일 이름이라 # · ? · % 도 글자 그대로 인코딩한다
 * (예: IMG#1.jpg 가 IMG 에서 잘리지 않게).
 */
const fileUrl = (p: string): string => 'local-file://f/' + p.replace(/\\/g, '/').replace(/^\//, '').split('/').map(encodeURIComponent).join('/')

/** 이미지 보기: 기본은 창에 맞춤, 누르면 실제 크기(100%)로. 파일이 바뀌면(version) 다시 읽는다. */
export function ImageViewer({ path, version }: { path: string; version: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [actual, setActual] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <div className="html-preview">
      <div className="html-preview-bar">
        <span className="name" title={path}>
          {basename(path)}
          {size && <span className="hwp-note"> · {size.w} × {size.h}</span>}
        </span>
        <span className="grow" />
        <button className="btn small" onClick={() => setActual((v) => !v)} disabled={failed}>
          {actual ? '창에 맞춤' : '실제 크기'}
        </button>
        <button className="btn small" onClick={() => api.fs.openDefault(path).catch((e: unknown) => toast(String(e)))}>
          기본 앱에서 열기
        </button>
      </div>
      {failed ? (
        <div className="empty-state">
          <div>이 이미지를 표시할 수 없습니다.</div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>확장자와 실제 형식이 다르거나(예: HEIC 사진) 손상된 파일일 수 있습니다.</div>
        </div>
      ) : (
        <div className={`image-viewer${actual ? ' actual' : ''}`} onClick={() => setActual((v) => !v)}>
          <img
            key={version}
            src={`${fileUrl(path)}?v=${version}`}
            alt={basename(path)}
            draggable={false}
            onLoad={(e) => (setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }), setFailed(false))}
            onError={() => setFailed(true)}
          />
        </div>
      )}
    </div>
  )
}
