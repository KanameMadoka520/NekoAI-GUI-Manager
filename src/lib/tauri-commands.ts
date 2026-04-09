import { invokeCompat } from './runtime-bridge';
import type {
  MemoryMeta, HistoryFileMeta, SearchFilters, SearchResult,
  SystemInfo, PingResult, SnapshotMeta, SnapshotDiff,
  DeployPackageResult, SelfCheckReport, ApiHistoryMetric,
  ApiHealthWeights,
  ManagerContext, WebConsoleSettings, WebConsoleStatus,
  PersonalityAbRunRequest, PersonalityAbRecord, PersonalityAbTestSummary,
  RunPersonalityEvalExperimentRequest, PersonalityEvalExperimentSummary, PersonalityEvalExperimentRecord,
  SetPersonalityEvalScoreRequest,
} from './types';

// ===== Config =====
export const getConfig = <T = any>(key: string) =>
  invokeCompat<T>('get_config', { key });

export const saveConfig = (key: string, data: any) =>
  invokeCompat<void>('save_config', { key, data });

export const getSystemInfo = () =>
  invokeCompat<SystemInfo>('get_system_info');

export const getManagerContext = () =>
  invokeCompat<ManagerContext>('get_manager_context');

export const setPluginDir = (dir: string) =>
  invokeCompat<void>('set_plugin_dir', { dir });

export const openPathInExplorer = (path: string) =>
  invokeCompat<void>('open_path_in_explorer', { path });

export const getApiHealthWeights = () =>
  invokeCompat<ApiHealthWeights>('get_api_health_weights');

export const saveApiHealthWeights = (weights: ApiHealthWeights) =>
  invokeCompat<void>('save_api_health_weights', { weights });

// ===== Memory =====
export const listMemory = (memType: string) =>
  invokeCompat<MemoryMeta[]>('list_memory', { memType });

export const getMemory = (memType: string, id: string) =>
  invokeCompat<any[]>('get_memory', { memType, id });

export const saveMemory = (memType: string, id: string, data: any[]) =>
  invokeCompat<void>('save_memory', { memType, id, data });

export const deleteMemory = (memType: string, id: string) =>
  invokeCompat<void>('delete_memory', { memType, id });

// ===== History =====
export const listHistoryFiles = () =>
  invokeCompat<HistoryFileMeta[]>('list_history_files');

export const getHistoryFile = (filename: string) =>
  invokeCompat<any>('get_history_file', { filename });

export const searchAllHistory = (query: string, filters: SearchFilters) =>
  invokeCompat<SearchResult[]>('search_all_history', { query, filters });

export const getApiHistoryMetrics = () =>
  invokeCompat<Array<ApiHistoryMetric & {
    api_remark: string;
    model_name: string;
    error_rate: number;
    timeout_rate: number;
    timeout_errors: number;
    avg_response_time_ms: number;
    jitter_ms: number;
  }>>('get_api_history_metrics');

export const exportHistory = (filename: string, format: string) =>
  invokeCompat<string>('export_history', { filename, format });

export const importHistoryFile = (filename: string, data: unknown) =>
  invokeCompat<void>('import_history_file', { filename, data });

// ===== API Test =====
export const pingApi = (url: string, key: string, model: string, aiType: string, xaiWebSearchEnabled = false) =>
  invokeCompat<PingResult>('ping_api', { url, key, model, aiType, xaiWebSearchEnabled });

export const batchPingApis = (nodes: Array<{
  index: number; api_url: string; api_key: string; model_name: string; ai_type: string; xai_web_search_enabled?: boolean;
}>) =>
  invokeCompat<PingResult[]>('batch_ping_apis', { nodes });

export const batchPingApisStream = (sessionId: string, nodes: Array<{
  index: number; api_url: string; api_key: string; model_name: string; ai_type: string; xai_web_search_enabled?: boolean;
}>) =>
  invokeCompat<void>('batch_ping_apis_stream', { sessionId, nodes });

// ===== Personality A/B =====
export const runPersonalityAbTest = (payload: PersonalityAbRunRequest) =>
  invokeCompat<PersonalityAbRecord>('run_personality_ab_test', { payload });

export const listPersonalityAbTests = (limit = 20) =>
  invokeCompat<PersonalityAbTestSummary[]>('list_personality_ab_tests', { limit });

export const getPersonalityAbTest = (id: string) =>
  invokeCompat<PersonalityAbRecord>('get_personality_ab_test', { id });

export const deletePersonalityAbTest = (id: string) =>
  invokeCompat<void>('delete_personality_ab_test', { id });

// ===== Personality Evaluation Lab =====
export const runPersonalityEvalExperimentStream = (sessionId: string, payload: RunPersonalityEvalExperimentRequest) =>
  invokeCompat<void>('run_personality_eval_experiment_stream', { sessionId, payload });

export const listPersonalityEvalExperiments = (limit = 20) =>
  invokeCompat<PersonalityEvalExperimentSummary[]>('list_personality_eval_experiments', { limit });

export const getPersonalityEvalExperiment = (id: string) =>
  invokeCompat<PersonalityEvalExperimentRecord>('get_personality_eval_experiment', { id });

export const setPersonalityEvalScore = (payload: SetPersonalityEvalScoreRequest) =>
  invokeCompat<void>('set_personality_eval_score', { payload });

export const deletePersonalityEvalExperiment = (id: string) =>
  invokeCompat<void>('delete_personality_eval_experiment', { id });

// ===== Ops / Phase 1+2 =====
export const listSnapshots = () =>
  invokeCompat<SnapshotMeta[]>('list_snapshots');

export const createSnapshot = (reason?: string, operator?: string) =>
  invokeCompat<string>('create_snapshot', { reason, operator });

export const rollbackSnapshot = (snapshotId: string) =>
  invokeCompat<void>('rollback_snapshot', { snapshot_id: snapshotId });

export const diffSnapshots = (leftSnapshotId: string, rightSnapshotId: string) =>
  invokeCompat<SnapshotDiff>('diff_snapshots', { left_snapshot_id: leftSnapshotId, right_snapshot_id: rightSnapshotId });

export const exportDeployPackage = (name?: string) =>
  invokeCompat<DeployPackageResult>('export_deploy_package', { name });

export const saveCurrentAsEnvTemplate = (env: 'dev' | 'test' | 'prod') =>
  invokeCompat<void>('save_current_as_env_template', { env });

export const previewEnvTemplate = (env: 'dev' | 'test' | 'prod') =>
  invokeCompat<{ env: string; template_path: string; changed_files: string[] }>('preview_env_template', { env });

export const applyEnvTemplate = (env: 'dev' | 'test' | 'prod') =>
  invokeCompat<void>('apply_env_template', { env });

export const runStartupSelfCheck = () =>
  invokeCompat<SelfCheckReport>('run_startup_self_check');

export const applySelfCheckFixes = () =>
  invokeCompat<string[]>('apply_self_check_fixes');

export const listAuditLogs = (limit = 200) =>
  invokeCompat<any[]>('list_audit_logs', { limit });

// ===== Web Console =====
export const getWebConsoleStatus = () =>
  invokeCompat<WebConsoleStatus>('get_web_console_status');

export const saveWebConsoleSettings = (settings: WebConsoleSettings) =>
  invokeCompat<WebConsoleStatus>('save_web_console_settings', { settings });
