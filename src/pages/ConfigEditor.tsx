import { useState, useEffect, useRef, useMemo } from 'react';
import { ToggleSwitch } from '../components/common/ToggleSwitch';
import { SliderInput } from '../components/common/SliderInput';
import { TagList } from '../components/common/TagList';
import { KeyValueEditor } from '../components/common/KeyValueEditor';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ImportExportActions } from '../components/common/ImportExportActions';
import { Panel } from '../components/common/Panel';
import { SummaryCard, MiniInfo } from '../components/common/SummaryCard';
import { useUiStore } from '../stores/uiStore';
import { getConfig, saveConfig } from '../lib/tauri-commands';
import { downloadJsonWithTimestamp, pickJsonAndParse } from '../lib/json-transfer';
import type { RuntimeConfig } from '../lib/types';

interface Section {
  id: string;
  label: string;
  icon: string;
  summary: string;
  mode: 'common' | 'advanced' | 'both';
}

const sections: Section[] = [
  { id: 'core', label: '核心设置', icon: '⚙', summary: '昵称、主人账号、日志与基础身份。', mode: 'both' },
  { id: 'active', label: '活跃节点/人格', icon: '⚡', summary: '当前生效的 API 与人格索引。', mode: 'both' },
  { id: 'groups', label: '群聊与用户', icon: '👥', summary: '监听群组、白名单、黑名单与群限流。', mode: 'both' },
  { id: 'messages', label: '消息行为', icon: '💬', summary: '上下文条数、最大消息数、随机回复。', mode: 'both' },
  { id: 'memory', label: '记忆与摘要', icon: '🧠', summary: '记忆压缩与摘要策略。', mode: 'common' },
  { id: 'router', label: '智能路由', icon: '🔀', summary: '主节点、备用节点与降级重试规则。', mode: 'advanced' },
  { id: 'memes', label: '表情包', icon: '😸', summary: '控制表情包功能与触发概率。', mode: 'common' },
  { id: 'queue', label: '请求队列', icon: '📤', summary: '并发数、重试次数与重试延迟。', mode: 'advanced' },
  { id: 'mapping', label: '群级映射', icon: '🗺', summary: '按群定制人格与 API 索引。', mode: 'advanced' },
  { id: 'apiParams', label: 'API 参数', icon: '🎛', summary: '向下游模型透传的参数字典。', mode: 'advanced' },
  { id: 'forward', label: '转发设置', icon: '📨', summary: '长文本转发、分段与 @ 等待。', mode: 'both' },
];

const defaults: Partial<RuntimeConfig> = {
  nickName: 'NekoAI',
  masterQQ: [],
  activeApiIndex: 0,
  activeGroupPersonalityIndex: 0,
  activePrivatePersonalityIndex: 0,
  groups: [],
  allowPrivateTalkingUsers: [],
  userBlacklist: [],
  maxGroupMessages: 20,
  singleMaxMessages: 30,
  randomReply: 0.05,
  messagesLength: 15,
  enableMemes: false,
  memeProb: 0.1,
  logLevel: 'info',
  privateRefuse: '主人没有允许我和你说话哦~',
  forwardStrategy: 'auto',
  forwardMaxLength: 3000,
  forwardMaxSegments: 5,
  groupMentionWait: 5000,
  groupLimits: {},
  groupPersonalityMap: {},
  groupApiMap: {},
  smartRouter: {
    enabled: false,
    mode: 'round-robin',
    defaultApiIndex: 0,
    primaryApiIndex: 0,
    fallbackApiIndices: [],
    degradeStrategy: 'on-failure',
    maxSwitches: 2,
    retryCount: 1,
    retryDelay: 500,
  },
  memorySummary: { enabled: false, threshold: 30 },
  requestQueue: { maxConcurrent: 3, retryAttempts: 2, retryDelay: 1000 },
  apiParams: {},
};

function normalizeSmartRouter(input: RuntimeConfig['smartRouter'] | undefined): RuntimeConfig['smartRouter'] {
  const base = {
    enabled: false,
    mode: 'round-robin',
    defaultApiIndex: 0,
    primaryApiIndex: 0,
    fallbackApiIndices: [] as number[],
    degradeStrategy: 'on-failure' as const,
    maxSwitches: 2,
    retryCount: 1,
    retryDelay: 500,
  };

  return {
    ...base,
    ...(input ?? {}),
    fallbackApiIndices: (input?.fallbackApiIndices ?? []).filter((x) => Number.isFinite(Number(x))).map((x) => Number(x)),
    degradeStrategy:
      input?.degradeStrategy === 'on-timeout' || input?.degradeStrategy === 'on-any-error'
        ? input.degradeStrategy
        : 'on-failure',
  };
}

function parseFallbackIndices(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[，,\s]+/)) {
    if (!part) continue;
    const n = Number(part);
    if (Number.isInteger(n) && n >= 0) out.add(n);
  }
  return [...out];
}

export function ConfigEditor() {
  const addToast = useUiStore((s) => s.addToast);
  const settings = useUiStore((s) => s.settings);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [original, setOriginal] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('core');
  const [editorMode, setEditorMode] = useState<'common' | 'full'>('common');
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmResetSecond, setConfirmResetSecond] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const dirty = useMemo(() => config && JSON.stringify(config) !== original, [config, original]);
  const visibleSections = useMemo(
    () => sections.filter((s) => editorMode === 'full' || s.mode !== 'advanced'),
    [editorMode],
  );

  const summary = useMemo(() => {
    if (!config) {
      return { groups: 0, privateUsers: 0, blacklist: 0, advancedSections: 0 };
    }
    return {
      groups: config.groups?.length ?? 0,
      privateUsers: config.allowPrivateTalkingUsers?.length ?? 0,
      blacklist: config.userBlacklist?.length ?? 0,
      advancedSections: sections.filter((s) => s.mode === 'advanced').length,
    };
  }, [config]);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!visibleSections.some((s) => s.id === activeSection)) {
      setActiveSection(visibleSections[0]?.id ?? 'core');
    }
  }, [visibleSections, activeSection]);

  async function load() {
    setLoading(true);
    try {
      const rt = await getConfig<RuntimeConfig>('runtime');
      if (rt) {
        const normalized = {
          ...rt,
          smartRouter: normalizeSmartRouter(rt.smartRouter),
        };
        setConfig(normalized);
        setOriginal(JSON.stringify(normalized));
      } else {
        const initial = { ...defaults } as RuntimeConfig;
        initial.smartRouter = normalizeSmartRouter(initial.smartRouter);
        setConfig(initial);
        setOriginal(JSON.stringify(initial));
      }
    } catch (e: any) {
      addToast('error', `加载配置失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  function update<K extends keyof RuntimeConfig>(key: K, value: RuntimeConfig[K]) {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  }

  function resetAll() {
    if (!config) return;
    const next = {
      ...config,
      ...defaults,
      smartRouter: normalizeSmartRouter(defaults.smartRouter as RuntimeConfig['smartRouter']),
    } as RuntimeConfig;
    setConfig(next);
    addToast('warning', '已恢复所有默认值（需保存才生效）');
  }

  async function save() {
    if (!config) return;
    try {
      await saveConfig('runtime', config);
      setOriginal(JSON.stringify(config));
      addToast('success', '配置已保存');
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message ?? e}`);
    }
  }

  function exportRuntimeConfig() {
    if (!config) return;
    downloadJsonWithTimestamp(config, 'runtime_config.json');
    addToast('success', '已导出配置编辑数据');
  }

  async function importRuntimeConfig() {
    try {
      const picked = await pickJsonAndParse();
      if (!picked) return;
      if (!picked.data || Array.isArray(picked.data) || typeof picked.data !== 'object') {
        addToast('error', '导入失败：JSON 必须是对象');
        return;
      }
      const imported = picked.data as RuntimeConfig;
      setConfig({ ...imported, smartRouter: normalizeSmartRouter(imported.smartRouter) });
      addToast('success', '已导入配置编辑数据（请点击保存生效）');
    } catch (e: any) {
      addToast('error', `导入失败: ${e?.message ?? e}`);
    }
  }

  function scrollTo(id: string) {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const top = el.scrollTop + 20;
      for (const s of [...visibleSections].reverse()) {
        const ref = sectionRefs.current[s.id];
        if (ref && ref.offsetTop <= top) {
          setActiveSection(s.id);
          break;
        }
      }
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [visibleSections]);

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="text-4xl block mb-3 animate-bounce">🐱</span>
          <p className="text-[var(--text-secondary)]">加载中...</p>
        </div>
      </div>
    );
  }

  const isSpacious = settings.contentDensity === 'spacious';
  const contentGap = isSpacious ? 'space-y-7' : settings.contentDensity === 'compact' ? 'space-y-4' : 'space-y-6';

  return (
    <div className="flex gap-4 h-full">
      <nav className="w-56 flex-shrink-0 rounded-[var(--radius)] border border-[var(--border-subtle)] overflow-hidden" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
        <div className="px-4 py-4 border-b border-[var(--border-subtle)] space-y-3">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">配置导航</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">先看常用区，进完整模式再处理高级字段。</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setEditorMode('common')}
              className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${editorMode === 'common' ? 'bg-[var(--accent-purple)] text-white border-transparent' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              常用模式
            </button>
            <button
              onClick={() => setEditorMode('full')}
              className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${editorMode === 'full' ? 'bg-[var(--accent-purple)] text-white border-transparent' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              完整模式
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <MiniInfo label="当前章节" value={visibleSections.length} />
            <MiniInfo label="高级章节" value={summary.advancedSections} tone="info" />
          </div>
        </div>

        <div className="max-h-[calc(100%-220px)] overflow-y-auto p-2 space-y-1">
          {visibleSections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`w-full text-left px-3 py-2.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${activeSection === s.id ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'}`}
            >
              <div className="flex items-center gap-2 text-xs">
                <span>{s.icon}</span>
                <span>{s.label}</span>
              </div>
              <p className="mt-1 pl-6 text-[10px] text-[var(--text-muted)] leading-relaxed">{s.summary}</p>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-[var(--border-subtle)] space-y-2">
          <ImportExportActions
            onExport={exportRuntimeConfig}
            onImport={importRuntimeConfig}
            confirmTitle="导入运行时配置"
            size="xs"
          />
          <button
            onClick={() => setConfirmReset(true)}
            className="w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] text-[var(--warning)] hover:bg-[rgba(255,171,64,0.1)] transition-colors cursor-pointer text-left"
          >
            恢复全部默认
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className={`w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer text-left ${dirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
          >
            💾 保存配置
          </button>
        </div>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
          <SummaryCard label="模式" value={editorMode === 'common' ? '常用' : '完整'} hint={editorMode === 'common' ? '隐藏高频外章节，减少表单墙感' : '显示全部字段与高级章节'} />
          <SummaryCard label="活跃 API" value={`#${config.activeApiIndex}`} hint="当前生效节点索引" />
          <SummaryCard label="监听群组" value={String(summary.groups)} hint="当前配置中的群组数量" />
          <SummaryCard label="私聊白名单" value={String(summary.privateUsers)} hint="允许私聊的用户数量" />
          <SummaryCard label="保存状态" value={dirty ? '待保存' : '已同步'} hint={dirty ? '当前配置有改动，尚未写入文件' : '当前配置与文件一致'} tone={dirty ? 'warning' : 'neutral'} />
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border-subtle)] mb-3 px-4 py-3" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">当前模式说明：</span>
            <span className="text-xs text-[var(--text-secondary)]">
              {editorMode === 'common'
                ? '优先展示昵称、活跃索引、群组、消息、记忆、转发等高频配置。'
                : '显示智能路由、请求队列、群级映射、API 参数等完整配置。'}
            </span>
            <div className="flex-1" />
            {dirty && <span className="text-xs text-[var(--warning)]">已改动，记得保存</span>}
          </div>
        </div>

        <div ref={scrollRef} className={`flex-1 overflow-y-auto pr-2 ${contentGap}`}>
          <SectionCard id="core" title="核心设置" icon="⚙" summary="昵称、主人账号、拒绝文案与日志级别。" refs={sectionRefs}>
            <Field label="昵称">
              <TextInput value={config.nickName} onChange={(v) => update('nickName', v)} />
            </Field>
            <Field label="主人 QQ">
              <TagList tags={config.masterQQ ?? []} onChange={(v) => update('masterQQ', v)} placeholder="输入 QQ 号后回车" />
            </Field>
            <Field label="私聊拒绝消息">
              <TextInput value={config.privateRefuse ?? ''} onChange={(v) => update('privateRefuse', v)} />
            </Field>
            <Field label="日志级别">
              <Select value={config.logLevel ?? 'info'} onChange={(v) => update('logLevel', v)} options={['debug', 'info', 'warn', 'error']} />
            </Field>
          </SectionCard>

          <SectionCard id="active" title="活跃节点/人格" icon="⚡" summary="这组配置决定当前默认使用哪个 API 和人格。" refs={sectionRefs}>
            <Field label="活跃 API 节点">
              <NumberInput value={config.activeApiIndex} onChange={(v) => update('activeApiIndex', v)} min={0} />
            </Field>
            <Field label="群聊人格索引">
              <NumberInput value={config.activeGroupPersonalityIndex} onChange={(v) => update('activeGroupPersonalityIndex', v)} min={0} />
            </Field>
            <Field label="私聊人格索引">
              <NumberInput value={config.activePrivatePersonalityIndex} onChange={(v) => update('activePrivatePersonalityIndex', v)} min={0} />
            </Field>
          </SectionCard>

          <SectionCard id="groups" title="群聊与用户管理" icon="👥" summary="群组监听范围、用户权限与群级限流。" refs={sectionRefs}>
            <Field label="监听群组">
              <TagList tags={config.groups ?? []} onChange={(v) => update('groups', v)} placeholder="输入群号后回车" />
            </Field>
            <Field label="私聊白名单">
              <TagList tags={config.allowPrivateTalkingUsers ?? []} onChange={(v) => update('allowPrivateTalkingUsers', v)} placeholder="输入 QQ 号后回车" />
            </Field>
            <Field label="用户黑名单">
              <TagList tags={config.userBlacklist ?? []} onChange={(v) => update('userBlacklist', v)} placeholder="输入 QQ 号后回车" />
            </Field>
            <Field label="群限流配置 (群号 → 秒)">
              <KeyValueEditor data={config.groupLimits ?? {}} onChange={(v) => update('groupLimits', v)} keyPlaceholder="群号" valuePlaceholder="秒" />
            </Field>
          </SectionCard>

          <SectionCard id="messages" title="消息行为" icon="💬" summary="上下文长度、消息上限与随机回复节奏。" refs={sectionRefs}>
            <Field label="群聊最大消息数">
              <NumberInput value={config.maxGroupMessages} onChange={(v) => update('maxGroupMessages', v)} min={1} />
            </Field>
            <Field label="单次最大消息数">
              <NumberInput value={config.singleMaxMessages} onChange={(v) => update('singleMaxMessages', v)} min={1} />
            </Field>
            <Field label="随机回复概率">
              <SliderInput value={config.randomReply} onChange={(v) => update('randomReply', v)} suffix="%" />
            </Field>
            <Field label="上下文消息条数">
              <NumberInput value={config.messagesLength} onChange={(v) => update('messagesLength', v)} min={1} />
            </Field>
          </SectionCard>

          {visibleSections.some((s) => s.id === 'memory') && (
            <SectionCard id="memory" title="记忆与摘要" icon="🧠" summary="决定何时做摘要、用哪个模型、摘要长度多大。" refs={sectionRefs}>
              <Field label="启用记忆压缩">
                <ToggleSwitch checked={config.memorySummary?.enabled ?? false} onChange={(v) => update('memorySummary', { ...config.memorySummary, enabled: v })} />
              </Field>
              <Field label="压缩阈值 (消息数)">
                <NumberInput value={config.memorySummary?.threshold ?? 30} onChange={(v) => update('memorySummary', { ...config.memorySummary, threshold: v })} min={5} />
              </Field>
              <Field label="摘要模型">
                <TextInput value={config.memorySummary?.model ?? ''} onChange={(v) => update('memorySummary', { ...config.memorySummary, model: v })} placeholder="留空使用当前活跃模型" />
              </Field>
              <Field label="最大摘要长度">
                <NumberInput value={config.memorySummary?.maxSummaryLength ?? 500} onChange={(v) => update('memorySummary', { ...config.memorySummary, maxSummaryLength: v })} min={50} />
              </Field>
            </SectionCard>
          )}

          {visibleSections.some((s) => s.id === 'router') && (
            <SectionCard id="router" title="智能路由" icon="🔀" summary="主节点、备用节点、降级触发与重试策略。" refs={sectionRefs}>
              <Field label="启用智能路由">
                <ToggleSwitch checked={config.smartRouter?.enabled ?? false} onChange={(v) => update('smartRouter', { ...config.smartRouter, enabled: v })} />
              </Field>
              <Field label="路由模式">
                <Select value={config.smartRouter?.mode ?? 'round-robin'} onChange={(v) => update('smartRouter', { ...config.smartRouter, mode: v })} options={['round-robin', 'random', 'priority', 'least-latency']} />
              </Field>
              <Field label="默认 API 索引">
                <NumberInput value={config.smartRouter?.defaultApiIndex ?? 0} onChange={(v) => update('smartRouter', { ...config.smartRouter, defaultApiIndex: v })} min={0} />
              </Field>
              <Field label="主模型 API 索引">
                <NumberInput value={config.smartRouter?.primaryApiIndex ?? config.smartRouter?.defaultApiIndex ?? 0} onChange={(v) => update('smartRouter', { ...config.smartRouter, primaryApiIndex: v })} min={0} />
              </Field>
              <Field label="备用 API 索引列表">
                <TextInput value={(config.smartRouter?.fallbackApiIndices ?? []).join(', ')} onChange={(v) => update('smartRouter', { ...config.smartRouter, fallbackApiIndices: parseFallbackIndices(v) })} placeholder="例如: 1, 2, 5" />
              </Field>
              <Field label="降级触发策略">
                <Select
                  value={config.smartRouter?.degradeStrategy ?? 'on-failure'}
                  onChange={(v) => update('smartRouter', { ...config.smartRouter, degradeStrategy: (v as RuntimeConfig['smartRouter']['degradeStrategy']) ?? 'on-failure' })}
                  options={['on-failure', 'on-timeout', 'on-any-error']}
                />
              </Field>
              <Field label="最大切换次数">
                <NumberInput value={config.smartRouter?.maxSwitches ?? 2} onChange={(v) => update('smartRouter', { ...config.smartRouter, maxSwitches: v })} min={0} />
              </Field>
              <Field label="失败重试次数">
                <NumberInput value={config.smartRouter?.retryCount ?? 1} onChange={(v) => update('smartRouter', { ...config.smartRouter, retryCount: v })} min={0} />
              </Field>
              <Field label="重试延迟 (ms)">
                <NumberInput value={config.smartRouter?.retryDelay ?? 500} onChange={(v) => update('smartRouter', { ...config.smartRouter, retryDelay: v })} min={0} />
              </Field>
              <InlineNote>
                主节点 {config.smartRouter?.primaryApiIndex ?? config.smartRouter?.defaultApiIndex ?? 0} → 备用 [{(config.smartRouter?.fallbackApiIndices ?? []).join(', ') || '无'}] → 触发 {config.smartRouter?.degradeStrategy ?? 'on-failure'} → 最多切换 {config.smartRouter?.maxSwitches ?? 2} 次
              </InlineNote>
            </SectionCard>
          )}

          {visibleSections.some((s) => s.id === 'memes') && (
            <SectionCard id="memes" title="表情包" icon="😸" summary="控制表情包开关与触发概率。" refs={sectionRefs}>
              <Field label="启用表情包">
                <ToggleSwitch checked={config.enableMemes ?? false} onChange={(v) => update('enableMemes', v)} />
              </Field>
              <Field label="表情包概率">
                <SliderInput value={config.memeProb ?? 0.1} onChange={(v) => update('memeProb', v)} suffix="%" />
              </Field>
            </SectionCard>
          )}

          {visibleSections.some((s) => s.id === 'queue') && (
            <SectionCard id="queue" title="请求队列" icon="📤" summary="并发与重试参数，通常只有调优时才需要改。" refs={sectionRefs}>
              <Field label="最大并发数">
                <NumberInput value={config.requestQueue?.maxConcurrent ?? 3} onChange={(v) => update('requestQueue', { ...config.requestQueue, maxConcurrent: v })} min={1} />
              </Field>
              <Field label="重试次数">
                <NumberInput value={config.requestQueue?.retryAttempts ?? 2} onChange={(v) => update('requestQueue', { ...config.requestQueue, retryAttempts: v })} min={0} />
              </Field>
              <Field label="重试延迟 (ms)">
                <NumberInput value={config.requestQueue?.retryDelay ?? 1000} onChange={(v) => update('requestQueue', { ...config.requestQueue, retryDelay: v })} min={0} />
              </Field>
            </SectionCard>
          )}

          {visibleSections.some((s) => s.id === 'mapping') && (
            <SectionCard id="mapping" title="群级映射" icon="🗺" summary="按群绑定人格和 API，适合多群多角色场景。" refs={sectionRefs}>
              <Field label="群人格映射 (群号 → 人格索引)">
                <KeyValueEditor data={config.groupPersonalityMap ?? {}} onChange={(v) => update('groupPersonalityMap', v)} keyPlaceholder="群号" valuePlaceholder="索引" />
              </Field>
              <Field label="群 API 映射 (群号 → API 索引)">
                <KeyValueEditor data={config.groupApiMap ?? {}} onChange={(v) => update('groupApiMap', v)} keyPlaceholder="群号" valuePlaceholder="索引" />
              </Field>
            </SectionCard>
          )}

          {visibleSections.some((s) => s.id === 'apiParams') && (
            <SectionCard id="apiParams" title="API 参数" icon="🎛" summary="temperature、maxTokens 等透传参数。" refs={sectionRefs}>
              <Field label="API 参数 (参数名 → 值)">
                <KeyValueEditor data={Object.fromEntries(Object.entries(config.apiParams ?? {}).filter((e): e is [string, number] => e[1] !== undefined))} onChange={(v) => update('apiParams', v as RuntimeConfig['apiParams'])} keyPlaceholder="参数名" valuePlaceholder="值" />
              </Field>
            </SectionCard>
          )}

          <SectionCard id="forward" title="转发设置" icon="📨" summary="长文本转发策略、最大长度、最大分段与 @ 等待。" refs={sectionRefs}>
            <Field label="转发策略">
              <Select value={config.forwardStrategy ?? 'auto'} onChange={(v) => update('forwardStrategy', v)} options={['auto', 'always', 'never']} />
            </Field>
            <Field label="转发最大长度">
              <NumberInput value={config.forwardMaxLength ?? 3000} onChange={(v) => update('forwardMaxLength', v)} min={100} />
            </Field>
            <Field label="转发最大分段数">
              <NumberInput value={config.forwardMaxSegments ?? 5} onChange={(v) => update('forwardMaxSegments', v)} min={1} />
            </Field>
            <Field label="群聊@等待时间 (ms)">
              <NumberInput value={config.groupMentionWait ?? 5000} onChange={(v) => update('groupMentionWait', v)} min={0} />
            </Field>
          </SectionCard>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          setConfirmResetSecond(true);
        }}
        title="恢复全部默认"
        message="该操作会将当前配置字段重置为默认值（需保存后生效）。是否继续？"
        confirmText="继续"
        danger={false}
      />

      <ConfirmDialog
        open={confirmResetSecond}
        onClose={() => setConfirmResetSecond(false)}
        onConfirm={() => {
          setConfirmResetSecond(false);
          resetAll();
        }}
        title="二次确认"
        message="这是高风险操作：将覆盖当前编辑中的配置。请确认你已备份并仍要继续。"
        confirmText="我已了解，恢复默认"
      />
    </div>
  );
}

function SectionCard({ id, title, icon, summary, children, refs }: {
  id: string;
  title: string;
  icon: string;
  summary: string;
  children: React.ReactNode;
  refs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
}) {
  return (
    <div ref={(el) => { refs.current[id] = el; }}>
      <Panel title={title} subtitle={summary} icon={icon}>
        <div className="space-y-4">{children}</div>
      </Panel>
    </div>
  );
}

function InlineNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
      <p className="text-xs text-[var(--text-muted)] mono leading-relaxed">{children}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-col lg:flex-row">
      <label className="text-sm text-[var(--text-secondary)] pt-1 min-w-[160px] flex-shrink-0">{label}</label>
      <div className="flex-1 w-full">{children}</div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] transition-colors placeholder:text-[var(--text-muted)]"
    />
  );
}

function NumberInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)] transition-colors"
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] transition-colors cursor-pointer"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
