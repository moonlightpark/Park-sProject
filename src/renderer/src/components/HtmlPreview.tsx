import { useEffect, useRef, useState } from 'react'
import { api, basename } from '../lib/api'
import { Icon, toast } from './ui'

export const isHtml = (p: string): boolean => /\.html?$/i.test(p)

type Scheme = 'auto' | 'light' | 'dark'
const SCHEME_LABEL: Record<Scheme, string> = { auto: '앱과 같게', light: '밝게', dark: '어둡게' }
const NEXT: Record<Scheme, Scheme> = { auto: 'light', light: 'dark', dark: 'auto' }

/** 메인 프로세스의 local-preview: 프로토콜 주소. 같은 폴더의 css·js·이미지도 상대 경로로 읽힌다. */
export const previewUrl = (p: string): string =>
  'local-preview://f/' + p.replace(/\\/g, '/').replace(/^\//, '').split('/').map(encodeURIComponent).join('/')

/**
 * HTML 파일을 실제 페이지처럼 보여 준다. 파일이 저장될 때마다 (직접 고치든 AI 가 고치든) 다시 불러온다.
 * savedKey 는 디스크에 저장된 내용 — 바뀌면 새로고침한다.
 */
export function HtmlPreview({
  path,
  savedKey,
  appTheme,
  onViewSource
}: {
  path: string
  savedKey: string
  appTheme: string
  /** 오른쪽 아래 '소스 보기' 버튼 — 코드 편집 화면으로 바꾼다 */
  onViewSource: () => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [version, setVersion] = useState(0)
  const [scheme, setScheme] = useState<Scheme>(() => {
    try {
      return (localStorage.getItem('htmlPreview:scheme') as Scheme) || 'auto'
    } catch {
      return 'auto'
    }
  })

  // 저장이 몰려 들어올 때 깜빡이지 않게 잠깐 모았다가 새로고침
  const first = useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    const t = setTimeout(() => setVersion((v) => v + 1), 300)
    return () => clearTimeout(t)
  }, [savedKey])

  const changeScheme = (): void => {
    const next = NEXT[scheme]
    setScheme(next)
    try {
      localStorage.setItem('htmlPreview:scheme', next)
    } catch {
      /* 저장소를 쓸 수 없으면 무시 */
    }
  }

  const screenshot = async (): Promise<void> => {
    const el = frame.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // 화면 확대(텍스트 크기 배율)가 걸려 있으면 창 좌표로 바꿔 준다
    const zoom = window.outerWidth / window.innerWidth || 1
    try {
      await api.capture({ x: r.x * zoom, y: r.y * zoom, width: r.width * zoom, height: r.height * zoom })
      toast('미리보기 화면을 클립보드에 복사했습니다.')
    } catch (e) {
      toast(String(e))
    }
  }

  return (
    <div className="html-preview">
      <div className="html-preview-bar">
        <span className="name" title={path}>
          {basename(path)}
        </span>
        <span className="grow" />
        <button className="btn small" onClick={() => setVersion((v) => v + 1)} title="다시 불러오기">
          <Icon name="refresh" size={14} /> 새로고침
        </button>
        <button className="btn small" onClick={changeScheme} title="페이지의 밝은/어두운 모드 (prefers-color-scheme) 를 바꿔 봅니다">
          테마: {SCHEME_LABEL[scheme]}
        </button>
        <button className="btn small" onClick={screenshot} title="미리보기 화면을 이미지로 클립보드에 복사">
          스크린샷
        </button>
        <button className="btn small" onClick={() => api.fs.openDefault(path).catch((e: unknown) => toast(String(e)))} title="기본 브라우저에서 열기">
          <Icon name="globe" size={14} /> 브라우저에서 열기
        </button>
      </div>
      <iframe
        key={version}
        ref={frame}
        className="html-preview-frame"
        src={`${previewUrl(path)}?v=${version}`}
        title={basename(path)}
        style={{ colorScheme: scheme === 'auto' ? (appTheme === 'light' ? 'light' : 'dark') : scheme }}
        // 페이지 스크립트는 실행하되 앱 화면(부모 창)에는 손대지 못하게 한다. 출처가 달라 same-origin 을 줘도 부모에 접근할 수 없다
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
      <button className="btn floating-corner" onClick={onViewSource} title="HTML 코드를 고칩니다">
        <Icon name="code" size={14} /> 소스 보기
      </button>
    </div>
  )
}
