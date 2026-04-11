import { useState, useEffect, useCallback, lazy, Suspense, useRef, useMemo } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import type { PageId } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { AmbientFx } from './components/layout/AmbientFx';
import { ToastContainer } from './components/common/Toast';
import { Modal } from './components/common/Modal';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { DeferredMount } from './components/common/DeferredMount';
import { Setup } from './pages/Setup';
import { useKeyboardShortcuts, shortcutList } from './hooks/useKeyboardShortcuts';
import { useFileWatcher } from './hooks/useFileWatcher';
import { setPluginDir, runStartupSelfCheck, applySelfCheckFixes, getManagerContext, getWebConsoleStatus, saveWebConsoleSettings, openUrlInBrowser } from './lib/tauri-commands';
import { isTauriRuntime } from './lib/runtime-bridge';
import type { SelfCheckReport, WebConsoleStatus } from './lib/types';
import { explainSelfCheckItem } from './lib/human-issues';
import { useUiStore } from './stores/uiStore';

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const CommandManager = lazy(() => import('./pages/CommandManager').then((m) => ({ default: m.CommandManager })));
const PersonalityManager = lazy(() => import('./pages/PersonalityManager').then((m) => ({ default: m.PersonalityManager })));
const EvaluationLab = lazy(() => import('./pages/EvaluationLab').then((m) => ({ default: m.EvaluationLab })));
const MemoryViewer = lazy(() => import('./pages/MemoryViewer').then((m) => ({ default: m.MemoryViewer })));
const ConfigEditor = lazy(() => import('./pages/ConfigEditor').then((m) => ({ default: m.ConfigEditor })));
const ApiManager = lazy(() => import('./pages/ApiManager').then((m) => ({ default: m.ApiManager })));
const HistoryViewer = lazy(() => import('./pages/HistoryViewer').then((m) => ({ default: m.HistoryViewer })));
const UsageManager = lazy(() => import('./pages/UsageManager').then((m) => ({ default: m.UsageManager })));
const OpsCenter = lazy(() => import('./pages/OpsCenter').then((m) => ({ default: m.OpsCenter })));
const CustomTitlebar = lazy(() => import('./components/layout/CustomTitlebar').then((m) => ({ default: m.CustomTitlebar })));
const pageTitles: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: { title: '概览', subtitle: '系统状态总览' },
  api: { title: 'API管理', subtitle: '管理API节点、密钥和模型配置' },
  config: { title: '配置编辑', subtitle: '可视化编辑运行时配置' },
  personality: { title: '人格管理', subtitle: '编辑群聊和私聊人格系统提示词' },
  evaluation: { title: '人格评测实验室', subtitle: '多 API / 多轮次 / 多维人工打分 / 统计报表' },
  memory: { title: '长期记忆', subtitle: '查看和管理对话记忆' },
  history: { title: '历史记录', subtitle: '解析和分析对话历史日志' },
  usage: { title: '用量管理', subtitle: '管理 12 小时周期计数与群限流使用情况' },
  commands: { title: '命令管理', subtitle: '管理命令回避列表' },
  ops: { title: '安全发布中心', subtitle: '快照、部署包、环境模板与启动自检' },
};

const APP_LAST_PAGE_STORAGE_KEY = 'nekoai-last-page';
const VALID_PAGE_IDS: PageId[] = ['dashboard', 'api', 'config', 'personality', 'evaluation', 'memory', 'history', 'usage', 'commands', 'ops'];
const CUSTOM_TITLEBAR_HEIGHT_PX = 36;

function loadLastActivePage(): PageId {
  const raw = localStorage.getItem(APP_LAST_PAGE_STORAGE_KEY);
  return VALID_PAGE_IDS.includes(raw as PageId) ? raw as PageId : 'dashboard';
}

function persistLastActivePage(page: PageId) {
  try {
    localStorage.setItem(APP_LAST_PAGE_STORAGE_KEY, page);
  } catch {
    // ignore local storage failure
  }
}

function getCurrentPluginDirInfo() {
  const fullPath = localStorage.getItem('nekoai-plugin-dir') ?? '';
  if (!fullPath) {
    return { fullPath: '', shortName: '' };
  }
  const shortName = fullPath.split(/[\\/]/).filter(Boolean).pop() ?? fullPath;
  return { fullPath, shortName };
}

function isLocalOnlyHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return normalized === '' || normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1' || normalized === '[::1]';
}

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

const renderModeOptions = [
  { label: '标准渲染', value: 'standard' as const },
  { label: '低性能', value: 'lite' as const },
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
type PendingLeaveAction = { type: 'page'; page: PageId } | { type: 'change-dir' } | null;

function App() {
  const [phase, setPhase] = useState<AppPhase>('initializing');
  const [refreshKey, setRefreshKey] = useState(0);
  const [activePage, setActivePage] = useState<PageId>(() => loadLastActivePage());
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWebConsolePanel, setShowWebConsolePanel] = useState(false);
  const [pendingConfigRefresh, setPendingConfigRefresh] = useState(false);
  const [startupCheck, setStartupCheck] = useState<SelfCheckReport | null>(null);
  const [showStartupCheck, setShowStartupCheck] = useState(false);
  const [startupCheckBusy, setStartupCheckBusy] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<PendingLeaveAction>(null);
  const [webConsoleStatus, setWebConsoleStatus] = useState<WebConsoleStatus | null>(null);
  const [webConsoleHostDraft, setWebConsoleHostDraft] = useState('127.0.0.1');
  const [webConsolePortDraft, setWebConsolePortDraft] = useState('32191');
  const [webConsoleAllowRemoteAccessDraft, setWebConsoleAllowRemoteAccessDraft] = useState(false);
  const [webConsoleBusy, setWebConsoleBusy] = useState(false);
  const { title, subtitle } = pageTitles[activePage];
  const runningInTauri = isTauriRuntime();

  const settings = useUiStore((s) => s.settings);
  const updateSettings = useUiStore((s) => s.updateSettings);
  const addToast = useUiStore((s) => s.addToast);
  const dirtyPages = useUiStore((s) => s.dirtyPages);
  const pageJumpRequest = useUiStore((s) => s.pageJumpRequest);
  const scale = settings.uiScale;
  const lowPerformanceMode = settings.renderMode === 'lite';
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const startupCheckStats = useMemo(() => {
    if (!startupCheck) {
      return { errors: 0, warns: 0, fixable: 0, usageEvents: 0 };
    }
    return {
      errors: startupCheck.items.filter((x) => x.level === 'error').length,
      warns: startupCheck.items.filter((x) => x.level === 'warn').length,
      fixable: startupCheck.items.filter((x) => x.fixable).length,
      usageEvents: startupCheck.items.filter((x) => x.code.startsWith('usageEvents.')).length,
    };
  }, [startupCheck]);
  const pluginDirInfo = useMemo(() => getCurrentPluginDirInfo(), [phase, refreshKey]);
  const currentDirtyMessage = dirtyPages[activePage];
  const webConsoleHostNormalized = useMemo(() => webConsoleHostDraft.trim() || '127.0.0.1', [webConsoleHostDraft]);
  const webConsoleBrowserHostPreview = useMemo(
    () => (webConsoleHostNormalized === '0.0.0.0' ? '127.0.0.1' : webConsoleHostNormalized),
    [webConsoleHostNormalized],
  );
  const webConsoleUrlPreview = useMemo(() => {
    const port = webConsolePortDraft.trim() || '32191';
    return `http://${webConsoleBrowserHostPreview}:${port}/`;
  }, [webConsoleBrowserHostPreview, webConsolePortDraft]);
  const webConsolePortParsed = useMemo(() => Number.parseInt(webConsolePortDraft.trim(), 10), [webConsolePortDraft]);
  const webConsoleRunning = webConsoleStatus?.running === true;
  const webConsoleRemoteBinding = useMemo(() => !isLocalOnlyHost(webConsoleHostNormalized), [webConsoleHostNormalized]);
  const webConsoleConfigChangedWhileRunning = webConsoleRunning && (
    (Number.isFinite(webConsolePortParsed) && webConsoleStatus?.port !== webConsolePortParsed)
    || (webConsoleStatus?.host?.trim() || '127.0.0.1') !== webConsoleHostNormalized
  );
  const webConsoleToggleNeedsRemoteConfirmation = (!webConsoleRunning || webConsoleConfigChangedWhileRunning)
    && webConsoleRemoteBinding
    && !webConsoleAllowRemoteAccessDraft;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-render-mode', settings.renderMode);
  }, [settings.renderMode]);

  useEffect(() => {
    if (Object.keys(dirtyPages).length === 0) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyPages]);

  useEffect(() => {
    if (phase !== 'ready') return;
    persistLastActivePage(activePage);
  }, [phase, activePage]);

  useEffect(() => {
    if (phase !== 'ready' || !pageJumpRequest) return;
    if (pageJumpRequest.page === activePage) return;
    handleNavigate(pageJumpRequest.page);
  }, [phase, pageJumpRequest, activePage]);

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
    let cancelled = false;

    async function bootstrap() {
      const savedDir = localStorage.getItem('nekoai-plugin-dir');
      if (savedDir) {
        try {
          await setPluginDir(savedDir);
          if (!cancelled) setPhase('ready');
          return;
        } catch {
          localStorage.removeItem('nekoai-configured');
          localStorage.removeItem('nekoai-plugin-dir');
        }
      }

      if (!runningInTauri) {
        try {
          const context = await getManagerContext();
          const backendDir = context.pluginDir?.trim() ?? '';
          if (backendDir) {
            localStorage.setItem('nekoai-plugin-dir', backendDir);
            localStorage.setItem('nekoai-configured', 'true');
            if (!cancelled) setPhase('ready');
            return;
          }
        } catch {
          // ignore and fall through to setup
        }
      }

      localStorage.removeItem('nekoai-configured');
      if (!cancelled) setPhase('setup');
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [phase, runningInTauri]);

  const loadWebConsole = useCallback(async () => {
    try {
      const status = await getWebConsoleStatus();
      setWebConsoleStatus(status);
      setWebConsoleHostDraft(status.host || '127.0.0.1');
      setWebConsolePortDraft(String(status.port || 32191));
      setWebConsoleAllowRemoteAccessDraft(status.allowRemoteAccess === true);
    } catch (e: any) {
      addToast('error', `加载本地 Web 控制台状态失败: ${e?.message ?? e}`);
    }
  }, [addToast]);

  useEffect(() => {
    if (!showWebConsolePanel || phase !== 'ready') return;
    void loadWebConsole();
  }, [showWebConsolePanel, phase, loadWebConsole]);

  const ready = phase === 'ready';
  const ambientEnabled = ready && !lowPerformanceMode && (activePage === 'dashboard' || activePage === 'ops');
  const scaledViewportHeight = runningInTauri
    ? `calc((100vh - ${CUSTOM_TITLEBAR_HEIGHT_PX}px) / ${scale})`
    : `calc(100vh / ${scale})`;

  useKeyboardShortcuts({
    onNavigate: ready ? handleNavigate : undefined,
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

      if (activePage === 'config' || activePage === 'api' || activePage === 'personality' || activePage === 'evaluation' || activePage === 'commands' || activePage === 'dashboard' || activePage === 'memory' || activePage === 'history' || activePage === 'usage' || activePage === 'ops') {
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

  async function openWebConsoleExternally(target: string) {
    if (runningInTauri) {
      await openUrlInBrowser(target);
      return;
    }
    window.open(target, '_blank', 'noopener,noreferrer');
  }

  async function handleToggleWebConsole() {
    const parsedPort = Number.parseInt(webConsolePortDraft.trim(), 10);
    if (!Number.isFinite(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
      addToast('warning', '本地 Web 控制台端口必须是 1024 到 65535 之间的整数');
      return;
    }
    if (!webConsoleHostNormalized) {
      addToast('warning', '本地 Web 控制台监听地址不能为空');
      return;
    }
    if (webConsoleToggleNeedsRemoteConfirmation) {
      addToast('warning', '当前监听地址会暴露管理接口给其他设备。若确实需要局域网访问，请先勾选“允许远程访问”。');
      return;
    }

    setWebConsoleBusy(true);
    try {
      const shouldEnable = !webConsoleRunning || webConsoleConfigChangedWhileRunning;
      await saveWebConsoleSettings({
        enabled: shouldEnable,
        host: webConsoleHostNormalized,
        port: parsedPort,
        allowRemoteAccess: webConsoleAllowRemoteAccessDraft,
      });
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      const status = await getWebConsoleStatus();
      setWebConsoleStatus(status);
      setWebConsoleHostDraft(status.host || '127.0.0.1');
      setWebConsolePortDraft(String(status.port));
      setWebConsoleAllowRemoteAccessDraft(status.allowRemoteAccess === true);
      if (shouldEnable && status.enabled && status.running) {
        addToast('success', webConsoleConfigChangedWhileRunning ? `本地 Web 控制台已切换到新地址：${status.url}` : `本地 Web 控制台已启动：${status.url}`);
        await openWebConsoleExternally(status.url);
      } else if (shouldEnable) {
        addToast('error', '本地 Web 控制台未能稳定启动，请先点“刷新状态”再看是否仍为未运行');
      } else {
        addToast('success', '本地 Web 控制台已关闭');
      }
    } catch (e: any) {
      addToast('error', `切换本地 Web 控制台失败: ${e?.message ?? e}`);
    } finally {
      setWebConsoleBusy(false);
    }
  }

  async function handleCopyWebConsoleUrl() {
    const target = webConsoleStatus?.url ?? webConsoleUrlPreview;
    try {
      await navigator.clipboard.writeText(target);
      addToast('success', '已复制浏览器访问地址');
    } catch {
      addToast('warning', `复制失败，请手动复制：${target}`);
    }
  }

  async function handleOpenWebConsoleUrl() {
    if (!webConsoleRunning || !webConsoleStatus?.url) {
      addToast('warning', '本地 Web 控制台尚未运行，请先点击“开启并打开浏览器”');
      return;
    }
    try {
      await openWebConsoleExternally(webConsoleStatus.url);
    } catch (e: any) {
      addToast('error', `打开浏览器失败: ${e?.message ?? e}`);
    }
  }

  function handleSetupComplete() {
    setRefreshKey((k) => k + 1);
    setActivePage(loadLastActivePage());
    setPhase('ready');
  }

  function performChangeDir() {
    localStorage.removeItem('nekoai-configured');
    setPhase('setup');
  }

  function handleNavigate(page: PageId) {
    if (page === activePage) return;
    if (currentDirtyMessage) {
      setPendingLeaveAction({ type: 'page', page });
      setShowLeaveConfirm(true);
      return;
    }
    setActivePage(page);
  }

  function handleChangeDir() {
    if (currentDirtyMessage) {
      setPendingLeaveAction({ type: 'change-dir' });
      setShowLeaveConfirm(true);
      return;
    }
    performChangeDir();
  }

  function confirmLeaveCurrentPage() {
    const action = pendingLeaveAction;
    setPendingLeaveAction(null);
    if (!action) return;
    if (action.type === 'page') {
      setActivePage(action.page);
      return;
    }
    performChangeDir();
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
            onNavigate={handleNavigate}
            onChangeDir={handleChangeDir}
            onOpenSettings={() => setShowSettings(true)}
            onOpenWebConsole={() => setShowWebConsolePanel(true)}
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
                <div className="flex items-center gap-2">
                  {pluginDirInfo.shortName && (
                    <span
                      className="inline-flex items-center px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] max-w-[220px] truncate"
                      title={pluginDirInfo.fullPath}
                    >
                      目录：{pluginDirInfo.shortName}
                    </span>
                  )}
                  <button
                    onClick={toggleHelp}
                    className="text-xs px-2 py-1 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                    title="快捷键帮助 (Ctrl+/)"
                  >
                    ⌨
                  </button>
                </div>
              }
            />
            <div className="flex-1 overflow-y-auto p-6">
              <Suspense fallback={<PageFallback />}>
                {activePage === 'dashboard' && (
                  <DeferredMount key={`dashboard-${refreshKey}`} fallback={<PageFallback />}>
                    <Dashboard key={refreshKey} />
                  </DeferredMount>
                )}
                {activePage === 'commands' && (
                  <DeferredMount key={`commands-${refreshKey}`} fallback={<PageFallback />}>
                    <CommandManager key={refreshKey} />
                  </DeferredMount>
                )}
                {activePage === 'personality' && (
                  <DeferredMount key={`personality-${refreshKey}`} fallback={<PageFallback />}>
                    <PersonalityManager key={refreshKey} />
                  </DeferredMount>
                )}
                {activePage === 'evaluation' && (
                  <DeferredMount key={`evaluation-${refreshKey}`} fallback={<PageFallback />}>
                    <EvaluationLab key={refreshKey} />
                  </DeferredMount>
                )}
                {activePage === 'memory' && (
                  <DeferredMount key={`memory-${refreshKey}`} fallback={<PageFallback />}>
                    <MemoryViewer key={refreshKey} />
                  </DeferredMount>
                )}
                {activePage === 'config' && (
                  <DeferredMount key={`config-${refreshKey}`} fallback={<PageFallback />}>
                    <ConfigEditor key={refreshKey} />
                  </DeferredMount>
                )}
                {activePage === 'api' && (
                  <DeferredMount key={`api-${refreshKey}`} fallback={<PageFallback />}>
                    <ApiManager key={refreshKey} />
                  </DeferredMount>
                )}
                {activePage === 'history' && (
                  <DeferredMount key={`history-${refreshKey}`} fallback={<PageFallback />}>
                    <HistoryViewer key={refreshKey} />
                  </DeferredMount>
                )}
                {activePage === 'usage' && (
                  <DeferredMount key={`usage-${refreshKey}`} fallback={<PageFallback />}>
                    <UsageManager key={refreshKey} />
                  </DeferredMount>
                )}
                {activePage === 'ops' && (
                  <DeferredMount key={`ops-${refreshKey}`} fallback={<PageFallback />}>
                    <OpsCenter key={refreshKey} />
                  </DeferredMount>
                )}
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

          <ConfirmDialog
            open={showLeaveConfirm}
            onClose={() => {
              setShowLeaveConfirm(false);
              setPendingLeaveAction(null);
            }}
            onConfirm={confirmLeaveCurrentPage}
            title="当前页面还有未保存改动"
            message={currentDirtyMessage || '当前页面存在未保存改动。若继续离开，这些改动不会自动写回文件。'}
            confirmText={pendingLeaveAction?.type === 'change-dir' ? '仍然切换目录' : '仍然离开页面'}
            danger={false}
          />

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
                  ? `检测到 ${startupCheck.items.length} 项（错误 ${startupCheckStats.errors} / 警告 ${startupCheckStats.warns}）`
                  : '暂无自检结果'}
              </p>
              {startupCheck && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                  <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">可自动修复 {startupCheckStats.fixable} 项</span>
                  <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">用量日志相关 {startupCheckStats.usageEvents} 项</span>
                </div>
              )}
              {startupCheck?.report_path && (
                <p className="text-xs text-[var(--text-muted)] mono break-all">报告文件：{startupCheck.report_path}</p>
              )}
              <div className="max-h-56 overflow-y-auto border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2 space-y-1">
                {(startupCheck?.items ?? []).length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">无异常项</p>
                ) : (
                  startupCheck!.items.map((item, idx) => {
                    const explained = explainSelfCheckItem(item);
                    return (
                      <div key={`${item.code}-${idx}`} className="text-xs text-[var(--text-secondary)] leading-relaxed rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
                        <div className="flex items-start gap-2 flex-wrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded border mono text-[10px] ${item.level === 'error' ? 'border-[rgba(255,82,82,0.35)] text-[var(--error)]' : item.level === 'warn' ? 'border-[rgba(255,171,64,0.35)] text-[var(--warning)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)]'}`}>
                            {explained.techLabel}
                          </span>
                          {item.fixable && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded border border-[rgba(0,230,118,0.35)] text-[var(--success)] text-[10px]">
                              可自动修复
                            </span>
                          )}
                          {item.code.startsWith('usageEvents.') && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded border border-[rgba(255,171,64,0.35)] text-[var(--warning)] text-[10px]">
                              用量日志
                            </span>
                          )}
                          <span className="flex-1 min-w-[240px]">：{explained.humanText}</span>
                        </div>
                      </div>
                    );
                  })
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

          <Modal open={showWebConsolePanel} onClose={() => setShowWebConsolePanel(false)} title="本地 Web 服务" width="560px">
            <div className="space-y-4">
              {!runningInTauri && (
                <div className="rounded-[var(--radius-sm)] border border-[rgba(14,165,233,0.28)] bg-[rgba(14,165,233,0.08)] px-3 py-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                  当前正在浏览器模式下访问本地 Web 服务。若在这里关闭服务，当前浏览器页面刷新后会失去连接。
                </div>
              )}

              {webConsoleRemoteBinding && (
                <div className={`rounded-[var(--radius-sm)] border px-3 py-2.5 text-xs leading-relaxed ${webConsoleAllowRemoteAccessDraft ? 'border-[rgba(255,171,64,0.35)] bg-[rgba(255,171,64,0.08)] text-[var(--text-secondary)]' : 'border-[rgba(255,82,82,0.35)] bg-[rgba(255,82,82,0.08)] text-[var(--text-secondary)]'}`}>
                  当前监听地址不是本机地址，`/api/invoke/*` 这类管理接口会被同网段其他设备访问到。只有在你明确需要局域网共享 GUI 时，才建议开启远程访问。
                </div>
              )}

              <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">控制台状态</h3>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
                      这里可以配置本地 Web 服务的监听地址。`127.0.0.1` 仅本机可访问，`0.0.0.0` 会监听全部网卡，适合你要让同局域网内其他设备也能进来。
                    </p>
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded border text-xs ${webConsoleRunning ? 'border-[rgba(0,230,118,0.35)] text-[var(--success)] bg-[rgba(0,230,118,0.08)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--surface-card)]'}`}>
                    {webConsoleRunning ? '运行中' : '未运行'}
                  </span>
                </div>

                <div className="grid grid-cols-[120px_1fr] gap-3 items-center">
                  <span className="text-xs text-[var(--text-secondary)]">监听地址</span>
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={webConsoleHostDraft}
                        onChange={(e) => setWebConsoleHostDraft(e.target.value)}
                        className="flex-1 px-3 py-2 text-sm mono rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                        placeholder="127.0.0.1"
                      />
                      <button
                        type="button"
                        onClick={() => setWebConsoleHostDraft('127.0.0.1')}
                        className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer whitespace-nowrap"
                      >
                        填 127.0.0.1
                      </button>
                      <button
                        type="button"
                        onClick={() => setWebConsoleHostDraft('0.0.0.0')}
                        className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer whitespace-nowrap"
                      >
                        填 0.0.0.0
                      </button>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                      `127.0.0.1` 只允许当前电脑访问。`0.0.0.0` 表示监听当前电脑所有网卡，其他设备需要用你的局域网 IP 访问，不要直接拿 `0.0.0.0` 当外部访问地址。
                    </p>
                  </div>

                  <span className="text-xs text-[var(--text-secondary)]">监听端口</span>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={webConsolePortDraft}
                    onChange={(e) => setWebConsolePortDraft(e.target.value)}
                    className="w-full px-3 py-2 text-sm mono rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                  />

                  <span className="text-xs text-[var(--text-secondary)]">本机访问</span>
                  <div className="px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] text-xs mono break-all text-[var(--text-secondary)]">
                    {webConsoleStatus?.url ?? webConsoleUrlPreview}
                  </div>

                  <span className="text-xs text-[var(--text-secondary)]">当前说明</span>
                  <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-secondary)]">
                    <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-card)]">默认冷门端口：32191</span>
                    <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-card)]">当前监听：{webConsoleHostNormalized}:{webConsolePortDraft.trim() || '32191'}</span>
                    {webConsoleConfigChangedWhileRunning && (
                      <span className="px-2 py-1 rounded border border-[rgba(255,171,64,0.35)] text-[var(--warning)] bg-[rgba(255,171,64,0.08)]">
                        你修改了监听地址或端口，下一次按钮操作会按新配置重启服务
                      </span>
                    )}
                    {webConsoleHostNormalized === '0.0.0.0' && (
                      <span className="px-2 py-1 rounded border border-[rgba(14,165,233,0.35)] text-[var(--info)] bg-[rgba(14,165,233,0.08)]">
                        当前是全网卡监听。本机浏览器建议访问 {webConsoleUrlPreview}，其他设备请改用这台电脑的局域网 IP
                      </span>
                    )}
                    {webConsoleStatus?.pluginDir && (
                      <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-card)] max-w-full">
                        已连接目录：<span className="mono ml-1">{webConsoleStatus.pluginDir.split(/[\\/]/).filter(Boolean).pop() ?? webConsoleStatus.pluginDir}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-3 space-y-2">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={webConsoleAllowRemoteAccessDraft}
                      onChange={(e) => setWebConsoleAllowRemoteAccessDraft(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      允许远程访问（含义：允许同局域网或其他能连到这台电脑端口的设备打开当前 Web 管理界面，并调用管理接口）。
                      {webConsoleRemoteBinding
                        ? ' 当前地址不是本机地址，勾选后才允许真正启动或重启服务。'
                        : ' 当前是本机地址，不勾选也可以正常使用。'}
                    </span>
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    如果监听 `0.0.0.0` 或其他非本机地址，请确认当前网络可信，并且你知道谁能访问这台机器的端口。
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleToggleWebConsole}
                  disabled={webConsoleBusy || webConsoleToggleNeedsRemoteConfirmation}
                  className={`px-4 py-2 text-sm rounded-[var(--radius-sm)] text-white disabled:opacity-60 cursor-pointer ${webConsoleRunning && !webConsoleConfigChangedWhileRunning ? 'bg-[var(--error)] hover:opacity-90' : 'bg-[var(--accent-purple)] hover:opacity-90'}`}
                >
                  {webConsoleBusy
                    ? '处理中...'
                    : webConsoleRunning && !webConsoleConfigChangedWhileRunning
                      ? '关闭服务'
                      : webConsoleRunning && webConsoleConfigChangedWhileRunning
                        ? '应用新地址并重启'
                        : '开启并打开浏览器'}
                </button>
                {webConsoleToggleNeedsRemoteConfirmation && (
                  <span className="inline-flex items-center px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] border border-[rgba(255,82,82,0.35)] text-[var(--error)] bg-[rgba(255,82,82,0.08)]">
                    需先勾选“允许远程访问”
                  </span>
                )}
                <button
                  onClick={handleOpenWebConsoleUrl}
                  disabled={!webConsoleRunning || webConsoleBusy}
                  className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 cursor-pointer"
                >
                  打开浏览器
                </button>
                <button
                  onClick={handleCopyWebConsoleUrl}
                  disabled={webConsoleBusy}
                  className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 cursor-pointer"
                >
                  复制地址
                </button>
                <button
                  onClick={() => void loadWebConsole()}
                  disabled={webConsoleBusy}
                  className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 cursor-pointer"
                >
                  刷新状态
                </button>
              </div>
            </div>
          </Modal>

          {/* Settings modal */}
          <Modal open={showSettings} onClose={() => setShowSettings(false)} title="显示设置" width="420px">
            <div className="space-y-5">
              <div>
                <label className="text-sm text-[var(--text-secondary)] mb-3 block">渲染方案</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {renderModeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateSettings({ renderMode: opt.value })}
                      className={`py-2 text-sm rounded-[var(--radius-sm)] font-medium border cursor-pointer
                        ${settings.renderMode === opt.value
                          ? 'bg-[var(--accent-purple)] text-white border-transparent'
                          : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  低性能模式会关闭背景动画、界面过渡、模糊和图表动画，更适合核显或远程桌面环境。
                </p>
              </div>

              <div className="border-t border-[var(--border-subtle)]" />

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
                  onClick={() => updateSettings({ uiScale: 1.0, theme: 'light', renderMode: 'standard', sidebarCollapsed: false, sidebarWidth: 224, ambientDensity: 'medium', ambientStyle: 'auto', contentDensity: 'standard' })}
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

  return (
    <div className="h-screen w-screen overflow-hidden">
      <div className="relative h-full w-full overflow-hidden">
        <AmbientFx sidebarCollapsed={settings.sidebarCollapsed} sidebarWidth={settings.sidebarWidth} theme={settings.theme} density={settings.ambientDensity} stylePreset={settings.ambientStyle} enabled={ambientEnabled} />
        <div className="relative z-10 h-full w-full flex flex-col">
          {runningInTauri && (
            <Suspense fallback={null}>
              <CustomTitlebar title="NekoAI Manager" />
            </Suspense>
          )}
          <div className="flex-1 overflow-hidden">
            <div
              style={{
                width: `calc(100vw / ${scale})`,
                height: scaledViewportHeight,
                ...(lowPerformanceMode
                  ? { zoom: scale as unknown as string | number }
                  : {
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left',
                    }),
              }}
            >
              <div className="h-full w-full overflow-hidden">
                {content}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
