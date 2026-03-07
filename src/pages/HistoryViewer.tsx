import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { StatCard } from '../components/common/StatCard';
import { SearchBar } from '../components/common/SearchBar';
import { Modal } from '../components/common/Modal';
import { ImportExportActions } from '../components/common/ImportExportActions';
import { Panel } from '../components/common/Panel';
import { SummaryCard } from '../components/common/SummaryCard';
import { useUiStore } from '../stores/uiStore';
import { listHistoryFiles, getHistoryFile, searchAllHistory, exportHistory, importHistoryFile } from '../lib/tauri-commands';
import { downloadTextWithTimestamp, pickJsonAndParse } from '../lib/json-transfer';
import type { HistoryFileMeta, HistoryEntry, SearchFilters, SearchResult, HistoryFilterPreset } from '../lib/types';

type ViewMode = 'standard' | 'user' | 'error' | 'search';

const PAGE_SIZES = [20, 50, 100];

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
];

const ERROR_COLORS = [
  'var(--error)',
  'var(--warning)',
  'var(--accent-pink)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-5)',
  'var(--chart-8)',
  'var(--info)',
];

// ===== Model color coding =====
function getModelColor(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('gpt')) return 'var(--model-gpt)';
  if (m.includes('claude')) return 'var(--model-claude)';
  if (m.includes('qwen')) return 'var(--model-qwen)';
  if (m.includes('gemini')) return 'var(--model-gemini)';
  if (m.includes('deepseek')) return 'var(--model-deepseek)';
  if (m.includes('glm') || m.includes('chatglm')) return 'var(--model-glm)';
  if (m.includes('llama')) return 'var(--model-llama)';
  if (m.includes('mixtral') || m.includes('mistral')) return 'var(--model-mistral)';
  return 'var(--text-muted)';
}

// ===== Error categorization =====
function categorizeError(reply: string): string {
  const r = (reply || '').toLowerCase();
  if (r.includes('403') || r.includes('forbidden') || r.includes('access denied')) return '403 Forbidden';
  if (r.includes('429') || r.includes('rate limit') || r.includes('too many request') || r.includes('quota')) return '429 Rate Limit';
  if (r.includes('timeout') || r.includes('timed out') || r.includes('超时') || r.includes('etimedout')) return 'Timeout';
  if (r.includes('500') || r.includes('internal server error')) return '500 Server Error';
  if (r.includes('502') || r.includes('bad gateway')) return '502 Bad Gateway';
  if (r.includes('503') || r.includes('service unavailable') || r.includes('overloaded')) return '503 Unavailable';
  if (r.includes('401') || r.includes('unauthorized') || (r.includes('invalid') && r.includes('key'))) return '401 Unauthorized';
  if (!reply.trim()) return '空回复';
  if (r.includes('content_filter') || r.includes('content filter') || r.includes('safety')) return '内容过滤';
  if (r.includes('context_length') || r.includes('token') && r.includes('limit')) return 'Token超限';
  return '其他错误';
}

function formatBytes(b: number) {
  if (b === 0) return '0 B';
  const k = 1024;
  const s = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${s[i]}`;
}

function formatTime(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTimeShort(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function isDayTime(iso: string) {
  if (!iso) return true;
  const h = new Date(iso).getHours();
  return h >= 6 && h < 18;
}

export function HistoryViewer() {
  const addToast = useUiStore((s) => s.addToast);
  const historyFilterPresets = useUiStore((s) => s.settings.historyFilterPresets);
  const updateHistoryFilterPresets = useUiStore((s) => s.updateHistoryFilterPresets);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<HistoryFileMeta[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('standard');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [showStats, setShowStats] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(true);
  const [targetEntryIndex, setTargetEntryIndex] = useState<number | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<string>('');
  const [searchModel, setSearchModel] = useState('');
  const [searchModels, setSearchModels] = useState<Set<string>>(new Set());
  const [searchErrorsOnly, setSearchErrorsOnly] = useState(false);
  const [searchFromTs, setSearchFromTs] = useState('');
  const [searchToTs, setSearchToTs] = useState('');
  const [searchErrorCategories, setSearchErrorCategories] = useState<Set<string>>(new Set());
  const [searchPresetName, setSearchPresetName] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const searchModelOptions = useMemo(() => {
    const modelCount = new Map<string, number>();
    entries.forEach((e) => {
      const model = (e.modelName || '').trim();
      if (!model) return;
      modelCount.set(model, (modelCount.get(model) ?? 0) + 1);
    });
    return Array.from(modelCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([model]) => model);
  }, [entries]);

  const searchErrorCategoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    entries
      .filter((e) => e.isError)
      .forEach((e) => {
        const cat = categorizeError(e.reply);
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat]) => cat);
  }, [entries]);

  const activeModelFilters = useMemo(() => {
    const set = new Set<string>();
    const single = searchModel.trim();
    if (single) set.add(single);
    searchModels.forEach((m) => {
      const mm = m.trim();
      if (mm) set.add(mm);
    });
    return Array.from(set);
  }, [searchModel, searchModels]);

  const activeErrorCategoryFilters = useMemo(() => Array.from(searchErrorCategories), [searchErrorCategories]);

  const searchStateSummary = useMemo(() => {
    const chips: string[] = [];
    if (searchType) chips.push(searchType === 'group' ? '群聊' : '私聊');
    if (searchErrorsOnly) chips.push('仅错误');
    if (activeModelFilters.length > 0) chips.push(`模型 ${activeModelFilters.length}`);
    if (activeErrorCategoryFilters.length > 0) chips.push(`错误类型 ${activeErrorCategoryFilters.length}`);
    if (searchFromTs || searchToTs) chips.push('时间范围');
    if (searchQuery.trim()) chips.push(`关键词：${searchQuery.trim()}`);
    return chips;
  }, [searchType, searchErrorsOnly, activeModelFilters, activeErrorCategoryFilters, searchFromTs, searchToTs, searchQuery]);

  const searchResultSummary = useMemo(() => {
    const fileCount = searchResults.length;
    const total = searchResults.reduce((s, r) => s + (r.entries?.length ?? 0), 0);
    return { fileCount, total };
  }, [searchResults]);

  // Markdown render
  const [renderMd, setRenderMd] = useState(false);

  // Timeline scroll ref
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadFiles(); }, []);

  async function loadFiles() {
    setLoading(true);
    try {
      const list = await listHistoryFiles();
      setFiles(list ?? []);
      if (list && list.length > 0 && !activeFile) {
        await loadFile(list[0].filename);
      }
    } catch (e: any) {
      addToast('error', `加载文件列表失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadFile(filename: string) {
    setActiveFile(filename);
    setPage(0);
    setErrorsOnly(false);
    try {
      const data = await getHistoryFile(filename);
      if (Array.isArray(data)) {
        setEntries(data);
      } else if (data?.raw) {
        setEntries([]);
        addToast('warning', '该文件非 JSON 格式，无法解析');
      } else {
        setEntries([]);
      }
    } catch (e: any) {
      addToast('error', `加载文件失败: ${e?.message ?? e}`);
      setEntries([]);
    }
  }

  function buildSearchFilters(): SearchFilters {
    const selectedModels = Array.from(searchModels);
    const selectedCats = Array.from(searchErrorCategories);
    return {
      chat_type: searchType || null,
      model: searchModel || null,
      models: selectedModels.length > 0 ? selectedModels : null,
      errors_only: searchErrorsOnly || null,
      from_ts: searchFromTs ? new Date(searchFromTs).toISOString() : null,
      to_ts: searchToTs ? new Date(searchToTs).toISOString() : null,
      error_categories: selectedCats.length > 0 ? selectedCats : null,
    };
  }

  function toggleSearchModel(model: string) {
    const next = new Set(searchModels);
    if (next.has(model)) next.delete(model); else next.add(model);
    setSearchModels(next);
  }

  function toggleSearchErrorCategory(cat: string) {
    const next = new Set(searchErrorCategories);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    setSearchErrorCategories(next);
  }

  function saveCurrentPreset() {
    const name = searchPresetName.trim();
    if (!name) {
      addToast('warning', '请先输入筛选方案名称');
      return;
    }
    const preset: HistoryFilterPreset = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      query: searchQuery,
      filters: buildSearchFilters(),
    };
    updateHistoryFilterPresets([...historyFilterPresets, preset]);
    setSearchPresetName('');
    addToast('success', `已保存筛选方案：${name}`);
  }

  function applyPreset(preset: HistoryFilterPreset) {
    const f = preset.filters || {};
    setSearchQuery(preset.query || '');
    setSearchType(f.chat_type || '');
    setSearchModel(f.model || '');
    setSearchModels(new Set(f.models ?? []));
    setSearchErrorsOnly(Boolean(f.errors_only));
    setSearchFromTs(f.from_ts ? f.from_ts.slice(0, 16) : '');
    setSearchToTs(f.to_ts ? f.to_ts.slice(0, 16) : '');
    setSearchErrorCategories(new Set(f.error_categories ?? []));
    addToast('success', `已应用筛选方案：${preset.name}`);
  }

  function deletePreset(presetId: string) {
    updateHistoryFilterPresets(historyFilterPresets.filter((p) => p.id !== presetId));
    addToast('success', '已删除筛选方案');
  }

  function clearAllSearchFilters() {
    setSearchQuery('');
    setSearchType('');
    setSearchModel('');
    setSearchModels(new Set());
    setSearchErrorsOnly(false);
    setSearchFromTs('');
    setSearchToTs('');
    setSearchErrorCategories(new Set());
  }

  async function doSearch() {
    setSearching(true);
    setViewMode('search');
    try {
      const results = await searchAllHistory(searchQuery, buildSearchFilters());
      setSearchResults(results ?? []);
      const total = results?.reduce((s, r) => s + r.entries.length, 0) ?? 0;
      addToast('success', `找到 ${total} 条结果`);
    } catch (e: any) {
      addToast('error', `搜索失败: ${e?.message ?? e}`);
    } finally {
      setSearching(false);
    }
  }

  async function doExport(format: 'json' | 'csv') {
    if (!activeFile) return;
    try {
      const content = await exportHistory(activeFile, format);
      const ext = format === 'json' ? 'json' : 'csv';
      const mime = format === 'json' ? 'application/json' : 'text/csv';
      downloadTextWithTimestamp(content, activeFile, mime, ext);
      addToast('success', `已导出 ${format.toUpperCase()}`);
    } catch (e: any) {
      addToast('error', `导出失败: ${e?.message ?? e}`);
    }
  }

  async function doImportCurrentHistoryFile() {
    if (!activeFile) {
      addToast('warning', '请先选择一个历史文件');
      return;
    }
    try {
      const picked = await pickJsonAndParse();
      if (!picked) return;
      if (!Array.isArray(picked.data)) {
        addToast('error', '导入失败：JSON 必须是数组');
        return;
      }
      await importHistoryFile(activeFile, picked.data);
      await loadFile(activeFile);
      addToast('success', `已导入并覆盖 ${activeFile}`);
    } catch (e: any) {
      addToast('error', `导入失败: ${e?.message ?? e}`);
    }
  }

  // ===== Filtered entries (with errors-only toggle) =====
  const displayEntries = useMemo(() => {
    if (errorsOnly) return entries.filter((e) => e.isError);
    return entries;
  }, [entries, errorsOnly]);

  // ===== Computed stats source =====
  const statsSourceEntries = useMemo(() => {
    if (viewMode !== 'search') return entries;
    return searchResults.flatMap((r) => r.entries ?? []);
  }, [viewMode, entries, searchResults]);

  // ===== Computed stats =====
  const stats = useMemo(() => {
    const total = statsSourceEntries.length;
    const errors = statsSourceEntries.filter((e) => e.isError).length;
    const success = total - errors;
    const errorRate = total > 0 ? ((errors / total) * 100).toFixed(1) : '0';
    const totalChars = statsSourceEntries.reduce((s, e) => s + (e.prompt?.length ?? 0) + (e.reply?.length ?? 0), 0);

    // Model counts
    const modelMap = new Map<string, { total: number; errors: number }>();
    statsSourceEntries.forEach((e) => {
      const m = e.modelName || '(unknown)';
      const cur = modelMap.get(m) ?? { total: 0, errors: 0 };
      cur.total++;
      if (e.isError) cur.errors++;
      modelMap.set(m, cur);
    });
    const models = Array.from(modelMap.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([name, data]) => ({
        name: name.length > 20 ? name.slice(0, 18) + '..' : name,
        fullName: name,
        count: data.total,
        errors: data.errors,
        color: getModelColor(name),
      }));

    // User counts
    const userMap = new Map<string, number>();
    statsSourceEntries.forEach((e) => {
      const u = e.username || e.userId || '(anonymous)';
      userMap.set(u, (userMap.get(u) ?? 0) + 1);
    });
    const users = Array.from(userMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({ name: name.length > 12 ? name.slice(0, 10) + '..' : name, count }));

    // Hourly distribution
    const hours = Array.from({ length: 24 }, (_, i) => ({ hour: `${i}`, count: 0 }));
    statsSourceEntries.forEach((e) => {
      if (e.timestamp) {
        const h = new Date(e.timestamp).getHours();
        if (h >= 0 && h < 24) hours[h].count++;
      }
    });

    // Node (apiRemark) counts
    const nodeMap = new Map<string, number>();
    statsSourceEntries.forEach((e) => {
      const r = e.apiRemark || '(none)';
      nodeMap.set(r, (nodeMap.get(r) ?? 0) + 1);
    });
    const nodesList = Array.from(nodeMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({ name: name.length > 20 ? name.slice(0, 18) + '..' : name, count }));

    // Error categorization
    const errorCatMap = new Map<string, number>();
    statsSourceEntries.filter((e) => e.isError).forEach((e) => {
      const cat = categorizeError(e.reply);
      errorCatMap.set(cat, (errorCatMap.get(cat) ?? 0) + 1);
    });
    const errorCategories = Array.from(errorCatMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    // Per-model error rates
    const modelErrors = Array.from(modelMap.entries())
      .filter(([, data]) => data.errors > 0)
      .sort((a, b) => b[1].errors - a[1].errors)
      .slice(0, 8)
      .map(([name, data]) => ({
        name: name.length > 20 ? name.slice(0, 18) + '..' : name,
        errors: data.errors,
        total: data.total,
        rate: ((data.errors / data.total) * 100).toFixed(1),
        color: getModelColor(name),
      }));

    return { total, success, errors, errorRate, totalChars, models, users, hours, nodes: nodesList, errorCategories, modelErrors };
  }, [statsSourceEntries]);

  // ===== Paged entries =====
  const pagedEntries = useMemo(() => {
    const start = page * pageSize;
    return displayEntries.slice(start, start + pageSize);
  }, [displayEntries, page, pageSize]);
  const totalPages = Math.max(1, Math.ceil(displayEntries.length / pageSize));

  // ===== Grouped by user =====
  const userGroups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    displayEntries.forEach((e) => {
      const u = e.username || e.userId || '(anonymous)';
      if (!map.has(u)) map.set(u, []);
      map.get(u)!.push(e);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [displayEntries]);

  // ===== Error entries =====
  const errorEntries = useMemo(() => entries.filter((e) => e.isError), [entries]);

  // ===== Timeline data =====
  const timelineEntries = useMemo(() => {
    return displayEntries.map((e, i) => ({
      index: i,
      time: formatTimeShort(e.timestamp),
      model: e.modelName || '?',
      color: getModelColor(e.modelName || ''),
      isError: e.isError,
    }));
  }, [displayEntries]);

  const pagedStart = page * pageSize;

  const scrollToEntry = useCallback((index: number) => {
    const targetPage = Math.floor(index / pageSize);
    setTargetEntryIndex(index);
    if (targetPage !== page) setPage(targetPage);
  }, [page, pageSize]);

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
    <div className="flex gap-4 h-full">
      <Panel title="历史文件" subtitle="先选择文件，再切换视图或进入全局搜索。" icon="🗂" padding="sm">
        <div className="text-xs text-[var(--text-muted)] mb-3">{files.length} 个文件</div>
        <div className="max-h-[calc(100vh-280px)] overflow-y-auto space-y-0.5">
          {files.map((f) => {
            const isDay = isDayTime(f.modified);
            return (
              <button
                key={f.filename}
                onClick={() => loadFile(f.filename)}
                className={`w-full text-left px-2.5 py-2 rounded-[var(--radius-sm)] text-xs transition-colors cursor-pointer
                  ${activeFile === f.filename
                    ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                  }`}
              >
                <div className="flex items-center gap-1.5">
                  <span>{isDay ? '☀' : '🌙'}</span>
                  <span className="flex-1 truncate mono">{f.filename.replace(/^history_/, '').replace(/\.json$/, '')}</span>
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5 pl-5">
                  {formatBytes(f.size)}
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      {/* Center: Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="rounded-[var(--radius)] border border-[var(--border-subtle)] px-3 py-2 flex items-center gap-2 mr-2" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
            <span className="text-[10px] text-[var(--text-muted)]">当前文件</span>
            <span className="text-xs mono text-[var(--text-secondary)] max-w-56 truncate">{activeFile ?? '未选择'}</span>
          </div>
          {([
            ['standard', '标准'],
            ['user', '用户'],
            ['error', '错误分析'],
            ['search', '搜索'],
          ] as [ViewMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer
                ${viewMode === mode
                  ? 'bg-[var(--accent-purple)] text-white border-transparent'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
            >
              {label}
            </button>
          ))}

          {/* Errors-only toggle */}
          <button
            onClick={() => { setErrorsOnly(!errorsOnly); setPage(0); }}
            className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer border
              ${errorsOnly
                ? 'bg-[var(--error-soft-bg)] border-[var(--error)] text-[var(--error)]'
                : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
          >
            ⚠ 仅异常 {errorsOnly && `(${stats.errors})`}
          </button>

          <div className="flex-1" />

          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
            <input type="checkbox" checked={renderMd} onChange={(e) => setRenderMd(e.target.checked)} className="accent-[var(--accent-purple)]" />
            MD
          </label>

          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer
              ${showTimeline
                ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)]'
                : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
          >
            📍 时间线
          </button>

          <button onClick={() => setShowStats(true)}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
            📊 统计
          </button>

          <ImportExportActions
            onExport={() => doExport('json')}
            onImport={doImportCurrentHistoryFile}
            exportLabel="JSON"
            importLabel="⬆ 导入"
            importDisabled={!activeFile}
            exportDisabled={!activeFile}
            confirmTitle="导入当前历史文件"
            size="xs"
          />
          <button onClick={() => doExport('csv')} disabled={!activeFile}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-30">
            CSV
          </button>
        </div>

        {viewMode === 'search' && (
          <div className="mb-3 rounded-[var(--radius)] border border-[var(--border-subtle)] px-4 py-3" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-[260px]">
                <SearchBar value={searchQuery} onChange={setSearchQuery} onEnter={doSearch} placeholder="输入关键词，支持 Enter 搜索...">
                  <select value={searchType} onChange={(e) => setSearchType(e.target.value)}
                    className="px-2 py-1 text-xs bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded text-[var(--text-secondary)] outline-none cursor-pointer">
                    <option value="">全部类型</option>
                    <option value="group">群聊</option>
                    <option value="private">私聊</option>
                  </select>
                </SearchBar>
              </div>
              <button onClick={doSearch} disabled={searching}
                className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60">
                {searching ? '搜索中...' : '搜索'}
              </button>
              <button
                onClick={() => setShowAdvancedSearch((v) => !v)}
                className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${showAdvancedSearch ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'}`}
              >
                {showAdvancedSearch ? '收起高级筛选' : '展开高级筛选'}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {searchStateSummary.length > 0 ? searchStateSummary.map((item) => (
                <span key={item} className="px-2 py-1 text-[10px] rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                  {item}
                </span>
              )) : (
                <span className="text-xs text-[var(--text-muted)]">当前仅按关键词/默认条件搜索，高级筛选未启用。</span>
              )}
              <div className="ml-auto text-xs text-[var(--text-muted)]">
                命中 <span className="mono text-[var(--text-secondary)]">{searchResultSummary.total}</span> 条 / <span className="mono text-[var(--text-secondary)]">{searchResultSummary.fileCount}</span> 个文件
              </div>
            </div>

            {showAdvancedSearch && (
              <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-3 bg-[var(--bg-elevated)]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={searchModel}
                      onChange={(e) => setSearchModel(e.target.value)}
                      className="min-w-0 flex-1 sm:flex-none sm:w-56 px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none cursor-pointer"
                      title="按已调用模型筛选"
                    >
                      <option value="">全部模型（单选）</option>
                      {searchModelOptions.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] cursor-pointer whitespace-nowrap">
                      <input type="checkbox" checked={searchErrorsOnly} onChange={(e) => setSearchErrorsOnly(e.target.checked)} className="accent-[var(--accent-purple)]" />
                      仅错误
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="text-xs text-[var(--text-muted)]">
                      开始时间
                      <input
                        type="datetime-local"
                        value={searchFromTs}
                        onChange={(e) => setSearchFromTs(e.target.value)}
                        className="mt-1 w-full px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none"
                      />
                    </label>
                    <label className="text-xs text-[var(--text-muted)]">
                      结束时间
                      <input
                        type="datetime-local"
                        value={searchToTs}
                        onChange={(e) => setSearchToTs(e.target.value)}
                        className="mt-1 w-full px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none"
                      />
                    </label>
                  </div>

                  <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2 bg-[var(--surface-card)]">
                    <p className="text-[10px] text-[var(--text-muted)] mb-1.5">模型多选</p>
                    {searchModelOptions.length === 0 ? (
                      <p className="text-xs text-[var(--text-muted)]">当前文件暂无模型数据</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                        {searchModelOptions.map((model) => (
                          <button
                            key={model}
                            onClick={() => toggleSearchModel(model)}
                            className={`px-2 py-1 text-[10px] rounded border transition-colors cursor-pointer ${searchModels.has(model) ? 'bg-[var(--nav-active-bg)] border-[var(--accent-purple)] text-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                          >
                            {model}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2 bg-[var(--surface-card)]">
                    <p className="text-[10px] text-[var(--text-muted)] mb-1.5">错误类型多选</p>
                    {searchErrorCategoryOptions.length === 0 ? (
                      <p className="text-xs text-[var(--text-muted)]">当前范围暂无错误类型</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                        {searchErrorCategoryOptions.map((cat) => (
                          <button
                            key={cat}
                            onClick={() => toggleSearchErrorCategory(cat)}
                            className={`px-2 py-1 text-[10px] rounded border transition-colors cursor-pointer ${searchErrorCategories.has(cat) ? 'bg-[var(--error-soft-bg)] border-[var(--error)] text-[var(--error)]' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-3 bg-[var(--bg-elevated)]">
                  <div className="space-y-2 text-xs text-[var(--text-muted)]">
                    <div>
                      当前生效模型筛选：
                      {activeModelFilters.length > 0 ? (
                        <span className="ml-1 text-[var(--text-secondary)] mono">{activeModelFilters.join('，')}</span>
                      ) : (
                        <span className="ml-1">未设置（全部模型）</span>
                      )}
                    </div>
                    {activeModelFilters.length > 0 && (
                      <div className="text-[10px] text-[var(--text-muted)]">当前为 AND 关系：单选模型与多选模型会同时生效。</div>
                    )}
                    <div>
                      当前时间范围：
                      <span className="ml-1 text-[var(--text-secondary)] mono">{searchFromTs || '起始不限'} ~ {searchToTs || '结束不限'}</span>
                    </div>
                    <div>
                      当前错误类型：
                      {activeErrorCategoryFilters.length > 0 ? (
                        <span className="ml-1 text-[var(--text-secondary)]">{activeErrorCategoryFilters.join('，')}</span>
                      ) : (
                        <span className="ml-1">未设置</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2 bg-[var(--surface-card)] space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={searchPresetName}
                        onChange={(e) => setSearchPresetName(e.target.value)}
                        placeholder="筛选方案名称"
                        className="flex-1 px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none"
                      />
                      <button
                        onClick={saveCurrentPreset}
                        className="px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 transition-colors cursor-pointer"
                      >
                        保存方案
                      </button>
                      <button
                        onClick={clearAllSearchFilters}
                        className="px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      >
                        清空筛选
                      </button>
                    </div>
                    {historyFilterPresets.length > 0 ? (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {historyFilterPresets.map((preset) => (
                          <div key={preset.id} className="flex items-center gap-2">
                            <button
                              onClick={() => applyPreset(preset)}
                              className="flex-1 text-left px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                            >
                              {preset.name}
                            </button>
                            <button
                              onClick={() => deletePreset(preset.id)}
                              className="px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,82,82,0.12)] text-[var(--error)] hover:bg-[rgba(255,82,82,0.2)] transition-colors cursor-pointer"
                            >
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--text-muted)]">还没有保存的筛选方案。</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-3">
          <SummaryCard label="当前范围" value={viewMode === 'search' ? '搜索视图' : activeFile ?? '未选择'} hint={viewMode === 'search' ? `命中 ${searchResultSummary.total} 条 / ${searchResultSummary.fileCount} 文件` : '当前文件与筛选范围概览'} />
          <StatCard label="成功" value={stats.success} icon="✓" color="var(--success)" />
          <StatCard label="异常" value={stats.errors} icon="✕" color="var(--error)" />
          <StatCard label="异常率" value={`${stats.errorRate}%`} icon="📉" color="var(--warning)" />
          <SummaryCard label="总字数" value={stats.totalChars.toLocaleString()} hint="按当前视图范围统计 prompt + reply 字数" tone="info" />
        </div>

        {/* Content area with optional timeline */}
        <div className="flex-1 flex gap-3 overflow-hidden">
          {/* Main content */}
          <div ref={contentRef} className="flex-1 overflow-y-auto pr-1">
            {viewMode === 'standard' && (
              <StandardView entries={pagedEntries} renderMd={renderMd} pageStart={pagedStart} targetEntryIndex={targetEntryIndex} />
            )}
            {viewMode === 'user' && (
              <UserView groups={userGroups} renderMd={renderMd} />
            )}
            {viewMode === 'error' && (
              <ErrorAnalysisView
                entries={errorEntries}
                errorCategories={stats.errorCategories}
                modelErrors={stats.modelErrors}
                renderMd={renderMd}
              />
            )}
            {viewMode === 'search' && (
              <SearchView results={searchResults} renderMd={renderMd} />
            )}
          </div>

          {/* Timeline sidebar */}
          {showTimeline && viewMode === 'standard' && (
            <TimelineSidebar
              entries={timelineEntries}
              currentPage={page}
              pageSize={pageSize}
              onJump={scrollToEntry}
            />
          )}
        </div>

        {/* Pagination (standard view only) */}
        {viewMode === 'standard' && displayEntries.length > pageSize && (
          <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)] mt-2">
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>每页</span>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                className="px-1.5 py-0.5 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded text-[var(--text-secondary)] outline-none cursor-pointer">
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="text-[var(--text-muted)]">
                共 {displayEntries.length} 条{errorsOnly ? ' (仅异常)' : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(0)} disabled={page === 0}
                className="px-2 py-1 text-xs rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer">
                ◀◀
              </button>
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                className="px-2 py-1 text-xs rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer">
                ◀
              </button>
              <span className="text-xs text-[var(--text-muted)] mono">{page + 1}/{totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                className="px-2 py-1 text-xs rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer">
                ▶
              </button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                className="px-2 py-1 text-xs rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer">
                ▶▶
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Stats modal */}
      <Modal open={showStats} onClose={() => setShowStats(false)} title="统计分析" width="720px">
        <div className="space-y-6">
          {/* Model usage with colors */}
          <div>
            <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">模型使用排行</h4>
            {stats.models.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-4">暂无数据</p>
            ) : (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.models} layout="vertical" margin={{ left: 0 }}>
                    <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} width={140} />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)' }}
                      labelStyle={{ color: 'var(--text-primary)' }}
                      formatter={(value, name) => [value, name === 'count' ? '调用数' : '错误数']}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {stats.models.map((m, i) => (
                        <Cell key={i} fill={m.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Error type breakdown */}
          {stats.errorCategories.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">错误类型分布</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.errorCategories}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {stats.errorCategories.map((_, i) => (
                          <Cell key={i} fill={ERROR_COLORS[i % ERROR_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5">
                  {stats.errorCategories.map((cat, i) => (
                    <div key={cat.name} className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: ERROR_COLORS[i % ERROR_COLORS.length] }}
                      />
                      <span className="flex-1 text-xs text-[var(--text-secondary)]">{cat.name}</span>
                      <span className="text-xs text-[var(--text-muted)] mono">{cat.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Per-model error rates */}
          {stats.modelErrors.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">各模型异常率</h4>
              <div className="space-y-1.5">
                {stats.modelErrors.map((m) => (
                  <div key={m.name} className="flex items-center gap-3 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: m.color }} />
                    <span className="w-36 text-[var(--text-secondary)] truncate">{m.name}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--error)]"
                        style={{ width: `${m.rate}%` }}
                      />
                    </div>
                    <span className="text-[var(--error)] mono w-12 text-right">{m.rate}%</span>
                    <span className="text-[var(--text-muted)] mono w-16 text-right">{m.errors}/{m.total}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* User ranking */}
          <ChartSection title="用户排行" data={stats.users} />
          {/* Node distribution */}
          <ChartSection title="节点分布" data={stats.nodes} />
          {/* Hourly distribution */}
          <div>
            <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">小时分布 (24h)</h4>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.hours}>
                  <XAxis dataKey="hour" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)' }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                    itemStyle={{ color: 'var(--accent-purple)' }}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {stats.hours.map((_, i) => (
                      <Cell key={i} fill={i >= 6 && i < 18 ? 'var(--chart-5)' : 'var(--border-hover)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ===== Chart helper =====
function ChartSection({ title, data }: { title: string; data: { name: string; count: number }[] }) {
  if (data.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">{title}</h4>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 0 }}>
            <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
            <Tooltip
              contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)' }}
              labelStyle={{ color: 'var(--text-primary)' }}
              itemStyle={{ color: 'var(--accent-purple)' }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ===== Timeline sidebar =====
function TimelineSidebar({ entries, currentPage, pageSize, onJump }: {
  entries: { index: number; time: string; model: string; color: string; isError: boolean }[];
  currentPage: number;
  pageSize: number;
  onJump: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewStart = currentPage * pageSize;
  const viewEnd = viewStart + pageSize;

  // Group timeline entries by time blocks to keep it manageable
  const grouped = useMemo(() => {
    if (entries.length <= 200) return entries;
    // Sample evenly for large datasets
    const step = Math.ceil(entries.length / 200);
    return entries.filter((_, i) => i % step === 0);
  }, [entries]);

  return (
    <div className="w-20 flex-shrink-0 rounded-[var(--radius)] overflow-hidden flex flex-col border border-[var(--border-subtle)]" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
      <div className="p-2 border-b border-[var(--border-subtle)] text-center">
        <span className="text-[10px] text-[var(--text-muted)]">时间线</span>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto py-1 px-1">
        {grouped.map((e) => {
          const inView = e.index >= viewStart && e.index < viewEnd;
          return (
            <button
              key={e.index}
              onClick={() => onJump(e.index)}
              className={`w-full flex items-center gap-1 px-1 py-[2px] rounded transition-colors cursor-pointer
                ${inView ? 'bg-[var(--nav-active-bg)]' : 'hover:bg-[var(--bg-elevated)]'}`}
              title={`#${e.index} ${e.model} ${e.time}`}
            >
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${e.isError ? 'ring-1 ring-[var(--error)]' : ''}`}
                style={{ background: e.isError ? 'var(--error)' : e.color }}
              />
              <span className="text-[9px] text-[var(--text-muted)] truncate mono">{e.time}</span>
            </button>
          );
        })}
      </div>
      <div className="p-2 border-t border-[var(--border-subtle)] text-center">
        <span className="text-[9px] text-[var(--text-muted)]">{entries.length} 条</span>
      </div>
    </div>
  );
}

// ===== View: Standard =====
function StandardView({ entries, renderMd, pageStart, targetEntryIndex }: {
  entries: HistoryEntry[];
  renderMd: boolean;
  pageStart: number;
  targetEntryIndex: number | null;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-[var(--text-muted)] text-center py-8">暂无记录</p>;
  }
  return (
    <div className="space-y-3">
      {entries.map((e, i) => {
        const entryIndex = pageStart + i;
        return (
          <ChatBubble
            key={entryIndex}
            entry={e}
            renderMd={renderMd}
            entryIndex={entryIndex}
            focus={targetEntryIndex === entryIndex}
          />
        );
      })}
    </div>
  );
}

// ===== View: User aggregated =====
function UserView({ groups, renderMd }: { groups: [string, HistoryEntry[]][]; renderMd: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(user: string) {
    const next = new Set(expanded);
    if (next.has(user)) next.delete(user); else next.add(user);
    setExpanded(next);
  }

  return (
    <div className="space-y-2">
      {groups.map(([user, items]) => {
        const errorCount = items.filter((e) => e.isError).length;
        return (
          <div key={user} className="rounded-[var(--radius)] overflow-hidden border border-[var(--border-subtle)]" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
            <button
              onClick={() => toggle(user)}
              className="w-full flex items-center justify-between px-6 py-3.5 text-sm cursor-pointer hover:bg-[var(--bg-elevated)] transition-colors rounded-[var(--radius)]"
            >
              <span className="text-[var(--text-primary)] font-medium">{user}</span>
              <div className="flex items-center gap-2">
                {errorCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--error-soft-bg)] text-[var(--error)]">
                    {errorCount} 错误
                  </span>
                )}
                <span className="text-xs text-[var(--text-muted)]">{items.length} 条</span>
                <span className="text-xs text-[var(--text-muted)]">{expanded.has(user) ? '▼' : '▶'}</span>
              </div>
            </button>
            {expanded.has(user) && (
              <div className="px-6 pb-4 space-y-2">
                {items.slice(0, 50).map((e, i) => (
                  <ChatBubble key={i} entry={e} renderMd={renderMd} compact />
                ))}
                {items.length > 50 && (
                  <p className="text-xs text-[var(--text-muted)] text-center py-1">...还有 {items.length - 50} 条</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ===== View: Error analysis (redesigned) =====
function ErrorAnalysisView({ entries, errorCategories, modelErrors, renderMd }: {
  entries: HistoryEntry[];
  errorCategories: { name: string; count: number }[];
  modelErrors: { name: string; errors: number; total: number; rate: string; color: string }[];
  renderMd: boolean;
}) {
  const [filterCat, setFilterCat] = useState<string | null>(null);

  const filteredEntries = useMemo(() => {
    if (!filterCat) return entries;
    return entries.filter((e) => categorizeError(e.reply) === filterCat);
  }, [entries, filterCat]);

  return (
    <div className="space-y-4">
      {/* Error category cards */}
      {errorCategories.length > 0 && (
        <div className="rounded-[var(--radius)] p-6 overflow-hidden border border-[var(--border-subtle)]" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
          <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">错误类型分类</h4>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterCat(null)}
              className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer border
                ${filterCat === null
                  ? 'bg-[var(--accent-purple)] text-white border-[var(--accent-purple)]'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                }`}
            >
              全部 ({entries.length})
            </button>
            {errorCategories.map((cat) => (
              <button
                key={cat.name}
                onClick={() => setFilterCat(filterCat === cat.name ? null : cat.name)}
                className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer border
                  ${filterCat === cat.name
                    ? 'bg-[var(--error-soft-bg)] text-[var(--error)] border-[var(--error)]'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                  }`}
              >
                {cat.name} ({cat.count})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Per-model error breakdown */}
      {modelErrors.length > 0 && (
        <div className="rounded-[var(--radius)] p-6 overflow-hidden border border-[var(--border-subtle)]" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
          <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">各模型异常统计</h4>
          <div className="space-y-2">
            {modelErrors.map((m) => (
              <div key={m.name} className="flex items-center gap-3 text-xs">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: m.color }} />
                <span className="w-36 text-[var(--text-secondary)] truncate">{m.name}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${m.rate}%`,
                      background:
                        Number(m.rate) > 50
                          ? 'var(--error)'
                          : Number(m.rate) > 20
                            ? 'var(--warning)'
                            : 'var(--success)',
                    }}
                  />
                </div>
                <span className="text-[var(--error)] mono w-12 text-right">{m.rate}%</span>
                <span className="text-[var(--text-muted)] mono w-20 text-right">{m.errors} / {m.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error list */}
      <div className="space-y-2">
        {filteredEntries.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">
            {entries.length === 0 ? '没有错误记录 🎉' : '没有匹配的错误'}
          </p>
        ) : (
          <>
            <p className="text-xs text-[var(--text-muted)]">
              显示 {filteredEntries.length} 条{filterCat ? ` "${filterCat}" 类型` : ''}错误
            </p>
            {filteredEntries.slice(0, 100).map((e, i) => (
              <ChatBubble key={i} entry={e} renderMd={renderMd} compact showErrorCategory />
            ))}
            {filteredEntries.length > 100 && (
              <p className="text-xs text-[var(--text-muted)] text-center py-2">...还有 {filteredEntries.length - 100} 条</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ===== View: Search results =====
function SearchView({ results, renderMd }: { results: SearchResult[]; renderMd: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(f: string) {
    const next = new Set(expanded);
    if (next.has(f)) next.delete(f); else next.add(f);
    setExpanded(next);
  }

  if (results.length === 0) {
    return <p className="text-sm text-[var(--text-muted)] text-center py-8">输入关键词后点击搜索</p>;
  }

  return (
    <div className="space-y-2">
      {results.map((r) => (
        <div key={r.filename} className="rounded-[var(--radius)] overflow-hidden border border-[var(--border-subtle)]" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
          <button
            onClick={() => toggle(r.filename)}
            className="w-full flex items-center justify-between px-6 py-3.5 text-sm cursor-pointer hover:bg-[var(--bg-elevated)] transition-colors rounded-[var(--radius)]"
          >
            <span className="text-[var(--text-primary)] mono text-xs">{r.filename}</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-purple)] text-white">{r.entries.length}</span>
              <span className="text-xs text-[var(--text-muted)]">{expanded.has(r.filename) ? '▼' : '▶'}</span>
            </div>
          </button>
          {expanded.has(r.filename) && (
            <div className="px-6 pb-4 space-y-2">
              {r.entries.map((e, i) => (
                <ChatBubble key={i} entry={e} renderMd={renderMd} compact />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ===== Chat bubble =====
function ChatBubble({ entry, renderMd: _renderMd, compact, showErrorCategory, entryIndex, focus }: {
  entry: HistoryEntry;
  renderMd: boolean;
  compact?: boolean;
  showErrorCategory?: boolean;
  entryIndex?: number;
  focus?: boolean;
}) {
  const e = entry;
  const modelColor = getModelColor(e.modelName || '');
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (focus) {
      bubbleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focus]);

  return (
    <div ref={bubbleRef} className={`space-y-1.5 ${compact ? '' : 'pb-2'}`}>
      {/* User message (right) */}
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          <div className="flex items-center justify-end gap-2 mb-0.5">
            {entryIndex != null && (
              <span className="text-[10px] text-[var(--text-muted)] mono">#{entryIndex}</span>
            )}
            <span className="text-[10px] text-[var(--text-muted)]">{formatTime(e.timestamp)}</span>
            <span className="text-[10px] text-[var(--info)]">{e.username || e.userId || '?'}</span>
            <span className="text-[10px] px-1 rounded bg-[var(--info-soft-bg)] text-[var(--info)]">
              {e.type === 'group' ? '群' : '私'}
            </span>
          </div>
          <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-xs text-[var(--text-secondary)] whitespace-pre-wrap break-words">
            {e.prompt?.trim() ? e.prompt : '(图片消息/无文本)'}
          </div>
        </div>
      </div>

      {/* AI reply (left) */}
      <div className="flex justify-start">
        <div className="max-w-[75%]">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] px-1 rounded bg-[var(--nav-active-bg)] text-[var(--accent-purple)]">AI</span>
            {e.modelName && (
              <span className="text-[10px] mono px-1 rounded" style={{ color: modelColor, background: `${modelColor}15` }}>
                {e.modelName}
              </span>
            )}
            {e.apiRemark && <span className="text-[10px] text-[var(--text-muted)]">{e.apiRemark}</span>}
          </div>
          <div className="mb-1 text-[10px] text-[var(--text-muted)] flex flex-wrap gap-2">
            {e.promptLength != null && <span>输入长度: {e.promptLength}</span>}
            {e.replyLength != null && <span>输出长度: {e.replyLength}</span>}
            {e.contextLength != null && <span>上下文长度: {e.contextLength}</span>}
            {e.responseTime != null && <span>响应时间: {e.responseTime}ms</span>}
          </div>
          <div className={`px-3 py-2 rounded-[var(--radius-sm)] text-xs whitespace-pre-wrap break-words
            ${e.isError
              ? 'bg-[var(--error-soft-bg)] border border-[var(--error)] text-[var(--text-secondary)]'
              : 'bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)]'
            }`}>
            {e.reply || '(空回复)'}
            {e.isError && (
              <span className="block mt-1 text-[10px] text-[var(--error)]">
                ⚠ {showErrorCategory ? categorizeError(e.reply) : '错误响应'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
