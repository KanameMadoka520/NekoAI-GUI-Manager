import { useEffect } from 'react';
import type { PageId } from '../components/layout/Sidebar';

const pageKeys: Record<string, PageId> = {
  '1': 'dashboard',
  '2': 'api',
  '3': 'config',
  '4': 'personality',
  '5': 'memory',
  '6': 'history',
  '7': 'commands',
};

interface ShortcutHandlers {
  onSave?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onNavigate?: (page: PageId) => void;
  onToggleHelp?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      // Ctrl+S — Save
      if (e.key === 's') {
        e.preventDefault();
        handlers.onSave?.();
        return;
      }

      // Ctrl+Z — Undo
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handlers.onUndo?.();
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z — Redo
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        handlers.onRedo?.();
        return;
      }

      // Ctrl+/ — Toggle help
      if (e.key === '/') {
        e.preventDefault();
        handlers.onToggleHelp?.();
        return;
      }

      // Ctrl+1~7 — Page switch
      if (e.key in pageKeys) {
        e.preventDefault();
        handlers.onNavigate?.(pageKeys[e.key]);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handlers]);
}

export const shortcutList = [
  { keys: 'Ctrl+S', desc: '保存当前页面' },
  { keys: 'Ctrl+Z', desc: '撤销' },
  { keys: 'Ctrl+Y', desc: '重做' },
  { keys: 'Ctrl+/', desc: '快捷键帮助' },
  { keys: 'Ctrl+1', desc: '概览页' },
  { keys: 'Ctrl+2', desc: 'API管理' },
  { keys: 'Ctrl+3', desc: '配置编辑' },
  { keys: 'Ctrl+4', desc: '人格管理' },
  { keys: 'Ctrl+5', desc: '长期记忆' },
  { keys: 'Ctrl+6', desc: '历史记录' },
  { keys: 'Ctrl+7', desc: '命令管理' },
];
