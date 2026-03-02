import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import type { PageId } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ToastContainer } from './components/common/Toast';
import { Modal } from './components/common/Modal';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Setup } from './pages/Setup';
import { useKeyboardShortcuts, shortcutList } from './hooks/useKeyboardShortcuts';
import { useFileWatcher } from './hooks/useFileWatcher';
import { setPluginDir } from './lib/tauri-commands';
import { useUiStore } from './stores/uiStore';

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const CommandManager = lazy(() => import('./pages/CommandManager').then((m) => ({ default: m.CommandManager })));
const PersonalityManager = lazy(() => import('./pages/PersonalityManager').then((m) => ({ default: m.PersonalityManager })));
const MemoryViewer = lazy(() => import('./pages/MemoryViewer').then((m) => ({ default: m.MemoryViewer })));
const ConfigEditor = lazy(() => import('./pages/ConfigEditor').then((m) => ({ default: m.ConfigEditor })));
const ApiManager = lazy(() => import('./pages/ApiManager').then((m) => ({ default: m.ApiManager })));
const HistoryViewer = lazy(() => import('./pages/HistoryViewer').then((m) => ({ default: m.HistoryViewer })));

const pageTitles: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: { title: '概览', subtitle: '系统状态总览' },
  api: { title: 'API管理', subtitle: '管理API节点、密钥和模型配置' },
  config: { title: '配置编辑', subtitle: '可视化编辑运行时配置' },
  personality: { title: '人格管理', subtitle: '编辑群聊和私聊人格系统提示词' },
  memory: { title: '长期记忆', subtitle: '查看和管理对话记忆' },
  history: { title: '历史记录', subtitle: '解析和分析对话历史日志' },
  commands: { title: '命令管理', subtitle: '管理命令回避列表' },
};

const scaleOptions = [
  { label: '80%', value: 0.8 },
  { label: '90%', value: 0.9 },
  { label: '100%', value: 1.0 },
  { label: '110%', value: 1.1 },
  { label: '120%', value: 1.2 },
  { label: '130%', value: 1.3 },
];

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <span className="text-4xl block mb-3 animate-bounce">🐱</span>
        <p className="text-[var(--text-secondary)]">加载中...</p>
      </div>
    </div>
  );
}

type AppPhase = 'initializing' | 'setup' | 'ready';

function App() {
  const [phase, setPhase] = useState<AppPhase>(() =>
    localStorage.getItem('nekoai-configured') === 'true' ? 'initializing' : 'setup'
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { title, subtitle } = pageTitles[activePage];

  const settings = useUiStore((s) => s.settings);
  const updateSettings = useUiStore((s) => s.updateSettings);
  const scale = settings.uiScale;

  const toggleHelp = useCallback(() => setShowHelp((v) => !v), []);

  // Restore plugin dir on startup
  useEffect(() => {
    if (phase !== 'initializing') return;
    const savedDir = localStorage.getItem('nekoai-plugin-dir');
    if (!savedDir) {
      localStorage.removeItem('nekoai-configured');
      setPhase('setup');
      return;
    }
    setPluginDir(savedDir)
      .then(() => setPhase('ready'))
      .catch(() => {
        localStorage.removeItem('nekoai-configured');
        localStorage.removeItem('nekoai-plugin-dir');
        setPhase('setup');
      });
  }, [phase]);

  const ready = phase === 'ready';

  useKeyboardShortcuts({
    onNavigate: ready ? setActivePage : undefined,
    onToggleHelp: ready ? toggleHelp : undefined,
  });

  useFileWatcher();

  function handleSetupComplete() {
    setRefreshKey((k) => k + 1);
    setActivePage('dashboard');
    setPhase('ready');
  }

  function handleChangeDir() {
    localStorage.removeItem('nekoai-configured');
    setPhase('setup');
  }

  // Build content based on phase
  let content: React.ReactNode;

  if (phase === 'initializing') {
    content = (
      <div className="flex items-center justify-center h-full w-full">
        <div className="text-center">
          <span className="text-5xl block mb-4 animate-bounce">🐱</span>
          <p className="text-sm text-[var(--text-secondary)]">正在连接插件目录...</p>
        </div>
      </div>
    );
  } else if (phase === 'setup') {
    content = (
      <>
        <Setup onComplete={handleSetupComplete} />
        <ToastContainer />
      </>
    );
  } else {
    content = (
      <ErrorBoundary onReset={handleChangeDir}>
        <div className="flex h-full w-full overflow-hidden">
          <Sidebar
            activePage={activePage}
            onNavigate={setActivePage}
            onChangeDir={handleChangeDir}
            onOpenSettings={() => setShowSettings(true)}
          />
          <main className="flex-1 flex flex-col overflow-hidden">
            <Header
              title={title}
              subtitle={subtitle}
              actions={
                <button
                  onClick={toggleHelp}
                  className="text-xs px-2 py-1 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                  title="快捷键帮助 (Ctrl+/)"
                >
                  ⌨
                </button>
              }
            />
            <div className="flex-1 overflow-y-auto p-6">
              <Suspense fallback={<PageFallback />}>
                {activePage === 'dashboard' && <Dashboard key={refreshKey} />}
                {activePage === 'commands' && <CommandManager key={refreshKey} />}
                {activePage === 'personality' && <PersonalityManager key={refreshKey} />}
                {activePage === 'memory' && <MemoryViewer key={refreshKey} />}
                {activePage === 'config' && <ConfigEditor key={refreshKey} />}
                {activePage === 'api' && <ApiManager key={refreshKey} />}
                {activePage === 'history' && <HistoryViewer key={refreshKey} />}
              </Suspense>
            </div>
            <ToastContainer />
          </main>

          {/* Help modal */}
          <Modal open={showHelp} onClose={() => setShowHelp(false)} title="快捷键" width="360px">
            <div className="space-y-2">
              {shortcutList.map((s) => (
                <div key={s.keys} className="flex items-center justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">{s.desc}</span>
                  <kbd className="px-2 py-0.5 text-xs mono rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--accent-purple)]">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </Modal>

          {/* Settings modal */}
          <Modal open={showSettings} onClose={() => setShowSettings(false)} title="显示设置" width="420px">
            <div className="space-y-5">
              <div>
                <label className="text-sm text-[var(--text-secondary)] mb-3 block">界面缩放</label>
                <div className="grid grid-cols-6 gap-1.5">
                  {scaleOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateSettings({ uiScale: opt.value })}
                      className={`py-2 text-sm rounded-[var(--radius-sm)] font-medium cursor-pointer
                        ${settings.uiScale === opt.value
                          ? 'bg-[var(--accent-purple)] text-white'
                          : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  调整界面整体大小，包括文字和控件
                </p>
              </div>

              <div className="border-t border-[var(--border-subtle)]" />

              <div className="space-y-1">
                <button
                  onClick={() => { setShowSettings(false); handleChangeDir(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-sm)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <span>📂</span> 重新选择插件目录
                </button>
                <button
                  onClick={() => updateSettings({ uiScale: 1.0 })}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-sm)] text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <span>↩</span> 恢复默认设置
                </button>
              </div>
            </div>
          </Modal>
        </div>
      </ErrorBoundary>
    );
  }

  // Scaling wrapper: transform + inverse-size to fit the viewport exactly
  return (
    <div
      style={{
        width: `${100 / scale}vw`,
        height: `${100 / scale}vh`,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }}
    >
      {content}
    </div>
  );
}

export default App;
