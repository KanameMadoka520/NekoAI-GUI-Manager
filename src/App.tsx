import { useState, useEffect, useCallback, lazy, Suspense, useRef } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import type { PageId } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { CustomTitlebar } from './components/layout/CustomTitlebar';
import { AmbientFx } from './components/layout/AmbientFx';
import { ToastContainer } from './components/common/Toast';
import { Modal } from './components/common/Modal';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Setup } from './pages/Setup';
import { useKeyboardShortcuts, shortcutList } from './hooks/useKeyboardShortcuts';
import { useFileWatcher } from './hooks/useFileWatcher';
import { setPluginDir, runStartupSelfCheck, applySelfCheckFixes } from './lib/tauri-commands';
import type { SelfCheckReport } from './lib/types';
import { useUiStore } from './stores/uiStore';

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const CommandManager = lazy(() => import('./pages/CommandManager').then((m) => ({ default: m.CommandManager })));
const PersonalityManager = lazy(() => import('./pages/PersonalityManager').then((m) => ({ default: m.PersonalityManager })));
const MemoryViewer = lazy(() => import('./pages/MemoryViewer').then((m) => ({ default: m.MemoryViewer })));
const ConfigEditor = lazy(() => import('./pages/ConfigEditor').then((m) => ({ default: m.ConfigEditor })));
const ApiManager = lazy(() => import('./pages/ApiManager').then((m) => ({ default: m.ApiManager })));
const HistoryViewer = lazy(() => import('./pages/HistoryViewer').then((m) => ({ default: m.HistoryViewer })));
const OpsCenter = lazy(() => import('./pages/OpsCenter').then((m) => ({ default: m.OpsCenter })));
const pageTitles: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: { title: '概览', subtitle: '系统状态总览' },
  api: { title: 'API管理', subtitle: '管理API节点、密钥和模型配置' },
  config: { title: '配置编辑', subtitle: '可视化编辑运行时配置' },
  personality: { title: '人格管理', subtitle: '编辑群聊和私聊人格系统提示词' },
  memory: { title: '长期记忆', subtitle: '查看和管理对话记忆' },
  history: { title: '历史记录', subtitle: '解析和分析对话历史日志' },
  commands: { title: '命令管理', subtitle: '管理命令回避列表' },
  ops: { title: '安全发布中心', subtitle: '快照、部署包、环境模板与启动自检' },
};

const scaleOptions = [
  { label: '80%', value: 0.8 },
  { label: '90%', value: 0.9 },
  { label: '100%', value: 1.0 },
  { label: '110%', value: 1.1 },
  { label: '120%', value: 1.2 },
  { label: '130%', value: 1.3 },
];

const themeOptions = [
  { label: '亮色', value: 'light' as const },
  { label: '暗色', value: 'dark' as const },
  { label: '羊皮纸', value: 'parchment' as const },
];

const densityOptions = [
  { label: '轻', value: 'low' as const },
  { label: '中', value: 'medium' as const },
  { label: '重', value: 'high' as const },
];

const contentDensityOptions = [
  { label: '紧凑', value: 'compact' as const },
  { label: '标准', value: 'standard' as const },
  { label: '舒展', value: 'spacious' as const },
];

const stylePresetOptions = [
  { label: '自动', value: 'auto' as const },
  { label: '网络', value: 'network' as const },
  { label: '轨道', value: 'orbital' as const },
  { label: '蓝图', value: 'blueprint' as const },
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
  const [pendingConfigRefresh, setPendingConfigRefresh] = useState(false);
  const [startupCheck, setStartupCheck] = useState<SelfCheckReport | null>(null);
  const [showStartupCheck, setShowStartupCheck] = useState(false);
  const [startupCheckBusy, setStartupCheckBusy] = useState(false);
  const { title, subtitle } = pageTitles[activePage];

  const settings = useUiStore((s) => s.settings);
  const updateSettings = useUiStore((s) => s.updateSettings);
  const addToast = useUiStore((s) => s.addToast);
  const scale = settings.uiScale;
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    if (phase !== 'ready') return;
    let cancelled = false;

    async function runCheck() {
      try {
        const report = await runStartupSelfCheck();
        if (cancelled) return;
        setStartupCheck(report);
        if (!report.ok || report.items.length > 0) {
          setShowStartupCheck(true);
          addToast('warning', `启动自检发现 ${report.items.length} 项，请确认后继续`);
        }
      } catch {
        // ignore self-check failure at startup to avoid blocking app
      }
    }

    runCheck();
    return () => {
      cancelled = true;
    };
  }, [phase, addToast]);

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
  const ambientEnabled = ready && (activePage === 'dashboard' || activePage === 'ops');

  useKeyboardShortcuts({
    onNavigate: ready ? setActivePage : undefined,
    onToggleHelp: ready ? toggleHelp : undefined,
  });

  useFileWatcher(
    async () => {
      setPendingConfigRefresh(true);
    },
    () => {
      // memory page handles its own refresh to avoid global interruptions
    },
  );

  async function handleRefreshCurrentPage() {
    setPendingConfigRefresh(false);

    try {
      const savedDir = localStorage.getItem('nekoai-plugin-dir');
      if (savedDir) {
        await setPluginDir(savedDir);
      }

      if (activePage === 'config' || activePage === 'api' || activePage === 'personality' || activePage === 'commands' || activePage === 'dashboard' || activePage === 'memory' || activePage === 'history' || activePage === 'ops') {
        setRefreshKey((k) => k + 1);
      }
    } catch {
      // keep silent; setup flow will recover if dir became invalid
    }
  }

  async function handleStartupAutoFix() {
    setStartupCheckBusy(true);
    try {
      const changes = await applySelfCheckFixes();
      const report = await runStartupSelfCheck();
      setStartupCheck(report);
      setRefreshKey((k) => k + 1);
      addToast('success', changes.length > 0 ? `已自动修复 ${changes.length} 项` : '未发现可自动修复项');
      if (report.ok || report.items.length === 0) {
        setShowStartupCheck(false);
      }
    } catch (e: any) {
      addToast('error', `自动修复失败: ${e?.message ?? e}`);
    } finally {
      setStartupCheckBusy(false);
    }
  }

  function handleSetupComplete() {
    setRefreshKey((k) => k + 1);
    setActivePage('dashboard');
    setPhase('ready');
  }

  function handleChangeDir() {
    localStorage.removeItem('nekoai-configured');
    setPhase('setup');
  }

  function toggleSidebar() {
    updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed });
  }

  function beginResize(e: { clientX: number }) {
    if (settings.sidebarCollapsed) return;
    resizeRef.current = { startX: e.clientX, startWidth: settings.sidebarWidth };

    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = ev.clientX - resizeRef.current.startX;
      const next = Math.max(180, Math.min(340, resizeRef.current.startWidth + delta));
      updateSettings({ sidebarWidth: next });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      resizeRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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
            onToggleCollapse={toggleSidebar}
            collapsed={settings.sidebarCollapsed}
            width={settings.sidebarWidth}
          />
          {!settings.sidebarCollapsed && (
            <div
              className="w-1 cursor-col-resize bg-transparent hover:bg-[var(--border-hover)] transition-colors"
              onMouseDown={beginResize}
              title="拖动调整侧栏宽度"
            />
          )}
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
                {activePage === 'ops' && <OpsCenter key={refreshKey} />}
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

          {/* External change refresh hint */}
          <Modal
            open={pendingConfigRefresh}
            onClose={() => { setPendingConfigRefresh(false); }}
            title="检测到外部修改"
            width="460px"
          >
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                外侧配置文件已被修改。是否刷新当前页面以获取最新配置信息？
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setPendingConfigRefresh(false); }}
                  className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  稍后
                </button>
                <button
                  onClick={handleRefreshCurrentPage}
                  className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 transition-colors cursor-pointer"
                >
                  刷新页面
                </button>
              </div>
            </div>
          </Modal>

          {/* Startup self-check dialog */}
          <Modal
            open={showStartupCheck}
            onClose={() => setShowStartupCheck(false)}
            title="启动前自检结果"
            width="640px"
          >
            <div className="space-y-3">
              <p className="text-sm text-[var(--text-secondary)]">
                {startupCheck
                  ? `检测到 ${startupCheck.items.length} 项（错误 ${startupCheck.items.filter((x) => x.level === 'error').length} / 警告 ${startupCheck.items.filter((x) => x.level === 'warn').length}）`
                  : '暂无自检结果'}
              </p>
              {startupCheck?.report_path && (
                <p className="text-xs text-[var(--text-muted)] mono break-all">报告文件：{startupCheck.report_path}</p>
              )}
              <div className="max-h-56 overflow-y-auto border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2 space-y-1">
                {(startupCheck?.items ?? []).length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">无异常项</p>
                ) : (
                  startupCheck!.items.map((item, idx) => (
                    <p key={`${item.code}-${idx}`} className="text-xs text-[var(--text-secondary)]">
                      [{item.level}] {item.message}
                    </p>
                  ))
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowStartupCheck(false)}
                  className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  稍后处理
                </button>
                <button
                  onClick={handleStartupAutoFix}
                  disabled={startupCheckBusy}
                  className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {startupCheckBusy ? '修复中...' : '自动修复可修项'}
                </button>
              </div>
            </div>
          </Modal>

          {/* Settings modal */}
          <Modal open={showSettings} onClose={() => setShowSettings(false)} title="显示设置" width="420px">
            <div className="space-y-5">
              <div>
                <label className="text-sm text-[var(--text-secondary)] mb-3 block">主题</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {themeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateSettings({ theme: opt.value })}
                      className={`py-2 text-sm rounded-[var(--radius-sm)] font-medium border cursor-pointer
                        ${settings.theme === opt.value
                          ? 'bg-[var(--accent-purple)] text-white border-transparent'
                          : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  可选亮色、暗色与羊皮纸主题
                </p>
              </div>

              <div className="border-t border-[var(--border-subtle)]" />

              <div>
                <label className="text-sm text-[var(--text-secondary)] mb-3 block">漂浮密度</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {densityOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateSettings({ ambientDensity: opt.value })}
                      className={`py-2 text-sm rounded-[var(--radius-sm)] font-medium border cursor-pointer
                        ${settings.ambientDensity === opt.value
                          ? 'bg-[var(--accent-purple)] text-white border-transparent'
                          : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  控制背景字符与几何漂浮数量
                </p>
              </div>

              <div className="border-t border-[var(--border-subtle)]" />

              <div>
                <label className="text-sm text-[var(--text-secondary)] mb-3 block">几何风格</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {stylePresetOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateSettings({ ambientStyle: opt.value })}
                      className={`py-2 text-sm rounded-[var(--radius-sm)] font-medium border cursor-pointer
                        ${settings.ambientStyle === opt.value
                          ? 'bg-[var(--accent-purple)] text-white border-transparent'
                          : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  选择高级几何图形风格预设
                </p>
              </div>

              <div className="border-t border-[var(--border-subtle)]" />

              <div>
                <label className="text-sm text-[var(--text-secondary)] mb-3 block">内容密度</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {contentDensityOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateSettings({ contentDensity: opt.value })}
                      className={`py-2 text-sm rounded-[var(--radius-sm)] font-medium border cursor-pointer
                        ${settings.contentDensity === opt.value
                          ? 'bg-[var(--accent-purple)] text-white border-transparent'
                          : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  调整页面区块间距、卡片留白和表单密度
                </p>
              </div>

              <div className="border-t border-[var(--border-subtle)]" />

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
                  onClick={() => updateSettings({ uiScale: 1.0, theme: 'light', sidebarCollapsed: false, sidebarWidth: 224, ambientDensity: 'medium', ambientStyle: 'auto', contentDensity: 'standard' })}
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
      <div className="relative h-full w-full overflow-hidden">
        <AmbientFx sidebarCollapsed={settings.sidebarCollapsed} sidebarWidth={settings.sidebarWidth} theme={settings.theme} density={settings.ambientDensity} stylePreset={settings.ambientStyle} enabled={ambientEnabled} />
        <div className="relative z-10 h-full w-full flex flex-col">
          <CustomTitlebar title="NekoAI Manager" />
          <div className="flex-1 overflow-hidden">
            {content}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
