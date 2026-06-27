import { useUiStore } from '../../stores/uiStore';
import type { WallpaperId } from '../../stores/uiStore';

const scaleOptions = [
  { label: '80%', value: 0.8 }, { label: '90%', value: 0.9 }, { label: '100%', value: 1.0 },
  { label: '110%', value: 1.1 }, { label: '120%', value: 1.2 }, { label: '130%', value: 1.3 },
];
const themeOptions = [
  { label: '暗色', value: 'dark' as const }, { label: '亮色', value: 'light' as const }, { label: '羊皮纸', value: 'parchment' as const },
];
const renderModeOptions = [
  { label: '标准渲染', value: 'standard' as const }, { label: '低性能', value: 'lite' as const },
];
const densityOptions = [
  { label: '轻', value: 'low' as const }, { label: '中', value: 'medium' as const }, { label: '重', value: 'high' as const },
];
const contentDensityOptions = [
  { label: '紧凑', value: 'compact' as const }, { label: '标准', value: 'standard' as const }, { label: '舒展', value: 'spacious' as const },
];
const stylePresetOptions = [
  { label: '自动', value: 'auto' as const }, { label: '网络', value: 'network' as const }, { label: '轨道', value: 'orbital' as const }, { label: '蓝图', value: 'blueprint' as const },
];
const wallpaperOptions: { label: string; value: WallpaperId; swatch: string }[] = [
  { label: '跟随主题', value: 'theme', swatch: 'var(--wallpaper-default)' },
  { label: '深蓝', value: 'azure', swatch: 'var(--wp-azure)' },
  { label: '星云', value: 'nebula', swatch: 'var(--wp-nebula)' },
  { label: '琥珀', value: 'amber', swatch: 'var(--wp-amber)' },
  { label: '石墨', value: 'graphite', swatch: 'var(--wp-graphite)' },
  { label: '晴空', value: 'daylight', swatch: 'var(--wp-daylight)' },
  { label: '纯色', value: 'none', swatch: 'var(--bg-base)' },
  { label: '自定义', value: 'custom', swatch: 'var(--bg-elevated)' },
];
const wallpaperDimOptions = [
  { label: '柔和', value: 'soft' as const }, { label: '标准', value: 'standard' as const }, { label: '浓重', value: 'strong' as const },
];

/**
 * 显示设置面板（纯由 store 驱动，可复用于应用内弹窗与独立设置窗口）。
 * 独立窗口里 onChangeDir 不传，避免引用主窗口上下文。
 */
export function SettingsPanel({ onChangeDir }: { onChangeDir?: () => void }) {
  const settings = useUiStore((s) => s.settings);
  const updateSettings = useUiStore((s) => s.updateSettings);
  const btn = (active: boolean) =>
    `py-2 text-sm rounded-[var(--radius-sm)] font-medium border cursor-pointer ${active
      ? 'bg-[var(--accent-purple)] text-[var(--on-accent)] border-transparent'
      : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`;

  return (
    <div className="space-y-5">
      <div>
        <label className="text-sm text-[var(--text-secondary)] mb-3 block">渲染方案</label>
        <div className="grid grid-cols-2 gap-1.5">
          {renderModeOptions.map((opt) => (
            <button key={opt.value} onClick={() => updateSettings({ renderMode: opt.value })} className={btn(settings.renderMode === opt.value)}>{opt.label}</button>
          ))}
        </div>
        <p className="text-[12px] text-[var(--text-muted)] mt-2">低性能模式会关闭背景动画、过渡、模糊和图表动画，更适合核显或远程桌面。</p>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div>
        <label className="text-sm text-[var(--text-secondary)] mb-3 block">主题</label>
        <div className="grid grid-cols-3 gap-1.5">
          {themeOptions.map((opt) => (
            <button key={opt.value} onClick={() => updateSettings({ theme: opt.value })} className={btn(settings.theme === opt.value)}>{opt.label}</button>
          ))}
        </div>
        <p className="text-[12px] text-[var(--text-muted)] mt-2">暗色是控制台主场；亮色为日间，羊皮纸是暖琥珀变体。</p>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div>
        <label className="text-sm text-[var(--text-secondary)] mb-3 block">壁纸打底</label>
        <div className="grid grid-cols-4 gap-1.5">
          {wallpaperOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ wallpaper: opt.value })}
              title={opt.label}
              className={`relative h-12 rounded-[var(--radius-sm)] overflow-hidden border cursor-pointer ${settings.wallpaper === opt.value ? 'border-[var(--accent-purple)] ring-2 ring-[var(--focus-ring)]' : 'border-[var(--border-subtle)] hover:border-[var(--border-hover)]'}`}
            >
              <span className="absolute inset-0" style={{ background: opt.value === 'custom' && settings.wallpaperCustomUrl.trim() ? `url("${settings.wallpaperCustomUrl.trim()}")` : opt.swatch, backgroundSize: 'cover', backgroundPosition: 'center' }} />
              <span className="absolute inset-x-0 bottom-0 text-[11px] text-center py-0.5 bg-black/55 text-white">{opt.label}</span>
            </button>
          ))}
        </div>
        {settings.wallpaper === 'custom' && (
          <input
            type="text"
            value={settings.wallpaperCustomUrl}
            onChange={(e) => updateSettings({ wallpaperCustomUrl: e.target.value })}
            placeholder="粘贴图片地址 https://..."
            className="mt-2 w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
          />
        )}
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {wallpaperDimOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ wallpaperDim: opt.value })}
              disabled={settings.wallpaper === 'none'}
              className={`py-1.5 text-xs rounded-[var(--radius-sm)] font-medium border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${settings.wallpaperDim === opt.value && settings.wallpaper !== 'none' ? 'bg-[var(--accent-purple)] text-[var(--on-accent)] border-transparent' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}
            >{opt.label}</button>
          ))}
        </div>
        <p className="text-[12px] text-[var(--text-muted)] mt-2">HUD 默认是纯画布加细网格。选一张壁纸会铺在最底层、由暗度档位压暗保证读得清；选「纯色」或低性能则只用底色。</p>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div>
        <label className="text-sm text-[var(--text-secondary)] mb-3 block">漂浮密度</label>
        <div className="grid grid-cols-3 gap-1.5">
          {densityOptions.map((opt) => (
            <button key={opt.value} onClick={() => updateSettings({ ambientDensity: opt.value })} className={btn(settings.ambientDensity === opt.value)}>{opt.label}</button>
          ))}
        </div>
        <p className="text-[12px] text-[var(--text-muted)] mt-2">背景漂浮元素的数量（HUD 默认以网格代替，影响有限）。</p>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div>
        <label className="text-sm text-[var(--text-secondary)] mb-3 block">几何风格</label>
        <div className="grid grid-cols-4 gap-1.5">
          {stylePresetOptions.map((opt) => (
            <button key={opt.value} onClick={() => updateSettings({ ambientStyle: opt.value })} className={btn(settings.ambientStyle === opt.value)}>{opt.label}</button>
          ))}
        </div>
        <p className="text-[12px] text-[var(--text-muted)] mt-2">背景几何图形的风格预设。</p>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div>
        <label className="text-sm text-[var(--text-secondary)] mb-3 block">内容密度</label>
        <div className="grid grid-cols-3 gap-1.5">
          {contentDensityOptions.map((opt) => (
            <button key={opt.value} onClick={() => updateSettings({ contentDensity: opt.value })} className={btn(settings.contentDensity === opt.value)}>{opt.label}</button>
          ))}
        </div>
        <p className="text-[12px] text-[var(--text-muted)] mt-2">区块间距、卡片留白和表单的疏密。</p>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div>
        <label className="text-sm text-[var(--text-secondary)] mb-3 block">界面缩放</label>
        <div className="grid grid-cols-6 gap-1.5">
          {scaleOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ uiScale: opt.value })}
              className={`py-2 text-sm rounded-[var(--radius-sm)] font-medium cursor-pointer ${settings.uiScale === opt.value ? 'bg-[var(--accent-purple)] text-[var(--on-accent)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}
            >{opt.label}</button>
          ))}
        </div>
        <p className="text-[12px] text-[var(--text-muted)] mt-2">整体放大或缩小，文字和控件一起变。默认 110%。</p>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      <div className="flex items-center justify-between gap-3">
        <div>
          <label className="text-sm text-[var(--text-secondary)] block">省资源一键组合</label>
          <p className="text-[12px] text-[var(--text-muted)] mt-1 leading-relaxed">一次性切到低性能 + 低漂浮 + 紧凑密度，最省机器。</p>
        </div>
        <button
          onClick={() => updateSettings({ renderMode: 'lite', ambientDensity: 'low', contentDensity: 'compact' })}
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
          onClick={() => updateSettings({ uiScale: 1.1, theme: 'dark', renderMode: 'standard', sidebarCollapsed: false, sidebarWidth: 208, ambientDensity: 'low', ambientStyle: 'auto', contentDensity: 'standard', wallpaper: 'none', wallpaperCustomUrl: '', wallpaperDim: 'standard' })}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-sm)] text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
        >
          <span>↩</span> 恢复默认设置
        </button>
      </div>
    </div>
  );
}
