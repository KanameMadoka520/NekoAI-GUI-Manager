import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useUiStore } from '../stores/uiStore';

interface FileChangePayload {
  file: string;
  kind: string;
}

export function useFileWatcher(onConfigChanged?: () => void, onMemoryChanged?: () => void) {
  const addToast = useUiStore((s) => s.addToast);

  useEffect(() => {
    let unlistenConfig: (() => void) | undefined;
    let unlistenMemory: (() => void) | undefined;

    async function setup() {
      try {
        unlistenConfig = await listen<FileChangePayload>('config-changed', (event) => {
          addToast('warning', `配置文件已被外部修改: ${event.payload?.file ?? '未知文件'}`);
          onConfigChanged?.();
        });

        unlistenMemory = await listen<FileChangePayload>('memory-changed', (event) => {
          addToast('warning', `记忆文件已被外部修改: ${event.payload?.file ?? '未知文件'}`);
          onMemoryChanged?.();
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
