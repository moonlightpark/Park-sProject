import { useEffect, useState } from 'react'
import { api, basename } from '../lib/api'
import { previewUrl } from './HtmlPreview'
import { toast } from './ui'

export const isLegacyOffice = (p: string): boolean => /\.(ppt|pps|pot|doc|dot|xls|xlt)$/i.test(p)

/** 형식별 안내 문구 */
function labels(p: string): { what: string; app: string; modern: string; loading: string } {
  if (/\.(doc|dot)$/i.test(p)) return { what: '.doc', app: 'Word', modern: '.docx', loading: '문서를 준비하는 중…' }
  if (/\.(xls|xlt)$/i.test(p)) return { what: '.xls', app: 'Excel', modern: '.xlsx', loading: '시트를 준비하는 중…' }
  return { what: '.ppt', app: 'PowerPoint', modern: '.pptx', loading: '슬라이드를 준비하는 중…' }
}

const errText = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

type Preview = { html: string; sheets: { name: string; html: string }[] }

/**
 * 예전 Office 문서(.ppt·.doc·.xls) 보기. macOS Quick Look 이 만든 미리보기를 보여 준다 (읽기 전용).
 * 처음 열 때 변환에 몇 초 걸리고, 같은 파일은 다음부터 바로 열린다. 파일이 바뀌면(version) 다시 변환한다.
 * .xls 는 아래쪽 탭으로 시트를 바꾼다.
 */
export function LegacyOfficeViewer({ path, version }: { path: string; version: number }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [sheet, setSheet] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const l = labels(path)

  useEffect(() => {
    let alive = true
    setPreview(null)
    setError(null)
    api
      .legacyPreview(path)
      .then((p) => {
        if (!alive) return
        setPreview(p)
        setSheet((i) => (i < p.sheets.length ? i : 0))
      })
      .catch((e: unknown) => alive && setError(errText(e)))
    return () => {
      alive = false
    }
  }, [path, version])

  const src = preview && (preview.sheets[sheet]?.html ?? preview.html)

  return (
    <div className="html-preview">
      <div className="html-preview-bar">
        <span className="name" title={path}>
          {basename(path)}
          <span className="hwp-note">
            {' '}
            · 예전 형식({l.what})은 보기만 할 수 있습니다. 고치려면 {l.app} 에서 {l.modern} 로 저장해 주세요
          </span>
        </span>
        <span className="grow" />
        <button className="btn small" onClick={() => api.fs.openDefault(path).catch((e: unknown) => toast(errText(e)))}>
          기본 앱에서 열기
        </button>
      </div>
      {error ? (
        <div className="empty-state">
          <div>이 파일을 미리 볼 수 없습니다.</div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', maxWidth: 520, textAlign: 'center' }}>{error}</div>
        </div>
      ) : src ? (
        <>
          <iframe key={src} className="html-preview-frame pdf-frame" src={previewUrl(src)} title={basename(path)} sandbox="allow-same-origin" />
          {preview.sheets.length > 1 && (
            <div className="legacy-sheet-tabs">
              {preview.sheets.map((s, i) => (
                <button key={s.html} className={i === sheet ? 'active' : ''} onClick={() => setSheet(i)} title={s.name}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">{l.loading} (처음 한 번은 몇 초 걸립니다)</div>
      )}
    </div>
  )
}
