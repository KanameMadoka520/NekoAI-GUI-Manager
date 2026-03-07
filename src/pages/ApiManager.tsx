import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { listen } from '@tauri-apps/api/event';
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
import { useUiStore } from '../stores/uiStore';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { getConfig, saveConfig, pingApi, batchPingApis, batchPingApisStream, getApiHistoryMetrics } from '../lib/tauri-commands';
import { downloadJsonWithTimestamp, pickJsonAndParse } from '../lib/json-transfer';
import type { ApiNode, RuntimeConfig, PingResult, ApiHistoryMetric } from '../lib/types';

interface NodeState {
  nodes: ApiNode[];
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

export function ApiManager() {
  const addToast = useUiStore((s) => s.addToast);
  const settings = useUiStore((s) => s.settings);
  const { state, set, reset, undo, redo, canUndo, canRedo } = useUndoRedo<NodeState>({ nodes: [], activeIndex: 0 });
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pingResults, setPingResults] = useState<Map<number, PingResult>>(new Map());
  const [pinging, setPinging] = useState<Set<number>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showAllKeys, setShowAllKeys] = useState(false);
  const [showKey, setShowKey] = useState<Set<number>>(new Set());
  const [batchPinging, setBatchPinging] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [batchSessionId, setBatchSessionId] = useState<string | null>(null);
  const [healthSort, setHealthSort] = useState<'none' | 'desc' | 'asc'>('none');
  const [healthFilter, setHealthFilter] = useState<'all' | 'healthy' | 'warning' | 'risk'>('all');
  const [historyMetrics, setHistoryMetrics] = useState<ApiHistoryMetric[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [weightLive, setWeightLive] = useState(60);
  const [weightTimeout, setWeightTimeout] = useState(20);
  const [weightJitter, setWeightJitter] = useState(20);
  const [showAdvancedToolbar, setShowAdvancedToolbar] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const { nodes, activeIndex } = state;
  const dirty = useMemo(() => JSON.stringify(state) !== original, [state, original]);
  const density = getDensityClass(settings.contentDensity);
  const historyWeight = Math.max(0, 100 - Math.max(0, Math.min(100, weightLive)) - Math.max(0, Math.min(100, weightTimeout)) - Math.max(0, Math.min(100, weightJitter)));
  const allApiKeyExpanded = nodes.length > 0 && nodes.every((_, i) => expandedCards.has(i));

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, state, original]);

  useEffect(() => {
    if (!batchSessionId) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;

    async function setup() {
      try {
        unlistenProgress = await listen<{ session_id: string; result: PingResult; done: number; total: number }>('batch-ping-progress', (event) => {
          const payload = event.payload;
          if (!payload || payload.session_id !== batchSessionId) return;
          setPingResults((m) => {
            const next = new Map(m);
            next.set(payload.result.index, payload.result);
            return next;
          });
          setBatchProgress({ done: payload.done, total: payload.total });
        });

        unlistenDone = await listen<{ session_id: string; results: PingResult[] }>('batch-ping-done', (event) => {
          const payload = event.payload;
          if (!payload || payload.session_id !== batchSessionId) return;
          setBatchPinging(false);
          setBatchSessionId(null);
          setBatchProgress({ done: 0, total: 0 });
          const passed = (payload.results ?? []).filter((r) => r.pass).length;
          addToast('success', `批量测试完成: ${passed}/${payload.results?.length ?? 0} 通过`);
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
      const [apiData, rt, metrics] = await Promise.all([
        getConfig<ApiNode[]>('api'),
        getConfig<RuntimeConfig>('runtime'),
        getApiHistoryMetrics().catch(() => []),
      ]);
      const initial: NodeState = {
        nodes: apiData ?? [],
        activeIndex: rt?.activeApiIndex ?? 0,
      };
      reset(initial);
      setOriginal(JSON.stringify(initial));
      setSelected(new Set());
      setPingResults(new Map());
      setRuntimeConfig(rt ?? null);
      const liveW = Number(rt?.apiHealthWeights?.liveWeight ?? 60);
      const timeoutW = Number(rt?.apiHealthWeights?.timeoutWeight ?? 20);
      const jitterW = Number(rt?.apiHealthWeights?.jitterWeight ?? 20);
      setWeightLive(Math.max(0, Math.min(100, Number.isFinite(liveW) ? liveW : 60)));
      setWeightTimeout(Math.max(0, Math.min(100, Number.isFinite(timeoutW) ? timeoutW : 20)));
      setWeightJitter(Math.max(0, Math.min(100, Number.isFinite(jitterW) ? jitterW : 20)));
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

  function updateNode(index: number, field: keyof ApiNode, value: string) {
    const next = [...nodes];
    next[index] = { ...next[index], [field]: value };
    set({ ...state, nodes: next });
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
    next.splice(index + 1, 0, { apiUrl: '', apiKey: '', modelName: '', remark: '新节点', aiType: 'openai' });
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
      const result = await pingApi(node.apiUrl, node.apiKey, node.modelName, node.aiType);
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
      index: i, api_url: n.apiUrl, api_key: n.apiKey, model_name: n.modelName, ai_type: n.aiType,
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
        addToast('success', `批量测试完成: ${passed}/${results.length} 通过`);
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
      if (rt) {
        const nextLiveWeight = Math.max(0, Math.min(100, weightLive));
        const nextTimeoutWeight = Math.max(0, Math.min(100, weightTimeout));
        const nextJitterWeight = Math.max(0, Math.min(100, weightJitter));
        const nextHistoryWeight = Math.max(0, 100 - nextLiveWeight - nextTimeoutWeight - nextJitterWeight);
        await saveConfig('runtime', {
          ...rt,
          activeApiIndex: activeIndex,
          apiHealthWeights: {
            liveWeight: nextLiveWeight,
            historyWeight: nextHistoryWeight,
            timeoutWeight: nextTimeoutWeight,
            jitterWeight: nextJitterWeight,
          },
        });
      }
      setOriginal(JSON.stringify(state));
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
      const normalized: ApiNode[] = imported.map((item) => ({
        apiUrl: typeof item.apiUrl === 'string' ? item.apiUrl : '',
        apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
        modelName: typeof item.modelName === 'string' ? item.modelName : '',
        remark: typeof item.remark === 'string' ? item.remark : '',
        aiType: item.aiType === 'anthropic' || item.aiType === 'gemini' ? item.aiType : 'openai',
      }));

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

  function scrollToNode(index: number) {
    cardRefs.current.get(index)?.scrollIntoView({ behavior: 'auto', block: 'center' });
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
    if (!search.trim()) return nodes.map((_, i) => i);
    const q = search.toLowerCase();
    return nodes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) =>
        n.modelName.toLowerCase().includes(q) ||
        n.remark.toLowerCase().includes(q) ||
        n.aiType.toLowerCase().includes(q)
      )
      .map(({ i }) => i);
  }, [nodes, search]);

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

        if ((history.timeout_rate ?? 0) >= 0.2) historyReason = '历史超时率较高';
        else if (history.error_rate >= 0.35) historyReason = '历史错误率较高';
        else if (jitter >= 1200) historyReason = '历史响应抖动较高';
        else if (rt >= 2000) historyReason = '历史平均响应时间较高';
        else historyReason = '历史表现稳定';
      }

      const weightedParts: number[] = [];
      if (liveScore !== null && liveWeight > 0) weightedParts.push(liveScore * (liveWeight / 100));
      if (historyScore !== null && nextHistoryWeight > 0) weightedParts.push(historyScore * (nextHistoryWeight / 100));
      if (timeoutScore !== null && timeoutWeight > 0) weightedParts.push(timeoutScore * (timeoutWeight / 100));
      if (jitterScore !== null && jitterWeight > 0) weightedParts.push(jitterScore * (jitterWeight / 100));

      let score = 0;
      let source: NodeHealth['source'] = 'none';
      let reason = '无可用数据';
      if (weightedParts.length > 0) {
        score = clampScore(weightedParts.reduce((sum, item) => sum + item, 0));
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

    if (healthSort !== 'none') {
      arr.sort((a, b) => {
        const sa = nodeHealthMap.get(a)?.score ?? 0;
        const sb = nodeHealthMap.get(b)?.score ?? 0;
        return healthSort === 'desc' ? sb - sa : sa - sb;
      });
    }

    return arr;
  }, [filteredIndices, healthFilter, healthSort, nodeHealthMap]);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
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

  return (
    <div className={`flex h-full ${density.pageGap}`}>
      <div className="w-64 flex-shrink-0">
        <Panel title="节点目录" subtitle="先筛选，再定位，再展开编辑。" padding="sm">
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
              <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
                <p className="text-[10px] text-[var(--text-muted)]">当前显示</p>
                <p className="text-sm font-medium text-[var(--text-primary)]">{displayedIndices.length}/{nodes.length}</p>
              </div>
              <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
                <p className="text-[10px] text-[var(--text-muted)]">风险节点</p>
                <p className="text-sm font-medium text-[var(--error)]">{summary.risk}</p>
              </div>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
              <p className="text-[10px] text-[var(--text-muted)]">评分权重</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1 mono break-all">
                Live / History / Timeout / Jitter = {weightLive} / {historyWeight} / {weightTimeout} / {weightJitter}
              </p>
            </div>
          </div>

          <div className="mt-4 max-h-[calc(100vh-320px)] overflow-y-auto p-1 space-y-2">
            {Array.from(grouped.entries()).map(([provider, indices]) => (
              <div key={provider} className="space-y-1">
                <div className="flex items-center justify-between px-2 pt-1">
                  <p className="text-[10px] uppercase text-[var(--text-muted)]">{provider}</p>
                  <span className="text-[10px] text-[var(--text-muted)]">{indices.length}</span>
                </div>
                {indices.map((i) => {
                  const n = nodes[i];
                  const ping = pingResults.get(i);
                  const health = nodeHealthMap.get(i);
                  const levelMeta = getLevelMeta(health?.level);
                  return (
                    <button
                      key={i}
                      onClick={() => scrollToNode(i)}
                      className={`w-full flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors cursor-pointer ${i === activeIndex ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'}`}
                    >
                      <span className="mono text-[10px] text-[var(--text-muted)] w-6 text-right">#{i}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-xs text-[var(--text-primary)]">{n.modelName || '(空)'}</span>
                        <span className="block truncate text-[10px] text-[var(--text-muted)]">{n.remark || '未备注'}</span>
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: levelMeta.bg, color: levelMeta.color }}>
                        {health?.score ?? 0}
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
                })}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className={`grid grid-cols-2 xl:grid-cols-5 ${density.summaryGrid} mb-4`}>
          <SummaryCard label="节点总数" value={String(nodes.length)} hint="当前 API 池规模" />
          <SummaryCard label="活跃节点" value={summary.activeNode} hint={`索引 #${activeIndex}`} />
          <SummaryCard label="健康 / 警告 / 风险" value={`${summary.healthy} / ${summary.warning} / ${summary.risk}`} hint="按当前评分结果统计" />
          <SummaryCard label="批量测试" value={batchPinging ? `${batchProgress.done}/${batchProgress.total || nodes.length}` : `${summary.tested} 个结果`} hint={batchPinging ? '测试进行中' : '当前会话已缓存结果'} />
          <SummaryCard label="保存状态" value={dirty ? '待保存' : '已同步'} hint={dirty ? '配置有改动，尚未写入文件' : '当前编辑状态已落盘'} tone={dirty ? 'warning' : 'neutral'} />
        </div>

        <Panel title="操作区" subtitle="主操作放在前面，低频管理项收进高级区。" padding="sm">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={save} disabled={!dirty}
              className={`px-4 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${dirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
              title="Ctrl+S">
              💾 保存
            </button>
            <button onClick={() => set({ ...state, nodes: [...nodes, { apiUrl: '', apiKey: '', modelName: '', remark: '', aiType: 'openai' }] })}
              className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--accent-purple)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer">
              + 新增节点
            </button>
            <button onClick={testAll} disabled={batchPinging}
              className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
              {batchPinging ? `⏳ 对全部 API 可用性测试中 (${batchProgress.done}/${batchProgress.total || nodes.length})` : '🔍 对全部API可用性测试'}
            </button>
            <button
              onClick={toggleAllApiKeyExpanded}
              disabled={nodes.length === 0}
              className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] transition-colors ${nodes.length === 0 ? 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed opacity-60' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer'}`}
            >
              {allApiKeyExpanded ? '收起全部API key栏' : '展开全部API key栏'}
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
                {showAdvancedToolbar ? '收起高级区' : '更多操作'}
              </button>
            </div>
          </div>

          {dirty && (
            <p className="mt-2 text-xs text-[var(--warning)]">当前有未保存改动，保存后才会写入配置文件与活跃节点设置。</p>
          )}

          {showAdvancedToolbar && (
            <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
                <div>
                  <p className="text-xs font-medium text-[var(--text-primary)]">高频外的管理操作</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">把低频动作收纳到这里，减少主工具栏拥挤。</p>
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
                  <p className="text-xs font-medium text-[var(--text-primary)]">评分权重面板</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">把评分调节从主操作里移开，但仍然随时可调。</p>
                </div>
                <WeightSlider label="Live" value={weightLive} onChange={setWeightLive} />
                <WeightSlider label="Timeout" value={weightTimeout} onChange={setWeightTimeout} />
                <WeightSlider label="Jitter" value={weightJitter} onChange={setWeightJitter} />
                <div className="text-[11px] text-[var(--text-muted)] mono">History 自动补足为 {historyWeight}%</div>
              </div>
            </div>
          )}
        </Panel>

        <div className="mb-3 rounded-[var(--radius-sm)] border border-[rgba(255,82,82,0.35)] bg-[rgba(255,82,82,0.08)] px-3 py-2">
          <p className="text-[11px] text-[var(--error)] leading-relaxed">
            安全提示：导出 API 配置或分享快照前，请确认是否包含 <span className="mono">api_config.json</span>。
            若不打算把全部 API Key 交给对方，请先删除该文件再分享；一旦泄露，可能需要去各平台删除/更换密钥来降低损失。
          </p>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          {nodes.length === 0 ? (
            <div className="flex items-center justify-center h-full rounded-[var(--radius)] border border-dashed border-[var(--border-subtle)]">
              <p className="text-sm text-[var(--text-muted)]">暂无 API 节点，点击“新增节点”开始配置。</p>
            </div>
          ) : displayedIndices.length === 0 ? (
            <div className="flex items-center justify-center h-full rounded-[var(--radius)] border border-dashed border-[var(--border-subtle)]">
              <p className="text-sm text-[var(--text-muted)]">当前筛选条件下没有匹配节点。</p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={displayedIndices} strategy={verticalListSortingStrategy}>
                <div className={density.contentGap}>
                  {displayedIndices.map((i) => (
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
                      onUpdate={updateNode}
                      onRemove={removeNode}
                      onClone={cloneNode}
                      onInsert={insertAfter}
                      onTest={testNode}
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
  onUpdate, onRemove, onClone, onInsert, onTest, onSetActive, onToggleSelect, onToggleKey, onToggleExpanded, cardRef,
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
  onUpdate: (i: number, field: keyof ApiNode, value: string) => void;
  onRemove: (i: number) => void;
  onClone: (i: number) => void;
  onInsert: (i: number) => void;
  onTest: (i: number) => void;
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
      style={{ ...style, boxShadow: 'var(--shadow-card)', background: 'var(--surface-card)' }}
      className={`rounded-[var(--radius)] border border-[var(--border-subtle)] transition-all duration-[240ms] overflow-hidden ${densityClass.cardPadding} ${isActive ? 'ring-1 ring-[var(--accent-purple)]' : ''} ${isSelected ? 'bg-[var(--nav-active-bg)]' : ''}`}
    >
      <div className={`flex flex-wrap items-start ${densityClass.cardGap}`}>
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
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)]" style={{ color: node.aiType === 'openai' ? 'var(--success)' : node.aiType === 'gemini' ? 'var(--info)' : 'var(--accent-pink)' }}>
                {node.aiType}
              </span>
              {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-purple)] text-white">活跃</span>}
              {isDuplicate && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,171,64,0.2)] text-[var(--warning)]">重复</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
              <span className="truncate max-w-[240px]">{node.remark || '未填写备注'}</span>
              <span>·</span>
              <span className="truncate max-w-[360px] mono">{node.apiUrl || '未填写 URL'}</span>
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
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: levelMeta.bg, color: levelMeta.color }} title={`来源: ${health?.source ?? 'none'}`}>
            {levelMeta.label} {health?.score ?? 0}
          </span>
          <button
            onClick={() => onToggleExpanded(index)}
            className="px-2.5 py-1.5 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            {isExpanded ? '收起API key栏' : '展开API key栏'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-1 block">接口类型</label>
              <select
                value={node.aiType}
                onChange={(e) => onUpdate(index, 'aiType', e.target.value)}
                className="w-full px-2.5 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] cursor-pointer"
              >
                <option value="openai">OpenAI</option>
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
                placeholder="备注"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-[var(--text-muted)] mb-1 block">API URL</label>
            <input
              value={node.apiUrl}
              onChange={(e) => onUpdate(index, 'apiUrl', e.target.value)}
              className={`w-full px-2.5 py-2 text-xs mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] ${!node.apiUrl ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'}`}
              placeholder="https://api.example.com/v1/chat/completions"
            />
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

        <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-[var(--text-primary)]">节点健康</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: levelMeta.bg, color: levelMeta.color }}>{health?.score ?? 0}</span>
            </div>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">{health?.reason ?? '暂无评分解释'}</p>
          </div>

          <MetricBar label="Live" score={health?.liveScore} weight={health?.liveWeight ?? 0} color="var(--accent-purple)" hint={pingResult?.pass ? `最近测试 ${pingResult.latency_ms}ms` : pingResult?.error || undefined} />
          <MetricBar label="History" score={health?.historyScore} weight={health?.historyWeight ?? 0} color="var(--info)" />
          <MetricBar label="Timeout" score={health?.timeoutScore} weight={health?.timeoutWeight ?? 0} color="var(--warning)" hint={health?.timeoutScore !== null && (health?.timeoutScore ?? 0) < 80 ? '超时占比偏高' : undefined} />
          <MetricBar label="Jitter" score={health?.jitterScore} weight={health?.jitterWeight ?? 0} color="var(--success)" hint={health?.jitterScore !== null && (health?.jitterScore ?? 0) < 80 ? '响应波动偏大' : undefined} />
        </div>
      </div>

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
