import { useEffect, useMemo, useState } from 'react';
import { StatCard } from '../components/common/StatCard';
import { SearchBar } from '../components/common/SearchBar';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ImportExportActions } from '../components/common/ImportExportActions';
import { Panel } from '../components/common/Panel';
import { SummaryCard } from '../components/common/SummaryCard';
import { useUiStore } from '../stores/uiStore';
import { getConfig, saveConfig } from '../lib/tauri-commands';
import { downloadJsonWithTimestamp, pickJsonAndParse } from '../lib/json-transfer';
import type { RuntimeConfig, UsageData } from '../lib/types';

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
  };
}

function sanitizeUsage(data: UsageData): UsageData {
  const counts: Record<string, number> = {};
  for (const [gid, raw] of Object.entries(data.counts ?? {})) {
    const groupId = gid.trim();
    const value = Math.max(0, Math.floor(Number(raw)));
    if (!groupId || !Number.isFinite(value) || value <= 0) continue;
    counts[groupId] = value;
  }
  return {
    periodId: data.periodId.trim() || getCurrentPeriodId(),
    counts,
  };
}

type UsageRow = {
  gid: string;
  used: number;
  limit?: number;
  remaining?: number;
  listened: boolean;
  hasStoredCount: boolean;
};

export function UsageManager() {
  const addToast = useUiStore((s) => s.addToast);
  const [usage, setUsage] = useState<UsageData>(() => normalizeUsage(null));
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [newGroupId, setNewGroupId] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDropUnknown, setConfirmDropUnknown] = useState(false);

  const dirty = useMemo(() => JSON.stringify(usage) !== original, [usage, original]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [usageData, runtimeConfig] = await Promise.all([
        getConfig<UsageData>('usage'),
        getConfig<RuntimeConfig>('runtime'),
      ]);
      const normalized = normalizeUsage(usageData);
      setUsage(normalized);
      setOriginal(JSON.stringify(normalized));
      setRuntime(runtimeConfig ?? null);
    } catch (e: any) {
      addToast('error', `加载用量数据失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo<UsageRow[]>(() => {
    const ids = new Set<string>([
      ...(runtime?.groups ?? []),
      ...Object.keys(usage.counts ?? {}),
    ]);

    return [...ids]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((gid) => {
        const used = Math.max(0, Math.floor(Number(usage.counts?.[gid] ?? 0)));
        const limit = runtime?.groupLimits?.[gid];
        const remaining = limit !== undefined ? Math.max(limit - used, 0) : undefined;
        return {
          gid,
          used,
          limit,
          remaining,
          listened: (runtime?.groups ?? []).includes(gid),
          hasStoredCount: Object.prototype.hasOwnProperty.call(usage.counts ?? {}, gid),
        };
      });
  }, [runtime, usage.counts]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((row) => row.gid.toLowerCase().includes(q));
  }, [rows, search]);

  const summary = useMemo(() => {
    const totalUsed = rows.reduce((sum, row) => sum + row.used, 0);
    const limitedGroups = rows.filter((row) => row.limit !== undefined).length;
    const exhausted = rows.filter((row) => row.limit !== undefined && row.used >= row.limit).length;
    return {
      totalGroups: rows.length,
      totalUsed,
      limitedGroups,
      exhausted,
    };
  }, [rows]);

  function updateCount(gid: string, raw: number) {
    const next = { ...usage.counts };
    const value = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(value)) return;
    next[gid] = value;
    setUsage({ ...usage, counts: next });
  }

  function removeCount(gid: string) {
    const next = { ...usage.counts };
    delete next[gid];
    setUsage({ ...usage, counts: next });
  }

  function addCustomGroup() {
    const gid = newGroupId.trim();
    if (!gid) return;
    if (rows.some((row) => row.gid === gid)) {
      addToast('warning', `群 ${gid} 已存在`);
      return;
    }
    setUsage({ ...usage, counts: { ...usage.counts, [gid]: 0 } });
    setNewGroupId('');
  }

  async function save() {
    try {
      const next = sanitizeUsage(usage);
      await saveConfig('usage', next);
      setUsage(next);
      setOriginal(JSON.stringify(next));
      addToast('success', '用量计数已保存');
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message ?? e}`);
    }
  }

  function exportUsage() {
    downloadJsonWithTimestamp(sanitizeUsage(usage), 'group_usage_counts.json');
    addToast('success', '已导出群用量计数');
  }

  async function importUsage() {
    try {
      const picked = await pickJsonAndParse();
      if (!picked) return;
      if (!picked.data || Array.isArray(picked.data) || typeof picked.data !== 'object') {
        addToast('error', '导入失败：JSON 必须是对象');
        return;
      }
      const imported = normalizeUsage(picked.data as UsageData);
      setUsage(imported);
      addToast('success', '已导入用量计数（请点击保存生效）');
    } catch (e: any) {
      addToast('error', `导入失败: ${e?.message ?? e}`);
    }
  }

  function resetCurrentPeriod() {
    setUsage({
      periodId: getCurrentPeriodId(),
      counts: {},
    });
    setConfirmReset(false);
  }

  function dropUnknownGroups() {
    const allowed = new Set(runtime?.groups ?? []);
    const next: Record<string, number> = {};
    for (const [gid, value] of Object.entries(usage.counts ?? {})) {
      if (allowed.has(gid)) next[gid] = value;
    }
    setUsage({ ...usage, counts: next });
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
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard label="群条目数" value={summary.totalGroups} icon="👥" color="var(--accent-purple)" />
        <StatCard label="总已用次数" value={summary.totalUsed} icon="⏱️" color="var(--accent-pink)" />
        <StatCard label="设有限流群" value={summary.limitedGroups} icon="📏" color="var(--info)" />
        <StatCard label="已耗尽群" value={summary.exhausted} icon="🚨" color="var(--error)" />
        <SummaryCard label="当前周期" value={usage.periodId || '-'} hint="插件会按东八区的白天 / 夜晚周期滚动统计，这里显示的是当前正在累计的那一段。" />
      </div>

      <Panel title="计数控制" subtitle="这里改的是已经发生过的调用计数，不是群聊开关或限流规则本身。" icon="⏱️">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[260px] flex-1">
              <SearchBar value={search} onChange={setSearch} placeholder="搜索群号..." />
            </div>
            <ImportExportActions
              onExport={exportUsage}
              onImport={importUsage}
              confirmTitle="导入群用量计数"
            />
            <button
              onClick={() => setConfirmDropUnknown(true)}
              className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              清理非监听群
            </button>
            <button
              onClick={() => setConfirmReset(true)}
              className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,82,82,0.15)] text-[var(--error)] hover:bg-[rgba(255,82,82,0.25)] cursor-pointer"
            >
              重置当前周期
            </button>
            <button
              onClick={save}
              disabled={!dirty}
              className={`px-4 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${dirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
            >
              💾 保存
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">周期标识</p>
              <input
                type="text"
                value={usage.periodId}
                onChange={(e) => setUsage({ ...usage, periodId: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
              />
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  onClick={() => setUsage({ ...usage, periodId: getCurrentPeriodId() })}
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
        </div>
      </Panel>

      <Panel title="群用量列表" subtitle="这里看到的“已用次数”来自当前计数文件；“限额”来自运行配置里的 groupLimits。" icon="📋">
        <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
          <div className="grid grid-cols-[180px_120px_120px_140px_1fr_96px] gap-3 px-4 py-3 text-[11px] text-[var(--text-muted)] bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
            <span>群号</span>
            <span>监听状态</span>
            <span>限额</span>
            <span>已用次数</span>
            <span>剩余 / 状态</span>
            <span className="text-right">操作</span>
          </div>

          <div className="max-h-[520px] overflow-y-auto divide-y divide-[var(--border-subtle)]">
            {filteredRows.length === 0 ? (
              <div className="px-6 py-10 text-sm text-[var(--text-muted)] text-center">没有找到符合条件的群条目。可以换个群号搜，或者先手动补一个群条目。</div>
            ) : (
              filteredRows.map((row) => {
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
                    <span className="mono text-[var(--text-secondary)]">{row.limit ?? '-'}</span>
                    <input
                      type="number"
                      min={0}
                      value={row.used}
                      onChange={(e) => updateCount(row.gid, Number(e.target.value))}
                      className="w-28 px-2 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)]"
                    />
                    <span style={{ color: statusColor }}>{statusText}</span>
                    <div className="flex justify-end gap-2">
                      {row.hasStoredCount && (
                        <button
                          onClick={() => removeCount(row.gid)}
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
      </Panel>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={resetCurrentPeriod}
        title="重置当前周期"
        message="这会把周期标识切到当前东八区时间段，并把所有已用次数清空。这里确认后只是进入待保存状态，真正写回文件还要再点一次保存。"
        confirmText="确认重置"
      />

      <ConfirmDialog
        open={confirmDropUnknown}
        onClose={() => setConfirmDropUnknown(false)}
        onConfirm={dropUnknownGroups}
        title="只保留监听中的群"
        message="这会把不在 runtime.groups 里的群计数从列表中移掉。适合清理旧群或误加的群。这里确认后只是进入待保存状态，真正写回文件还要再点一次保存。"
        confirmText="确认清理"
      />
    </div>
  );
}
