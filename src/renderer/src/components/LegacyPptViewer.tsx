import { useEffect, useState } from 'react'
import { api, basename } from '../lib/api'
import { previewUrl } from './HtmlPreview'
import { toast } from './ui'

export const isLegacyPpt = (p: string): boolean => /\.(ppt|pps|pot)$/i.test(p)

const errText = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

/**
 * 예전 PowerPoint(.ppt) 보기. macOS Quick Look 이 만든 미리보기를 보여 준다 (읽기 전용).
 * 처음 열 때 변환에 몇 초 걸리고, 같은 파일은 다음부터 바로 열린다. 파일이 바뀌면(version) 다시 변환한다.
 */
export function LegacyPptViewer({ path, version }: { path: string; version: number }) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setHtml(null)
    setError(null)
    api
      .legacyPreview(path)
      .then((p) => alive && setHtml(p))
      .catch((e: unknown) => alive && setError(errText(e)))
    return () => {
      alive = false
    }
  }, [path, version])

  return (
    <div className="html-preview">
      <div className="html-preview-bar">
        <span className="name" title={path}>
          {basename(path)}
          <span className="hwp-note"> · 예전 형식(.ppt)은 보기만 할 수 있습니다. 고치려면 PowerPoint 에서 .pptx 로 저장해 주세요</span>
        </span>
        <span className="grow" />
        <button className="btn small" onClick={() => api.fs.openDefault(path).catch((e: unknown) => toast(errText(e)))}>
          기본 앱에서 열기
        </button>
      </div>
      {error ? (
        <div className="empty-state">
          <div>이 프레젠테이션을 미리 볼 수 없습니다.</div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', maxWidth: 520, textAlign: 'center' }}>{error}</div>
        </div>
      ) : html ? (
        <iframe className="html-preview-frame pdf-frame" src={previewUrl(html)} title={basename(path)} sandbox="allow-same-origin" />
      ) : (
        <div className="empty-state">슬라이드를 준비하는 중… (처음 한 번은 몇 초 걸립니다)</div>
      )}
    </div>
  )
}
