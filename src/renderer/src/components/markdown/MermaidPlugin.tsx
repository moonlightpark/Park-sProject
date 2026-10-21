import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isCodeNode } from '@lexical/code'
import { $getRoot } from 'lexical'
import mermaid from 'mermaid'
import { useFeature } from '../../lib/project'

interface Diagram {
  key: string
  source: string
}

let renderSeq = 0

function currentMermaidTheme(): 'default' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'default' : 'dark'
}

/**
 * ```mermaid 코드 블록 아래에 다이어그램 미리보기를 띄운다.
 * 미리보기는 Lexical 이 관리하지 않는 요소라서, 코드 블록 아래에 여백을 주고 그 자리에 절대 위치로 그린다.
 */
export function MermaidPlugin({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const [editor] = useLexicalComposerContext()
  const [diagrams, setDiagrams] = useState<Diagram[]>([])
  const enabled = useFeature('mermaid')

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const found: Diagram[] = []
          for (const node of $getRoot().getChildren()) {
            if ($isCodeNode(node) && (node.getLanguage() ?? '').toLowerCase() === 'mermaid') {
              found.push({ key: node.getKey(), source: node.getTextContent() })
            }
          }
          setDiagrams((prev) =>
            prev.length === found.length && prev.every((d, i) => d.key === found[i].key && d.source === found[i].source)
              ? prev
              : found
          )
        })
      }),
    [editor]
  )

  if (!enabled) return null
  return (
    <>
      {diagrams.map((d) => (
        <MermaidPreview key={d.key} nodeKey={d.key} source={d.source} containerRef={containerRef} />
      ))}
    </>
  )
}

function MermaidPreview({
  nodeKey,
  source,
  containerRef
}: {
  nodeKey: string
  source: string
  containerRef: RefObject<HTMLDivElement | null>
}) {
  const [editor] = useLexicalComposerContext()
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [top, setTop] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        mermaid.initialize({ startOnLoad: false, theme: currentMermaidTheme(), securityLevel: 'strict' })
        const { svg } = await mermaid.render(`mmd-${++renderSeq}`, source)
        if (!cancelled) {
          setSvg(svg)
          setError('')
        }
      } catch (e) {
        if (!cancelled) setError('다이어그램 문법 오류: ' + (e instanceof Error ? e.message : String(e)))
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [source])

  // 코드 블록 바로 아래로 위치를 맞추고, 그만큼 코드 블록에 아래 여백을 준다
  useLayoutEffect(() => {
    const el = editor.getElementByKey(nodeKey)
    const box = boxRef.current
    const container = containerRef.current
    if (!el || !box || !container) return
    const place = (): void => {
      el.style.marginBottom = `${box.offsetHeight + 20}px`
      setTop(el.offsetTop + el.offsetHeight + 6)
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    ro.observe(box)
    return () => {
      ro.disconnect()
      el.style.marginBottom = ''
    }
  }, [editor, nodeKey, svg, error, containerRef])

  return (
    <div
      ref={boxRef}
      className="mermaid-preview"
      contentEditable={false}
      style={{ position: 'absolute', left: 48, right: 48, top }}
    >
      {error ? <div className="err">{error}</div> : <div dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  )
}
