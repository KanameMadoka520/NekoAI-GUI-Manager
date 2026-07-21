import { useUiStore } from '../../stores/uiStore';
import { InfoHint } from '../common/InfoHint';

const scaleOptions = [
  { label: '80%', value: 0.8 }, { label: '90%', value: 0.9 }, { label: '100%', value: 1.0 },
  { label: '110%', value: 1.1 }, { label: '120%', value: 1.2 }, { label: '130%', value: 1.3 },
];
const themeOptions = [
  { label: '暗色', value: 'dark' as const }, { label: '亮色', value: 'light' as const }, { label: '鎏金', value: 'parchment' as const },
];
const renderModeOptions = [
  { label: '标准渲染', value: 'standard' as const }, { label: '低性能', value: 'lite' as const },
];
const contentDensityOptions = [
  { label: '紧凑', value: 'compact' as const }, { label: '标准', value: 'standard' as const }, { label: '舒展', value: 'spacious' as const },
];

function SectionLabel({ title, hint }: { title: string; hint: string }) {
  return (
    <label className="text-sm text-[var(--text-secondary)] mb-3 flex items-center gap-1.5">
      {title}<InfoHint text={hint} />
    </label>
  );
}

/**
 * 显示设置面板（纯 store 驱动，弹窗与独立设置窗口共用）。
 * 各项说明收到 ⓘ 里，鼠标移上/点击才弹出，省纵向空间。
 */
export function SettingsPanel({ onChangeDir }: { onChangeDir?: () => void }) {
  const settings = useUiStore((s) => s.settings);
  const updateSettings = useUiStore((s) => s.updateSettings);
  // 选中态用「浅强调底 + 深强调字」，避免亮色主题实心蓝底配蓝字看不清
  const btn = (active: boolean) =>
    `py-2 text-sm rounded-[var(--radius-sm)] font-medium border cursor-pointer ${active
      ? 'bg-[var(--nav-active-bg)] text-[var(--accent-strong)] border-[var(--accent-soft-border)] shadow-[inset_0_0_0_1px_var(--accent-soft-border)]'
      : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`;

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel title="渲染方案" hint="低性能模式会关闭背景动画、过渡、模糊和图表动画，更适合核显或远程桌面。" />
        <div className="grid grid-cols-2 gap-1.5">
          {renderModeOptions.map((opt) => (
            <button key={opt.value} onClick={() => updateSettings({ renderMode: opt.value })} className={btn(settings.renderMode === opt.value)}>{opt.label}</button>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div>
        <SectionLabel title="主题" hint="暗色是控制台主场；亮色为日间，鎏金是暖琥珀变体。" />
        <div className="grid grid-cols-3 gap-1.5">
          {themeOptions.map((opt) => (
            <button key={opt.value} onClick={() => updateSettings({ theme: opt.value })} className={btn(settings.theme === opt.value)}>{opt.label}</button>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div>
        <SectionLabel title="界面缩放" hint="整体放大或缩小，文字和控件一起变。默认 110%。" />
        <div className="grid grid-cols-6 gap-1.5">
          {scaleOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ uiScale: opt.value })}
              className={`py-2 text-sm rounded-[var(--radius-sm)] font-medium border cursor-pointer ${settings.uiScale === opt.value ? 'bg-[var(--nav-active-bg)] text-[var(--accent-strong)] border-[var(--accent-soft-border)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div>
        <SectionLabel title="内容密度" hint="区块间距、卡片留白和表单的疏密。" />
        <div className="grid grid-cols-3 gap-1.5">
          {contentDensityOptions.map((opt) => (
            <button key={opt.value} onClick={() => updateSettings({ contentDensity: opt.value })} className={btn(settings.contentDensity === opt.value)}>{opt.label}</button>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <label className="text-sm text-[var(--text-secondary)]">省资源一键组合</label>
          <InfoHint text="一次性切到低性能 + 紧凑密度，最省机器。" />
        </div>
        <button
          onClick={() => updateSettings({ renderMode: 'lite', contentDensity: 'compact' })}
          className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--accent-purple)] hover:bg-[var(--border-subtle)] cursor-pointer whitespace-nowrap"
        >一键套用</button>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div className="space-y-1">
        {onChangeDir && (
          <button onClick={onChangeDir} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-sm)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer">
            <span>▤</span> 重新选择插件目录
          </button>
        )}
        <button
          onClick={() => updateSettings({ uiScale: 1.1, theme: 'dark', renderMode: 'standard', sidebarCollapsed: false, sidebarWidth: 208, contentDensity: 'standard' })}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-sm)] text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
        >
          <span>↩</span> 恢复默认设置
        </button>
      </div>
    </div>
  );
}
