import { useState, useEffect, useRef, useMemo } from 'react';
import { ToggleSwitch } from '../components/common/ToggleSwitch';
import { SliderInput } from '../components/common/SliderInput';
import { TagList } from '../components/common/TagList';
import { KeyValueEditor } from '../components/common/KeyValueEditor';
import { useUiStore } from '../stores/uiStore';
import { getConfig, saveConfig } from '../lib/tauri-commands';
import type { RuntimeConfig } from '../lib/types';

interface Section {
  id: string;
  label: string;
  icon: string;
}

const sections: Section[] = [
  { id: 'core', label: '核心设置', icon: '⚙' },
  { id: 'active', label: '活跃节点/人格', icon: '⚡' },
  { id: 'groups', label: '群聊与用户', icon: '👥' },
  { id: 'messages', label: '消息行为', icon: '💬' },
  { id: 'memory', label: '记忆与摘要', icon: '🧠' },
  { id: 'router', label: '智能路由', icon: '🔀' },
  { id: 'memes', label: '表情包', icon: '😸' },
  { id: 'queue', label: '请求队列', icon: '📤' },
  { id: 'mapping', label: '群级映射', icon: '🗺' },
  { id: 'apiParams', label: 'API 参数', icon: '🎛' },
  { id: 'forward', label: '转发设置', icon: '📨' },
];

// Sensible defaults for reset
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
  smartRouter: { enabled: false, mode: 'round-robin', defaultApiIndex: 0 },
  memorySummary: { enabled: false, threshold: 30 },
  requestQueue: { maxConcurrent: 3, retryAttempts: 2, retryDelay: 1000 },
  apiParams: {},
};

export function ConfigEditor() {
  const addToast = useUiStore((s) => s.addToast);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [original, setOriginal] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('core');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const dirty = useMemo(() => config && JSON.stringify(config) !== original, [config, original]);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const rt = await getConfig<RuntimeConfig>('runtime');
      if (rt) {
        setConfig(rt);
        setOriginal(JSON.stringify(rt));
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
    setConfig({ ...config, ...defaults } as RuntimeConfig);
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

  function scrollTo(id: string) {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Track scroll position to highlight active section
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const top = el.scrollTop + 20;
      for (const s of [...sections].reverse()) {
        const ref = sectionRefs.current[s.id];
        if (ref && ref.offsetTop <= top) {
          setActiveSection(s.id);
          break;
        }
      }
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, []);

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

  return (
    <div className="flex gap-4 h-full">
      {/* Side nav */}
      <nav className="w-44 flex-shrink-0 space-y-0.5 overflow-y-auto">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] text-xs transition-colors cursor-pointer text-left
              ${activeSection === s.id
                ? 'bg-[rgba(14,165,233,0.15)] text-[var(--accent-purple)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              }`}
          >
            <span>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
        <div className="pt-2 border-t border-[var(--border-subtle)] mt-2 space-y-1">
          <button
            onClick={resetAll}
            className="w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] text-[var(--warning)] hover:bg-[rgba(255,171,64,0.1)] transition-colors cursor-pointer text-left"
          >
            恢复全部默认
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className={`w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer text-left
              ${dirty
                ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty'
                : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'
              }`}
          >
            💾 保存配置
          </button>
        </div>
      </nav>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-6 pr-2">
        {/* Core */}
        <SectionCard id="core" title="核心设置" icon="⚙" refs={sectionRefs}>
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
            <Select
              value={config.logLevel ?? 'info'}
              onChange={(v) => update('logLevel', v)}
              options={['debug', 'info', 'warn', 'error']}
            />
          </Field>
        </SectionCard>

        {/* Active indices */}
        <SectionCard id="active" title="活跃节点/人格" icon="⚡" refs={sectionRefs}>
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

        {/* Groups & Users */}
        <SectionCard id="groups" title="群聊与用户管理" icon="👥" refs={sectionRefs}>
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

        {/* Messages */}
        <SectionCard id="messages" title="消息行为" icon="💬" refs={sectionRefs}>
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

        {/* Memory & Summary */}
        <SectionCard id="memory" title="记忆与摘要" icon="🧠" refs={sectionRefs}>
          <Field label="启用记忆压缩">
            <ToggleSwitch
              checked={config.memorySummary?.enabled ?? false}
              onChange={(v) => update('memorySummary', { ...config.memorySummary, enabled: v })}
            />
          </Field>
          <Field label="压缩阈值 (消息数)">
            <NumberInput
              value={config.memorySummary?.threshold ?? 30}
              onChange={(v) => update('memorySummary', { ...config.memorySummary, threshold: v })}
              min={5}
            />
          </Field>
          <Field label="摘要模型">
            <TextInput
              value={config.memorySummary?.model ?? ''}
              onChange={(v) => update('memorySummary', { ...config.memorySummary, model: v })}
              placeholder="留空使用当前活跃模型"
            />
          </Field>
          <Field label="最大摘要长度">
            <NumberInput
              value={config.memorySummary?.maxSummaryLength ?? 500}
              onChange={(v) => update('memorySummary', { ...config.memorySummary, maxSummaryLength: v })}
              min={50}
            />
          </Field>
        </SectionCard>

        {/* Smart Router */}
        <SectionCard id="router" title="智能路由" icon="🔀" refs={sectionRefs}>
          <Field label="启用智能路由">
            <ToggleSwitch
              checked={config.smartRouter?.enabled ?? false}
              onChange={(v) => update('smartRouter', { ...config.smartRouter, enabled: v })}
            />
          </Field>
          <Field label="路由模式">
            <Select
              value={config.smartRouter?.mode ?? 'round-robin'}
              onChange={(v) => update('smartRouter', { ...config.smartRouter, mode: v })}
              options={['round-robin', 'random', 'priority', 'least-latency']}
            />
          </Field>
          <Field label="默认 API 索引">
            <NumberInput
              value={config.smartRouter?.defaultApiIndex ?? 0}
              onChange={(v) => update('smartRouter', { ...config.smartRouter, defaultApiIndex: v })}
              min={0}
            />
          </Field>
        </SectionCard>

        {/* Memes */}
        <SectionCard id="memes" title="表情包" icon="😸" refs={sectionRefs}>
          <Field label="启用表情包">
            <ToggleSwitch
              checked={config.enableMemes ?? false}
              onChange={(v) => update('enableMemes', v)}
            />
          </Field>
          <Field label="表情包概率">
            <SliderInput
              value={config.memeProb ?? 0.1}
              onChange={(v) => update('memeProb', v)}
              suffix="%"
            />
          </Field>
        </SectionCard>

        {/* Request Queue */}
        <SectionCard id="queue" title="请求队列" icon="📤" refs={sectionRefs}>
          <Field label="最大并发数">
            <NumberInput
              value={config.requestQueue?.maxConcurrent ?? 3}
              onChange={(v) => update('requestQueue', { ...config.requestQueue, maxConcurrent: v })}
              min={1}
            />
          </Field>
          <Field label="重试次数">
            <NumberInput
              value={config.requestQueue?.retryAttempts ?? 2}
              onChange={(v) => update('requestQueue', { ...config.requestQueue, retryAttempts: v })}
              min={0}
            />
          </Field>
          <Field label="重试延迟 (ms)">
            <NumberInput
              value={config.requestQueue?.retryDelay ?? 1000}
              onChange={(v) => update('requestQueue', { ...config.requestQueue, retryDelay: v })}
              min={0}
            />
          </Field>
        </SectionCard>

        {/* Group Mappings */}
        <SectionCard id="mapping" title="群级映射" icon="🗺" refs={sectionRefs}>
          <Field label="群人格映射 (群号 → 人格索引)">
            <KeyValueEditor data={config.groupPersonalityMap ?? {}} onChange={(v) => update('groupPersonalityMap', v)} keyPlaceholder="群号" valuePlaceholder="索引" />
          </Field>
          <Field label="群 API 映射 (群号 → API 索引)">
            <KeyValueEditor data={config.groupApiMap ?? {}} onChange={(v) => update('groupApiMap', v)} keyPlaceholder="群号" valuePlaceholder="索引" />
          </Field>
        </SectionCard>

        {/* API Params */}
        <SectionCard id="apiParams" title="API 参数" icon="🎛" refs={sectionRefs}>
          <Field label="API 参数 (参数名 → 值)">
            <KeyValueEditor data={Object.fromEntries(Object.entries(config.apiParams ?? {}).filter((e): e is [string, number] => e[1] !== undefined))} onChange={(v) => update('apiParams', v as any)} keyPlaceholder="参数名" valuePlaceholder="值" />
          </Field>
        </SectionCard>

        {/* Forward */}
        <SectionCard id="forward" title="转发设置" icon="📨" refs={sectionRefs}>
          <Field label="转发策略">
            <Select
              value={config.forwardStrategy ?? 'auto'}
              onChange={(v) => update('forwardStrategy', v)}
              options={['auto', 'always', 'never']}
            />
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
  );
}

// ===== Generic field components =====

function SectionCard({ id, title, icon, children, refs }: {
  id: string; title: string; icon: string; children: React.ReactNode;
  refs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
}) {
  return (
    <div
      ref={(el) => { refs.current[id] = el; }}
      className="bg-white rounded-[var(--radius)] p-6 overflow-hidden"
      style={{ boxShadow: 'var(--shadow-3d)' }}
    >
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">{icon} {title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <label className="text-sm text-[var(--text-secondary)] pt-1.5 min-w-[140px] flex-shrink-0">{label}</label>
      <div className="flex-1">{children}</div>
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
      className="w-full px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] transition-colors placeholder:text-[var(--text-muted)]"
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
      className="w-full px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)] transition-colors"
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] transition-colors cursor-pointer"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
