type EventHandler<T> = (event: { payload: T }) => void;

interface BrowserEventEnvelope {
  name: string;
  payload: unknown;
}

const browserHandlers = new Map<string, Set<(payload: unknown) => void>>();
let browserEventSource: EventSource | null = null;

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_IPC__' in window;
}

function ensureBrowserEventSource() {
  if (browserEventSource || isTauriRuntime() || typeof window === 'undefined') return;

  browserEventSource = new EventSource('/events');
  browserEventSource.onmessage = (event) => {
    try {
      const envelope = JSON.parse(event.data) as BrowserEventEnvelope;
      const handlers = browserHandlers.get(envelope.name);
      if (!handlers || handlers.size === 0) return;
      handlers.forEach((handler) => handler(envelope.payload));
    } catch {
      // ignore malformed event payloads
    }
  };

  browserEventSource.onerror = () => {
    // Keep the EventSource alive. The browser will reconnect automatically.
  };
}

export async function invokeCompat<T = unknown>(command: string, params: Record<string, unknown> = {}): Promise<T> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/tauri');
    return invoke<T>(command, params);
  }

  const response = await fetch(`/api/invoke/${command}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params ?? {}),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `HTTP ${response.status}`);
  }

  return data as T;
}

export async function listenCompat<T = unknown>(eventName: string, handler: EventHandler<T>): Promise<() => void> {
  if (isTauriRuntime()) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<T>(eventName, handler);
  }

  ensureBrowserEventSource();

  const wrapped = (payload: unknown) => {
    handler({ payload: payload as T });
  };

  const existing = browserHandlers.get(eventName) ?? new Set<(payload: unknown) => void>();
  existing.add(wrapped);
  browserHandlers.set(eventName, existing);

  return () => {
    const current = browserHandlers.get(eventName);
    if (!current) return;
    current.delete(wrapped);
    if (current.size === 0) {
      browserHandlers.delete(eventName);
    }
  };
}
