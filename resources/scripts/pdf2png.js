// macOS 내장 JXA(osascript -l JavaScript) — 폴더 안의 PDF 들을 '이름.pdf.png' 로 그린다 (첫 쪽, 2배 해상도).
// Quick Look 이 만든 .ppt 미리보기는 도형을 PDF 이미지로 쓰는데, Chromium 은 <img> 의 PDF 를 그리지 못해서 바꿔 준다.
//   osascript -l JavaScript pdf2png.js <폴더> [배율]
ObjC.import('AppKit')
ObjC.import('Quartz')

function run(argv) {
  const dir = argv[0]
  const scale = Number(argv[1] || 2)
  const fm = $.NSFileManager.defaultManager
  const names = ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError(dir, null)) || []
  let done = 0
  for (const name of names) {
    if (!/\.pdf$/i.test(name)) continue
    const src = dir + '/' + name
    const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(src))
    if (!doc || doc.pageCount < 1) continue
    const page = doc.pageAtIndex(0)
    const box = page.boundsForBox($.kPDFDisplayBoxMediaBox)
    const w = Math.max(1, Math.round(box.size.width * scale))
    const h = Math.max(1, Math.round(box.size.height * scale))
    const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null, w, h, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0)
    const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep)
    $.NSGraphicsContext.saveGraphicsState
    $.NSGraphicsContext.setCurrentContext(ctx)
    const cg = ctx.CGContext
    $.CGContextScaleCTM(cg, scale, scale)
    page.drawWithBoxToContext($.kPDFDisplayBoxMediaBox, cg)
    ctx.flushGraphics
    $.NSGraphicsContext.restoreGraphicsState
    const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}))
    png.writeToFileAtomically(src + '.png', true)
    done++
  }
  return String(done)
}
