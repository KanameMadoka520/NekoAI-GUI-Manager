import type { WebConsoleLoginResult, WebConsoleSessionStatus } from './types';

type EventHandler<T> = (event: { payload: T }) => void;

interface BrowserEventEnvelope {
  name: string;
  payload: unknown;
}

const browserHandlers = new Map<string, Set<(payload: unknown) => void>>();
let browserEventSource: EventSource | null = null;
const WEB_CONSOLE_TOKEN_STORAGE_KEY = 'nekoai-web-console-token';

function getStoredBrowserToken() {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem(WEB_CONSOLE_TOKEN_STORAGE_KEY) ?? '';
}

function closeBrowserEventSource() {
  if (!browserEventSource) return;
  browserEventSource.close();
  browserEventSource = null;
}

function persistBrowserToken(token: string) {
  if (typeof window === 'undefined') return;
  const normalized = token.trim();
  if (normalized) sessionStorage.setItem(WEB_CONSOLE_TOKEN_STORAGE_KEY, normalized);
  else sessionStorage.removeItem(WEB_CONSOLE_TOKEN_STORAGE_KEY);
  closeBrowserEventSource();
}

function notifyBrowserAuthChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('neko-web-console-auth-changed'));
}

function handleBrowserUnauthorized() {
  persistBrowserToken('');
  notifyBrowserAuthChanged();
}

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_IPC__' in window;
}

function ensureBrowserEventSource() {
  if (browserEventSource || isTauriRuntime() || typeof window === 'undefined') return;

  const token = getStoredBrowserToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  browserEventSource = new EventSource(`/events${query}`);
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
      ...(getStoredBrowserToken() ? { Authorization: `Bearer ${getStoredBrowserToken()}` } : {}),
    },
    body: JSON.stringify(params ?? {}),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) {
      handleBrowserUnauthorized();
    }
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

async function fetchBrowserSession<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) {
      handleBrowserUnauthorized();
    }
    throw new Error(data?.error ?? `HTTP ${response.status}`);
  }
  return data as T;
}

export async function getWebConsoleSessionStatus(): Promise<WebConsoleSessionStatus> {
  if (isTauriRuntime()) {
    return {
      authEnabled: false,
      hasPassword: false,
      authenticated: true,
      readOnly: false,
      allowReadOnlyLogin: false,
      forceReadOnly: false,
      expiresAt: null,
      sessionTtlMinutes: 0,
    };
  }

  const token = getStoredBrowserToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return fetchBrowserSession<WebConsoleSessionStatus>(`/api/session/status${query}`);
}

export async function loginWebConsoleSession(password: string, readOnly: boolean): Promise<WebConsoleLoginResult> {
  const result = await fetchBrowserSession<WebConsoleLoginResult>('/api/session/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, readOnly }),
  });
  persistBrowserToken(result.token);
  notifyBrowserAuthChanged();
  return result;
}

export async function logoutWebConsoleSession(): Promise<void> {
  if (isTauriRuntime()) return;
  const token = getStoredBrowserToken();
  if (!token) {
    handleBrowserUnauthorized();
    return;
  }
  await fetchBrowserSession<{ ok: boolean }>('/api/session/logout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token }),
  });
  handleBrowserUnauthorized();
}
