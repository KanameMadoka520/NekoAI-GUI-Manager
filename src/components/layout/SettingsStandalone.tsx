import { useEffect } from 'react';
import { useUiStore } from '../../stores/uiStore';
import { SettingsPanel } from './SettingsPanel';

/**
 * 独立设置窗口（?view=settings 时由 main.tsx 单独挂载，不走主 App）。
 * 自己负责应用主题/渲染模式；改动写入 store 后由 storage 事件同步回主窗口。
 */
export function SettingsStandalone() {
  const theme = useUiStore((s) => s.settings.theme);
  const renderMode = useUiStore((s) => s.settings.renderMode);

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.setAttribute('data-render-mode', renderMode); }, [renderMode]);

  return (
    <div className="h-screen w-screen overflow-y-auto" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <div className="sticky top-0 z-10 px-5 py-3 border-b border-[var(--border-subtle)] flex items-center gap-2.5" style={{ background: 'var(--surface-header)' }}>
        <span className="mono text-[13px] text-[var(--accent-purple)] leading-none">❯</span>
        <h1 className="text-[15px] font-semibold tracking-[0.01em]">显示设置</h1>
        <span className="mono text-[11px] text-[var(--text-muted)] ml-auto tracking-[0.04em]">独立窗口 · 改动即时同步</span>
      </div>
      <div className="p-5 max-w-[560px] mx-auto">
        <SettingsPanel />
      </div>
    </div>
  );
}
