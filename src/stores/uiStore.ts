import { create } from 'zustand';
import type { HistoryFilterPreset } from '../lib/types';
import type { PageId } from '../components/layout/Sidebar';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning';
  message: string;
}

export type PageJumpRequest =
  | {
    page: 'api';
    kind: 'api-node';
    category: 'chat' | 'image';
    nodeRemark?: string;
    modelName?: string;
  }
  | {
    page: 'usage';
    kind: 'quota-user';
    category: 'chat' | 'image';
    userId: string;
  };

export type WallpaperId = 'theme' | 'azure' | 'nebula' | 'amber' | 'graphite' | 'daylight' | 'none' | 'custom';

export interface AppSettings {
  uiScale: number; // 0.8 – 1.5
  theme: 'light' | 'dark' | 'parchment';
  renderMode: 'standard' | 'lite';
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  ambientDensity: 'low' | 'medium' | 'high';
  ambientStyle: 'network' | 'orbital' | 'blueprint' | 'auto';
  contentDensity: 'compact' | 'standard' | 'spacious';
  wallpaper: WallpaperId;
  wallpaperCustomUrl: string;
  wallpaperDim: 'soft' | 'standard' | 'strong';
  historyFilterPresets: HistoryFilterPreset[];
}

const defaultSettings: AppSettings = {
  uiScale: 1.1,
  theme: 'dark',
  renderMode: 'standard',
  sidebarCollapsed: false,
  sidebarWidth: 208,
  ambientDensity: 'low',
  ambientStyle: 'auto',
  contentDensity: 'standard',
  wallpaper: 'none',
  wallpaperCustomUrl: '',
  wallpaperDim: 'standard',
  historyFilterPresets: [],
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('nekoai-settings');
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultSettings;
}

let settingsPersistTimer: ReturnType<typeof setTimeout> | null = null;
function persistSettingsDeferred(next: AppSettings) {
  if (settingsPersistTimer) clearTimeout(settingsPersistTimer);
  settingsPersistTimer = setTimeout(() => {
    localStorage.setItem('nekoai-settings', JSON.stringify(next));
    settingsPersistTimer = null;
  }, 180);
}

interface UiState {
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string) => void;
  removeToast: (id: string) => void;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  updateHistoryFilterPresets: (presets: HistoryFilterPreset[]) => void;
  dirtyPages: Partial<Record<PageId, string>>;
  setPageDirty: (page: PageId, dirty: boolean, message?: string) => void;
  clearPageDirty: (page: PageId) => void;
  pageJumpRequest: PageJumpRequest | null;
  requestPageJump: (request: PageJumpRequest) => void;
  clearPageJumpRequest: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  addToast: (type, message) => {
    // 未连接插件目录的只读浏览模式下，页面读取失败属预期；统一抑制这类提示，避免逐页弹窗刷屏。
    // 该状态已由内容区顶部的只读横幅明确说明。
    if (message.includes('未连接插件目录')) return;
    const id = Date.now().toString();
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  settings: loadSettings(),
  updateSettings: (patch) =>
    set((s) => {
      const next = { ...s.settings, ...patch };
      persistSettingsDeferred(next);
      return { settings: next };
    }),
  updateHistoryFilterPresets: (presets) =>
    set((s) => {
      const next = { ...s.settings, historyFilterPresets: presets };
      persistSettingsDeferred(next);
      return { settings: next };
    }),
  dirtyPages: {},
  setPageDirty: (page, dirty, message) =>
    set((s) => {
      const next = { ...s.dirtyPages };
      if (dirty) next[page] = message || '当前页面有未保存改动';
      else delete next[page];
      return { dirtyPages: next };
    }),
  clearPageDirty: (page) =>
    set((s) => {
      const next = { ...s.dirtyPages };
      delete next[page];
      return { dirtyPages: next };
    }),
  pageJumpRequest: null,
  requestPageJump: (request) => set({ pageJumpRequest: request }),
  clearPageJumpRequest: () => set({ pageJumpRequest: null }),
}));

// 跨窗口设置同步：另一个窗口（如独立的「显示设置」窗口）写入 nekoai-settings 时，
// storage 事件会在本窗口触发，这里据此热更新 store，让主窗口与设置窗口实时一致。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== 'nekoai-settings' || !e.newValue) return;
    try {
      useUiStore.setState({ settings: { ...defaultSettings, ...JSON.parse(e.newValue) } });
    } catch { /* ignore malformed */ }
  });
}
