import { useEffect, useRef } from 'react';
import { useUiStore } from '../stores/uiStore';
import { listenCompat } from '../lib/runtime-bridge';

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
        unlistenConfig = await listenCompat<FileChangePayload>('config-changed', (event) => {
          const payload = event.payload;
          const now = Date.now();
          if (now - lastToastAtRef.current.config > 2000) {
            addToast('warning', `检测到外部修改：配置文件 ${payload?.file ?? '未知文件'} 已变更，建议刷新当前页面以获取最新配置。`);
            lastToastAtRef.current.config = now;
          }
          if (payload) onConfigChanged?.(payload);
        });

        unlistenMemory = await listenCompat<FileChangePayload>('memory-changed', (event) => {
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
