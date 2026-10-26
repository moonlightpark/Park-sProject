// 박프로 웹사이트: 파일 형식 탭, 최신 릴리스 내려받기 주소, 스크롤 등장 효과
;(() => {
  const REPO = 'moonlightpark/Park-sProject'

  // 파일 형식 탭 → 스크린샷 바꾸기
  const SHOTS = {
    md: ['마크다운 문서를 표·체크리스트와 함께 편집하는 화면', '제목·표·체크리스트가 보이는 그대로 편집되고, 버튼 하나로 원문 마크다운으로 바꿔 볼 수 있습니다.'],
    hwp: ['한글 문서를 편집기 메뉴·도구 막대와 함께 연 화면', '한글 파일을 앱 안에서 고치고 .hwp 그대로 저장합니다.'],
    csv: ['CSV 파일을 엑셀처럼 셀 단위로 편집하는 화면', '셀을 바로 고치고, =SUM(B2:D2) 같은 수식과 정렬·행 추가를 씁니다. 저장은 CSV 그대로.'],
    pptx: ['파워포인트 슬라이드와 오른쪽 글자 편집 패널', '슬라이드를 보면서 오른쪽에서 글자를 고치고, 슬라이드를 복제·삭제·이동합니다.'],
    sql: ['SQL 파일의 테이블과 외래 키 관계를 그린 관계도', 'CREATE TABLE을 읽어 테이블과 관계를 자동으로 그립니다. 오른쪽 아래 "소스 보기"로 바로 수정합니다.'],
    excalidraw: ['Excalidraw 손그림 다이어그램 편집 화면', '.excalidraw 파일을 열어 손그림 다이어그램을 그리고 저장합니다.']
  }
  const img = document.getElementById('format-shot')
  const cap = document.getElementById('format-caption')
  const tabs = [...document.querySelectorAll('.tabs [role=tab]')]
  const select = (btn) => {
    const key = btn.dataset.shot
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b === btn)))
    img.classList.add('fading')
    const next = new Image()
    next.onload = next.onerror = () => {
      img.src = next.src
      img.alt = SHOTS[key][0]
      cap.textContent = SHOTS[key][1]
      img.classList.remove('fading')
    }
    next.src = `images/${key}.webp`
  }
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => select(b))
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      const t = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
      t.focus()
      select(t)
    })
  })
  // 미리 받아 두기
  Object.keys(SHOTS).forEach((k) => (new Image().src = `images/${k}.webp`))

  // 최신 릴리스: 버전과 설치 파일 주소 채우기 (실패하면 릴리스 페이지 링크 그대로)
  const info = document.querySelector('[data-dl-info]')
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rel) => {
      const find = (re) => rel.assets.find((a) => re.test(a.name))
      const mac = find(/arm64\.dmg$/i)
      const win = find(/setup\.exe$/i)
      if (mac) document.querySelectorAll('[data-dl=mac]').forEach((a) => (a.href = mac.browser_download_url))
      if (win) document.querySelectorAll('[data-dl=win]').forEach((a) => (a.href = win.browser_download_url))
      document.querySelectorAll('[data-version]').forEach((el) => (el.textContent = rel.tag_name))
      const mb = (a) => (a ? `${Math.round(a.size / 1048576)}MB` : '')
      const date = new Date(rel.published_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
      if (info) info.textContent = `${rel.tag_name} · ${date} · macOS ${mb(mac)} · Windows ${mb(win)}`
    })
    .catch(() => {
      if (info) info.innerHTML = `<a href="https://github.com/${REPO}/releases" target="_blank" rel="noopener">릴리스 페이지</a>에서 받을 수 있습니다.`
    })

  // 스크롤하면 부드럽게 나타나기
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const els = document.querySelectorAll('.section .wrap > *, .shot-hero')
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('shown')
            io.unobserve(e.target)
          }
        }),
      { rootMargin: '0px 0px -8% 0px' }
    )
    els.forEach((el) => {
      el.classList.add('reveal')
      io.observe(el)
    })
  }
})()
