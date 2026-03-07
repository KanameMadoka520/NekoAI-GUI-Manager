import { useState, useEffect } from 'react';
import { StatCard } from '../components/common/StatCard';
import { ProgressBar } from '../components/common/ProgressBar';
import { Panel } from '../components/common/Panel';
import { SummaryCard } from '../components/common/SummaryCard';
import { useUiStore } from '../stores/uiStore';
import { getConfig, getSystemInfo, listMemory } from '../lib/tauri-commands';
import type { RuntimeConfig, ApiNode, Personality, MemoryMeta, SystemInfo } from '../lib/types';

const MEMORY_CAPACITY = 50;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function Dashboard() {
  const addToast = useUiStore((s) => s.addToast);
  const settings = useUiStore((s) => s.settings);
  const [loading, setLoading] = useState(true);
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [apis, setApis] = useState<ApiNode[]>([]);
  const [groupPersonalities, setGroupPersonalities] = useState<Personality[]>([]);
  const [privatePersonalities, setPrivatePersonalities] = useState<Personality[]>([]);
  const [groupMemories, setGroupMemories] = useState<MemoryMeta[]>([]);
  const [privateMemories, setPrivateMemories] = useState<MemoryMeta[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [rt, api, gp, pp, gm, pm, si] = await Promise.all([
        getConfig<RuntimeConfig>('runtime'),
        getConfig<ApiNode[]>('api'),
        getConfig<Personality[]>('groupPersonality'),
        getConfig<Personality[]>('privatePersonality'),
        listMemory('group'),
        listMemory('private'),
        getSystemInfo(),
      ]);
      setRuntime(rt);
      setApis(api ?? []);
      setGroupPersonalities(gp ?? []);
      setPrivatePersonalities(pp ?? []);
      setGroupMemories(gm ?? []);
      setPrivateMemories(pm ?? []);
      setSystemInfo(si);
    } catch (e: any) {
      addToast('error', `加载数据失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
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

  const totalMemorySessions = groupMemories.length + privateMemories.length;
  const totalMessages = [...groupMemories, ...privateMemories].reduce((s, m) => s + m.count, 0);
  const activeApi = runtime && apis.length > 0 ? apis[runtime.activeApiIndex] : null;
  const activeGroupPersonality = runtime && groupPersonalities.length > 0 ? groupPersonalities[runtime.activeGroupPersonalityIndex] : null;
  const activePrivatePersonality = runtime && privatePersonalities.length > 0 ? privatePersonalities[runtime.activePrivatePersonalityIndex] : null;

  const apiTypeCounts = { openai: 0, gemini: 0, anthropic: 0 };
  apis.forEach((a) => { if (a.aiType in apiTypeCounts) apiTypeCounts[a.aiType as keyof typeof apiTypeCounts]++; });

  const densityGap = settings.contentDensity === 'spacious' ? 'gap-5' : settings.contentDensity === 'compact' ? 'gap-3' : 'gap-4';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard label="API 节点总数" value={apis.length} icon="🔌" color="var(--accent-purple)" />
        <StatCard label="当前活跃节点" value={runtime ? `#${runtime.activeApiIndex}` : '-'} icon="⚡" color="var(--success)" />
        <StatCard label="记忆会话数" value={totalMemorySessions} icon="🧠" color="var(--info)" />
        <StatCard label="记忆消息总数" value={totalMessages} icon="💬" color="var(--accent-pink)" />
        <SummaryCard label="当前概览" value="运行态总览" hint="先看核心状态，再看分布、记忆和文件健康。" />
      </div>

      <div className="rounded-[var(--radius)] border border-[var(--border-subtle)] px-4 py-3" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">监听群组 {runtime?.groups?.length ?? 0}</span>
          <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">群聊人格 {groupPersonalities.length}</span>
          <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">私聊人格 {privatePersonalities.length}</span>
          <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">文件健康 {systemInfo?.files?.length ?? 0}</span>
          <div className="flex-1" />
          <button
            onClick={loadAll}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer"
          >
            🔄 刷新数据
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityGap}`}>
        <Panel title="核心状态" subtitle="当前昵称、活跃节点、人格和主要能力开关。" icon="⚙">
          <div className="space-y-3">
            <StatusRow label="昵称" value={runtime?.nickName ?? '-'} />
            <StatusRow label="当前 API" value={activeApi ? `#${runtime!.activeApiIndex} ${activeApi.modelName}` : '-'} badge={activeApi?.aiType} />
            <StatusRow label="群聊人格" value={activeGroupPersonality ? `#${runtime!.activeGroupPersonalityIndex} ${activeGroupPersonality.remark}` : '-'} />
            <StatusRow label="私聊人格" value={activePrivatePersonality ? `#${runtime!.activePrivatePersonalityIndex} ${activePrivatePersonality.remark}` : '-'} />
            <StatusRow label="智能路由" value={runtime?.smartRouter?.enabled ? `开启 · ${runtime.smartRouter.mode}` : '关闭'} dot={runtime?.smartRouter?.enabled ? 'var(--success)' : 'var(--text-muted)'} />
            <StatusRow label="记忆压缩" value={runtime?.memorySummary?.enabled ? `开启 · 阈值 ${runtime.memorySummary.threshold}` : '关闭'} dot={runtime?.memorySummary?.enabled ? 'var(--success)' : 'var(--text-muted)'} />
            <StatusRow label="表情包" value={runtime?.enableMemes ? `开启 · ${Math.round((runtime.memeProb ?? 0) * 100)}%` : '关闭'} dot={runtime?.enableMemes ? 'var(--success)' : 'var(--text-muted)'} />
            <StatusRow label="随机回复" value={runtime ? `${Math.round((runtime.randomReply ?? 0) * 100)}%` : '-'} />
          </div>
        </Panel>

        <Panel title="群组与用户" subtitle="查看监听范围、权限列表和群级映射使用情况。" icon="👥">
          <div className="space-y-3">
            <StatusRow label="主人 QQ" value={runtime?.masterQQ?.join(', ') || '-'} />
            <StatusRow label="监听群组" value={`${runtime?.groups?.length ?? 0} 个群`} />
            <StatusRow label="私聊白名单" value={`${runtime?.allowPrivateTalkingUsers?.length ?? 0} 人`} />
            <StatusRow label="用户黑名单" value={`${runtime?.userBlacklist?.length ?? 0} 人`} />
            <StatusRow label="群限流配置" value={`${Object.keys(runtime?.groupLimits ?? {}).length} 个群`} />
            <StatusRow label="群人格映射" value={`${Object.keys(runtime?.groupPersonalityMap ?? {}).length} 个映射`} />
            <StatusRow label="群 API 映射" value={`${Object.keys(runtime?.groupApiMap ?? {}).length} 个映射`} />
          </div>

          {runtime && runtime.groups?.length > 0 && (
            <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
              <p className="text-xs text-[var(--text-muted)] mb-2">监听群组</p>
              <div className="flex flex-wrap gap-1.5">
                {runtime.groups.map((g) => (
                  <span
                    key={g}
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                  >
                    {g}
                    {runtime.groupLimits?.[g] !== undefined && <span className="text-[var(--warning)]" title={`限流: ${runtime.groupLimits[g]}`}>⏱</span>}
                    {runtime.groupPersonalityMap?.[g] !== undefined && <span className="text-[var(--accent-pink)]" title={`人格: #${runtime.groupPersonalityMap[g]}`}>🎭</span>}
                    {runtime.groupApiMap?.[g] !== undefined && <span className="text-[var(--info)]" title={`API: #${runtime.groupApiMap[g]}`}>🔌</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-3 ${densityGap}`}>
        <TypeCard type="OpenAI" count={apiTypeCounts.openai} total={apis.length} color="var(--success)" />
        <TypeCard type="Gemini" count={apiTypeCounts.gemini} total={apis.length} color="var(--info)" />
        <TypeCard type="Anthropic" count={apiTypeCounts.anthropic} total={apis.length} color="var(--accent-pink)" />
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityGap}`}>
        <MemoryPanel title="群聊记忆" subtitle="查看群聊会话占用与容量接近情况。" icon="👥" memories={groupMemories} />
        <MemoryPanel title="私聊记忆" subtitle="查看私聊会话占用与容量接近情况。" icon="👤" memories={privateMemories} />
      </div>

      {systemInfo && (
        <Panel title="配置文件健康" subtitle="确认关键配置文件是否存在、大小是否正常、最近是否有更新。" icon="🩺">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                  <th className="pb-2 font-medium">文件</th>
                  <th className="pb-2 font-medium">状态</th>
                  <th className="pb-2 font-medium">大小</th>
                  <th className="pb-2 font-medium">最后修改</th>
                </tr>
              </thead>
              <tbody>
                {systemInfo.files.map((f) => (
                  <tr key={f.key} className="border-b border-[var(--border-subtle)] last:border-0">
                    <td className="py-2 text-[var(--text-secondary)] mono text-xs">{f.filename}</td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: f.exists ? 'var(--success)' : 'var(--error)' }}>
                        <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: f.exists ? 'var(--success)' : 'var(--error)' }} />
                        {f.exists ? '正常' : '缺失'}
                      </span>
                    </td>
                    <td className="py-2 text-[var(--text-muted)] text-xs mono">{f.exists ? formatBytes(f.size) : '-'}</td>
                    <td className="py-2 text-[var(--text-muted)] text-xs">{f.exists ? formatTime(f.modified) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function StatusRow({ label, value, badge, dot }: { label: string; value: string; badge?: string; dot?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-[var(--text-muted)] flex items-center gap-2">
        {dot && <span className="w-2 h-2 rounded-full inline-block" style={{ background: dot }} />}
        {label}
      </span>
      <span className="text-[var(--text-secondary)] flex items-center gap-2 text-right">
        {value}
        {badge && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--accent-purple)]">
            {badge}
          </span>
        )}
      </span>
    </div>
  );
}

function TypeCard({ type, count, total, color }: { type: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="rounded-[var(--radius)] p-6 overflow-hidden border border-[var(--border-subtle)]" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium" style={{ color }}>{type}</span>
        <span className="text-xs text-[var(--text-muted)]">{pct}%</span>
      </div>
      <span className="text-2xl font-bold text-[var(--text-primary)]">{count}</span>
      <div className="mt-2 h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function MemoryPanel({ title, subtitle, icon, memories }: { title: string; subtitle: string; icon: string; memories: MemoryMeta[] }) {
  const totalMsgs = memories.reduce((s, m) => s + m.count, 0);

  return (
    <Panel title={title} subtitle={subtitle} icon={icon}>
      <div className="flex items-center justify-between mb-3 text-xs text-[var(--text-muted)]">
        <span>{memories.length} 个会话</span>
        <span>{totalMsgs} 条消息</span>
      </div>
      {memories.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] text-center py-4">暂无记忆数据</p>
      ) : (
        <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
          {memories.map((m) => (
            <ProgressBar key={m.id} label={m.id} value={m.count} max={MEMORY_CAPACITY} />
          ))}
        </div>
      )}
    </Panel>
  );
}
