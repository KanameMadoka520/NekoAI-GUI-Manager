import { useEffect, useMemo, useState } from 'react';
import { StatCard } from '../components/common/StatCard';
import { Panel } from '../components/common/Panel';
import { SummaryCard, MiniInfo } from '../components/common/SummaryCard';
import { DeferredVisibleBlock } from '../components/common/DeferredVisibleBlock';
import { useUiStore } from '../stores/uiStore';
import {
  listSnapshots,
  createSnapshot,
  rollbackSnapshot,
  diffSnapshots,
  exportDeployPackage,
  saveCurrentAsEnvTemplate,
  previewEnvTemplate,
  applyEnvTemplate,
  runStartupSelfCheck,
  applySelfCheckFixes,
  listAuditLogs,
} from '../lib/tauri-commands';
import type { SelfCheckReport, SnapshotMeta, SnapshotDiff } from '../lib/types';
import { explainSelfCheckItem } from '../lib/human-issues';

const ENVS = [
  { key: 'dev' as const, label: '开发' },
  { key: 'test' as const, label: '测试' },
  { key: 'prod' as const, label: '生产' },
];

export function OpsCenter() {
  const addToast = useUiStore((s) => s.addToast);
  const settings = useUiStore((s) => s.settings);
  const lowPerformanceMode = settings.renderMode === 'lite';
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selectedLeft, setSelectedLeft] = useState('');
  const [selectedRight, setSelectedRight] = useState('');
  const [diffResult, setDiffResult] = useState<SnapshotDiff | null>(null);
  const [selfCheck, setSelfCheck] = useState<SelfCheckReport | null>(null);
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSnapshotTools, setShowSnapshotTools] = useState(!lowPerformanceMode);
  const [showEnvTools, setShowEnvTools] = useState(!lowPerformanceMode);
  const [selfCheckFilter, setSelfCheckFilter] = useState<'all' | 'error' | 'warn' | 'fixable' | 'usage-events'>('all');
  const [showSnapshotDetails, setShowSnapshotDetails] = useState(!lowPerformanceMode);
  const [showEnvDetails, setShowEnvDetails] = useState(!lowPerformanceMode);
  const [showSelfCheckDetails, setShowSelfCheckDetails] = useState(true);
  const [showAuditDetails, setShowAuditDetails] = useState(!lowPerformanceMode);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!lowPerformanceMode) return;
    setShowSnapshotDetails(false);
    setShowEnvDetails(false);
    setShowAuditDetails(false);
    setShowSnapshotTools(false);
    setShowEnvTools(false);
  }, [lowPerformanceMode]);

  async function loadAll() {
    setLoading(true);
    try {
      const [snaps, audits] = await Promise.all([
        listSnapshots(),
        listAuditLogs(120),
      ]);
      setSnapshots(snaps ?? []);
      setAuditRows(audits ?? []);
      if ((snaps?.length ?? 0) >= 2) {
        setSelectedLeft(snaps![1].snapshot_id);
        setSelectedRight(snaps![0].snapshot_id);
      }
    } catch (e: any) {
      addToast('error', `加载安全发布中心失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  const latestSnapshot = snapshots[0]?.snapshot_id ?? '-';

  const checkStats = useMemo(() => {
    if (!selfCheck) return { errors: 0, warns: 0, infos: 0, fixable: 0, usageEvents: 0, total: 0 };
    const errors = selfCheck.items.filter((x) => x.level === 'error').length;
    const warns = selfCheck.items.filter((x) => x.level === 'warn').length;
    const infos = selfCheck.items.filter((x) => x.level === 'info').length;
    const fixable = selfCheck.items.filter((x) => x.fixable).length;
    const usageEvents = selfCheck.items.filter((x) => x.code.startsWith('usageEvents.')).length;
    return { errors, warns, infos, fixable, usageEvents, total: selfCheck.items.length };
  }, [selfCheck]);

  const filteredSelfCheckItems = useMemo(() => {
    if (!selfCheck) return [];
    return selfCheck.items.filter((item) => {
      if (selfCheckFilter === 'all') return true;
      if (selfCheckFilter === 'fixable') return item.fixable;
      if (selfCheckFilter === 'usage-events') return item.code.startsWith('usageEvents.');
      return item.level === selfCheckFilter;
    });
  }, [selfCheck, selfCheckFilter]);

  const usageEventCheckHighlights = useMemo(() => {
    if (!selfCheck) return [];
    return selfCheck.items.filter((item) => item.code.startsWith('usageEvents.')).slice(0, 3);
  }, [selfCheck]);

  async function doCreateSnapshot() {
    setBusy('snapshot');
    try {
      const id = await createSnapshot('manual', 'gui');
      addToast('success', `已创建快照 ${id}。如果接下来要做高风险改动，现在就有一个可回退的安全点了。`);
      await loadAll();
    } catch (e: any) {
      addToast('error', `创建快照失败: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  async function doRollback(snapshotId: string) {
    if (!snapshotId) return;
    setBusy('rollback');
    try {
      await rollbackSnapshot(snapshotId);
      addToast('success', `已回滚到快照 ${snapshotId}。建议接着回到概览页或配置页，确认当前状态是不是你想要的。`);
    } catch (e: any) {
      addToast('error', `回滚失败: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  async function doDiff() {
    if (!selectedLeft || !selectedRight) {
      addToast('warning', '请先选择左右两个快照');
      return;
    }
    setBusy('diff');
    try {
      const diff = await diffSnapshots(selectedLeft, selectedRight);
      setDiffResult(diff);
      addToast('success', `差异分析完成，共看到 ${diff.changed_files.length} 个文件有变化。你可以先看清差异，再决定要不要回滚。`);
    } catch (e: any) {
      addToast('error', `差异分析失败: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  async function doExportPackage() {
    setBusy('deploy');
    try {
      const r = await exportDeployPackage();
      addToast('success', `部署包已导出：${r.package_name}。分享前记得再检查一遍里面有没有你不想带出去的敏感文件。`);
      await loadAll();
    } catch (e: any) {
      addToast('error', `导出部署包失败: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  async function doSaveEnvTemplate(env: 'dev' | 'test' | 'prod') {
    setBusy(`save-env-${env}`);
    try {
      await saveCurrentAsEnvTemplate(env);
      addToast('success', `已保存 ${env} 环境模板`);
      await loadAll();
    } catch (e: any) {
      addToast('error', `保存模板失败: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  async function doPreviewEnv(env: 'dev' | 'test' | 'prod') {
    setBusy(`preview-env-${env}`);
    try {
      const preview = await previewEnvTemplate(env);
      addToast('success', `${env} 模板预计会改动 ${preview.changed_files.length} 个文件。先预览再应用，通常更稳。`);
    } catch (e: any) {
      addToast('error', `预览模板失败: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  async function doApplyEnv(env: 'dev' | 'test' | 'prod') {
    setBusy(`apply-env-${env}`);
    try {
      await applyEnvTemplate(env);
      addToast('success', `已应用 ${env} 模板，并自动生成快照。若结果不对，你可以直接回滚到刚才的快照。`);
      await loadAll();
    } catch (e: any) {
      addToast('error', `应用模板失败: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  async function doSelfCheck() {
    setBusy('self-check');
    try {
      const report = await runStartupSelfCheck();
      setSelfCheck(report);
      addToast(report.ok ? 'success' : 'warning', report.ok ? '自检通过，当前没有明显风险。' : '自检发现需要处理的问题，建议先看下面的说明。');
      await loadAll();
    } catch (e: any) {
      addToast('error', `启动自检失败: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  async function doFixSelfCheck() {
    setBusy('self-fix');
    try {
      const changed = await applySelfCheckFixes();
      addToast('success', changed.length > 0 ? `已自动修复 ${changed.length} 项。建议你再跑一次自检确认结果。` : '没有找到适合自动修复的项目。');
      if (selfCheck) {
        await doSelfCheck();
      }
    } catch (e: any) {
      addToast('error', `自动修复失败: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="text-4xl block mb-3 animate-bounce">🛡️</span>
          <p className="text-[var(--text-secondary)]">加载中...</p>
        </div>
      </div>
    );
  }

  const densityGap = settings.contentDensity === 'spacious' ? 'gap-5' : settings.contentDensity === 'compact' ? 'gap-3' : 'gap-4';

  return (
    <div className="space-y-4">
      {lowPerformanceMode ? (
        <Panel title="快速概览" subtitle="低性能模式下先给你看轻摘要，详细工具区按需展开。" icon="⚡" padding="sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">快照 {snapshots.length}</span>
            <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">最新 {latestSnapshot === '-' ? '-' : latestSnapshot.slice(-8)}</span>
            <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">审计 {auditRows.length}</span>
            <span className={`px-2 py-1 rounded-[var(--radius-sm)] border ${checkStats.total > 0 ? 'border-[var(--warning-soft-border)] bg-[var(--warning-soft-bg)] text-[var(--warning)]' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'}`}>自检 {checkStats.total}</span>
            <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">先看再动</span>
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
          <StatCard label="快照总数" value={snapshots.length} icon="📸" color="var(--accent-purple)" />
          <StatCard label="最新快照" value={latestSnapshot === '-' ? '-' : latestSnapshot.slice(-8)} icon="⏱" color="var(--info)" />
          <StatCard label="审计记录" value={auditRows.length} icon="🧾" color="var(--success)" />
          <StatCard label="自检问题数" value={checkStats.total} icon="🩺" color="var(--warning)" />
          <SummaryCard label="当前说明" value="先看再动" hint="先创建快照、看差异，再做回滚、模板应用或自动修复，通常最稳。" />
        </div>
      )}

      <div className="rounded-[var(--radius)] p-4 border border-[var(--error-soft-border)]" style={{ background: 'var(--error-soft-bg)' }}>
        <p className="text-xs font-semibold text-[var(--error)] mb-1">先确认再分享</p>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          快照和部署包通常包含 <span className="mono">api_config.json</span>，其中可能有完整 API Key。
          除非你明确要把全部 API 交给对方，否则分享前请先删除 <span className="mono">api_config.json</span>。
          一旦泄露，可能导致他人直接使用你的密钥；你需要去各平台删除/更换 Key 来降低损失。
        </p>
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityGap}`}>
        <OpsPanel title="快照中心" subtitle="把它当成“后悔药”。先存一个快照，再做高风险改动，出问题就能退回来。" icon="📸">
          <PanelToggleRow
            expanded={showSnapshotDetails}
            onToggle={() => setShowSnapshotDetails((value) => !value)}
            collapsedText={`已加载 ${snapshots.length} 个快照，最新 ${latestSnapshot === '-' ? '-' : latestSnapshot.slice(-8)}。需要做差异对比或回滚时再展开。`}
          />
          {showSnapshotDetails && (
            <DeferredVisibleBlock placeholder={<OpsCollapsedHint text="滚动到这一块附近时再加载快照差异工具。" />}>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={doCreateSnapshot} disabled={busy !== null} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-[var(--on-accent)] hover:opacity-90 cursor-pointer disabled:opacity-60">
                    创建快照
                  </button>
                  <button onClick={() => doRollback(selectedRight || selectedLeft)} disabled={busy !== null || snapshots.length === 0} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--warning-soft-bg)] text-[var(--warning)] hover:bg-[color-mix(in_srgb,var(--warning)_24%,transparent)] cursor-pointer disabled:opacity-60">
                    回滚到这个快照
                  </button>
                  <button
                    onClick={() => setShowSnapshotTools((v) => !v)}
                    className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${showSnapshotTools ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'}`}
                  >
                    {showSnapshotTools ? '收起差异区' : '展开差异区'}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">已加载 {snapshots.length} 个快照</span>
                  <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">最新 {latestSnapshot === '-' ? '-' : latestSnapshot.slice(-8)}</span>
                </div>

                {showSnapshotTools && (
                  <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <select value={selectedLeft} onChange={(e) => setSelectedLeft(e.target.value)} className="px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)]">
                        <option value="">左快照</option>
                        {snapshots.map((s) => <option key={`l-${s.snapshot_id}`} value={s.snapshot_id}>{s.snapshot_id}</option>)}
                      </select>
                      <select value={selectedRight} onChange={(e) => setSelectedRight(e.target.value)} className="px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)]">
                        <option value="">右快照</option>
                        {snapshots.map((s) => <option key={`r-${s.snapshot_id}`} value={s.snapshot_id}>{s.snapshot_id}</option>)}
                      </select>
                    </div>
                    <button onClick={doDiff} disabled={busy !== null} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-60">
                      看这两个快照差了什么
                    </button>

                    {diffResult && (
                      <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[var(--text-secondary)]">变更文件</p>
                          <span className="mono text-[var(--text-muted)]">{diffResult.changed_files.length}</span>
                        </div>
                        {diffResult.changed_files.length === 0 ? (
                          <p className="text-[var(--text-muted)]">这两个快照看起来是一样的，暂时没有发现可见差异。</p>
                        ) : (
                          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                            {diffResult.changed_files.map((f) => (
                              <p key={f} className="mono text-[var(--text-muted)]">{f} · {(diffResult.changed_keys_by_file[f] ?? []).join(', ') || '$root'}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </DeferredVisibleBlock>
          )}
        </OpsPanel>

        <OpsPanel title="部署包与环境模板" subtitle="适合把当前配置打包带走，或者保存成 dev / test / prod 三套环境模板。" icon="📦">
          <PanelToggleRow
            expanded={showEnvDetails}
            onToggle={() => setShowEnvDetails((value) => !value)}
            collapsedText="这里负责导出部署包，以及保存 / 预览 / 应用 dev、test、prod 三套环境模板。低性能模式下默认先收起。"
          />
          {showEnvDetails && (
            <DeferredVisibleBlock placeholder={<OpsCollapsedHint text="滚动到这一块附近时再加载部署包与模板工具。" />}>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={doExportPackage} disabled={busy !== null} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-[var(--on-accent)] hover:opacity-90 cursor-pointer disabled:opacity-60">
                    导出部署包
                  </button>
                  <button
                    onClick={() => setShowEnvTools((v) => !v)}
                    className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${showEnvTools ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'}`}
                  >
                    {showEnvTools ? '收起模板区' : '展开模板区'}
                  </button>
                </div>

                {showEnvTools && (
                  <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                    {ENVS.map((env) => (
                      <div key={env.key} className="grid grid-cols-[56px_repeat(3,minmax(0,1fr))] gap-2 items-center">
                        <span className="text-xs text-[var(--text-muted)]">{env.label}</span>
                        <button onClick={() => doSaveEnvTemplate(env.key)} disabled={busy !== null} className="px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-60">保存模板</button>
                        <button onClick={() => doPreviewEnv(env.key)} disabled={busy !== null} className="px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-60">预览</button>
                        <button onClick={() => doApplyEnv(env.key)} disabled={busy !== null} className="px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-soft-bg)] text-[var(--accent-purple)] hover:bg-[color-mix(in_srgb,var(--accent-purple)_22%,transparent)] cursor-pointer disabled:opacity-60">应用</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DeferredVisibleBlock>
          )}
        </OpsPanel>
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityGap}`}>
        <OpsPanel title="启动前自检" subtitle="它会先帮你找出明显问题。建议先看说明，再决定要不要自动修复。" icon="🩺">
          <PanelToggleRow
            expanded={showSelfCheckDetails}
            onToggle={() => setShowSelfCheckDetails((value) => !value)}
            collapsedText={selfCheck ? `最近一次自检共 ${checkStats.total} 项，错误 ${checkStats.errors}，警告 ${checkStats.warns}，可修 ${checkStats.fixable}` : '你还没跑过自检。准备改配置、分享部署包或做回滚前，先跑一次会更安心。'}
          />
          {showSelfCheckDetails && (
            <DeferredVisibleBlock placeholder={<OpsCollapsedHint text="滚动到这一块附近时再加载自检明细。" />}>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={doSelfCheck} disabled={busy !== null} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-[var(--on-accent)] hover:opacity-90 cursor-pointer disabled:opacity-60">运行自检</button>
                  <button onClick={doFixSelfCheck} disabled={busy !== null} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--warning-soft-bg)] text-[var(--warning)] hover:bg-[color-mix(in_srgb,var(--warning)_24%,transparent)] cursor-pointer disabled:opacity-60">自动修复可修项</button>
                </div>

                {selfCheck ? (
                  <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                    <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">
                      <MiniInfo label="状态" value={selfCheck.ok ? '通过' : '需要处理'} tone={selfCheck.ok ? 'success' : 'warning'} />
                      <MiniInfo label="错误" value={String(checkStats.errors)} tone="warning" />
                      <MiniInfo label="警告" value={String(checkStats.warns)} tone="info" />
                      <MiniInfo label="可修项" value={String(checkStats.fixable)} tone={checkStats.fixable > 0 ? 'warning' : 'neutral'} />
                      <MiniInfo label="用量日志项" value={String(checkStats.usageEvents)} tone={checkStats.usageEvents > 0 ? 'warning' : 'neutral'} />
                    </div>
                    {usageEventCheckHighlights.length > 0 && (
                      <div className="rounded-[var(--radius-sm)] border border-[var(--warning-soft-border)] bg-[var(--warning-soft-bg)] px-4 py-3">
                        <p className="text-sm font-medium text-[var(--warning)]">统一用量事件日志存在关注项</p>
                        <div className="mt-2 space-y-1">
                          {usageEventCheckHighlights.map((item, index) => {
                            const explained = explainSelfCheckItem(item);
                            return (
                              <p key={`${item.code}-${index}`} className="text-xs text-[var(--text-secondary)] leading-relaxed">
                                {explained.techLabel}：{explained.humanText}
                              </p>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-[var(--text-muted)] mono break-all">报告文件：{selfCheck.report_path}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        { key: 'all' as const, label: `全部 ${checkStats.total}` },
                        { key: 'error' as const, label: `错误 ${checkStats.errors}` },
                        { key: 'warn' as const, label: `警告 ${checkStats.warns}` },
                        { key: 'fixable' as const, label: `可修 ${checkStats.fixable}` },
                        { key: 'usage-events' as const, label: `用量日志 ${checkStats.usageEvents}` },
                      ].map((item) => (
                        <button
                          key={item.key}
                          onClick={() => setSelfCheckFilter(item.key)}
                          className={`px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${selfCheckFilter === item.key ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--surface-card)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <div className="max-h-44 overflow-y-auto border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2 bg-[var(--surface-card)]">
                      {filteredSelfCheckItems.length === 0 ? (
                        <p className="text-xs text-[var(--text-muted)]">{selfCheck.items.length === 0 ? '无异常项' : '当前筛选条件下没有命中的自检项'}</p>
                      ) : (
                        filteredSelfCheckItems.map((it, i) => {
                          const explained = explainSelfCheckItem(it);
                          return (
                            <div key={`${it.code}-${i}`} className="text-xs text-[var(--text-secondary)] leading-relaxed rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
                              <div className="flex items-start gap-2 flex-wrap">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] border mono text-[10px] ${it.level === 'error' ? 'border-[var(--error-soft-border)] text-[var(--error)]' : it.level === 'warn' ? 'border-[var(--warning-soft-border)] text-[var(--warning)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)]'}`}>
                                  {explained.techLabel}
                                </span>
                                {it.fixable && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--success-soft-border)] text-[var(--success)] text-[10px]">
                                    可自动修复
                                  </span>
                                )}
                                {it.code.startsWith('usageEvents.') && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--warning-soft-border)] text-[var(--warning)] text-[10px]">
                                    用量日志
                                  </span>
                                )}
                                <span className="flex-1 min-w-[240px]">：{explained.humanText}</span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">你还没跑过自检。准备改配置、分享部署包或做回滚前，先跑一次会更安心。</p>
                )}
              </div>
            </DeferredVisibleBlock>
          )}
        </OpsPanel>

        <OpsPanel title="操作审计日志" subtitle="这里只是帮你回看最近做过什么，不需要逐条理解所有技术细节。" icon="🧾">
          <PanelToggleRow
            expanded={showAuditDetails}
            onToggle={() => setShowAuditDetails((value) => !value)}
            collapsedText={`最近记录 ${auditRows.length} 条。低性能模式下默认先收起长日志列表，需要时再展开。`}
          />
          {showAuditDetails && (
            <DeferredVisibleBlock placeholder={<OpsCollapsedHint text="滚动到这一块附近时再加载审计日志列表。" />}>
              <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                <div className="flex items-center justify-between mb-2 text-xs text-[var(--text-muted)]">
                  <span>最近记录</span>
                  <span className="mono">{auditRows.length} 条</span>
                </div>
                <div className="max-h-64 overflow-y-auto border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2 space-y-1 bg-[var(--surface-card)]">
                  {auditRows.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">这里还没有操作记录。等你创建快照、跑自检或应用模板后，就会逐渐积累起来。</p>
                  ) : (
                    auditRows.map((row, idx) => (
                      <p key={idx} className="text-xs text-[var(--text-secondary)] mono break-all">
                        {row.ts_local || row.ts} · {row.action} · {row.target} · {row.status}
                      </p>
                    ))
                  )}
                </div>
              </div>
            </DeferredVisibleBlock>
          )}
        </OpsPanel>
      </div>
    </div>
  );
}

function OpsPanel({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: string; children: React.ReactNode }) {
  return (
    <Panel title={title} subtitle={subtitle} icon={icon} padding="sm">
      {children}
    </Panel>
  );
}

function PanelToggleRow({
  expanded,
  onToggle,
  collapsedText,
}: {
  expanded: boolean;
  onToggle: () => void;
  collapsedText: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button
        onClick={onToggle}
        className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${expanded ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'}`}
      >
        {expanded ? '收起明细' : '展开明细'}
      </button>
      {!expanded && <span className="text-[11px] text-[var(--text-muted)] leading-relaxed">{collapsedText}</span>}
    </div>
  );
}

function OpsCollapsedHint({ text }: { text: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">{text}</p>
    </div>
  );
}
