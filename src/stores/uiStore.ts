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
  uiScale: 1,
  theme: 'light',
  renderMode: 'standard',
  sidebarCollapsed: false,
  sidebarWidth: 224,
  ambientDensity: 'medium',
  ambientStyle: 'auto',
  contentDensity: 'standard',
  wallpaper: 'theme',
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
