import { invoke } from '@tauri-apps/api/tauri';
import type {
  MemoryMeta, HistoryFileMeta, SearchFilters, SearchResult,
  SystemInfo, PingResult, SnapshotMeta, SnapshotDiff,
  DeployPackageResult, SelfCheckReport, ApiHistoryMetric,
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

export const openPathInExplorer = (path: string) =>
  invoke<void>('open_path_in_explorer', { path });

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

export const getApiHistoryMetrics = () =>
  invoke<Array<ApiHistoryMetric & {
    api_remark: string;
    model_name: string;
    error_rate: number;
    timeout_rate: number;
    timeout_errors: number;
    avg_response_time_ms: number;
    jitter_ms: number;
  }>>('get_api_history_metrics');

export const exportHistory = (filename: string, format: string) =>
  invoke<string>('export_history', { filename, format });

export const importHistoryFile = (filename: string, data: unknown) =>
  invoke<void>('import_history_file', { filename, data });

// ===== API Test =====
export const pingApi = (url: string, key: string, model: string, aiType: string) =>
  invoke<PingResult>('ping_api', { url, key, model, aiType });

export const batchPingApis = (nodes: Array<{
  index: number; api_url: string; api_key: string; model_name: string; ai_type: string;
}>) =>
  invoke<PingResult[]>('batch_ping_apis', { nodes });

export const batchPingApisStream = (sessionId: string, nodes: Array<{
  index: number; api_url: string; api_key: string; model_name: string; ai_type: string;
}>) =>
  invoke<void>('batch_ping_apis_stream', { sessionId, nodes });

// ===== Ops / Phase 1+2 =====
export const listSnapshots = () =>
  invoke<SnapshotMeta[]>('list_snapshots');

export const createSnapshot = (reason?: string, operator?: string) =>
  invoke<string>('create_snapshot', { reason, operator });

export const rollbackSnapshot = (snapshotId: string) =>
  invoke<void>('rollback_snapshot', { snapshot_id: snapshotId });

export const diffSnapshots = (leftSnapshotId: string, rightSnapshotId: string) =>
  invoke<SnapshotDiff>('diff_snapshots', { left_snapshot_id: leftSnapshotId, right_snapshot_id: rightSnapshotId });

export const exportDeployPackage = (name?: string) =>
  invoke<DeployPackageResult>('export_deploy_package', { name });

export const saveCurrentAsEnvTemplate = (env: 'dev' | 'test' | 'prod') =>
  invoke<void>('save_current_as_env_template', { env });

export const previewEnvTemplate = (env: 'dev' | 'test' | 'prod') =>
  invoke<{ env: string; template_path: string; changed_files: string[] }>('preview_env_template', { env });

export const applyEnvTemplate = (env: 'dev' | 'test' | 'prod') =>
  invoke<void>('apply_env_template', { env });

export const runStartupSelfCheck = () =>
  invoke<SelfCheckReport>('run_startup_self_check');

export const applySelfCheckFixes = () =>
  invoke<string[]>('apply_self_check_fixes');

export const listAuditLogs = (limit = 200) =>
  invoke<any[]>('list_audit_logs', { limit });