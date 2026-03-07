import { useEffect, useState } from 'react';
import { appWindow } from '@tauri-apps/api/window';

interface CustomTitlebarProps {
  title: string;
}

export function CustomTitlebar({ title }: CustomTitlebarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;

    appWindow.isMaximized()
      .then((v) => {
        if (mounted) setMaximized(v);
      })
      .catch(() => {});

    const unlistenPromise = appWindow.onResized(async () => {
      try {
        const v = await appWindow.isMaximized();
        if (mounted) setMaximized(v);
      } catch {
        // ignore when not running in tauri window context
      }
    });

    return () => {
      mounted = false;
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  async function minimize() {
    try { await appWindow.minimize(); } catch (e) { console.error(e); }
  }

  async function toggleMaximize() {
    try {
      const isMax = await appWindow.isMaximized();
      if (isMax) {
        await appWindow.unmaximize();
      } else {
        await appWindow.maximize();
      }
      const v = await appWindow.isMaximized();
      setMaximized(v);
    } catch (e) { console.error(e); }
  }

  async function close() {
    try { await appWindow.close(); } catch (e) { console.error(e); }
  }

  async function startDrag() {
    try { await appWindow.startDragging(); } catch (e) { console.error(e); }
  }

  return (
    <div
      className="h-9 flex items-center justify-between border-b border-[var(--border-subtle)] select-none"
      style={{
        background: 'var(--surface-header)',
        backdropFilter: 'blur(var(--header-blur))',
      }}
      onDoubleClick={toggleMaximize}
    >
      <div
        data-tauri-drag-region
        className="px-3 text-xs text-[var(--text-secondary)] font-medium tracking-wide flex-1 h-full flex items-center"
        onMouseDown={startDrag}
      >
        {title}
      </div>

      <div className="flex items-stretch h-full">
        <button
          onClick={minimize}
          className="w-10 h-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
          title="最小化"
        >
          ─
        </button>
        <button
          onClick={toggleMaximize}
          className="w-10 h-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
          title={maximized ? '还原' : '最大化'}
        >
          {maximized ? '❐' : '□'}
        </button>
        <button
          onClick={close}
          className="w-10 h-full text-[var(--text-muted)] hover:text-white hover:bg-[var(--error)] cursor-pointer"
          title="关闭"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
