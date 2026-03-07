// ===== API Config =====
export interface ApiNode {
  apiUrl: string;
  apiKey: string;
  modelName: string;
  remark: string;
  aiType: 'openai' | 'anthropic' | 'gemini';
}

// ===== Runtime Config =====
export interface SmartRouterRule {
  groups?: string[];
  users?: string[];
  apiIndex: number;
  priority: number;
}

export interface SmartRouter {
  enabled: boolean;
  mode: string;
  defaultApiIndex: number;
  retryCount?: number;
  retryDelay?: number;
  excludeIndices?: number[];
  rules?: SmartRouterRule[];
  primaryApiIndex?: number;
  fallbackApiIndices?: number[];
  degradeStrategy?: 'on-failure' | 'on-timeout' | 'on-any-error';
  maxSwitches?: number;
}

export interface MemorySummary {
  enabled: boolean;
  threshold: number;
  model?: string;
  maxSummaryLength?: number;
  summaryPrompt?: string;
}

export interface RequestQueue {
  maxConcurrent: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface ApiParams {
  temperature?: number;
  maxTokens?: number;
  anthropicMaxTokens?: number;
  geminiMaxTokens?: number;
  [key: string]: number | undefined;
}

export interface RuntimeConfig {
  nickName: string;
  masterQQ: string[];
  activeApiIndex: number;
  activeGroupPersonalityIndex: number;
  activePrivatePersonalityIndex: number;
  groups: string[];
  allowPrivateTalkingUsers: string[];
  userBlacklist: string[];
  maxGroupMessages: number;
  singleMaxMessages: number;
  randomReply: number;
  messagesLength: number;
  enableMemes: boolean;
  memeProb: number;
  logLevel: string;
  privateRefuse: string;
  sleepTime?: number;
  singleAskSleep?: number;
  singleTalkWaiting?: number;
  forwardMaxLength?: number;
  forwardMaxSegments?: number;
  forwardStrategy?: string;
  eachLetterCost?: number;
  groupMentionWait?: number;
  groupLimits: Record<string, number>;
  groupPersonalityMap: Record<string, number>;
  groupApiMap: Record<string, number>;
  smartRouter: SmartRouter;
  memorySummary: MemorySummary;
  requestQueue: RequestQueue;
  apiParams: ApiParams;
  apiHealthWeights?: {
    liveWeight?: number;
    historyWeight?: number;
    timeoutWeight?: number;
    jitterWeight?: number;
  };
}

// ===== Personality =====
export interface Personality {
  remark: string;
  prompt: string;
}

// ===== Memory =====
export interface MemoryMeta {
  id: string;
  filename: string;
  size: number;
  modified: string;
  count: number;
}

// ===== History =====
export interface HistoryFileMeta {
  filename: string;
  size: number;
  modified: string;
}

export interface HistoryEntry {
  timestamp: string;
  type: 'group' | 'private';
  channelId?: string;
  userId?: string;
  username?: string;
  prompt: string;
  reply: string;
  isError: boolean;
  promptLength?: number;
  replyLength?: number;
  contextLength?: number;
  responseTime?: number;
  modelName?: string;
  apiRemark?: string;
}

export interface SearchFilters {
  chat_type?: string | null;
  model?: string | null;
  models?: string[] | null;
  errors_only?: boolean | null;
  from_ts?: string | null;
  to_ts?: string | null;
  error_categories?: string[] | null;
}

export interface HistoryFilterPreset {
  id: string;
  name: string;
  query: string;
  filters: SearchFilters;
}

export interface SearchResult {
  filename: string;
  entries: HistoryEntry[];
}

// ===== System =====
export interface FileHealth {
  key: string;
  filename: string;
  exists: boolean;
  size: number;
  modified: string;
}

export interface SystemInfo {
  plugin_dir: string;
  files: FileHealth[];
}

// ===== API Test =====
export interface PingResult {
  index: number;
  pass: boolean;
  latency_ms: number;
  status: number;
  error?: string;
}

export interface ApiHistoryMetric {
  index: number;
  total: number;
  errors: number;
  error_rate: number;
  timeout_errors?: number;
  timeout_rate?: number;
  avg_response_time_ms: number;
  jitter_ms?: number;
  apiRemark?: string;
  modelName?: string;
}

// ===== Ops / Phase 1+2 =====
export interface SnapshotMeta {
  snapshot_id: string;
  created_at: string;
  reason: string;
  operator: string;
  files: string[];
}

export interface SnapshotDiff {
  left: string;
  right: string;
  changed_files: string[];
  changed_keys_by_file: Record<string, string[]>;
}

export interface DeployPackageResult {
  package_name: string;
  package_path: string;
}

export interface SelfCheckItem {
  code: string;
  level: 'error' | 'warn' | 'info' | string;
  message: string;
  fixable: boolean;
}

export interface SelfCheckReport {
  ok: boolean;
  plugin_dir: string;
  generated_at: string;
  items: SelfCheckItem[];
  report_path: string;
}
