import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const container = document.getElementById('root')!;

// 1. react-snap이 미리 그려둔 HTML 뼈대(자식 노드)가 존재하는지 확인
if (container.hasChildNodes()) {
  // 이미 로봇용 HTML이 있다면, 화면을 다시 그리지 않고 기능만 살짝 연결 (Hydrate)
  hydrateRoot(
    container,
    <StrictMode>
      <App />
    </StrictMode>
  );
} else {
  // 로봇용 HTML이 없는 텅 빈 상태라면, 평소처럼 처음부터 새로 그리기
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}