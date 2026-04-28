// ===== API Config =====
export interface ApiNode {
  apiUrl: string;
  apiKey: string;
  modelName: string;
  remark: string;
  aiType: 'openai' | 'responses' | 'anthropic' | 'gemini';
  xaiWebSearchEnabled?: boolean;
}

export type ImageApiProviderType = 'xai' | 'openai';

export interface ImageApiNode {
  providerType: ImageApiProviderType;
  generationUrl: string;
  editUrl: string;
  apiKey: string;
  modelName: string;
  remark: string;
  aspectRatio?: string;
  resolution?: string;
  supportsEdit?: boolean;
}

// ===== Runtime Config =====
export type SmartRouterMode = 'failover' | 'round-robin' | 'random';

export interface SmartRouter {
  enabled: boolean;
  mode: SmartRouterMode;
  retryCount?: number;
  retryDelay?: number;
  excludeIndices?: number[];
}

export interface MemorySummary {
  enabled: boolean;
  threshold: number;
  summaryPrompt?: string;
}

export interface RequestQueue {
  maxConcurrent: number;
  maxPending?: number;
  overflowText?: string;
}

export interface ChatQuotaConfig {
  enabled: boolean;
  defaultLimit: number;
  userLimits: Record<string, number>;
}

export interface ImageQuotaUserLimit {
  generateLimit?: number;
  editLimit?: number;
}

export interface ImageQuotaConfig {
  enabled: boolean;
  defaultGenerateLimit: number;
  defaultEditLimit: number;
  userLimits: Record<string, ImageQuotaUserLimit>;
}

export type ImageAccessMode = 'blacklist' | 'whitelist';
export type ChatAccessMode = 'blacklist' | 'whitelist';

export interface ChatAccessConfig {
  mode: ChatAccessMode;
  whitelistUsers: string[];
}

export interface ImageAccessConfig {
  mode: ImageAccessMode;
  whitelistUsers: string[];
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
  activeImageApiIndex: number;
  activeGroupPersonalityIndex: number;
  activePrivatePersonalityIndex: number;
  forwardModelList?: boolean;
  modelListImageEnabled?: boolean;
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
  memesPath?: string;
  sleepTime?: number;
  singleAskSleep?: number;
  singleTalkWaiting?: number;
  apiTimeoutMs?: number;
  imageApiTimeoutMs?: number;
  sendProcessingNotice?: boolean;
  processingNoticeText?: string;
  processingNoticeDelayMs?: number;
  sendFailureNotice?: boolean;
  failureNoticeDetailMode?: 'full' | 'brief' | 'off';
  generationFailedText?: string;
  forwardMaxLength?: number;
  forwardMaxSegments?: number;
  forwardStrategy?: 'auto' | 'on' | 'off';
  eachLetterCost?: number;
  groupMentionWait?: number;
  groupMentionFocusMode?: boolean;
  contextAutoForgetMs?: number;
  uiStyle?: number;
  chatAccess?: ChatAccessConfig;
  chatQuota?: ChatQuotaConfig;
  imageAccess?: ImageAccessConfig;
  imageQuota?: ImageQuotaConfig;
  groupLimits: Record<string, number>;
  groupPersonalityMap: Record<string, number>;
  groupApiMap: Record<string, number>;
  smartRouter: SmartRouter;
  memorySummary: MemorySummary;
  requestQueue: RequestQueue;
  apiParams: ApiParams;
}

export interface ApiHealthWeights {
  liveWeight: number;
  historyWeight: number;
  timeoutWeight: number;
  jitterWeight: number;
}

export interface UsageData {
  periodId: string;
  counts: Record<string, number>;
  users?: Record<string, number>;
}

export interface ImageUsageUserData {
  generate: number;
  edit: number;
}

export interface ImageUsageData {
  periodId: string;
  users: Record<string, ImageUsageUserData>;
}

export interface UsageEvent {
  id: string;
  timestamp: string;
  periodId: string;
  category: 'chat' | 'image';
  action: string;
  allowed: boolean;
  amount: number;
  userId: string;
  channelId?: string | null;
  scope: 'group' | 'private';
  reason: string;
  isMasterUser?: boolean;
  modelName?: string;
  nodeRemark?: string;
  detail?: Record<string, unknown>;
}

export interface UsageEventLog {
  schemaVersion: number;
  events: UsageEvent[];
}

export interface RuntimeSchemaSection {
  id: string;
  title: string;
  summary: string;
  mode: 'common' | 'advanced' | 'both';
  fields: string[];
}

export interface RuntimeSchemaField {
  title: string;
  type: string;
  description: string;
  default?: unknown;
  enum?: Array<string | number | boolean>;
  minimum?: number;
  maximum?: number;
  step?: number;
  ui?: string;
  placeholder?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  rows?: number;
  displayAsPercentage?: boolean;
  deprecatedValues?: Record<string, {
    replacedBy?: string;
    note?: string;
  }>;
}

export interface RuntimeSchemaDeprecatedField {
  replacedBy?: string;
  note?: string;
}

export interface RuntimeSchema {
  schemaVersion: number;
  plugin: string;
  sections: RuntimeSchemaSection[];
  allowAdditionalPaths?: string[];
  deprecatedFields?: Record<string, RuntimeSchemaDeprecatedField>;
  fields: Record<string, RuntimeSchemaField>;
}

// ===== Personality =====
export interface Personality {
  remark: string;
  prompt: string;
}

export type PersonalityAbMode = 'group' | 'private';

export interface PersonalityAbCandidate {
  index: number;
  remark: string;
  prompt: string;
}

export interface PersonalityAbRunRequest {
  mode: PersonalityAbMode;
  apiNode: ApiNode;
  apiParams: ApiParams;
  contextText?: string;
  latestUserMessage: string;
  candidateA: PersonalityAbCandidate;
  candidateB: PersonalityAbCandidate;
}

export interface PersonalityAbExecutionResult {
  ok: boolean;
  latencyMs: number;
  httpStatus: number;
  responseText: string;
  responseChars: number;
  error?: string;
}

export interface PersonalityAbApiNodeRecord {
  index: number;
  remark: string;
  modelName: string;
  aiType: string;
  urlRedacted: string;
}

export interface PersonalityAbRecord {
  schemaVersion: number;
  id: string;
  createdAt: string;
  mode: PersonalityAbMode;
  input: {
    contextText: string;
    latestUserMessage: string;
  };
  apiNode: PersonalityAbApiNodeRecord;
  apiParamsSnapshot: ApiParams;
  candidateA: PersonalityAbCandidate;
  candidateB: PersonalityAbCandidate;
  resultA: PersonalityAbExecutionResult;
  resultB: PersonalityAbExecutionResult;
}

export interface PersonalityAbTestSummary {
  id: string;
  createdAt: string;
  mode: PersonalityAbMode;
  apiLabel: string;
  pairLabel: string;
  latestUserMessagePreview: string;
  aOk: boolean;
  bOk: boolean;
}

// ===== Personality Evaluation Lab =====
export type PersonalityEvalMode = 'group' | 'private';

export type PersonalityEvalDimensionKey = 'style' | 'stability' | 'completion' | 'humanlikeness';

export const PERSONA_EVAL_DIMENSIONS: Array<{ key: PersonalityEvalDimensionKey; label: string }> = [
  { key: 'style', label: '风格一致性' },
  { key: 'stability', label: '稳定性' },
  { key: 'completion', label: '任务完成度' },
  { key: 'humanlikeness', label: '拟人感' },
];

export interface PersonalityEvalCase {
  id: string;
  name: string;
  tags: string[];
  contextText?: string;
  latestUserMessage: string;
}

export interface PersonalityEvalCandidate {
  index: number;
  remark: string;
  prompt: string;
}

export interface PersonalityEvalApiNodeRecord {
  index: number;
  remark: string;
  modelName: string;
  aiType: string;
  urlRedacted: string;
}

export interface PersonalityEvalRunKey {
  apiIndex: number;
  candidateIndex: number;
  caseId: string;
  round: number;
}

export interface PersonalityEvalExecutionResult {
  ok: boolean;
  latencyMs: number;
  httpStatus: number;
  responseText: string;
  responseChars: number;
  error?: string;
}

export interface PersonalityEvalHumanScore {
  dims: Record<PersonalityEvalDimensionKey, number>;
  note: string;
  scoredAt: string;
}

export interface PersonalityEvalRunRecord {
  key: PersonalityEvalRunKey;
  apiNode: PersonalityEvalApiNodeRecord;
  candidate: PersonalityEvalCandidate;
  caseId: string;
  round: number;
  result: PersonalityEvalExecutionResult;
  score?: PersonalityEvalHumanScore;
}

export interface PersonalityEvalExperimentRecord {
  schemaVersion: number;
  id: string;
  createdAt: string;
  mode: PersonalityEvalMode;
  apiParamsSnapshot: ApiParams;
  apis: PersonalityEvalApiNodeRecord[];
  candidates: PersonalityEvalCandidate[];
  cases: PersonalityEvalCase[];
  rounds: number;
  runs: PersonalityEvalRunRecord[];
}

export interface PersonalityEvalExperimentSummary {
  id: string;
  createdAt: string;
  mode: PersonalityEvalMode;
  totalRuns: number;
  scoredRuns: number;
  apiCount: number;
  candidateCount: number;
  caseCount: number;
}

export interface RunPersonalityEvalExperimentRequest {
  mode: PersonalityEvalMode;
  apis: ApiNode[];
  apiParams: ApiParams;
  candidates: PersonalityEvalCandidate[];
  cases: PersonalityEvalCase[];
  rounds: number;
}

export interface EvalProgressEvent {
  sessionId: string;
  done: number;
  total: number;
  ok: number;
  failed: number;
  last?: {
    apiLabel: string;
    candidateLabel: string;
    caseName: string;
    round: number;
    ok: boolean;
    latencyMs: number;
  };
}

export interface EvalDoneEvent {
  sessionId: string;
  experimentId: string;
}

export interface SetPersonalityEvalScoreRequest {
  experimentId: string;
  runKey: PersonalityEvalRunKey;
  score: PersonalityEvalHumanScore;
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

export interface ManagerContext {
  pluginDir?: string | null;
}

export interface WebConsoleSettings {
  enabled: boolean;
  host: string;
  port: number;
  allowRemoteAccess?: boolean;
  authEnabled?: boolean;
  allowReadOnlyLogin?: boolean;
  forceReadOnly?: boolean;
  allowedRemoteAddrs?: string[];
  sessionTtlMinutes?: number;
}

export interface WebConsoleStatus {
  enabled: boolean;
  running: boolean;
  host: string;
  port: number;
  url: string;
  pluginDir?: string | null;
  allowRemoteAccess?: boolean;
  authEnabled?: boolean;
  hasPassword?: boolean;
  allowReadOnlyLogin?: boolean;
  forceReadOnly?: boolean;
  allowedRemoteAddrs?: string[];
  sessionTtlMinutes?: number;
}

export interface WebConsoleSessionStatus {
  authEnabled: boolean;
  hasPassword: boolean;
  authenticated: boolean;
  readOnly: boolean;
  allowReadOnlyLogin: boolean;
  forceReadOnly: boolean;
  expiresAt?: string | null;
  sessionTtlMinutes: number;
}

export interface WebConsoleLoginResult {
  token: string;
  readOnly: boolean;
  expiresAt: string;
  sessionTtlMinutes: number;
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
