import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { SettingsStandalone } from './components/layout/SettingsStandalone'

// ?view=settings：作为独立设置窗口挂载（不走主 App 的外壳与启动流程）。
const SETTINGS_VIEW = typeof window !== 'undefined' && /[?&]view=settings\b/.test(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 顶层兜底：任何未被内层捕获的崩溃都显示错误卡(可重试)，而不是整窗白屏。 */}
    <ErrorBoundary>
      {SETTINGS_VIEW ? <SettingsStandalone /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
