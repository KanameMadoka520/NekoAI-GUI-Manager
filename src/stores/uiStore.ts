import { create } from 'zustand';
import type { HistoryFilterPreset } from '../lib/types';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning';
  message: string;
}

export interface AppSettings {
  uiScale: number; // 0.8 – 1.5
  theme: 'light' | 'dark' | 'parchment';
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  ambientDensity: 'low' | 'medium' | 'high';
  ambientStyle: 'network' | 'orbital' | 'blueprint' | 'auto';
  contentDensity: 'compact' | 'standard' | 'spacious';
  historyFilterPresets: HistoryFilterPreset[];
}

const defaultSettings: AppSettings = {
  uiScale: 1,
  theme: 'light',
  sidebarCollapsed: false,
  sidebarWidth: 224,
  ambientDensity: 'medium',
  ambientStyle: 'auto',
  contentDensity: 'standard',
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
}));

