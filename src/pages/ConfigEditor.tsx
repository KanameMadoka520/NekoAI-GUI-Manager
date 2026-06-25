import { useState, useEffect, useRef, useMemo } from 'react';
import { ToggleSwitch } from '../components/common/ToggleSwitch';
import { SliderInput } from '../components/common/SliderInput';
import { TagList } from '../components/common/TagList';
import { KeyValueEditor } from '../components/common/KeyValueEditor';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ImportExportActions } from '../components/common/ImportExportActions';
import { Panel } from '../components/common/Panel';
import { SummaryCard, MiniInfo } from '../components/common/SummaryCard';
import { useUiStore } from '../stores/uiStore';
import { usePageDirtyState } from '../hooks/usePageDirtyState';
import { getConfig, saveConfig } from '../lib/tauri-commands';
import { downloadJsonWithTimestamp, pickJsonAndParse } from '../lib/json-transfer';
import type { RuntimeConfig, RuntimeSchema, RuntimeSchemaDeprecatedField, RuntimeSchemaField } from '../lib/types';

interface Section {
  id: string;
  label: string;
  icon: string;
  summary: string;
  mode: 'common' | 'advanced' | 'both';
}

const sections: Section[] = [
  { id: 'core', label: '核心设置', icon: '⚙', summary: '昵称、主人账号、日志与基础身份。', mode: 'both' },
  { id: 'active', label: '活跃节点/人格', icon: '⚡', summary: '当前生效的 API 与人格索引。', mode: 'both' },
  { id: 'groups', label: '群聊与用户', icon: '👥', summary: '监听群组、私聊白名单、聊天/图像黑白名单与群总额度。', mode: 'both' },
  { id: 'quota', label: '额度规则', icon: '📊', summary: '聊天与图像的默认额度和单独用户额度。', mode: 'both' },
  { id: 'messages', label: '消息行为', icon: '💬', summary: '上下文条数、等待时间、随机回复和打字节奏。', mode: 'both' },
  { id: 'feedback', label: '请求反馈', icon: '📣', summary: '控制处理中提示、失败回报和 API 超时。', mode: 'both' },
  { id: 'memory', label: '记忆与摘要', icon: '🧠', summary: '闲置自动清空、记忆压缩与摘要提示词。', mode: 'common' },
  { id: 'router', label: '智能路由', icon: '🔀', summary: '插件当前支持的路由模式、重试和排除列表。', mode: 'advanced' },
  { id: 'imageRouter', label: '图像路由集群', icon: '🖼', summary: '按图像节点编号顺序接力尝试，任一节点成功即返回结果。', mode: 'advanced' },
  { id: 'memes', label: '表情包', icon: '😸', summary: '控制表情包功能与触发概率。', mode: 'common' },
  { id: 'queue', label: '请求队列', icon: '📤', summary: '当前插件实际消费的请求并发配置。', mode: 'advanced' },
  { id: 'mapping', label: '群级映射', icon: '🗺', summary: '按群定制人格与 API 索引。', mode: 'advanced' },
  { id: 'apiParams', label: 'API 参数', icon: '🎛', summary: '向下游模型透传的参数字典。', mode: 'advanced' },
  { id: 'forward', label: '转发设置', icon: '📨', summary: '长文本转发、模型列表输出和图片卡片风格。', mode: 'both' },
];

const defaults: Partial<RuntimeConfig> = {
  nickName: 'Neko',
  masterQQ: [],
  activeApiIndex: 0,
  activeImageApiIndex: 0,
  activeGroupPersonalityIndex: 0,
  activePrivatePersonalityIndex: 0,
  forwardModelList: true,
  modelListImageEnabled: false,
  groups: [],
  allowPrivateTalkingUsers: [],
  userBlacklist: [],
  maxGroupMessages: 20,
  singleMaxMessages: 40,
  randomReply: 0.3,
  messagesLength: 15,
  enableMemes: false,
  memeProb: 1,
  logLevel: 'debug',
  privateRefuse: '我的主人不让我和陌生人说话，当前是仅主人模式',
  memesPath: '',
  sleepTime: 1000,
  singleAskSleep: 1000,
  singleTalkWaiting: 500,
  apiTimeoutMs: 120000,
  imageApiTimeoutMs: 300000,
  sendProcessingNotice: true,
  processingNoticeText: '已接收到请求，请耐心等待处理。',
  processingNoticeDelayMs: 0,
  sendFailureNotice: true,
  failureNoticeDetailMode: 'full',
  generationFailedText: '本次生成已失败，请重试。',
  eachLetterCost: 1,
  contextAutoForgetMs: 600000,
  forwardStrategy: 'auto',
  forwardMaxLength: 300,
  forwardMaxSegments: 5,
  groupMentionWait: 0,
  groupMentionFocusMode: true,
  uiStyle: 1,
  chatAccess: {
    mode: 'blacklist',
    whitelistUsers: [],
  },
  chatQuota: {
    enabled: false,
    defaultLimit: 0,
    userLimits: {},
  },
  imageAccess: {
    mode: 'blacklist',
    whitelistUsers: [],
  },
  imageQuota: {
    enabled: false,
    defaultGenerateLimit: 0,
    defaultEditLimit: 0,
    userLimits: {},
  },
  groupLimits: {},
  groupPersonalityMap: {},
  groupApiMap: {},
  smartRouter: {
    enabled: false,
    mode: 'failover',
    retryCount: 2,
    retryDelay: 1000,
    sameNodeRetryCount: 0,
    sameNodeRetryDelay: 1000,
    excludeIndices: [],
  },
  imageRouter: {
    enabled: false,
    order: [],
  },
  memorySummary: { enabled: false, threshold: 30, summaryPrompt: '' },
  requestQueue: {
    maxConcurrent: 3,
    maxPending: 10,
    overflowText: 'NEKOAI请求队列已达上限，当前前方有{ahead}个请求未完成。请稍后重试。',
  },
  apiParams: {
    temperature: 0.65,
    maxTokens: 32000,
    anthropicMaxTokens: 4096,
    geminiMaxTokens: 8192,
  },
};

function normalizeSmartRouter(input: RuntimeConfig['smartRouter'] | undefined): RuntimeConfig['smartRouter'] {
  const base = {
    enabled: false,
    mode: 'failover' as const,
    retryCount: 2,
    retryDelay: 1000,
    sameNodeRetryCount: 0,
    sameNodeRetryDelay: 1000,
    excludeIndices: [] as number[],
  };

  const rawMode = input?.mode;
  const mode = rawMode === 'round-robin' || rawMode === 'random' ? rawMode : 'failover';

  return {
    ...base,
    ...(input ?? {}),
    mode,
    retryCount: Number.isFinite(Number(input?.retryCount)) ? Number(input?.retryCount) : base.retryCount,
    retryDelay: Number.isFinite(Number(input?.retryDelay)) ? Number(input?.retryDelay) : base.retryDelay,
    sameNodeRetryCount: Number.isFinite(Number(input?.sameNodeRetryCount)) ? Number(input?.sameNodeRetryCount) : base.sameNodeRetryCount,
    sameNodeRetryDelay: Number.isFinite(Number(input?.sameNodeRetryDelay)) ? Number(input?.sameNodeRetryDelay) : base.sameNodeRetryDelay,
    excludeIndices: (input?.excludeIndices ?? []).filter((x) => Number.isFinite(Number(x))).map((x) => Number(x)),
  };
}

function normalizeImageRouter(input: RuntimeConfig['imageRouter'] | undefined): NonNullable<RuntimeConfig['imageRouter']> {
  const rawItems = Array.isArray(input?.order) ? input?.order : String((input as any)?.order ?? '').split(/[\s,，;；]+/);
  const order: number[] = [];
  const seen = new Set<number>();
  for (const item of rawItems) {
    const index = Number(item);
    if (!Number.isInteger(index) || index < 0 || seen.has(index)) continue;
    seen.add(index);
    order.push(index);
  }
  return {
    enabled: input?.enabled === true,
    order,
  };
}

function normalizeMemorySummary(input: RuntimeConfig['memorySummary'] | undefined): RuntimeConfig['memorySummary'] {
  return {
    enabled: !!input?.enabled,
    threshold: Number.isFinite(Number(input?.threshold)) ? Number(input?.threshold) : 30,
    summaryPrompt: typeof input?.summaryPrompt === 'string' ? input.summaryPrompt : '',
  };
}

function normalizeRequestQueue(input: RuntimeConfig['requestQueue'] | undefined): RuntimeConfig['requestQueue'] {
  return {
    maxConcurrent: Number.isFinite(Number(input?.maxConcurrent)) ? Number(input?.maxConcurrent) : 3,
    maxPending: Number.isFinite(Number(input?.maxPending)) ? Number(input?.maxPending) : 10,
    overflowText: typeof input?.overflowText === 'string' && input.overflowText.trim()
      ? input.overflowText
      : 'NEKOAI请求队列已达上限，当前前方有{ahead}个请求未完成。请稍后重试。',
  };
}

function normalizeImageQuota(input: RuntimeConfig['imageQuota'] | undefined): NonNullable<RuntimeConfig['imageQuota']> {
  const userLimits: NonNullable<RuntimeConfig['imageQuota']>['userLimits'] = {};
  if (input?.userLimits && typeof input.userLimits === 'object') {
    for (const [uid, rawRule] of Object.entries(input.userLimits)) {
      if (!uid.trim() || !rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) continue;
      const rule = rawRule as { generateLimit?: unknown; editLimit?: unknown };
      userLimits[uid] = {
        generateLimit: Number.isFinite(Number(rule.generateLimit)) ? Math.max(0, Math.floor(Number(rule.generateLimit))) : 0,
        editLimit: Number.isFinite(Number(rule.editLimit)) ? Math.max(0, Math.floor(Number(rule.editLimit))) : 0,
      };
    }
  }
  return {
    enabled: input?.enabled === true,
    defaultGenerateLimit: Number.isFinite(Number(input?.defaultGenerateLimit)) ? Math.max(0, Math.floor(Number(input?.defaultGenerateLimit))) : 0,
    defaultEditLimit: Number.isFinite(Number(input?.defaultEditLimit)) ? Math.max(0, Math.floor(Number(input?.defaultEditLimit))) : 0,
    userLimits,
  };
}

function normalizeChatQuota(input: RuntimeConfig['chatQuota'] | undefined): NonNullable<RuntimeConfig['chatQuota']> {
  const userLimits: NonNullable<RuntimeConfig['chatQuota']>['userLimits'] = {};
  if (input?.userLimits && typeof input.userLimits === 'object') {
    for (const [uid, rawValue] of Object.entries(input.userLimits)) {
      if (!uid.trim()) continue;
      userLimits[uid] = Number.isFinite(Number(rawValue)) ? Math.max(0, Math.floor(Number(rawValue))) : 0;
    }
  }
  return {
    enabled: input?.enabled === true,
    defaultLimit: Number.isFinite(Number(input?.defaultLimit)) ? Math.max(0, Math.floor(Number(input?.defaultLimit))) : 0,
    userLimits,
  };
}

function normalizeChatAccess(input: RuntimeConfig['chatAccess'] | undefined): NonNullable<RuntimeConfig['chatAccess']> {
  return {
    mode: input?.mode === 'whitelist' ? 'whitelist' : 'blacklist',
    whitelistUsers: Array.isArray(input?.whitelistUsers)
      ? [...new Set(input.whitelistUsers.map((item) => String(item || '').trim()).filter(Boolean))]
      : [],
  };
}

function normalizeImageAccess(input: RuntimeConfig['imageAccess'] | undefined): NonNullable<RuntimeConfig['imageAccess']> {
  return {
    mode: input?.mode === 'whitelist' ? 'whitelist' : 'blacklist',
    whitelistUsers: Array.isArray(input?.whitelistUsers)
      ? [...new Set(input.whitelistUsers.map((item) => String(item || '').trim()).filter(Boolean))]
      : [],
  };
}

function normalizeApiParams(input: RuntimeConfig['apiParams'] | undefined): RuntimeConfig['apiParams'] {
  const base: RuntimeConfig['apiParams'] = {
    temperature: 0.65,
    maxTokens: 32000,
    anthropicMaxTokens: 4096,
    geminiMaxTokens: 8192,
  };

  const next: RuntimeConfig['apiParams'] = { ...base };
  for (const [key, value] of Object.entries(input ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) next[key] = value;
  }
  return next;
}

function normalizeRuntimeConfig(input?: Partial<RuntimeConfig> | null): RuntimeConfig {
  const merged = { ...defaults, ...(input ?? {}) } as RuntimeConfig;

  return {
    ...merged,
    nickName: typeof merged.nickName === 'string' ? merged.nickName : defaults.nickName!,
    masterQQ: Array.isArray(merged.masterQQ) ? merged.masterQQ.map(String) : [],
    activeApiIndex: Number.isFinite(Number(merged.activeApiIndex)) ? Number(merged.activeApiIndex) : 0,
    activeImageApiIndex: Number.isFinite(Number(merged.activeImageApiIndex)) ? Number(merged.activeImageApiIndex) : 0,
    activeGroupPersonalityIndex: Number.isFinite(Number(merged.activeGroupPersonalityIndex)) ? Number(merged.activeGroupPersonalityIndex) : 0,
    activePrivatePersonalityIndex: Number.isFinite(Number(merged.activePrivatePersonalityIndex)) ? Number(merged.activePrivatePersonalityIndex) : 0,
    forwardModelList: merged.forwardModelList !== undefined ? !!merged.forwardModelList : true,
    modelListImageEnabled: merged.modelListImageEnabled !== undefined ? !!merged.modelListImageEnabled : false,
    groups: Array.isArray(merged.groups) ? merged.groups.map(String) : [],
    allowPrivateTalkingUsers: Array.isArray(merged.allowPrivateTalkingUsers) ? merged.allowPrivateTalkingUsers.map(String) : [],
    userBlacklist: Array.isArray(merged.userBlacklist) ? merged.userBlacklist.map(String) : [],
    maxGroupMessages: Number.isFinite(Number(merged.maxGroupMessages)) ? Number(merged.maxGroupMessages) : 20,
    singleMaxMessages: Number.isFinite(Number(merged.singleMaxMessages)) ? Number(merged.singleMaxMessages) : 40,
    randomReply: Number.isFinite(Number(merged.randomReply)) ? Number(merged.randomReply) : 0.3,
    messagesLength: Number.isFinite(Number(merged.messagesLength)) ? Number(merged.messagesLength) : 15,
    enableMemes: !!merged.enableMemes,
    memeProb: Number.isFinite(Number(merged.memeProb)) ? Number(merged.memeProb) : 1,
    logLevel: typeof merged.logLevel === 'string' ? merged.logLevel : 'debug',
    privateRefuse: typeof merged.privateRefuse === 'string' ? merged.privateRefuse : defaults.privateRefuse!,
    memesPath: typeof merged.memesPath === 'string' ? merged.memesPath : '',
    sleepTime: Number.isFinite(Number(merged.sleepTime)) ? Number(merged.sleepTime) : 1000,
    singleAskSleep: Number.isFinite(Number(merged.singleAskSleep)) ? Number(merged.singleAskSleep) : 1000,
    singleTalkWaiting: Number.isFinite(Number(merged.singleTalkWaiting)) ? Number(merged.singleTalkWaiting) : 500,
    apiTimeoutMs: Number.isFinite(Number(merged.apiTimeoutMs)) ? Number(merged.apiTimeoutMs) : 120000,
    imageApiTimeoutMs: Number.isFinite(Number(merged.imageApiTimeoutMs)) ? Number(merged.imageApiTimeoutMs) : 300000,
    sendProcessingNotice: merged.sendProcessingNotice !== false,
    processingNoticeText: typeof merged.processingNoticeText === 'string' && merged.processingNoticeText.trim()
      ? merged.processingNoticeText
      : '已接收到请求，请耐心等待处理。',
    processingNoticeDelayMs: Number.isFinite(Number(merged.processingNoticeDelayMs)) ? Number(merged.processingNoticeDelayMs) : 0,
    sendFailureNotice: merged.sendFailureNotice !== false,
    failureNoticeDetailMode: merged.failureNoticeDetailMode === 'brief' || merged.failureNoticeDetailMode === 'off' ? merged.failureNoticeDetailMode : 'full',
    generationFailedText: typeof merged.generationFailedText === 'string' && merged.generationFailedText.trim()
      ? merged.generationFailedText
      : '本次生成已失败，请重试。',
    forwardMaxLength: Number.isFinite(Number(merged.forwardMaxLength)) ? Number(merged.forwardMaxLength) : 300,
    forwardMaxSegments: Number.isFinite(Number(merged.forwardMaxSegments)) ? Number(merged.forwardMaxSegments) : 5,
    forwardStrategy: merged.forwardStrategy === 'on' || merged.forwardStrategy === 'off' ? merged.forwardStrategy : 'auto',
    eachLetterCost: Number.isFinite(Number(merged.eachLetterCost)) ? Number(merged.eachLetterCost) : 1,
    groupMentionWait: Number.isFinite(Number(merged.groupMentionWait)) ? Number(merged.groupMentionWait) : 0,
    groupMentionFocusMode: merged.groupMentionFocusMode !== undefined ? !!merged.groupMentionFocusMode : true,
    contextAutoForgetMs: Number.isFinite(Number(merged.contextAutoForgetMs)) ? Number(merged.contextAutoForgetMs) : 600000,
    uiStyle: Number.isFinite(Number(merged.uiStyle)) ? Number(merged.uiStyle) : 1,
    chatAccess: normalizeChatAccess(merged.chatAccess),
    chatQuota: normalizeChatQuota(merged.chatQuota),
    imageAccess: normalizeImageAccess(merged.imageAccess),
    imageQuota: normalizeImageQuota(merged.imageQuota),
    groupLimits: merged.groupLimits && typeof merged.groupLimits === 'object' ? merged.groupLimits : {},
    groupPersonalityMap: merged.groupPersonalityMap && typeof merged.groupPersonalityMap === 'object' ? merged.groupPersonalityMap : {},
    groupApiMap: merged.groupApiMap && typeof merged.groupApiMap === 'object' ? merged.groupApiMap : {},
    smartRouter: normalizeSmartRouter(merged.smartRouter),
    imageRouter: normalizeImageRouter(merged.imageRouter),
    memorySummary: normalizeMemorySummary(merged.memorySummary),
    requestQueue: normalizeRequestQueue(merged.requestQueue),
    apiParams: normalizeApiParams(merged.apiParams),
  };
}

function parseNumberList(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[，,\s]+/)) {
    if (!part) continue;
    const n = Number(part);
    if (Number.isInteger(n) && n >= 0) out.add(n);
  }
  return [...out];
}

function getValueAtPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function setValueAtPath<T>(obj: T, path: string, value: unknown): T {
  const parts = path.split('.');
  const root = Array.isArray(obj) ? [...obj] as unknown as T : { ...(obj as Record<string, unknown>) } as T;
  let cursor: any = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cursor[key];
    cursor[key] = next && typeof next === 'object' && !Array.isArray(next) ? { ...next } : {};
    cursor = cursor[key];
  }

  cursor[parts[parts.length - 1]] = value;
  return root;
}

function deleteValueAtPath<T>(obj: T, path: string): T {
  const parts = path.split('.');
  const root = Array.isArray(obj) ? [...obj] as unknown as T : { ...(obj as Record<string, unknown>) } as T;
  let cursor: any = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cursor[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return root;
    }
    cursor[key] = { ...next };
    cursor = cursor[key];
  }

  delete cursor[parts[parts.length - 1]];
  return root;
}

function getUnknownRuntimePaths(input: unknown, schema: RuntimeSchema | null): string[] {
  if (!schema || !input || typeof input !== 'object' || Array.isArray(input)) return [];

  const exactPaths = new Set(Object.keys(schema.fields));
  const wildcardRoots = new Set(
    (schema.allowAdditionalPaths ?? [])
      .filter((path) => path.endsWith('.*'))
      .map((path) => path.slice(0, -2)),
  );

  const unknown = new Set<string>();
  const obj = input as Record<string, unknown>;

  for (const [key, value] of Object.entries(obj)) {
    if (key === '_comments') continue;

    if (exactPaths.has(key)) continue;

    const nestedKnown = [...exactPaths].filter((path) => path.startsWith(`${key}.`));
    if (nestedKnown.length > 0 && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const nestedKey of Object.keys(value as Record<string, unknown>)) {
        const nestedPath = `${key}.${nestedKey}`;
        if (exactPaths.has(nestedPath) || wildcardRoots.has(key)) continue;
        unknown.add(nestedPath);
      }
      continue;
    }

    unknown.add(key);
  }

  return [...unknown].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

type RuntimeValidationIssue = {
  path: string;
  message: string;
};

type RuntimeDeprecatedIssue = {
  path: string;
  replacedBy?: string;
  note?: string;
};

type RuntimeEnumMigrationIssue = {
  path: string;
  value: string;
  replacedBy?: string;
  note?: string;
};

function validateValueBySchema(path: string, value: unknown, field: RuntimeSchemaField): RuntimeValidationIssue[] {
  const issues: RuntimeValidationIssue[] = [];
  const minimum = field.minimum;
  const maximum = field.maximum;

  const push = (message: string) => issues.push({ path, message });

  if (field.type === 'string') {
    if (typeof value !== 'string') push('应为字符串');
    return issues;
  }

  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') push('应为布尔值');
    return issues;
  }

  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      push('应为数字');
      return issues;
    }
    if (minimum !== undefined && value < minimum) push(`不能小于 ${minimum}`);
    if (maximum !== undefined && value > maximum) push(`不能大于 ${maximum}`);
    return issues;
  }

  if (field.type === 'enum') {
    if (!field.enum?.includes(value as never)) {
      const deprecated = field.deprecatedValues?.[String(value)];
      if (deprecated) {
        const parts = [`值 "${String(value)}" 已废弃`];
        if (deprecated.replacedBy) parts.push(`建议改为 "${deprecated.replacedBy}"`);
        if (deprecated.note) parts.push(deprecated.note);
        push(parts.join('，'));
      } else {
        push(`应属于枚举值: ${(field.enum ?? []).join(', ')}`);
      }
    }
    return issues;
  }

  if (field.type === 'string[]') {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      push('应为字符串数组');
    }
    return issues;
  }

  if (field.type === 'number[]') {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
      push('应为数字数组');
      return issues;
    }
    value.forEach((item, index) => {
      if (minimum !== undefined && item < minimum) issues.push({ path: `${path}[${index}]`, message: `不能小于 ${minimum}` });
      if (maximum !== undefined && item > maximum) issues.push({ path: `${path}[${index}]`, message: `不能大于 ${maximum}` });
    });
    return issues;
  }

  if (field.type === 'record<number>') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      push('应为对象，且值必须是数字');
      return issues;
    }
    for (const [recordKey, recordValue] of Object.entries(value as Record<string, unknown>)) {
      if (typeof recordValue !== 'number' || !Number.isFinite(recordValue)) {
        issues.push({ path: `${path}.${recordKey}`, message: '应为数字' });
        continue;
      }
      if (minimum !== undefined && recordValue < minimum) issues.push({ path: `${path}.${recordKey}`, message: `不能小于 ${minimum}` });
      if (maximum !== undefined && recordValue > maximum) issues.push({ path: `${path}.${recordKey}`, message: `不能大于 ${maximum}` });
    }
  }

  return issues;
}

function validateRuntimeConfigAgainstSchema(input: unknown, schema: RuntimeSchema | null): RuntimeValidationIssue[] {
  if (!schema || !input || typeof input !== 'object' || Array.isArray(input)) return [];

  const issues: RuntimeValidationIssue[] = [];
  for (const [path, field] of Object.entries(schema.fields ?? {})) {
    const value = getValueAtPath(input, path);
    if (value === undefined) continue;
    issues.push(...validateValueBySchema(path, value, field));
  }
  return issues;
}

function getDeprecatedRuntimePaths(input: unknown, schema: RuntimeSchema | null): RuntimeDeprecatedIssue[] {
  if (!schema || !input || typeof input !== 'object' || Array.isArray(input)) return [];

  const deprecatedFields = schema.deprecatedFields ?? {};
  const issues: RuntimeDeprecatedIssue[] = [];

  for (const [path, info] of Object.entries(deprecatedFields)) {
    const value = getValueAtPath(input, path);
    if (value === undefined) continue;
    issues.push({
      path,
      replacedBy: (info as RuntimeSchemaDeprecatedField).replacedBy,
      note: (info as RuntimeSchemaDeprecatedField).note,
    });
  }

  return issues.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
}

function getDeprecatedEnumValueIssues(input: unknown, schema: RuntimeSchema | null): RuntimeEnumMigrationIssue[] {
  if (!schema || !input || typeof input !== 'object' || Array.isArray(input)) return [];

  const issues: RuntimeEnumMigrationIssue[] = [];
  for (const [path, field] of Object.entries(schema.fields ?? {})) {
    if (!field.deprecatedValues) continue;
    const value = getValueAtPath(input, path);
    if (value === undefined) continue;
    const issue = field.deprecatedValues[String(value)];
    if (!issue) continue;
    issues.push({
      path,
      value: String(value),
      replacedBy: issue.replacedBy,
      note: issue.note,
    });
  }
  return issues.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
}

function applySchemaMigrationFixes(input: unknown, schema: RuntimeSchema | null): Record<string, unknown> | null {
  if (!schema || !input || typeof input !== 'object' || Array.isArray(input)) return null;

  let next = { ...(input as Record<string, unknown>) };

  for (const [path, info] of Object.entries(schema.deprecatedFields ?? {})) {
    const currentValue = getValueAtPath(next, path);
    if (currentValue === undefined) continue;
    if (info.replacedBy && getValueAtPath(next, info.replacedBy) === undefined) {
      next = setValueAtPath(next, info.replacedBy, currentValue);
    }
    next = deleteValueAtPath(next, path);
  }

  for (const [path, field] of Object.entries(schema.fields ?? {})) {
    if (!field.deprecatedValues) continue;
    const currentValue = getValueAtPath(next, path);
    if (currentValue === undefined) continue;
    const issue = field.deprecatedValues[String(currentValue)];
    if (!issue?.replacedBy) continue;

    const enumSample = field.enum?.[0];
    let migrated: unknown = issue.replacedBy;
    if (typeof enumSample === 'number') migrated = Number(issue.replacedBy);
    else if (typeof enumSample === 'boolean') migrated = issue.replacedBy === 'true';

    next = setValueAtPath(next, path, migrated);
  }

  return next;
}

function valueToDisplay(value: unknown): string {
  if (value === undefined) return '未设置';
  if (typeof value === 'string') return value || '空字符串';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length ? value.join(', ') : '空列表';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function IssueCallout({ label, text, tone = 'warning' }: { label: string; text: string; tone?: 'warning' | 'error' | 'muted' }) {
  const toneClass =
    tone === 'error'
      ? 'border-[var(--error-soft-border)] text-[var(--error)]'
      : tone === 'muted'
        ? 'border-[var(--border-subtle)] text-[var(--text-muted)]'
        : 'border-[var(--warning-soft-border)] text-[var(--warning)]';

  return (
    <div className="text-xs text-[var(--text-secondary)] leading-relaxed rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
      <div className="flex items-start gap-2 flex-wrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] border mono text-[10px] ${toneClass}`}>
          {label}
        </span>
        <span className="flex-1 min-w-[240px]">：{text}</span>
      </div>
    </div>
  );
}

function getDiffPaths(config: RuntimeConfig | null, baseline: RuntimeConfig | null, schema: RuntimeSchema | null): string[] {
  if (!config || !baseline || !schema) return [];
  const paths = new Set(Object.keys(schema.fields ?? {}));

  const configExtraApiParams = Object.keys(config.apiParams ?? {}).filter((key) => !schema.fields[`apiParams.${key}`]);
  const baselineExtraApiParams = Object.keys(baseline.apiParams ?? {}).filter((key) => !schema.fields[`apiParams.${key}`]);
  [...configExtraApiParams, ...baselineExtraApiParams].forEach((key) => paths.add(`apiParams.${key}`));

  return [...paths]
    .filter((path) => JSON.stringify(getValueAtPath(config, path)) !== JSON.stringify(getValueAtPath(baseline, path)))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function getImageAccessConflictUsers(config: RuntimeConfig | null): string[] {
  if (!config) return [];
  const blacklist = new Set((config.userBlacklist ?? []).map((item) => String(item || '').trim()).filter(Boolean));
  const whitelist = (config.imageAccess?.whitelistUsers ?? []).map((item) => String(item || '').trim()).filter(Boolean);
  return [...new Set(whitelist.filter((uid) => blacklist.has(uid)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function getChatAccessConflictUsers(config: RuntimeConfig | null): string[] {
  if (!config) return [];
  const blacklist = new Set((config.userBlacklist ?? []).map((item) => String(item || '').trim()).filter(Boolean));
  const whitelist = (config.chatAccess?.whitelistUsers ?? []).map((item) => String(item || '').trim()).filter(Boolean);
  return [...new Set(whitelist.filter((uid) => blacklist.has(uid)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export function ConfigEditor() {
  const addToast = useUiStore((s) => s.addToast);
  const settings = useUiStore((s) => s.settings);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [schema, setSchema] = useState<RuntimeSchema | null>(null);
  const [rawConfig, setRawConfig] = useState<Record<string, unknown> | null>(null);
  const [original, setOriginal] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('core');
  const [editorMode, setEditorMode] = useState<'common' | 'full'>('common');
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmResetSecond, setConfirmResetSecond] = useState(false);
  const [diffOverviewExpanded, setDiffOverviewExpanded] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const dirty = useMemo(() => config && JSON.stringify(config) !== original, [config, original]);
  usePageDirtyState('config', !!dirty, '运行配置存在未保存改动，离开后这些改动不会自动写回 runtime_config.json。');
  const effectiveSections = useMemo(() => {
    const schemaSections = new Map((schema?.sections ?? []).map((section) => [section.id, section]));
    return sections.map((section) => {
      const fromSchema = schemaSections.get(section.id);
      if (!fromSchema) return section;
      return {
        ...section,
        label: fromSchema.title || section.label,
        summary: fromSchema.summary || section.summary,
        mode: fromSchema.mode || section.mode,
      };
    });
  }, [schema]);

  const visibleSections = useMemo(
    () => effectiveSections.filter((s) => editorMode === 'full' || s.mode !== 'advanced'),
    [editorMode, effectiveSections],
  );

  const sectionMetaMap = useMemo(
    () => new Map(effectiveSections.map((section) => [section.id, section])),
    [effectiveSections],
  );
  const schemaFieldMap = useMemo(() => schema?.fields ?? {}, [schema]);
  const currentUnknownPaths = useMemo(() => getUnknownRuntimePaths(rawConfig, schema), [rawConfig, schema]);
  const currentDeprecatedPaths = useMemo(() => getDeprecatedRuntimePaths(rawConfig, schema), [rawConfig, schema]);
  const currentDeprecatedValueIssues = useMemo(() => getDeprecatedEnumValueIssues(rawConfig, schema), [rawConfig, schema]);
  const currentValidationIssues = useMemo(() => validateRuntimeConfigAgainstSchema(config, schema), [config, schema]);
  const defaultConfig = useMemo(() => normalizeRuntimeConfig(), []);
  const savedConfig = useMemo(() => {
    if (!original) return null;
    try {
      return JSON.parse(original) as RuntimeConfig;
    } catch {
      return null;
    }
  }, [original]);
  const changedFromDefaults = useMemo(() => getDiffPaths(config, defaultConfig, schema), [config, defaultConfig, schema]);
  const changedFromSaved = useMemo(() => getDiffPaths(config, savedConfig, schema), [config, savedConfig, schema]);
  const chatAccessConflictUsers = useMemo(() => getChatAccessConflictUsers(config), [config]);
  const imageAccessConflictUsers = useMemo(() => getImageAccessConflictUsers(config), [config]);

  const summary = useMemo(() => {
    if (!config) {
      return { groups: 0, privateUsers: 0, blacklist: 0, advancedSections: 0, schemaIssues: 0, defaultDiffs: 0, savedDiffs: 0 };
    }
    return {
      groups: config.groups?.length ?? 0,
      privateUsers: config.allowPrivateTalkingUsers?.length ?? 0,
      blacklist: config.userBlacklist?.length ?? 0,
      advancedSections: effectiveSections.filter((s) => s.mode === 'advanced').length,
      schemaIssues: currentUnknownPaths.length + currentDeprecatedPaths.length + currentDeprecatedValueIssues.length + currentValidationIssues.length,
      defaultDiffs: changedFromDefaults.length,
      savedDiffs: changedFromSaved.length,
    };
  }, [config, effectiveSections, currentUnknownPaths.length, currentDeprecatedPaths.length, currentDeprecatedValueIssues.length, currentValidationIssues.length, changedFromDefaults.length, changedFromSaved.length]);
  const hasConfigOverviewAlert = summary.schemaIssues > 0 || summary.savedDiffs > 0;
  const hasConfigOverviewContent = summary.defaultDiffs > 0 || summary.savedDiffs > 0;

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (hasConfigOverviewAlert) {
      setDiffOverviewExpanded(true);
    }
  }, [hasConfigOverviewAlert]);

  useEffect(() => {
    if (!visibleSections.some((s) => s.id === activeSection)) {
      setActiveSection(visibleSections[0]?.id ?? 'core');
    }
  }, [visibleSections, activeSection]);

  async function load() {
    setLoading(true);
    try {
      const [rt, loadedSchema] = await Promise.all([
        getConfig<RuntimeConfig>('runtime'),
        getConfig<RuntimeSchema>('runtimeSchema').catch(() => null),
      ]);
      const normalized = normalizeRuntimeConfig(rt);
      setConfig(normalized);
      setOriginal(JSON.stringify(normalized));
      setSchema(loadedSchema ?? null);
      setRawConfig(rt && typeof rt === 'object' ? { ...(rt as unknown as Record<string, unknown>) } : {});
    } catch (e: any) {
      addToast('error', `加载配置失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  function update<K extends keyof RuntimeConfig>(key: K, value: RuntimeConfig[K]) {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  }

  function updatePath(path: string, value: unknown) {
    if (!config) return;
    setConfig(setValueAtPath(config, path, value));
  }

  function getSchemaField(path: string): RuntimeSchemaField | null {
    return schemaFieldMap[path] ?? null;
  }

  function renderSchemaField(path: string, options?: {
    label?: string;
    description?: string;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    rows?: number;
    asTextArea?: boolean;
  }) {
    if (!config) return null;
    const meta = getSchemaField(path);
    const label = options?.label || meta?.title || path;
    const description = options?.description || meta?.description || '';
    const value = getValueAtPath(config, path);

    if (meta?.type === 'boolean') {
      return (
        <Field key={path} label={label} description={description}>
          <ToggleSwitch checked={!!value} onChange={(v) => updatePath(path, v)} />
        </Field>
      );
    }

    if (meta?.type === 'string[]') {
      return (
        <Field key={path} label={label} description={description}>
          <TagList
            tags={Array.isArray(value) ? value.map(String) : []}
            onChange={(v) => updatePath(path, v)}
            placeholder={options?.placeholder || meta.placeholder}
          />
        </Field>
      );
    }

    if (meta?.type === 'number[]') {
      return (
        <Field key={path} label={label} description={description}>
          <TextInput
            value={Array.isArray(value) ? value.join(', ') : ''}
            onChange={(v) => updatePath(path, parseNumberList(v))}
            placeholder={options?.placeholder || meta.placeholder}
          />
        </Field>
      );
    }

    if (meta?.type === 'record<number>') {
      return (
        <Field key={path} label={label} description={description}>
          <KeyValueEditor
            data={value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, number> : {}}
            onChange={(v) => updatePath(path, v)}
            keyPlaceholder={meta.keyPlaceholder}
            valuePlaceholder={meta.valuePlaceholder}
          />
        </Field>
      );
    }

    if (meta?.type === 'enum' && Array.isArray(meta.enum)) {
      const enumOptions = meta.enum.map((item) => String(item));
      return (
        <Field key={path} label={label} description={description}>
          <Select
            value={String(value ?? meta.default ?? enumOptions[0] ?? '')}
            onChange={(v) => {
              const sample = meta.enum?.[0];
              if (typeof sample === 'number') updatePath(path, Number(v));
              else if (typeof sample === 'boolean') updatePath(path, v === 'true');
              else updatePath(path, v);
            }}
            options={enumOptions}
          />
        </Field>
      );
    }

    if (meta?.type === 'number') {
      if (meta.ui === 'slider') {
        const numericValue = Number(value ?? meta.default ?? 0);
        const min = options?.min ?? meta.minimum ?? 0;
        const max = options?.max ?? meta.maximum ?? 1;
        const displayValue = meta.displayAsPercentage
          ? `${Math.round(numericValue * 100)}%`
          : undefined;

        return (
          <Field key={path} label={label} description={description}>
            <SliderInput
              value={numericValue}
              onChange={(v) => updatePath(path, v)}
              min={min}
              max={max}
              step={options?.step ?? 0.01}
              displayValue={displayValue}
            />
          </Field>
        );
      }
      return (
        <Field key={path} label={label} description={description}>
          <NumberInput
            value={Number(value ?? meta.default ?? 0)}
            onChange={(v) => updatePath(path, v)}
            min={options?.min ?? meta.minimum}
            max={options?.max ?? meta.maximum}
            step={options?.step ?? meta.step}
          />
        </Field>
      );
    }

    if (options?.asTextArea || meta?.ui === 'textarea') {
      return (
        <Field key={path} label={label} description={description}>
          <TextArea
            value={String(value ?? meta?.default ?? '')}
            onChange={(v) => updatePath(path, v)}
            placeholder={options?.placeholder || meta?.placeholder}
            rows={options?.rows || meta?.rows}
          />
        </Field>
      );
    }

    return (
      <Field key={path} label={label} description={description}>
        <TextInput
          value={String(value ?? meta?.default ?? '')}
          onChange={(v) => updatePath(path, v)}
          placeholder={options?.placeholder || meta?.placeholder}
        />
      </Field>
    );
  }

  function resetAll() {
    if (!config) return;
    const next = normalizeRuntimeConfig();
    setConfig(next);
    addToast('warning', '已恢复所有默认值（需保存才生效）');
  }

  async function save() {
    if (!config) return;
    try {
      await saveConfig('runtime', config);
      setOriginal(JSON.stringify(config));
      setRawConfig(JSON.parse(JSON.stringify(config)));
      addToast('success', '配置已保存');
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message ?? e}`);
    }
  }

  function exportRuntimeConfig() {
    if (!config) return;
    downloadJsonWithTimestamp(config, 'runtime_config.json');
    addToast('success', '已导出配置编辑数据');
  }

  async function importRuntimeConfig() {
    try {
      const picked = await pickJsonAndParse();
      if (!picked) return;
      if (!picked.data || Array.isArray(picked.data) || typeof picked.data !== 'object') {
        addToast('error', '导入失败：JSON 必须是对象');
        return;
      }
      const imported = picked.data as RuntimeConfig;
      setConfig(normalizeRuntimeConfig(imported));
      setRawConfig(picked.data && typeof picked.data === 'object' && !Array.isArray(picked.data) ? { ...(picked.data as Record<string, unknown>) } : {});
      const unknownPaths = getUnknownRuntimePaths(picked.data, schema);
      const deprecatedPaths = getDeprecatedRuntimePaths(picked.data, schema);
      const deprecatedValueIssues = getDeprecatedEnumValueIssues(picked.data, schema);
      const validationIssues = validateRuntimeConfigAgainstSchema(picked.data, schema);
      if (unknownPaths.length > 0) {
        addToast('warning', `导入数据包含 ${unknownPaths.length} 个当前 schema 未识别字段: ${unknownPaths.slice(0, 6).join(', ')}${unknownPaths.length > 6 ? ' ...' : ''}`);
      }
      if (deprecatedPaths.length > 0) {
        addToast('warning', `导入数据包含 ${deprecatedPaths.length} 个已废弃字段: ${deprecatedPaths.slice(0, 4).map((item) => item.replacedBy ? `${item.path}→${item.replacedBy}` : item.path).join(', ')}${deprecatedPaths.length > 4 ? ' ...' : ''}`);
      }
      if (deprecatedValueIssues.length > 0) {
        addToast('warning', `导入数据包含 ${deprecatedValueIssues.length} 个旧值写法: ${deprecatedValueIssues.slice(0, 4).map((item) => item.replacedBy ? `${item.path}:${item.value}→${item.replacedBy}` : `${item.path}:${item.value}`).join(', ')}${deprecatedValueIssues.length > 4 ? ' ...' : ''}`);
      }
      if (validationIssues.length > 0) {
        addToast('warning', `导入数据存在 ${validationIssues.length} 个 schema 校验问题: ${validationIssues.slice(0, 4).map((item) => `${item.path}(${item.message})`).join(', ')}${validationIssues.length > 4 ? ' ...' : ''}`);
      }
      addToast('success', '已导入配置编辑数据（请点击保存生效）');
    } catch (e: any) {
      addToast('error', `导入失败: ${e?.message ?? e}`);
    }
  }

  function scrollTo(id: string) {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function applyMigrationFixes() {
    if (!schema || !rawConfig) return;
    const fixedRaw = applySchemaMigrationFixes(rawConfig, schema);
    if (!fixedRaw) return;
    setRawConfig(fixedRaw);
    setConfig(normalizeRuntimeConfig(fixedRaw as Partial<RuntimeConfig>));
    addToast('success', '已自动修复可迁移的旧字段和旧枚举值，请确认后保存。');
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const top = el.scrollTop + 20;
      for (const s of [...visibleSections].reverse()) {
        const ref = sectionRefs.current[s.id];
        if (ref && ref.offsetTop <= top) {
          setActiveSection(s.id);
          break;
        }
      }
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [visibleSections]);

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="text-4xl block mb-3 animate-bounce">🐱</span>
          <p className="text-[var(--text-secondary)]">加载中...</p>
        </div>
      </div>
    );
  }

  const isSpacious = settings.contentDensity === 'spacious';
  const contentGap = isSpacious ? 'space-y-7' : settings.contentDensity === 'compact' ? 'space-y-4' : 'space-y-6';

  return (
    <div className="flex gap-4 h-full">
      <nav className="w-56 flex-shrink-0 rounded-[var(--radius)] border border-[var(--border-subtle)] overflow-hidden" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
        <div className="px-4 py-4 border-b border-[var(--border-subtle)] space-y-3">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">配置导航</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">先看常用区，进完整模式再处理高级字段。</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setEditorMode('common')}
              className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${editorMode === 'common' ? 'bg-[var(--accent-purple)] text-[var(--on-accent)] border-transparent' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              常用模式
            </button>
            <button
              onClick={() => setEditorMode('full')}
              className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${editorMode === 'full' ? 'bg-[var(--accent-purple)] text-[var(--on-accent)] border-transparent' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              完整模式
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <MiniInfo label="当前章节" value={visibleSections.length} />
            <MiniInfo label="高级章节" value={summary.advancedSections} tone="info" />
          </div>
        </div>

        <div className="max-h-[calc(100%-220px)] overflow-y-auto p-2 space-y-1">
          {visibleSections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`w-full text-left px-3 py-2.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${activeSection === s.id ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'}`}
            >
              <div className="flex items-center gap-2 text-xs">
                <span>{s.icon}</span>
                <span>{s.label}</span>
              </div>
              <p className="mt-1 pl-6 text-[10px] text-[var(--text-muted)] leading-relaxed">{s.summary}</p>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-[var(--border-subtle)] space-y-2">
          <ImportExportActions
            onExport={exportRuntimeConfig}
            onImport={importRuntimeConfig}
            confirmTitle="导入运行时配置"
            size="xs"
          />
          <button
            onClick={() => setConfirmReset(true)}
            className="w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] text-[var(--warning)] hover:bg-[var(--warning-soft-bg)] transition-colors cursor-pointer text-left"
          >
            恢复全部默认
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className={`w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer text-left ${dirty ? 'bg-[var(--accent-purple)] text-[var(--on-accent)] hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
          >
            💾 保存配置
          </button>
        </div>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
          <SummaryCard label="模式" value={editorMode === 'common' ? '常用' : '完整'} hint={editorMode === 'common' ? '隐藏高频外章节，减少表单墙感' : '显示全部字段与高级章节'} />
          <SummaryCard label="活跃 API" value={`#${config.activeApiIndex}`} hint="当前生效节点索引" />
          <SummaryCard label="监听群组" value={String(summary.groups)} hint="当前配置中的群组数量" />
          <SummaryCard label="私聊白名单" value={String(summary.privateUsers)} hint="允许私聊的用户数量" />
          <SummaryCard label="Schema 提醒" value={summary.schemaIssues ? `${summary.schemaIssues} 项` : '无'} hint={summary.schemaIssues ? '当前配置里有需要留意的兼容或约束问题' : '当前配置和 schema 基本一致'} tone={summary.schemaIssues ? 'warning' : 'neutral'} />
          <SummaryCard label="保存状态" value={dirty ? '待保存' : '已同步'} hint={dirty ? `与上次保存相比有 ${summary.savedDiffs} 项变动` : '当前配置与文件一致'} tone={dirty ? 'warning' : 'neutral'} />
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border-subtle)] mb-3 px-4 py-3" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">当前模式说明：</span>
            <span className="text-xs text-[var(--text-secondary)]">
              {editorMode === 'common'
                ? '优先展示昵称、活跃索引、群组、消息、记忆、转发等高频配置。'
                : '显示智能路由、请求队列、群级映射、API 参数等插件真实支持字段。'}
            </span>
            {schema && (
              <span className="text-xs text-[var(--text-muted)]">
                Schema v{schema.schemaVersion} · {Object.keys(schema.fields ?? {}).length} 个字段
              </span>
            )}
            <div className="flex-1" />
            {dirty && <span className="text-xs text-[var(--warning)]">已改动，记得保存</span>}
          </div>
        </div>

        {schema && (
          <div className={`rounded-[var(--radius)] border mb-3 px-4 py-3 ${summary.schemaIssues ? 'border-[var(--warning-soft-border)] bg-[var(--warning-soft-bg)]' : 'border-[var(--success-soft-border)] bg-[var(--success-soft-bg)]'}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">{summary.schemaIssues ? '⚠️' : '✅'}</span>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {summary.schemaIssues ? '配置迁移提醒' : '配置契约状态正常'}
              </p>
            </div>
            {summary.schemaIssues ? (
              <div className="space-y-2 text-xs text-[var(--text-secondary)]">
                {currentDeprecatedPaths.slice(0, 4).map((item) => (
                  <IssueCallout
                    key={`dep-${item.path}`}
                    label={item.path}
                    text={`${item.replacedBy ? `这个字段已经废弃，建议改成 ${item.replacedBy}。` : '这个字段已经废弃。'}${item.note ? ` ${item.note}` : ''}`}
                  />
                ))}
                {currentUnknownPaths.slice(0, 4).map((path) => (
                  <IssueCallout
                    key={`unknown-${path}`}
                    label={path}
                    text="这个字段当前 schema 不认识。通常是旧字段残留、手工拼写错误，或者配置文件版本和插件版本不一致。"
                    tone="muted"
                  />
                ))}
                {currentDeprecatedValueIssues.slice(0, 4).map((issue) => (
                  <IssueCallout
                    key={`enum-${issue.path}`}
                    label={`${issue.path} = ${issue.value}`}
                    text={`${issue.replacedBy ? `这个旧值写法已经废弃，建议改成 ${issue.replacedBy}。` : '这个值写法已经废弃。'}${issue.note ? ` ${issue.note}` : ''}`}
                  />
                ))}
                {currentValidationIssues.slice(0, 4).map((issue) => (
                  <IssueCallout
                    key={`issue-${issue.path}`}
                    label={issue.path}
                    text={`当前值需要检查，${issue.message}。`}
                    tone="error"
                  />
                ))}
                <div className="pt-2 flex flex-wrap gap-2">
                  {(currentDeprecatedPaths.length > 0 || currentDeprecatedValueIssues.length > 0) && (
                    <button
                      onClick={applyMigrationFixes}
                      className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-[var(--on-accent)] hover:opacity-90 cursor-pointer"
                    >
                      自动修复可修项
                    </button>
                  )}
                </div>
                {summary.schemaIssues > 4 && (
                  <p className="text-[var(--text-muted)]">这里只显示前几项提醒，完整情况可通过导入校验或启动自检继续检查。</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">
                当前配置中的字段、枚举值和数值范围都与 <span className="mono">runtime_schema.json</span> 基本一致。
              </p>
            )}
          </div>
        )}

        {schema && (
          <div
            className={`rounded-[var(--radius)] border mb-3 px-4 py-3 ${hasConfigOverviewAlert ? 'border-[var(--warning-soft-border)] bg-[var(--warning-soft-bg)]' : 'border-[var(--border-subtle)]'}`}
            style={{ background: hasConfigOverviewAlert ? undefined : 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}
          >
            <button
              onClick={() => setDiffOverviewExpanded((v) => !v)}
              className="w-full flex items-start gap-3 text-left cursor-pointer"
            >
              <span className="text-sm pt-0.5">🧭</span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-[var(--text-primary)]">配置差异概览</p>
                  {hasConfigOverviewAlert ? (
                    <span className="px-2 py-0.5 text-[10px] rounded-[var(--radius-pill)] bg-[var(--warning-soft-bg)] text-[var(--warning)]">需关注</span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] rounded-[var(--radius-pill)] bg-[var(--success-soft-bg)] text-[var(--success)]">正常</span>
                  )}
                  {summary.savedDiffs > 0 && (
                    <span className="px-2 py-0.5 text-[10px] rounded-[var(--radius-pill)] bg-[var(--warning-soft-bg)] text-[var(--warning)]">未保存 {summary.savedDiffs} 项</span>
                  )}
                  {summary.schemaIssues > 0 && (
                    <span className="px-2 py-0.5 text-[10px] rounded-[var(--radius-pill)] bg-[var(--error-soft-bg)] text-[var(--error)]">契约提醒 {summary.schemaIssues} 项</span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-muted)] leading-relaxed">
                  平时可收起，只看摘要；一旦出现 schema 异常或未保存改动，会自动展开并高亮这一块。
                </p>
              </div>
              <span className="text-xs text-[var(--text-muted)] pt-1">{diffOverviewExpanded ? '收起' : '展开'}</span>
            </button>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
              <SummaryCard label="相对默认值" value={`${summary.defaultDiffs} 项`} hint="和 schema 默认值相比，当前一共改了多少字段" />
              <SummaryCard label="相对上次保存" value={`${summary.savedDiffs} 项`} hint="你当前还没保存的变动字段数量" tone={summary.savedDiffs ? 'warning' : 'neutral'} />
              <SummaryCard label="默认状态" value={summary.defaultDiffs ? '已个性化' : '接近默认'} hint="字段越多，说明你当前配置越偏离默认模板" />
              <SummaryCard label="编辑状态" value={summary.savedDiffs ? '有未保存改动' : '已同步'} hint="这块只看当前表单和上次保存文件的差异" tone={summary.savedDiffs ? 'warning' : 'neutral'} />
            </div>

            {diffOverviewExpanded && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 text-xs text-[var(--text-secondary)] mt-3">
                <div className="space-y-2">
                  <p className="font-medium text-[var(--text-primary)]">相对默认值的主要改动</p>
                  {changedFromDefaults.length === 0 ? (
                    <p className="text-[var(--text-muted)]">当前配置和默认值非常接近，没有明显偏离。</p>
                  ) : (
                    changedFromDefaults.slice(0, 6).map((path) => (
                      <p key={`default-${path}`}>
                        <span className="mono">{path}</span>：
                        <span className="text-[var(--text-muted)]"> 默认 </span>
                        <span className="mono">{valueToDisplay(getValueAtPath(defaultConfig, path))}</span>
                        <span className="text-[var(--text-muted)]">{' -> 当前 '}</span>
                        <span className="mono">{valueToDisplay(getValueAtPath(config, path))}</span>
                      </p>
                    ))
                  )}
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-[var(--text-primary)]">相对上次保存的未提交改动</p>
                  {changedFromSaved.length === 0 ? (
                    <p className="text-[var(--text-muted)]">当前表单和上次保存内容一致。</p>
                  ) : (
                    changedFromSaved.slice(0, 6).map((path) => (
                      <p key={`saved-${path}`}>
                        <span className="mono">{path}</span>：
                        <span className="text-[var(--text-muted)]"> 上次 </span>
                        <span className="mono">{valueToDisplay(getValueAtPath(savedConfig, path))}</span>
                        <span className="text-[var(--text-muted)]">{' -> 当前 '}</span>
                        <span className="mono">{valueToDisplay(getValueAtPath(config, path))}</span>
                      </p>
                    ))
                  )}
                </div>
              </div>
            )}

            {!diffOverviewExpanded && hasConfigOverviewContent && (
              <p className="mt-3 text-[11px] text-[var(--text-muted)]">
                当前只显示差异摘要。展开后可查看相对默认值和相对上次保存的明细。
              </p>
            )}
          </div>
        )}

        <div ref={scrollRef} className={`flex-1 min-h-0 overflow-y-auto pr-2 ${contentGap}`}>
          <SectionCard id="core" title={sectionMetaMap.get('core')?.label ?? '核心设置'} icon="⚙" summary={sectionMetaMap.get('core')?.summary ?? '昵称、主人账号、拒绝文案与日志级别。'} refs={sectionRefs}>
            {renderSchemaField('nickName')}
            {renderSchemaField('masterQQ')}
            {renderSchemaField('privateRefuse')}
            {renderSchemaField('logLevel')}
          </SectionCard>

          <SectionCard id="active" title={sectionMetaMap.get('active')?.label ?? '活跃节点/人格'} icon="⚡" summary={sectionMetaMap.get('active')?.summary ?? '这组配置决定当前默认使用哪个 API 和人格。'} refs={sectionRefs}>
            {renderSchemaField('activeApiIndex', { min: 0 })}
            {renderSchemaField('activeGroupPersonalityIndex', { min: 0 })}
            {renderSchemaField('activePrivatePersonalityIndex', { min: 0 })}
          </SectionCard>

          <SectionCard id="groups" title={sectionMetaMap.get('groups')?.label ?? '群聊与用户管理'} icon="👥" summary={sectionMetaMap.get('groups')?.summary ?? '群组监听范围、用户权限与群级限流。'} refs={sectionRefs}>
            {renderSchemaField('groups')}
            {renderSchemaField('allowPrivateTalkingUsers')}
            {renderSchemaField('userBlacklist')}
            {renderSchemaField('chatAccess.mode')}
            {renderSchemaField('chatAccess.whitelistUsers')}
            {chatAccessConflictUsers.length > 0 && (
              <IssueCallout
                label="聊天权限冲突"
                text={`以下 QQ 同时出现在用户黑名单和聊天白名单里：${chatAccessConflictUsers.join(', ')}。实际运行时黑名单优先，这些人仍然不会收到普通聊天回复。`}
                tone="error"
              />
            )}
            {renderSchemaField('imageAccess.mode')}
            {renderSchemaField('imageAccess.whitelistUsers')}
            {imageAccessConflictUsers.length > 0 && (
              <IssueCallout
                label="图像权限冲突"
                text={`以下 QQ 同时出现在用户黑名单和图像白名单里：${imageAccessConflictUsers.join(', ')}。实际运行时黑名单优先，这些人仍然无法生图或修图。建议你清理其中一侧，避免误判。`}
                tone="error"
              />
            )}
            <InlineNote>聊天白名单只影响普通聊天回复；图像白名单只影响生图 / 修图。用户黑名单始终优先，高于聊天白名单和图像白名单。</InlineNote>
            {renderSchemaField('groupLimits')}
          </SectionCard>

          <SectionCard id="quota" title={sectionMetaMap.get('quota')?.label ?? '额度规则'} icon="📊" summary={sectionMetaMap.get('quota')?.summary ?? '聊天与图像的默认额度和单独用户额度。'} refs={sectionRefs}>
            {renderSchemaField('chatQuota.enabled')}
            {renderSchemaField('chatQuota.defaultLimit')}
            {renderSchemaField('chatQuota.userLimits')}
            {renderSchemaField('imageQuota.enabled')}
            {renderSchemaField('imageQuota.defaultGenerateLimit')}
            {renderSchemaField('imageQuota.defaultEditLimit')}
            <InlineNote>聊天个人额度和群总额度会同时生效。图像额度仍按生图/修图分别统计。</InlineNote>
          </SectionCard>

          <SectionCard id="messages" title={sectionMetaMap.get('messages')?.label ?? '消息行为'} icon="💬" summary={sectionMetaMap.get('messages')?.summary ?? '上下文长度、消息上限与随机回复节奏。'} refs={sectionRefs}>
            {renderSchemaField('maxGroupMessages', { min: 1 })}
            {renderSchemaField('singleMaxMessages', { min: 1 })}
            {renderSchemaField('randomReply')}
            {renderSchemaField('messagesLength', { min: 1 })}
            {renderSchemaField('sleepTime', { min: 0 })}
            {renderSchemaField('singleAskSleep', { min: 0 })}
            {renderSchemaField('singleTalkWaiting', { min: 0 })}
            {renderSchemaField('eachLetterCost', { min: 0 })}
          </SectionCard>

          <SectionCard id="feedback" title={sectionMetaMap.get('feedback')?.label ?? '请求反馈'} icon="📣" summary={sectionMetaMap.get('feedback')?.summary ?? '管理 API 超时、处理中提示以及失败时是否回显错误详情。'} refs={sectionRefs}>
            {renderSchemaField('apiTimeoutMs', { min: 1000 })}
            {renderSchemaField('sendProcessingNotice')}
            {renderSchemaField('processingNoticeText', { placeholder: '已接收到请求，请耐心等待处理。' })}
            {renderSchemaField('processingNoticeDelayMs', { min: 0 })}
            {renderSchemaField('sendFailureNotice')}
            {renderSchemaField('failureNoticeDetailMode')}
            {renderSchemaField('generationFailedText', { placeholder: '本次生成已失败，请重试。' })}
          </SectionCard>

          {visibleSections.some((s) => s.id === 'memory') && (
            <SectionCard id="memory" title={sectionMetaMap.get('memory')?.label ?? '记忆与摘要'} icon="🧠" summary={sectionMetaMap.get('memory')?.summary ?? '决定何时自动清空闲置上下文，以及何时触发摘要压缩。'} refs={sectionRefs}>
              {renderSchemaField('contextAutoForgetMs', { min: 0 })}
              {renderSchemaField('memorySummary.enabled')}
              {renderSchemaField('memorySummary.threshold', { min: 5 })}
              {renderSchemaField('memorySummary.summaryPrompt', { asTextArea: true, placeholder: '留空则使用插件内置默认提示词', rows: 4 })}
            </SectionCard>
          )}

          {visibleSections.some((s) => s.id === 'router') && (
            <SectionCard id="router" title={sectionMetaMap.get('router')?.label ?? '智能路由'} icon="🔀" summary={sectionMetaMap.get('router')?.summary ?? '仅展示插件当前真实支持的路由模式、重试和排除列表。'} refs={sectionRefs}>
              {renderSchemaField('smartRouter.enabled')}
              {renderSchemaField('smartRouter.mode')}
              {renderSchemaField('smartRouter.excludeIndices')}
              {renderSchemaField('smartRouter.sameNodeRetryCount', { min: 0 })}
              {renderSchemaField('smartRouter.sameNodeRetryDelay', { min: 0 })}
              {renderSchemaField('smartRouter.retryCount', { min: 0 })}
              {renderSchemaField('smartRouter.retryDelay', { min: 0 })}
              <InlineNote>
                同节点重试会在当前节点原地重试，智能路由关闭时也能生效；路由重试用于失败后切换到其他节点，需开启智能路由。
              </InlineNote>
            </SectionCard>
          )}

          {visibleSections.some((s) => s.id === 'imageRouter') && (
            <SectionCard id="imageRouter" title={sectionMetaMap.get('imageRouter')?.label ?? '图像路由集群'} icon="🖼" summary={sectionMetaMap.get('imageRouter')?.summary ?? '按图像节点编号顺序接力尝试。'} refs={sectionRefs}>
              {renderSchemaField('imageRouter.enabled')}
              {renderSchemaField('imageRouter.order')}
              <InlineNote>
                推荐在 API 管理页的“图像路由集群”页面维护该顺序；这里保留运行时配置的直接编辑入口。
              </InlineNote>
            </SectionCard>
          )}

          {visibleSections.some((s) => s.id === 'memes') && (
            <SectionCard id="memes" title={sectionMetaMap.get('memes')?.label ?? '表情包'} icon="😸" summary={sectionMetaMap.get('memes')?.summary ?? '控制表情包开关与触发概率。'} refs={sectionRefs}>
              {renderSchemaField('enableMemes')}
              {renderSchemaField('memeProb')}
              {renderSchemaField('memesPath', { placeholder: '例如: plugins/koishi-plugin-Enhanced-NekoAI/neko_memes' })}
            </SectionCard>
          )}

          {visibleSections.some((s) => s.id === 'queue') && (
            <SectionCard id="queue" title={sectionMetaMap.get('queue')?.label ?? '请求队列'} icon="📤" summary={sectionMetaMap.get('queue')?.summary ?? '可配置最大并发数、最大排队长度，以及队列满时发给用户的提示文案。'} refs={sectionRefs}>
              {renderSchemaField('requestQueue.maxConcurrent', { min: 1 })}
              {renderSchemaField('requestQueue.maxPending', { min: 0 })}
              {renderSchemaField('requestQueue.overflowText', { asTextArea: true, rows: 3 })}
              <InlineNote>队列配置当前会影响最大并发数、最大排队数，以及队列满时的自动撤回提示文案。请求失败后的重试仍由智能路由中的 retryCount / retryDelay 控制。</InlineNote>
            </SectionCard>
          )}

          {visibleSections.some((s) => s.id === 'mapping') && (
            <SectionCard id="mapping" title={sectionMetaMap.get('mapping')?.label ?? '群级映射'} icon="🗺" summary={sectionMetaMap.get('mapping')?.summary ?? '按群绑定人格和 API，适合多群多角色场景。'} refs={sectionRefs}>
              {renderSchemaField('groupPersonalityMap')}
              {renderSchemaField('groupApiMap')}
            </SectionCard>
          )}

          {visibleSections.some((s) => s.id === 'apiParams') && (
            <SectionCard id="apiParams" title={sectionMetaMap.get('apiParams')?.label ?? 'API 参数'} icon="🎛" summary={sectionMetaMap.get('apiParams')?.summary ?? 'temperature、maxTokens 等透传参数。'} refs={sectionRefs}>
              {renderSchemaField('apiParams.temperature')}
              {renderSchemaField('apiParams.maxTokens')}
              {renderSchemaField('apiParams.anthropicMaxTokens')}
              {renderSchemaField('apiParams.geminiMaxTokens')}
              <Field label="额外 API 参数 (参数名 → 值)" description="除了内置字段外，这里仍允许补充额外数值参数；与 schema 中已声明的内置参数分开维护。">
                {(() => {
                  const extraApiParams: Record<string, number> = {};
                  for (const [key, value] of Object.entries(config.apiParams ?? {})) {
                    if (['temperature', 'maxTokens', 'anthropicMaxTokens', 'geminiMaxTokens'].includes(key)) continue;
                    if (typeof value === 'number' && Number.isFinite(value)) {
                      extraApiParams[key] = value;
                    }
                  }

                  return (
                    <KeyValueEditor
                      data={extraApiParams}
                      onChange={(v) => update('apiParams', {
                        temperature: config.apiParams.temperature,
                        maxTokens: config.apiParams.maxTokens,
                        anthropicMaxTokens: config.apiParams.anthropicMaxTokens,
                        geminiMaxTokens: config.apiParams.geminiMaxTokens,
                        ...v,
                      } as RuntimeConfig['apiParams'])}
                      keyPlaceholder="参数名"
                      valuePlaceholder="值"
                    />
                  );
                })()}
              </Field>
            </SectionCard>
          )}

          <SectionCard id="forward" title={sectionMetaMap.get('forward')?.label ?? '转发设置'} icon="📨" summary={sectionMetaMap.get('forward')?.summary ?? '长文本转发策略、最大长度、最大分段、@等待与@专注回答模式。'} refs={sectionRefs}>
            {renderSchemaField('forwardStrategy')}
            {renderSchemaField('forwardMaxLength', { min: 100 })}
            {renderSchemaField('forwardMaxSegments', { min: 1 })}
            {renderSchemaField('groupMentionWait', { min: 0 })}
            {renderSchemaField('groupMentionFocusMode')}
            {renderSchemaField('forwardModelList')}
            {renderSchemaField('modelListImageEnabled')}
            {renderSchemaField('uiStyle')}
          </SectionCard>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          setConfirmResetSecond(true);
        }}
        title="恢复全部默认"
        message="该操作会将当前配置字段重置为默认值（需保存后生效）。是否继续？"
        confirmText="继续"
        danger={false}
      />

      <ConfirmDialog
        open={confirmResetSecond}
        onClose={() => setConfirmResetSecond(false)}
        onConfirm={() => {
          setConfirmResetSecond(false);
          resetAll();
        }}
        title="二次确认"
        message="这是高风险操作：将覆盖当前编辑中的配置。请确认你已备份并仍要继续。"
        confirmText="我已了解，恢复默认"
      />
    </div>
  );
}

function SectionCard({ id, title, icon, summary, children, refs }: {
  id: string;
  title: string;
  icon: string;
  summary: string;
  children: React.ReactNode;
  refs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
}) {
  return (
    <div ref={(el) => { refs.current[id] = el; }}>
      <Panel title={title} subtitle={summary} icon={icon}>
        <div className="space-y-4">{children}</div>
      </Panel>
    </div>
  );
}

function InlineNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
      <p className="text-xs text-[var(--text-muted)] mono leading-relaxed">{children}</p>
    </div>
  );
}

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-col lg:flex-row">
      <div className="pt-1 min-w-[220px] flex-shrink-0">
        <label className="text-sm text-[var(--text-secondary)] block">{label}</label>
        {description ? <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">{description}</p> : null}
      </div>
      <div className="flex-1 w-full">{children}</div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] transition-colors placeholder:text-[var(--text-muted)]"
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 4 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] transition-colors placeholder:text-[var(--text-muted)] resize-y"
    />
  );
}

function NumberInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)] transition-colors"
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] transition-colors cursor-pointer"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
