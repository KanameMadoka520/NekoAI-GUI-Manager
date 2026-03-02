import { create } from 'zustand';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning';
  message: string;
}

export interface AppSettings {
  uiScale: number; // 0.8 – 1.5
}

const defaultSettings: AppSettings = { uiScale: 1 };

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('nekoai-settings');
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultSettings;
}

interface UiState {
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string) => void;
  removeToast: (id: string) => void;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
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
      localStorage.setItem('nekoai-settings', JSON.stringify(next));
      return { settings: next };
    }),
}));
