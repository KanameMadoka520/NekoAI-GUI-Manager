import { invoke } from '@tauri-apps/api/tauri';
import type {
  MemoryMeta, HistoryFileMeta, SearchFilters, SearchResult,
  SystemInfo, PingResult,
} from './types';

// ===== Config =====
export const getConfig = <T = any>(key: string) =>
  invoke<T>('get_config', { key });

export const saveConfig = (key: string, data: any) =>
  invoke<void>('save_config', { key, data });

export const getSystemInfo = () =>
  invoke<SystemInfo>('get_system_info');

export const setPluginDir = (dir: string) =>
  invoke<void>('set_plugin_dir', { dir });

// ===== Memory =====
export const listMemory = (memType: string) =>
  invoke<MemoryMeta[]>('list_memory', { memType });

export const getMemory = (memType: string, id: string) =>
  invoke<any[]>('get_memory', { memType, id });

export const saveMemory = (memType: string, id: string, data: any[]) =>
  invoke<void>('save_memory', { memType, id, data });

export const deleteMemory = (memType: string, id: string) =>
  invoke<void>('delete_memory', { memType, id });

// ===== History =====
export const listHistoryFiles = () =>
  invoke<HistoryFileMeta[]>('list_history_files');

export const getHistoryFile = (filename: string) =>
  invoke<any>('get_history_file', { filename });

export const searchAllHistory = (query: string, filters: SearchFilters) =>
  invoke<SearchResult[]>('search_all_history', { query, filters });

export const exportHistory = (filename: string, format: string) =>
  invoke<string>('export_history', { filename, format });

// ===== API Test =====
export const pingApi = (url: string, key: string, model: string, aiType: string) =>
  invoke<PingResult>('ping_api', { url, key, model, aiType });

export const batchPingApis = (nodes: Array<{
  index: number; api_url: string; api_key: string; model_name: string; ai_type: string;
}>) =>
  invoke<PingResult[]>('batch_ping_apis', { nodes });
