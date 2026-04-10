import { useEffect, useState } from 'react';

type DeferredMountProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  minDelayMs?: number;
  idleTimeoutMs?: number;
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function DeferredMount({
  children,
  fallback = null,
  minDelayMs = 0,
  idleTimeoutMs = 240,
}: DeferredMountProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let active = true;
    let delayTimer: number | null = null;
    let idleHandle: number | null = null;
    const idleWindow = window as IdleWindow;

    setMounted(false);

    const finalize = () => {
      if (!active) return;
      setMounted(true);
    };

    const queueMount = () => {
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleHandle = idleWindow.requestIdleCallback(finalize, { timeout: idleTimeoutMs });
        return;
      }
      idleHandle = window.setTimeout(finalize, 16);
    };

    if (minDelayMs > 0) {
      delayTimer = window.setTimeout(queueMount, minDelayMs);
    } else {
      queueMount();
    }

    return () => {
      active = false;
      if (delayTimer !== null) window.clearTimeout(delayTimer);
      if (idleHandle !== null) {
        if (typeof idleWindow.cancelIdleCallback === 'function') idleWindow.cancelIdleCallback(idleHandle);
        else window.clearTimeout(idleHandle);
      }
    };
  }, [minDelayMs, idleTimeoutMs]);

  return mounted ? <>{children}</> : <>{fallback}</>;
}
