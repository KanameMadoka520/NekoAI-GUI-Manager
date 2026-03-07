import { useEffect, useMemo, useState } from 'react';
import { StatCard } from '../components/common/StatCard';
import { Panel } from '../components/common/Panel';
import { SummaryCard, MiniInfo } from '../components/common/SummaryCard';
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

const ENVS = [
  { key: 'dev' as const, label: '开发' },
  { key: 'test' as const, label: '测试' },
  { key: 'prod' as const, label: '生产' },
];

export function OpsCenter() {
  const addToast = useUiStore((s) => s.addToast);
  const settings = useUiStore((s) => s.settings);
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selectedLeft, setSelectedLeft] = useState('');
  const [selectedRight, setSelectedRight] = useState('');
  const [diffResult, setDiffResult] = useState<SnapshotDiff | null>(null);
  const [selfCheck, setSelfCheck] = useState<SelfCheckReport | null>(null);
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSnapshotTools, setShowSnapshotTools] = useState(true);
  const [showEnvTools, setShowEnvTools] = useState(true);

  useEffect(() => {
    loadAll();
  }, []);

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
    if (!selfCheck) return { errors: 0, warns: 0, total: 0 };
    const errors = selfCheck.items.filter((x) => x.level === 'error').length;
    const warns = selfCheck.items.filter((x) => x.level === 'warn').length;
    return { errors, warns, total: selfCheck.items.length };
  }, [selfCheck]);

  async function doCreateSnapshot() {
    setBusy('snapshot');
    try {
      const id = await createSnapshot('manual', 'gui');
      addToast('success', `已创建快照: ${id}`);
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
      addToast('success', `已回滚到快照 ${snapshotId}`);
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
      addToast('success', `差异分析完成，共变更 ${diff.changed_files.length} 个文件`);
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
      addToast('success', `部署包已导出: ${r.package_name}`);
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
      addToast('success', `${env} 模板将变更 ${preview.changed_files.length} 个文件`);
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
      addToast('success', `已应用 ${env} 模板，并自动生成快照`);
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
      addToast(report.ok ? 'success' : 'warning', report.ok ? '自检通过' : '自检发现问题，请查看详情');
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
      addToast('success', changed.length > 0 ? `已修复 ${changed.length} 项` : '未发现可自动修复项');
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
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard label="快照总数" value={snapshots.length} icon="📸" color="var(--accent-purple)" />
        <StatCard label="最新快照" value={latestSnapshot === '-' ? '-' : latestSnapshot.slice(-8)} icon="⏱" color="var(--info)" />
        <StatCard label="审计记录" value={auditRows.length} icon="🧾" color="var(--success)" />
        <StatCard label="自检问题数" value={checkStats.total} icon="🩺" color="var(--warning)" />
        <SummaryCard label="当前说明" value="安全优先" hint="先预览与对比，再执行回滚、模板应用和修复。" />
      </div>

      <div className="rounded-[var(--radius)] p-4 border border-[rgba(255,82,82,0.35)]" style={{ background: 'rgba(255,82,82,0.08)' }}>
        <p className="text-xs font-semibold text-[var(--error)] mb-1">安全提示（快照 / 部署包）</p>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          快照和部署包通常包含 <span className="mono">api_config.json</span>，其中可能有完整 API Key。
          除非你明确要把全部 API 交给对方，否则分享前请先删除 <span className="mono">api_config.json</span>。
          一旦泄露，可能导致他人直接使用你的密钥；你需要去各平台删除/更换 Key 来降低损失。
        </p>
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityGap}`}>
        <OpsPanel title="快照中心" subtitle="创建安全检查点、做差异分析，并在必要时回滚。" icon="📸">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={doCreateSnapshot} disabled={busy !== null} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 cursor-pointer disabled:opacity-60">
              创建快照
            </button>
            <button onClick={() => doRollback(selectedRight || selectedLeft)} disabled={busy !== null || snapshots.length === 0} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,171,64,0.15)] text-[var(--warning)] hover:bg-[rgba(255,171,64,0.25)] cursor-pointer disabled:opacity-60">
              回滚到选中快照
            </button>
            <button
              onClick={() => setShowSnapshotTools((v) => !v)}
              className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${showSnapshotTools ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'}`}
            >
              {showSnapshotTools ? '收起差异区' : '展开差异区'}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">已加载 {snapshots.length} 个快照</span>
            <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">最新 {latestSnapshot === '-' ? '-' : latestSnapshot.slice(-8)}</span>
          </div>

          {showSnapshotTools && (
            <div className="mt-4 space-y-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
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
                对比差异
              </button>

              {diffResult && (
                <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[var(--text-secondary)]">变更文件</p>
                    <span className="mono text-[var(--text-muted)]">{diffResult.changed_files.length}</span>
                  </div>
                  {diffResult.changed_files.length === 0 ? (
                    <p className="text-[var(--text-muted)]">当前两个快照无差异。</p>
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
        </OpsPanel>

        <OpsPanel title="部署包与环境模板" subtitle="导出部署包，并把当前配置保存为 dev / test / prod 模板。" icon="📦">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={doExportPackage} disabled={busy !== null} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 cursor-pointer disabled:opacity-60">
              一键导出部署包
            </button>
            <button
              onClick={() => setShowEnvTools((v) => !v)}
              className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${showEnvTools ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'}`}
            >
              {showEnvTools ? '收起模板区' : '展开模板区'}
            </button>
          </div>

          {showEnvTools && (
            <div className="mt-4 space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              {ENVS.map((env) => (
                <div key={env.key} className="grid grid-cols-[56px_repeat(3,minmax(0,1fr))] gap-2 items-center">
                  <span className="text-xs text-[var(--text-muted)]">{env.label}</span>
                  <button onClick={() => doSaveEnvTemplate(env.key)} disabled={busy !== null} className="px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-60">保存模板</button>
                  <button onClick={() => doPreviewEnv(env.key)} disabled={busy !== null} className="px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-60">预览</button>
                  <button onClick={() => doApplyEnv(env.key)} disabled={busy !== null} className="px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[rgba(14,165,233,0.15)] text-[var(--accent-purple)] hover:bg-[rgba(14,165,233,0.25)] cursor-pointer disabled:opacity-60">应用</button>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityGap}`}>
        <OpsPanel title="启动前自检" subtitle="先看错误与警告，再决定是否执行自动修复。" icon="🩺">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={doSelfCheck} disabled={busy !== null} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 cursor-pointer disabled:opacity-60">运行自检</button>
            <button onClick={doFixSelfCheck} disabled={busy !== null} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,171,64,0.15)] text-[var(--warning)] hover:bg-[rgba(255,171,64,0.25)] cursor-pointer disabled:opacity-60">自动修复可修项</button>
          </div>

          {selfCheck ? (
            <div className="mt-4 space-y-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <div className="grid grid-cols-3 gap-2">
                <MiniInfo label="状态" value={selfCheck.ok ? '通过' : '存在问题'} tone={selfCheck.ok ? 'success' : 'warning'} />
                <MiniInfo label="错误" value={String(checkStats.errors)} tone="warning" />
                <MiniInfo label="警告" value={String(checkStats.warns)} tone="info" />
              </div>
              <p className="text-xs text-[var(--text-muted)] mono break-all">报告：{selfCheck.report_path}</p>
              <div className="max-h-44 overflow-y-auto border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2 bg-[var(--surface-card)]">
                {selfCheck.items.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">无异常项</p>
                ) : (
                  selfCheck.items.map((it, i) => (
                    <p key={`${it.code}-${i}`} className="text-xs text-[var(--text-secondary)]">[{it.level}] {it.message}</p>
                  ))
                )}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-[var(--text-muted)]">尚未执行自检。</p>
          )}
        </OpsPanel>

        <OpsPanel title="操作审计日志" subtitle="查看最近 120 条安全治理操作记录。" icon="🧾">
          <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between mb-2 text-xs text-[var(--text-muted)]">
              <span>最近记录</span>
              <span className="mono">{auditRows.length} 条</span>
            </div>
            <div className="max-h-64 overflow-y-auto border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2 space-y-1 bg-[var(--surface-card)]">
              {auditRows.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">暂无日志</p>
              ) : (
                auditRows.map((row, idx) => (
                  <p key={idx} className="text-xs text-[var(--text-secondary)] mono break-all">
                    {row.ts_local || row.ts} · {row.action} · {row.target} · {row.status}
                  </p>
                ))
              )}
            </div>
          </div>
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
