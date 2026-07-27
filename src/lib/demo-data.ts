/**
 * 内置演示数据（Demo Mode）。
 *
 * 仅在「桌面端 + 未连接任何插件目录 + 已进入只读浏览」时启用（见 runtime-bridge 的 demoMode）。
 * 目的：不连接真实目录也能看到各页面在「有数据」时的完整效果，方便预览界面。
 *
 * 铁律：
 * - 全部是写死在前端的假数据，绝不读写磁盘、绝不创建任何真实文件/文件夹。
 * - 读命令返回连贯、彼此呼应的假数据（同一批 API 节点 / 群号 / 用户在各页一致）。
 * - 写命令一律返回无害的成功值，但什么也不落盘；页面上方常驻「演示数据」横幅提示不会保存。
 * - 不处理与目录无关的命令（set_plugin_dir / 打开链接 / Web 控制台等），交回真实通道。
 */

import type {
  ApiNode, ImageApiNode, RuntimeConfig, Personality, ApiHealthWeights,
  UsageData, ImageUsageData, UsageEventLog,
  MemoryMeta, HistoryFileMeta, HistoryEntry, SearchResult,
  SystemInfo, PingResult, SnapshotMeta, SelfCheckReport,
  ApiHistoryMetric, PersonalityAbTestSummary, PersonalityAbRecord,
  PersonalityEvalExperimentSummary, PersonalityEvalExperimentRecord,
} from './types';

// 固定时间戳：脚本环境/演示数据不依赖真实时钟，用稳定字符串避免每次渲染抖动。
const NOW_ISO = '2026-06-28T10:24:00+08:00';
const PERIOD_ID = '20260628-AM';

// ===== 一致的基础假数据：API 节点 / 群 / 用户，在各页之间复用 =====
const DEMO_API_NODES: ApiNode[] = [
  { apiUrl: 'https://api.demo-openai.local/v1/chat/completions', apiKey: 'sk-demo-****-main', modelName: 'gpt-4o-mini', remark: '主力·GPT', aiType: 'openai' },
  { apiUrl: 'https://api.demo-anthropic.local/v1/messages', apiKey: 'sk-demo-****-claude', modelName: 'claude-3-7-sonnet', remark: '备用·Claude', aiType: 'anthropic' },
  { apiUrl: 'https://api.demo-gemini.local/v1beta/models', apiKey: 'sk-demo-****-gemini', modelName: 'gemini-2.0-flash', remark: '轻量·Gemini', aiType: 'gemini' },
];

const DEMO_IMAGE_NODES: ImageApiNode[] = [
  { providerType: 'openai', generationUrl: 'https://api.demo-openai.local/v1/images/generations', editUrl: 'https://api.demo-openai.local/v1/images/edits', apiKey: 'sk-demo-****-img', modelName: 'gpt-image-1', remark: '绘图·主', aspectRatio: '1:1', resolution: '1024x1024', supportsEdit: true },
  { providerType: 'xai', generationUrl: 'https://api.demo-xai.local/v1/images/generations', editUrl: '', apiKey: 'sk-demo-****-xai', modelName: 'grok-2-image', remark: '绘图·备', aspectRatio: '16:9', resolution: '1344x768', supportsEdit: false },
];

const DEMO_GROUPS = ['100200300', '100200301', '100200302'];

const DEMO_RUNTIME: RuntimeConfig = {
  nickName: '塔菲',
  masterQQ: ['88888'],
  activeApiIndex: 0,
  activeImageApiIndex: 0,
  activeGroupPersonalityIndex: 0,
  activePrivatePersonalityIndex: 0,
  forwardModelList: true,
  modelListImageEnabled: true,
  groups: DEMO_GROUPS,
  allowPrivateTalkingUsers: ['10001', '88888'],
  userBlacklist: ['66666'],
  maxGroupMessages: 12,
  singleMaxMessages: 30,
  randomReply: 8,
  messagesLength: 40,
  enableMemes: true,
  memeProb: 15,
  logLevel: 'info',
  privateRefuse: '抱歉，主人没有允许我私聊哦~',
  apiTimeoutMs: 60000,
  imageApiTimeoutMs: 120000,
  sendProcessingNotice: true,
  processingNoticeText: '正在思考中…',
  sendFailureNotice: true,
  failureNoticeDetailMode: 'brief',
  generationFailedText: '生成失败了，待会再试试吧~',
  groupMentionFocusMode: true,
  chatAccess: { mode: 'blacklist', whitelistUsers: [] },
  chatQuota: { enabled: true, defaultLimit: 50, userLimits: { '10001': 100, '88888': 9999 } },
  imageAccess: { mode: 'blacklist', whitelistUsers: [], whitelistGroups: ['100200300'] },
  imageQuota: { enabled: true, defaultGenerateLimit: 10, defaultEditLimit: 5, userLimits: { '88888': { generateLimit: 999, editLimit: 999 } } },
  groupLimits: { '100200300': 20, '100200301': 12 },
  groupPersonalityMap: { '100200300': 0, '100200301': 1 },
  groupApiMap: { '100200300': 0, '100200302': 1 },
  smartRouter: { enabled: true, mode: 'failover', retryCount: 2, retryDelay: 800 },
  imageRouter: { enabled: true, order: [0, 1] },
  memorySummary: { enabled: true, threshold: 40 },
  requestQueue: { maxConcurrent: 3, maxPending: 20, overflowText: '请求有点多，稍等一下哦~' },
  apiParams: { temperature: 0.8, maxTokens: 2048 },
};

const DEMO_GROUP_PERSONALITIES: Personality[] = [
  { remark: '元气塔菲', prompt: '你是塔菲，一只元气满满、爱卖萌的猫娘虚拟主播，说话活泼、偶尔傲娇，喜欢用颜文字。' },
  { remark: '知性助理', prompt: '你是一位沉稳、条理清晰的助理，回答简洁准确，遇到不确定的内容会主动说明。' },
];

const DEMO_PRIVATE_PERSONALITIES: Personality[] = [
  { remark: '贴心私聊', prompt: '在私聊中你更温柔体贴，会主动关心对方的情绪与近况。' },
  { remark: '极简问答', prompt: '私聊时尽量精炼，直接给结论，不展开寒暄。' },
];

const DEMO_COMMANDS: string[] = ['/reset', '/help', '/draw', '/persona', '/clear', '/sign'];

const DEMO_USAGE: UsageData = {
  periodId: PERIOD_ID,
  counts: { '100200300': 42, '100200301': 17, '100200302': 8 },
  users: { '10001': 23, '10002': 11, '88888': 33 },
};

const DEMO_IMAGE_USAGE: ImageUsageData = {
  periodId: PERIOD_ID,
  users: { '10001': { generate: 6, edit: 2 }, '88888': { generate: 14, edit: 5 } },
};

const DEMO_USAGE_EVENTS: UsageEventLog = {
  schemaVersion: 1,
  events: [
    { id: 'evt-1', timestamp: '2026-06-28T09:55:12+08:00', periodId: PERIOD_ID, category: 'chat', action: 'reply', allowed: true, amount: 1, userId: '10001', channelId: '100200300', scope: 'group', reason: 'ok', modelName: 'gpt-4o-mini', nodeRemark: '主力·GPT' },
    { id: 'evt-2', timestamp: '2026-06-28T09:58:40+08:00', periodId: PERIOD_ID, category: 'image', action: 'generate', allowed: true, amount: 1, userId: '88888', channelId: '100200300', scope: 'group', reason: 'ok', isMasterUser: true, nodeRemark: '绘图·主' },
    { id: 'evt-3', timestamp: '2026-06-28T10:03:21+08:00', periodId: PERIOD_ID, category: 'chat', action: 'reply', allowed: false, amount: 0, userId: '66666', channelId: '100200301', scope: 'group', reason: 'blacklist' },
    { id: 'evt-4', timestamp: '2026-06-28T10:10:05+08:00', periodId: PERIOD_ID, category: 'chat', action: 'reply', allowed: false, amount: 0, userId: '10002', scope: 'private', reason: 'quota_exceeded' },
  ],
};

const DEMO_HEALTH_WEIGHTS: ApiHealthWeights = { liveWeight: 0.4, historyWeight: 0.3, timeoutWeight: 0.2, jitterWeight: 0.1 };

type ApiHistoryMetricFull = ApiHistoryMetric & {
  api_remark: string; model_name: string; error_rate: number; timeout_rate: number;
  timeout_errors: number; avg_response_time_ms: number; jitter_ms: number;
};

const DEMO_API_METRICS: ApiHistoryMetricFull[] = [
  { index: 0, total: 320, errors: 6, error_rate: 0.019, timeout_errors: 2, timeout_rate: 0.006, avg_response_time_ms: 1180, jitter_ms: 210, apiRemark: '主力·GPT', modelName: 'gpt-4o-mini', api_remark: '主力·GPT', model_name: 'gpt-4o-mini' },
  { index: 1, total: 145, errors: 9, error_rate: 0.062, timeout_errors: 4, timeout_rate: 0.027, avg_response_time_ms: 1620, jitter_ms: 360, apiRemark: '备用·Claude', modelName: 'claude-3-7-sonnet', api_remark: '备用·Claude', model_name: 'claude-3-7-sonnet' },
  { index: 2, total: 88, errors: 2, error_rate: 0.022, timeout_errors: 1, timeout_rate: 0.011, avg_response_time_ms: 940, jitter_ms: 150, apiRemark: '轻量·Gemini', modelName: 'gemini-2.0-flash', api_remark: '轻量·Gemini', model_name: 'gemini-2.0-flash' },
];

const DEMO_SYSTEM_INFO: SystemInfo = {
  plugin_dir: '（演示模式·未连接真实目录）',
  files: [
    { key: 'api', filename: 'api.json', exists: true, size: 2048, modified: NOW_ISO },
    { key: 'runtime', filename: 'runtime.json', exists: true, size: 5120, modified: NOW_ISO },
    { key: 'groupPersonality', filename: 'groupPersonality.json', exists: true, size: 1536, modified: NOW_ISO },
    { key: 'privatePersonality', filename: 'privatePersonality.json', exists: true, size: 1280, modified: NOW_ISO },
    { key: 'usage', filename: 'usage.json', exists: true, size: 768, modified: NOW_ISO },
  ],
};

// ===== Memory =====
const DEMO_MEMORY_LIST: MemoryMeta[] = [
  { id: '100200300', filename: 'group_100200300.json', size: 4096, modified: NOW_ISO, count: 12 },
  { id: '10001', filename: 'private_10001.json', size: 2048, modified: NOW_ISO, count: 6 },
];

const DEMO_MEMORY_ENTRIES: Array<{ role: string; content: string; time?: string; sender?: string }> = [
  { role: 'user', content: '塔菲今天直播几点开始呀？', time: '2026-06-28 09:10', sender: '用户' },
  { role: 'assistant', content: '今晚八点准时开播哦~ 记得来看塔菲！(=^･ω･^=)', time: '2026-06-28 09:10', sender: 'Neko' },
  { role: 'system', content: '【摘要】用户关心直播时间，已告知今晚八点。', time: '2026-06-28 09:11', sender: '系统摘要' },
];

// ===== History =====
const DEMO_HISTORY_FILES: HistoryFileMeta[] = [
  { filename: 'history_20260628.json', size: 18432, modified: NOW_ISO },
  { filename: 'history_20260627.json', size: 22016, modified: '2026-06-27T23:50:00+08:00' },
];

const DEMO_HISTORY_ENTRIES: HistoryEntry[] = [
  { timestamp: '2026-06-28T09:10:11+08:00', type: 'group', channelId: '100200300', userId: '10001', username: '阿狸', prompt: '塔菲今天直播几点开始？', reply: '今晚八点准时开播哦~', isError: false, promptLength: 12, replyLength: 11, responseTime: 1120, modelName: 'gpt-4o-mini', apiRemark: '主力·GPT' },
  { timestamp: '2026-06-28T09:32:48+08:00', type: 'private', userId: '10002', username: '小明', prompt: '帮我写一句生日祝福', reply: '愿你新的一岁被温柔以待，所愿皆所得~', isError: false, promptLength: 8, replyLength: 18, responseTime: 1340, modelName: 'claude-3-7-sonnet', apiRemark: '备用·Claude' },
  { timestamp: '2026-06-28T10:01:02+08:00', type: 'group', channelId: '100200301', userId: '66666', username: '路人', prompt: '在吗', reply: '请求失败：节点超时', isError: true, promptLength: 2, replyLength: 8, responseTime: 8000, modelName: 'claude-3-7-sonnet', apiRemark: '备用·Claude' },
];

const DEMO_SEARCH_RESULTS: SearchResult[] = [
  { filename: 'history_20260628.json', entries: DEMO_HISTORY_ENTRIES },
];

// ===== Ops =====
const DEMO_SNAPSHOTS: SnapshotMeta[] = [
  { snapshot_id: 'snap-20260628-1000', created_at: NOW_ISO, reason: '日常备份', operator: 'demo', files: ['api.json', 'runtime.json'] },
  { snapshot_id: 'snap-20260627-2300', created_at: '2026-06-27T23:00:00+08:00', reason: '调整人格前备份', operator: 'demo', files: ['groupPersonality.json'] },
];

const DEMO_AUDIT_LOGS = [
  { ts_local: '2026-06-28 10:00:11', ts: NOW_ISO, action: 'create_snapshot', target: 'snap-20260628-1000', status: 'ok' },
  { ts_local: '2026-06-28 09:42:03', ts: '2026-06-28T09:42:03+08:00', action: 'save_config', target: 'runtime.json', status: 'ok' },
  { ts_local: '2026-06-28 09:20:55', ts: '2026-06-28T09:20:55+08:00', action: 'apply_env_template', target: 'prod', status: 'ok' },
];

const DEMO_SELF_CHECK: SelfCheckReport = {
  ok: true,
  plugin_dir: '（演示模式）',
  generated_at: NOW_ISO,
  items: [],
  report_path: '',
};

// ===== Personality A/B & Eval（给出最小可渲染的列表，详情按 id 复用）=====
const DEMO_AB_SUMMARIES: PersonalityAbTestSummary[] = [
  { id: 'ab-demo-1', createdAt: NOW_ISO, mode: 'group', apiLabel: '主力·GPT', pairLabel: '元气塔菲 vs 知性助理', latestUserMessagePreview: '帮我介绍一下你自己', aOk: true, bOk: true },
];

const DEMO_AB_RECORD: PersonalityAbRecord = {
  schemaVersion: 1,
  id: 'ab-demo-1',
  createdAt: NOW_ISO,
  mode: 'group',
  input: { contextText: '群聊气氛轻松', latestUserMessage: '帮我介绍一下你自己' },
  apiNode: { index: 0, remark: '主力·GPT', modelName: 'gpt-4o-mini', aiType: 'openai', urlRedacted: 'https://api.demo-openai.local/****' },
  apiParamsSnapshot: { temperature: 0.8, maxTokens: 2048 },
  candidateA: { index: 0, remark: '元气塔菲', prompt: DEMO_GROUP_PERSONALITIES[0].prompt },
  candidateB: { index: 1, remark: '知性助理', prompt: DEMO_GROUP_PERSONALITIES[1].prompt },
  resultA: { ok: true, latencyMs: 1180, httpStatus: 200, responseText: '我是塔菲，你的元气猫娘主播~ (=^･ω･^=)', responseChars: 18 },
  resultB: { ok: true, latencyMs: 1320, httpStatus: 200, responseText: '我是你的助理，可以帮你整理信息、解答问题。', responseChars: 20 },
};

const DEMO_EVAL_SUMMARIES: PersonalityEvalExperimentSummary[] = [
  { id: 'eval-demo-1', createdAt: NOW_ISO, mode: 'group', totalRuns: 8, scoredRuns: 4, apiCount: 2, candidateCount: 2, caseCount: 2 },
];

const DEMO_EVAL_RECORD: PersonalityEvalExperimentRecord = {
  schemaVersion: 1,
  id: 'eval-demo-1',
  createdAt: NOW_ISO,
  mode: 'group',
  apiParamsSnapshot: { temperature: 0.8, maxTokens: 2048 },
  apis: [
    { index: 0, remark: '主力·GPT', modelName: 'gpt-4o-mini', aiType: 'openai', urlRedacted: 'https://api.demo-openai.local/****' },
    { index: 1, remark: '备用·Claude', modelName: 'claude-3-7-sonnet', aiType: 'anthropic', urlRedacted: 'https://api.demo-anthropic.local/****' },
  ],
  candidates: [
    { index: 0, remark: '元气塔菲', prompt: DEMO_GROUP_PERSONALITIES[0].prompt },
    { index: 1, remark: '知性助理', prompt: DEMO_GROUP_PERSONALITIES[1].prompt },
  ],
  cases: [
    { id: 'case-1', name: '自我介绍', tags: ['基础'], latestUserMessage: '帮我介绍一下你自己' },
    { id: 'case-2', name: '安抚情绪', tags: ['情感'], latestUserMessage: '我今天好累啊' },
  ],
  rounds: 2,
  runs: [
    { key: { apiIndex: 0, candidateIndex: 0, caseId: 'case-1', round: 1 }, apiNode: { index: 0, remark: '主力·GPT', modelName: 'gpt-4o-mini', aiType: 'openai', urlRedacted: 'https://api.demo-openai.local/****' }, candidate: { index: 0, remark: '元气塔菲', prompt: DEMO_GROUP_PERSONALITIES[0].prompt }, caseId: 'case-1', round: 1, result: { ok: true, latencyMs: 1180, httpStatus: 200, responseText: '我是塔菲，你的元气猫娘主播~', responseChars: 14 }, score: { dims: { style: 5, stability: 4, completion: 5, humanlikeness: 5 }, note: '风格鲜明', scoredAt: NOW_ISO } },
    { key: { apiIndex: 0, candidateIndex: 1, caseId: 'case-1', round: 1 }, apiNode: { index: 0, remark: '主力·GPT', modelName: 'gpt-4o-mini', aiType: 'openai', urlRedacted: 'https://api.demo-openai.local/****' }, candidate: { index: 1, remark: '知性助理', prompt: DEMO_GROUP_PERSONALITIES[1].prompt }, caseId: 'case-1', round: 1, result: { ok: true, latencyMs: 1260, httpStatus: 200, responseText: '我是你的助理，可以帮你整理信息。', responseChars: 16 } },
  ],
};

function pingNodes(params: Record<string, unknown>): PingResult[] {
  const nodes = (params.nodes as Array<{ index?: number }> | undefined) ?? [];
  return nodes.map((n, i) => ({ index: typeof n.index === 'number' ? n.index : i, pass: i % 3 !== 1, latency_ms: 720 + i * 180, status: i % 3 === 1 ? 504 : 200, error: i % 3 === 1 ? '演示：模拟超时' : undefined }));
}

// ===== 读 / 取值命令注册表 =====
const readHandlers: Record<string, (params: Record<string, unknown>) => unknown> = {
  get_config: (params) => {
    switch (params.key) {
      case 'api': return DEMO_API_NODES;
      case 'imageApi': return DEMO_IMAGE_NODES;
      case 'runtime': return DEMO_RUNTIME;
      case 'runtimeSchema': return null; // 页面会 catch(()=>null) 并走默认渲染
      case 'groupPersonality': return DEMO_GROUP_PERSONALITIES;
      case 'privatePersonality': return DEMO_PRIVATE_PERSONALITIES;
      case 'commands': return DEMO_COMMANDS;
      case 'usage': return DEMO_USAGE;
      case 'imageUsage': return DEMO_IMAGE_USAGE;
      case 'usageEvents': return DEMO_USAGE_EVENTS;
      default: return null;
    }
  },
  get_system_info: () => DEMO_SYSTEM_INFO,
  get_api_health_weights: () => DEMO_HEALTH_WEIGHTS,
  get_api_history_metrics: () => DEMO_API_METRICS,
  list_memory: () => DEMO_MEMORY_LIST,
  get_memory: () => DEMO_MEMORY_ENTRIES,
  list_history_files: () => DEMO_HISTORY_FILES,
  get_history_file: () => ({ entries: DEMO_HISTORY_ENTRIES }),
  search_all_history: () => DEMO_SEARCH_RESULTS,
  list_snapshots: () => DEMO_SNAPSHOTS,
  list_audit_logs: () => DEMO_AUDIT_LOGS,
  run_startup_self_check: () => DEMO_SELF_CHECK,
  apply_self_check_fixes: () => [],
  list_personality_ab_tests: () => DEMO_AB_SUMMARIES,
  get_personality_ab_test: () => DEMO_AB_RECORD,
  run_personality_ab_test: () => DEMO_AB_RECORD,
  list_personality_eval_experiments: () => DEMO_EVAL_SUMMARIES,
  get_personality_eval_experiment: () => DEMO_EVAL_RECORD,
  ping_api: () => ({ index: 0, pass: true, latency_ms: 760, status: 200 } as PingResult),
  batch_ping_apis: (params) => pingNodes(params),
  export_history: () => '（演示模式）未生成真实导出文件',
  create_snapshot: () => 'snap-demo-new',
  export_deploy_package: () => ({ package_name: 'demo-package.zip', package_path: '（演示模式·未生成真实文件）' }),
  preview_env_template: (params) => ({ env: String(params.env ?? 'dev'), template_path: '（演示模式）', changed_files: ['runtime.json', 'api.json'] }),
  diff_snapshots: (params) => ({ left: String(params.left_snapshot_id ?? ''), right: String(params.right_snapshot_id ?? ''), changed_files: ['runtime.json'], changed_keys_by_file: { 'runtime.json': ['nickName', 'maxGroupMessages'] } }),
};

// 写命令：在演示模式下一律视为成功但不落盘（返回 undefined）。
const VOID_WRITES = new Set<string>([
  'save_config', 'save_memory', 'delete_memory', 'save_api_health_weights',
  'import_history_file', 'batch_ping_apis_stream', 'run_personality_eval_experiment_stream',
  'set_personality_eval_score', 'delete_personality_ab_test', 'delete_personality_eval_experiment',
  'rollback_snapshot', 'save_current_as_env_template', 'apply_env_template',
]);

/**
 * 取演示响应。handled=false 表示本命令不归演示层管（交回真实通道，如目录无关命令）。
 */
export function getDemoResponse(command: string, params: Record<string, unknown>): { handled: boolean; value: unknown } {
  const handler = readHandlers[command];
  if (handler) return { handled: true, value: handler(params) };
  if (VOID_WRITES.has(command)) return { handled: true, value: undefined };
  return { handled: false, value: undefined };
}
