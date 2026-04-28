import { useState, useEffect, useMemo, useCallback, useDeferredValue, useRef, memo } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SearchBar } from '../components/common/SearchBar';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ImportExportActions } from '../components/common/ImportExportActions';
import { Panel } from '../components/common/Panel';
import { SummaryCard } from '../components/common/SummaryCard';
import { DeferredVisibleBlock } from '../components/common/DeferredVisibleBlock';
import { VirtualList } from '../components/common/VirtualList';
import { useUiStore } from '../stores/uiStore';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { usePageDirtyState } from '../hooks/usePageDirtyState';
import { getConfig, saveConfig, pingApi, batchPingApis, batchPingApisStream, getApiHistoryMetrics, getApiHealthWeights, saveApiHealthWeights } from '../lib/tauri-commands';
import { listenCompat } from '../lib/runtime-bridge';
import { downloadJsonWithTimestamp, pickJsonAndParse } from '../lib/json-transfer';
import type { ApiNode, ImageApiNode, ImageApiProviderType, RuntimeConfig, PingResult, ApiHistoryMetric, ApiHealthWeights } from '../lib/types';

interface NodeState {
  nodes: ApiNode[];
  activeIndex: number;
}

interface ImageNodeState {
  nodes: ImageApiNode[];
  activeIndex: number;
}

type NodeHealth = {
  score: number;
  level: 'healthy' | 'warning' | 'risk';
  source: 'live' | 'history' | 'mixed' | 'none';
  reason: string;
  liveScore: number | null;
  historyScore: number | null;
  timeoutScore: number | null;
  jitterScore: number | null;
  liveWeight: number;
  historyWeight: number;
  timeoutWeight: number;
  jitterWeight: number;
};

type ApiManagerViewState = {
  managerMode: 'chat' | 'image';
  search: string;
  imageSearch: string;
  healthSort: 'none' | 'desc' | 'asc';
  healthFilter: 'all' | 'healthy' | 'warning' | 'risk';
  healthSourceFilter: 'all' | 'live' | 'history' | 'mixed' | 'none';
  showAdvancedToolbar: boolean;
  showNodeHealthPanels: boolean;
  focusActiveNodeOnly: boolean;
};

type DirectoryListItem =
  | { kind: 'group'; key: string; provider: string; count: number }
  | { kind: 'node'; key: string; index: number };

const API_MANAGER_VIEW_STORAGE_KEY = 'nekoai-api-manager-view';
const DEFAULT_IMAGE_API_TIMEOUT_MS = 300000;
const DEFAULT_API_MANAGER_VIEW_STATE: ApiManagerViewState = {
  managerMode: 'chat',
  search: '',
  imageSearch: '',
  healthSort: 'none',
  healthFilter: 'all',
  healthSourceFilter: 'all',
  showAdvancedToolbar: false,
  showNodeHealthPanels: false,
  focusActiveNodeOnly: false,
};

function clampScore(v: number) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function pickLevel(score: number): NodeHealth['level'] {
  if (score >= 80) return 'healthy';
  if (score >= 50) return 'warning';
  return 'risk';
}

function normalizeRemark(input: string | undefined) {
  return (input ?? '').trim().toLowerCase();
}

function normalizeModel(input: string | undefined) {
  return (input ?? '').trim().toLowerCase();
}

function normalizeAiType(input: string | undefined, apiUrl?: string) {
  const raw = (input ?? '').trim().toLowerCase();
  if (raw === 'responses' || raw === 'response' || raw === 'openai-response') return 'responses';
  if (raw === 'anthropic' || raw === 'gemini') return raw;
  if ((apiUrl ?? '').trim().match(/\/responses(?:\?|$)/i)) return 'responses';
  return 'openai';
}

function normalizeApiNode(input?: Partial<ApiNode>): ApiNode {
  const apiUrl = typeof input?.apiUrl === 'string' ? input.apiUrl : '';
  return {
    apiUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey : '',
    modelName: typeof input?.modelName === 'string' ? input.modelName : '',
    remark: typeof input?.remark === 'string' ? input.remark : '',
    aiType: normalizeAiType(typeof input?.aiType === 'string' ? input.aiType : '', apiUrl),
    xaiWebSearchEnabled: input?.xaiWebSearchEnabled === true,
  };
}

function normalizeImageProviderType(input?: string): ImageApiProviderType {
  const raw = String(input ?? '').trim().toLowerCase();
  if (raw === 'openai' || raw === 'openai-compatible' || raw === 'openai_compatible') return 'openai';
  return 'xai';
}

function getDefaultImageModel(providerType: ImageApiProviderType) {
  return providerType === 'openai' ? 'gpt-image-2' : 'grok-imagine-image';
}

function getDefaultImageGenerationUrl(providerType: ImageApiProviderType) {
  return providerType === 'openai'
    ? 'https://api.openai.com/v1/images/generations'
    : 'https://api.x.ai/v1/images/generations';
}

function getDefaultImageEditUrl(providerType: ImageApiProviderType) {
  return providerType === 'openai'
    ? 'https://api.openai.com/v1/images/edits'
    : 'https://api.x.ai/v1/images/edits';
}

function getDefaultImageSupportsEdit(providerType: ImageApiProviderType) {
  return providerType === 'xai' || providerType === 'openai';
}

function getImageProviderLabel(providerType: ImageApiProviderType) {
  return providerType === 'openai' ? 'OpenAI 图像' : 'xAI 图像';
}

function getImageApiKeyPlaceholder(providerType: ImageApiProviderType) {
  return providerType === 'openai' ? 'sk-...' : 'xai-...';
}

function isGptImage2Model(modelName?: string) {
  return String(modelName ?? '').trim().toLowerCase() === 'gpt-image-2';
}

function isGptImage2ImageNode(node: Partial<ImageApiNode>) {
  const providerType = normalizeImageProviderType(node.providerType);
  const modelName = typeof node.modelName === 'string' && node.modelName.trim() ? node.modelName : getDefaultImageModel(providerType);
  return providerType === 'openai' && isGptImage2Model(modelName);
}

function imageNodeSupportsEdit(node: Partial<ImageApiNode>) {
  const providerType = normalizeImageProviderType(node.providerType);
  return typeof node.supportsEdit === 'boolean' ? node.supportsEdit : getDefaultImageSupportsEdit(providerType);
}

function getImageCapabilityLabel(node: Partial<ImageApiNode>) {
  return imageNodeSupportsEdit(node) ? '生图 + 修图' : '仅生图';
}

function normalizeImageApiNode(input?: Partial<ImageApiNode>): ImageApiNode {
  const providerType = normalizeImageProviderType(input?.providerType);
  const modelName = typeof input?.modelName === 'string' && input.modelName.trim() ? input.modelName : getDefaultImageModel(providerType);
  const base = { ...input, providerType, modelName };
  return {
    providerType,
    generationUrl: typeof input?.generationUrl === 'string' ? input.generationUrl : '',
    editUrl: typeof input?.editUrl === 'string' ? input.editUrl : '',
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey : '',
    modelName,
    remark: typeof input?.remark === 'string' ? input.remark : '',
    aspectRatio: typeof input?.aspectRatio === 'string' ? input.aspectRatio : '',
    resolution: typeof input?.resolution === 'string' ? input.resolution : '',
    supportsEdit: imageNodeSupportsEdit(base),
  };
}

function formatAiTypeLabel(aiType: ApiNode['aiType']) {
  if (aiType === 'responses') return 'openai-response';
  if (aiType === 'openai') return 'openai (completions)';
  return aiType;
}

function getDefaultSuffix(aiType: ApiNode['aiType'], modelName?: string) {
  if (aiType === 'responses') return '/v1/responses';
  if (aiType === 'anthropic') return '/v1/messages';
  if (aiType === 'gemini') return `/v1beta/models/${(modelName ?? '').trim() || '{model}'}:generateContent`;
  return '/v1/chat/completions';
}

function getDefaultSuffixActionLabel(aiType: ApiNode['aiType'], modelName?: string) {
  return `补 ${getDefaultSuffix(aiType, modelName)}`;
}

function getDefaultSuffixHint(aiType: ApiNode['aiType'], modelName?: string) {
  if (aiType === 'responses') return '常见默认后缀：/v1/responses';
  if (aiType === 'anthropic') return '常见默认后缀：/v1/messages';
  if (aiType === 'gemini') {
    const model = (modelName ?? '').trim() || '{model}';
    return `常见默认后缀：/v1beta/models/${model}:generateContent`;
  }
  return '常见默认后缀：/v1/chat/completions';
}

function hasDefaultSuffix(url: string, aiType: ApiNode['aiType']) {
  if (aiType === 'responses') return /\/v1\/responses(?:[/?#]|$)/i.test(url);
  if (aiType === 'anthropic') return /\/v1\/messages(?:[/?#]|$)/i.test(url);
  if (aiType === 'gemini') return /\/v1beta\/models\/[^/?#]+:generatecontent(?:[/?#]|$)/i.test(url);
  return /\/v1\/chat\/completions(?:[/?#]|$)/i.test(url);
}

function appendDefaultSuffix(url: string, aiType: ApiNode['aiType'], modelName?: string) {
  const current = String(url || '').trim();
  const suffix = getDefaultSuffix(aiType, modelName);
  if (!current) return suffix;
  if (hasDefaultSuffix(current, aiType)) return current;
  if (/[?#]/.test(current)) return current;
  const base = current.replace(/\/+$/, '');
  return `${base}${suffix}`;
}

function appendKnownSuffix(url: string, suffix: string, pattern: RegExp) {
  const current = String(url || '').trim();
  if (!current) return suffix;
  if (pattern.test(current)) return current;
  if (/[?#]/.test(current)) return current;
  return `${current.replace(/\/+$/, '')}${suffix}`;
}

function appendXaiImageGenerationSuffix(url: string) {
  return appendKnownSuffix(url, '/v1/images/generations', /\/v1\/images\/generations(?:[/?#]|$)/i);
}

function appendXaiImageEditSuffix(url: string) {
  return appendKnownSuffix(url, '/v1/images/edits', /\/v1\/images\/edits(?:[/?#]|$)/i);
}

function readPositiveMs(value: unknown) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
}

function getRuntimeImageApiTimeoutMs(runtime?: RuntimeConfig | null) {
  const explicit = readPositiveMs(runtime?.imageApiTimeoutMs);
  if (explicit > 0) return explicit;
  return Math.max(readPositiveMs(runtime?.apiTimeoutMs) || 120000, DEFAULT_IMAGE_API_TIMEOUT_MS);
}

function formatTimeoutMs(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds >= 60) {
    const minutes = seconds / 60;
    return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} 分钟`;
  }
  return `${seconds} 秒`;
}

const IMAGE_ASPECT_RATIO_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '空白（本节点不主动传比例，交给命令参数或 xAI 自己决定）' },
  { value: 'auto', label: 'auto（显式告诉 xAI 自动选比例）' },
  { value: '1:1', label: '1:1（正方形）' },
  { value: '16:9', label: '16:9（横屏）' },
  { value: '9:16', label: '9:16（竖屏）' },
  { value: '4:3', label: '4:3（横向标准）' },
  { value: '3:4', label: '3:4（纵向标准）' },
  { value: '3:2', label: '3:2（横向摄影）' },
  { value: '2:3', label: '2:3（纵向摄影）' },
  { value: '2:1', label: '2:1（超宽横幅）' },
  { value: '1:2', label: '1:2（超长竖幅）' },
  { value: '19.5:9', label: '19.5:9（手机横屏）' },
  { value: '9:19.5', label: '9:19.5（手机竖屏）' },
  { value: '20:9', label: '20:9（超长横屏）' },
  { value: '9:20', label: '9:20（超长竖屏）' },
];

const IMAGE_RESOLUTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '空白（本节点不主动传清晰度，交给命令参数或 xAI 自己决定）' },
  { value: '1k', label: '1k（标准清晰度）' },
  { value: '2k', label: '2k（高清清晰度）' },
];

function getLevelMeta(level: NodeHealth['level'] | undefined) {
  if (level === 'healthy') {
    return {
      label: '健康',
      bg: 'rgba(0,230,118,0.15)',
      color: 'var(--success)',
    };
  }
  if (level === 'warning') {
    return {
      label: '警告',
      bg: 'rgba(255,171,64,0.18)',
      color: 'var(--warning)',
    };
  }
  return {
    label: '风险',
    bg: 'rgba(255,82,82,0.15)',
    color: 'var(--error)',
  };
}

function getHealthSourceLabel(source: NodeHealth['source'] | undefined) {
  if (source === 'live') return '实时';
  if (source === 'history') return '历史';
  if (source === 'mixed') return '混合';
  return '无数据';
}

function getHealthSourceHint(source: NodeHealth['source'] | undefined) {
  if (source === 'live') return '来自本次窗口里实际点过的节点健康测试';
  if (source === 'history') return '来自历史调用统计，本次窗口未必重新测过';
  if (source === 'mixed') return '同时参考了本次测试结果和历史统计';
  return '还没有可用的实时或历史数据';
}

function formatHealthBadge(health: NodeHealth | undefined) {
  if (!health || health.source === 'none') return '无数据';
  return `${getHealthSourceLabel(health.source)} ${health.score}分`;
}

function loadApiManagerViewState(): ApiManagerViewState {
  try {
    const raw = localStorage.getItem(API_MANAGER_VIEW_STORAGE_KEY);
    if (!raw) return DEFAULT_API_MANAGER_VIEW_STATE;
    const parsed = JSON.parse(raw) as Partial<ApiManagerViewState>;
    return {
      managerMode: parsed.managerMode === 'image' ? 'image' : 'chat',
      search: typeof parsed.search === 'string' ? parsed.search : '',
      imageSearch: typeof parsed.imageSearch === 'string' ? parsed.imageSearch : '',
      healthSort: parsed.healthSort === 'asc' || parsed.healthSort === 'desc' ? parsed.healthSort : 'none',
      healthFilter: parsed.healthFilter === 'healthy' || parsed.healthFilter === 'warning' || parsed.healthFilter === 'risk' ? parsed.healthFilter : 'all',
      healthSourceFilter: parsed.healthSourceFilter === 'live' || parsed.healthSourceFilter === 'history' || parsed.healthSourceFilter === 'mixed' || parsed.healthSourceFilter === 'none'
        ? parsed.healthSourceFilter
        : 'all',
      showAdvancedToolbar: parsed.showAdvancedToolbar === true,
      showNodeHealthPanels: parsed.showNodeHealthPanels === true,
      focusActiveNodeOnly: parsed.focusActiveNodeOnly === true,
    };
  } catch {
    return DEFAULT_API_MANAGER_VIEW_STATE;
  }
}

function persistApiManagerViewState(next: ApiManagerViewState) {
  try {
    localStorage.setItem(API_MANAGER_VIEW_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore local storage failure
  }
}

function getDensityClass(density: 'compact' | 'standard' | 'spacious') {
  if (density === 'compact') {
    return {
      pageGap: 'gap-3',
      sidebarPadding: 'px-3 py-3',
      sectionGap: 'space-y-3',
      cardPadding: 'p-4',
      cardGap: 'gap-3',
      contentGap: 'space-y-3',
      toolbarPadding: 'px-3 py-3',
      summaryGrid: 'gap-2',
    };
  }
  if (density === 'spacious') {
    return {
      pageGap: 'gap-5',
      sidebarPadding: 'px-4 py-4',
      sectionGap: 'space-y-4',
      cardPadding: 'p-6',
      cardGap: 'gap-4',
      contentGap: 'space-y-4',
      toolbarPadding: 'px-4 py-4',
      summaryGrid: 'gap-3',
    };
  }
  return {
    pageGap: 'gap-4',
    sidebarPadding: 'px-4 py-3.5',
    sectionGap: 'space-y-3.5',
    cardPadding: 'p-5',
    cardGap: 'gap-3',
    contentGap: 'space-y-3',
    toolbarPadding: 'px-4 py-3',
    summaryGrid: 'gap-2.5',
  };
}

function MetricBar({ label, score, weight, color, hint }: { label: string; score: number | null | undefined; weight: number; color: string; hint?: string }) {
  const value = score ?? 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="text-[var(--text-secondary)]">{label}</span>
        <span className="mono text-[var(--text-muted)]">{score ?? '-'} / {weight}%</span>
      </div>
      <div className="h-1.5 rounded bg-[var(--border-subtle)] overflow-hidden">
        <div className="h-full rounded" style={{ width: `${value}%`, background: color }} />
      </div>
      {hint ? <p className="text-[10px] text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}

function DeferredCardPlaceholder({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
      <p className="text-xs text-[var(--text-primary)]">{title}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">{subtitle}</p>
    </div>
  );
}

export function ApiManager() {
  const addToast = useUiStore((s) => s.addToast);
  const settings = useUiStore((s) => s.settings);
  const pageJumpRequest = useUiStore((s) => s.pageJumpRequest);
  const clearPageJumpRequest = useUiStore((s) => s.clearPageJumpRequest);
  const initialViewState = useMemo(() => loadApiManagerViewState(), []);
  const { state, set, reset, undo, redo, canUndo, canRedo } = useUndoRedo<NodeState>({ nodes: [], activeIndex: 0 });
  const {
    state: imageState,
    set: setImageState,
    reset: resetImageState,
    undo: undoImage,
    redo: redoImage,
    canUndo: canUndoImage,
    canRedo: canRedoImage,
  } = useUndoRedo<ImageNodeState>({ nodes: [], activeIndex: 0 });
  const [original, setOriginal] = useState('');
  const [imageOriginal, setImageOriginal] = useState('');
  const [imageRuntimeOriginal, setImageRuntimeOriginal] = useState('');
  const [originalWeights, setOriginalWeights] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialViewState.search);
  const [imageSearch, setImageSearch] = useState(initialViewState.imageSearch);
  const [managerMode, setManagerMode] = useState<'chat' | 'image'>(initialViewState.managerMode);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pingResults, setPingResults] = useState<Map<number, PingResult>>(new Map());
  const [pinging, setPinging] = useState<Set<number>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showAllKeys, setShowAllKeys] = useState(false);
  const [showKey, setShowKey] = useState<Set<number>>(new Set());
  const [batchPinging, setBatchPinging] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [batchSessionId, setBatchSessionId] = useState<string | null>(null);
  const [healthSort, setHealthSort] = useState<'none' | 'desc' | 'asc'>(initialViewState.healthSort);
  const [healthFilter, setHealthFilter] = useState<'all' | 'healthy' | 'warning' | 'risk'>(initialViewState.healthFilter);
  const [healthSourceFilter, setHealthSourceFilter] = useState<'all' | 'live' | 'history' | 'mixed' | 'none'>(initialViewState.healthSourceFilter);
  const [historyMetrics, setHistoryMetrics] = useState<ApiHistoryMetric[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [weightLive, setWeightLive] = useState(60);
  const [weightTimeout, setWeightTimeout] = useState(20);
  const [weightJitter, setWeightJitter] = useState(20);
  const [showAdvancedToolbar, setShowAdvancedToolbar] = useState(initialViewState.showAdvancedToolbar);
  const [showNodeHealthPanels, setShowNodeHealthPanels] = useState(initialViewState.showNodeHealthPanels);
  const [focusActiveNodeOnly, setFocusActiveNodeOnly] = useState(initialViewState.focusActiveNodeOnly);
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const imageCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const deferredSearch = useDeferredValue(search);
  const deferredImageSearch = useDeferredValue(imageSearch);

  const { nodes, activeIndex } = state;
  const { nodes: imageNodes, activeIndex: activeImageIndex } = imageState;
  const historyWeight = Math.max(0, 100 - Math.max(0, Math.min(100, weightLive)) - Math.max(0, Math.min(100, weightTimeout)) - Math.max(0, Math.min(100, weightJitter)));
  const weightState = useMemo(() => ({
    liveWeight: Math.max(0, Math.min(100, weightLive)),
    historyWeight,
    timeoutWeight: Math.max(0, Math.min(100, weightTimeout)),
    jitterWeight: Math.max(0, Math.min(100, weightJitter)),
  }), [weightLive, historyWeight, weightTimeout, weightJitter]);
  const dirty = useMemo(() => JSON.stringify(state) !== original || JSON.stringify(weightState) !== originalWeights, [state, original, weightState, originalWeights]);
  const imageDirty = useMemo(() => JSON.stringify(imageState) !== imageOriginal, [imageState, imageOriginal]);
  const imageRuntimeState = useMemo(() => JSON.stringify({ imageApiTimeoutMs: getRuntimeImageApiTimeoutMs(runtimeConfig) }), [runtimeConfig]);
  const imageRuntimeDirty = useMemo(() => imageRuntimeState !== imageRuntimeOriginal, [imageRuntimeState, imageRuntimeOriginal]);
  const imageConfigDirty = imageDirty || imageRuntimeDirty;
  const density = getDensityClass(settings.contentDensity);
  const nodeCardStackGap = settings.contentDensity === 'compact' ? 'space-y-6' : settings.contentDensity === 'spacious' ? 'space-y-10' : 'space-y-8';
  const allApiKeyExpanded = nodes.length > 0 && nodes.every((_, i) => expandedCards.has(i));
  usePageDirtyState('api', dirty || imageConfigDirty, managerMode === 'image' ? '图像节点列表或全局图像设置存在未保存改动，离开后这些改动不会自动写回文件。' : '聊天节点列表或评分设置存在未保存改动，离开后这些改动不会自动写回文件。');

  useEffect(() => { load(); }, []);

  useEffect(() => {
    persistApiManagerViewState({
      managerMode,
      search,
      imageSearch,
      healthSort,
      healthFilter,
      healthSourceFilter,
      showAdvancedToolbar,
      showNodeHealthPanels,
      focusActiveNodeOnly,
    });
  }, [managerMode, search, imageSearch, healthSort, healthFilter, healthSourceFilter, showAdvancedToolbar, showNodeHealthPanels, focusActiveNodeOnly]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (managerMode === 'image') void saveImageApis(); else void save(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); if (managerMode === 'image') undoImage(); else undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); if (managerMode === 'image') redoImage(); else redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [managerMode, undo, redo, undoImage, redoImage, state, original, imageState, imageOriginal]);

  useEffect(() => {
    if (!batchSessionId) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;

    async function setup() {
      try {
        unlistenProgress = await listenCompat<{ session_id: string; result: PingResult; done: number; total: number }>('batch-ping-progress', (event) => {
          const payload = event.payload;
          if (!payload || payload.session_id !== batchSessionId) return;
          setPingResults((m) => {
            const next = new Map(m);
            next.set(payload.result.index, payload.result);
            return next;
          });
          setBatchProgress({ done: payload.done, total: payload.total });
        });

        unlistenDone = await listenCompat<{ session_id: string; results: PingResult[] }>('batch-ping-done', (event) => {
          const payload = event.payload;
          if (!payload || payload.session_id !== batchSessionId) return;
          setBatchPinging(false);
          setBatchSessionId(null);
          setBatchProgress({ done: 0, total: 0 });
          const passed = (payload.results ?? []).filter((r) => r.pass).length;
        addToast('success', `批量测试完成：${passed}/${payload.results?.length ?? 0} 个节点可用。可以优先看风险节点，再决定默认节点要不要换。`);
        });
      } catch {
        // fallback handled below
      }
    }

    setup();
    return () => {
      unlistenProgress?.();
      unlistenDone?.();
    };
  }, [batchSessionId, addToast]);

  async function load() {
    setLoading(true);
    try {
      const [apiData, imageApiData, rt, metrics, healthWeights] = await Promise.all([
        getConfig<ApiNode[]>('api'),
        getConfig<ImageApiNode[]>('imageApi'),
        getConfig<RuntimeConfig>('runtime'),
        getApiHistoryMetrics().catch(() => []),
        getApiHealthWeights().catch(() => ({ liveWeight: 60, historyWeight: 0, timeoutWeight: 20, jitterWeight: 20 } as ApiHealthWeights)),
      ]);
      const normalizedNodes = Array.isArray(apiData) ? apiData.map((node) => normalizeApiNode(node)) : [];
      const normalizedImageNodes = Array.isArray(imageApiData) ? imageApiData.map((node) => normalizeImageApiNode(node)) : [];
      const initial: NodeState = {
        nodes: normalizedNodes,
        activeIndex: rt?.activeApiIndex ?? 0,
      };
      const imageInitial: ImageNodeState = {
        nodes: normalizedImageNodes,
        activeIndex: rt?.activeImageApiIndex ?? 0,
      };
      reset(initial);
      resetImageState(imageInitial);
      setOriginal(JSON.stringify(initial));
      setImageOriginal(JSON.stringify(imageInitial));
      setImageRuntimeOriginal(JSON.stringify({ imageApiTimeoutMs: getRuntimeImageApiTimeoutMs(rt ?? null) }));
      setSelected(new Set());
      setPingResults(new Map());
      setRuntimeConfig(rt ?? null);
      const liveW = Number(healthWeights?.liveWeight ?? 60);
      const timeoutW = Number(healthWeights?.timeoutWeight ?? 20);
      const jitterW = Number(healthWeights?.jitterWeight ?? 20);
      setWeightLive(Math.max(0, Math.min(100, Number.isFinite(liveW) ? liveW : 60)));
      setWeightTimeout(Math.max(0, Math.min(100, Number.isFinite(timeoutW) ? timeoutW : 20)));
      setWeightJitter(Math.max(0, Math.min(100, Number.isFinite(jitterW) ? jitterW : 20)));
      setOriginalWeights(JSON.stringify({
        liveWeight: Math.max(0, Math.min(100, Number.isFinite(liveW) ? liveW : 60)),
        historyWeight: Math.max(0, 100 - Math.max(0, Math.min(100, Number.isFinite(liveW) ? liveW : 60)) - Math.max(0, Math.min(100, Number.isFinite(timeoutW) ? timeoutW : 20)) - Math.max(0, Math.min(100, Number.isFinite(jitterW) ? jitterW : 20))),
        timeoutWeight: Math.max(0, Math.min(100, Number.isFinite(timeoutW) ? timeoutW : 20)),
        jitterWeight: Math.max(0, Math.min(100, Number.isFinite(jitterW) ? jitterW : 20)),
      }));
      setHistoryMetrics((metrics as any[]).map((m) => ({
        index: -1,
        total: Number(m.total ?? 0),
        errors: Number(m.errors ?? 0),
        error_rate: Number(m.error_rate ?? 0),
        timeout_errors: Number(m.timeout_errors ?? 0),
        timeout_rate: Number(m.timeout_rate ?? 0),
        avg_response_time_ms: Number(m.avg_response_time_ms ?? 0),
        jitter_ms: Number(m.jitter_ms ?? 0),
        apiRemark: String((m as any).api_remark ?? ''),
        modelName: String((m as any).model_name ?? ''),
      })) as ApiHistoryMetric[]);
    } catch (e: any) {
      addToast('error', `加载失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  function updateNode(index: number, field: keyof ApiNode, value: ApiNode[keyof ApiNode]) {
    const next = [...nodes];
    next[index] = { ...next[index], [field]: value } as ApiNode;
    set({ ...state, nodes: next });
  }

  function updateImageNode(index: number, field: keyof ImageApiNode, value: ImageApiNode[keyof ImageApiNode]) {
    const next = [...imageNodes];
    next[index] = normalizeImageApiNode({ ...next[index], [field]: value } as ImageApiNode);
    setImageState({ ...imageState, nodes: next });
  }

  function updateImageApiTimeoutSeconds(seconds: number) {
    const normalizedSeconds = Math.max(1, Math.floor(Number(seconds) || 0));
    setRuntimeConfig((current) => ({
      ...(current ?? ({} as RuntimeConfig)),
      imageApiTimeoutMs: normalizedSeconds * 1000,
    } as RuntimeConfig));
  }

  function updateImageNodeProvider(index: number, providerType: ImageApiProviderType) {
    const source = imageNodes[index];
    if (!source) return;
    const previousProvider = normalizeImageProviderType(source.providerType);
    const sourceEditWasDefault = !source.editUrl || source.editUrl === getDefaultImageEditUrl(previousProvider);
    const modelName = !source.modelName || source.modelName === getDefaultImageModel(previousProvider) ? getDefaultImageModel(providerType) : source.modelName;
    const supportsEdit = getDefaultImageSupportsEdit(providerType);
    const next = [...imageNodes];
    next[index] = normalizeImageApiNode({
      ...source,
      providerType,
      modelName,
      generationUrl: !source.generationUrl || source.generationUrl === getDefaultImageGenerationUrl(previousProvider) ? getDefaultImageGenerationUrl(providerType) : source.generationUrl,
      editUrl: supportsEdit ? (sourceEditWasDefault ? getDefaultImageEditUrl(providerType) : source.editUrl) : (sourceEditWasDefault ? '' : source.editUrl),
      supportsEdit,
    });
    setImageState({ ...imageState, nodes: next });
  }

  function applyDefaultUrlSuffix(index: number) {
    const node = nodes[index];
    if (!node) return;
    const nextUrl = appendDefaultSuffix(node.apiUrl, node.aiType, node.modelName);
    if (nextUrl === node.apiUrl) {
      if (/[?#]/.test(String(node.apiUrl || ''))) addToast('warning', '当前 URL 含查询参数或锚点，默认后缀请手动补在路径位置。');
      else addToast('warning', '当前 URL 已包含这类接口的常见默认后缀，没有重复追加。');
      return;
    }
    updateNode(index, 'apiUrl', nextUrl);
    addToast('success', '已追加常见默认后缀。这里只是辅助填充，不会锁死你的自定义 URL。');
  }

  function applyImageGenerationUrlSuffix(index: number) {
    const node = imageNodes[index];
    if (!node) return;
    const nextUrl = appendXaiImageGenerationSuffix(node.generationUrl || '');
    if (nextUrl === (node.generationUrl || '')) {
      if (/[?#]/.test(String(node.generationUrl || ''))) addToast('warning', '当前 URL 含查询参数或锚点，图像生成后缀请手动补在路径位置。');
      else addToast('warning', '当前 URL 已包含图像生成接口的常见默认后缀，没有重复追加。');
      return;
    }
    updateImageNode(index, 'generationUrl', nextUrl);
    addToast('success', '已追加图像生成接口默认后缀。这里只是辅助填充，不会锁死你的自定义 URL。');
  }

  function applyImageEditUrlSuffix(index: number) {
    const node = imageNodes[index];
    if (!node) return;
    if (!imageNodeSupportsEdit(node)) {
      addToast('warning', '当前图像节点仅支持生图，不需要配置修图 URL。');
      return;
    }
    const nextUrl = appendXaiImageEditSuffix(node.editUrl || '');
    if (nextUrl === (node.editUrl || '')) {
      if (/[?#]/.test(String(node.editUrl || ''))) addToast('warning', '当前 URL 含查询参数或锚点，图像编辑后缀请手动补在路径位置。');
      else addToast('warning', '当前 URL 已包含图像编辑接口的常见默认后缀，没有重复追加。');
      return;
    }
    updateImageNode(index, 'editUrl', nextUrl);
    addToast('success', '已追加图像编辑接口默认后缀。这里只是辅助填充，不会锁死你的自定义 URL。');
  }

  function removeNode(index: number) {
    const next = nodes.filter((_, i) => i !== index);
    set({ ...state, nodes: next, activeIndex: Math.min(activeIndex, Math.max(0, next.length - 1)) });
  }

  function cloneNode(index: number) {
    const next = [...nodes];
    next.splice(index + 1, 0, { ...nodes[index], remark: `${nodes[index].remark} (副本)` });
    set({ ...state, nodes: next });
  }

  function insertAfter(index: number) {
    const next = [...nodes];
    next.splice(index + 1, 0, normalizeApiNode({ remark: '新节点', aiType: 'openai' }));
    set({ ...state, nodes: next });
  }

  function deleteBulk() {
    const next = nodes.filter((_, i) => !selected.has(i));
    set({ ...state, nodes: next, activeIndex: Math.min(activeIndex, Math.max(0, next.length - 1)) });
    setSelected(new Set());
    setConfirmBulkDelete(false);
    addToast('success', `已删除 ${selected.size} 个节点`);
  }

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = Number(active.id);
    const newIndex = Number(over.id);
    const reordered = arrayMove(nodes, oldIndex, newIndex);

    const remapIndex = (idx: number) => {
      if (idx === oldIndex) return newIndex;
      if (oldIndex < idx && idx <= newIndex) return idx - 1;
      if (newIndex <= idx && idx < oldIndex) return idx + 1;
      return idx;
    };

    const remappedSelected = new Set<number>();
    selected.forEach((idx) => remappedSelected.add(remapIndex(idx)));
    setSelected(remappedSelected);

    const remappedShowKey = new Set<number>();
    showKey.forEach((idx) => remappedShowKey.add(remapIndex(idx)));
    setShowKey(remappedShowKey);

    const remappedExpanded = new Set<number>();
    expandedCards.forEach((idx) => remappedExpanded.add(remapIndex(idx)));
    setExpandedCards(remappedExpanded);

    const remappedPing = new Map<number, PingResult>();
    pingResults.forEach((result, idx) => {
      remappedPing.set(remapIndex(idx), { ...result, index: remapIndex(idx) });
    });
    setPingResults(remappedPing);

    let newActive = activeIndex;
    if (activeIndex === oldIndex) newActive = newIndex;
    else if (oldIndex < activeIndex && newIndex >= activeIndex) newActive = activeIndex - 1;
    else if (oldIndex > activeIndex && newIndex <= activeIndex) newActive = activeIndex + 1;
    set({ nodes: reordered, activeIndex: newActive });
  }, [nodes, activeIndex, selected, showKey, pingResults, expandedCards, set]);

  async function testNode(index: number) {
    const node = nodes[index];
    if (!node.apiUrl || !node.apiKey || !node.modelName) {
      addToast('warning', '请先填写完整的 URL、Key 和模型名');
      return;
    }
    setPinging((p) => new Set(p).add(index));
    try {
      const result = await pingApi(node.apiUrl, node.apiKey, node.modelName, node.aiType, node.xaiWebSearchEnabled === true);
      setPingResults((m) => new Map(m).set(index, { ...result, index }));
    } catch (e: any) {
      setPingResults((m) => new Map(m).set(index, { index, pass: false, latency_ms: 0, status: 0, error: String(e) }));
    } finally {
      setPinging((p) => { const n = new Set(p); n.delete(index); return n; });
    }
  }

  async function testAll() {
    if (nodes.length === 0) return;

    const payload = nodes.map((n, i) => ({
      index: i, api_url: n.apiUrl, api_key: n.apiKey, model_name: n.modelName, ai_type: n.aiType, xai_web_search_enabled: n.xaiWebSearchEnabled === true,
    }));

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setBatchPinging(true);
    setBatchSessionId(sessionId);
    setBatchProgress({ done: 0, total: payload.length });
    setPingResults(new Map());

    try {
      await batchPingApisStream(sessionId, payload);
    } catch {
      try {
        const results = await batchPingApis(payload);
        const map = new Map<number, PingResult>();
        results.forEach((r) => map.set(r.index, r));
        setPingResults(map);
        const passed = results.filter((r) => r.pass).length;
        addToast('success', `批量测试完成：${passed}/${results.length} 个节点可用。可以优先看风险节点，再决定默认节点要不要换。`);
      } catch (e: any) {
        addToast('error', `批量测试失败: ${e?.message ?? e}`);
      } finally {
        setBatchPinging(false);
        setBatchSessionId(null);
        setBatchProgress({ done: 0, total: 0 });
      }
    }
  }

  async function save() {
    if (!dirty) return;
    try {
      await saveConfig('api', nodes);
      const rt = runtimeConfig ?? await getConfig<RuntimeConfig>('runtime');
      const nextLiveWeight = Math.max(0, Math.min(100, weightLive));
      const nextTimeoutWeight = Math.max(0, Math.min(100, weightTimeout));
      const nextJitterWeight = Math.max(0, Math.min(100, weightJitter));
      const nextHistoryWeight = Math.max(0, 100 - nextLiveWeight - nextTimeoutWeight - nextJitterWeight);
      if (rt) {
        const updatedRuntime = {
          ...rt,
          activeApiIndex: activeIndex,
        };
        await saveConfig('runtime', updatedRuntime);
        setRuntimeConfig(updatedRuntime);
      }
      await saveApiHealthWeights({
        liveWeight: nextLiveWeight,
        historyWeight: nextHistoryWeight,
        timeoutWeight: nextTimeoutWeight,
        jitterWeight: nextJitterWeight,
      });
      setOriginal(JSON.stringify(state));
      setOriginalWeights(JSON.stringify({
        liveWeight: nextLiveWeight,
        historyWeight: nextHistoryWeight,
        timeoutWeight: nextTimeoutWeight,
        jitterWeight: nextJitterWeight,
      }));
      addToast('success', 'API 配置已保存');
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message ?? e}`);
    }
  }

  function exportApiConfig() {
    downloadJsonWithTimestamp(nodes, 'api_config.json');
    addToast('success', '已导出 API 配置');
  }

  async function importApiConfig() {
    try {
      const picked = await pickJsonAndParse();
      if (!picked) return;
      if (!Array.isArray(picked.data)) {
        addToast('error', '导入失败：JSON 必须是数组');
        return;
      }

      const imported = picked.data as Array<Partial<ApiNode>>;
      const normalized: ApiNode[] = imported.map((item) => normalizeApiNode(item));

      const next: NodeState = { nodes: normalized, activeIndex: Math.max(0, Math.min(activeIndex, Math.max(0, normalized.length - 1))) };
      set(next);
      setSelected(new Set());
      setPingResults(new Map());
      setShowKey(new Set());
      setExpandedCards(new Set());
      addToast('success', `已导入 ${normalized.length} 个 API 节点（请点击保存生效）`);
    } catch (e: any) {
      addToast('error', `导入失败: ${e?.message ?? e}`);
    }
  }

  async function saveImageApis() {
    if (!imageConfigDirty) return;
    try {
      if (imageDirty) await saveConfig('imageApi', imageNodes);
      const rt = await getConfig<RuntimeConfig>('runtime');
      if (rt) {
        const updatedRuntime = {
          ...rt,
          activeImageApiIndex: activeImageIndex,
          imageApiTimeoutMs: getRuntimeImageApiTimeoutMs(runtimeConfig ?? rt),
        };
        await saveConfig('runtime', updatedRuntime);
        setRuntimeConfig(updatedRuntime);
      }
      setImageOriginal(JSON.stringify(imageState));
      setImageRuntimeOriginal(JSON.stringify({ imageApiTimeoutMs: getRuntimeImageApiTimeoutMs(runtimeConfig ?? rt) }));
      addToast('success', '图像 API 配置已保存');
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message ?? e}`);
    }
  }

  function exportImageApiConfig() {
    downloadJsonWithTimestamp(imageNodes, 'image_api_config.json');
    addToast('success', '已导出图像 API 配置');
  }

  function exportImageApiTemplate() {
    const template = [
      normalizeImageApiNode({
        providerType: 'xai',
        generationUrl: 'https://api.x.ai/v1/images/generations',
        editUrl: 'https://api.x.ai/v1/images/edits',
        apiKey: 'xai-your-key',
        modelName: 'grok-imagine-image',
        remark: 'xAI 官方图像模板',
        aspectRatio: '',
        resolution: '',
        supportsEdit: true,
      }),
      normalizeImageApiNode({
        providerType: 'openai',
        generationUrl: 'https://api.openai.com/v1/images/generations',
        editUrl: 'https://api.openai.com/v1/images/edits',
        apiKey: 'sk-your-openai-key',
        modelName: 'gpt-image-2',
        remark: 'OpenAI 图像模板',
        aspectRatio: '',
        resolution: '',
        supportsEdit: true,
      }),
    ];
    downloadJsonWithTimestamp(template, 'image_api_config.template.json');
    addToast('success', '已导出图像节点模板');
  }

  async function importImageApiConfig() {
    try {
      const picked = await pickJsonAndParse();
      if (!picked) return;
      if (!Array.isArray(picked.data)) {
        addToast('error', '导入失败：JSON 必须是数组');
        return;
      }

      const imported = picked.data as Array<Partial<ImageApiNode>>;
      const normalized = imported.map((item) => normalizeImageApiNode(item));
      setImageState({ nodes: normalized, activeIndex: Math.max(0, Math.min(activeImageIndex, Math.max(0, normalized.length - 1))) });
      addToast('success', `已导入 ${normalized.length} 个图像 API 节点（请点击保存生效）`);
    } catch (e: any) {
      addToast('error', `导入失败: ${e?.message ?? e}`);
    }
  }

  function scrollToNode(index: number) {
    cardRefs.current.get(index)?.scrollIntoView({ behavior: 'auto', block: 'center' });
  }

  function scrollToImageNode(index: number) {
    imageCardRefs.current.get(index)?.scrollIntoView({ behavior: 'auto', block: 'center' });
  }

  function toggleExpanded(index: number) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAllApiKeyExpanded() {
    setExpandedCards((prev) => {
      if (nodes.length === 0) return prev;
      if (nodes.every((_, index) => prev.has(index))) {
        return new Set();
      }
      return new Set(nodes.map((_, index) => index));
    });
  }

  function addImageNode(providerType: ImageApiProviderType = 'openai') {
    const supportsEdit = getDefaultImageSupportsEdit(providerType);
    setImageState({
      ...imageState,
      nodes: [...imageNodes, normalizeImageApiNode({
        providerType,
        generationUrl: getDefaultImageGenerationUrl(providerType),
        editUrl: supportsEdit ? getDefaultImageEditUrl(providerType) : '',
        remark: '',
        modelName: getDefaultImageModel(providerType),
        supportsEdit,
      })],
    });
  }

  function cloneImageNode(index: number) {
    const source = imageNodes[index];
    if (!source) return;
    const next = [...imageNodes];
    next.splice(index + 1, 0, normalizeImageApiNode({ ...source, remark: `${source.remark || source.modelName} (副本)` }));
    setImageState({ ...imageState, nodes: next });
  }

  function removeImageNode(index: number) {
    const next = imageNodes.filter((_, i) => i !== index);
    setImageState({ nodes: next, activeIndex: Math.min(activeImageIndex, Math.max(0, next.length - 1)) });
  }

  const filteredImageIndices = useMemo(() => {
    if (!deferredImageSearch.trim()) return imageNodes.map((_, i) => i);
    const q = deferredImageSearch.toLowerCase();
    return imageNodes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) =>
        n.modelName.toLowerCase().includes(q) ||
        n.remark.toLowerCase().includes(q) ||
        n.providerType.toLowerCase().includes(q) ||
        n.generationUrl.toLowerCase().includes(q) ||
        n.editUrl.toLowerCase().includes(q) ||
        getImageCapabilityLabel(n).toLowerCase().includes(q)
      )
      .map(({ i }) => i);
  }, [imageNodes, deferredImageSearch]);

  const duplicates = useMemo(() => {
    const seen = new Map<string, number[]>();
    nodes.forEach((n, i) => {
      const key = `${n.apiUrl}|${n.modelName}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(i);
    });
    const dupes = new Set<number>();
    seen.forEach((indices) => { if (indices.length > 1) indices.forEach((i) => dupes.add(i)); });
    return dupes;
  }, [nodes]);

  const filteredIndices = useMemo(() => {
    if (!deferredSearch.trim()) return nodes.map((_, i) => i);
    const q = deferredSearch.toLowerCase();
    return nodes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) =>
        n.modelName.toLowerCase().includes(q) ||
        n.remark.toLowerCase().includes(q) ||
        n.aiType.toLowerCase().includes(q) ||
        formatAiTypeLabel(n.aiType).toLowerCase().includes(q)
      )
      .map(({ i }) => i);
  }, [nodes, deferredSearch]);

  const nodeHealthMap = useMemo(() => {
    const map = new Map<number, NodeHealth>();
    const liveWeight = Math.max(0, Math.min(100, weightLive));
    const timeoutWeight = Math.max(0, Math.min(100, weightTimeout));
    const jitterWeight = Math.max(0, Math.min(100, weightJitter));
    const nextHistoryWeight = Math.max(0, 100 - liveWeight - timeoutWeight - jitterWeight);

    const pickHistory = (node: ApiNode) => {
      const remark = normalizeRemark(node.remark);
      const model = normalizeModel(node.modelName);
      const exact = historyMetrics.find((m) => normalizeRemark(m.apiRemark) === remark && normalizeModel(m.modelName) === model);
      if (exact) return exact;
      return historyMetrics.find((m) => normalizeModel(m.modelName) === model);
    };

    nodes.forEach((node, i) => {
      const live = pingResults.get(i);
      const history = pickHistory(node);

      let liveScore: number | null = null;
      let liveReason = '';
      if (live) {
        const base = live.pass ? 80 : 30;
        const latencyPenalty = Math.min(35, Math.floor((live.latency_ms ?? 0) / 80));
        liveScore = clampScore(base - latencyPenalty);
        liveReason = live.pass
          ? (live.latency_ms > 1200 ? '实时测试延迟偏高' : '实时测试通过')
          : '实时测试失败';
      }

      let historyScore: number | null = null;
      let timeoutScore: number | null = null;
      let jitterScore: number | null = null;
      let historyReason = '';
      if (history && history.total > 0) {
        const reliability = (1 - Math.max(0, Math.min(1, history.error_rate))) * 70;
        const rt = history.avg_response_time_ms || 0;
        const speed = Math.max(0, 30 - Math.min(30, rt / 100));
        historyScore = clampScore(reliability + speed);

        const timeoutRate = Math.max(0, Math.min(1, history.timeout_rate ?? 0));
        timeoutScore = clampScore(100 - timeoutRate * 100);

        const jitter = Math.max(0, history.jitter_ms ?? 0);
        jitterScore = clampScore(100 - Math.min(100, jitter / 20));

        if (history.total < 3) historyReason = '历史样本较少，分数仅供参考';
        else if ((history.timeout_rate ?? 0) >= 0.2) historyReason = '历史超时率较高';
        else if (history.error_rate >= 0.35) historyReason = '历史错误率较高';
        else if (jitter >= 1200) historyReason = '历史响应抖动较高';
        else if (rt >= 2000) historyReason = '历史平均响应时间较高';
        else historyReason = '历史表现稳定';
      }

      const availableParts: Array<{ score: number; weight: number }> = [];
      if (liveScore !== null && liveWeight > 0) availableParts.push({ score: liveScore, weight: liveWeight });
      if (historyScore !== null && nextHistoryWeight > 0) availableParts.push({ score: historyScore, weight: nextHistoryWeight });
      if (timeoutScore !== null && timeoutWeight > 0) availableParts.push({ score: timeoutScore, weight: timeoutWeight });
      if (jitterScore !== null && jitterWeight > 0) availableParts.push({ score: jitterScore, weight: jitterWeight });

      let score = 0;
      let source: NodeHealth['source'] = 'none';
      let reason = '无可用数据';
      if (availableParts.length > 0) {
        const totalAvailableWeight = availableParts.reduce((sum, item) => sum + item.weight, 0);
        const normalizedScore = totalAvailableWeight > 0
          ? availableParts.reduce((sum, item) => sum + item.score * (item.weight / totalAvailableWeight), 0)
          : 0;
        score = clampScore(normalizedScore);
        if (liveScore !== null && (historyScore !== null || timeoutScore !== null || jitterScore !== null)) source = 'mixed';
        else if (liveScore !== null) source = 'live';
        else source = 'history';
        reason = liveReason && historyReason ? `${liveReason} / ${historyReason}` : (liveReason || historyReason || reason);
      }

      map.set(i, {
        score,
        level: pickLevel(score),
        source,
        reason,
        liveScore,
        historyScore,
        timeoutScore,
        jitterScore,
        liveWeight,
        historyWeight: nextHistoryWeight,
        timeoutWeight,
        jitterWeight,
      });
    });

    return map;
  }, [nodes, pingResults, historyMetrics, weightLive, weightTimeout, weightJitter]);

  const displayedIndices = useMemo(() => {
    let arr = [...filteredIndices];

    if (healthFilter !== 'all') {
      arr = arr.filter((i) => (nodeHealthMap.get(i)?.level ?? 'risk') === healthFilter);
    }

    if (healthSourceFilter !== 'all') {
      arr = arr.filter((i) => (nodeHealthMap.get(i)?.source ?? 'none') === healthSourceFilter);
    }

    if (healthSort !== 'none') {
      arr.sort((a, b) => {
        const sa = nodeHealthMap.get(a)?.score ?? 0;
        const sb = nodeHealthMap.get(b)?.score ?? 0;
        return healthSort === 'desc' ? sb - sa : sa - sb;
      });
    }

    return arr;
  }, [filteredIndices, healthFilter, healthSourceFilter, healthSort, nodeHealthMap]);

  const visibleNodeIndices = useMemo(() => {
    if (!focusActiveNodeOnly) return displayedIndices;
    if (!nodes[activeIndex]) return [];
    return displayedIndices.includes(activeIndex) ? [activeIndex] : [];
  }, [focusActiveNodeOnly, displayedIndices, nodes, activeIndex]);

  const activeDirectoryFilters = useMemo(() => {
    const items: string[] = [];
    if (search.trim()) items.push(`搜索：${search.trim()}`);
    if (healthSort !== 'none') items.push(`排序：${healthSort === 'desc' ? '健康分高到低' : '健康分低到高'}`);
    if (healthFilter !== 'all') items.push(`等级：${healthFilter === 'healthy' ? '健康' : healthFilter === 'warning' ? '警告' : '风险'}`);
    if (healthSourceFilter !== 'all') items.push(`来源：${getHealthSourceLabel(healthSourceFilter)}`);
    if (focusActiveNodeOnly) items.push('右侧：仅活跃节点');
    return items;
  }, [search, healthSort, healthFilter, healthSourceFilter, focusActiveNodeOnly]);

  const grouped = useMemo(() => {
    const groups = new Map<string, number[]>();
    displayedIndices.forEach((i) => {
      const remark = nodes[i].remark || '未分类';
      const provider = remark.split(/[-_/\\|]/).map((s) => s.trim())[0] || '未分类';
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider)!.push(i);
    });
    return groups;
  }, [displayedIndices, nodes]);

  const directoryItems = useMemo<DirectoryListItem[]>(() => {
    const items: DirectoryListItem[] = [];
    Array.from(grouped.entries()).forEach(([provider, indices]) => {
      items.push({ kind: 'group', key: `group:${provider}`, provider, count: indices.length });
      indices.forEach((index) => {
        items.push({ kind: 'node', key: `node:${index}`, index });
      });
    });
    return items;
  }, [grouped]);

  const summary = useMemo(() => {
    const healthy = nodes.filter((_, i) => nodeHealthMap.get(i)?.level === 'healthy').length;
    const warning = nodes.filter((_, i) => nodeHealthMap.get(i)?.level === 'warning').length;
    const risk = nodes.filter((_, i) => nodeHealthMap.get(i)?.level === 'risk').length;
    return {
      healthy,
      warning,
      risk,
      activeNode: nodes[activeIndex]?.modelName || `#${activeIndex}`,
      tested: pingResults.size,
    };
  }, [nodes, nodeHealthMap, activeIndex, pingResults]);

  const sourceSummary = useMemo(() => ({
    live: nodes.filter((_, i) => nodeHealthMap.get(i)?.source === 'live').length,
    history: nodes.filter((_, i) => nodeHealthMap.get(i)?.source === 'history').length,
    mixed: nodes.filter((_, i) => nodeHealthMap.get(i)?.source === 'mixed').length,
    none: nodes.filter((_, i) => (nodeHealthMap.get(i)?.source ?? 'none') === 'none').length,
  }), [nodes, nodeHealthMap]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function resetDirectoryFilters() {
    setSearch('');
    setHealthSort('none');
    setHealthFilter('all');
    setHealthSourceFilter('all');
  }

  useEffect(() => {
    if (!pageJumpRequest || pageJumpRequest.page !== 'api' || pageJumpRequest.kind !== 'api-node' || loading) return;

    const resolveIndex = () => {
      const targetRemark = normalizeRemark(pageJumpRequest.nodeRemark);
      const targetModel = normalizeModel(pageJumpRequest.modelName);
      const list = pageJumpRequest.category === 'image' ? imageNodes : nodes;
      if (list.length === 0) return -1;
      const exact = list.findIndex((node) =>
        (!targetRemark || normalizeRemark(node.remark) === targetRemark)
        && (!targetModel || normalizeModel(node.modelName) === targetModel));
      if (exact >= 0) return exact;
      const byRemark = targetRemark ? list.findIndex((node) => normalizeRemark(node.remark) === targetRemark) : -1;
      if (byRemark >= 0) return byRemark;
      const byModel = targetModel ? list.findIndex((node) => normalizeModel(node.modelName) === targetModel) : -1;
      return byModel;
    };

    const targetIndex = resolveIndex();
    if (targetIndex < 0) {
      addToast('warning', `没有找到可跳转的${pageJumpRequest.category === 'image' ? '图像' : '聊天'}节点，可能该节点已被删除或重命名`);
      clearPageJumpRequest();
      return;
    }

    if (pageJumpRequest.category === 'image') {
      setManagerMode('image');
      setImageSearch('');
      setTimeout(() => scrollToImageNode(targetIndex), 80);
    } else {
      setManagerMode('chat');
      resetDirectoryFilters();
      setTimeout(() => scrollToNode(targetIndex), 80);
    }

    clearPageJumpRequest();
  }, [pageJumpRequest, loading, nodes, imageNodes, addToast, clearPageJumpRequest]);

  const modeSwitcher = (
    <Panel
      title="节点分组"
      subtitle="聊天节点与图像节点现在分别保存在不同配置文件里，互不混用。"
      padding="sm"
    >
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setManagerMode('chat')}
          className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border cursor-pointer ${managerMode === 'chat' ? 'border-transparent bg-[var(--accent-purple)] text-white' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          聊天节点列表
        </button>
        <button
          onClick={() => setManagerMode('image')}
          className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border cursor-pointer ${managerMode === 'image' ? 'border-transparent bg-[var(--accent-purple)] text-white' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          图像节点列表
        </button>
      </div>
    </Panel>
  );

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

  if (managerMode === 'image') {
    return (
      <div className={`flex flex-col h-full ${density.pageGap}`}>
        {modeSwitcher}
        <ImageApiManagerPanel
          density={settings.contentDensity}
          nodes={imageNodes}
          activeIndex={activeImageIndex}
          imageApiTimeoutMs={getRuntimeImageApiTimeoutMs(runtimeConfig)}
          search={imageSearch}
          dirty={imageConfigDirty}
          canUndo={canUndoImage}
          canRedo={canRedoImage}
          onSearchChange={setImageSearch}
          onUndo={undoImage}
          onRedo={redoImage}
          onSave={saveImageApis}
          onExport={exportImageApiConfig}
          onExportTemplate={exportImageApiTemplate}
          onImport={importImageApiConfig}
          onAdd={addImageNode}
          onClone={cloneImageNode}
          onRemove={removeImageNode}
          onSetActive={(index) => setImageState({ ...imageState, activeIndex: index })}
          onImageApiTimeoutSecondsChange={updateImageApiTimeoutSeconds}
          onUpdate={updateImageNode}
          onChangeProvider={updateImageNodeProvider}
          onApplyGenerationSuffix={applyImageGenerationUrlSuffix}
          onApplyEditSuffix={applyImageEditUrlSuffix}
          filteredIndices={filteredImageIndices}
          cardRef={(index, el) => {
            if (el) imageCardRefs.current.set(index, el);
            else imageCardRefs.current.delete(index);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col min-h-full ${density.pageGap}`}>
      {modeSwitcher}
      <div className={`grid grid-cols-2 xl:grid-cols-5 ${density.summaryGrid}`}>
        <SummaryCard label="节点总数" value={String(nodes.length)} hint="这是你当前可以切换和测试的 API 节点总数。" />
        <SummaryCard label="活跃节点" value={summary.activeNode} hint={`机器人默认会从 #${activeIndex} 这个节点开始用。`} />
        <SummaryCard label="健康 / 警告 / 风险" value={`${summary.healthy} / ${summary.warning} / ${summary.risk}`} hint="这是 GUI 按测试结果和历史表现给出的参考分组，不是插件硬限制。" />
        <SummaryCard label="批量测试" value={batchPinging ? `${batchProgress.done}/${batchProgress.total || nodes.length}` : `${summary.tested} 个结果`} hint={batchPinging ? '正在逐个测试节点可不可用。' : '这里显示的是本次会话里已经拿到的测试结果。'} />
        <SummaryCard label="保存状态" value={dirty ? '待保存' : '已同步'} hint={dirty ? '你已经改了节点列表或默认节点，但还没真正写回文件。' : '当前编辑内容已经和文件一致。'} tone={dirty ? 'warning' : 'neutral'} />
      </div>

      <Panel title="操作区" subtitle="常规顺序通常是：新增或修改节点 -> 测试可用性 -> 确认默认节点 -> 最后保存。节点健康明细默认收起，可在这里统一展开。" padding="sm">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={save} disabled={!dirty}
            className={`px-4 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${dirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
            title="Ctrl+S">
            💾 保存
          </button>
          <button onClick={() => set({ ...state, nodes: [...nodes, normalizeApiNode({ aiType: 'openai' })] })}
            className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--accent-purple)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer">
            + 新增节点
          </button>
          <button onClick={testAll} disabled={batchPinging}
            className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
            {batchPinging ? `⏳ 正在逐个测试 (${batchProgress.done}/${batchProgress.total || nodes.length})` : '🔍 测试全部节点'}
          </button>
          <button
            onClick={toggleAllApiKeyExpanded}
            disabled={nodes.length === 0}
            className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] transition-colors ${nodes.length === 0 ? 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed opacity-60' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer'}`}
          >
            {allApiKeyExpanded ? '收起全部 Key 区域' : '展开全部 Key 区域'}
          </button>
          <button
            onClick={() => setShowNodeHealthPanels((v) => !v)}
            disabled={nodes.length === 0}
            className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] transition-colors ${nodes.length === 0 ? 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed opacity-60' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer'}`}
          >
            {showNodeHealthPanels ? '收起节点健康栏' : '展开节点健康栏'}
          </button>
          <button
            onClick={() => setFocusActiveNodeOnly((v) => !v)}
            disabled={nodes.length === 0}
            className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] transition-colors ${nodes.length === 0 ? 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed opacity-60' : focusActiveNodeOnly ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] cursor-pointer' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer'}`}
            title="开启后右侧只完整渲染当前活跃节点，适合弱机环境下聚焦编辑"
          >
            {focusActiveNodeOnly ? '退出聚焦编辑' : '聚焦编辑活跃节点'}
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button onClick={undo} disabled={!canUndo}
              className={`px-2.5 py-2 text-xs rounded-[var(--radius-sm)] cursor-pointer transition-colors ${canUndo ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]' : 'text-[var(--text-muted)] cursor-not-allowed opacity-40'}`}
              title="Ctrl+Z">↩ 撤销</button>
            <button onClick={redo} disabled={!canRedo}
              className={`px-2.5 py-2 text-xs rounded-[var(--radius-sm)] cursor-pointer transition-colors ${canRedo ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]' : 'text-[var(--text-muted)] cursor-not-allowed opacity-40'}`}
              title="Ctrl+Y">↪ 重做</button>
            <button
              onClick={() => setShowAdvancedToolbar((v) => !v)}
              className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border cursor-pointer ${showAdvancedToolbar ? 'border-transparent bg-[var(--accent-purple)] text-white' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              {showAdvancedToolbar ? '收起更多操作' : '展开更多操作'}
            </button>
          </div>
        </div>

        {dirty && (
          <p className="mt-2 text-xs text-[var(--warning)]">当前有未保存改动。只有点保存之后，节点列表和默认节点设置才会真正写回文件。</p>
        )}

        {showAdvancedToolbar && (
          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)]">更多操作</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ImportExportActions
                  onExport={exportApiConfig}
                  onImport={importApiConfig}
                  confirmTitle="导入 API 配置"
                  size="xs"
                />
                <button onClick={() => {
                  const next = !showAllKeys;
                  setShowAllKeys(next);
                  setShowKey(next ? new Set(nodes.map((_, i) => i)) : new Set());
                }}
                  className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer">
                  {showAllKeys ? '🙈 隐藏全部 Key' : '👁 显示全部 Key'}
                </button>
                <div className="flex items-center gap-2 text-xs">
                  <label className="text-[var(--text-muted)]">活跃节点</label>
                  <input
                    type="number"
                    value={activeIndex}
                    onChange={(e) => set({ ...state, activeIndex: Math.max(0, Math.min(nodes.length - 1, Number(e.target.value))) })}
                    min={0}
                    max={Math.max(0, nodes.length - 1)}
                    className="w-18 px-2 py-1.5 text-xs mono rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none"
                  />
                </div>
                {selected.size > 0 && (
                  <>
                    <span className="text-xs text-[var(--text-muted)]">选中 {selected.size} 项</span>
                    <button onClick={() => setConfirmBulkDelete(true)}
                      className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,82,82,0.15)] text-[var(--error)] hover:bg-[rgba(255,82,82,0.25)] transition-colors cursor-pointer">
                      批量删除
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)]">评分权重</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">这些权重只影响 GUI 里“健康分怎么看”，不会改插件本身的运行行为，也不会写回 `runtime_config.json`。</p>
              </div>
              <WeightSlider label="实时" value={weightLive} onChange={setWeightLive} />
              <WeightSlider label="超时" value={weightTimeout} onChange={setWeightTimeout} />
              <WeightSlider label="抖动" value={weightJitter} onChange={setWeightJitter} />
              <div className="text-[11px] text-[var(--text-muted)] mono">历史 自动补足为 {historyWeight}%</div>
            </div>
          </div>
        )}
      </Panel>

      <div className="rounded-[var(--radius-sm)] border border-[rgba(255,82,82,0.35)] bg-[rgba(255,82,82,0.08)] px-3 py-2">
        <p className="text-[11px] text-[var(--error)] leading-relaxed">
          这里最敏感的是 <span className="mono">api_config.json</span>。如果你只是想分享界面截图、差异结果或快照摘要，不一定要把这个文件一起带出去。
          一旦把 API Key 发错人，通常就只能去原平台删掉或更换密钥。
        </p>
      </div>

      <div className={`flex items-start ${density.pageGap}`}>
      <div className="w-64 flex-shrink-0 sticky top-0 self-start z-[2]">
        <Panel title="节点目录" subtitle="这个目录会像悬浮导航一样跟随页面滚动，滚到很下面时也能直接点回来。" padding="sm">
          <div className={density.sectionGap}>
            <SearchBar value={search} onChange={setSearch} placeholder="搜索模型 / 备注 / 类型..." />

            <div className="grid grid-cols-2 gap-2">
              <select
                value={healthSort}
                onChange={(e) => setHealthSort(e.target.value as 'none' | 'desc' | 'asc')}
                className="px-2 py-2 text-[11px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                title="按健康分排序"
              >
                <option value="none">排序：默认</option>
                <option value="desc">健康分高到低</option>
                <option value="asc">健康分低到高</option>
              </select>
              <select
                value={healthFilter}
                onChange={(e) => setHealthFilter(e.target.value as 'all' | 'healthy' | 'warning' | 'risk')}
                className="px-2 py-2 text-[11px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                title="按健康等级筛选"
              >
                <option value="all">等级：全部</option>
                <option value="healthy">健康</option>
                <option value="warning">警告</option>
                <option value="risk">风险</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={healthSourceFilter}
                onChange={(e) => setHealthSourceFilter(e.target.value as 'all' | 'live' | 'history' | 'mixed' | 'none')}
                className="px-2 py-2 text-[11px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                title="按健康分来源筛选"
              >
                <option value="all">来源：全部</option>
                <option value="live">仅实时</option>
                <option value="history">仅历史</option>
                <option value="mixed">仅混合</option>
                <option value="none">仅无数据</option>
              </select>
              <button
                onClick={resetDirectoryFilters}
                disabled={activeDirectoryFilters.length === 0}
                className={`px-2 py-2 text-[11px] rounded-[var(--radius-sm)] border transition-colors ${activeDirectoryFilters.length > 0 ? 'bg-[var(--surface-card)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-muted)] cursor-not-allowed opacity-60'}`}
                title="清空目录筛选"
              >
                清空筛选
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
                <p className="text-[10px] text-[var(--text-muted)]">目录 / 右侧</p>
                <p className="text-sm font-medium text-[var(--text-primary)]">{displayedIndices.length}/{visibleNodeIndices.length}</p>
              </div>
              <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
                <p className="text-[10px] text-[var(--text-muted)]">风险节点</p>
                <p className="text-sm font-medium text-[var(--error)]">{summary.risk}</p>
              </div>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
              <p className="text-[10px] text-[var(--text-muted)]">评分权重</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1 mono break-all">
                实时 / 历史 / 超时 / 抖动 = {weightLive} / {historyWeight} / {weightTimeout} / {weightJitter}
              </p>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
              <p className="text-[10px] text-[var(--text-muted)]">来源概览</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1">实时 {sourceSummary.live} · 历史 {sourceSummary.history} · 混合 {sourceSummary.mixed} · 无数据 {sourceSummary.none}</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1 leading-relaxed">实时表示本窗口刚测过，历史表示沿用历史统计，混合表示两边都参与了评分。</p>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
              <p className="text-[10px] text-[var(--text-muted)]">分数怎么看</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'rgba(14,165,233,0.12)', color: 'var(--info)' }}>实时 82分</span>
                <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'rgba(251,191,36,0.14)', color: 'var(--warning)' }}>历史 61分</span>
                <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'rgba(168,85,247,0.14)', color: 'var(--accent-purple)' }}>混合 88分</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--surface-card)] text-[var(--text-muted)]">无数据</span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-2 leading-relaxed">这样刷新回来时不会只看到 20、40 这类裸数字。目录、卡片和详情里的健康分都统一带上来源与“分”字。</p>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2">
              {activeDirectoryFilters.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {activeDirectoryFilters.map((item) => (
                    <span key={item} className="px-2 py-1 text-[10px] rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">当前目录未额外筛选，显示的是全部聊天节点。这里的筛选条件会自动记住，刷新后还能延续。</p>
              )}
            </div>
          </div>

          <VirtualList
            items={directoryItems}
            itemHeight={48}
            overscan={10}
            containerStyle={{ height: 'calc(100vh - 320px)', marginTop: 16, padding: 4 }}
            containerClassName="max-h-[calc(100vh-320px)]"
            empty={<div className="px-3 py-6 text-xs text-[var(--text-muted)]">当前没有可显示的聊天节点。</div>}
            getKey={(item) => item.key}
            renderItem={(item) => {
              if (item.kind === 'group') {
                return (
                  <div className="flex h-full items-center justify-between px-2">
                    <p className="text-[10px] uppercase text-[var(--text-muted)]">{item.provider}</p>
                    <span className="text-[10px] text-[var(--text-muted)]">{item.count}</span>
                  </div>
                );
              }

              const node = nodes[item.index];
              const ping = pingResults.get(item.index);
              const health = nodeHealthMap.get(item.index);
              const levelMeta = getLevelMeta(health?.level);

              return (
                <button
                  onClick={() => scrollToNode(item.index)}
                  className={`w-full flex h-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors cursor-pointer ${item.index === activeIndex ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'}`}
                >
                  <span className="mono text-[10px] text-[var(--text-muted)] w-6 text-right">#{item.index}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-xs text-[var(--text-primary)]">{node.modelName || '(空)'}</span>
                    <span className="block truncate text-[10px] text-[var(--text-muted)]">{node.remark || '还没写备注'}</span>
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{ background: levelMeta.bg, color: levelMeta.color }}
                    title={health ? `健康分 ${health.score} 分；来源：${getHealthSourceLabel(health.source)}（${getHealthSourceHint(health.source)}）${health.reason ? `；${health.reason}` : ''}` : '无数据'}
                  >
                    {formatHealthBadge(health)}
                  </span>
                  {ping && (
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: ping.pass ? 'var(--success)' : 'var(--error)' }}
                      title={ping.pass ? `${ping.latency_ms}ms` : ping.error || `HTTP ${ping.status}`}
                    />
                  )}
                </button>
              );
            }}
          />
        </Panel>
      </div>

      <div className="flex-1 min-w-0 pr-1">
          {nodes.length === 0 ? (
            <div className="flex items-center justify-center h-full rounded-[var(--radius)] border border-dashed border-[var(--border-subtle)]">
              <p className="text-sm text-[var(--text-muted)]">你这里还没有任何 API 节点。先点“新增节点”，把 URL、Key 和模型名填进去，再测试它可不可用。</p>
            </div>
          ) : visibleNodeIndices.length === 0 ? (
            <div className="flex items-center justify-center h-full rounded-[var(--radius)] border border-dashed border-[var(--border-subtle)]">
              <div className="px-6 text-center">
                <p className="text-sm text-[var(--text-muted)]">
                  {focusActiveNodeOnly
                    ? '聚焦编辑模式下，右侧只显示当前活跃节点；但当前活跃节点不在目录筛选结果里。可以先在左侧点别的节点，或放宽筛选条件。'
                    : '当前筛选条件下没有匹配节点。可以清掉搜索词，或者放宽健康等级 / 来源筛选再试一次。'}
                </p>
                {activeDirectoryFilters.length > 0 && (
                  <p className="mt-2 text-[11px] text-[var(--text-muted)]">当前条件：{activeDirectoryFilters.join(' / ')}</p>
                )}
              </div>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={visibleNodeIndices} strategy={verticalListSortingStrategy}>
                <div className={nodeCardStackGap}>
                  {visibleNodeIndices.map((i) => (
                    <SortableNodeCard
                      key={i}
                      id={i}
                      node={nodes[i]}
                      index={i}
                      density={settings.contentDensity}
                      isActive={i === activeIndex}
                      isDuplicate={duplicates.has(i)}
                      isSelected={selected.has(i)}
                      isExpanded={expandedCards.has(i)}
                      isPinging={pinging.has(i)}
                      pingResult={pingResults.get(i)}
                      health={nodeHealthMap.get(i)}
                      showKey={showKey.has(i)}
                      showHealthPanel={showNodeHealthPanels}
                      onUpdate={updateNode}
                      onRemove={removeNode}
                      onClone={cloneNode}
                      onInsert={insertAfter}
                      onTest={testNode}
                      onApplyDefaultUrlSuffix={applyDefaultUrlSuffix}
                      onSetActive={(idx) => set({ ...state, activeIndex: idx })}
                      onToggleSelect={(idx) => {
                        const next = new Set(selected);
                        if (next.has(idx)) next.delete(idx); else next.add(idx);
                        setSelected(next);
                      }}
                      onToggleKey={(idx) => {
                        const next = new Set(showKey);
                        if (next.has(idx)) next.delete(idx); else next.add(idx);
                        setShowKey(next);
                      }}
                      onToggleExpanded={toggleExpanded}
                      cardRef={(el) => { if (el) cardRefs.current.set(i, el); else cardRefs.current.delete(i); }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={deleteBulk}
        title="批量删除"
        message={`确定要删除选中的 ${selected.size} 个节点吗？`}
      />
    </div>
  );
}

function ImageApiManagerPanel({
  density,
  nodes,
  activeIndex,
  imageApiTimeoutMs,
  search,
  dirty,
  canUndo,
  canRedo,
  filteredIndices,
  onSearchChange,
  onUndo,
  onRedo,
  onSave,
  onExport,
  onExportTemplate,
  onImport,
  onAdd,
  onClone,
  onRemove,
  onSetActive,
  onImageApiTimeoutSecondsChange,
  onUpdate,
  onChangeProvider,
  onApplyGenerationSuffix,
  onApplyEditSuffix,
  cardRef,
}: {
  density: 'compact' | 'standard' | 'spacious';
  nodes: ImageApiNode[];
  activeIndex: number;
  imageApiTimeoutMs: number;
  search: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  filteredIndices: number[];
  onSearchChange: (next: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void | Promise<void>;
  onExport: () => void;
  onExportTemplate: () => void;
  onImport: () => void | Promise<void>;
  onAdd: (providerType?: ImageApiProviderType) => void;
  onClone: (index: number) => void;
  onRemove: (index: number) => void;
  onSetActive: (index: number) => void;
  onImageApiTimeoutSecondsChange: (seconds: number) => void;
  onUpdate: (index: number, field: keyof ImageApiNode, value: ImageApiNode[keyof ImageApiNode]) => void;
  onChangeProvider: (index: number, providerType: ImageApiProviderType) => void;
  onApplyGenerationSuffix: (index: number) => void;
  onApplyEditSuffix: (index: number) => void;
  cardRef: (index: number, el: HTMLDivElement | null) => void;
}) {
  const densityClass = getDensityClass(density);
  const [showKey, setShowKey] = useState<Set<number>>(new Set());
  const imageApiTimeoutSeconds = Math.max(1, Math.round(imageApiTimeoutMs / 1000));

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <div className={`grid grid-cols-2 xl:grid-cols-6 ${densityClass.summaryGrid}`}>
        <SummaryCard label="图像节点总数" value={String(nodes.length)} hint="这里是独立的 image_api_config.json，不会混进聊天节点列表。" />
        <SummaryCard label="当前图像节点" value={nodes[activeIndex]?.modelName || (nodes[activeIndex] ? getDefaultImageModel(normalizeImageProviderType(nodes[activeIndex].providerType)) : `#${activeIndex}`)} hint={`命令会优先从 #${activeIndex} 开始使用。`} />
        <SummaryCard label="可参考图节点" value={String(nodes.filter((node) => imageNodeSupportsEdit(node)).length)} hint="支持修图 URL 的节点可在 neko.生图 中接收引用图片作为参考图。" />
        <SummaryCard label="图像超时" value={formatTimeoutMs(imageApiTimeoutMs)} hint="neko.生图 / neko.修图 等待下游图像接口的最长时间。" />
        <SummaryCard label="当前显示" value={`${filteredIndices.length}/${nodes.length}`} hint="搜索只影响当前列表显示，不会改真实顺序。" />
        <SummaryCard label="保存状态" value={dirty ? '待保存' : '已同步'} hint={dirty ? '图像节点或全局图像设置有未保存改动。' : '图像节点列表和全局设置已经和文件一致。'} tone={dirty ? 'warning' : 'neutral'} />
      </div>

      <Panel title="图像节点操作" subtitle="这里管理独立的图像 API 节点。聊天节点和图像节点已经分离，图像一键测活默认不提供，避免直接消耗图像额度。" padding="sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void onSave()}
            disabled={!dirty}
            className={`px-4 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${dirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
          >
            💾 保存图像节点
          </button>
          <button
            onClick={() => onAdd('openai')}
            className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--accent-purple)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer"
          >
            + 新增 OpenAI 图像节点
          </button>
          <button
            onClick={() => onAdd('xai')}
            className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--info)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer"
          >
            + 新增 xAI 图像节点
          </button>
          <ImportExportActions
            onExport={onExport}
            onImport={() => void onImport()}
            confirmTitle="导入图像 API 配置"
            size="xs"
          />
          <button
            onClick={onExportTemplate}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--info)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            🧩 下载图像模板
          </button>
          <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5">
            <span className="text-[11px] text-[var(--text-muted)]">图像超时</span>
            <input
              type="number"
              min={1}
              step={1}
              value={imageApiTimeoutSeconds}
              onChange={(e) => onImageApiTimeoutSecondsChange(Number(e.target.value))}
              className="w-20 px-2 py-1 text-xs mono rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
              title="按秒填写，保存后写入 runtime_config.json 的 imageApiTimeoutMs"
            />
            <span className="text-[11px] text-[var(--text-muted)]">秒</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`px-2.5 py-2 text-xs rounded-[var(--radius-sm)] cursor-pointer transition-colors ${canUndo ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]' : 'text-[var(--text-muted)] cursor-not-allowed opacity-40'}`}
          >
            ↩ 撤销
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className={`px-2.5 py-2 text-xs rounded-[var(--radius-sm)] cursor-pointer transition-colors ${canRedo ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]' : 'text-[var(--text-muted)] cursor-not-allowed opacity-40'}`}
          >
            ↪ 重做
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
          图像超时只影响 <span className="mono">neko.生图</span> / <span className="mono">neko.修图</span> 的下游图像接口等待时间；聊天 API 仍使用 <span className="mono">apiTimeoutMs</span>。例如填 300 就是 5 分钟。
        </p>
      </Panel>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <Panel title="图像节点列表" subtitle="OpenAI / xAI 图像生成、图像编辑 URL 和默认参数在这里单独维护。" padding="sm">
          <div className="space-y-3">
            <SearchBar value={search} onChange={onSearchChange} placeholder="搜索备注 / 模型 / URL..." />

            {filteredIndices.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-dashed border-[var(--border-subtle)] px-4 py-8 text-sm text-[var(--text-muted)] text-center">
                当前没有匹配的图像节点。可以先新增节点，或清空搜索词再看。
              </div>
            ) : (
              <div className={densityClass.contentGap}>
                {filteredIndices.map((index) => {
                  const node = nodes[index];
                  const keyVisible = showKey.has(index);
                  const providerType = normalizeImageProviderType(node.providerType);
                  const supportsEdit = imageNodeSupportsEdit(node);
                  const gptImage2Node = isGptImage2ImageNode(node);
                  return (
                    <div
                      key={index}
                      ref={(el) => cardRef(index, el)}
                      className={`rounded-[var(--radius)] border border-[var(--border-subtle)] ${densityClass.cardPadding}`}
                      style={{ boxShadow: 'var(--shadow-card)', background: 'var(--surface-card)' }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs mono text-[var(--text-muted)]">#{index}</span>
                        <span className="text-sm font-medium text-[var(--text-primary)]">{node.modelName || getDefaultImageModel(providerType)}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(0,188,212,0.14)] text-[var(--info)]">{getImageProviderLabel(providerType)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${supportsEdit ? 'bg-[rgba(16,185,129,0.14)] text-[var(--success)]' : 'bg-[rgba(251,191,36,0.15)] text-[var(--warning)]'}`}>{getImageCapabilityLabel(node)}</span>
                        {index === activeIndex ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-purple)] text-white">活跃</span> : null}
                        <div className="flex-1" />
                        <button
                          onClick={() => {
                            const next = new Set(showKey);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            setShowKey(next);
                          }}
                          className="px-2.5 py-1.5 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          {keyVisible ? '收起 Key' : '展开 Key'}
                        </button>
                      </div>

                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">{node.remark || '还没写备注'}</div>

                      <DeferredVisibleBlock
                        forceMount={index === activeIndex || keyVisible}
                        placeholder={(
                          <DeferredCardPlaceholder
                            title="图像节点表单将在滚动到附近时再挂载"
                            subtitle="离当前视口较远的图像节点会先延迟挂载表单，减少大量图像节点同时展开时的输入框渲染压力。设为活跃或展开 Key 后会立即加载。"
                          />
                        )}
                      >
                        <div className="mt-4 grid gap-3 xl:grid-cols-2">
                          <div>
                            <label className="text-[10px] text-[var(--text-muted)] mb-1 block">Provider</label>
                            <select
                              value={providerType}
                              onChange={(e) => onChangeProvider(index, e.target.value as ImageApiProviderType)}
                              className="w-full px-2.5 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] cursor-pointer"
                            >
                              <option value="openai">openai</option>
                              <option value="xai">xai</option>
                            </select>
                            <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
                              OpenAI 图像默认模型是 `gpt-image-2`。该模型支持引用带图消息后用 `neko.生图 提示词` 参考生成。
                            </p>
                          </div>
                          <div>
                            <label className="text-[10px] text-[var(--text-muted)] mb-1 block">节点能力</label>
                            <select
                              value={supportsEdit ? 'true' : 'false'}
                              onChange={(e) => onUpdate(index, 'supportsEdit', e.target.value === 'true')}
                              className="w-full px-2.5 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] cursor-pointer"
                            >
                              <option value="false">仅生图</option>
                              <option value="true">生图 + 修图</option>
                            </select>
                            <p className={`mt-1 text-[10px] leading-relaxed ${gptImage2Node ? 'text-[var(--info)]' : 'text-[var(--text-muted)]'}`}>
                              {gptImage2Node ? '`gpt-image-2` 开启该能力并填写修图 URL 后，可直接引用带图消息进行参考图生图。' : '支持该能力的节点会被 `neko.修图` 使用，也可在 `neko.生图` 中接收引用图片作为参考。'}
                            </p>
                          </div>
                          <div>
                            <label className="text-[10px] text-[var(--text-muted)] mb-1 block">备注</label>
                            <input
                              value={node.remark}
                              onChange={(e) => onUpdate(index, 'remark', e.target.value)}
                              className="w-full px-2.5 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                              placeholder="写一个你自己看得懂的备注"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-[var(--text-muted)] mb-1 block">图像模型</label>
                            <input
                              value={node.modelName}
                              onChange={(e) => onUpdate(index, 'modelName', e.target.value)}
                              className="w-full px-2.5 py-2 text-xs mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                              placeholder={getDefaultImageModel(providerType)}
                            />
                            {providerType === 'xai' && String(node.modelName || '').trim().toLowerCase() === 'grok-imagine-image-pro' ? (
                              <p className="mt-1 text-[10px] leading-relaxed text-[var(--warning)]">
                                当前已知 `grok-imagine-image-pro` 可能阶段性返回 500 / 503。插件现在会在这种“模型暂时不可用”的场景下，自动回退到 `grok-imagine-image` 再重试一次，并在日志与完成提示里明确写出回退情况。
                              </p>
                            ) : providerType === 'openai' ? (
                              <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
                                OpenAI 图像渠道目前默认使用 `gpt-image-2`。检测到该模型时，建议保留修图 URL，用于引用图片后的参考图生图。
                              </p>
                            ) : (
                              <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
                                若你填写 `grok-imagine-image-pro`，当 xAI 返回“模型暂时不可用 / 服务不可用 / 内部生成失败”时，插件会自动回退到 `grok-imagine-image` 再重试一次。
                              </p>
                            )}
                          </div>

                          <div className="xl:col-span-2">
                            <label className="text-[10px] text-[var(--text-muted)] mb-1 block">生图 URL</label>
                            <div className="flex gap-2">
                              <input
                                value={node.generationUrl}
                                onChange={(e) => onUpdate(index, 'generationUrl', e.target.value)}
                                className="flex-1 px-2.5 py-2 text-xs mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                                placeholder={getDefaultImageGenerationUrl(providerType)}
                              />
                              <button
                                type="button"
                                onClick={() => onApplyGenerationSuffix(index)}
                                className="px-2.5 py-2 text-[11px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-purple)] cursor-pointer whitespace-nowrap"
                              >
                                补 /v1/images/generations
                              </button>
                            </div>
                          </div>

                          <div className="xl:col-span-2">
                            <label className="text-[10px] text-[var(--text-muted)] mb-1 block">修图 URL</label>
                            <div className="flex gap-2">
                              <input
                                value={node.editUrl}
                                onChange={(e) => onUpdate(index, 'editUrl', e.target.value)}
                                disabled={!supportsEdit}
                                className="flex-1 px-2.5 py-2 text-xs mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] disabled:opacity-55 disabled:cursor-not-allowed"
                                placeholder={supportsEdit ? getDefaultImageEditUrl(providerType) : '当前节点仅生图，修图命令会跳过'}
                              />
                              <button
                                type="button"
                                onClick={() => onApplyEditSuffix(index)}
                                disabled={!supportsEdit}
                                className="px-2.5 py-2 text-[11px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-purple)] cursor-pointer whitespace-nowrap disabled:opacity-55 disabled:cursor-not-allowed"
                              >
                                补 /v1/images/edits
                              </button>
                            </div>
                            {!supportsEdit ? (
                              <p className="mt-1 text-[10px] leading-relaxed text-[var(--warning)]">
                                此节点不会参与 `neko.修图`。已填写的修图 URL 会保留在配置里，但插件运行时不会调用。
                              </p>
                            ) : null}
                          </div>

                          <div>
                            <label className="text-[10px] text-[var(--text-muted)] mb-1 block">默认宽高比</label>
                            <select
                              value={node.aspectRatio || ''}
                              onChange={(e) => onUpdate(index, 'aspectRatio', e.target.value)}
                              className="w-full px-2.5 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] cursor-pointer"
                            >
                              {IMAGE_ASPECT_RATIO_OPTIONS.map((option) => (
                                <option key={option.value || 'default'} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
                              `空白` 不等于 `auto`。`空白` 表示这个图像节点不会主动传 `aspect_ratio`，如果命令里也没写 `--ratio`，就完全交给图像接口自己决定。
                              `auto` 表示会显式传 `aspect_ratio=auto` 给图像接口，让它自动挑一个合适比例。命令里如果手动写 `--ratio 16:9`，冒号请使用英文冒号 `:`
                            </p>
                          </div>

                          <div>
                            <label className="text-[10px] text-[var(--text-muted)] mb-1 block">默认分辨率</label>
                            <select
                              value={node.resolution || ''}
                              onChange={(e) => onUpdate(index, 'resolution', e.target.value)}
                              className="w-full px-2.5 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] cursor-pointer"
                            >
                              {IMAGE_RESOLUTION_OPTIONS.map((option) => (
                                <option key={option.value || 'default'} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
                              `空白` 表示这个图像节点不会主动传 `resolution`，如果命令里也没写 `--resolution`，就完全交给 xAI 自己决定。
                              当前内置清晰度预设是 `1k（标准清晰度）` 和 `2k（高清清晰度）`。
                            </p>
                          </div>

                          {keyVisible ? (
                            <div className="xl:col-span-2">
                              <label className="text-[10px] text-[var(--text-muted)] mb-1 block">API Key</label>
                              <input
                                value={node.apiKey}
                                onChange={(e) => onUpdate(index, 'apiKey', e.target.value)}
                                className="w-full px-2.5 py-2 text-xs mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                                placeholder={getImageApiKeyPlaceholder(providerType)}
                              />
                            </div>
                          ) : null}
                        </div>
                      </DeferredVisibleBlock>

                      <div className="mt-4 flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => onClone(index)}
                          className="px-2.5 py-1.5 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                        >
                          📋 克隆
                        </button>
                        {index !== activeIndex ? (
                          <button
                            onClick={() => onSetActive(index)}
                            className="px-2.5 py-1.5 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--success)] hover:bg-[rgba(0,230,118,0.1)] transition-colors cursor-pointer"
                          >
                            ⚡ 设为活跃
                          </button>
                        ) : null}
                        <div className="flex-1" />
                        <button
                          onClick={() => {
                            if (window.confirm(`确定删除图像节点 #${index}？`)) onRemove(index);
                          }}
                          className="px-2.5 py-1.5 text-[10px] rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[rgba(255,82,82,0.1)] transition-colors cursor-pointer"
                        >
                          🗑 移除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function WeightSlider({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <label className="w-14 text-[var(--text-muted)]">{label}</label>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="mono text-[var(--text-secondary)] w-8 text-right">{value}</span>
    </div>
  );
}

const SortableNodeCard = memo(function SortableNodeCard({ id, node, index, density, isActive, isDuplicate, isSelected, isExpanded, isPinging, pingResult, health, showKey,
  showHealthPanel, onUpdate, onRemove, onClone, onInsert, onTest, onApplyDefaultUrlSuffix, onSetActive, onToggleSelect, onToggleKey, onToggleExpanded, cardRef,
}: {
  id: number;
  node: ApiNode;
  index: number;
  density: 'compact' | 'standard' | 'spacious';
  isActive: boolean;
  isDuplicate: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  isPinging: boolean;
  pingResult?: PingResult;
  health?: NodeHealth;
  showKey: boolean;
  showHealthPanel: boolean;
  onUpdate: (i: number, field: keyof ApiNode, value: ApiNode[keyof ApiNode]) => void;
  onRemove: (i: number) => void;
  onClone: (i: number) => void;
  onInsert: (i: number) => void;
  onTest: (i: number) => void;
  onApplyDefaultUrlSuffix: (i: number) => void;
  onSetActive: (i: number) => void;
  onToggleSelect: (i: number) => void;
  onToggleKey: (i: number) => void;
  onToggleExpanded: (i: number) => void;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const densityClass = getDensityClass(density);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };
  const levelMeta = getLevelMeta(health?.level);

  return (
    <div
      ref={(el) => { setNodeRef(el); cardRef(el); }}
      style={{
        ...style,
        boxShadow: isActive
          ? '0 24px 56px rgba(15, 23, 42, 0.16), 0 0 0 1px rgba(168, 85, 247, 0.28)'
          : isSelected
            ? '0 18px 42px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(14, 165, 233, 0.18)'
            : '0 14px 32px rgba(15, 23, 42, 0.10), 0 0 0 1px rgba(148, 163, 184, 0.12)',
        background: 'var(--surface-card)',
      }}
      className={`rounded-[var(--radius)] border-2 hover:border-[var(--border-hover)] transition-all duration-[240ms] overflow-hidden ${densityClass.cardPadding} ${isActive ? 'border-[var(--accent-purple)] ring-1 ring-[rgba(168,85,247,0.16)]' : isSelected ? 'border-[rgba(14,165,233,0.28)]' : 'border-[var(--border-subtle)]'} ${isSelected ? 'bg-[var(--nav-active-bg)]' : ''}`}
    >
      <div
        className="h-1.5 rounded-full mb-4"
        style={{
          background: isActive
            ? 'var(--accent-purple)'
            : health?.level === 'risk'
              ? 'var(--error)'
              : health?.level === 'warning'
                ? 'var(--warning)'
                : 'var(--border-subtle)',
          opacity: isActive ? 1 : 0.6,
        }}
      />
      <div className={`-mx-5 -mt-5 px-5 pt-5 pb-4 mb-5 flex flex-wrap items-start ${densityClass.cardGap} border-b border-[var(--border-subtle)]`} style={{ background: isActive ? 'rgba(168, 85, 247, 0.05)' : 'rgba(148, 163, 184, 0.05)' }}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(index)}
            className="accent-[var(--accent-purple)] cursor-pointer mt-0.5"
          />
          <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-secondary)] mt-0.5">
            ⠿
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs mono text-[var(--text-muted)]">#{index}</span>
              <span className="text-sm font-medium text-[var(--text-primary)] truncate max-w-[320px]">{node.modelName || '(未命名模型)'}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)]" style={{ color: node.aiType === 'openai' ? 'var(--success)' : node.aiType === 'responses' ? 'var(--accent-purple)' : node.aiType === 'gemini' ? 'var(--info)' : 'var(--accent-pink)' }}>
                {formatAiTypeLabel(node.aiType)}
              </span>
              {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-purple)] text-white">活跃</span>}
              {isDuplicate && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,171,64,0.2)] text-[var(--warning)]">重复</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
              <span className="truncate max-w-[240px]">{node.remark || '还没写备注'}</span>
              <span>·</span>
              <span className="truncate max-w-[360px] mono">{node.apiUrl || '还没填 URL'}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-end">
          {pingResult && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                background: pingResult.pass ? 'rgba(0,230,118,0.15)' : 'rgba(255,82,82,0.15)',
                color: pingResult.pass ? 'var(--success)' : 'var(--error)',
              }}
            >
              {pingResult.pass ? `${pingResult.latency_ms}ms` : `失败 ${pingResult.status || ''}`}
            </span>
          )}
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: levelMeta.bg, color: levelMeta.color }}
            title={`来源: ${getHealthSourceLabel(health?.source)}${health?.reason ? `；${health.reason}` : ''}`}
          >
            {levelMeta.label} {formatHealthBadge(health)}
          </span>
          <button
            onClick={() => onToggleExpanded(index)}
            className="px-2.5 py-1.5 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
              {isExpanded ? '收起 Key 区域' : '展开 Key 区域'}
          </button>
        </div>
      </div>

      <DeferredVisibleBlock
        forceMount={isActive || isExpanded || isDragging}
        placeholder={(
          <DeferredCardPlaceholder
            title="编辑表单将在滚动到附近时再挂载"
            subtitle="为了减轻长节点列表的渲染压力，离当前视口较远的节点会先延迟挂载输入框和健康面板。滚动到这里、设为活跃或展开 Key 区域后会自动加载。"
          />
        )}
      >
        <div className={`mt-4 grid gap-3 ${showHealthPanel ? 'xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]' : 'grid-cols-1'}`}>
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-[var(--text-muted)] mb-1 block">接口类型</label>
                <select
                  value={node.aiType}
                  onChange={(e) => onUpdate(index, 'aiType', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] cursor-pointer"
                >
                  <option value="openai">openai (completions)</option>
                  <option value="responses">openai-response</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] mb-1 block">备注</label>
                <input
                  value={node.remark}
                  onChange={(e) => onUpdate(index, 'remark', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                  placeholder="写一个你自己看得懂的备注"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-1 block">API URL</label>
              <div className="flex gap-2">
                <input
                  value={node.apiUrl}
                  onChange={(e) => onUpdate(index, 'apiUrl', e.target.value)}
                  className={`flex-1 px-2.5 py-2 text-xs mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] ${!node.apiUrl ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'}`}
                  placeholder="先填基础地址，需要时点右侧按钮补常见后缀"
                />
                <button
                  type="button"
                  onClick={() => onApplyDefaultUrlSuffix(index)}
                  className="px-2.5 py-2 text-[11px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-purple)] cursor-pointer whitespace-nowrap"
                  title="只会补这类接口的常见默认后缀，不会覆盖你自己写的自定义路径"
                >
                  {getDefaultSuffixActionLabel(node.aiType, node.modelName)}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                {getDefaultSuffixHint(node.aiType, node.modelName)}。URL 仍然完全由你决定，按钮只做辅助补全。
              </p>
            </div>

            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-1 block">模型名称</label>
              <input
                value={node.modelName}
                onChange={(e) => onUpdate(index, 'modelName', e.target.value)}
                className={`w-full px-2.5 py-2 text-xs mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] ${!node.modelName ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'}`}
                placeholder="gpt-4"
              />
            </div>

            <div className={`rounded-[var(--radius-sm)] border p-3 ${node.aiType === 'responses' ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] opacity-65'}`}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={node.xaiWebSearchEnabled === true}
                  disabled={node.aiType !== 'responses'}
                  onChange={(e) => onUpdate(index, 'xaiWebSearchEnabled', e.target.checked)}
                  className="mt-0.5 accent-[var(--accent-purple)] cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="min-w-0">
                  <span className="block text-xs text-[var(--text-primary)]">启用 xAI Web Search</span>
                  <span className="block mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
                    仅在 `openai-response` 下生效，只支持 xAI 官方 API + Grok 模型。若你的 URL 来自第三方兼容站、中转站，或模型不是 Grok，请保持关闭。
                  </span>
                </span>
              </label>
            </div>

            {isExpanded && (
              <div>
                <label className="text-[10px] text-[var(--text-muted)] mb-1 block">API Key</label>
                <div className="flex gap-1.5">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={node.apiKey}
                    onChange={(e) => onUpdate(index, 'apiKey', e.target.value)}
                    className="flex-1 px-2.5 py-2 text-xs mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
                    placeholder="sk-..."
                  />
                  <button
                    onClick={() => onToggleKey(index)}
                    className="px-2.5 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    title={showKey ? '隐藏' : '显示'}
                  >
                    {showKey ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {showHealthPanel && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-[var(--text-primary)]">节点健康</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: levelMeta.bg, color: levelMeta.color }} title={`来源: ${getHealthSourceLabel(health?.source)}${health?.reason ? `；${health.reason}` : ''}`}>{formatHealthBadge(health)}</span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">{health?.reason ?? '暂无评分解释'}{health?.source !== 'none' ? `（当前来源：${getHealthSourceLabel(health?.source)}）` : ''}</p>
            </div>

            <MetricBar label="实时" score={health?.liveScore} weight={health?.liveWeight ?? 0} color="var(--accent-purple)" hint={pingResult?.pass ? `最近测试 ${pingResult.latency_ms}ms` : pingResult?.error || undefined} />
            <MetricBar label="历史" score={health?.historyScore} weight={health?.historyWeight ?? 0} color="var(--info)" />
            <MetricBar label="超时" score={health?.timeoutScore} weight={health?.timeoutWeight ?? 0} color="var(--warning)" hint={health?.timeoutScore !== null && (health?.timeoutScore ?? 0) < 80 ? '超时占比偏高' : undefined} />
            <MetricBar label="抖动" score={health?.jitterScore} weight={health?.jitterWeight ?? 0} color="var(--success)" hint={health?.jitterScore !== null && (health?.jitterScore ?? 0) < 80 ? '响应波动偏大' : undefined} />
          </div>
          )}
        </div>
      </DeferredVisibleBlock>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <button onClick={() => onTest(index)} disabled={isPinging}
          className="px-2.5 py-1.5 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
          {isPinging ? '⏳ 测试中' : '🔍 测试'}
        </button>
        <button onClick={() => onClone(index)}
          className="px-2.5 py-1.5 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
          📋 克隆
        </button>
        <button onClick={() => onInsert(index)}
          className="px-2.5 py-1.5 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
          ➕ 插入
        </button>
        {!isActive && (
          <button onClick={() => onSetActive(index)}
            className="px-2.5 py-1.5 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--success)] hover:bg-[rgba(0,230,118,0.1)] transition-colors cursor-pointer">
            ⚡ 设为活跃
          </button>
        )}
        <div className="flex-1" />
        <button onClick={() => onRemove(index)}
          className="px-2.5 py-1.5 text-[10px] rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[rgba(255,82,82,0.1)] transition-colors cursor-pointer">
          🗑 移除
        </button>
      </div>
    </div>
  );
});
