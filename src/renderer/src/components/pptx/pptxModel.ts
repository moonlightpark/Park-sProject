import JSZip from 'jszip'

/**
 * .pptx 파일(압축된 XML 묶음)을 직접 고친다. 지원하는 편집: 글상자·표 칸의 글자, 슬라이드 복제·삭제·순서 바꾸기.
 * 글꼴·색 같은 서식은 각 문단의 첫 글자 서식을 그대로 이어 쓴다.
 */

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types'
}
const SLIDE_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
const NOTES_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide'
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'

export interface TextBlock {
  /** 도형 이름 (예: 'Title 1', '표 1 · 2행 3열') */
  name: string
  text: string
}

export interface SlideInfo {
  path: string
  blocks: TextBlock[]
}

const parse = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml')
const serialize = (doc: Document): string => {
  const s = new XMLSerializer().serializeToString(doc)
  return s.startsWith('<?xml') ? s : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s
}
const els = (root: Document | Element, ns: string, tag: string): Element[] => Array.from(root.getElementsByTagNameNS(ns, tag))
const kids = (el: Element, ns: string, tag: string): Element[] => Array.from(el.children).filter((c) => c.namespaceURI === ns && c.localName === tag)

/** 'ppt/slides/slide1.xml' 의 관계 파일 경로 */
const relsPath = (part: string): string => part.replace(/([^/]+)$/, '_rels/$1.rels')

/** 관계 대상(상대 경로)을 패키지 안의 절대 경로로 */
function resolveTarget(fromPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = fromPart.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

/** 문단의 글자 (줄바꿈 a:br 은 세로 탭으로 보존해 다시 쓸 때 되살린다) */
function paragraphText(p: Element): string {
  let s = ''
  for (const c of Array.from(p.children)) {
    if (c.namespaceURI !== NS.a) continue
    if (c.localName === 'r' || c.localName === 'fld') s += kids(c, NS.a, 't').map((t) => t.textContent ?? '').join('')
    else if (c.localName === 'br') s += '\u000b'
  }
  return s
}

/** 문단의 글자를 바꾼다. 첫 글자의 서식(a:rPr)을 새 글자에 그대로 쓴다. */
function setParagraphText(doc: Document, p: Element, text: string): void {
  const runs = Array.from(p.children).filter((c) => c.namespaceURI === NS.a && ['r', 'br', 'fld'].includes(c.localName))
  const firstRun = runs.find((c) => c.localName === 'r' || c.localName === 'fld')
  const rPr = firstRun ? kids(firstRun, NS.a, 'rPr')[0] : undefined
  for (const r of runs) r.remove()
  const end = kids(p, NS.a, 'endParaRPr')[0] ?? null
  text.split('\u000b').forEach((piece, i) => {
    if (i > 0) {
      const br = doc.createElementNS(NS.a, 'a:br')
      if (rPr) br.appendChild(rPr.cloneNode(true))
      p.insertBefore(br, end)
    }
    if (piece === '') return
    const r = doc.createElementNS(NS.a, 'a:r')
    if (rPr) r.appendChild(rPr.cloneNode(true))
    const t = doc.createElementNS(NS.a, 'a:t')
    if (/^\s|\s$/.test(piece)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
    t.textContent = piece
    r.appendChild(t)
    p.insertBefore(r, end)
  })
}

/** 글자 묶음(p:txBody / a:txBody)마다 이름을 붙인다 */
function blockName(body: Element, index: number): string {
  const tc = body.parentElement?.localName === 'tc' ? body.parentElement : null
  if (tc) {
    const tr = tc.parentElement!
    const tbl = tr.parentElement!
    const row = kids(tbl, NS.a, 'tr').indexOf(tr) + 1
    const col = kids(tr, NS.a, 'tc').indexOf(tc) + 1
    let frame: Element | null = tbl
    while (frame && frame.localName !== 'graphicFrame') frame = frame.parentElement
    const name = frame ? els(frame, NS.p, 'cNvPr')[0]?.getAttribute('name') : null
    return `${name ?? '표'} · ${row}행 ${col}열`
  }
  const sp = body.parentElement
  const name = sp ? els(sp, NS.p, 'cNvPr')[0]?.getAttribute('name') : null
  return name ?? `글상자 ${index + 1}`
}

export class PptxDoc {
  private zip: JSZip
  private pres!: Document
  private presRels!: Document
  private contentTypes!: Document
  /** 슬라이드 경로 → 파싱한 XML (고친 것은 저장할 때 다시 씀) */
  private slides = new Map<string, Document>()
  /** 보이는 순서대로의 슬라이드 경로 */
  order: string[] = []
  /** 슬라이드 크기 (EMU) */
  size = { cx: 12192000, cy: 6858000 }

  private constructor(zip: JSZip) {
    this.zip = zip
  }

  static async load(data: ArrayBuffer | Uint8Array): Promise<PptxDoc> {
    const doc = new PptxDoc(await JSZip.loadAsync(data))
    await doc.init()
    return doc
  }

  private async read(path: string): Promise<Document> {
    const f = this.zip.file(path)
    if (!f) throw new Error(`pptx 안에 ${path} 가 없습니다.`)
    return parse(await f.async('string'))
  }

  private async init(): Promise<void> {
    this.pres = await this.read('ppt/presentation.xml')
    this.presRels = await this.read(relsPath('ppt/presentation.xml'))
    this.contentTypes = await this.read('[Content_Types].xml')
    const sz = els(this.pres, NS.p, 'sldSz')[0]
    if (sz) this.size = { cx: Number(sz.getAttribute('cx')), cy: Number(sz.getAttribute('cy')) }
    const rels = new Map(els(this.presRels, NS.rel, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']))
    this.order = els(this.pres, NS.p, 'sldId').map((s) => resolveTarget('ppt/presentation.xml', rels.get(s.getAttributeNS(NS.r, 'id')) ?? ''))
    for (const path of this.order) this.slides.set(path, await this.read(path))
  }

  private textBodies(path: string): Element[] {
    const doc = this.slides.get(path)!
    return [...els(doc, NS.p, 'txBody'), ...els(doc, NS.a, 'txBody')]
  }

  slideInfo(index: number): SlideInfo {
    const path = this.order[index]
    const blocks = this.textBodies(path).map((body, i) => ({ name: blockName(body, i), text: kids(body, NS.a, 'p').map(paragraphText).join('\n') }))
    return { path, blocks }
  }

  /** 글자 묶음의 내용을 바꾼다. 줄마다 한 문단 — 늘어난 줄은 마지막 문단의 모양을 복사해 쓴다. */
  setText(index: number, block: number, text: string): void {
    const path = this.order[index]
    const doc = this.slides.get(path)!
    const body = this.textBodies(path)[block]
    if (!body) return
    const paras = kids(body, NS.a, 'p')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      let p = paras[i]
      if (!p) {
        p = paras[paras.length - 1].cloneNode(true) as Element
        body.appendChild(p)
        paras.push(p)
      }
      setParagraphText(doc, p, line)
    })
    // 글자 묶음에는 문단이 하나 이상 있어야 한다
    for (const p of paras.slice(Math.max(1, lines.length))) p.remove()
  }

  private nextSlideNumber(): number {
    let n = 0
    this.zip.forEach((p) => {
      const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(p)
      if (m) n = Math.max(n, Number(m[1]))
    })
    return n + 1
  }

  private nextRelId(): string {
    let n = 0
    for (const r of els(this.presRels, NS.rel, 'Relationship')) {
      const m = /^rId(\d+)$/.exec(r.getAttribute('Id') ?? '')
      if (m) n = Math.max(n, Number(m[1]))
    }
    return `rId${n + 1}`
  }

  private sldIds(): Element[] {
    return els(this.pres, NS.p, 'sldId')
  }

  /** 슬라이드를 복사해 바로 뒤에 넣는다 (발표자 노트는 복사하지 않음) */
  async duplicate(index: number): Promise<void> {
    this.flush()
    const src = this.order[index]
    const n = this.nextSlideNumber()
    const path = `ppt/slides/slide${n}.xml`
    this.zip.file(path, await this.zip.file(src)!.async('uint8array'))
    const srcRels = this.zip.file(relsPath(src))
    if (srcRels) {
      const rels = parse(await srcRels.async('string'))
      for (const r of els(rels, NS.rel, 'Relationship')) if (r.getAttribute('Type') === NOTES_TYPE) r.remove()
      this.zip.file(relsPath(path), serialize(rels))
    }
    const types = this.contentTypes.documentElement
    const ov = this.contentTypes.createElementNS(NS.ct, 'Override')
    ov.setAttribute('PartName', '/' + path)
    ov.setAttribute('ContentType', SLIDE_CT)
    types.appendChild(ov)

    const rid = this.nextRelId()
    const rel = this.presRels.createElementNS(NS.rel, 'Relationship')
    rel.setAttribute('Id', rid)
    rel.setAttribute('Type', SLIDE_TYPE)
    rel.setAttribute('Target', `slides/slide${n}.xml`)
    this.presRels.documentElement.appendChild(rel)

    const ids = this.sldIds()
    const sld = this.pres.createElementNS(NS.p, 'p:sldId')
    sld.setAttribute('id', String(Math.max(255, ...ids.map((s) => Number(s.getAttribute('id')))) + 1))
    sld.setAttributeNS(NS.r, 'r:id', rid)
    ids[index].after(sld)

    this.slides.set(path, await this.read(path))
    this.order.splice(index + 1, 0, path)
  }

  /** 슬라이드와 그 노트를 패키지에서 지운다 */
  async remove(index: number): Promise<void> {
    if (this.order.length <= 1) throw new Error('슬라이드가 하나뿐이라 지울 수 없습니다.')
    this.flush()
    const path = this.order[index]
    const sld = this.sldIds()[index]
    const rid = sld.getAttributeNS(NS.r, 'id')
    sld.remove()
    for (const r of els(this.presRels, NS.rel, 'Relationship')) if (r.getAttribute('Id') === rid) r.remove()

    const parts = [path]
    const rels = this.zip.file(relsPath(path))
    if (rels) {
      for (const r of els(parse(await rels.async('string')), NS.rel, 'Relationship')) {
        if (r.getAttribute('Type') === NOTES_TYPE) parts.push(resolveTarget(path, r.getAttribute('Target') ?? ''))
      }
    }
    for (const part of parts) {
      this.zip.remove(part)
      this.zip.remove(relsPath(part))
      for (const o of els(this.contentTypes, NS.ct, 'Override')) if (o.getAttribute('PartName') === '/' + part) o.remove()
    }
    this.slides.delete(path)
    this.order.splice(index, 1)
  }

  /** 슬라이드를 앞뒤로 옮긴다 (delta: -1 위로, +1 아래로) */
  move(index: number, delta: number): void {
    const to = index + delta
    if (to < 0 || to >= this.order.length) return
    const ids = this.sldIds()
    const el = ids[index]
    if (delta < 0) ids[to].before(el)
    else ids[to].after(el)
    const [p] = this.order.splice(index, 1)
    this.order.splice(to, 0, p)
  }

  /** 고친 XML 을 압축 묶음에 다시 쓴다 */
  private flush(): void {
    this.zip.file('ppt/presentation.xml', serialize(this.pres))
    this.zip.file(relsPath('ppt/presentation.xml'), serialize(this.presRels))
    this.zip.file('[Content_Types].xml', serialize(this.contentTypes))
    for (const [path, doc] of this.slides) this.zip.file(path, serialize(doc))
  }

  async toBytes(): Promise<Uint8Array> {
    this.flush()
    return this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  }
}
