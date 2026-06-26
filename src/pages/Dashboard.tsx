import { useState, useEffect } from 'react';
import { StatCard } from '../components/common/StatCard';
import { ProgressBar } from '../components/common/ProgressBar';
import { Panel } from '../components/common/Panel';
import { SummaryCard } from '../components/common/SummaryCard';
import { DeferredVisibleBlock } from '../components/common/DeferredVisibleBlock';
import { useUiStore } from '../stores/uiStore';
import { getConfig, getSystemInfo, listMemory } from '../lib/tauri-commands';
import type { RuntimeConfig, ApiNode, Personality, MemoryMeta, SystemInfo, RuntimeSchema } from '../lib/types';
import type { PageId } from '../components/layout/Sidebar';

// 启动器首页「快速开始」磁贴 —— 直达其余 9 个功能页（图标 / 文案与侧栏导航一致）。
const QUICK_TILES: { id: PageId; icon: string; label: string; desc: string }[] = [
  { id: 'api', icon: '🔌', label: 'API管理', desc: '节点 · 密钥 · 模型' },
  { id: 'config', icon: '⚙', label: '配置编辑', desc: '运行时可视化配置' },
  { id: 'personality', icon: '🎭', label: '人格管理', desc: '群聊 / 私聊提示词' },
  { id: 'evaluation', icon: '📊', label: '人格评测', desc: '多轮次多维打分' },
  { id: 'memory', icon: '🧠', label: '长期记忆', desc: '对话记忆管理' },
  { id: 'history', icon: '📜', label: '历史记录', desc: '日志解析分析' },
  { id: 'usage', icon: '⏱️', label: '用量管理', desc: '周期计数与限流' },
  { id: 'commands', icon: '📋', label: '命令管理', desc: '命令回避列表' },
  { id: 'ops', icon: '🛡️', label: '安全发布', desc: '快照 · 部署 · 自检' },
];

// 大时钟 Hero —— 独立组件，每分钟对齐刷新一次，避免整页随秒级时钟重渲染。
function HeroClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: number | null = null;
    const schedule = () => {
      const delay = 60000 - (Date.now() % 60000) + 80;
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const h = now.getHours();
  const greeting = h < 6 ? '凌晨好' : h < 9 ? '早上好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了';
  const time = now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <div className="min-w-0">
      <p className="text-sm text-[var(--text-secondary)] font-medium">{greeting}，欢迎回到 NekoAI 管理面板</p>
      <div className="mt-2 text-5xl xl:text-6xl font-bold tabular-nums leading-none text-glow-accent">{time}</div>
      <div className="mt-2.5 text-sm text-[var(--text-secondary)]">{date}</div>
    </div>
  );
}

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

function formatDurationMs(ms?: number): string {
  if (ms === undefined || ms === null) return '-';
  if (ms <= 0) return '关闭';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)} 秒`;
  return `${Math.round(ms / 60000)} 分钟`;
}

export function Dashboard({ onNavigate }: { onNavigate?: (page: PageId) => void }) {
  const addToast = useUiStore((s) => s.addToast);
  const settings = useUiStore((s) => s.settings);
  const lowPerformanceMode = settings.renderMode === 'lite';
  const [loading, setLoading] = useState(true);
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [apis, setApis] = useState<ApiNode[]>([]);
  const [groupPersonalities, setGroupPersonalities] = useState<Personality[]>([]);
  const [privatePersonalities, setPrivatePersonalities] = useState<Personality[]>([]);
  const [groupMemories, setGroupMemories] = useState<MemoryMeta[]>([]);
  const [privateMemories, setPrivateMemories] = useState<MemoryMeta[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [runtimeSchema, setRuntimeSchema] = useState<RuntimeSchema | null>(null);
  const [showCoreDetails, setShowCoreDetails] = useState(true);
  const [showGroupDetails, setShowGroupDetails] = useState(true);
  const [showApiTypeDetails, setShowApiTypeDetails] = useState(!lowPerformanceMode);
  const [showMemoryDetails, setShowMemoryDetails] = useState(!lowPerformanceMode);
  const [showFileDetails, setShowFileDetails] = useState(!lowPerformanceMode);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!lowPerformanceMode) return;
    setShowApiTypeDetails(false);
    setShowMemoryDetails(false);
    setShowFileDetails(false);
  }, [lowPerformanceMode]);

  async function loadAll() {
    setLoading(true);
    try {
      const [rt, schema, api, gp, pp, gm, pm, si] = await Promise.all([
        getConfig<RuntimeConfig>('runtime'),
        getConfig<RuntimeSchema>('runtimeSchema').catch(() => null),
        getConfig<ApiNode[]>('api'),
        getConfig<Personality[]>('groupPersonality'),
        getConfig<Personality[]>('privatePersonality'),
        listMemory('group'),
        listMemory('private'),
        getSystemInfo(),
      ]);
      setRuntime(rt);
      setRuntimeSchema(schema ?? null);
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
  const imageApiTimeoutMs = runtime?.imageApiTimeoutMs ?? Math.max(runtime?.apiTimeoutMs ?? 120000, 300000);

  const apiTypeCounts = { openai: 0, gemini: 0, anthropic: 0 };
  apis.forEach((a) => { if (a.aiType in apiTypeCounts) apiTypeCounts[a.aiType as keyof typeof apiTypeCounts]++; });

  const densityGap = settings.contentDensity === 'spacious' ? 'gap-5' : settings.contentDensity === 'compact' ? 'gap-3' : 'gap-4';

  return (
    <div className="space-y-4">
      <section className="hero-rise launcher-tile px-6 py-6 sm:px-8 sm:py-7">
        <div className="relative z-[1] flex items-start justify-between gap-6 flex-wrap">
          <HeroClock />
          <div className="flex flex-col items-stretch sm:items-end gap-2.5">
            <button
              onClick={loadAll}
              className="px-5 py-2.5 text-sm font-semibold rounded-[var(--radius)] bg-[var(--accent-purple)] text-[var(--on-accent)] cursor-pointer glow-soft hover:brightness-110"
            >
              🔄 重新读取
            </button>
            <span className="text-[11px] text-[var(--text-muted)] sm:text-right max-w-[220px] leading-relaxed">
              壁纸可在右下角「显示设置 · 壁纸打底」更换或关闭
            </span>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3 px-1">
          <span className="text-sm font-semibold text-[var(--text-primary)]">快速开始</span>
          <span className="text-xs text-[var(--text-muted)]">点磁贴直达各功能页</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-3">
          {QUICK_TILES.map((t) => (
            <button
              key={t.id}
              onClick={() => onNavigate?.(t.id)}
              className="launcher-tile text-left p-4 cursor-pointer"
            >
              <span className="relative z-[1] flex flex-col gap-1.5">
                <span className="text-2xl leading-none">{t.icon}</span>
                <span className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{t.label}</span>
                <span className="text-[11px] text-[var(--text-muted)] leading-snug">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {lowPerformanceMode ? (
        <Panel title="快速概览" subtitle="低性能模式下先显示轻量摘要，减少顶部卡片和大字号数值一起参与首屏绘制。" icon="⚡" padding="sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">API 节点 {apis.length}</span>
            <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">活跃 #{runtime?.activeApiIndex ?? '-'}</span>
            <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">记忆会话 {totalMemorySessions}</span>
            <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">记忆消息 {totalMessages}</span>
            <span className={`px-2 py-1 rounded-[var(--radius-sm)] border ${runtimeSchema ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]' : 'border-[var(--warning-soft-border)] bg-[var(--warning-soft-bg)] text-[var(--warning)]'}`}>
              Schema {runtimeSchema ? `v${runtimeSchema.schemaVersion}` : '缺失'}
            </span>
            <div className="flex-1" />
            <button
              onClick={loadAll}
              className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer"
            >
              🔄 重新读取
            </button>
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
          <StatCard label="API 节点总数" value={apis.length} icon="🔌" color="var(--accent-purple)" />
          <StatCard label="当前活跃节点" value={runtime ? `#${runtime.activeApiIndex}` : '-'} icon="⚡" color="var(--success)" />
          <StatCard label="记忆会话数" value={totalMemorySessions} icon="🧠" color="var(--info)" />
          <StatCard label="记忆消息总数" value={totalMessages} icon="💬" color="var(--accent-pink)" />
          <SummaryCard label="Schema" value={runtimeSchema ? `v${runtimeSchema.schemaVersion}` : '缺失'} hint={runtimeSchema ? `已识别 ${Object.keys(runtimeSchema.fields ?? {}).length} 个配置字段` : '还没读到 runtime_schema.json，说明文件可能缺失或目录没连对'} tone={runtimeSchema ? 'neutral' : 'warning'} />
        </div>
      )}

      <div className="rounded-[var(--radius)] border border-[var(--border-subtle)] px-4 py-3" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">监听群组 {runtime?.groups?.length ?? 0}</span>
          <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">群聊人格 {groupPersonalities.length}</span>
          <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">私聊人格 {privatePersonalities.length}</span>
          <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">Schema {runtimeSchema ? `v${runtimeSchema.schemaVersion}` : '缺失'}</span>
          <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">配置文件检查 {systemInfo?.files?.length ?? 0}</span>
          <div className="flex-1" />
          <button
            onClick={loadAll}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer"
          >
            🔄 重新读取
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityGap}`}>
        <Panel title="核心状态" subtitle="先看默认模型、人格和几个关键开关，确认机器人现在大概会怎么工作。" icon="⚙">
          <SectionToggleRow
            expanded={showCoreDetails}
            onToggle={() => setShowCoreDetails((value) => !value)}
            collapsedText={`当前默认使用 ${activeApi ? `#${runtime!.activeApiIndex} ${activeApi.modelName}` : '未配置 API'}，群聊人格 ${activeGroupPersonality?.remark ?? '-'}，私聊人格 ${activePrivatePersonality?.remark ?? '-'}`}
          />
          {showCoreDetails && (
            <DeferredVisibleBlock placeholder={<CollapsedHint text="滚动到这一块附近时再加载核心状态明细。" />}>
              <div className="space-y-3">
                <StatusRow label="昵称" value={runtime?.nickName ?? '-'} />
                <StatusRow label="当前 API" value={activeApi ? `#${runtime!.activeApiIndex} ${activeApi.modelName}` : '-'} badge={activeApi?.aiType} />
                <StatusRow label="群聊人格" value={activeGroupPersonality ? `#${runtime!.activeGroupPersonalityIndex} ${activeGroupPersonality.remark}` : '-'} />
                <StatusRow label="私聊人格" value={activePrivatePersonality ? `#${runtime!.activePrivatePersonalityIndex} ${activePrivatePersonality.remark}` : '-'} />
                <StatusRow label="智能路由" value={runtime?.smartRouter?.enabled ? `开启 · ${runtime.smartRouter.mode}` : '关闭'} dot={runtime?.smartRouter?.enabled ? 'var(--success)' : 'var(--text-muted)'} />
                <StatusRow label="运行时 Schema" value={runtimeSchema ? `v${runtimeSchema.schemaVersion} · ${Object.keys(runtimeSchema.fields ?? {}).length} 字段` : '缺失'} dot={runtimeSchema ? 'var(--success)' : 'var(--error)'} />
                <StatusRow label="记忆压缩" value={runtime?.memorySummary?.enabled ? `开启 · 阈值 ${runtime.memorySummary.threshold}` : '关闭'} dot={runtime?.memorySummary?.enabled ? 'var(--success)' : 'var(--text-muted)'} />
                <StatusRow label="闲置自动清空" value={formatDurationMs(runtime?.contextAutoForgetMs)} dot={(runtime?.contextAutoForgetMs ?? 0) > 0 ? 'var(--success)' : 'var(--text-muted)'} />
                <StatusRow label="聊天 API 超时" value={formatDurationMs(runtime?.apiTimeoutMs)} />
                <StatusRow label="图像 API 超时" value={formatDurationMs(imageApiTimeoutMs)} />
                <StatusRow label="处理中提示" value={runtime?.sendProcessingNotice === false ? '关闭' : `开启 · ${formatDurationMs(runtime?.processingNoticeDelayMs ?? 0)}`} dot={runtime?.sendProcessingNotice === false ? 'var(--text-muted)' : 'var(--success)'} />
                <StatusRow label="失败提示" value={runtime?.sendFailureNotice === false ? '关闭' : `开启 · ${(runtime?.failureNoticeDetailMode ?? 'full')}`} dot={runtime?.sendFailureNotice === false ? 'var(--text-muted)' : 'var(--success)'} />
                <StatusRow label="表情包" value={runtime?.enableMemes ? `开启 · ${Math.round((runtime.memeProb ?? 0) * 100)}%` : '关闭'} dot={runtime?.enableMemes ? 'var(--success)' : 'var(--text-muted)'} />
                <StatusRow label="随机回复" value={runtime ? `${Math.round((runtime.randomReply ?? 0) * 100)}%` : '-'} />
                <StatusRow label="图片风格" value={`UI ${runtime?.uiStyle ?? 1}`} />
              </div>
            </DeferredVisibleBlock>
          )}
        </Panel>

        <Panel title="群组与用户" subtitle="这里能快速看出机器人会在哪些群说话、会拒绝谁、以及哪些群绑了专属模型或人格。" icon="👥">
          <SectionToggleRow
            expanded={showGroupDetails}
            onToggle={() => setShowGroupDetails((value) => !value)}
            collapsedText={`监听群 ${runtime?.groups?.length ?? 0} 个，私聊白名单 ${runtime?.allowPrivateTalkingUsers?.length ?? 0} 人，黑名单 ${runtime?.userBlacklist?.length ?? 0} 人`}
          />
          {showGroupDetails && (
            <DeferredVisibleBlock placeholder={<CollapsedHint text="滚动到这一块附近时再加载群组和用户明细。" />}>
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
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
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
            </DeferredVisibleBlock>
          )}
        </Panel>
      </div>

      {lowPerformanceMode ? (
        <Panel title="节点类型分布" subtitle="低性能模式下默认先收起类型卡片，需要时再展开。" icon="🧩" padding="sm">
          <SectionToggleRow
            expanded={showApiTypeDetails}
            onToggle={() => setShowApiTypeDetails((value) => !value)}
            collapsedText={`OpenAI ${apiTypeCounts.openai} · Gemini ${apiTypeCounts.gemini} · Anthropic ${apiTypeCounts.anthropic}`}
          />
          {showApiTypeDetails && (
            <DeferredVisibleBlock placeholder={<CollapsedHint text="滚动到这一块附近时再加载节点类型分布卡片。" />}>
              <div className={`grid grid-cols-1 xl:grid-cols-3 ${densityGap}`}>
                <TypeCard type="OpenAI" count={apiTypeCounts.openai} total={apis.length} color="var(--success)" />
                <TypeCard type="Gemini" count={apiTypeCounts.gemini} total={apis.length} color="var(--info)" />
                <TypeCard type="Anthropic" count={apiTypeCounts.anthropic} total={apis.length} color="var(--accent-pink)" />
              </div>
            </DeferredVisibleBlock>
          )}
        </Panel>
      ) : (
        <div className={`grid grid-cols-1 xl:grid-cols-3 ${densityGap}`}>
          <TypeCard type="OpenAI" count={apiTypeCounts.openai} total={apis.length} color="var(--success)" />
          <TypeCard type="Gemini" count={apiTypeCounts.gemini} total={apis.length} color="var(--info)" />
          <TypeCard type="Anthropic" count={apiTypeCounts.anthropic} total={apis.length} color="var(--accent-pink)" />
        </div>
      )}

      {lowPerformanceMode ? (
        <Panel title="记忆概览" subtitle="低性能模式下先只看群聊 / 私聊记忆摘要，需要时再展开详细进度条列表。" icon="🧠" padding="sm">
          <SectionToggleRow
            expanded={showMemoryDetails}
            onToggle={() => setShowMemoryDetails((value) => !value)}
            collapsedText={`群聊会话 ${groupMemories.length} 个 / ${groupMemories.reduce((s, m) => s + m.count, 0)} 条，私聊会话 ${privateMemories.length} 个 / ${privateMemories.reduce((s, m) => s + m.count, 0)} 条`}
          />
          {showMemoryDetails && (
            <DeferredVisibleBlock placeholder={<CollapsedHint text="滚动到这一块附近时再加载记忆进度条列表。" />}>
              <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityGap}`}>
                <MemoryPanel title="群聊记忆" subtitle="查看群聊会话占用与容量接近情况。" icon="👥" memories={groupMemories} />
                <MemoryPanel title="私聊记忆" subtitle="查看私聊会话占用与容量接近情况。" icon="👤" memories={privateMemories} />
              </div>
            </DeferredVisibleBlock>
          )}
        </Panel>
      ) : (
        <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityGap}`}>
          <MemoryPanel title="群聊记忆" subtitle="查看群聊会话占用与容量接近情况。" icon="👥" memories={groupMemories} />
          <MemoryPanel title="私聊记忆" subtitle="查看私聊会话占用与容量接近情况。" icon="👤" memories={privateMemories} />
        </div>
      )}

      {systemInfo && (
        <Panel title="配置文件检查" subtitle="如果这里有文件缺失，先别急着调参数，先把插件目录连对或把缺的文件补回来。" icon="🩺">
          <SectionToggleRow
            expanded={showFileDetails}
            onToggle={() => setShowFileDetails((value) => !value)}
            collapsedText={`共检查 ${systemInfo.files.length} 个文件，缺失 ${systemInfo.files.filter((file) => !file.exists).length} 个`}
          />
          {showFileDetails && (
            <DeferredVisibleBlock placeholder={<CollapsedHint text="滚动到这一块附近时再加载配置文件检查表格。" />}>
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
                            <span className="w-1.5 h-1.5 rounded-[var(--radius-pill)] inline-block" style={{ background: f.exists ? 'var(--success)' : 'var(--error)' }} />
                            {f.exists ? '可读取' : '缺失'}
                          </span>
                        </td>
                        <td className="py-2 text-[var(--text-muted)] text-xs mono">{f.exists ? formatBytes(f.size) : '-'}</td>
                        <td className="py-2 text-[var(--text-muted)] text-xs">{f.exists ? formatTime(f.modified) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DeferredVisibleBlock>
          )}
        </Panel>
      )}
    </div>
  );
}

function StatusRow({ label, value, badge, dot }: { label: string; value: string; badge?: string; dot?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-[var(--text-muted)] flex items-center gap-2">
        {dot && <span className="w-2 h-2 rounded-[var(--radius-pill)] inline-block" style={{ background: dot }} />}
        {label}
      </span>
      <span className="text-[var(--text-secondary)] flex items-center gap-2 text-right">
        {value}
        {badge && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--accent-purple)]">
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
      <div className="mt-2 h-1.5 bg-[var(--bg-elevated)] rounded-[var(--radius-pill)] overflow-hidden">
        <div className="h-full rounded-[var(--radius-pill)] transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
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

function SectionToggleRow({
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
        className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border cursor-pointer ${expanded ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'}`}
      >
        {expanded ? '收起明细' : '展开明细'}
      </button>
      {!expanded && (
        <span className="text-[11px] text-[var(--text-muted)] leading-relaxed">{collapsedText}</span>
      )}
    </div>
  );
}

function CollapsedHint({ text }: { text: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{text}</p>
    </div>
  );
}
