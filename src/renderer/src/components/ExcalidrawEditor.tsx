import { useEffect, useMemo, useRef } from 'react'
import { Excalidraw, restore, serializeAsJSON } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

// 글꼴을 인터넷(CDN) 대신 앱에 넣어 둔 파일에서 읽는다 (electron.vite.config 의 excalidrawAssets 참고)
;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL('excalidraw/', document.baseURI).href

type Elements = Parameters<typeof serializeAsJSON>[0]
type AppState = Parameters<typeof serializeAsJSON>[1]
type Files = Parameters<typeof serializeAsJSON>[2]

/** .excalidraw 그림 편집기. 그림이 실제로 바뀌었을 때만 onChange 로 저장할 JSON 을 넘긴다 (선택·화면 이동은 무시). */
export default function ExcalidrawEditor({ content, theme, onChange }: { content: string; theme: string; onChange: (text: string) => void }) {
  const initial = useMemo(() => {
    let data: { elements?: unknown; appState?: unknown; files?: unknown } = {}
    try {
      data = content.trim() ? JSON.parse(content) : {}
    } catch {
      data = {}
    }
    const scene = restore(data as Parameters<typeof restore>[0], null, null)
    return scene
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 처음 불러온 그림을 기준으로 삼아, 열기만 해도 '수정됨' 이 되지 않게 한다
  const baseline = useMemo(() => serializeAsJSON(initial.elements, initial.appState as AppState, initial.files ?? {}, 'local'), [initial])
  const last = useRef(baseline)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => () => clearTimeout(timer.current), [])

  const handleChange = (elements: Elements, appState: AppState, files: Files): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const json = serializeAsJSON(elements, appState, files, 'local')
      if (json !== last.current) {
        last.current = json
        onChangeRef.current(json)
      }
    }, 250)
  }

  return (
    <div className="excalidraw-host">
      <Excalidraw
        initialData={initial}
        theme={theme === 'light' ? 'light' : 'dark'}
        langCode="ko-KR"
        onChange={handleChange}
        excalidrawAPI={(api) =>
          // 처음 열 때 그림 전체가 화면에 들어오게 맞춘다 (작은 그림은 100% 그대로)
          requestAnimationFrame(() => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, maxZoom: 1 }))
        }
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
      />
    </div>
  )
}
