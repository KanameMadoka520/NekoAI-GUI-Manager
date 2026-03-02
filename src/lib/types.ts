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
  modelName?: string;
  apiRemark?: string;
}

export interface SearchFilters {
  chat_type?: string | null;
  model?: string | null;
  errors_only?: boolean | null;
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
