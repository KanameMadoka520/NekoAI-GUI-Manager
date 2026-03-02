import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { StatCard } from '../components/common/StatCard';
import { SearchBar } from '../components/common/SearchBar';
import { Modal } from '../components/common/Modal';
import { useUiStore } from '../stores/uiStore';
import { listHistoryFiles, getHistoryFile, searchAllHistory, exportHistory } from '../lib/tauri-commands';
import type { HistoryFileMeta, HistoryEntry, SearchFilters, SearchResult } from '../lib/types';

type ViewMode = 'standard' | 'user' | 'error' | 'search';

const PAGE_SIZES = [20, 50, 100];
const CHART_COLORS = ['#0ea5e9', '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

// ===== Model color coding =====
function getModelColor(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('gpt')) return '#00e676';
  if (m.includes('claude')) return '#c084fc';
  if (m.includes('qwen')) return '#ffab40';
  if (m.includes('gemini')) return '#22d3ee';
  if (m.includes('deepseek')) return '#38bdf8';
  if (m.includes('glm') || m.includes('chatglm')) return '#f87171';
  if (m.includes('llama')) return '#a78bfa';
  if (m.includes('mixtral') || m.includes('mistral')) return '#fb923c';
  return '#94a3b8';
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
  if (r.includes('401') || r.includes('unauthorized') || r.includes('invalid.*key')) return '401 Unauthorized';
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

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<string>('');
  const [searchModel, setSearchModel] = useState('');
  const [searchErrorsOnly, setSearchErrorsOnly] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

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

  async function doSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setViewMode('search');
    try {
      const filters: SearchFilters = {
        chat_type: searchType || null,
        model: searchModel || null,
        errors_only: searchErrorsOnly || null,
      };
      const results = await searchAllHistory(searchQuery, filters);
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
      const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeFile.replace(/\.\w+$/, '')}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('success', `已导出 ${format.toUpperCase()}`);
    } catch (e: any) {
      addToast('error', `导出失败: ${e?.message ?? e}`);
    }
  }

  // ===== Filtered entries (with errors-only toggle) =====
  const displayEntries = useMemo(() => {
    if (errorsOnly) return entries.filter((e) => e.isError);
    return entries;
  }, [entries, errorsOnly]);

  // ===== Computed stats =====
  const stats = useMemo(() => {
    const total = entries.length;
    const errors = entries.filter((e) => e.isError).length;
    const success = total - errors;
    const errorRate = total > 0 ? ((errors / total) * 100).toFixed(1) : '0';
    const totalTokens = entries.reduce((s, e) => s + (e.promptLength ?? 0) + (e.replyLength ?? 0), 0);

    // Model counts
    const modelMap = new Map<string, { total: number; errors: number }>();
    entries.forEach((e) => {
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
    entries.forEach((e) => {
      const u = e.username || e.userId || '(anonymous)';
      userMap.set(u, (userMap.get(u) ?? 0) + 1);
    });
    const users = Array.from(userMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({ name: name.length > 12 ? name.slice(0, 10) + '..' : name, count }));

    // Hourly distribution
    const hours = Array.from({ length: 24 }, (_, i) => ({ hour: `${i}`, count: 0 }));
    entries.forEach((e) => {
      if (e.timestamp) {
        const h = new Date(e.timestamp).getHours();
        if (h >= 0 && h < 24) hours[h].count++;
      }
    });

    // Node (apiRemark) counts
    const nodeMap = new Map<string, number>();
    entries.forEach((e) => {
      const r = e.apiRemark || '(none)';
      nodeMap.set(r, (nodeMap.get(r) ?? 0) + 1);
    });
    const nodesList = Array.from(nodeMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({ name: name.length > 20 ? name.slice(0, 18) + '..' : name, count }));

    // Error categorization
    const errorCatMap = new Map<string, number>();
    entries.filter((e) => e.isError).forEach((e) => {
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

    return { total, success, errors, errorRate, totalTokens, models, users, hours, nodes: nodesList, errorCategories, modelErrors };
  }, [entries]);

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

  const scrollToEntry = useCallback((index: number) => {
    const targetPage = Math.floor(index / pageSize);
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
      {/* Left: File list */}
      <div className="w-52 flex-shrink-0 flex flex-col bg-white rounded-[var(--radius)] overflow-hidden" style={{ boxShadow: 'var(--shadow-3d)' }}>
        <div className="px-5 py-3 border-b border-[var(--border-subtle)]">
          <p className="text-xs text-[var(--text-muted)]">{files.length} 个文件</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {files.map((f) => {
            const isDay = isDayTime(f.modified);
            return (
              <button
                key={f.filename}
                onClick={() => loadFile(f.filename)}
                className={`w-full text-left px-2.5 py-2 rounded-[var(--radius-sm)] text-xs transition-colors cursor-pointer
                  ${activeFile === f.filename
                    ? 'bg-[rgba(14,165,233,0.15)] text-[var(--accent-purple)]'
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
      </div>

      {/* Center: Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {/* View mode tabs */}
          <div className="flex rounded-[var(--radius-sm)] overflow-hidden border border-[var(--border-subtle)]">
            {([
              ['standard', '标准'],
              ['user', '用户'],
              ['error', '错误分析'],
              ['search', '搜索'],
            ] as [ViewMode, string][]).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-xs transition-colors cursor-pointer
                  ${viewMode === mode
                    ? 'bg-[var(--accent-purple)] text-white'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Errors-only toggle */}
          <button
            onClick={() => { setErrorsOnly(!errorsOnly); setPage(0); }}
            className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer border
              ${errorsOnly
                ? 'bg-[rgba(255,82,82,0.15)] border-[var(--error)] text-[var(--error)]'
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
                ? 'bg-[rgba(14,165,233,0.15)] text-[var(--accent-purple)]'
                : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
          >
            📍 时间线
          </button>

          <button onClick={() => setShowStats(true)}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
            📊 统计
          </button>

          <button onClick={() => doExport('json')} disabled={!activeFile}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-30">
            JSON
          </button>
          <button onClick={() => doExport('csv')} disabled={!activeFile}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-30">
            CSV
          </button>
        </div>

        {/* Search bar (for search mode) */}
        {viewMode === 'search' && (
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1">
              <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="多关键词用空格分隔...">
                <select value={searchType} onChange={(e) => setSearchType(e.target.value)}
                  className="px-2 py-1 text-xs bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded text-[var(--text-secondary)] outline-none cursor-pointer">
                  <option value="">全部类型</option>
                  <option value="group">群聊</option>
                  <option value="private">私聊</option>
                </select>
              </SearchBar>
            </div>
            <input
              value={searchModel}
              onChange={(e) => setSearchModel(e.target.value)}
              placeholder="模型筛选"
              className="w-28 px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-purple)]"
            />
            <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={searchErrorsOnly} onChange={(e) => setSearchErrorsOnly(e.target.checked)} className="accent-[var(--accent-purple)]" />
              仅错误
            </label>
            <button onClick={doSearch} disabled={searching}
              className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 transition-colors cursor-pointer">
              {searching ? '搜索中...' : '搜索'}
            </button>
          </div>
        )}

        {/* Stat cards row */}
        <div className="grid grid-cols-5 gap-3 mb-3">
          <StatCard label="总调用" value={stats.total} icon="📞" color="var(--accent-purple)" />
          <StatCard label="成功" value={stats.success} icon="✓" color="var(--success)" />
          <StatCard label="异常" value={stats.errors} icon="✕" color="var(--error)" />
          <StatCard label="异常率" value={`${stats.errorRate}%`} icon="📉" color="var(--warning)" />
          <StatCard label="Token" value={stats.totalTokens.toLocaleString()} icon="🔤" color="var(--info)" />
        </div>

        {/* Content area with optional timeline */}
        <div className="flex-1 flex gap-3 overflow-hidden">
          {/* Main content */}
          <div ref={contentRef} className="flex-1 overflow-y-auto pr-1">
            {viewMode === 'standard' && (
              <StandardView entries={pagedEntries} renderMd={renderMd} />
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
                    <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={140} />
                    <Tooltip
                      contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#1e293b' }}
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
                          <Cell key={i} fill={['#ff5252', '#ffab40', '#818cf8', '#ff6b6b', '#f87171', '#fb923c', '#fbbf24', '#a78bfa'][i % 8]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5">
                  {stats.errorCategories.map((cat, i) => (
                    <div key={cat.name} className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: ['#ff5252', '#ffab40', '#818cf8', '#ff6b6b', '#f87171', '#fb923c', '#fbbf24', '#a78bfa'][i % 8] }}
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
                  <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip
                    contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#1e293b' }}
                    itemStyle={{ color: '#0ea5e9' }}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {stats.hours.map((_, i) => (
                      <Cell key={i} fill={i >= 6 && i < 18 ? '#f59e0b' : '#cbd5e1'} />
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
            <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
            <Tooltip
              contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#1e293b' }}
              itemStyle={{ color: '#0ea5e9' }}
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
    <div className="w-20 flex-shrink-0 bg-white rounded-[var(--radius)] overflow-hidden flex flex-col">
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
                ${inView ? 'bg-[rgba(14,165,233,0.1)]' : 'hover:bg-[var(--bg-elevated)]'}`}
              title={`#${e.index} ${e.model} ${e.time}`}
            >
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${e.isError ? 'ring-1 ring-[var(--error)]' : ''}`}
                style={{ background: e.isError ? '#ff5252' : e.color }}
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
function StandardView({ entries, renderMd }: { entries: HistoryEntry[]; renderMd: boolean }) {
  if (entries.length === 0) {
    return <p className="text-sm text-[var(--text-muted)] text-center py-8">暂无记录</p>;
  }
  return (
    <div className="space-y-3">
      {entries.map((e, i) => (
        <ChatBubble key={i} entry={e} renderMd={renderMd} />
      ))}
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
          <div key={user} className="bg-white rounded-[var(--radius)] overflow-hidden" style={{ boxShadow: "var(--shadow-3d)" }}>
            <button
              onClick={() => toggle(user)}
              className="w-full flex items-center justify-between px-6 py-3.5 text-sm cursor-pointer hover:bg-[var(--bg-elevated)] transition-colors rounded-[var(--radius)]"
            >
              <span className="text-[var(--text-primary)] font-medium">{user}</span>
              <div className="flex items-center gap-2">
                {errorCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,82,82,0.15)] text-[var(--error)]">
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
        <div className="bg-white rounded-[var(--radius)] p-6 overflow-hidden" style={{ boxShadow: "var(--shadow-3d)" }}>
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
                    ? 'bg-[rgba(255,82,82,0.2)] text-[var(--error)] border-[var(--error)]'
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
        <div className="bg-white rounded-[var(--radius)] p-6 overflow-hidden" style={{ boxShadow: "var(--shadow-3d)" }}>
          <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">各模型异常统计</h4>
          <div className="space-y-2">
            {modelErrors.map((m) => (
              <div key={m.name} className="flex items-center gap-3 text-xs">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: m.color }} />
                <span className="w-36 text-[var(--text-secondary)] truncate">{m.name}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${m.rate}%`, background: Number(m.rate) > 50 ? '#ff5252' : Number(m.rate) > 20 ? '#ffab40' : '#00e676' }}
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
        <div key={r.filename} className="bg-white rounded-[var(--radius)] overflow-hidden" style={{ boxShadow: "var(--shadow-3d)" }}>
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
function ChatBubble({ entry, renderMd: _renderMd, compact, showErrorCategory }: {
  entry: HistoryEntry;
  renderMd: boolean;
  compact?: boolean;
  showErrorCategory?: boolean;
}) {
  const e = entry;
  const modelColor = getModelColor(e.modelName || '');

  return (
    <div className={`space-y-1.5 ${compact ? '' : 'pb-2'}`}>
      {/* User message (right) */}
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          <div className="flex items-center justify-end gap-2 mb-0.5">
            <span className="text-[10px] text-[var(--text-muted)]">{formatTime(e.timestamp)}</span>
            <span className="text-[10px] text-[var(--info)]">{e.username || e.userId || '?'}</span>
            <span className="text-[10px] px-1 rounded bg-[rgba(147,197,253,0.15)] text-[var(--info)]">
              {e.type === 'group' ? '群' : '私'}
            </span>
          </div>
          <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-xs text-[var(--text-secondary)] whitespace-pre-wrap break-words">
            {e.prompt || '(空)'}
          </div>
        </div>
      </div>

      {/* AI reply (left) */}
      <div className="flex justify-start">
        <div className="max-w-[75%]">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] px-1 rounded bg-[rgba(14,165,233,0.15)] text-[var(--accent-purple)]">AI</span>
            {e.modelName && (
              <span className="text-[10px] mono px-1 rounded" style={{ color: modelColor, background: `${modelColor}15` }}>
                {e.modelName}
              </span>
            )}
            {e.apiRemark && <span className="text-[10px] text-[var(--text-muted)]">{e.apiRemark}</span>}
            {e.promptLength != null && e.replyLength != null && (
              <span className="text-[10px] text-[var(--text-muted)] mono">
                {e.promptLength}→{e.replyLength}
              </span>
            )}
          </div>
          <div className={`px-3 py-2 rounded-[var(--radius-sm)] text-xs whitespace-pre-wrap break-words
            ${e.isError
              ? 'bg-[rgba(255,82,82,0.08)] border border-[var(--error)] text-[var(--text-secondary)]'
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
