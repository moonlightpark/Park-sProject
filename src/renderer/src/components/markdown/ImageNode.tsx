import { createContext, useContext, useState, type ReactElement } from 'react'
import {
  $applyNodeReplacement,
  DecoratorNode,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread
} from 'lexical'
import type { TextMatchTransformer } from '@lexical/markdown'

/** 지금 편집 중인 문서의 경로. 상대 경로 이미지를 이 문서의 폴더 기준으로 찾는다. */
export const DocPathContext = createContext<string | null>(null)

/** 마크다운의 이미지 주소를 화면에 띄울 수 있는 주소로 바꾼다 */
export function resolveImageSrc(src: string, docPath: string | null): string {
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  let abs: string
  if (/^file:\/\//i.test(src)) abs = decodeURIComponent(new URL(src).pathname)
  else {
    const clean = safeDecode(src.split(/[?#]/)[0])
    if (clean.startsWith('/')) abs = clean
    else if (!docPath) return src
    else abs = normalize(docPath.slice(0, docPath.lastIndexOf('/')) + '/' + clean)
  }
  // 로컬 파일은 메인 프로세스의 local-file: 프로토콜로 읽는다 (개발 모드의 http 페이지에서도 열리도록)
  return 'local-file://f' + abs.split('/').map(encodeURIComponent).join('/')
}

function safeDecode(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

function normalize(p: string): string {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  return '/' + out.join('/')
}

export type SerializedImageNode = Spread<{ src: string; alt: string; title: string; raw: string }, SerializedLexicalNode>

/** 문서 안의 이미지. 원문이 HTML <img> 였다면 저장할 때 그대로 되돌려 쓴다. */
export class ImageNode extends DecoratorNode<ReactElement> {
  __src: string
  __alt: string
  __title: string
  __raw: string

  static getType(): string {
    return 'image'
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__alt, node.__title, node.__raw, node.__key)
  }

  static importJSON(json: SerializedImageNode): ImageNode {
    return $createImageNode(json.src, json.alt, json.title, json.raw)
  }

  constructor(src: string, alt = '', title = '', raw = '', key?: NodeKey) {
    super(key)
    this.__src = src
    this.__alt = alt
    this.__title = title
    this.__raw = raw
  }

  exportJSON(): SerializedImageNode {
    return { ...super.exportJSON(), type: 'image', version: 1, src: this.__src, alt: this.__alt, title: this.__title, raw: this.__raw }
  }

  exportDOM(): DOMExportOutput {
    const img = document.createElement('img')
    img.src = this.__src
    img.alt = this.__alt
    return { element: img }
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span')
    span.className = 'md-image'
    return span
  }

  updateDOM(): false {
    return false
  }

  isInline(): boolean {
    return true
  }

  getTextContent(): string {
    return this.toMarkdown()
  }

  toMarkdown(): string {
    if (this.__raw) return this.__raw
    const src = /[\s()]/.test(this.__src) ? `<${this.__src}>` : this.__src
    return this.__title ? `![${this.__alt}](${src} "${this.__title}")` : `![${this.__alt}](${src})`
  }

  decorate(): ReactElement {
    return <ImageView src={this.__src} alt={this.__alt} title={this.__title} />
  }
}

function ImageView({ src, alt, title }: { src: string; alt: string; title: string }) {
  const docPath = useContext(DocPathContext)
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className="md-image-missing" title={src}>
        🖼 {alt || src}
      </span>
    )
  }
  return <img src={resolveImageSrc(src, docPath)} alt={alt} title={title || undefined} draggable={false} onError={() => setFailed(true)} />
}

export function $createImageNode(src: string, alt = '', title = '', raw = ''): ImageNode {
  return $applyNodeReplacement(new ImageNode(src, alt, title, raw))
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode
}

/** ![대체 텍스트](주소 "제목") — 주소는 <...> 로 감싸면 공백도 쓸 수 있다 */
const MD_IMAGE = /!\[([^\]]*)\]\((?:<([^>]*)>|([^\s()]+))(?:\s+"([^"]*)")?\s*\)/

export const IMAGE: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: (node) => ($isImageNode(node) ? node.toMarkdown() : null),
  importRegExp: MD_IMAGE,
  regExp: new RegExp(MD_IMAGE.source + '$'),
  replace: (textNode, match) => {
    textNode.replace($createImageNode(match[2] ?? match[3], match[1], match[4] ?? ''))
  },
  trigger: ')',
  type: 'text-match'
}

const HTML_IMG = /<img\s[^>]*?src=["']([^"']+)["'][^>]*>/i

/** README 에 흔한 <img src="..."> 태그. 저장할 때는 원래 태그를 그대로 쓴다. */
export const HTML_IMAGE: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: () => null,
  importRegExp: HTML_IMG,
  regExp: new RegExp(HTML_IMG.source + '$', 'i'),
  replace: (textNode, match) => {
    const alt = /alt=["']([^"']*)["']/i.exec(match[0])?.[1] ?? ''
    textNode.replace($createImageNode(match[1], alt, '', match[0]))
  },
  trigger: '>',
  type: 'text-match'
}
