import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useUiStore } from '../stores/uiStore';

interface FileChangePayload {
  file: string;
  kind: string;
}

export function useFileWatcher(
  onConfigChanged?: (payload: FileChangePayload) => void,
  onMemoryChanged?: (payload: FileChangePayload) => void,
) {
  const addToast = useUiStore((s) => s.addToast);
  const lastToastAtRef = useRef<{ config: number; memory: number }>({ config: 0, memory: 0 });

  useEffect(() => {
    let unlistenConfig: (() => void) | undefined;
    let unlistenMemory: (() => void) | undefined;

    async function setup() {
      try {
        unlistenConfig = await listen<FileChangePayload>('config-changed', (event) => {
          const payload = event.payload;
          const now = Date.now();
          if (now - lastToastAtRef.current.config > 2000) {
            addToast('warning', `检测到外部修改：配置文件 ${payload?.file ?? '未知文件'} 已变更，建议刷新当前页面以获取最新配置。`);
            lastToastAtRef.current.config = now;
          }
          if (payload) onConfigChanged?.(payload);
        });

        unlistenMemory = await listen<FileChangePayload>('memory-changed', (event) => {
          const payload = event.payload;
          const now = Date.now();
          if (now - lastToastAtRef.current.memory > 2000) {
            addToast('warning', `检测到外部修改：记忆文件 ${payload?.file ?? '未知文件'} 已变更，建议刷新当前页面以获取最新数据。`);
            lastToastAtRef.current.memory = now;
          }
          if (payload) onMemoryChanged?.(payload);
        });
      } catch {
        // Tauri event API not available in dev/browser mode — silently ignore
      }
    }

    setup();

    return () => {
      unlistenConfig?.();
      unlistenMemory?.();
    };
  }, [onConfigChanged, onMemoryChanged, addToast]);
}
