import type { WebConsoleLoginResult, WebConsoleSessionStatus } from './types';

type EventHandler<T> = (event: { payload: T }) => void;

interface BrowserEventEnvelope {
  name: string;
  payload: unknown;
}

const browserHandlers = new Map<string, Set<(payload: unknown) => void>>();
let browserEventSource: EventSource | null = null;
const WEB_CONSOLE_TOKEN_STORAGE_KEY = 'nekoai-web-console-token';

// ===== 插件目录连接态（无目录只读浏览模式的读写闸门）=====
// Tauri 桌面端：在调用 set_plugin_dir 真正连接目录之前，禁止一切依赖目录的读写命令，
// 以实现「未连接任何目录时也能进入并浏览各页面，但不具备任何文件读写能力；
// 只有连接插件目录后才能读写」。浏览器端目录由后端服务管理，不走此闸门。
let connectedPluginDir = '';

// 不依赖插件目录、无目录时也必须放行的命令（连接目录 / 查询后端上下文 / 打开链接 / 本地 Web 服务管理）。
const DIR_OPTIONAL_COMMANDS = new Set<string>([
  'set_plugin_dir',
  'get_manager_context',
  'open_url_in_browser',
  'open_path_in_explorer',
  'get_web_console_status',
  'save_web_console_settings',
]);

export function hasConnectedPluginDir() {
  return connectedPluginDir.trim().length > 0;
}

export function resetPluginDirConnection() {
  connectedPluginDir = '';
}

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
    if (!hasConnectedPluginDir() && !DIR_OPTIONAL_COMMANDS.has(command)) {
      throw new Error('未连接插件目录，连接后才能读写文件');
    }
    const { invoke } = await import('@tauri-apps/api/tauri');
    const result = await invoke<T>(command, params);
    if (command === 'set_plugin_dir') {
      const dir = (params as { dir?: unknown }).dir;
      if (typeof dir === 'string' && dir.trim()) connectedPluginDir = dir.trim();
    }
    return result;
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
