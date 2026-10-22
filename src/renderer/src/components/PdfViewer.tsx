import { api, basename } from '../lib/api'
import { previewUrl } from './HtmlPreview'
import { toast } from './ui'

export const isPdf = (p: string): boolean => /\.pdf$/i.test(p)

/**
 * PDF 보기. Chromium 내장 PDF 뷰어(확대·검색·쪽 목록·인쇄)를 그대로 쓴다.
 * version 이 바뀌면(파일이 바깥에서 바뀌면) 다시 불러온다.
 */
export function PdfViewer({ path, version }: { path: string; version: number }) {
  return (
    <div className="html-preview">
      <div className="html-preview-bar">
        <span className="name" title={path}>
          {basename(path)}
        </span>
        <span className="grow" />
        <button className="btn small" onClick={() => api.fs.openDefault(path).catch((e: unknown) => toast(String(e)))} title="미리보기 등 기본 앱에서 열기">
          기본 앱에서 열기
        </button>
      </div>
      <iframe key={version} className="html-preview-frame pdf-frame" src={`${previewUrl(path)}?v=${version}`} title={basename(path)} />
    </div>
  )
}
