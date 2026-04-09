import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { StatCard } from '../components/common/StatCard';
import { SearchBar } from '../components/common/SearchBar';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ImportExportActions } from '../components/common/ImportExportActions';
import { Panel } from '../components/common/Panel';
import { SummaryCard } from '../components/common/SummaryCard';
import { TagList } from '../components/common/TagList';
import { useUiStore } from '../stores/uiStore';
import { usePageDirtyState } from '../hooks/usePageDirtyState';
import { getConfig, saveConfig } from '../lib/tauri-commands';
import { downloadJsonWithTimestamp, pickJsonAndParse } from '../lib/json-transfer';
import type { RuntimeConfig, UsageData, ImageUsageData, ImageQuotaConfig, ImageQuotaUserLimit, ImageAccessConfig, ChatAccessConfig, ChatQuotaConfig, UsageEvent, UsageEventLog } from '../lib/types';

function getCurrentPeriodId() {
  const now = new Date();
  const utc8 = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 8 * 3600000);
  const y = utc8.getFullYear();
  const m = String(utc8.getMonth() + 1).padStart(2, '0');
  const d = String(utc8.getDate()).padStart(2, '0');
  const h = utc8.getHours();

  if (h >= 6 && h < 18) {
    return `${y}-${m}-${d}_Day`;
  }

  let nightDate = utc8;
  if (h < 6) {
    nightDate = new Date(utc8.getTime() - 24 * 3600 * 1000);
  }
  const ny = nightDate.getFullYear();
  const nm = String(nightDate.getMonth() + 1).padStart(2, '0');
  const nd = String(nightDate.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}_Night`;
}

function normalizeUsage(data: UsageData | null | undefined): UsageData {
  return {
    periodId: typeof data?.periodId === 'string' && data.periodId.trim() ? data.periodId : getCurrentPeriodId(),
    counts: data?.counts && typeof data.counts === 'object' ? { ...data.counts } : {},
    users: data?.users && typeof data.users === 'object' ? { ...data.users } : {},
  };
}

function sanitizeUsage(data: UsageData): UsageData {
  const counts: Record<string, number> = {};
  const users: Record<string, number> = {};
  for (const [gid, raw] of Object.entries(data.counts ?? {})) {
    const groupId = gid.trim();
    const value = Math.max(0, Math.floor(Number(raw)));
    if (!groupId || !Number.isFinite(value) || value <= 0) continue;
    counts[groupId] = value;
  }
  for (const [uid, raw] of Object.entries(data.users ?? {})) {
    const userId = uid.trim();
    const value = Math.max(0, Math.floor(Number(raw)));
    if (!userId || !Number.isFinite(value) || value <= 0) continue;
    users[userId] = value;
  }
  return {
    periodId: data.periodId.trim() || getCurrentPeriodId(),
    counts,
    users,
  };
}

function normalizeImageUsage(data: ImageUsageData | null | undefined): ImageUsageData {
  const users: Record<string, { generate: number; edit: number }> = {};
  if (data?.users && typeof data.users === 'object') {
    for (const [uid, raw] of Object.entries(data.users)) {
      if (!uid.trim() || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const row = raw as { generate?: unknown; edit?: unknown };
      users[uid] = {
        generate: Number.isFinite(Number(row.generate)) ? Math.max(0, Math.floor(Number(row.generate))) : 0,
        edit: Number.isFinite(Number(row.edit)) ? Math.max(0, Math.floor(Number(row.edit))) : 0,
      };
    }
  }
  return {
    periodId: typeof data?.periodId === 'string' && data.periodId.trim() ? data.periodId : getCurrentPeriodId(),
    users,
  };
}

function sanitizeImageUsage(data: ImageUsageData): ImageUsageData {
  const users: Record<string, { generate: number; edit: number }> = {};
  for (const [uid, raw] of Object.entries(data.users ?? {})) {
    const userId = uid.trim();
    const generate = Math.max(0, Math.floor(Number(raw?.generate ?? 0)));
    const edit = Math.max(0, Math.floor(Number(raw?.edit ?? 0)));
    if (!userId || (generate <= 0 && edit <= 0)) continue;
    users[userId] = { generate, edit };
  }
  return {
    periodId: data.periodId.trim() || getCurrentPeriodId(),
    users,
  };
}

function normalizeImageQuota(input: ImageQuotaConfig | null | undefined): ImageQuotaConfig {
  const userLimits: Record<string, ImageQuotaUserLimit> = {};
  if (input?.userLimits && typeof input.userLimits === 'object') {
    for (const [uid, raw] of Object.entries(input.userLimits)) {
      if (!uid.trim() || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const rule = raw as { generateLimit?: unknown; editLimit?: unknown };
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

function normalizeImageAccess(input: ImageAccessConfig | null | undefined): ImageAccessConfig {
  return {
    mode: input?.mode === 'whitelist' ? 'whitelist' : 'blacklist',
    whitelistUsers: Array.isArray(input?.whitelistUsers)
      ? [...new Set(input.whitelistUsers.map((item) => String(item || '').trim()).filter(Boolean))]
      : [],
  };
}

function normalizeChatAccess(input: ChatAccessConfig | null | undefined): ChatAccessConfig {
  return {
    mode: input?.mode === 'whitelist' ? 'whitelist' : 'blacklist',
    whitelistUsers: Array.isArray(input?.whitelistUsers)
      ? [...new Set(input.whitelistUsers.map((item) => String(item || '').trim()).filter(Boolean))]
      : [],
  };
}

function normalizeChatQuota(input: ChatQuotaConfig | null | undefined): ChatQuotaConfig {
  const userLimits: Record<string, number> = {};
  if (input?.userLimits && typeof input.userLimits === 'object') {
    for (const [uid, raw] of Object.entries(input.userLimits)) {
      if (!uid.trim()) continue;
      userLimits[uid] = Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 0;
    }
  }
  return {
    enabled: input?.enabled === true,
    defaultLimit: Number.isFinite(Number(input?.defaultLimit)) ? Math.max(0, Math.floor(Number(input?.defaultLimit))) : 0,
    userLimits,
  };
}

function normalizeUsageEvents(input: UsageEventLog | UsageEvent[] | null | undefined): UsageEventLog {
  const rawEvents = Array.isArray(input)
    ? input
    : (Array.isArray(input?.events) ? input.events : []);
  const events = rawEvents
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const event = item as Partial<UsageEvent>;
      return {
        id: String(event.id || ''),
        timestamp: String(event.timestamp || ''),
        periodId: String(event.periodId || ''),
        category: event.category === 'image' ? 'image' : 'chat',
        action: String(event.action || 'chat'),
        allowed: event.allowed !== false,
        amount: Number.isFinite(Number(event.amount)) ? Math.max(1, Math.floor(Number(event.amount))) : 1,
        userId: String(event.userId || '').trim(),
        channelId: event.channelId == null ? null : String(event.channelId),
        scope: event.scope === 'private' ? 'private' : 'group',
        reason: String(event.reason || 'ok'),
        isMasterUser: event.isMasterUser === true,
        modelName: typeof event.modelName === 'string' ? event.modelName : undefined,
        nodeRemark: typeof event.nodeRemark === 'string' ? event.nodeRemark : undefined,
        detail: event.detail && typeof event.detail === 'object' && !Array.isArray(event.detail) ? event.detail : undefined,
      };
    })
    .filter((event) => event.id && event.timestamp && event.userId);
  return {
    schemaVersion: !Array.isArray(input) && Number.isFinite(Number(input?.schemaVersion)) ? Number(input?.schemaVersion) : 1,
    events,
  };
}

function getImageAccessModeLabel(mode: ImageAccessConfig['mode']) {
  return mode === 'whitelist' ? '白名单模式' : '黑名单模式';
}

function getChatAccessModeLabel(mode: ChatAccessConfig['mode']) {
  return mode === 'whitelist' ? '白名单模式' : '黑名单模式';
}

function formatQuota(limit: number | null | undefined, isMaster = false) {
  if (isMaster) return '主人无限制';
  if (limit === null || limit === undefined || limit <= 0) return '不限额';
  return `${limit}`;
}

function formatTimeBucketLabel(bucket: string, granularity: 'hour' | 'day' | 'week' | 'month') {
  if (granularity === 'hour') return bucket;
  return bucket;
}

function parseHistoryTime(value: string | undefined): Date | null {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const normalized = value.replace(/\//g, '-');
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

function formatUsageEventTime(value: string | undefined) {
  const date = parseHistoryTime(value);
  if (!date) return '-';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function getWeekBucket(date: Date) {
  const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  normalized.setUTCDate(normalized.getUTCDate() + 4 - (normalized.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((normalized.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${normalized.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function bucketHistoryEntry(date: Date, granularity: 'hour' | 'day' | 'week' | 'month') {
  if (granularity === 'hour') return `${String(date.getHours()).padStart(2, '0')}:00`;
  if (granularity === 'day') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (granularity === 'week') return getWeekBucket(date);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
];

const USAGE_EVENT_RETENTION_LIMIT = 10000;
const USAGE_EVENT_PAGE_SIZES = [50, 100, 200] as const;
const USAGE_MANAGER_VIEW_STORAGE_KEY = 'nekoai-usage-manager-view';

type UsageManagerViewState = {
  usageChartGranularity: 'hour' | 'day' | 'week' | 'month';
  usageEventSearch: string;
  usageEventCategoryFilter: 'all' | 'chat' | 'image';
  usageEventAllowedFilter: 'all' | 'allowed' | 'denied';
  usageEventScopeFilter: 'all' | 'group' | 'private';
  usageEventActionFilter: string;
  usageEventReasonFilter: string;
  usageEventUserFilter: string;
  usageEventBucketFilter: string;
  usageEventPageSize: (typeof USAGE_EVENT_PAGE_SIZES)[number];
};

type UsageEventActiveFilterChip = {
  key: 'category' | 'allowed' | 'scope' | 'action' | 'reason' | 'user' | 'bucket' | 'search';
  label: string;
};

const DEFAULT_USAGE_MANAGER_VIEW_STATE: UsageManagerViewState = {
  usageChartGranularity: 'hour',
  usageEventSearch: '',
  usageEventCategoryFilter: 'all',
  usageEventAllowedFilter: 'all',
  usageEventScopeFilter: 'all',
  usageEventActionFilter: 'all',
  usageEventReasonFilter: 'all',
  usageEventUserFilter: '',
  usageEventBucketFilter: '',
  usageEventPageSize: 100,
};

function loadUsageManagerViewState(): UsageManagerViewState {
  try {
    const raw = localStorage.getItem(USAGE_MANAGER_VIEW_STORAGE_KEY);
    if (!raw) return DEFAULT_USAGE_MANAGER_VIEW_STATE;
    const parsed = JSON.parse(raw) as Partial<UsageManagerViewState>;
    const parsedPageSize = Number(parsed.usageEventPageSize);
    return {
      usageChartGranularity: parsed.usageChartGranularity === 'day' || parsed.usageChartGranularity === 'week' || parsed.usageChartGranularity === 'month'
        ? parsed.usageChartGranularity
        : 'hour',
      usageEventSearch: typeof parsed.usageEventSearch === 'string' ? parsed.usageEventSearch : '',
      usageEventCategoryFilter: parsed.usageEventCategoryFilter === 'chat' || parsed.usageEventCategoryFilter === 'image'
        ? parsed.usageEventCategoryFilter
        : 'all',
      usageEventAllowedFilter: parsed.usageEventAllowedFilter === 'allowed' || parsed.usageEventAllowedFilter === 'denied'
        ? parsed.usageEventAllowedFilter
        : 'all',
      usageEventScopeFilter: parsed.usageEventScopeFilter === 'group' || parsed.usageEventScopeFilter === 'private'
        ? parsed.usageEventScopeFilter
        : 'all',
      usageEventActionFilter: typeof parsed.usageEventActionFilter === 'string' ? parsed.usageEventActionFilter : 'all',
      usageEventReasonFilter: typeof parsed.usageEventReasonFilter === 'string' ? parsed.usageEventReasonFilter : 'all',
      usageEventUserFilter: typeof parsed.usageEventUserFilter === 'string' ? parsed.usageEventUserFilter : '',
      usageEventBucketFilter: typeof parsed.usageEventBucketFilter === 'string' ? parsed.usageEventBucketFilter : '',
      usageEventPageSize: USAGE_EVENT_PAGE_SIZES.includes(parsedPageSize as (typeof USAGE_EVENT_PAGE_SIZES)[number])
        ? parsedPageSize as (typeof USAGE_EVENT_PAGE_SIZES)[number]
        : 100,
    };
  } catch {
    return DEFAULT_USAGE_MANAGER_VIEW_STATE;
  }
}

function persistUsageManagerViewState(next: UsageManagerViewState) {
  try {
    localStorage.setItem(USAGE_MANAGER_VIEW_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore local storage failure
  }
}

function getUsageEventCategoryLabel(category: UsageEvent['category']) {
  return category === 'image' ? '图像' : '聊天';
}

function getUsageEventActionLabel(action: string, category?: UsageEvent['category']) {
  const normalized = String(action || '').trim();
  if (normalized === 'generate') return '生图';
  if (normalized === 'edit') return '修图';
  if (normalized === 'chat') return category === 'image' ? '图像' : '聊天';
  return normalized || '-';
}

function getUsageEventReasonLabel(reason: string) {
  const normalized = String(reason || '').trim();
  return ({
    ok: '正常记账',
    master: '主人豁免',
    blacklist: '黑名单',
    'whitelist-required': '需要白名单',
    'whitelist-allowed': '白名单放行',
    'blacklist-mode': '黑名单模式放行',
    'blacklist-mode-group': '群聊默认放行',
    'blacklist-mode-group-friend': '群友默认放行',
    'group-friend-required': '需要群友身份',
    'private-mode-master': '私聊仅主人',
    'private-mode-friends-only': '私聊仅群友',
    'group-limit': '群总额度耗尽',
    'user-limit': '个人额度耗尽',
    'quota-denied': '图像额度不足',
    'permission-denied': '权限不足',
    'no-node': '未找到节点',
    'no-source-image': '未检测到图片',
    'request-failed': '请求失败',
  } as Record<string, string>)[normalized] || normalized || '-';
}

function buildUsageEventSceneLabel(event: UsageEvent) {
  if (event.scope === 'private') return '私聊';
  return event.channelId ? `群:${event.channelId}` : '群聊';
}

function buildUsageEventDetailSummary(detail: UsageEvent['detail']) {
  if (!detail || typeof detail !== 'object') return '-';
  const entries = Object.entries(detail);
  if (entries.length === 0) return '-';
  return entries
    .slice(0, 4)
    .map(([key, value]) => {
      if (value == null) return `${key}=null`;
      if (typeof value === 'object') return `${key}=${JSON.stringify(value)}`;
      return `${key}=${String(value)}`;
    })
    .join(' | ');
}

function matchesUsageEventBucket(event: UsageEvent, bucket: string, granularity: 'hour' | 'day' | 'week' | 'month') {
  if (!bucket) return true;
  const date = parseHistoryTime(event.timestamp);
  if (!date) return false;
  return bucketHistoryEntry(date, granularity) === bucket;
}

function buildUsageEventSearchIndex(event: UsageEvent) {
  const detailText = event.detail ? JSON.stringify(event.detail) : '';
  return [
    event.id,
    event.timestamp,
    event.userId,
    event.channelId ?? '',
    event.scope,
    event.category,
    event.action,
    event.reason,
    event.modelName ?? '',
    event.nodeRemark ?? '',
    buildUsageEventSceneLabel(event),
    buildUsageEventDetailSummary(event.detail),
    detailText,
  ].join(' ').toLowerCase();
}

type GroupUsageRow = {
  gid: string;
  used: number;
  limit?: number;
  remaining?: number;
  listened: boolean;
  hasStoredCount: boolean;
};

type ChatQuotaRow = {
  uid: string;
  isMaster: boolean;
  hasOverride: boolean;
  hasStoredUsage: boolean;
  inGlobalBlacklist: boolean;
  inChatWhitelist: boolean;
  accessStatus: string;
  limit: number | null;
  used: number;
  remaining: number | null;
};

type ImageQuotaRow = {
  uid: string;
  isMaster: boolean;
  hasOverride: boolean;
  hasStoredUsage: boolean;
  inGlobalBlacklist: boolean;
  inImageWhitelist: boolean;
  accessStatus: string;
  generateLimit: number | null;
  editLimit: number | null;
  generateUsed: number;
  editUsed: number;
  generateRemaining: number | null;
  editRemaining: number | null;
};

export function UsageManager() {
  const addToast = useUiStore((s) => s.addToast);
  const pageJumpRequest = useUiStore((s) => s.pageJumpRequest);
  const requestPageJump = useUiStore((s) => s.requestPageJump);
  const clearPageJumpRequest = useUiStore((s) => s.clearPageJumpRequest);
  const initialViewState = useMemo(() => loadUsageManagerViewState(), []);

  const [groupUsage, setGroupUsage] = useState<UsageData>(() => normalizeUsage(null));
  const [imageUsage, setImageUsage] = useState<ImageUsageData>(() => normalizeImageUsage(null));
  const [chatAccess, setChatAccess] = useState<ChatAccessConfig>(() => normalizeChatAccess(null));
  const [chatQuota, setChatQuota] = useState<ChatQuotaConfig>(() => normalizeChatQuota(null));
  const [imageAccess, setImageAccess] = useState<ImageAccessConfig>(() => normalizeImageAccess(null));
  const [imageQuota, setImageQuota] = useState<ImageQuotaConfig>(() => normalizeImageQuota(null));
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [usageEvents, setUsageEvents] = useState<UsageEventLog>(() => normalizeUsageEvents(null));
  const [usageEventsLoading, setUsageEventsLoading] = useState(false);

  const [groupOriginal, setGroupOriginal] = useState('');
  const [imageOriginal, setImageOriginal] = useState('');
  const [chatAccessOriginal, setChatAccessOriginal] = useState('');
  const [chatQuotaOriginal, setChatQuotaOriginal] = useState('');
  const [groupLimitsOriginal, setGroupLimitsOriginal] = useState('');
  const [accessOriginal, setAccessOriginal] = useState('');
  const [quotaOriginal, setQuotaOriginal] = useState('');

  const [loading, setLoading] = useState(true);
  const [groupSearch, setGroupSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [chatUserSearch, setChatUserSearch] = useState('');
  const [newGroupId, setNewGroupId] = useState('');
  const [newChatUserId, setNewChatUserId] = useState('');
  const [newChatWhitelistUserId, setNewChatWhitelistUserId] = useState('');
  const [newUserId, setNewUserId] = useState('');
  const [newWhitelistUserId, setNewWhitelistUserId] = useState('');
  const [usageChartGranularity, setUsageChartGranularity] = useState<'hour' | 'day' | 'week' | 'month'>(initialViewState.usageChartGranularity);
  const [usageEventSearch, setUsageEventSearch] = useState(initialViewState.usageEventSearch);
  const [usageEventCategoryFilter, setUsageEventCategoryFilter] = useState<'all' | 'chat' | 'image'>(initialViewState.usageEventCategoryFilter);
  const [usageEventAllowedFilter, setUsageEventAllowedFilter] = useState<'all' | 'allowed' | 'denied'>(initialViewState.usageEventAllowedFilter);
  const [usageEventScopeFilter, setUsageEventScopeFilter] = useState<'all' | 'group' | 'private'>(initialViewState.usageEventScopeFilter);
  const [usageEventActionFilter, setUsageEventActionFilter] = useState(initialViewState.usageEventActionFilter);
  const [usageEventReasonFilter, setUsageEventReasonFilter] = useState(initialViewState.usageEventReasonFilter);
  const [usageEventUserFilter, setUsageEventUserFilter] = useState(initialViewState.usageEventUserFilter);
  const [usageEventBucketFilter, setUsageEventBucketFilter] = useState(initialViewState.usageEventBucketFilter);
  const [usageEventPage, setUsageEventPage] = useState(0);
  const [usageEventPageSize, setUsageEventPageSize] = useState<(typeof USAGE_EVENT_PAGE_SIZES)[number]>(initialViewState.usageEventPageSize);
  const [pendingQuotaFocus, setPendingQuotaFocus] = useState<{ category: 'chat' | 'image'; userId: string } | null>(null);
  const [highlightedQuotaKey, setHighlightedQuotaKey] = useState('');

  const [confirmResetGroup, setConfirmResetGroup] = useState(false);
  const [confirmDropUnknown, setConfirmDropUnknown] = useState(false);
  const [confirmResetImage, setConfirmResetImage] = useState(false);
  const chatQuotaRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const imageQuotaRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const groupDirty = useMemo(() => JSON.stringify(groupUsage) !== groupOriginal, [groupUsage, groupOriginal]);
  const chatAccessDirty = useMemo(() => JSON.stringify(chatAccess) !== chatAccessOriginal, [chatAccess, chatAccessOriginal]);
  const chatQuotaDirty = useMemo(() => JSON.stringify(chatQuota) !== chatQuotaOriginal, [chatQuota, chatQuotaOriginal]);
  const imageDirty = useMemo(() => JSON.stringify(imageUsage) !== imageOriginal, [imageUsage, imageOriginal]);
  const accessDirty = useMemo(() => JSON.stringify(imageAccess) !== accessOriginal, [imageAccess, accessOriginal]);
  const quotaDirty = useMemo(() => JSON.stringify(imageQuota) !== quotaOriginal, [imageQuota, quotaOriginal]);
  const groupLimitDirty = useMemo(() => JSON.stringify(runtime?.groupLimits ?? {}) !== groupLimitsOriginal, [runtime?.groupLimits, groupLimitsOriginal]);
  const imageRuleDirty = accessDirty || quotaDirty;
  const chatRuleDirty = chatAccessDirty || chatQuotaDirty || groupLimitDirty;
  usePageDirtyState('usage', groupDirty || imageDirty || imageRuleDirty || chatRuleDirty, '用量计数或限额规则存在未保存改动，离开后这些改动不会自动写回文件。');

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setUsageEventBucketFilter('');
  }, [usageChartGranularity]);

  useEffect(() => {
    setUsageEventPage(0);
  }, [
    usageEventSearch,
    usageEventCategoryFilter,
    usageEventAllowedFilter,
    usageEventScopeFilter,
    usageEventActionFilter,
    usageEventReasonFilter,
    usageEventUserFilter,
    usageEventBucketFilter,
    usageEventPageSize,
  ]);

  useEffect(() => {
    persistUsageManagerViewState({
      usageChartGranularity,
      usageEventSearch,
      usageEventCategoryFilter,
      usageEventAllowedFilter,
      usageEventScopeFilter,
      usageEventActionFilter,
      usageEventReasonFilter,
      usageEventUserFilter,
      usageEventBucketFilter,
      usageEventPageSize,
    });
  }, [
    usageChartGranularity,
    usageEventSearch,
    usageEventCategoryFilter,
    usageEventAllowedFilter,
    usageEventScopeFilter,
    usageEventActionFilter,
    usageEventReasonFilter,
    usageEventUserFilter,
    usageEventBucketFilter,
    usageEventPageSize,
  ]);

  async function load() {
    setLoading(true);
    try {
      const [groupUsageData, imageUsageData, runtimeConfig] = await Promise.all([
        getConfig<UsageData>('usage'),
        getConfig<ImageUsageData>('imageUsage'),
        getConfig<RuntimeConfig>('runtime'),
      ]);
      const normalizedGroup = normalizeUsage(groupUsageData);
      const normalizedImage = normalizeImageUsage(imageUsageData);
      const normalizedChatAccess = normalizeChatAccess(runtimeConfig?.chatAccess);
      const normalizedChatQuota = normalizeChatQuota(runtimeConfig?.chatQuota);
      const normalizedAccess = normalizeImageAccess(runtimeConfig?.imageAccess);
      const normalizedQuota = normalizeImageQuota(runtimeConfig?.imageQuota);
      setGroupUsage(normalizedGroup);
      setImageUsage(normalizedImage);
      setChatAccess(normalizedChatAccess);
      setChatQuota(normalizedChatQuota);
      setImageAccess(normalizedAccess);
      setImageQuota(normalizedQuota);
      setGroupOriginal(JSON.stringify(normalizedGroup));
      setImageOriginal(JSON.stringify(normalizedImage));
      setChatAccessOriginal(JSON.stringify(normalizedChatAccess));
      setChatQuotaOriginal(JSON.stringify(normalizedChatQuota));
      setGroupLimitsOriginal(JSON.stringify(runtimeConfig?.groupLimits ?? {}));
      setAccessOriginal(JSON.stringify(normalizedAccess));
      setQuotaOriginal(JSON.stringify(normalizedQuota));
      setRuntime(runtimeConfig ?? null);
      void loadUsageEvents();
    } catch (e: any) {
      addToast('error', `加载用量/限额数据失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadUsageEvents() {
    setUsageEventsLoading(true);
    try {
      const raw = await getConfig<UsageEventLog | UsageEvent[]>('usageEvents');
      setUsageEvents(normalizeUsageEvents(raw));
    } catch (e: any) {
      addToast('warning', `加载用量事件日志失败: ${e?.message ?? e}`);
      setUsageEvents(normalizeUsageEvents(null));
    } finally {
      setUsageEventsLoading(false);
    }
  }

  const groupRows = useMemo<GroupUsageRow[]>(() => {
    const ids = new Set<string>([
      ...(runtime?.groups ?? []),
      ...Object.keys(groupUsage.counts ?? {}),
    ]);

    return [...ids]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((gid) => {
        const used = Math.max(0, Math.floor(Number(groupUsage.counts?.[gid] ?? 0)));
        const limit = runtime?.groupLimits?.[gid];
        const remaining = limit !== undefined ? Math.max(limit - used, 0) : undefined;
        return {
          gid,
          used,
          limit,
          remaining,
          listened: (runtime?.groups ?? []).includes(gid),
          hasStoredCount: Object.prototype.hasOwnProperty.call(groupUsage.counts ?? {}, gid),
        };
      });
  }, [runtime, groupUsage.counts]);

  const filteredGroupRows = useMemo(() => {
    if (!groupSearch.trim()) return groupRows;
    const q = groupSearch.trim().toLowerCase();
    return groupRows.filter((row) => row.gid.toLowerCase().includes(q));
  }, [groupRows, groupSearch]);

  const chatRows = useMemo<ChatQuotaRow[]>(() => {
    const blacklist = new Set((runtime?.userBlacklist ?? []).map((item) => String(item || '').trim()).filter(Boolean));
    const whitelist = new Set((chatAccess.whitelistUsers ?? []).map((item) => String(item || '').trim()).filter(Boolean));
    const ids = new Set<string>([
      ...(runtime?.masterQQ ?? []),
      ...(runtime?.userBlacklist ?? []),
      ...(chatAccess.whitelistUsers ?? []),
      ...Object.keys(groupUsage.users ?? {}),
      ...Object.keys(chatQuota.userLimits ?? {}),
    ]);

    return [...ids]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((uid) => {
        const isMaster = (runtime?.masterQQ ?? []).includes(uid);
        const hasOverride = Object.prototype.hasOwnProperty.call(chatQuota.userLimits ?? {}, uid);
        const used = Math.max(0, Math.floor(Number(groupUsage.users?.[uid] ?? 0)));
        const inGlobalBlacklist = blacklist.has(uid);
        const inChatWhitelist = whitelist.has(uid);
        const limit = isMaster
          ? null
          : hasOverride
            ? Math.max(0, Math.floor(Number(chatQuota.userLimits?.[uid] ?? 0)))
            : Math.max(0, Math.floor(Number(chatQuota.defaultLimit ?? 0)));
        return {
          uid,
          isMaster,
          hasOverride,
          hasStoredUsage: Object.prototype.hasOwnProperty.call(groupUsage.users ?? {}, uid),
          inGlobalBlacklist,
          inChatWhitelist,
          accessStatus: isMaster
            ? '主人豁免'
            : inGlobalBlacklist
              ? '黑名单禁止'
              : chatAccess.mode === 'whitelist'
                ? (inChatWhitelist ? '白名单允许' : '未在白名单')
                : '黑名单模式默认可用',
          limit,
          used,
          remaining: limit && limit > 0 ? Math.max(limit - used, 0) : null,
        };
      });
  }, [runtime?.masterQQ, runtime?.userBlacklist, groupUsage.users, chatQuota, chatAccess]);

  const filteredChatRows = useMemo(() => {
    if (!chatUserSearch.trim()) return chatRows;
    const q = chatUserSearch.trim().toLowerCase();
    return chatRows.filter((row) => row.uid.toLowerCase().includes(q));
  }, [chatRows, chatUserSearch]);

  const imageRows = useMemo<ImageQuotaRow[]>(() => {
    const blacklist = new Set((runtime?.userBlacklist ?? []).map((item) => String(item || '').trim()).filter(Boolean));
    const whitelist = new Set((imageAccess.whitelistUsers ?? []).map((item) => String(item || '').trim()).filter(Boolean));
    const ids = new Set<string>([
      ...(runtime?.masterQQ ?? []),
      ...(runtime?.userBlacklist ?? []),
      ...(imageAccess.whitelistUsers ?? []),
      ...Object.keys(imageUsage.users ?? {}),
      ...Object.keys(imageQuota.userLimits ?? {}),
    ]);

    return [...ids]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((uid) => {
        const isMaster = (runtime?.masterQQ ?? []).includes(uid);
        const hasOverride = Object.prototype.hasOwnProperty.call(imageQuota.userLimits ?? {}, uid);
        const override = imageQuota.userLimits?.[uid];
        const inGlobalBlacklist = blacklist.has(uid);
        const inImageWhitelist = whitelist.has(uid);
        const generateUsed = Math.max(0, Math.floor(Number(imageUsage.users?.[uid]?.generate ?? 0)));
        const editUsed = Math.max(0, Math.floor(Number(imageUsage.users?.[uid]?.edit ?? 0)));
        const generateLimit = isMaster
          ? null
          : hasOverride
            ? Math.max(0, Math.floor(Number(override?.generateLimit ?? 0)))
            : Math.max(0, Math.floor(Number(imageQuota.defaultGenerateLimit ?? 0)));
        const editLimit = isMaster
          ? null
          : hasOverride
            ? Math.max(0, Math.floor(Number(override?.editLimit ?? 0)))
            : Math.max(0, Math.floor(Number(imageQuota.defaultEditLimit ?? 0)));
        return {
          uid,
          isMaster,
          hasOverride,
          hasStoredUsage: Object.prototype.hasOwnProperty.call(imageUsage.users ?? {}, uid),
          inGlobalBlacklist,
          inImageWhitelist,
          accessStatus: isMaster
            ? '主人豁免'
            : inGlobalBlacklist
              ? '黑名单禁止'
              : imageAccess.mode === 'whitelist'
                ? (inImageWhitelist ? '白名单允许' : '未在白名单')
                : '黑名单模式默认可用',
          generateLimit,
          editLimit,
          generateUsed,
          editUsed,
          generateRemaining: generateLimit && generateLimit > 0 ? Math.max(generateLimit - generateUsed, 0) : null,
          editRemaining: editLimit && editLimit > 0 ? Math.max(editLimit - editUsed, 0) : null,
        };
      });
  }, [runtime?.masterQQ, runtime?.userBlacklist, imageUsage.users, imageQuota, imageAccess]);

  const filteredImageRows = useMemo(() => {
    if (!userSearch.trim()) return imageRows;
    const q = userSearch.trim().toLowerCase();
    return imageRows.filter((row) => row.uid.toLowerCase().includes(q));
  }, [imageRows, userSearch]);

  useEffect(() => {
    if (!pageJumpRequest || pageJumpRequest.page !== 'usage' || pageJumpRequest.kind !== 'quota-user' || loading) return;
    jumpToQuotaUser(pageJumpRequest.category, pageJumpRequest.userId);
    clearPageJumpRequest();
  }, [pageJumpRequest, loading, clearPageJumpRequest, chatRows, imageRows]);

  const groupSummary = useMemo(() => {
    const totalUsed = groupRows.reduce((sum, row) => sum + row.used, 0);
    const limitedGroups = groupRows.filter((row) => row.limit !== undefined).length;
    const exhausted = groupRows.filter((row) => row.limit !== undefined && row.used >= row.limit).length;
    return {
      totalGroups: groupRows.length,
      totalUsed,
      limitedGroups,
      exhausted,
    };
  }, [groupRows]);

  const chatSummary = useMemo(() => {
    const totalUsed = chatRows.reduce((sum, row) => sum + row.used, 0);
    const overrideUsers = Object.keys(chatQuota.userLimits ?? {}).length;
    const exhaustedUsers = chatRows.filter((row) => !row.isMaster && row.limit !== null && row.limit > 0 && row.used >= row.limit).length;
    return {
      trackedUsers: chatRows.length,
      whitelistUsers: chatAccess.whitelistUsers.length,
      overrideUsers,
      totalUsed,
      exhaustedUsers,
    };
  }, [chatRows, chatAccess.whitelistUsers.length, chatQuota.userLimits]);

  const chatAccessConflictUsers = useMemo(() => {
    const blacklist = new Set((runtime?.userBlacklist ?? []).map((item) => String(item || '').trim()).filter(Boolean));
    return [...new Set((chatAccess.whitelistUsers ?? []).map((item) => String(item || '').trim()).filter((uid) => blacklist.has(uid)))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [runtime?.userBlacklist, chatAccess.whitelistUsers]);

  const allowedChatUsageEvents = useMemo(
    () => usageEvents.events.filter((event) => event.category === 'chat' && event.allowed),
    [usageEvents.events],
  );

  const allowedImageUsageEvents = useMemo(
    () => usageEvents.events.filter((event) => event.category === 'image' && event.allowed),
    [usageEvents.events],
  );

  const deniedUsageEventCount = useMemo(
    () => usageEvents.events.filter((event) => !event.allowed).length,
    [usageEvents.events],
  );

  const usageEventTimeRange = useMemo(() => {
    let earliestRaw = '';
    let latestRaw = '';
    let earliestTime = Number.POSITIVE_INFINITY;
    let latestTime = Number.NEGATIVE_INFINITY;

    usageEvents.events.forEach((event) => {
      const date = parseHistoryTime(event.timestamp);
      if (!date) return;
      const time = date.getTime();
      if (time < earliestTime) {
        earliestTime = time;
        earliestRaw = event.timestamp;
      }
      if (time > latestTime) {
        latestTime = time;
        latestRaw = event.timestamp;
      }
    });

    return {
      earliestLabel: formatUsageEventTime(earliestRaw),
      latestLabel: formatUsageEventTime(latestRaw),
    };
  }, [usageEvents.events]);

  const usageEventActionOptions = useMemo(
    () => [...new Set(usageEvents.events.map((event) => String(event.action || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [usageEvents.events],
  );

  const usageEventReasonOptions = useMemo(
    () => [...new Set(usageEvents.events.map((event) => String(event.reason || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [usageEvents.events],
  );

  useEffect(() => {
    if (usageEventActionFilter !== 'all' && !usageEventActionOptions.includes(usageEventActionFilter)) {
      setUsageEventActionFilter('all');
    }
  }, [usageEventActionFilter, usageEventActionOptions]);

  useEffect(() => {
    if (usageEventReasonFilter !== 'all' && !usageEventReasonOptions.includes(usageEventReasonFilter)) {
      setUsageEventReasonFilter('all');
    }
  }, [usageEventReasonFilter, usageEventReasonOptions]);

  const sortedUsageEvents = useMemo(
    () => [...usageEvents.events].sort((a, b) => {
      const left = parseHistoryTime(a.timestamp)?.getTime() ?? 0;
      const right = parseHistoryTime(b.timestamp)?.getTime() ?? 0;
      return right - left;
    }),
    [usageEvents.events],
  );

  const filteredUsageEvents = useMemo(() => {
    const q = usageEventSearch.trim().toLowerCase();
    return sortedUsageEvents.filter((event) => {
      if (usageEventCategoryFilter !== 'all' && event.category !== usageEventCategoryFilter) return false;
      if (usageEventAllowedFilter === 'allowed' && !event.allowed) return false;
      if (usageEventAllowedFilter === 'denied' && event.allowed) return false;
      if (usageEventScopeFilter !== 'all' && event.scope !== usageEventScopeFilter) return false;
      if (usageEventActionFilter !== 'all' && event.action !== usageEventActionFilter) return false;
      if (usageEventReasonFilter !== 'all' && event.reason !== usageEventReasonFilter) return false;
      if (usageEventUserFilter && event.userId !== usageEventUserFilter) return false;
      if (!matchesUsageEventBucket(event, usageEventBucketFilter, usageChartGranularity)) return false;
      if (q && !buildUsageEventSearchIndex(event).includes(q)) return false;
      return true;
    });
  }, [
    sortedUsageEvents,
    usageEventSearch,
    usageEventCategoryFilter,
    usageEventAllowedFilter,
    usageEventScopeFilter,
    usageEventActionFilter,
    usageEventReasonFilter,
    usageEventUserFilter,
    usageEventBucketFilter,
    usageChartGranularity,
  ]);

  const filteredUsageEventSummary = useMemo(() => ({
    total: filteredUsageEvents.length,
    allowed: filteredUsageEvents.filter((event) => event.allowed).length,
    denied: filteredUsageEvents.filter((event) => !event.allowed).length,
  }), [filteredUsageEvents]);

  const usageEventTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredUsageEvents.length / usageEventPageSize)),
    [filteredUsageEvents.length, usageEventPageSize],
  );

  const pagedUsageEvents = useMemo(() => {
    const safePage = Math.min(usageEventPage, Math.max(usageEventTotalPages - 1, 0));
    const start = safePage * usageEventPageSize;
    return filteredUsageEvents.slice(start, start + usageEventPageSize);
  }, [filteredUsageEvents, usageEventPage, usageEventPageSize, usageEventTotalPages]);

  useEffect(() => {
    if (usageEventPage >= usageEventTotalPages) {
      setUsageEventPage(Math.max(usageEventTotalPages - 1, 0));
    }
  }, [usageEventPage, usageEventTotalPages]);

  const usageEventActiveFilterSummary = useMemo<UsageEventActiveFilterChip[]>(() => {
    const items: UsageEventActiveFilterChip[] = [];
    if (usageEventCategoryFilter !== 'all') items.push({ key: 'category', label: `分类：${usageEventCategoryFilter === 'chat' ? '聊天' : '图像'}` });
    if (usageEventAllowedFilter !== 'all') items.push({ key: 'allowed', label: `结果：${usageEventAllowedFilter === 'allowed' ? '仅允许' : '仅拒绝'}` });
    if (usageEventScopeFilter !== 'all') items.push({ key: 'scope', label: `场景：${usageEventScopeFilter === 'group' ? '群聊' : '私聊'}` });
    if (usageEventActionFilter !== 'all') items.push({ key: 'action', label: `动作：${getUsageEventActionLabel(usageEventActionFilter, usageEventCategoryFilter === 'all' ? undefined : usageEventCategoryFilter)}` });
    if (usageEventReasonFilter !== 'all') items.push({ key: 'reason', label: `原因：${getUsageEventReasonLabel(usageEventReasonFilter)}` });
    if (usageEventUserFilter) items.push({ key: 'user', label: `QQ：${usageEventUserFilter}` });
    if (usageEventBucketFilter) items.push({ key: 'bucket', label: `时间桶：${formatTimeBucketLabel(usageEventBucketFilter, usageChartGranularity)}` });
    if (usageEventSearch.trim()) items.push({ key: 'search', label: `搜索：${usageEventSearch.trim()}` });
    return items;
  }, [
    usageEventCategoryFilter,
    usageEventAllowedFilter,
    usageEventScopeFilter,
    usageEventActionFilter,
    usageEventReasonFilter,
    usageEventUserFilter,
    usageEventBucketFilter,
    usageChartGranularity,
    usageEventSearch,
  ]);

  const chatTopUsersChartData = useMemo(() => {
    const counter = new Map<string, number>();
    allowedChatUsageEvents.forEach((event) => {
      const key = String(event.userId || '').trim();
      if (!key) return;
      counter.set(key, (counter.get(key) ?? 0) + Math.max(1, event.amount || 1));
    });
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [allowedChatUsageEvents]);

  const chatTimeDistributionData = useMemo(() => {
    const counter = new Map<string, number>();
    allowedChatUsageEvents.forEach((event) => {
      const date = parseHistoryTime(event.timestamp);
      if (!date) return;
      const bucket = bucketHistoryEntry(date, usageChartGranularity);
      counter.set(bucket, (counter.get(bucket) ?? 0) + Math.max(1, event.amount || 1));
    });
    return Array.from(counter.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
      .map(([bucket, count]) => ({
        bucket,
        label: formatTimeBucketLabel(bucket, usageChartGranularity),
        count,
      }));
  }, [allowedChatUsageEvents, usageChartGranularity]);

  const imageTopUsersChartData = useMemo(() => {
    const counter = new Map<string, number>();
    allowedImageUsageEvents.forEach((event) => {
      const key = String(event.userId || '').trim();
      if (!key) return;
      counter.set(key, (counter.get(key) ?? 0) + Math.max(1, event.amount || 1));
    });
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [allowedImageUsageEvents]);

  const imageTimeDistributionData = useMemo(() => {
    const counter = new Map<string, number>();
    allowedImageUsageEvents.forEach((event) => {
      const date = parseHistoryTime(event.timestamp);
      if (!date) return;
      const bucket = bucketHistoryEntry(date, usageChartGranularity);
      counter.set(bucket, (counter.get(bucket) ?? 0) + Math.max(1, event.amount || 1));
    });
    return Array.from(counter.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
      .map(([bucket, count]) => ({
        bucket,
        label: formatTimeBucketLabel(bucket, usageChartGranularity),
        count,
      }));
  }, [allowedImageUsageEvents, usageChartGranularity]);

  const peakUsageBucket = useMemo(() => {
    if (chatTimeDistributionData.length === 0) return null;
    return chatTimeDistributionData.reduce((best, current) => (current.count > best.count ? current : best), chatTimeDistributionData[0]);
  }, [chatTimeDistributionData]);

  const peakImageUsageBucket = useMemo(() => {
    if (imageTimeDistributionData.length === 0) return null;
    return imageTimeDistributionData.reduce((best, current) => (current.count > best.count ? current : best), imageTimeDistributionData[0]);
  }, [imageTimeDistributionData]);

  const imageSummary = useMemo(() => {
    const totalGenerateUsed = imageRows.reduce((sum, row) => sum + row.generateUsed, 0);
    const totalEditUsed = imageRows.reduce((sum, row) => sum + row.editUsed, 0);
    const overrideUsers = Object.keys(imageQuota.userLimits ?? {}).length;
    const exhaustedUsers = imageRows.filter((row) =>
      (!row.isMaster && row.generateLimit !== null && row.generateLimit > 0 && row.generateUsed >= row.generateLimit) ||
      (!row.isMaster && row.editLimit !== null && row.editLimit > 0 && row.editUsed >= row.editLimit)
    ).length;
    return {
      trackedUsers: imageRows.length,
      whitelistUsers: imageAccess.whitelistUsers.length,
      overrideUsers,
      totalGenerateUsed,
      totalEditUsed,
      exhaustedUsers,
    };
  }, [imageRows, imageQuota.userLimits, imageAccess.whitelistUsers.length]);

  const imageAccessConflictUsers = useMemo(() => {
    const blacklist = new Set((runtime?.userBlacklist ?? []).map((item) => String(item || '').trim()).filter(Boolean));
    return [...new Set((imageAccess.whitelistUsers ?? []).map((item) => String(item || '').trim()).filter((uid) => blacklist.has(uid)))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [runtime?.userBlacklist, imageAccess.whitelistUsers]);

  function updateGroupCount(gid: string, raw: number) {
    const next = { ...groupUsage.counts };
    const value = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(value)) return;
    next[gid] = value;
    setGroupUsage({ ...groupUsage, counts: next });
  }

  function removeGroupCount(gid: string) {
    const next = { ...groupUsage.counts };
    delete next[gid];
    setGroupUsage({ ...groupUsage, counts: next });
  }

  function addCustomGroup() {
    const gid = newGroupId.trim();
    if (!gid) return;
    if (groupRows.some((row) => row.gid === gid)) {
      addToast('warning', `群 ${gid} 已存在`);
      return;
    }
    setGroupUsage({ ...groupUsage, counts: { ...groupUsage.counts, [gid]: 0 } });
    if (runtime) {
      setRuntime({
        ...runtime,
        groupLimits: {
          ...runtime.groupLimits,
          [gid]: runtime.groupLimits?.[gid] ?? 0,
        },
      });
    }
    setNewGroupId('');
  }

  function updateGroupLimit(gid: string, raw: number) {
    if (!runtime) return;
    const value = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(value)) return;
    const nextLimits = { ...(runtime.groupLimits ?? {}) };
    if (value <= 0) delete nextLimits[gid];
    else nextLimits[gid] = value;
    setRuntime({ ...runtime, groupLimits: nextLimits });
  }

  function updateChatUsageCount(uid: string, raw: number) {
    const value = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(value)) return;
    const nextUsers = { ...(groupUsage.users ?? {}) };
    nextUsers[uid] = value;
    setGroupUsage({ ...groupUsage, users: nextUsers });
  }

  function removeChatUsageCount(uid: string) {
    const nextUsers = { ...(groupUsage.users ?? {}) };
    delete nextUsers[uid];
    setGroupUsage({ ...groupUsage, users: nextUsers });
  }

  function addCustomChatUser() {
    const uid = newChatUserId.trim();
    if (!uid) return;
    if (chatRows.some((row) => row.uid === uid)) {
      addToast('warning', `QQ ${uid} 已存在`);
      return;
    }
    setChatQuota({
      ...chatQuota,
      userLimits: {
        ...chatQuota.userLimits,
        [uid]: chatQuota.defaultLimit ?? 0,
      },
    });
    setNewChatUserId('');
  }

  function addChatWhitelistUser() {
    const uid = newChatWhitelistUserId.trim();
    if (!uid) return;
    if ((chatAccess.whitelistUsers ?? []).includes(uid)) {
      addToast('warning', `QQ ${uid} 已在聊天白名单中`);
      return;
    }
    setChatAccess({
      ...chatAccess,
      whitelistUsers: [...chatAccess.whitelistUsers, uid],
    });
    setNewChatWhitelistUserId('');
  }

  function addChatUserOverride(uid: string) {
    if (!uid.trim()) return;
    setChatQuota({
      ...chatQuota,
      userLimits: {
        ...chatQuota.userLimits,
        [uid]: chatQuota.defaultLimit ?? 0,
      },
    });
  }

  function updateChatUserOverride(uid: string, raw: number) {
    const value = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(value)) return;
    setChatQuota({
      ...chatQuota,
      userLimits: {
        ...chatQuota.userLimits,
        [uid]: value,
      },
    });
  }

  function removeChatUserOverride(uid: string) {
    const next = { ...(chatQuota.userLimits ?? {}) };
    delete next[uid];
    setChatQuota({ ...chatQuota, userLimits: next });
  }

  function updateImageUsageCount(uid: string, field: 'generate' | 'edit', raw: number) {
    const value = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(value)) return;
    const nextUsers = { ...imageUsage.users };
    const nextRow = {
      generate: Math.max(0, Math.floor(Number(nextUsers[uid]?.generate ?? 0))),
      edit: Math.max(0, Math.floor(Number(nextUsers[uid]?.edit ?? 0))),
    };
    nextRow[field] = value;
    nextUsers[uid] = nextRow;
    setImageUsage({ ...imageUsage, users: nextUsers });
  }

  function removeImageUsageCount(uid: string) {
    const nextUsers = { ...imageUsage.users };
    delete nextUsers[uid];
    setImageUsage({ ...imageUsage, users: nextUsers });
  }

  function addCustomUser() {
    const uid = newUserId.trim();
    if (!uid) return;
    if (imageRows.some((row) => row.uid === uid)) {
      addToast('warning', `QQ ${uid} 已存在`);
      return;
    }
    setImageQuota({
      ...imageQuota,
      userLimits: {
        ...imageQuota.userLimits,
        [uid]: {
          generateLimit: imageQuota.defaultGenerateLimit ?? 0,
          editLimit: imageQuota.defaultEditLimit ?? 0,
        },
      },
    });
    setNewUserId('');
  }

  function addWhitelistUser() {
    const uid = newWhitelistUserId.trim();
    if (!uid) return;
    if ((imageAccess.whitelistUsers ?? []).includes(uid)) {
      addToast('warning', `QQ ${uid} 已在图像白名单中`);
      return;
    }
    setImageAccess({
      ...imageAccess,
      whitelistUsers: [...imageAccess.whitelistUsers, uid],
    });
    setNewWhitelistUserId('');
  }

  function addUserOverride(uid: string) {
    if (!uid.trim()) return;
    setImageQuota({
      ...imageQuota,
      userLimits: {
        ...imageQuota.userLimits,
        [uid]: {
          generateLimit: imageQuota.defaultGenerateLimit ?? 0,
          editLimit: imageQuota.defaultEditLimit ?? 0,
        },
      },
    });
  }

  function updateUserOverride(uid: string, field: 'generateLimit' | 'editLimit', raw: number) {
    const value = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(value)) return;
    const current = imageQuota.userLimits?.[uid] ?? { generateLimit: imageQuota.defaultGenerateLimit, editLimit: imageQuota.defaultEditLimit };
    setImageQuota({
      ...imageQuota,
      userLimits: {
        ...imageQuota.userLimits,
        [uid]: {
          ...current,
          [field]: value,
        },
      },
    });
  }

  function removeUserOverride(uid: string) {
    const next = { ...(imageQuota.userLimits ?? {}) };
    delete next[uid];
    setImageQuota({ ...imageQuota, userLimits: next });
  }

  async function saveGroupUsage() {
    try {
      const next = sanitizeUsage(groupUsage);
      await saveConfig('usage', next);
      setGroupUsage(next);
      setGroupOriginal(JSON.stringify(next));
      addToast('success', '聊天/群用量计数已保存');
    } catch (e: any) {
      addToast('error', `保存群用量失败: ${e?.message ?? e}`);
    }
  }

  async function saveChatRules() {
    if (!runtime) {
      addToast('error', '当前运行配置尚未加载完成，无法保存聊天权限与限额规则');
      return;
    }
    try {
      const normalizedAccess = normalizeChatAccess(chatAccess);
      const normalizedQuota = normalizeChatQuota(chatQuota);
      const normalizedGroupLimits = Object.fromEntries(
        Object.entries(runtime.groupLimits ?? {})
          .map(([gid, raw]) => [String(gid).trim(), Math.max(0, Math.floor(Number(raw) || 0))] as const)
          .filter(([gid, value]) => gid && value > 0),
      );
      const nextRuntime = {
        ...runtime,
        chatAccess: normalizedAccess,
        chatQuota: normalizedQuota,
        groupLimits: normalizedGroupLimits,
      };
      await saveConfig('runtime', nextRuntime);
      setRuntime(nextRuntime);
      setChatAccess(normalizedAccess);
      setChatQuota(normalizedQuota);
      setChatAccessOriginal(JSON.stringify(normalizedAccess));
      setChatQuotaOriginal(JSON.stringify(normalizedQuota));
      setGroupLimitsOriginal(JSON.stringify(normalizedGroupLimits));
      if (chatAccessConflictUsers.length > 0) {
        addToast('warning', `聊天权限与限额规则已保存，但仍有 ${chatAccessConflictUsers.length} 个 QQ 同时出现在黑名单和聊天白名单中。实际运行时黑名单优先。`);
      } else {
        addToast('success', '聊天权限与限额规则已保存');
      }
    } catch (e: any) {
      addToast('error', `保存聊天权限与限额规则失败: ${e?.message ?? e}`);
    }
  }

  async function saveImageUsage() {
    try {
      const next = sanitizeImageUsage(imageUsage);
      await saveConfig('imageUsage', next);
      setImageUsage(next);
      setImageOriginal(JSON.stringify(next));
      addToast('success', '图像用量计数已保存');
    } catch (e: any) {
      addToast('error', `保存图像用量失败: ${e?.message ?? e}`);
    }
  }

  async function saveImageQuotaRules() {
    if (!runtime) {
      addToast('error', '当前运行配置尚未加载完成，无法保存图像权限与限额规则');
      return;
    }
    try {
      const normalizedAccess = normalizeImageAccess(imageAccess);
      const normalized = normalizeImageQuota(imageQuota);
      const nextRuntime = { ...runtime, imageAccess: normalizedAccess, imageQuota: normalized };
      await saveConfig('runtime', nextRuntime);
      setRuntime(nextRuntime);
      setImageAccess(normalizedAccess);
      setImageQuota(normalized);
      setAccessOriginal(JSON.stringify(normalizedAccess));
      setQuotaOriginal(JSON.stringify(normalized));
      if (imageAccessConflictUsers.length > 0) {
        addToast('warning', `图像权限与限额规则已保存，但仍有 ${imageAccessConflictUsers.length} 个 QQ 同时出现在黑名单和图像白名单里。实际运行时黑名单优先。`);
      } else {
        addToast('success', '图像权限与限额规则已保存');
      }
    } catch (e: any) {
      addToast('error', `保存图像权限与限额规则失败: ${e?.message ?? e}`);
    }
  }

  function exportGroupUsage() {
    downloadJsonWithTimestamp(sanitizeUsage(groupUsage), 'group_usage_counts.json');
    addToast('success', '已导出聊天/群用量计数');
  }

  function exportImageUsage() {
    downloadJsonWithTimestamp(sanitizeImageUsage(imageUsage), 'image_usage_counts.json');
    addToast('success', '已导出图像用量计数');
  }

  async function importGroupUsage() {
    try {
      const picked = await pickJsonAndParse();
      if (!picked) return;
      if (!picked.data || Array.isArray(picked.data) || typeof picked.data !== 'object') {
        addToast('error', '导入失败：JSON 必须是对象');
        return;
      }
      const imported = normalizeUsage(picked.data as UsageData);
      setGroupUsage(imported);
      addToast('success', '已导入聊天/群用量计数（请点击保存生效）');
    } catch (e: any) {
      addToast('error', `导入失败: ${e?.message ?? e}`);
    }
  }

  async function importImageUsage() {
    try {
      const picked = await pickJsonAndParse();
      if (!picked) return;
      if (!picked.data || Array.isArray(picked.data) || typeof picked.data !== 'object') {
        addToast('error', '导入失败：JSON 必须是对象');
        return;
      }
      const imported = normalizeImageUsage(picked.data as ImageUsageData);
      setImageUsage(imported);
      addToast('success', '已导入图像用量计数（请点击保存生效）');
    } catch (e: any) {
      addToast('error', `导入失败: ${e?.message ?? e}`);
    }
  }

  function resetUsageEventFilters() {
    setUsageEventSearch('');
    setUsageEventCategoryFilter('all');
    setUsageEventAllowedFilter('all');
    setUsageEventScopeFilter('all');
    setUsageEventActionFilter('all');
    setUsageEventReasonFilter('all');
    setUsageEventUserFilter('');
    setUsageEventBucketFilter('');
    setUsageEventPage(0);
  }

  function clearUsageEventFilter(key: UsageEventActiveFilterChip['key']) {
    if (key === 'category') setUsageEventCategoryFilter('all');
    if (key === 'allowed') setUsageEventAllowedFilter('all');
    if (key === 'scope') setUsageEventScopeFilter('all');
    if (key === 'action') setUsageEventActionFilter('all');
    if (key === 'reason') setUsageEventReasonFilter('all');
    if (key === 'user') setUsageEventUserFilter('');
    if (key === 'bucket') setUsageEventBucketFilter('');
    if (key === 'search') setUsageEventSearch('');
    setUsageEventPage(0);
  }

  function drillDownUsageEventsByUser(category: 'chat' | 'image', userId: string) {
    if (!userId) return;
    setUsageEventCategoryFilter(category);
    setUsageEventUserFilter(userId);
    setUsageEventBucketFilter('');
    setUsageEventPage(0);
  }

  function drillDownUsageEventsByBucket(category: 'chat' | 'image', bucket: string) {
    if (!bucket) return;
    setUsageEventCategoryFilter(category);
    setUsageEventUserFilter('');
    setUsageEventBucketFilter(bucket);
    setUsageEventPage(0);
  }

  function jumpToApiNode(event: UsageEvent) {
    if (!event.nodeRemark && !event.modelName) {
      addToast('warning', '这条事件没有记录节点信息，暂时无法跳转到 API 节点');
      return;
    }
    requestPageJump({
      page: 'api',
      kind: 'api-node',
      category: event.category,
      nodeRemark: event.nodeRemark,
      modelName: event.modelName,
    });
  }

  function jumpToQuotaUser(category: 'chat' | 'image', userId: string) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) return;
    const exists = category === 'chat'
      ? chatRows.some((row) => row.uid === normalizedUserId)
      : imageRows.some((row) => row.uid === normalizedUserId);
    if (!exists) {
      addToast('warning', `${normalizedUserId} 当前没有可定位的${category === 'chat' ? '聊天' : '图像'}额度行，可能这条事件只存在于日志里，还没进入当前周期统计`);
      return;
    }
    if (category === 'chat') {
      setChatUserSearch(normalizedUserId);
    } else {
      setUserSearch(normalizedUserId);
    }
    setPendingQuotaFocus({ category, userId: normalizedUserId });
  }

  useEffect(() => {
    if (!pendingQuotaFocus) return;
    const refMap = pendingQuotaFocus.category === 'chat' ? chatQuotaRowRefs.current : imageQuotaRowRefs.current;
    const row = refMap.get(pendingQuotaFocus.userId);
    if (!row) return;
    row.scrollIntoView({ behavior: 'auto', block: 'center' });
    const nextKey = `${pendingQuotaFocus.category}:${pendingQuotaFocus.userId}`;
    setHighlightedQuotaKey(nextKey);
    setPendingQuotaFocus(null);
    const timer = setTimeout(() => {
      setHighlightedQuotaKey((current) => (current === nextKey ? '' : current));
    }, 2600);
    return () => clearTimeout(timer);
  }, [pendingQuotaFocus, filteredChatRows, filteredImageRows]);

  function exportUsageEvents(filteredOnly = false) {
    const payload = {
      schemaVersion: usageEvents.schemaVersion,
      events: filteredOnly ? filteredUsageEvents : usageEvents.events,
    };
    downloadJsonWithTimestamp(payload, filteredOnly ? 'usage_events.filtered.json' : 'usage_events.json');
    addToast('success', filteredOnly ? '已导出当前筛选结果' : '已导出全部统一用量事件');
  }

  function resetGroupPeriod() {
    setGroupUsage({
      periodId: getCurrentPeriodId(),
      counts: {},
    });
    setConfirmResetGroup(false);
  }

  function resetImagePeriod() {
    setImageUsage({
      periodId: getCurrentPeriodId(),
      users: {},
    });
    setConfirmResetImage(false);
  }

  function dropUnknownGroups() {
    const allowed = new Set(runtime?.groups ?? []);
    const next: Record<string, number> = {};
    for (const [gid, value] of Object.entries(groupUsage.counts ?? {})) {
      if (allowed.has(gid)) next[gid] = value;
    }
    setGroupUsage({ ...groupUsage, counts: next });
    setConfirmDropUnknown(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="text-4xl block mb-3 animate-bounce">🐱</span>
          <p className="text-[var(--text-secondary)]">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">
        <StatCard label="群条目数" value={groupSummary.totalGroups} icon="👥" color="var(--accent-purple)" />
        <StatCard label="群总已用" value={groupSummary.totalUsed} icon="⏱️" color="var(--accent-pink)" />
        <StatCard label="聊天统计用户" value={chatSummary.trackedUsers} icon="💬" color="var(--info)" />
        <StatCard label="图像统计用户" value={imageSummary.trackedUsers} icon="🖼️" color="var(--chart-4)" />
        <StatCard label="聊天单独限额" value={chatSummary.overrideUsers} icon="🎯" color="var(--warning)" />
        <StatCard label="图像单独限额" value={imageSummary.overrideUsers} icon="🖼" color="var(--chart-5)" />
        <SummaryCard label="群周期" value={groupUsage.periodId || '-'} hint="群聊 12 小时周期计数。" />
        <SummaryCard label="图像周期" value={imageUsage.periodId || '-'} hint="生图 / 修图 12 小时周期计数。" />
      </div>

      <Panel
        title="统一用量事件图表"
        subtitle="图表统一基于 usage_events.json 统计。聊天和图像都只使用真正记录下来的用量事件，不再从聊天历史反推；插件最多保留最近 10000 条事件。"
        icon="📈"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <SummaryCard label="事件总数" value={String(usageEvents.events.length)} hint="统一用量事件日志中的总事件数，包含聊天和图像。" />
            <SummaryCard label="聊天用量事件" value={String(allowedChatUsageEvents.length)} hint="已允许并记入用量的聊天事件数量。" />
            <SummaryCard label="图像用量事件" value={String(allowedImageUsageEvents.length)} hint="已允许并记入用量的图像事件数量。" />
            <SummaryCard label="拒绝事件数" value={String(deniedUsageEventCount)} hint="被黑白名单、额度或其他规则拒绝的事件条数。" />
            <SummaryCard label="保留上限" value={String(USAGE_EVENT_RETENTION_LIMIT)} hint="插件最多保留最近这么多条 usage event，超出后会自动裁剪更早记录。" />
            <SummaryCard label="最早事件" value={usageEventTimeRange.earliestLabel} hint="当前保留区间内最早的一条 usage event 时间。" />
            <SummaryCard label="最新事件" value={usageEventTimeRange.latestLabel} hint="当前保留区间内最新的一条 usage event 时间。" />
            <SummaryCard label="聊天高峰时段" value={peakUsageBucket ? peakUsageBucket.label : '-'} hint={peakUsageBucket ? `该时间桶累计 ${peakUsageBucket.count} 次聊天用量。` : '当前还没有可用于统计的聊天用量事件。'} />
            <SummaryCard label="图像高峰时段" value={peakImageUsageBucket ? peakImageUsageBucket.label : '-'} hint={peakImageUsageBucket ? `该时间桶累计 ${peakImageUsageBucket.count} 次图像用量。` : '当前还没有可用于统计的图像用量事件。'} />
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              {(['hour', 'day', 'week', 'month'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setUsageChartGranularity(item)}
                  className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border cursor-pointer transition-colors ${usageChartGranularity === item ? 'bg-[var(--accent-purple)] text-white border-transparent' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  {{ hour: '时', day: '天', week: '周', month: '月' }[item]}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 text-xs text-[var(--text-secondary)]">
            <p>usage_events.json 是聊天和图像共用的长期事件日志。超过 {USAGE_EVENT_RETENTION_LIMIT} 条后，插件会自动删除更早的旧记录，只保留最近的一段。</p>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">当前保留范围：{usageEventTimeRange.earliestLabel} 至 {usageEventTimeRange.latestLabel}。如果你要做更长期的统计，建议定期备份这个文件。</p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <p className="text-sm font-medium text-[var(--text-primary)] mb-1">聊天用量 Top 10 用户</p>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">基于 usage event 的允许事件聚合，按实际聊天用量统计。点击柱子可联动下方事件明细。</p>
              <div className="h-[260px]">
                {usageEventsLoading ? (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">正在读取统一用量事件日志...</div>
                ) : chatTopUsersChartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">当前没有可用的聊天用量事件。</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chatTopUsersChartData} margin={{ top: 12, right: 12, left: 0, bottom: 18 }}>
                      <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={56} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, color: 'var(--text-primary)' }} />
                      <Bar dataKey="count" radius={[8, 8, 0, 0]} cursor="pointer" onClick={(data) => drillDownUsageEventsByUser('chat', String(data?.name || ''))}>
                        {chatTopUsersChartData.map((entry, index) => (
                          <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <p className="text-sm font-medium text-[var(--text-primary)] mb-1">聊天时间分布</p>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">{usageChartGranularity === 'hour' ? '按小时看全天哪个时段最忙' : usageChartGranularity === 'day' ? '按天看哪天请求最多' : usageChartGranularity === 'week' ? '按周看哪个自然周最忙' : '按月看哪个月份最忙'}。点击柱子可联动下方事件明细。</p>
              <div className="h-[260px]">
                {usageEventsLoading ? (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">正在读取统一用量事件日志...</div>
                ) : chatTimeDistributionData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">当前没有可用的聊天用量事件。</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chatTimeDistributionData} margin={{ top: 12, right: 12, left: 0, bottom: 18 }}>
                      <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval="preserveStartEnd" minTickGap={18} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, color: 'var(--text-primary)' }} />
                      <Bar dataKey="count" fill="var(--chart-3)" radius={[8, 8, 0, 0]} cursor="pointer" onClick={(data) => drillDownUsageEventsByBucket('chat', String(data?.bucket || ''))} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <p className="text-sm font-medium text-[var(--text-primary)] mb-1">图像用量 Top 10 用户</p>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">按生图和修图实际扣减的额度数量统计，同样来自 usage event。点击柱子可联动下方事件明细。</p>
              <div className="h-[260px]">
                {usageEventsLoading ? (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">正在读取统一用量事件日志...</div>
                ) : imageTopUsersChartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">当前没有可用的图像用量事件。</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={imageTopUsersChartData} margin={{ top: 12, right: 12, left: 0, bottom: 18 }}>
                      <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={56} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, color: 'var(--text-primary)' }} />
                      <Bar dataKey="count" radius={[8, 8, 0, 0]} cursor="pointer" onClick={(data) => drillDownUsageEventsByUser('image', String(data?.name || ''))}>
                        {imageTopUsersChartData.map((entry, index) => (
                          <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <p className="text-sm font-medium text-[var(--text-primary)] mb-1">图像时间分布</p>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">{usageChartGranularity === 'hour' ? '按小时看哪个时段图像调用最密集' : usageChartGranularity === 'day' ? '按天看哪天图像调用最多' : usageChartGranularity === 'week' ? '按周看哪个自然周图像调用最多' : '按月看哪个月份图像调用最多'}。点击柱子可联动下方事件明细。</p>
              <div className="h-[260px]">
                {usageEventsLoading ? (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">正在读取统一用量事件日志...</div>
                ) : imageTimeDistributionData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">当前没有可用的图像用量事件。</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={imageTimeDistributionData} margin={{ top: 12, right: 12, left: 0, bottom: 18 }}>
                      <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval="preserveStartEnd" minTickGap={18} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, color: 'var(--text-primary)' }} />
                      <Bar dataKey="count" fill="var(--chart-5)" radius={[8, 8, 0, 0]} cursor="pointer" onClick={(data) => drillDownUsageEventsByBucket('image', String(data?.bucket || ''))} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[280px] flex-1">
                <SearchBar
                  value={usageEventSearch}
                  onChange={setUsageEventSearch}
                  placeholder="搜索 QQ / 群号 / 模型 / 节点 / 原因 / detail..."
                />
              </div>
              <button
                onClick={() => exportUsageEvents(true)}
                disabled={filteredUsageEvents.length === 0}
                className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 cursor-pointer"
              >
                导出筛选结果
              </button>
              <button
                onClick={() => exportUsageEvents(false)}
                disabled={usageEvents.events.length === 0}
                className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 cursor-pointer"
              >
                导出全部事件
              </button>
              <button
                onClick={resetUsageEventFilters}
                disabled={usageEventActiveFilterSummary.length === 0}
                className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${usageEventActiveFilterSummary.length > 0 ? 'bg-[var(--surface-card)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-muted)] cursor-not-allowed'}`}
              >
                清空筛选
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              <label className="text-xs text-[var(--text-muted)]">
                分类
                <select
                  value={usageEventCategoryFilter}
                  onChange={(e) => setUsageEventCategoryFilter(e.target.value as 'all' | 'chat' | 'image')}
                  className="mt-1 w-full px-2 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none cursor-pointer"
                >
                  <option value="all">全部分类</option>
                  <option value="chat">聊天</option>
                  <option value="image">图像</option>
                </select>
              </label>
              <label className="text-xs text-[var(--text-muted)]">
                结果
                <select
                  value={usageEventAllowedFilter}
                  onChange={(e) => setUsageEventAllowedFilter(e.target.value as 'all' | 'allowed' | 'denied')}
                  className="mt-1 w-full px-2 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none cursor-pointer"
                >
                  <option value="all">全部结果</option>
                  <option value="allowed">仅允许</option>
                  <option value="denied">仅拒绝</option>
                </select>
              </label>
              <label className="text-xs text-[var(--text-muted)]">
                场景
                <select
                  value={usageEventScopeFilter}
                  onChange={(e) => setUsageEventScopeFilter(e.target.value as 'all' | 'group' | 'private')}
                  className="mt-1 w-full px-2 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none cursor-pointer"
                >
                  <option value="all">全部场景</option>
                  <option value="group">群聊</option>
                  <option value="private">私聊</option>
                </select>
              </label>
              <label className="text-xs text-[var(--text-muted)]">
                动作
                <select
                  value={usageEventActionFilter}
                  onChange={(e) => setUsageEventActionFilter(e.target.value)}
                  className="mt-1 w-full px-2 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none cursor-pointer"
                >
                  <option value="all">全部动作</option>
                  {usageEventActionOptions.map((action) => (
                    <option key={action} value={action}>{getUsageEventActionLabel(action, usageEventCategoryFilter === 'all' ? undefined : usageEventCategoryFilter)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[var(--text-muted)]">
                原因
                <select
                  value={usageEventReasonFilter}
                  onChange={(e) => setUsageEventReasonFilter(e.target.value)}
                  className="mt-1 w-full px-2 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none cursor-pointer"
                >
                  <option value="all">全部原因</option>
                  {usageEventReasonOptions.map((reason) => (
                    <option key={reason} value={reason}>{getUsageEventReasonLabel(reason)}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <SummaryCard label="筛选命中" value={String(filteredUsageEventSummary.total)} hint="当前筛选条件下命中的 usage event 总数。" />
              <SummaryCard label="允许事件" value={String(filteredUsageEventSummary.allowed)} hint="筛选结果中 allowed=true 的事件数量。" />
              <SummaryCard label="拒绝事件" value={String(filteredUsageEventSummary.denied)} hint="筛选结果中 allowed=false 的事件数量。" />
              <SummaryCard label="锁定 QQ" value={usageEventUserFilter || '-'} hint="点击图表柱子或明细表里的 QQ，可快速锁定单个用户。" />
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {usageEventActiveFilterSummary.length > 0 ? usageEventActiveFilterSummary.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => clearUsageEventFilter(item.key)}
                    className="px-2 py-1 text-[10px] rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                    title="点击移除这个筛选条件"
                  >
                    {item.label} ×
                  </button>
                )) : (
                  <span className="text-xs text-[var(--text-muted)]">当前没有额外筛选。你可以点上面的图表柱子、输入关键词，或按分类/原因缩小范围。</span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">明细按时间倒序显示。点击表格里的 QQ 会锁定该用户，点击上面的筛选标签可单独移除对应条件；这些筛选和粒度会自动记住，刷新后仍保留。</p>
            </div>

            <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
              <div className="overflow-x-auto">
                <div className="min-w-[1320px]">
                  <div className="grid grid-cols-[160px_72px_88px_88px_130px_130px_160px_240px_minmax(280px,1fr)] gap-3 px-4 py-3 text-[11px] text-[var(--text-muted)] bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
                    <span>时间</span>
                    <span>分类</span>
                    <span>结果</span>
                    <span>动作</span>
                    <span>QQ</span>
                    <span>场景</span>
                    <span>原因</span>
                    <span>节点 / 模型</span>
                    <span>明细</span>
                  </div>

                  <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--border-subtle)]">
                    {pagedUsageEvents.length === 0 ? (
                      <div className="px-6 py-10 text-sm text-[var(--text-muted)] text-center">
                        {usageEvents.events.length === 0
                          ? '当前日志里还没有任何 usage event。先让插件真实运行一段时间，这里才会出现聊天 / 图像的统一事件。'
                          : usageEventActiveFilterSummary.length > 0
                            ? '当前筛选条件下没有命中任何 usage event。可以点上面的筛选标签逐个移除，或直接清空筛选。'
                            : '当前还没有可显示的 usage event。'}
                      </div>
                    ) : (
                      pagedUsageEvents.map((event) => (
                        <div key={event.id} className="grid grid-cols-[160px_72px_88px_88px_130px_130px_160px_240px_minmax(280px,1fr)] gap-3 px-4 py-3 text-xs items-start">
                          <span className="mono text-[var(--text-secondary)]">{formatUsageEventTime(event.timestamp)}</span>
                          <span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full ${event.category === 'image' ? 'bg-[rgba(251,191,36,0.15)] text-[var(--warning)]' : 'bg-[rgba(14,165,233,0.15)] text-[var(--info)]'}`}>
                              {getUsageEventCategoryLabel(event.category)}
                            </span>
                          </span>
                          <span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full ${event.allowed ? 'bg-[rgba(0,230,118,0.15)] text-[var(--success)]' : 'bg-[rgba(255,82,82,0.15)] text-[var(--error)]'}`}>
                              {event.allowed ? '允许' : '拒绝'}
                            </span>
                          </span>
                          <span className="text-[var(--text-primary)]">{getUsageEventActionLabel(event.action, event.category)}</span>
                          <div className="space-y-1">
                            <button
                              onClick={() => drillDownUsageEventsByUser(event.category, event.userId)}
                              className="mono text-left text-[var(--accent-purple)] hover:underline cursor-pointer"
                            >
                              {event.userId}
                            </button>
                            <button
                              onClick={() => jumpToQuotaUser(event.category, event.userId)}
                              className="text-[10px] text-left text-[var(--info)] hover:underline cursor-pointer"
                            >
                              查看限额位置
                            </button>
                            {event.isMasterUser && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(168,85,247,0.15)] text-[var(--accent-purple)]">主人</span>
                            )}
                          </div>
                          <span className="mono text-[var(--text-secondary)]">{buildUsageEventSceneLabel(event)}</span>
                          <span className="text-[var(--text-secondary)] break-all">{getUsageEventReasonLabel(event.reason)}</span>
                          <div className="space-y-1">
                            {event.nodeRemark || event.modelName ? (
                              <button
                                onClick={() => jumpToApiNode(event)}
                                className="text-left hover:underline cursor-pointer"
                              >
                                <div className="text-[var(--text-primary)] break-all">{event.nodeRemark || '-'}</div>
                                <div className="mono text-[10px] text-[var(--text-muted)] break-all">{event.modelName || '-'}</div>
                              </button>
                            ) : (
                              <>
                                <div className="text-[var(--text-primary)] break-all">-</div>
                                <div className="mono text-[10px] text-[var(--text-muted)] break-all">-</div>
                              </>
                            )}
                          </div>
                          <span className="text-[var(--text-secondary)] break-all">{buildUsageEventDetailSummary(event.detail)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span>每页</span>
                  <select
                    value={usageEventPageSize}
                    onChange={(e) => setUsageEventPageSize(Number(e.target.value) as (typeof USAGE_EVENT_PAGE_SIZES)[number])}
                    className="px-1.5 py-0.5 bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded text-[var(--text-secondary)] outline-none cursor-pointer"
                  >
                    {USAGE_EVENT_PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                  <span>共 {filteredUsageEventSummary.total} 条</span>
                  <span>当前页 {pagedUsageEvents.length} 条</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setUsageEventPage(0)}
                    disabled={usageEventPage === 0}
                    className="px-2 py-1 text-xs rounded bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer"
                  >
                    ◀◀
                  </button>
                  <button
                    onClick={() => setUsageEventPage(Math.max(0, usageEventPage - 1))}
                    disabled={usageEventPage === 0}
                    className="px-2 py-1 text-xs rounded bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer"
                  >
                    ◀
                  </button>
                  <span className="text-xs text-[var(--text-muted)] mono">{Math.min(usageEventPage + 1, usageEventTotalPages)}/{usageEventTotalPages}</span>
                  <button
                    onClick={() => setUsageEventPage(Math.min(usageEventTotalPages - 1, usageEventPage + 1))}
                    disabled={usageEventPage >= usageEventTotalPages - 1}
                    className="px-2 py-1 text-xs rounded bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer"
                  >
                    ▶
                  </button>
                  <button
                    onClick={() => setUsageEventPage(Math.max(usageEventTotalPages - 1, 0))}
                    disabled={usageEventPage >= usageEventTotalPages - 1}
                    className="px-2 py-1 text-xs rounded bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer"
                  >
                    ▶▶
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="群用量管理" subtitle="这里管理群聊 12 小时周期计数，同时支持直接编辑群总额度。群总额度属于聊天规则，修改后需要点击“保存聊天权限与限额规则”才会写回 runtime_config.json。" icon="⏱️">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[260px] flex-1">
              <SearchBar value={groupSearch} onChange={setGroupSearch} placeholder="搜索群号..." />
            </div>
            <ImportExportActions
              onExport={exportGroupUsage}
              onImport={importGroupUsage}
              confirmTitle="导入群用量计数"
            />
            <button
              onClick={() => setConfirmDropUnknown(true)}
              className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              清理非监听群
            </button>
            <button
              onClick={() => setConfirmResetGroup(true)}
              className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,82,82,0.15)] text-[var(--error)] hover:bg-[rgba(255,82,82,0.25)] cursor-pointer"
            >
              重置当前周期
            </button>
            <button
              onClick={() => void saveGroupUsage()}
              disabled={!groupDirty}
              className={`px-4 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${groupDirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
            >
              💾 保存群用量
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">周期标识</p>
              <input
                type="text"
                value={groupUsage.periodId}
                onChange={(e) => setGroupUsage({ ...groupUsage, periodId: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
              />
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  onClick={() => setGroupUsage({ ...groupUsage, periodId: getCurrentPeriodId() })}
                  className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  切到当前周期
                </button>
                <span className="text-[var(--text-muted)] self-center">按东八区时间看，现在应该是：{getCurrentPeriodId()}</span>
              </div>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">手动补一个群条目</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGroupId}
                  onChange={(e) => setNewGroupId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addCustomGroup(); }}
                  placeholder="输入群号"
                  className="flex-1 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                />
                <button
                  onClick={addCustomGroup}
                  className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 cursor-pointer"
                >
                  加进去
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">适合修历史遗留计数，或者先把一个还没进监听列表的群加进来，方便你手工整理数据。</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
            <div className="grid grid-cols-[180px_120px_120px_140px_1fr_96px] gap-3 px-4 py-3 text-[11px] text-[var(--text-muted)] bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
              <span>群号</span>
              <span>监听状态</span>
              <span>限额</span>
              <span>已用次数</span>
              <span>剩余 / 状态</span>
              <span className="text-right">操作</span>
            </div>

            <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--border-subtle)]">
              {filteredGroupRows.length === 0 ? (
                <div className="px-6 py-10 text-sm text-[var(--text-muted)] text-center">没有找到符合条件的群条目。可以换个群号搜，或者先手动补一个群条目。</div>
              ) : (
                filteredGroupRows.map((row) => {
                  const statusText = row.limit === undefined
                    ? '未设限额'
                    : row.used >= row.limit
                      ? '已耗尽'
                      : `剩余 ${row.remaining}`;

                  const statusColor = row.limit === undefined
                    ? 'var(--text-muted)'
                    : row.used >= row.limit
                      ? 'var(--error)'
                      : 'var(--success)';

                  return (
                    <div key={row.gid} className="grid grid-cols-[180px_120px_120px_140px_1fr_96px] gap-3 px-4 py-3 text-sm items-center">
                      <span className="mono text-[var(--text-primary)]">{row.gid}</span>
                      <span className="text-xs">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full ${row.listened ? 'bg-[rgba(0,230,118,0.15)] text-[var(--success)]' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'}`}>
                          {row.listened ? '监听中' : '未监听'}
                        </span>
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={row.limit ?? 0}
                        onChange={(e) => updateGroupLimit(row.gid, Number(e.target.value))}
                        className="w-24 px-2 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
                      />
                      <input
                        type="number"
                        min={0}
                        value={row.used}
                        onChange={(e) => updateGroupCount(row.gid, Number(e.target.value))}
                        className="w-28 px-2 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
                      />
                      <span style={{ color: statusColor }}>{statusText}</span>
                      <div className="flex justify-end gap-2">
                        {row.hasStoredCount && (
                          <button
                            onClick={() => removeGroupCount(row.gid)}
                            className="text-xs text-[var(--text-muted)] hover:text-[var(--warning)] cursor-pointer"
                          >
                            移除计数
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="聊天权限与限额规则" subtitle="这里管理普通聊天回复谁能用、每个 QQ 在 12 小时周期里还能聊多少次，以及群总额度。用户黑名单始终优先，主人始终不限额。" icon="💬">
        <div className="space-y-4">
          <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">
            <SummaryCard label="聊天权限模式" value={getChatAccessModeLabel(chatAccess.mode)} hint={chatAccess.mode === 'whitelist' ? '只有聊天白名单内的 QQ 能获得普通聊天回复。' : '沿用现有群聊/私聊规则，并额外允许做聊天个人限额。'} tone={chatAccess.mode === 'whitelist' ? 'warning' : 'neutral'} />
            <SummaryCard label="聊天白名单" value={String(chatSummary.whitelistUsers)} hint="仅 whitelist 模式生效。黑名单与主人依然优先。" />
            <SummaryCard label="聊天个人限额" value={chatQuota.enabled ? '已启用' : '未启用'} hint="关闭时，按 QQ 的聊天个人额度检查整体失效；群总额度仍独立生效。" tone={chatQuota.enabled ? 'success' : 'neutral'} />
            <SummaryCard label="默认个人额度" value={formatQuota(chatQuota.defaultLimit)} hint="0 表示普通用户默认不限额。" />
            <SummaryCard label="单独限额用户" value={String(chatSummary.overrideUsers)} hint="指定 QQ 的聊天额度会覆盖默认额度。" />
            <SummaryCard label="已耗尽用户" value={String(chatSummary.exhaustedUsers)} hint="达到聊天个人额度上限的用户数量。" tone={chatSummary.exhaustedUsers > 0 ? 'warning' : 'neutral'} />
          </div>

          {chatAccessConflictUsers.length > 0 && (
            <div className="rounded-[var(--radius-sm)] border border-[rgba(255,82,82,0.35)] bg-[rgba(255,82,82,0.08)] px-4 py-3">
              <p className="text-sm font-medium text-[var(--error)]">检测到聊天权限冲突</p>
              <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed">
                以下 QQ 同时出现在用户黑名单和聊天白名单中：<span className="mono">{chatAccessConflictUsers.join(', ')}</span>。实际运行时黑名单优先，这些人仍然不会收到普通聊天回复。建议你清理其中一侧。
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={chatQuota.enabled}
                onChange={(e) => setChatQuota({ ...chatQuota, enabled: e.target.checked })}
                className="accent-[var(--accent-purple)]"
              />
              启用聊天个人限额
            </label>
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>主人 QQ：</span>
              <span className="mono break-all">{(runtime?.masterQQ ?? []).join(', ') || '未配置'}</span>
            </div>
            <div className="flex-1" />
            <button
              onClick={() => void saveGroupUsage()}
              disabled={!groupDirty}
              className={`px-4 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${groupDirty ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed border border-[var(--border-subtle)]'}`}
            >
              💾 保存聊天/群用量计数
            </button>
            <button
              onClick={() => void saveChatRules()}
              disabled={!chatRuleDirty}
              className={`px-4 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${chatRuleDirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
            >
              💾 保存聊天权限与限额规则
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)] gap-4">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">聊天权限模式</p>
              <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                <input
                  type="radio"
                  name="chat-access-mode"
                  checked={chatAccess.mode === 'blacklist'}
                  onChange={() => setChatAccess({ ...chatAccess, mode: 'blacklist' })}
                  className="mt-1 accent-[var(--accent-purple)]"
                />
                <span>
                  黑名单模式
                  <span className="block text-[11px] text-[var(--text-muted)] leading-relaxed">沿用现有群聊/私聊规则，并额外允许给单独 QQ 设置聊天个人额度。</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                <input
                  type="radio"
                  name="chat-access-mode"
                  checked={chatAccess.mode === 'whitelist'}
                  onChange={() => setChatAccess({ ...chatAccess, mode: 'whitelist' })}
                  className="mt-1 accent-[var(--accent-purple)]"
                />
                <span>
                  白名单模式
                  <span className="block text-[11px] text-[var(--text-muted)] leading-relaxed">只有聊天白名单里的 QQ 能获得普通聊天回复。黑名单用户依然会被优先拦截。</span>
                </span>
              </label>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">聊天白名单</p>
              <TagList
                tags={chatAccess.whitelistUsers}
                onChange={(tags) => setChatAccess({ ...chatAccess, whitelistUsers: normalizeChatAccess({ ...chatAccess, whitelistUsers: tags }).whitelistUsers })}
                placeholder="输入 QQ 号后回车加入聊天白名单"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newChatWhitelistUserId}
                  onChange={(e) => setNewChatWhitelistUserId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addChatWhitelistUser(); }}
                  placeholder="再手动补一个 QQ 号"
                  className="flex-1 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                />
                <button
                  onClick={addChatWhitelistUser}
                  className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 cursor-pointer"
                >
                  加入白名单
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">聊天白名单只影响普通聊天回复，不影响生图 / 修图。用户黑名单始终优先。</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[repeat(2,minmax(0,220px))_minmax(0,1fr)] gap-4">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2">
              <p className="text-xs font-medium text-[var(--text-primary)]">默认聊天个人额度</p>
              <input
                type="number"
                min={0}
                value={chatQuota.defaultLimit}
                onChange={(e) => setChatQuota({ ...chatQuota, defaultLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
              />
              <p className="text-[11px] text-[var(--text-muted)]">0 表示普通用户默认不限额。这里只统计普通聊天，不含生图 / 修图。</p>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2">
              <p className="text-xs font-medium text-[var(--text-primary)]">聊天群总额度数量</p>
              <p className="text-[11px] text-[var(--text-muted)]">群总额度在上面的“群用量管理”表格里直接编辑。改完后仍需点击这里的“保存聊天权限与限额规则”才会写回。</p>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">手动补一个聊天单独限额用户</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newChatUserId}
                  onChange={(e) => setNewChatUserId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addCustomChatUser(); }}
                  placeholder="输入 QQ 号"
                  className="flex-1 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                />
                <button
                  onClick={addCustomChatUser}
                  className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 cursor-pointer"
                >
                  单独设置
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">新增后会先继承当前默认聊天个人额度，你可以在下方表格继续改。</p>
            </div>
          </div>

          <div className="min-w-[260px]">
            <SearchBar value={chatUserSearch} onChange={setChatUserSearch} placeholder="搜索聊天用户 QQ..." />
          </div>

          <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
            <div className="grid grid-cols-[180px_120px_140px_140px_140px_180px_120px] gap-3 px-4 py-3 text-[11px] text-[var(--text-muted)] bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
              <span>QQ</span>
              <span>身份</span>
              <span>聊天权限</span>
              <span>聊天额度</span>
              <span>聊天已用</span>
              <span>来源</span>
              <span className="text-right">操作</span>
            </div>

            <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--border-subtle)]">
              {filteredChatRows.length === 0 ? (
                <div className="px-6 py-10 text-sm text-[var(--text-muted)] text-center">没有找到符合条件的聊天用户。可以先搜索，或者手动补一个聊天单独限额用户。</div>
              ) : (
                filteredChatRows.map((row) => (
                  <div
                    key={row.uid}
                    ref={(el) => {
                      if (el) chatQuotaRowRefs.current.set(row.uid, el);
                      else chatQuotaRowRefs.current.delete(row.uid);
                    }}
                    className={`grid grid-cols-[180px_120px_140px_140px_140px_180px_120px] gap-3 px-4 py-3 text-sm items-center transition-colors ${highlightedQuotaKey === `chat:${row.uid}` ? 'bg-[rgba(14,165,233,0.08)]' : ''}`}
                  >
                    <span className="mono text-[var(--text-primary)]">{row.uid}</span>
                    <span className="text-xs">
                      {row.isMaster ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(0,230,118,0.15)] text-[var(--success)]">主人</span>
                      ) : row.hasOverride ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(255,171,64,0.18)] text-[var(--warning)]">单独限额</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)]">全局默认</span>
                      )}
                    </span>
                    <span className="text-xs">
                      {row.isMaster ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(0,230,118,0.15)] text-[var(--success)]">主人豁免</span>
                      ) : row.inGlobalBlacklist ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(255,82,82,0.15)] text-[var(--error)]">黑名单禁止</span>
                      ) : chatAccess.mode === 'whitelist' ? (
                        row.inChatWhitelist ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(255,171,64,0.18)] text-[var(--warning)]">白名单允许</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)]">未在白名单</span>
                        )
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(14,165,233,0.12)] text-[var(--info)]">黑名单模式默认可用</span>
                      )}
                    </span>
                    {row.isMaster ? (
                      <span className="text-[var(--success)]">主人无限制</span>
                    ) : row.hasOverride ? (
                      <input
                        type="number"
                        min={0}
                        value={row.limit ?? 0}
                        onChange={(e) => updateChatUserOverride(row.uid, Number(e.target.value))}
                        className="w-28 px-2 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
                      />
                    ) : (
                      <span className="mono text-[var(--text-secondary)]">{formatQuota(row.limit)}</span>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={row.used}
                        onChange={(e) => updateChatUsageCount(row.uid, Number(e.target.value))}
                        className="w-24 px-2 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
                      />
                      <span className="text-[11px] text-[var(--text-muted)]">{row.isMaster ? '主人无限制' : row.remaining === null ? '不限额' : `剩余 ${row.remaining}`}</span>
                    </div>
                    <span className="text-[var(--text-muted)]">{row.isMaster ? '主人豁免' : row.hasOverride ? '单独规则' : row.accessStatus}</span>
                    <div className="flex justify-end gap-2">
                      {!row.isMaster && !row.hasOverride && (
                        <button
                          onClick={() => addChatUserOverride(row.uid)}
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-purple)] cursor-pointer"
                        >
                          单独设置
                        </button>
                      )}
                      {!row.isMaster && row.hasOverride && (
                        <button
                          onClick={() => removeChatUserOverride(row.uid)}
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--warning)] cursor-pointer"
                        >
                          取消单独
                        </button>
                      )}
                      {row.hasStoredUsage && (
                        <button
                          onClick={() => removeChatUsageCount(row.uid)}
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--warning)] cursor-pointer"
                        >
                          清空计数
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="图像权限与限额规则" subtitle="这里同时管理谁可以生图 / 修图，以及每个 QQ 在 12 小时周期里还能用多少次。黑名单始终优先，主人始终不限额。" icon="🖼️">
        <div className="space-y-4">
          <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">
            <SummaryCard label="权限模式" value={getImageAccessModeLabel(imageAccess.mode)} hint={imageAccess.mode === 'whitelist' ? '只有手动加入图像白名单的 QQ 才能生图和修图。' : '只要是群友且不在黑名单中，就可以生图和修图。'} tone={imageAccess.mode === 'whitelist' ? 'warning' : 'neutral'} />
            <SummaryCard label="图像白名单" value={String(imageSummary.whitelistUsers)} hint="仅 whitelist 模式生效。黑名单和主人仍然优先于这份名单。" />
            <SummaryCard label="默认生图额度" value={formatQuota(imageQuota.defaultGenerateLimit)} hint="0 表示不限额。生图如果使用 --count，会按实际 count 累加。" />
            <SummaryCard label="默认修图额度" value={formatQuota(imageQuota.defaultEditLimit)} hint="0 表示不限额。修图每次命令默认记 1 次。" />
            <SummaryCard label="单独限额用户" value={String(Object.keys(imageQuota.userLimits ?? {}).length)} hint="指定 QQ 的额度会覆盖全局默认额度。" />
            <SummaryCard label="已耗尽用户" value={String(imageSummary.exhaustedUsers)} hint="任一生图或修图额度耗尽，都会计入这里。" tone={imageSummary.exhaustedUsers > 0 ? 'warning' : 'neutral'} />
          </div>

          {imageAccessConflictUsers.length > 0 && (
            <div className="rounded-[var(--radius-sm)] border border-[rgba(255,82,82,0.35)] bg-[rgba(255,82,82,0.08)] px-4 py-3">
              <p className="text-sm font-medium text-[var(--error)]">检测到图像权限冲突</p>
              <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed">
                以下 QQ 同时出现在用户黑名单和图像白名单中：<span className="mono">{imageAccessConflictUsers.join(', ')}</span>。实际运行时黑名单优先，这些人仍然无法生图或修图。建议你清理其中一侧。
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={imageQuota.enabled}
                onChange={(e) => setImageQuota({ ...imageQuota, enabled: e.target.checked })}
                className="accent-[var(--accent-purple)]"
              />
              启用图像限额
            </label>
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>图像权限：</span>
              <span>{getImageAccessModeLabel(imageAccess.mode)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>主人 QQ：</span>
              <span className="mono break-all">{(runtime?.masterQQ ?? []).join(', ') || '未配置'}</span>
            </div>
            <div className="flex-1" />
            <button
              onClick={() => void saveImageQuotaRules()}
              disabled={!imageRuleDirty}
              className={`px-4 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${imageRuleDirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
            >
              💾 保存图像权限与限额规则
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)] gap-4">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">图像权限模式</p>
              <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                <input
                  type="radio"
                  name="image-access-mode"
                  checked={imageAccess.mode === 'blacklist'}
                  onChange={() => setImageAccess({ ...imageAccess, mode: 'blacklist' })}
                  className="mt-1 accent-[var(--accent-purple)]"
                />
                <span>
                  黑名单模式
                  <span className="block text-[11px] text-[var(--text-muted)] leading-relaxed">只要是群友，且不在用户黑名单中，就可以生图和修图。</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                <input
                  type="radio"
                  name="image-access-mode"
                  checked={imageAccess.mode === 'whitelist'}
                  onChange={() => setImageAccess({ ...imageAccess, mode: 'whitelist' })}
                  className="mt-1 accent-[var(--accent-purple)]"
                />
                <span>
                  白名单模式
                  <span className="block text-[11px] text-[var(--text-muted)] leading-relaxed">只有手动加入图像白名单的 QQ 才能生图和修图。黑名单用户依然会被拦截。</span>
                </span>
              </label>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">图像白名单</p>
              <TagList
                tags={imageAccess.whitelistUsers}
                onChange={(tags) => setImageAccess({ ...imageAccess, whitelistUsers: normalizeImageAccess({ ...imageAccess, whitelistUsers: tags }).whitelistUsers })}
                placeholder="输入 QQ 号后回车加入图像白名单"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newWhitelistUserId}
                  onChange={(e) => setNewWhitelistUserId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addWhitelistUser(); }}
                  placeholder="再手动补一个 QQ 号"
                  className="flex-1 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                />
                <button
                  onClick={addWhitelistUser}
                  className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 cursor-pointer"
                >
                  加入白名单
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">这份名单只控制生图 / 修图权限，不影响普通聊天。若同一个 QQ 同时在用户黑名单里，实际运行时仍以黑名单为准。</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[repeat(2,minmax(0,220px))_minmax(0,1fr)] gap-4">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2">
              <p className="text-xs font-medium text-[var(--text-primary)]">默认生图额度</p>
              <input
                type="number"
                min={0}
                value={imageQuota.defaultGenerateLimit}
                onChange={(e) => setImageQuota({ ...imageQuota, defaultGenerateLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
              />
              <p className="text-[11px] text-[var(--text-muted)]">0 表示普通用户默认不限额。生图若使用 `--count 4`，会按 4 次累计。</p>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2">
              <p className="text-xs font-medium text-[var(--text-primary)]">默认修图额度</p>
              <input
                type="number"
                min={0}
                value={imageQuota.defaultEditLimit}
                onChange={(e) => setImageQuota({ ...imageQuota, defaultEditLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
              />
              <p className="text-[11px] text-[var(--text-muted)]">0 表示普通用户默认不限额。修图每执行一次命令，默认按 1 次累计。</p>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">手动补一个单独限额用户</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addCustomUser(); }}
                  placeholder="输入 QQ 号"
                  className="flex-1 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                />
                <button
                  onClick={addCustomUser}
                  className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 cursor-pointer"
                >
                  单独设置
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">这里新增的是“单独限额规则”，不是计数。新增后会先继承当前全局默认值，你可以在下方表格继续改。</p>
            </div>
          </div>

          <div className="min-w-[260px]">
            <SearchBar value={userSearch} onChange={setUserSearch} placeholder="搜索 QQ 号..." />
          </div>

          <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
            <div className="grid grid-cols-[180px_120px_140px_140px_140px_180px_120px] gap-3 px-4 py-3 text-[11px] text-[var(--text-muted)] bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
              <span>QQ</span>
              <span>身份</span>
              <span>图像权限</span>
              <span>生图额度</span>
              <span>修图额度</span>
              <span>来源</span>
              <span className="text-right">操作</span>
            </div>

            <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--border-subtle)]">
              {filteredImageRows.length === 0 ? (
                <div className="px-6 py-10 text-sm text-[var(--text-muted)] text-center">没有找到符合条件的 QQ。可以先搜索，或者手动补一个单独限额用户。</div>
              ) : (
                filteredImageRows.map((row) => (
                  <div
                    key={row.uid}
                    ref={(el) => {
                      if (el) imageQuotaRowRefs.current.set(row.uid, el);
                      else imageQuotaRowRefs.current.delete(row.uid);
                    }}
                    className={`grid grid-cols-[180px_120px_140px_140px_140px_180px_120px] gap-3 px-4 py-3 text-sm items-center transition-colors ${highlightedQuotaKey === `image:${row.uid}` ? 'bg-[rgba(251,191,36,0.10)]' : ''}`}
                  >
                    <span className="mono text-[var(--text-primary)]">{row.uid}</span>
                    <span className="text-xs">
                      {row.isMaster ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(0,230,118,0.15)] text-[var(--success)]">主人</span>
                      ) : row.hasOverride ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(255,171,64,0.18)] text-[var(--warning)]">单独限额</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)]">全局默认</span>
                      )}
                    </span>
                    <span className="text-xs">
                      {row.isMaster ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(0,230,118,0.15)] text-[var(--success)]">主人豁免</span>
                      ) : row.inGlobalBlacklist ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(255,82,82,0.15)] text-[var(--error)]">黑名单禁止</span>
                      ) : imageAccess.mode === 'whitelist' ? (
                        row.inImageWhitelist ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(255,171,64,0.18)] text-[var(--warning)]">白名单允许</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)]">未在白名单</span>
                        )
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(14,165,233,0.12)] text-[var(--info)]">黑名单模式默认可用</span>
                      )}
                    </span>
                    {row.isMaster ? (
                      <span className="text-[var(--success)]">主人无限制</span>
                    ) : row.hasOverride ? (
                      <input
                        type="number"
                        min={0}
                        value={row.generateLimit ?? 0}
                        onChange={(e) => updateUserOverride(row.uid, 'generateLimit', Number(e.target.value))}
                        className="w-28 px-2 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
                      />
                    ) : (
                      <span className="mono text-[var(--text-secondary)]">{formatQuota(row.generateLimit)}</span>
                    )}
                    {row.isMaster ? (
                      <span className="text-[var(--success)]">主人无限制</span>
                    ) : row.hasOverride ? (
                      <input
                        type="number"
                        min={0}
                        value={row.editLimit ?? 0}
                        onChange={(e) => updateUserOverride(row.uid, 'editLimit', Number(e.target.value))}
                        className="w-28 px-2 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
                      />
                    ) : (
                      <span className="mono text-[var(--text-secondary)]">{formatQuota(row.editLimit)}</span>
                    )}
                    <span className="text-[var(--text-muted)]">{row.isMaster ? '主人豁免' : row.hasOverride ? '单独规则' : row.accessStatus}</span>
                    <div className="flex justify-end gap-2">
                      {!row.isMaster && !row.hasOverride && (
                        <button
                          onClick={() => addUserOverride(row.uid)}
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-purple)] cursor-pointer"
                        >
                          单独设置
                        </button>
                      )}
                      {!row.isMaster && row.hasOverride && (
                        <button
                          onClick={() => removeUserOverride(row.uid)}
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--warning)] cursor-pointer"
                        >
                          取消单独
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="图像用量计数" subtitle="这里维护生图 / 修图在当前 12 小时周期内已经累计到多少。主人虽然无限制，但如果你手工补了主人数据，这里也会显示出来供你观察。" icon="📊">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <ImportExportActions
              onExport={exportImageUsage}
              onImport={importImageUsage}
              confirmTitle="导入图像用量计数"
            />
            <button
              onClick={() => setConfirmResetImage(true)}
              className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,82,82,0.15)] text-[var(--error)] hover:bg-[rgba(255,82,82,0.25)] cursor-pointer"
            >
              重置图像周期
            </button>
            <button
              onClick={() => void saveImageUsage()}
              disabled={!imageDirty}
              className={`px-4 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${imageDirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
            >
              💾 保存图像计数
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">图像周期标识</p>
              <input
                type="text"
                value={imageUsage.periodId}
                onChange={(e) => setImageUsage({ ...imageUsage, periodId: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
              />
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  onClick={() => setImageUsage({ ...imageUsage, periodId: getCurrentPeriodId() })}
                  className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  切到当前周期
                </button>
                <span className="text-[var(--text-muted)] self-center">当前周期推荐值：{getCurrentPeriodId()}</span>
              </div>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">当前统计摘要</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[var(--text-muted)] text-xs">生图已用</div>
                  <div className="mono text-[var(--text-primary)]">{imageSummary.totalGenerateUsed}</div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)] text-xs">修图已用</div>
                  <div className="mono text-[var(--text-primary)]">{imageSummary.totalEditUsed}</div>
                </div>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">这里的计数会和上面的图像限额规则一起决定某个 QQ 还能不能继续生图或修图。</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
            <div className="grid grid-cols-[180px_120px_120px_140px_140px_120px_120px] gap-3 px-4 py-3 text-[11px] text-[var(--text-muted)] bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
              <span>QQ</span>
              <span>身份</span>
              <span>生图已用</span>
              <span>修图已用</span>
              <span>生图剩余</span>
              <span>修图剩余</span>
              <span className="text-right">操作</span>
            </div>

            <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--border-subtle)]">
              {filteredImageRows.length === 0 ? (
                <div className="px-6 py-10 text-sm text-[var(--text-muted)] text-center">没有找到符合条件的 QQ 统计条目。</div>
              ) : (
                filteredImageRows.map((row) => (
                  <div key={row.uid} className="grid grid-cols-[180px_120px_120px_140px_140px_120px_120px] gap-3 px-4 py-3 text-sm items-center">
                    <span className="mono text-[var(--text-primary)]">{row.uid}</span>
                    <span className="text-xs">
                      {row.isMaster ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(0,230,118,0.15)] text-[var(--success)]">主人</span>
                      ) : row.hasOverride ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(255,171,64,0.18)] text-[var(--warning)]">单独限额</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)]">全局默认</span>
                      )}
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={row.generateUsed}
                      onChange={(e) => updateImageUsageCount(row.uid, 'generate', Number(e.target.value))}
                      className="w-24 px-2 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
                    />
                    <input
                      type="number"
                      min={0}
                      value={row.editUsed}
                      onChange={(e) => updateImageUsageCount(row.uid, 'edit', Number(e.target.value))}
                      className="w-24 px-2 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
                    />
                    <span className="mono text-[var(--text-secondary)]">{row.isMaster ? '主人无限制' : row.generateRemaining === null ? '不限额' : row.generateRemaining}</span>
                    <span className="mono text-[var(--text-secondary)]">{row.isMaster ? '主人无限制' : row.editRemaining === null ? '不限额' : row.editRemaining}</span>
                    <div className="flex justify-end gap-2">
                      {row.hasStoredUsage && (
                        <button
                          onClick={() => removeImageUsageCount(row.uid)}
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--warning)] cursor-pointer"
                        >
                          清空计数
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmResetGroup}
        onClose={() => setConfirmResetGroup(false)}
        onConfirm={resetGroupPeriod}
        title="重置群用量周期"
        message="这会把群聊周期标识切到当前东八区时间段，并把所有群计数清空。这里只会进入待保存状态，真正写回文件还要再点一次“保存群用量”。"
        confirmText="确认重置"
      />

      <ConfirmDialog
        open={confirmDropUnknown}
        onClose={() => setConfirmDropUnknown(false)}
        onConfirm={dropUnknownGroups}
        title="只保留监听中的群"
        message="这会把不在 runtime.groups 里的群计数从列表中移掉。适合清理旧群或误加的群。这里只会进入待保存状态，真正写回文件还要再点一次“保存群用量”。"
        confirmText="确认清理"
      />

      <ConfirmDialog
        open={confirmResetImage}
        onClose={() => setConfirmResetImage(false)}
        onConfirm={resetImagePeriod}
        title="重置图像用量周期"
        message="这会把图像周期标识切到当前东八区时间段，并清空所有 QQ 的生图 / 修图计数。这里只会进入待保存状态，真正写回文件还要再点一次“保存图像计数”。"
        confirmText="确认重置"
      />
    </div>
  );
}
