import { useState, useEffect, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { StatCard } from '../components/common/StatCard';
import { ProgressBar } from '../components/common/ProgressBar';
import { Modal } from '../components/common/Modal';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ImportExportActions } from '../components/common/ImportExportActions';
import { SearchBar } from '../components/common/SearchBar';
import { Panel } from '../components/common/Panel';
import { SummaryCard } from '../components/common/SummaryCard';
import { useUiStore } from '../stores/uiStore';
import { getConfig, listMemory, getMemory, saveMemory, deleteMemory } from '../lib/tauri-commands';
import { downloadJsonWithTimestamp, pickJsonAndParse } from '../lib/json-transfer';
import type { MemoryMeta, RuntimeConfig } from '../lib/types';

const MEMORY_CAPACITY = 50;

interface MemoryUiItem {
  role: 'user' | 'assistant' | 'system';
  content: string;
  raw: any;
  format: 'object' | 'serialized';
  sender?: string;
  time?: string;
}

function parseSerializedMemory(line: string): { role: 'user' | 'assistant' | 'system'; sender?: string; time?: string; content: string } {
  const contentMatch = line.match(/发送内容:([\s\S]*)/);
  const senderMatch = line.match(/发送者:([^\n\r]+)/);
  const timeMatch = line.match(/发送时间:([^\n\r]+)/);
  const content = (contentMatch?.[1] ?? line).trim();
  const sender = senderMatch?.[1]?.trim();
  const time = timeMatch?.[1]?.trim();

  const senderText = sender ?? '';
  let role: 'user' | 'assistant' | 'system' = 'system';
  if (/系统/.test(senderText)) role = 'system';
  else if (/Neko|neko|AI|机器人/.test(senderText)) role = 'assistant';
  else role = 'user';

  return { role, sender, time, content };
}

function toUiItem(raw: any): MemoryUiItem {
  if (typeof raw === 'string') {
    const parsed = parseSerializedMemory(raw);
    return {
      role: parsed.role,
      content: parsed.content,
      sender: parsed.sender,
      time: parsed.time,
      raw,
      format: 'serialized',
    };
  }

  if (raw && typeof raw === 'object') {
    const role = raw.role === 'user' || raw.role === 'assistant' || raw.role === 'system' ? raw.role : 'system';
    const content = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw);
    return {
      role,
      content,
      raw,
      format: 'object',
    };
  }

  return {
    role: 'system',
    content: String(raw ?? ''),
    raw,
    format: 'serialized',
  };
}

function fromUiItem(item: MemoryUiItem): any {
  if (item.format === 'object' && item.raw && typeof item.raw === 'object') {
    return { ...item.raw, role: item.role, content: item.content };
  }

  const sender = item.sender ?? (item.role === 'assistant' ? 'Neko' : item.role === 'user' ? '用户' : '系统摘要');
  const time = item.time ?? '';
  return `\n发送时间:${time}\n发送者:${sender}\n发送内容:${item.content}\n`;
}

export function MemoryViewer() {
  const addToast = useUiStore((s) => s.addToast);
  const settings = useUiStore((s) => s.settings);
  const [loading, setLoading] = useState(true);
  const [groupMemories, setGroupMemories] = useState<MemoryMeta[]>([]);
  const [privateMemories, setPrivateMemories] = useState<MemoryMeta[]>([]);
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [showDetailTools, setShowDetailTools] = useState(false);

  const [detail, setDetail] = useState<{ type: 'group' | 'private'; meta: MemoryMeta } | null>(null);
  const [messages, setMessages] = useState<MemoryUiItem[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [detailSearch, setDetailSearch] = useState('');
  const [detailDirty, setDetailDirty] = useState(false);

  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<{ type: 'group' | 'private'; meta: MemoryMeta } | null>(null);
  const [confirmDeleteMsg, setConfirmDeleteMsg] = useState<number | null>(null);

  useEffect(() => {
    load();

    let unlistenMemory: (() => void) | undefined;

    async function setup() {
      try {
        unlistenMemory = await listen('memory-changed', () => {
          load();
        });
      } catch {
        // no-op in browser mode
      }
    }

    setup();
    return () => {
      unlistenMemory?.();
    };
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [gm, pm, rt] = await Promise.all([
        listMemory('group'),
        listMemory('private'),
        getConfig<RuntimeConfig>('runtime'),
      ]);
      setGroupMemories(gm ?? []);
      setPrivateMemories(pm ?? []);
      setRuntime(rt);
    } catch (e: any) {
      addToast('error', `加载失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(type: 'group' | 'private', meta: MemoryMeta) {
    try {
      const data = await getMemory(type, meta.id);
      const rawList = Array.isArray(data) ? data : [];
      setMessages(rawList.map((item) => toUiItem(item)));
      setDetail({ type, meta });
      setDetailDirty(false);
      setEditingIdx(null);
      setDetailSearch('');
      setShowDetailTools(false);
    } catch (e: any) {
      addToast('error', `读取记忆失败: ${e?.message ?? e}`);
    }
  }

  function startEdit(idx: number) {
    setEditingIdx(idx);
    setEditContent(messages[idx].content);
  }

  function saveEditMsg() {
    if (editingIdx === null) return;
    const next = [...messages];
    next[editingIdx] = { ...next[editingIdx], content: editContent };
    setMessages(next);
    setEditingIdx(null);
    setDetailDirty(true);
  }

  function deleteMsg(idx: number) {
    setMessages(messages.filter((_, i) => i !== idx));
    setDetailDirty(true);
    setConfirmDeleteMsg(null);
  }

  function clearAll() {
    setMessages([]);
    setDetailDirty(true);
    setConfirmClear(false);
  }

  async function saveDetail() {
    if (!detail) return;
    try {
      await saveMemory(detail.type, detail.meta.id, messages.map((m) => fromUiItem(m)));
      setDetailDirty(false);
      addToast('success', '记忆已保存');
      load();
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message ?? e}`);
    }
  }

  function exportCurrentSession() {
    if (!detail) return;
    const data = messages.map((m) => fromUiItem(m));
    downloadJsonWithTimestamp(data, `${detail.meta.id}.json`);
    addToast('success', '已导出当前会话记忆');
  }

  async function importCurrentSession() {
    if (!detail) return;
    try {
      const picked = await pickJsonAndParse();
      if (!picked) return;
      if (!Array.isArray(picked.data)) {
        addToast('error', '导入失败：JSON 必须是数组');
        return;
      }
      setMessages((picked.data as any[]).map((item) => toUiItem(item)));
      setDetailDirty(true);
      setEditingIdx(null);
      addToast('success', '已导入当前会话记忆（请点击保存生效）');
    } catch (e: any) {
      addToast('error', `导入失败: ${e?.message ?? e}`);
    }
  }

  async function doDeleteFile() {
    if (!confirmDeleteFile) return;
    try {
      await deleteMemory(confirmDeleteFile.type, confirmDeleteFile.meta.id);
      addToast('success', `已删除记忆 ${confirmDeleteFile.meta.id}`);
      setConfirmDeleteFile(null);
      if (detail?.meta.id === confirmDeleteFile.meta.id) setDetail(null);
      load();
    } catch (e: any) {
      addToast('error', `删除失败: ${e?.message ?? e}`);
    }
  }

  const filteredMessages = useMemo(() => {
    if (!detailSearch.trim()) return messages.map((m, i) => ({ msg: m, idx: i }));
    const q = detailSearch.toLowerCase();
    return messages
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => msg.content.toLowerCase().includes(q));
  }, [messages, detailSearch]);

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

  const totalSessions = groupMemories.length + privateMemories.length;
  const totalMsgs = [...groupMemories, ...privateMemories].reduce((s, m) => s + m.count, 0);
  const memorySummary = runtime?.memorySummary;
  const densityClass = settings.contentDensity === 'spacious' ? 'gap-5' : settings.contentDensity === 'compact' ? 'gap-3' : 'gap-4';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard label="总会话数" value={totalSessions} icon="🧠" color="var(--accent-purple)" />
        <StatCard label="总消息数" value={totalMsgs} icon="💬" color="var(--accent-pink)" />
        <StatCard label="记忆压缩" value={memorySummary?.enabled ? '开启' : '关闭'} icon="📦" color={memorySummary?.enabled ? 'var(--success)' : 'var(--text-muted)'} />
        <StatCard label="压缩阈值" value={memorySummary?.threshold ?? '-'} icon="📏" color="var(--info)" />
        <SummaryCard label="当前说明" value="会话优先" hint="先选会话，再进入详情页编辑消息" />
      </div>

      <div className="rounded-[var(--radius)] border border-[var(--border-subtle)] px-4 py-3" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">群聊会话 {groupMemories.length}</span>
          <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">私聊会话 {privateMemories.length}</span>
          <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">容量上限 {MEMORY_CAPACITY} / 会话</span>
          <div className="flex-1" />
          <span className="text-[var(--text-muted)]">详情页支持会话导入/导出、消息内联编辑与页面内刷新。</span>
        </div>
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityClass}`}>
        <MemoryList
          title="群聊记忆"
          subtitle="适合查看群场景下的长期记忆容量与会话分布。"
          icon="👥"
          memories={groupMemories}
          type="group"
          onOpen={openDetail}
          onDelete={(meta) => setConfirmDeleteFile({ type: 'group', meta })}
        />
        <MemoryList
          title="私聊记忆"
          subtitle="适合查看单聊场景下的记忆会话与容量占用。"
          icon="👤"
          memories={privateMemories}
          type="private"
          onOpen={openDetail}
          onDelete={(meta) => setConfirmDeleteFile({ type: 'private', meta })}
        />
      </div>

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.type === 'group' ? '群聊' : '私聊'}记忆 — ${detail.meta.id}` : ''}
        width="780px"
      >
        {detail && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <SummaryCard label="当前会话" value={detail.meta.id} hint={detail.type === 'group' ? '群聊记忆文件' : '私聊记忆文件'} />
              <SummaryCard label="消息总数" value={String(messages.length)} hint="保存前后的编辑都基于当前列表" />
              <SummaryCard label="筛选结果" value={String(filteredMessages.length)} hint={detailSearch ? '当前搜索条件下的可见条目' : '未启用搜索'} />
              <SummaryCard label="保存状态" value={detailDirty ? '待保存' : '已同步'} hint={detailDirty ? '当前会话有改动' : '当前会话未改动'} tone={detailDirty ? 'warning' : 'neutral'} />
            </div>

            <div className="rounded-[var(--radius)] border border-[var(--border-subtle)] px-4 py-3" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[280px]">
                  <SearchBar value={detailSearch} onChange={setDetailSearch} placeholder="搜索消息内容..." />
                </div>
                <button
                  onClick={() => setShowDetailTools((v) => !v)}
                  className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${showDetailTools ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'}`}
                >
                  {showDetailTools ? '收起会话工具' : '更多操作'}
                </button>
                {detailDirty && (
                  <button
                    onClick={saveDetail}
                    className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 transition-colors cursor-pointer pulse-dirty"
                  >
                    💾 保存
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {detailSearch ? <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">关键词：{detailSearch}</span> : null}
                <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">显示 {filteredMessages.length}/{messages.length}</span>
                <div className="flex-1" />
                <span className="text-[var(--text-muted)]">编辑、删除和清空都需保存后才会真正写入。</span>
              </div>

              {showDetailTools && (
                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2">
                    <p className="text-xs font-medium text-[var(--text-primary)]">当前会话导入 / 导出</p>
                    <p className="text-[11px] text-[var(--text-muted)]">适合备份、迁移或手工修复当前会话内容。</p>
                    <ImportExportActions
                      onExport={exportCurrentSession}
                      onImport={importCurrentSession}
                      exportLabel="⬇ 导出会话"
                      importLabel="⬆ 导入会话"
                      confirmTitle="导入当前会话"
                      size="xs"
                    />
                  </div>
                  <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2">
                    <p className="text-xs font-medium text-[var(--text-primary)]">高风险操作</p>
                    <p className="text-[11px] text-[var(--text-muted)]">清空只影响当前会话列表，仍需保存才会落盘。</p>
                    <button
                      onClick={() => setConfirmClear(true)}
                      className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,82,82,0.15)] text-[var(--error)] hover:bg-[rgba(255,82,82,0.25)] transition-colors cursor-pointer"
                    >
                      清空全部
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {filteredMessages.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-8">
                  {detailSearch ? '没有匹配的消息' : '暂无消息'}
                </p>
              ) : (
                filteredMessages.map(({ msg, idx }) => {
                  const roleStyle = msg.role === 'user'
                    ? { bg: 'rgba(147,197,253,0.1)', border: 'var(--info)', label: 'user' }
                    : msg.role === 'assistant'
                      ? { bg: 'rgba(14,165,233,0.1)', border: 'var(--accent-purple)', label: 'assistant' }
                      : { bg: 'rgba(124,106,154,0.1)', border: 'var(--text-muted)', label: 'system' };

                  return (
                    <div
                      key={idx}
                      className="p-3 rounded-[var(--radius-sm)] border"
                      style={{ background: roleStyle.bg, borderColor: roleStyle.border }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ color: roleStyle.border, background: `${roleStyle.border}20` }}
                          >
                            {roleStyle.label}
                          </span>
                          {(msg.sender || msg.time) && (
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {msg.sender ? `发送者: ${msg.sender}` : ''}
                              {msg.sender && msg.time ? ' · ' : ''}
                              {msg.time ? `时间: ${msg.time}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEdit(idx)}
                            className="text-[10px] px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--accent-purple)] hover:bg-[rgba(14,165,233,0.1)] transition-colors cursor-pointer"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => setConfirmDeleteMsg(idx)}
                            className="text-[10px] px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[rgba(255,82,82,0.1)] transition-colors cursor-pointer"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      {editingIdx === idx ? (
                        <div className="space-y-2">
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={4}
                            className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)] resize-none"
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={saveEditMsg}
                              className="text-[10px] px-2 py-1 rounded bg-[var(--accent-purple)] text-white hover:opacity-90 cursor-pointer"
                            >
                              确定
                            </button>
                            <button
                              onClick={() => setEditingIdx(null)}
                              className="text-[10px] px-2 py-1 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] cursor-pointer"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                          {msg.content?.trim() ? msg.content : '(无文本内容)'}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearAll}
        title="清空记忆"
        message="确定要清空所有消息吗？保存后才会生效。"
      />

      <ConfirmDialog
        open={confirmDeleteMsg !== null}
        onClose={() => setConfirmDeleteMsg(null)}
        onConfirm={() => { if (confirmDeleteMsg !== null) deleteMsg(confirmDeleteMsg); }}
        title="删除消息"
        message="确定要删除这条消息吗？保存后才会生效。"
      />

      <ConfirmDialog
        open={confirmDeleteFile !== null}
        onClose={() => setConfirmDeleteFile(null)}
        onConfirm={doDeleteFile}
        title="删除记忆文件"
        message={confirmDeleteFile ? `确定要删除记忆 "${confirmDeleteFile.meta.id}" 吗？此操作不可撤销。` : ''}
      />
    </div>
  );
}

function MemoryList({ title, subtitle, icon, memories, type, onOpen, onDelete }: {
  title: string;
  subtitle: string;
  icon: string;
  memories: MemoryMeta[];
  type: 'group' | 'private';
  onOpen: (type: 'group' | 'private', meta: MemoryMeta) => void;
  onDelete: (meta: MemoryMeta) => void;
}) {
  const totalMsgs = memories.reduce((s, m) => s + m.count, 0);

  return (
    <Panel title={title} subtitle={subtitle} icon={icon} padding="sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <span className="text-xs text-[var(--text-muted)]">{memories.length} 个 · {totalMsgs} 条</span>
      </div>

      {memories.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] text-center py-8">暂无记忆数据</p>
      ) : (
        <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
          {memories.map((m) => (
            <div
              key={m.id}
              className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 hover:border-[var(--border-hover)] transition-colors cursor-pointer"
              onClick={() => onOpen(type, m)}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--text-primary)] font-medium truncate">{m.id}</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    {m.count} 条 · {m.size > 0 ? `${(m.size / 1024).toFixed(1)} KB` : '0 KB'}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(m); }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--error)] transition-colors cursor-pointer"
                >
                  删除
                </button>
              </div>
              <ProgressBar value={m.count} max={MEMORY_CAPACITY} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
