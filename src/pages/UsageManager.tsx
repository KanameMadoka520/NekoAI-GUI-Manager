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
import type { RuntimeConfig, UsageData, ImageUsageData, ImageQuotaConfig, ImageQuotaUserLimit } from '../lib/types';

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

function formatQuota(limit: number | null | undefined, isMaster = false) {
  if (isMaster) return '主人无限制';
  if (limit === null || limit === undefined || limit <= 0) return '不限额';
  return `${limit}`;
}

type GroupUsageRow = {
  gid: string;
  used: number;
  limit?: number;
  remaining?: number;
  listened: boolean;
  hasStoredCount: boolean;
};

type ImageQuotaRow = {
  uid: string;
  isMaster: boolean;
  hasOverride: boolean;
  hasStoredUsage: boolean;
  generateLimit: number | null;
  editLimit: number | null;
  generateUsed: number;
  editUsed: number;
  generateRemaining: number | null;
  editRemaining: number | null;
};

export function UsageManager() {
  const addToast = useUiStore((s) => s.addToast);

  const [groupUsage, setGroupUsage] = useState<UsageData>(() => normalizeUsage(null));
  const [imageUsage, setImageUsage] = useState<ImageUsageData>(() => normalizeImageUsage(null));
  const [imageQuota, setImageQuota] = useState<ImageQuotaConfig>(() => normalizeImageQuota(null));
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);

  const [groupOriginal, setGroupOriginal] = useState('');
  const [imageOriginal, setImageOriginal] = useState('');
  const [quotaOriginal, setQuotaOriginal] = useState('');

  const [loading, setLoading] = useState(true);
  const [groupSearch, setGroupSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [newGroupId, setNewGroupId] = useState('');
  const [newUserId, setNewUserId] = useState('');

  const [confirmResetGroup, setConfirmResetGroup] = useState(false);
  const [confirmDropUnknown, setConfirmDropUnknown] = useState(false);
  const [confirmResetImage, setConfirmResetImage] = useState(false);

  const groupDirty = useMemo(() => JSON.stringify(groupUsage) !== groupOriginal, [groupUsage, groupOriginal]);
  const imageDirty = useMemo(() => JSON.stringify(imageUsage) !== imageOriginal, [imageUsage, imageOriginal]);
  const quotaDirty = useMemo(() => JSON.stringify(imageQuota) !== quotaOriginal, [imageQuota, quotaOriginal]);

  useEffect(() => {
    void load();
  }, []);

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
      const normalizedQuota = normalizeImageQuota(runtimeConfig?.imageQuota);
      setGroupUsage(normalizedGroup);
      setImageUsage(normalizedImage);
      setImageQuota(normalizedQuota);
      setGroupOriginal(JSON.stringify(normalizedGroup));
      setImageOriginal(JSON.stringify(normalizedImage));
      setQuotaOriginal(JSON.stringify(normalizedQuota));
      setRuntime(runtimeConfig ?? null);
    } catch (e: any) {
      addToast('error', `加载用量/限额数据失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
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

  const imageRows = useMemo<ImageQuotaRow[]>(() => {
    const ids = new Set<string>([
      ...(runtime?.masterQQ ?? []),
      ...Object.keys(imageUsage.users ?? {}),
      ...Object.keys(imageQuota.userLimits ?? {}),
    ]);

    return [...ids]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((uid) => {
        const isMaster = (runtime?.masterQQ ?? []).includes(uid);
        const hasOverride = Object.prototype.hasOwnProperty.call(imageQuota.userLimits ?? {}, uid);
        const override = imageQuota.userLimits?.[uid];
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
          generateLimit,
          editLimit,
          generateUsed,
          editUsed,
          generateRemaining: generateLimit && generateLimit > 0 ? Math.max(generateLimit - generateUsed, 0) : null,
          editRemaining: editLimit && editLimit > 0 ? Math.max(editLimit - editUsed, 0) : null,
        };
      });
  }, [runtime?.masterQQ, imageUsage.users, imageQuota]);

  const filteredImageRows = useMemo(() => {
    if (!userSearch.trim()) return imageRows;
    const q = userSearch.trim().toLowerCase();
    return imageRows.filter((row) => row.uid.toLowerCase().includes(q));
  }, [imageRows, userSearch]);

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
      overrideUsers,
      totalGenerateUsed,
      totalEditUsed,
      exhaustedUsers,
    };
  }, [imageRows, imageQuota.userLimits]);

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
    setNewGroupId('');
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
      addToast('success', '群用量计数已保存');
    } catch (e: any) {
      addToast('error', `保存群用量失败: ${e?.message ?? e}`);
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
      addToast('error', '当前运行配置尚未加载完成，无法保存图像限额规则');
      return;
    }
    try {
      const normalized = normalizeImageQuota(imageQuota);
      const nextRuntime = { ...runtime, imageQuota: normalized };
      await saveConfig('runtime', nextRuntime);
      setRuntime(nextRuntime);
      setImageQuota(normalized);
      setQuotaOriginal(JSON.stringify(normalized));
      addToast('success', '图像限额规则已保存');
    } catch (e: any) {
      addToast('error', `保存图像限额规则失败: ${e?.message ?? e}`);
    }
  }

  function exportGroupUsage() {
    downloadJsonWithTimestamp(sanitizeUsage(groupUsage), 'group_usage_counts.json');
    addToast('success', '已导出群用量计数');
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
      addToast('success', '已导入群用量计数（请点击保存生效）');
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
        <StatCard label="图像统计用户" value={imageSummary.trackedUsers} icon="🖼️" color="var(--info)" />
        <StatCard label="图像单独限额" value={imageSummary.overrideUsers} icon="🎯" color="var(--warning)" />
        <SummaryCard label="群周期" value={groupUsage.periodId || '-'} hint="群聊 12 小时周期计数。" />
        <SummaryCard label="图像周期" value={imageUsage.periodId || '-'} hint="生图 / 修图 12 小时周期计数。" />
      </div>

      <Panel title="群用量管理" subtitle="这里改的是群聊 12 小时周期计数，不是图像限额。原有 groupLimits 规则仍然从 runtime_config.json 读取。" icon="⏱️">
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
                      <span className="mono text-[var(--text-secondary)]">{row.limit ?? '-'}</span>
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

      <Panel title="图像限额规则" subtitle="这里只管理生图 / 修图的额度规则：主人始终无限制，普通用户走全局额度，指定 QQ 可单独覆盖。默认周期与群用量一致，都是东八区 12 小时滚动。" icon="🖼️">
        <div className="space-y-4">
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
            <SummaryCard label="状态" value={imageQuota.enabled ? '已启用' : '未启用'} hint="关闭时，普通用户的图像额度检查整体失效。" tone={imageQuota.enabled ? 'success' : 'neutral'} />
            <SummaryCard label="默认生图额度" value={formatQuota(imageQuota.defaultGenerateLimit)} hint="0 表示不限额。生图如果使用 --count，会按实际 count 累加。" />
            <SummaryCard label="默认修图额度" value={formatQuota(imageQuota.defaultEditLimit)} hint="0 表示不限额。修图每次命令默认记 1 次。" />
            <SummaryCard label="单独限额用户" value={String(Object.keys(imageQuota.userLimits ?? {}).length)} hint="指定 QQ 的额度会覆盖全局默认额度。" />
            <SummaryCard label="已耗尽用户" value={String(imageSummary.exhaustedUsers)} hint="任一生图或修图额度耗尽，都会计入这里。" tone={imageSummary.exhaustedUsers > 0 ? 'warning' : 'neutral'} />
          </div>

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
              <span>主人 QQ：</span>
              <span className="mono break-all">{(runtime?.masterQQ ?? []).join(', ') || '未配置'}</span>
            </div>
            <div className="flex-1" />
            <button
              onClick={() => void saveImageQuotaRules()}
              disabled={!quotaDirty}
              className={`px-4 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${quotaDirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
            >
              💾 保存图像限额规则
            </button>
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
            <div className="grid grid-cols-[180px_120px_140px_140px_140px_120px] gap-3 px-4 py-3 text-[11px] text-[var(--text-muted)] bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
              <span>QQ</span>
              <span>身份</span>
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
                  <div key={row.uid} className="grid grid-cols-[180px_120px_140px_140px_140px_120px] gap-3 px-4 py-3 text-sm items-center">
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
                    <span className="text-[var(--text-muted)]">{row.isMaster ? '主人豁免' : row.hasOverride ? '单独规则' : '继承全局'}</span>
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
