import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/app.css'

// 운영체제별 화면 차이(창 버튼 자리 등)를 CSS 에서 고를 수 있게 표시한다
document.documentElement.dataset.platform = window.api.platform

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
