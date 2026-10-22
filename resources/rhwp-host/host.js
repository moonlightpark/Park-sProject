// 박프로 ↔ rhwp 편집기 연결 페이지.
// 앱(부모 창)이 이 페이지를 iframe 으로 띄우고, 이 페이지가 같은 로컬 서버의 rhwp-studio 를 다시 iframe 으로 띄운다.
// 파일은 로컬 서버의 /__file 로 읽고 쓰며 (토큰 필요), 앱과는 postMessage 로 상태(수정됨·저장됨)와 저장 명령을 주고받는다.
import { createEditor } from './editor/index.js'

const params = new URLSearchParams(location.search)
const token = params.get('token')
const path = params.get('path')
const fileName = path.split(/[\\/]/).pop()
const isHwpx = /\.hwpx$/i.test(fileName)
const status = document.getElementById('status')

const tell = (type, extra = {}) => parent.postMessage({ source: 'bakpro-hwp', type, ...extra }, '*')
const fileUrl = (p) => `/__file?token=${encodeURIComponent(token)}&path=${encodeURIComponent(p)}`

let editor = null
let dirty = false

async function main() {
  editor = await createEditor('#editor', { studioUrl: new URL('/', location.href).href })
  const res = await fetch(fileUrl(path))
  if (!res.ok) throw new Error(await res.text())
  const result = await editor.loadFile(new Uint8Array(await res.arrayBuffer()), fileName)
  status.remove()
  tell('loaded', { pageCount: result.pageCount, canSave: !isHwpx })
  // 편집기는 사용자 편집을 이벤트로 알려 주지 않으므로 '수정됨' 상태를 주기적으로 확인한다
  setInterval(async () => {
    try {
      const now = !!(await editor.commands.context()).isDirty
      if (now !== dirty) tell(now ? 'dirty' : 'clean')
      dirty = now
    } catch {
      /* 편집기가 바쁠 때는 다음에 다시 */
    }
  }, 700)
}

/** HWP 로 내보내 저장한다. HWPX 는 HOP 처럼 원본에 덮어쓰지 않고 같은 이름의 .hwp 로 저장한다. */
async function save(id) {
  try {
    const bytes = await editor.exportHwp()
    const target = isHwpx ? path.replace(/\.hwpx$/i, '.hwp') : path
    const res = await fetch(fileUrl(target), { method: 'POST', body: bytes })
    if (!res.ok) throw new Error(await res.text())
    await editor.notifySaved(target.split(/[\\/]/).pop()).catch(() => undefined)
    dirty = false
    tell('saved', { id, path: target })
  } catch (e) {
    tell('error', { id, message: String(e?.message ?? e) })
  }
}

window.addEventListener('message', (e) => {
  // 앱(부모 창)이 보낸 명령만 받는다
  if (e.source !== parent || e.data?.target !== 'bakpro-hwp') return
  if (e.data.type === 'save') void save(e.data.id)
})

main().catch((e) => {
  status.textContent = `문서를 열 수 없습니다: ${e?.message ?? e}`
  tell('error', { message: String(e?.message ?? e) })
})
