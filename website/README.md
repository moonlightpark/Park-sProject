# 박프로 웹사이트

박프로 소개용 정적 웹사이트입니다. 빌드 과정 없이 HTML·CSS·JS 세 파일과 `images/` 로 되어 있습니다.

## 미리 보기

```bash
cd website
python3 -m http.server 8765
# http://127.0.0.1:8765 열기
```

## 구성

- `index.html` — 소개, 파일 형식, 한글, AI, 트래커, 개인정보, 오픈소스, 설치
- `style.css` — 앱 아이콘의 보라색 기준, 다크 모드·모바일 대응
- `script.js` — 파일 형식 탭 전환, GitHub 최신 릴리스에서 버전·설치 파일 주소 채우기
- `images/` — 앱 화면 스크린샷(WebP, 2배 해상도), 공유용 미리보기 `og.jpg`

내려받기 버튼은 GitHub API(`releases/latest`)로 최신 `.dmg`·`.exe` 주소를 넣고, 실패하면 릴리스 페이지로 연결됩니다.

## 배포

`main` 에 `website/` 변경이 올라오면 `.github/workflows/pages.yml` 이 GitHub Pages 로 배포합니다.

- 주소: https://moonlightpark.github.io/Park-sProject/
- 앱 코드만 바꾼 푸시나 버전 태그(앱 배포)에는 반응하지 않습니다.
- Actions 탭에서 `pages` 워크플로를 손으로 다시 돌릴 수도 있습니다.
