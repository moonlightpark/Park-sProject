import { api, basename } from '../lib/api'
import { previewUrl } from './HtmlPreview'
import { Icon, toast } from './ui'

const AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus)$/i
const VIDEO = /\.(mp4|m4v|mov|webm|ogv)$/i

export const isMedia = (p: string): boolean => AUDIO.test(p) || VIDEO.test(p)

/** 음악·동영상 재생. 파일이 바깥에서 바뀌면(version) 다시 불러온다. */
export function MediaPlayer({ path, version }: { path: string; version: number }) {
  const src = `${previewUrl(path)}?v=${version}`
  const video = VIDEO.test(path)
  return (
    <div className="html-preview">
      <div className="html-preview-bar">
        <span className="name" title={path}>
          {basename(path)}
        </span>
        <span className="grow" />
        <button className="btn small" onClick={() => api.fs.openDefault(path).catch((e: unknown) => toast(String(e)))} title="기본 앱에서 열기">
          기본 앱에서 열기
        </button>
      </div>
      {video ? (
        <div className="media-stage video">
          <video key={version} src={src} controls autoPlay={false} preload="metadata" onError={() => toast('이 동영상 형식은 재생할 수 없습니다. 기본 앱에서 열어 보세요.')} />
        </div>
      ) : (
        <div className="media-stage">
          <div className="media-card">
            <div className="media-icon">
              <Icon name="mic" size={40} />
            </div>
            <div className="media-title">{basename(path)}</div>
            <audio key={version} src={src} controls preload="metadata" onError={() => toast('이 오디오 형식은 재생할 수 없습니다. 기본 앱에서 열어 보세요.')} />
          </div>
        </div>
      )}
    </div>
  )
}
